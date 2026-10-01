#!/usr/bin/env node
/**
 * cleanup-supabase.js — Delete all files from Supabase Storage bucket
 *
 * Uses the Supabase JS client (Storage API) so it bypasses the SQL restriction.
 *
 * Usage:
 *   Set SUPABASE_URL and SUPABASE_SERVICE_KEY, then:
 *   node cleanup-supabase.js
 */

import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const BUCKET = 'school-files'

async function listAll(folder, prefix) {
  const fullPath = prefix ? folder + '/' + prefix : folder
  const all = []
  const { data, error } = await sb.storage.from(BUCKET).list(fullPath, { limit: 200 })
  if (error) { console.error('  List error:', fullPath, error.message); return all }
  for (const item of (data || [])) {
    const itemPath = fullPath + '/' + item.name
    if (item.id) {
      all.push(itemPath)
    } else {
      const sub = await listAll(folder, prefix ? prefix + '/' + item.name : item.name)
      all.push(...sub)
    }
  }
  return all
}

async function main() {
  const folders = ['student-photos', 'student-docs', 'students', 'question-papers']

  for (const folder of folders) {
    console.log('Scanning ' + folder + '...')
    const files = await listAll(folder, '')
    console.log('  Found ' + files.length + ' files')

    // Delete in batches of 20 with a small delay to avoid rate limiting
    for (let i = 0; i < files.length; i += 20) {
      const batch = files.slice(i, i + 20)
      const { error } = await sb.storage.from(BUCKET).remove(batch)
      if (error) {
        console.error('  Delete error at batch ' + i + ':', error.message)
      } else {
        console.log('  Deleted ' + (i + batch.length) + '/' + files.length)
      }
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500))
    }
  }

  console.log('\nAll files deleted. You can now delete the empty bucket from the Dashboard.')
}

main().catch(e => { console.error(e); process.exit(1) })
