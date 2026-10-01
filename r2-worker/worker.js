/**
 * sps-r2-worker — Cloudflare Worker for SPS Portal file storage
 *
 * Deploy with: npx wrangler deploy
 *
 * Required wrangler.toml bindings:
 *   [[r2_buckets]]
 *   binding = "BUCKET"
 *   bucket_name = "school-files"
 *
 * Environment variables (set via wrangler secret put):
 *   SUPABASE_URL       — Supabase project URL (e.g. https://xxx.supabase.co)
 *   SUPABASE_ANON_KEY  — Supabase anon/public key (Dashboard → Settings → API)
 *   ALLOWED_ORIGIN     — portal origin (e.g. https://spsrsecschool-lab.github.io)
 *
 * The bucket stays PRIVATE. Files are served through GET /file?path=...
 * (no auth required — anyone with the URL can view, same as Supabase public buckets).
 * Upload, delete and list require a valid Supabase JWT.
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const cors = corsHeaders(env, origin)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    const url = new URL(request.url)

    // ── Serve file (public, no auth) ────────────────────────────
    if (url.pathname === '/file' && request.method === 'GET') {
      const key = url.searchParams.get('path')
      if (!key) return new Response('Missing path', { status: 400, headers: cors })
      const obj = await env.BUCKET.get(key)
      if (!obj) return new Response('Not found', { status: 404, headers: cors })
      return new Response(obj.body, {
        headers: {
          ...cors,
          'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
    }

    // ── Auth required for everything below ──────────────────────
    const auth = request.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) {
      return resp({ error: 'Missing authorization' }, 401, cors)
    }
    const valid = await verifyJWT(auth.slice(7), env)
    if (!valid) {
      return resp({ error: 'Invalid or expired token' }, 403, cors)
    }

    // ── Upload ──────────────────────────────────────────────────
    if (url.pathname === '/upload' && request.method === 'PUT') {
      const key = url.searchParams.get('path')
      if (!key) return resp({ error: 'Missing path parameter' }, 400, cors)
      await env.BUCKET.put(key, request.body, {
        httpMetadata: {
          contentType: request.headers.get('Content-Type') || 'application/octet-stream'
        }
      })
      return resp({ ok: true }, 200, cors)
    }

    // ── Delete ──────────────────────────────────────────────────
    if (url.pathname === '/delete' && request.method === 'POST') {
      const body = await request.json()
      const paths = body?.paths
      if (Array.isArray(paths) && paths.length) {
        await Promise.all(paths.map(p => env.BUCKET.delete(p)))
      }
      return resp({ ok: true }, 200, cors)
    }

    // ── List ────────────────────────────────────────────────────
    if (url.pathname === '/list' && request.method === 'GET') {
      const prefix = url.searchParams.get('prefix') || ''
      const search = url.searchParams.get('search') || ''
      const fullPrefix = prefix.endsWith('/') ? prefix : prefix + '/'
      const listed = await env.BUCKET.list({ prefix: fullPrefix, limit: 1000 })
      let items = (listed.objects || []).map(o => ({
        name: o.key.split('/').pop(),
        key: o.key,
        size: o.size
      }))
      if (search) {
        items = items.filter(i => i.name.includes(search))
      }
      return resp(items, 200, cors)
    }

    return resp({ error: 'Not found' }, 404, cors)
  }
}

function corsHeaders(env, origin) {
  const allowed = env.ALLOWED_ORIGIN || '*'
  return {
    'Access-Control-Allow-Origin': allowed === '*' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400'
  }
}

function resp(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  })
}

async function verifyJWT(token, env) {
  if (!env.SUPABASE_URL) return true
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return false
    const res = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
      headers: {
        'Authorization': 'Bearer ' + token,
        'apikey': env.SUPABASE_ANON_KEY
      }
    })
    return res.ok
  } catch (_) { return false }
}
