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
  // FIX (v2): a fully no-op lock let getSession() and the background
  // auto-refresh race each other — on repeat visits the refresh could fail
  // (already-rotated refresh token) and fire SIGNED_OUT before getSession()
  // even resolved, causing an instant bounce back to login.html.
  // This version keeps real serialization (so refresh and getSession queue
  // properly, like navigator.locks normally does) but adds a hard timeout so
  // a genuinely stuck/zombie lock can never hang the page forever.
  let _lockChain = Promise.resolve()
  window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      lock: async (_name, acquireTimeout, fn) => {
        const run = _lockChain.then(() => fn())
        // Keep the chain alive even if this call fails, so future calls aren't blocked
        _lockChain = run.catch(() => {})
        const timeoutMs = (acquireTimeout && acquireTimeout > 0) ? acquireTimeout : 8000
        return Promise.race([
          run,
          new Promise((_, reject) => setTimeout(() => reject(new Error('SPS auth lock timeout')), timeoutMs))
        ])
      }
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

    const { data: motherRow } = await sb
      .from('mother_teacher_map')
      .select('map_id')
      .eq('teacher_id', teacherRow.teacher_id)
      .eq('session_id', sessionId)
      .maybeSingle()

    if (motherRow) {
      results.portals = ['mother_teacher']
      return results
    }

    results.portals.push('main_teacher')

    const { data: classRow } = await sb
      .from('class_teacher_map')
      .select('map_id')
      .eq('teacher_id', teacherRow.teacher_id)
      .eq('session_id', sessionId)
      .maybeSingle()

    if (classRow) results.portals.push('class_teacher')

    return results
  }

  // ── ACCESS CHECK ─────────────────────────────────────────────
  let _initDone = false
  async function checkAccess() {
    try {
      const { data: { session }, error } = await sb.auth.getSession()

      if (error) {
        console.warn('[SPS] getSession() error:', error.message)
        redirectToLogin()
        return
      }

      if (!session) {
        console.warn('[SPS] No session found on init — redirecting to login')
        redirectToLogin()
        return
      }

      SPS.session = session
      SPS.user = session.user

      const cached = getLocalUser()
      if (cached && cached.portals) {
        SPS.teacher = cached.teacher
        SPS.admin   = cached.admin
        SPS.portals = cached.portals
      } else {
        const detected = await detectPortals(session.user.id)
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
      if (key && !SPS.portals.includes(key)) {
        console.warn('[SPS] Session valid but lacks portal access for:', key)
        redirectToLogin('access')
        return
      }

      _initDone = true
      SPS._resolveReady()
    } catch (err) {
      // Covers our new lock timeout, network failures, etc.
      // Without this catch, SPS.ready() would hang forever and only the
      // 12s watchdog in the page itself would eventually recover.
      console.error('[SPS] checkAccess() failed:', err.message || err)
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
  // IMPORTANT: supabase-js can emit a SIGNED_OUT event during the initial
  // session-restore/refresh attempt on page load (e.g. an expired refresh
  // token failing to renew) — not just on a real, intentional logout.
  // Reacting to that instantly, before checkAccess() has finished its own
  // getSession() call, is what caused the "loads then immediately bounces
  // back to login" behavior. We only treat SIGNED_OUT as a real logout once
  // our own init has completed successfully at least once.
  sb.auth.onAuthStateChange((event) => {
    console.log('[SPS] auth event:', event, '(init done:', _initDone, ')')
    if (event === 'SIGNED_OUT' && _initDone) {
      sessionStorage.removeItem('sps_user')
      redirectToLogin()
    }
  })

  // ── RUN CHECK ────────────────────────────────────────────────
  checkAccess()

})()
