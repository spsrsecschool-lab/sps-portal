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
  window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      // Auto-refresh is DISABLED at construction. On PWA/tab reopen, an eager
      // background token refresh races the initial getSession() and deadlocks
      // the auth machinery → portal hangs on "checking session". We validate
      // the stored session first (synchronously, no network), resolve the app,
      // THEN start auto-refresh manually in the background. See checkAccess().
      autoRefreshToken: false,
      detectSessionInUrl: false,
      lock: async (_name, _acquireTimeout, fn) => await fn()
    }
  })

  // ── SPS NAMESPACE ────────────────────────────────────────────
  window.SPS = {
    user:     null,
    teacher:  null,
    admin:    null,
    portals:  [],
    session:  null,
    _ready:   null,
  }

  // ── SESSION CACHE ────────────────────────────────────────────
  function getLocalUser() {
    try {
      return JSON.parse(sessionStorage.getItem('sps_user') || 'null')
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
    const results = { portals: [], teacher: null, admin: null }

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
      // FAST PATH: the persisted token lives in localStorage and survives tab/
      // PWA reopen. Read it synchronously first. If it's present and not
      // expired, use it immediately — this avoids the race where getSession()
      // or an INITIAL_SESSION(null) event resolves before the session is ready
      // and wrongly bounces us to login.
      const stored = readStoredSession()
      if (stored) {
        const exp = stored.expires_at ? stored.expires_at * 1000 : 0
        // If still valid (or no expiry info), trust it now.
        if (!exp || exp > Date.now()) { resolve(stored); return }
        // Expired: let supabase refresh it below, but still don't hang.
      }

      let done = false
      const finish = s => { if (!done) { done = true; resolve(s) } }

      // Only treat a NON-null session from these as authoritative — a null from
      // an early event/getSession must not trigger a login redirect while the
      // token might still be loading/refreshing.
      const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
        if (session) finish(session)
        else if (event === 'SIGNED_OUT') finish(null)
      })

      sb.auth.getSession()
        .then(({ data }) => { if (data?.session) finish(data.session) })
        .catch(() => {})

      // Final fallback: after a grace period, resolve to whatever storage has
      // (possibly null → login). Longer than before so a slow refresh completes.
      setTimeout(() => { if (!done) finish(readStoredSession()) }, 3000)

      Promise.resolve().then(() => {
        const iv = setInterval(() => {
          if (done) { clearInterval(iv); try { sub.subscription.unsubscribe() } catch (_) {} }
        }, 500)
      })
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

    const cached = getLocalUser()
    if (cached && cached.portals) {
      console.log('[boot] 3 using cached portals:', cached.portals)
      SPS.teacher = cached.teacher
      SPS.admin   = cached.admin
      SPS.portals = cached.portals
    } else {
      console.log('[boot] 3 detecting portals…')
      const detected = await detectPortals(session.user.id)
      console.log('[boot] 3b detected:', detected.portals)
      SPS.teacher = detected.teacher
      SPS.admin   = detected.admin
      SPS.portals = detected.portals
      sessionStorage.setItem('sps_user', JSON.stringify({
        teacher: SPS.teacher,
        admin:   SPS.admin,
        portals: SPS.portals,
      }))
    }

    const key = window.PORTAL_KEY
    console.log('[boot] 4 PORTAL_KEY:', key, 'portals:', SPS.portals)
    if (key && !SPS.portals.includes(key)) {
      console.log('[boot] key not in portals → access redirect')
      redirectToLogin('access')
      return
    }

    console.log('[boot] 5 resolving ready()')
    SPS._resolveReady()

    // NOW that the app is unblocked, start token auto-refresh in the background.
    // Doing this AFTER resolve means a refresh can never stall the initial gate.
    try {
      if (sb.auth.startAutoRefresh) sb.auth.startAutoRefresh()
      // Nudge a refresh if the stored token is close to expiry, but don't await
      // it — the app is already running on the current (still-valid) token.
      const exp = session.expires_at ? session.expires_at * 1000 : 0
      if (exp && exp - Date.now() < 120000) {
        sb.auth.refreshSession().catch(() => {})
      }
    } catch (_) {}
    console.log('[boot] 6 ready resolved ✓')
   } catch (e) {
    // Never leave the portal hanging on its loading wheel. If session/portal
    // resolution fails (e.g. a transient network error on cold start), clear
    // the cache and send the user back to login rather than spinning forever.
    console.error('[auth] checkAccess failed:', e)
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

  // ── SIGN OUT ─────────────────────────────────────────────────
  SPS.signOut = async function() {
    await sb.auth.signOut()
    sessionStorage.removeItem('sps_user')
    redirectToLogin()
  }

  // ── READY PROMISE ────────────────────────────────────────────
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
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      sessionStorage.removeItem('sps_user')
      redirectToLogin()
    }
  })

  // ── RUN CHECK ────────────────────────────────────────────────
  checkAccess()

})()
