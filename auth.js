/**
 * auth.js — Shared authentication helper for Shiv Public School Portal
 *
 * Every portal page (main-teacher.html, class-teacher.html, etc.)
 * includes this script BEFORE its own logic. It:
 *   1. Initialises the Supabase client
 *   2. Checks for a valid session on page load
 *   3. Redirects to login.html if no valid session exists
 *   4. Exposes `sb` (Supabase client) and `SPS` (session helpers) globally
 *
 * Usage in each portal HTML file:
 *   <script src="config.js"></script>       ← project URL + anon key
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="auth.js"></script>         ← this file
 *   <script>
 *     // Your portal-specific code here.
 *     // `sb` and `SPS` are available immediately after auth.js loads.
 *     // Wait for SPS.ready() before making DB calls.
 *     SPS.ready().then(() => {
 *       // safe to use SPS.user, SPS.teacher, SPS.portals etc.
 *     })
 *   </script>
 */

;(function() {
  'use strict'

  // ── SUPABASE CLIENT ──────────────────────────────────────────
  // SUPABASE_URL and SUPABASE_ANON must be declared before this script runs.
  // They live in config.js (loaded first).
  window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON)

  // ── SPS NAMESPACE ────────────────────────────────────────────
  // Exposed globally so portal pages can call SPS.user, SPS.teacher, etc.
  window.SPS = {
    user:     null,   // Supabase auth user object
    teacher:  null,   // row from teachers table (null if admin)
    admin:    null,   // row from admins table (null if teacher)
    portals:  [],     // list of portal keys this user can access
    session:  null,   // Supabase session object
    _ready:   null,   // Promise that resolves when auth check is complete
  }

  // ── WHICH PORTAL AM I? ───────────────────────────────────────
  // Each portal page sets window.PORTAL_KEY before auth.js runs,
  // so auth.js can verify the user has access to this specific portal.
  //
  // Allowed values: 'admin' | 'main_teacher' | 'class_teacher' | 'mother_teacher'
  //
  // Example in main-teacher.html:
  //   <script>window.PORTAL_KEY = 'main_teacher'</script>
  //   <script src="config.js"></script>
  //   <script src="auth.js"></script>

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

    // Check admins table
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

    // Check teachers table
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

    // Mother teacher check
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

    // Main teacher (always available for active teachers)
    results.portals.push('main_teacher')

    // Class teacher check
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
  // Called on every portal page load. Verifies the user:
  //   (a) has a valid Supabase Auth session
  //   (b) has access to THIS portal (PORTAL_KEY)
  // Redirects to login.html if either check fails.
  async function checkAccess() {
    const { data: { session } } = await sb.auth.getSession()

    if (!session) {
      redirectToLogin()
      return
    }

    SPS.session = session
    SPS.user = session.user

    // Try local cache first to avoid extra DB round trip
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

    // Verify this user can actually access THIS portal
    const key = window.PORTAL_KEY
    if (key && !SPS.portals.includes(key)) {
      // Has a session but not for this portal — redirect to login
      // (they may have navigated to the wrong URL directly)
      redirectToLogin('access')
      return
    }

    // All good — resolve the ready promise
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
  // Portal pages await SPS.ready() before rendering data.
  // This promise resolves once checkAccess() completes successfully.
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
