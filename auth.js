/**
 * auth.js — Shared authentication helper for Shiv Public School Portal
 *
 * Every portal page (main-teacher.html, class-teacher.html, etc.)
 * includes this script BEFORE its own logic. It:
 *   1. Initialises the Supabase client
 *   2. Checks for a valid session on page load
 *   3. Redirects to login.html if no valid session exists
 *   4. Exposes `sb` (Supabase client) and `SPS` (session helpers) globally
 */

;(function() {
  'use strict'
  // ── SUPABASE CLIENT ──────────────────────────────────────────
  // FIX: custom no-op `lock` bypasses navigator.locks.
  // supabase-js v2 wraps auth calls in a browser LockManager lock; on repeat
  // visits (expired token being auto-refreshed, or a zombie tab holding the
  // lock) getSession() waits on that lock forever → page stuck on "Loading…".
  // Bypassing the lock removes the deadlock. Safe for this app.
  // FIX: A no-op lock removed the cross-tab coordination that supabase-js uses
  // to serialize token refreshes. Without it, two refreshes (e.g. autoRefresh +
  // a query, or two tabs) can run at once; with refresh-token rotation the
  // second uses an already-rotated token, the refresh fails, and the session is
  // cleared → the user is silently logged out. This bounded lock restores that
  // serialization but never blocks forever: if the lock can't be acquired
  // quickly it just runs unlocked (which is what avoided the original deadlock).
  window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      lock: async (name, acquireTimeout, fn) => {
        try {
          if (navigator.locks && navigator.locks.request) {
            const ctrl = new AbortController()
            const ms = acquireTimeout && acquireTimeout > 0 ? acquireTimeout : 5000
            const timer = setTimeout(() => { try { ctrl.abort() } catch (_) {} }, ms)
            try {
              return await navigator.locks.request(name, { signal: ctrl.signal }, async () => {
                clearTimeout(timer); return await fn()
              })
            } catch (_) {
              clearTimeout(timer)
              return await fn()   // timed out / aborted → run unlocked, no deadlock
            }
          }
        } catch (_) {}
        return await fn()
      }
    }
  })
  // Bind a LOCAL reference to the client. Portal pages (teacher.html etc.)
  // declare their own top-level `let sb`, which creates a global lexical
  // binding that shadows window.sb and is `undefined` until their init runs
  // AFTER this code. Referencing bare `sb` here would resolve to that undefined
  // binding → "Cannot read properties of undefined (reading 'from')". Using this
  // local const guarantees every reference below hits the real client.
  const sb = window.sb

  // ── SPS NAMESPACE ────────────────────────────────────────────
  window.SPS = {
    user:     null,
    teacher:  null,
    admin:    null,
    coordinator: null,
    portals:  [],
    session:  null,
    _ready:   null,
  }

  // ── SESSION CACHE ────────────────────────────────────────────
  // Cache is keyed by userId so a different account logging in on the same
  // browser NEVER inherits another user's cached portal list. A previous
  // global (unkeyed) cache caused exactly that: teacher B saw teacher A's
  // cached portals and got wrongly bounced to login.
  function clearAllPortalCache() {
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('sps_user_v2_')) localStorage.removeItem(k)
      })
    } catch (_) {}
  }

  function getLocalUser(userId) {
    try {
      if (!userId) return null
      const ls = localStorage.getItem('sps_user_v2_' + userId)
      if (ls) return JSON.parse(ls)
      // Back-compat: an old unkeyed cache, only trust it if it says which user
      // it belongs to and that matches.
      const legacy = JSON.parse(sessionStorage.getItem('sps_user') || 'null')
      if (legacy && legacy.userId === userId) return legacy
      return null
    } catch { return null }
  }

  // ── CURRENT SESSION ID ───────────────────────────────────────
  let _sessionId = null
  async function getCurrentSessionId() {
    if (_sessionId) return _sessionId
    const { data } = await sb
      .from('sessions')
      .select('session_id')
      .eq('is_current', true)
      .maybeSingle()
    _sessionId = data?.session_id || null
    return _sessionId
  }
  SPS.getSessionId = getCurrentSessionId

  // ── PORTAL DETECTION ─────────────────────────────────────────
  async function detectPortals(userId) {
    const results = { portals: [], teacher: null, admin: null, coordinator: null }

    const { data: adminRow } = await sb
      .from('admins')
      .select('admin_id')
      .eq('auth_user_id', userId)
      .maybeSingle()

    if (adminRow) {
      results.admin = adminRow
      results.portals = ['admin']
      return results
    }

    // Coordinator — a standalone account (may optionally be linked to a teacher).
    // Checked before teacher so a pure coordinator routes to their own portal.
    let coordRow = null
    try {
      const { data } = await sb
        .from('coordinators')
        .select('coordinator_id, name, is_active, teacher_id')
        .eq('auth_user_id', userId)
        .maybeSingle()
      coordRow = data
    } catch (_) { /* table may not exist yet — ignore */ }

    if (coordRow && coordRow.is_active) {
      results.coordinator = coordRow
      results.portals.push('coordinator')
      // If this coordinator is ALSO a teacher, let them switch to teacher views.
      if (coordRow.teacher_id) {
        const { data: tRow } = await sb
          .from('teachers')
          .select('teacher_id, full_name, designation, is_active')
          .eq('teacher_id', coordRow.teacher_id)
          .maybeSingle()
        if (tRow && tRow.is_active) {
          results.teacher = tRow
          results.portals.push('main_teacher')
        }
      }
      return results
    }

    const { data: teacherRow } = await sb
      .from('teachers')
      .select('teacher_id, full_name, designation, is_active')
      .eq('auth_user_id', userId)
      .maybeSingle()

    if (!teacherRow || !teacherRow.is_active) {
      return results
    }
    results.teacher = teacherRow

    const sessionId = await getCurrentSessionId()

    // NOTE: a teacher can hold MULTIPLE mother/class-teacher rows (e.g. class
    // teacher of two sections). .maybeSingle() THROWS on >1 row, which would
    // reject detectPortals and hang the portal on its loading wheel forever
    // (only on cold starts where the sessionStorage cache is gone). Use a
    // limited list + length check instead so multiple rows are fine.
    const { data: motherRows } = await sb
      .from('mother_teacher_map')
      .select('map_id')
      .eq('teacher_id', teacherRow.teacher_id)
      .eq('session_id', sessionId)
      .limit(1)

    if (motherRows && motherRows.length) {
      results.portals = ['mother_teacher']
      return results
    }

    results.portals.push('main_teacher')

    const { data: classRows } = await sb
      .from('class_teacher_map')
      .select('map_id')
      .eq('teacher_id', teacherRow.teacher_id)
      .eq('session_id', sessionId)
      .limit(1)

    if (classRows && classRows.length) results.portals.push('class_teacher')

    return results
  }

  // ── RESILIENT SESSION READ ───────────────────────────────────
  // getSession() can hang on PWA/tab reopen when supabase-js is mid token
  // refresh (the auth lock, even bypassed, races with autoRefreshToken and the
  // INITIAL_SESSION event). To guarantee we never spin forever, we resolve the
  // session from whichever of these wins first:
  //   1. onAuthStateChange INITIAL_SESSION (fires on load with the stored session)
  //   2. getSession() (normal path)
  //   3. a short timeout that reads the persisted token straight from storage
  function readStoredSession() {
    try {
      const ref = (SUPABASE_URL.match(/https:\/\/([^.]+)\./) || [])[1]
      if (!ref) return null
      const raw = localStorage.getItem('sb-' + ref + '-auth-token')
      if (!raw) return null
      let parsed
      try { parsed = JSON.parse(raw) } catch { return null }
      // supabase-js v2 has stored this in a few shapes across versions:
      //   { access_token, refresh_token, user, expires_at, ... }  (flat)
      //   { currentSession: {...}, expiresAt }                    (older)
      //   { session: {...} }                                      (some builds)
      const sess =
        (parsed && parsed.access_token && parsed.user) ? parsed :
        (parsed && parsed.currentSession) ? parsed.currentSession :
        (parsed && parsed.session) ? parsed.session :
        null
      if (sess && sess.access_token && sess.user) return sess
      return null
    } catch { return null }
  }

  function getSessionResilient() {
    return new Promise(resolve => {
      let done = false
      const finish = s => { if (!done) { done = true; resolve(s) } }

      // Match login.html's proven resolver exactly. INITIAL_SESSION fires on
      // load with the stored session; getSession() is the normal path; the
      // timeout reads the persisted token from storage as a last resort.
      const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION') finish(session || readStoredSession())
      })
      sb.auth.getSession().then(({ data }) => finish(data?.session || readStoredSession())).catch(() => {})
      setTimeout(() => { if (!done) finish(readStoredSession()) }, 1500)
      const iv = setInterval(() => { if (done) { clearInterval(iv); try { sub.subscription.unsubscribe() } catch (_) {} } }, 500)
    })
  }

  // ── ACCESS CHECK ─────────────────────────────────────────────
  async function checkAccess() {
   try {
    console.log('[boot] 1 checkAccess start')
    const session = await getSessionResilient()
    console.log('[boot] 2 session resolved:', !!session)

    if (!session) {
      console.log('[boot] no session → login')
      redirectToLogin()
      return
    }

    SPS.session = session
    SPS.user = session.user

    const cached = getLocalUser(session.user.id)
    if (cached && cached.portals) {
      console.log('[boot] 3 using cached portals:', cached.portals)
      SPS.teacher = cached.teacher
      SPS.admin   = cached.admin
      SPS.coordinator = cached.coordinator
      SPS.portals = cached.portals
    } else {
      console.log('[boot] 3 detecting portals…')
      let detected = null
      // detectPortals hits the DB, which browser tracking-prevention (e.g. Edge)
      // can intermittently block, throwing an opaque error. Retry once before
      // giving up rather than bouncing the user to login.
      try {
        detected = await detectPortals(session.user.id)
      } catch (e1) {
        console.warn('[boot] detectPortals failed once, retrying…', e1)
        await new Promise(r => setTimeout(r, 600))
        detected = await detectPortals(session.user.id)  // if this throws, outer catch handles it
      }
      console.log('[boot] 3b detected:', detected.portals)
      SPS.teacher = detected.teacher
      SPS.admin   = detected.admin
      SPS.coordinator = detected.coordinator
      SPS.portals = detected.portals
      const payload = JSON.stringify({
        userId:  session.user.id,
        teacher: SPS.teacher,
        admin:   SPS.admin,
        coordinator: SPS.coordinator,
        portals: SPS.portals,
      })
      // Persist to BOTH: localStorage is shared across tabs (so a new tab skips
      // detectPortals entirely), sessionStorage kept for back-compat. Keyed by
      // userId so a different account never inherits this cache.
      try { localStorage.setItem('sps_user_v2_' + session.user.id, payload) } catch (_) {}
      try { sessionStorage.setItem('sps_user', payload) } catch (_) {}
    }

    const key = window.PORTAL_KEY
    console.log('[boot] 4 PORTAL_KEY:', key, 'portals:', SPS.portals)
    if (key && !SPS.portals.includes(key)) {
      console.log('[boot] key not in portals → access redirect')
      redirectToLogin('access')
      return
    }

    console.log('[boot] 5 resolving ready()')
    SPS._booted = true
    SPS._resolveReady()
    console.log('[boot] 6 ready resolved ✓')
    setupRefreshSignal()
   } catch (e) {
    console.error('[auth] checkAccess failed:', e)
    // If we still have a valid session AND a cached portal list, the failure
    // was almost certainly a blocked/transient DB call (e.g. Edge tracking
    // prevention) — NOT a real auth problem. Boot from cache instead of
    // bouncing to login (which would just hit the same block).
    const cachedFallback = getLocalUser(SPS.session?.user?.id)
    if (SPS.session && cachedFallback && cachedFallback.portals) {
      console.warn('[auth] booting from cached portals after detect failure')
      SPS.teacher = cachedFallback.teacher
      SPS.admin   = cachedFallback.admin
      SPS.coordinator = cachedFallback.coordinator
      SPS.portals = cachedFallback.portals
      const key = window.PORTAL_KEY
      if (key && !SPS.portals.includes(key)) { redirectToLogin('access'); return }
      SPS._booted = true
      SPS._resolveReady()
      return
    }
    // No session or no cache — genuinely can't proceed.
    try { sessionStorage.removeItem('sps_user') } catch (_) {}
    redirectToLogin()
   }
  }

  // ── REDIRECT ─────────────────────────────────────────────────
  function redirectToLogin(reason) {
    const url = reason
      ? `login.html?reason=${reason}`
      : 'login.html'
    window.location.replace(url)
  }

  // ── "REFRESH ALL" SIGNAL ─────────────────────────────────────
  // Reloads the portal when admin bumps the `refresh_all` row. Handles three cases:
  //   • open + connected  → realtime event fires, reload
  //   • backgrounded tab  → realtime missed; re-check when tab becomes visible
  //   • closed/reopened   → catch-up check on boot vs a persisted "last seen" value
  // A reload re-reads the saved session, so nobody is logged out.
  const REFRESH_SEEN_KEY = 'sps_refresh_seen'
  const getRefreshSeen = () => { try { return parseInt(localStorage.getItem(REFRESH_SEEN_KEY) || '0') || 0 } catch (_) { return 0 } }
  const setRefreshSeen = (v) => { try { localStorage.setItem(REFRESH_SEEN_KEY, String(v)) } catch (_) {} }

  async function fetchRefreshTs() {
    try {
      const { data } = await sb.from('app_signals').select('bumped_at').eq('key', 'refresh_all').maybeSingle()
      return data?.bumped_at ? new Date(data.bumped_at).getTime() : 0
    } catch (_) { return 0 }
  }

  async function setupRefreshSignal() {
    try {
      const baseline = await fetchRefreshTs()
      window.__refreshBaseline = baseline
      const seen = getRefreshSeen()
      // Catch-up: a refresh was requested while this device was closed/backgrounded.
      // (First run ever, seen===0, just records the baseline — no reload.)
      if (baseline > 0 && seen > 0 && baseline > seen) {
        setRefreshSeen(baseline)
        try { location.reload() } catch (_) {}
        return
      }
      setRefreshSeen(baseline)

      // Live listener for portals that are open and connected.
      sb.channel('app_signals_refresh')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_signals', filter: 'key=eq.refresh_all' }, (payload) => {
          const nv = payload.new?.bumped_at ? new Date(payload.new.bumped_at).getTime() : 0
          if (nv && nv > (window.__refreshBaseline || 0)) {
            window.__refreshBaseline = nv; setRefreshSeen(nv)
            try { location.reload() } catch (_) {}
          }
        })
        .subscribe()

      // Backgrounded → foregrounded: the realtime event is often missed while the
      // tab is suspended (esp. on mobile), so re-check on becoming visible.
      if (!window.__refreshVisBound) {
        window.__refreshVisBound = true
        document.addEventListener('visibilitychange', async () => {
          if (document.visibilityState !== 'visible') return
          const nv = await fetchRefreshTs()
          if (nv && nv > (window.__refreshBaseline || 0)) {
            window.__refreshBaseline = nv; setRefreshSeen(nv)
            try { location.reload() } catch (_) {}
          }
        })
      }
    } catch (_) {}
  }

  // Admin calls this to push a reload to every open portal. Sets our own baseline
  // + seen first so the admin page itself doesn't reload out from under the click.
  SPS.refreshAllPortals = async function(note) {
    const nowIso = new Date().toISOString()
    const ts = new Date(nowIso).getTime()
    window.__refreshBaseline = ts; setRefreshSeen(ts)
    const { error } = await sb.from('app_signals').upsert(
      { key: 'refresh_all', bumped_at: nowIso, note: note || null },
      { onConflict: 'key' }
    )
    return !error
  }

  // ── SIGN OUT ─────────────────────────────────────────────────
  SPS.signOut = async function() {
    // scope:'local' signs out ONLY this device. The default ('global') revokes
    // the refresh token everywhere, which was logging the user out on their
    // other logged-in devices too.
    try { await sb.auth.signOut({ scope: 'local' }) } catch (_) { try { await sb.auth.signOut() } catch (_) {} }
    sessionStorage.removeItem('sps_user')
    clearAllPortalCache()
    redirectToLogin()
  }

  // ── READY PROMISE ────────────────────────────────────────────
  SPS._booted = false
  SPS._resolveReady = null
  SPS._ready = new Promise(resolve => {
    SPS._resolveReady = resolve
  })
  SPS.ready = () => SPS._ready
SPS.serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhZmlnb2hwaGNlZ252dmNvamJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjkxMzI4OSwiZXhwIjoyMDk4NDg5Mjg5fQ.vVrXctA7VIInyTdpSq0xq8yrFMfr9lksRgDERg3HMHA'
SPS.supabaseUrl = 'https://aafigohphcegnvvcojby.supabase.co'

  // ── HELPERS PORTALS CAN USE ──────────────────────────────────
  SPS.isAdmin        = () => SPS.portals.includes('admin')
  SPS.isTeacher      = () => !!SPS.teacher
  SPS.teacherId      = () => SPS.teacher?.teacher_id || null
  SPS.teacherName    = () => SPS.teacher?.full_name || ''
  SPS.initials       = (name = SPS.teacherName()) =>
    name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()

  // ── LISTEN FOR SIGN OUT FROM ANOTHER TAB ─────────────────────
  // Guard: ignore auth events until the initial checkAccess() has resolved.
  // On a fresh tab, supabase-js can emit a transient SIGNED_OUT during initial
  // hydration/refresh; acting on it would wrongly redirect a logged-in user to
  // login. We only honor a SIGNED_OUT that happens AFTER we've booted.
  sb.auth.onAuthStateChange((event, session) => {
    console.log('[auth-event]', event, 'booted=', SPS._booted, 'hasSession=', !!session)
    if (event === 'SIGNED_OUT') {
      // Only a real sign-out clears local state and redirects. During initial
      // boot, or if the token is still in storage, ignore it.
      if (!SPS._booted) { console.log('[auth-event] ignoring pre-boot SIGNED_OUT'); return }
      if (readStoredSession()) { console.log('[auth-event] ignoring SIGNED_OUT — token still in storage'); return }
      sessionStorage.removeItem('sps_user')
      clearAllPortalCache()
      redirectToLogin()
    }
  })

  // ── RUN CHECK ────────────────────────────────────────────────
  checkAccess()

})()
