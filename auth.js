/**
 * auth.js — Shared authentication helper for Shiv Public School Portal
 */
;(function() {
  'use strict'

  window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON)

  window.SPS = {
    user: null, teacher: null, admin: null,
    portals: [], session: null, _ready: null,
  }

  function getLocalUser() {
    try { return JSON.parse(sessionStorage.getItem('sps_user') || 'null') }
    catch { return null }
  }

  let _sessionId = null
  async function getCurrentSessionId() {
    if (_sessionId) return _sessionId
    const { data } = await sb.from('sessions').select('session_id').eq('is_current', true).maybeSingle()
    _sessionId = data?.session_id || null
    return _sessionId
  }
  SPS.getSessionId = getCurrentSessionId

  async function detectPortals(userId) {
    const results = { portals: [], teacher: null, admin: null }
    const { data: adminRow } = await sb.from('admins').select('admin_id').eq('auth_user_id', userId).maybeSingle()
    if (adminRow) { results.admin = adminRow; results.portals = ['admin']; return results }
    const { data: teacherRow } = await sb.from('teachers')
      .select('teacher_id, full_name, designation, is_active')
      .eq('auth_user_id', userId).maybeSingle()
    if (!teacherRow || !teacherRow.is_active) return results
    results.teacher = teacherRow
    results.portals.push('main_teacher')
    const sessionId = await getCurrentSessionId()
    if (sessionId) {
      const { data: classRow } = await sb.from('class_teacher_map').select('map_id')
        .eq('teacher_id', teacherRow.teacher_id).eq('session_id', sessionId).maybeSingle()
      if (classRow) results.portals.push('class_teacher')
    }
    return results
  }

  async function checkAccess() {
    const { data: { session } } = await sb.auth.getSession()
    if (!session) { redirectToLogin(); return }

    SPS.session = session
    SPS.user    = session.user

    // Use cache only if it belongs to this exact user
    const cached = getLocalUser()
    if (cached && cached.portals && cached.userId === session.user.id) {
      SPS.teacher = cached.teacher
      SPS.admin   = cached.admin
      SPS.portals = cached.portals
    } else {
      // Re-detect portals for this user
      sessionStorage.removeItem('sps_user')
      const detected = await detectPortals(session.user.id)
      SPS.teacher = detected.teacher
      SPS.admin   = detected.admin
      SPS.portals = detected.portals
      sessionStorage.setItem('sps_user', JSON.stringify({
        userId:  session.user.id,
        teacher: SPS.teacher,
        admin:   SPS.admin,
        portals: SPS.portals,
      }))
    }

    const key = window.PORTAL_KEY
    if (key && !SPS.portals.includes(key)) { redirectToLogin('access'); return }

    SPS._resolveReady()
  }

  function redirectToLogin(reason) {
    window.location.replace(reason ? `login.html?reason=${reason}` : 'login.html')
  }

  SPS.signOut = async function() {
    await sb.auth.signOut()
    sessionStorage.removeItem('sps_user')
    redirectToLogin()
  }

  SPS._resolveReady = null
  SPS._ready = new Promise(resolve => { SPS._resolveReady = resolve })
  SPS.ready = () => SPS._ready

  SPS.isAdmin     = () => SPS.portals.includes('admin')
  SPS.isTeacher   = () => !!SPS.teacher
  SPS.teacherId   = () => SPS.teacher?.teacher_id || null
  SPS.teacherName = () => SPS.teacher?.full_name || ''
  SPS.initials    = (name = SPS.teacherName()) =>
    name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      sessionStorage.removeItem('sps_user')
      redirectToLogin()
    }
  })

  checkAccess()
})()
