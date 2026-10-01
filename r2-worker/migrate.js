#!/usr/bin/env node
/**
 * migrate.js — One-time migration from Supabase Storage to Cloudflare R2
 *
 * Copies all files from your Supabase "school-files" bucket to R2
 * using the Supabase JS client (no S3 keys needed), then updates
 * the URLs in your database.
 *
 * Prerequisites:
 *   npm install
 *
 * Usage:
 *   Set the environment variables below, then:
 *   node migrate.js
 *
 * Environment variables:
 *   SUPABASE_URL          — your Supabase project URL
 *   SUPABASE_SERVICE_KEY  — service_role key (Dashboard → Settings → API)
 *   R2_ACCOUNT_ID         — Cloudflare account ID (Dashboard → R2)
 *   R2_ACCESS_KEY         — R2 API token access key
 *   R2_SECRET_KEY         — R2 API token secret key
 *   R2_BUCKET             — R2 bucket name (default: school-files)
 *   R2_WORKER_URL         — your deployed Worker URL
 */

import { createClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
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

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY }
})

const BUCKET = 'school-files'
const FOLDERS = ['student-photos', 'student-docs', 'students', 'question-papers']

async function listAllFiles(folder, prefix) {
  const fullPath = prefix ? folder + '/' + prefix : folder
  const all = []
  const { data, error } = await sb.storage.from(BUCKET).list(fullPath, { limit: 1000 })
  if (error) { console.error(`  List error for ${fullPath}:`, error.message); return all }
  for (const item of (data || [])) {
    const itemPath = fullPath + '/' + item.name
    if (item.id) {
      all.push(itemPath)
    } else {
      const sub = await listAllFiles(folder, prefix ? prefix + '/' + item.name : item.name)
      all.push(...sub)
    }
  }
  return all
}

async function copyFile(path) {
  const { data, error } = await sb.storage.from(BUCKET).download(path)
  if (error) throw new Error(error.message)
  const buffer = Buffer.from(await data.arrayBuffer())
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: path,
    Body: buffer,
    ContentType: data.type || 'application/octet-stream'
  }))
}

function newUrl(path) {
  return R2_WORKER_URL + '/file?path=' + encodeURIComponent(path)
}

function extractPath(fileUrl) {
  if (!fileUrl) return null
  const m = fileUrl.split('/school-files/')[1]
  return m ? m.split('?')[0] : null
}

// ── MAIN ────────────────────────────────────────────────────────

async function main() {
  console.log('=== Step 1: List all files in Supabase Storage ===')
  const allFiles = []
  for (const folder of FOLDERS) {
    process.stdout.write(`  Scanning ${folder}...`)
    const files = await listAllFiles(folder, '')
    allFiles.push(...files)
    console.log(` ${files.length} files`)
  }
  console.log(`Total: ${allFiles.length} files\n`)

  console.log('=== Step 2: Copy files to R2 ===')
  let copied = 0, failed = 0
  for (const path of allFiles) {
    try {
      process.stdout.write(`  ${path}...`)
      await copyFile(path)
      copied++
      console.log(' done')
    } catch (e) {
      failed++
      console.log(` FAILED: ${e.message}`)
    }
  }
  console.log(`\nCopied: ${copied}, Failed: ${failed}\n`)

  console.log('=== Step 3: Update database URLs ===')

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

main().catch(e => { console.error(e); process.exit(1) })
