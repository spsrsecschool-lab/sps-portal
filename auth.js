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
  // Bypassing the lock removes the deadlock. This is the workaround
  // recommended by Supabase maintainers for this known issue.
  window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      lock: async (_name, _acquireTimeout, fn) => await fn()
    }
  })

  // Capture a local reference to avoid shadowing conflicts from global variables (like `let sb` in portal scripts)
  const sb = window.sb

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
    try {
      const { data, error } = await sb
        .from('sessions')
        .select('session_id')
        .eq('is_current', true)
        .maybeSingle()
      if (error) {
        console.warn("Could not query session ID:", error)
        return null
      }
      _sessionId = data?.session_id || null
    } catch (e) {
      console.error("Exception in getCurrentSessionId:", e)
      _sessionId = null
    }
    return _sessionId
  }
  SPS.getSessionId = getCurrentSessionId

  // ── PORTAL DETECTION ─────────────────────────────────────────
  async function detectPortals(userId) {
    const results = { portals: [], teacher: null, admin: null }

    try {
      const { data: adminRow, error: adminErr } = await sb
        .from('admins')
        .select('admin_id')
        .eq('auth_user_id', userId)
        .maybeSingle()

      if (adminErr) console.warn("Admin check error:", adminErr)

      if (adminRow) {
        results.admin = adminRow
        results.portals = ['admin']
        return results
      }

      const { data: teacherRow, error: teachErr } = await sb
        .from('teachers')
        .select('teacher_id, full_name, designation, is_active')
        .eq('auth_user_id', userId)
        .maybeSingle()

      if (teachErr) console.warn("Teacher check error:", teachErr)

      if (!teacherRow || !teacherRow.is_active) {
        return results
      }
      results.teacher = teacherRow

      const sessionId = await getCurrentSessionId()
      
      // Prevent querying subsequent mappings if session is not found
      if (!sessionId) {
        results.portals = ['main_teacher']
        return results
      }

      const { data: motherRow, error: mothErr } = await sb
        .from('mother_teacher_map')
        .select('map_id')
        .eq('teacher_id', teacherRow.teacher_id)
        .eq('session_id', sessionId)
        .maybeSingle()

      if (mothErr) console.warn("Mother teacher map error:", mothErr)

      if (motherRow) {
        results.portals = ['mother_teacher']
        return results
      }

      results.portals.push('main_teacher')

      const { data: classRow, error: classErr } = await sb
        .from('class_teacher_map')
        .select('map_id')
        .eq('teacher_id', teacherRow.teacher_id)
        .eq('session_id', sessionId)
        .maybeSingle()

      if (classErr) console.warn("Class teacher map error:", classErr)

      if (classRow) results.portals.push('class_teacher')
    } catch (e) {
      console.error("Exception in portal detection:", e)
    }

    return results
  }

  // ── ACCESS CHECK ─────────────────────────────────────────────
  async function checkAccess() {
    let { data: { session }, error } = await sb.auth.getSession()

    // FIX: if getSession() comes back empty or errored, don't immediately
    // assume the user is logged out. On some repeat visits this can happen
    // transiently (e.g. a background token refresh mid-flight). Retry via
    // getUser(), which re-validates directly against the Supabase server,
    // before giving up and sending the person to the login screen.
    if (error || !session) {
      const { data: { user }, error: userErr } = await sb.auth.getUser()
      if (userErr || !user) {
        redirectToLogin()
        return
      }
      const retry = await sb.auth.getSession()
      session = retry.data.session
      if (!session) {
        redirectToLogin()
        return
      }
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
      redirectToLogin('access')
      return
    }

    SPS._resolveReady()
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
