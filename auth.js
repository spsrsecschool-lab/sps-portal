/**
 * auth.js — Shared authentication helper for Shiv Public School Portal
 */

;(function() {
  'use strict'

  window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON)

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
    try { return JSON.parse(sessionStorage.getItem('sps_user') || 'null') }
    catch { return null }
  }
  function clearCache() {
    sessionStorage.removeItem('sps_user')
    // Clear stale Supabase localStorage tokens
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('sb-') && (k.includes('-auth-token') || k.includes('-code-verifier'))) {
        // Leave tokens — Supabase manages them. Only clear SPS cache.
      }
    })
  }

  // ── CURRENT SESSION ID ───────────────────────────────────────
  let _sessionId = null
  async function getCurrentSessionId() {
    if (_sessionId) return _sessionId
    const { data } = await sb.from('sessions').select('session_id').eq('is_current', true).maybeSingle()
    _sessionId = data?.session_id || null
    return _sessionId
  }
  SPS.getSessionId = getCurrentSessionId

  // ── PORTAL DETECTION ─────────────────────────────────────────
  async function detectPortals(userId) {
    const results = { portals: [], teacher: null, admin: null }
    const { data: adminRow } = await sb.from('admins').select('admin_id').eq('auth_user_id', userId).maybeSingle()
    if (adminRow) { results.admin = adminRow; results.portals = ['admin']; return results }
    const { data: teacherRow } = await sb.from('teachers').select('teacher_id, full_name, designation, is_active').eq('auth_user_id', userId).maybeSingle()
    if (!teacherRow || !teacherRow.is_active) return results
    results.teacher = teacherRow
    const sessionId = await getCurrentSessionId()
    const { data: motherRow } = await sb.from('mother_teacher_map').select('map_id').eq('teacher_id', teacherRow.teacher_id).eq('session_id', sessionId).maybeSingle()
    if (motherRow) { results.portals = ['mother_teacher']; return results }
    results.portals.push('main_teacher')
    const { data: classRow } = await sb.from('class_teacher_map').select('map_id').eq('teacher_id', teacherRow.teacher_id).eq('session_id', sessionId).maybeSingle()
    if (classRow) results.portals.push('class_teacher')
    return results
  }

  // ── ACCESS CHECK ─────────────────────────────────────────────
  async function checkAccess() {
    try {
      // Always get a fresh session — never trust cache alone
      const { data: { session }, error: sessErr } = await sb.auth.getSession()

      if (sessErr || !session) {
        clearCache()
        redirectToLogin()
        return
      }

      // Validate session is not expired
      const expiry = session.expires_at ? session.expires_at * 1000 : 0
      if (expiry && Date.now() > expiry - 30000) {
        // Token expiring soon — force refresh
        const { data: refreshed, error: rErr } = await sb.auth.refreshSession()
        if (rErr || !refreshed.session) {
          clearCache()
          redirectToLogin()
          return
        }
        SPS.session = refreshed.session
        SPS.user = refreshed.session.user
      } else {
        SPS.session = session
        SPS.user = session.user
      }

      // Check sessionStorage cache — but VALIDATE it matches current user
      const cached = getLocalUser()
      const cacheValid = cached && cached.portals && cached.userId === SPS.user.id

      if (cacheValid) {
        SPS.teacher = cached.teacher
        SPS.admin   = cached.admin
        SPS.portals = cached.portals
      } else {
        // Cache missing, stale, or belongs to different user — re-detect
        clearCache()
        const detected = await detectPortals(SPS.user.id)
        SPS.teacher = detected.teacher
        SPS.admin   = detected.admin
        SPS.portals = detected.portals
        sessionStorage.setItem('sps_user', JSON.stringify({
          userId:  SPS.user.id,   // <-- store userId so we can validate later
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

    } catch (err) {
      console.error('[auth.js] checkAccess error:', err)
      clearCache()
      redirectToLogin()
    }
  }

  // ── REDIRECT ─────────────────────────────────────────────────
  function redirectToLogin(reason) {
    window.location.replace(reason ? `login.html?reason=${reason}` : 'login.html')
  }

  // ── SIGN OUT ─────────────────────────────────────────────────
  SPS.signOut = async function() {
    await sb.auth.signOut()
    clearCache()
    redirectToLogin()
  }

  // ── READY PROMISE ────────────────────────────────────────────
  SPS._resolveReady = null
  SPS._ready = new Promise(resolve => { SPS._resolveReady = resolve })
  SPS.ready = () => SPS._ready

  // ── HELPERS ──────────────────────────────────────────────────
  SPS.isAdmin   = () => SPS.portals.includes('admin')
  SPS.isTeacher = () => !!SPS.teacher
  SPS.teacherId = () => SPS.teacher?.teacher_id || null
  SPS.teacherName = () => SPS.teacher?.full_name || ''
  SPS.initials  = (name = SPS.teacherName()) =>
    name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()

  // ── SIGN OUT FROM ANOTHER TAB ────────────────────────────────
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') { clearCache(); redirectToLogin() }
    if (event === 'TOKEN_REFRESHED') {
      // Clear SPS cache when Supabase refreshes token — forces re-detect on next load
      clearCache()
    }
  })

  checkAccess()
})()
