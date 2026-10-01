#!/usr/bin/env node
/**
 * cleanup-supabase.js — Delete all files from Supabase Storage bucket
 *
 * Scans the entire bucket (all folders), paginates properly,
 * and deletes in small batches with retries.
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

async function listAll(path) {
  const all = []
  let offset = 0
  while (true) {
    const { data, error } = await sb.storage.from(BUCKET).list(path || '', { limit: 100, offset })
    if (error) { console.error('  List error:', path || '(root)', error.message); break }
    if (!data || data.length === 0) break
    for (const item of data) {
      const itemPath = path ? path + '/' + item.name : item.name
      if (item.id) {
        all.push(itemPath)
      } else {
        const sub = await listAll(itemPath)
        all.push(...sub)
      }
    }
    if (data.length < 100) break
    offset += data.length
  }
  return all
}

async function main() {
  console.log('Scanning entire bucket...')
  const files = await listAll('')
  console.log('Found ' + files.length + ' total files\n')

  if (files.length === 0) {
    console.log('Bucket is already empty!')
    return
  }

  let deleted = 0
  for (let i = 0; i < files.length; i += 10) {
    const batch = files.slice(i, i + 10)
    const { error } = await sb.storage.from(BUCKET).remove(batch)
    if (error) {
      console.error('  Delete error:', error.message, '- retrying in 3s...')
      await new Promise(r => setTimeout(r, 3000))
      const { error: e2 } = await sb.storage.from(BUCKET).remove(batch)
      if (e2) console.error('  Retry failed:', e2.message)
      else deleted += batch.length
    } else {
      deleted += batch.length
    }
    console.log('  Deleted ' + deleted + '/' + files.length)
    await new Promise(r => setTimeout(r, 300))
  }

  console.log('\nDone. Deleted ' + deleted + ' files.')
  console.log('You can now delete the empty bucket from the Dashboard.')
}

main().catch(e => { console.error(e); process.exit(1) })
