#!/usr/bin/env node
/**
 * migrate.js — One-time migration from Supabase Storage to Cloudflare R2
 *
 * Copies all files from your Supabase "school-files" bucket to R2,
 * then updates the URLs in your database (students.photo_url,
 * student_documents.file_url, and question paper image URLs).
 *
 * Prerequisites:
 *   npm install @supabase/supabase-js @aws-sdk/client-s3
 *
 * Usage:
 *   Set the environment variables below, then:
 *   node migrate.js
 *
 * Environment variables:
 *   SUPABASE_URL          — your Supabase project URL
 *   SUPABASE_SERVICE_KEY  — service_role key (has full access)
 *   SUPABASE_S3_ENDPOINT  — S3 endpoint from Supabase Dashboard → Storage → S3
 *   SUPABASE_S3_ACCESS_KEY — S3 access key from Supabase Dashboard → Storage → S3
 *   SUPABASE_S3_SECRET_KEY — S3 secret key from Supabase Dashboard → Storage → S3
 *   SUPABASE_S3_REGION     — S3 region (usually your project region, e.g. ap-south-1)
 *   R2_ACCOUNT_ID         — Cloudflare account ID
 *   R2_ACCESS_KEY         — R2 API token access key
 *   R2_SECRET_KEY         — R2 API token secret key
 *   R2_BUCKET             — R2 bucket name (default: school-files)
 *   R2_WORKER_URL         — your deployed Worker URL (for the new file URLs)
 */

import { createClient } from '@supabase/supabase-js'
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  SUPABASE_S3_ENDPOINT,
  SUPABASE_S3_ACCESS_KEY,
  SUPABASE_S3_SECRET_KEY,
  SUPABASE_S3_REGION = 'ap-south-1',
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY,
  R2_SECRET_KEY,
  R2_BUCKET = 'school-files',
  R2_WORKER_URL
} = process.env

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
  console.error('Missing R2_ACCOUNT_ID, R2_ACCESS_KEY, or R2_SECRET_KEY')
  process.exit(1)
}
if (!R2_WORKER_URL) {
  console.error('Missing R2_WORKER_URL')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const supaS3 = new S3Client({
  region: SUPABASE_S3_REGION,
  endpoint: SUPABASE_S3_ENDPOINT,
  credentials: { accessKeyId: SUPABASE_S3_ACCESS_KEY, secretAccessKey: SUPABASE_S3_SECRET_KEY },
  forcePathStyle: true
})

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY }
})

async function listAllObjects(client, bucket) {
  const all = []
  let token
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: token,
      MaxKeys: 1000
    }))
    if (res.Contents) all.push(...res.Contents)
    token = res.IsTruncated ? res.NextContinuationToken : null
  } while (token)
  return all
}

async function copyFile(key) {
  const get = await supaS3.send(new GetObjectCommand({ Bucket: 'school-files', Key: key }))
  const body = await streamToBuffer(get.Body)
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: get.ContentType || 'application/octet-stream'
  }))
}

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function newUrl(path) {
  return R2_WORKER_URL + '/file?path=' + encodeURIComponent(path)
}

// ── MAIN ────────────────────────────────────────────────────────

async function main() {
  console.log('=== Step 1: List all files in Supabase Storage ===')
  const objects = await listAllObjects(supaS3, 'school-files')
  console.log(`Found ${objects.length} files`)

  console.log('\n=== Step 2: Copy files to R2 ===')
  let copied = 0, failed = 0
  for (const obj of objects) {
    try {
      process.stdout.write(`  Copying: ${obj.Key} (${(obj.Size / 1024).toFixed(1)} KB)...`)
      await copyFile(obj.Key)
      copied++
      console.log(' ✓')
    } catch (e) {
      failed++
      console.log(` ✗ ${e.message}`)
    }
  }
  console.log(`\nCopied: ${copied}, Failed: ${failed}`)

  console.log('\n=== Step 3: Update database URLs ===')

  // 3a. students.photo_url
  const { data: students } = await sb.from('students').select('student_id, photo_url').not('photo_url', 'is', null)
  let updatedPhotos = 0
  for (const s of (students || [])) {
    if (!s.photo_url || s.photo_url.includes(R2_WORKER_URL)) continue
    const path = extractPath(s.photo_url)
    if (!path) continue
    const { error } = await sb.from('students').update({ photo_url: newUrl(path) }).eq('student_id', s.student_id)
    if (!error) updatedPhotos++
  }
  console.log(`  Updated ${updatedPhotos} student photo URLs`)

  // 3b. student_documents.file_url
  const { data: docs } = await sb.from('student_documents').select('id, file_url').not('file_url', 'is', null)
  let updatedDocs = 0
  for (const d of (docs || [])) {
    if (!d.file_url || d.file_url.includes(R2_WORKER_URL)) continue
    const path = extractPath(d.file_url)
    if (!path) continue
    const { error } = await sb.from('student_documents').update({ file_url: newUrl(path) }).eq('id', d.id)
    if (!error) updatedDocs++
  }
  console.log(`  Updated ${updatedDocs} student document URLs`)

  // 3c. question_papers content image URLs
  const { data: papers } = await sb.from('question_papers').select('paper_id, content')
  let updatedPapers = 0
  for (const p of (papers || [])) {
    if (!p.content) continue
    let json = JSON.stringify(p.content)
    if (!json.includes('/school-files/')) continue
    json = json.replace(/https?:\/\/[^"]*\/school-files\/([^"?]+)(\?[^"]*)?/g, (_, path) => newUrl(path))
    const { error } = await sb.from('question_papers').update({ content: JSON.parse(json) }).eq('paper_id', p.paper_id)
    if (!error) updatedPapers++
  }
  console.log(`  Updated ${updatedPapers} question paper image URLs`)

  console.log('\n=== Migration complete ===')
  console.log('Verify everything works, then you can delete the Supabase storage bucket.')
}

function extractPath(fileUrl) {
  if (!fileUrl) return null
  const m = fileUrl.split('/school-files/')[1]
  return m ? m.split('?')[0] : null
}

main().catch(e => { console.error(e); process.exit(1) })
