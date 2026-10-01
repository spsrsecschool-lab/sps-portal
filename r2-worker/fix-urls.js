#!/usr/bin/env node
/**
 * fix-urls.js — Update all Supabase Storage URLs in the database to R2 Worker URLs
 *
 * Usage:
 *   Set the same env vars as migrate.js, then:
 *   node fix-urls.js
 */

import { createClient } from '@supabase/supabase-js'

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  R2_WORKER_URL
} = process.env

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}
if (!R2_WORKER_URL) {
  console.error('Missing R2_WORKER_URL')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

function newUrl(path) {
  return R2_WORKER_URL + '/file?path=' + encodeURIComponent(path)
}

function extractPath(fileUrl) {
  if (!fileUrl) return null
  const m = fileUrl.split('/school-files/')[1]
  return m ? m.split('?')[0] : null
}

async function main() {
  console.log('=== Updating database URLs from Supabase to R2 ===\n')

  // 1. students.photo_url
  const { data: students } = await sb.from('students').select('student_id, photo_url').not('photo_url', 'is', null)
  let updatedPhotos = 0
  for (const s of (students || [])) {
    if (!s.photo_url || s.photo_url.includes(R2_WORKER_URL)) continue
    const path = extractPath(s.photo_url)
    if (!path) { console.log('  Skipped (no path):', s.photo_url); continue }
    const { error } = await sb.from('students').update({ photo_url: newUrl(path) }).eq('student_id', s.student_id)
    if (error) { console.log('  Error updating student', s.student_id, error.message) }
    else updatedPhotos++
  }
  console.log(`Updated ${updatedPhotos} student photo URLs`)

  // 2. student_documents.file_url
  const { data: docs } = await sb.from('student_documents').select('id, file_url').not('file_url', 'is', null)
  let updatedDocs = 0
  for (const d of (docs || [])) {
    if (!d.file_url || d.file_url.includes(R2_WORKER_URL)) continue
    const path = extractPath(d.file_url)
    if (!path) { console.log('  Skipped (no path):', d.file_url); continue }
    const { error } = await sb.from('student_documents').update({ file_url: newUrl(path) }).eq('id', d.id)
    if (error) { console.log('  Error updating doc', d.id, error.message) }
    else updatedDocs++
  }
  console.log(`Updated ${updatedDocs} student document URLs`)

  // 3. question_papers content image URLs
  const { data: papers } = await sb.from('question_papers').select('paper_id, content')
  let updatedPapers = 0
  for (const p of (papers || [])) {
    if (!p.content) continue
    let json = JSON.stringify(p.content)
    if (!json.includes('/school-files/')) continue
    json = json.replace(/https?:\/\/[^"]*\/school-files\/([^"?]+)(\?[^"]*)?/g, (_, path) => newUrl(path))
    const { error } = await sb.from('question_papers').update({ content: JSON.parse(json) }).eq('paper_id', p.paper_id)
    if (error) { console.log('  Error updating paper', p.paper_id, error.message) }
    else updatedPapers++
  }
  console.log(`Updated ${updatedPapers} question paper image URLs`)

  console.log('\n=== Done ===')
}

main().catch(e => { console.error(e); process.exit(1) })
