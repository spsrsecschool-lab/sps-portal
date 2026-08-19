// SPS AI Assistant — Supabase Edge Function
//
// Model: NVIDIA Nemotron Ultra (OpenAI-compatible API via build.nvidia.com)
// Secret: NVIDIA_API_KEY
// Optional: NVIDIA_MODEL to override the default model.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const NVIDIA_MODEL = Deno.env.get('NVIDIA_MODEL') ?? 'nvidia/llama-3.3-nemotron-super-49b-v1'
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'

async function callLLM(apiKey: string, payload: unknown, attempt = 0): Promise<Response> {
  const res = await fetch(NVIDIA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  })
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const wait = Math.pow(2, attempt) * 1200 + Math.random() * 400
    await new Promise((r) => setTimeout(r, wait))
    return callLLM(apiKey, payload, attempt + 1)
  }
  return res
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// ── Caller identity ────────────────────────────────────────────────────────
interface SectionAccess {
  class_id: string; section_id: string; class_name: string; section_name: string
  role: 'class_teacher' | 'subject_teacher'
  subjects?: string[]
}

interface Caller {
  kind: 'admin' | 'teacher'
  id: string
  name: string
  sessionId: string | null
  sections: SectionAccess[]
}

async function identify(db: any, authUserId: string): Promise<Caller | null> {
  const { data: sess } = await db.from('sessions').select('session_id').eq('is_current', true).maybeSingle()
  const sessionId = sess?.session_id ?? null

  const { data: admin } = await db.from('admins').select('admin_id').eq('auth_user_id', authUserId).maybeSingle()
  if (admin) return { kind: 'admin', id: admin.admin_id, name: 'Admin', sessionId, sections: [] }

  const { data: t } = await db
    .from('teachers')
    .select('teacher_id, full_name')
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  if (!t) return null

  const sectionMap: Record<string, SectionAccess> = {}

  // Class teacher sections
  const { data: ctMaps } = await db
    .from('class_teacher_map')
    .select('class_id, section_id, classes(name), class_sections(name)')
    .eq('teacher_id', t.teacher_id)
    .eq('session_id', sessionId ?? '')
  ;(ctMaps ?? []).forEach((m: any) => {
    const key = m.class_id + '_' + m.section_id
    sectionMap[key] = {
      class_id: m.class_id, section_id: m.section_id,
      class_name: m.classes?.name ?? '?', section_name: m.class_sections?.name ?? '?',
      role: 'class_teacher',
    }
  })

  // Subject teaching sections
  const { data: tscm } = await db
    .from('teacher_subject_class_map')
    .select('class_id, section_id, classes(name), class_sections(name), subjects(name)')
    .eq('teacher_id', t.teacher_id)
    .eq('session_id', sessionId ?? '')
  ;(tscm ?? []).forEach((m: any) => {
    const key = m.class_id + '_' + m.section_id
    if (sectionMap[key]) {
      if (!sectionMap[key].subjects) sectionMap[key].subjects = []
      if (m.subjects?.name) sectionMap[key].subjects!.push(m.subjects.name)
    } else {
      sectionMap[key] = {
        class_id: m.class_id, section_id: m.section_id,
        class_name: m.classes?.name ?? '?', section_name: m.class_sections?.name ?? '?',
        role: 'subject_teacher',
        subjects: m.subjects?.name ? [m.subjects.name] : [],
      }
    }
  })

  return {
    kind: 'teacher',
    id: t.teacher_id,
    name: t.full_name,
    sessionId,
    sections: Object.values(sectionMap),
  }
}

// ── Tool declarations ──────────────────────────────────────────────────────
function toolsFor(caller: Caller) {
  const t: any[] = [
    {
      name: 'get_class_roster',
      description: 'List students in a class section: roll no, name, father name, phone. Use when asked who is in a class or how many students.',
      parameters: {
        type: 'object',
        properties: {
          class_name: { type: 'string', description: 'e.g. "LKG", "5th", "11th"' },
          section_name: { type: 'string', description: 'e.g. "A". Optional.' },
        },
        required: ['class_name'],
      },
    },
    {
      name: 'get_class_attendance',
      description: 'Student attendance for a class on a date, or counts over a date range. Returns present/absent/late and names of absentees.',
      parameters: {
        type: 'object',
        properties: {
          class_name: { type: 'string' },
          section_name: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD for a single day' },
          from: { type: 'string', description: 'YYYY-MM-DD range start' },
          to: { type: 'string', description: 'YYYY-MM-DD range end' },
        },
        required: ['class_name'],
      },
    },
    {
      name: 'find_student',
      description: 'Search students by name, father name or roll number. Returns class, section, roll no, contact.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
    {
      name: 'get_student_dues',
      description: 'Fee status for one student: which months are paid, partial or unpaid, and annual charge status.',
      parameters: {
        type: 'object',
        properties: { student_name: { type: 'string' } },
        required: ['student_name'],
      },
    },
    {
      name: 'get_student_attendance_detail',
      description: 'Detailed attendance record for a single student over a date range: each day\'s status (present/absent/late), total counts, and percentage.',
      parameters: {
        type: 'object',
        properties: {
          student_name: { type: 'string' },
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['student_name', 'from', 'to'],
      },
    },
    {
      name: 'get_student_marks',
      description: 'Get marks/results for a student across all assessments, or for a specific assessment. Shows subject-wise marks, max marks, and whether absent.',
      parameters: {
        type: 'object',
        properties: {
          student_name: { type: 'string' },
          assessment_name: { type: 'string', description: 'Optional: filter to a specific assessment/exam name' },
        },
        required: ['student_name'],
      },
    },
    {
      name: 'get_class_marks_summary',
      description: 'Class-level marks summary for an assessment: average, top scorers, subject-wise averages, pass/fail counts.',
      parameters: {
        type: 'object',
        properties: {
          class_name: { type: 'string' },
          section_name: { type: 'string' },
          assessment_name: { type: 'string' },
        },
        required: ['class_name', 'assessment_name'],
      },
    },
    {
      name: 'get_my_staff_attendance',
      description: "The caller's own staff attendance (in/out times, present/late/absent) over a date range.",
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
    },
    {
      name: 'get_my_timetable',
      description: "Get the caller's timetable schedule for a specific day of the week (Mon/Tue/etc). Shows period, time, class, section, subject.",
      parameters: {
        type: 'object',
        properties: {
          day: { type: 'string', description: 'Day of week: Mon, Tue, Wed, Thu, Fri, Sat' },
        },
        required: ['day'],
      },
    },
    {
      name: 'get_class_timetable',
      description: 'Get the timetable for a class section on a specific day. Shows each period with subject and teacher.',
      parameters: {
        type: 'object',
        properties: {
          class_name: { type: 'string' },
          section_name: { type: 'string' },
          day: { type: 'string', description: 'Day of week: Mon, Tue, Wed, Thu, Fri, Sat' },
        },
        required: ['class_name', 'day'],
      },
    },
    {
      name: 'list_assessments',
      description: 'List all assessments/exams in the current session. Shows name, date range, max marks, and which classes they apply to.',
      parameters: {
        type: 'object',
        properties: {
          class_name: { type: 'string', description: 'Optional: filter to a specific class' },
        },
      },
    },
    {
      name: 'send_message',
      description: 'Send an internal portal message. ALWAYS confirm the exact wording with the user before calling this.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: '"admin" or a teacher\'s full name' },
          subject: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  ]

  if (caller.kind === 'teacher') {
    t.push({
      name: 'mark_attendance',
      description: 'Mark student attendance for one of the caller\'s own class sections for a date. Only the class teacher can mark attendance. State who is absent/late; everyone else is marked present.',
      parameters: {
        type: 'object',
        properties: {
          class_name: { type: 'string' },
          section_name: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          absent_students: { type: 'array', items: { type: 'string' }, description: 'Names or roll numbers' },
          late_students: { type: 'array', items: { type: 'string' } },
        },
        required: ['class_name', 'date'],
      },
    })
    t.push({
      name: 'get_my_sections',
      description: 'List all class sections the caller is assigned to — both as class teacher and as subject teacher — with which subjects they teach in each.',
      parameters: { type: 'object', properties: {} },
    })
  }

  if (caller.kind === 'admin') {
    t.push({
      name: 'get_staff_attendance_overview',
      description: 'Staff attendance summary across all teachers for a date range.',
      parameters: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
      },
    })
    t.push({
      name: 'get_school_stats',
      description: 'School-wide numbers: total students, families, staff, present today, pending access requests.',
      parameters: { type: 'object', properties: {} },
    })
    t.push({
      name: 'get_fee_collection',
      description: 'Fee collected over a date range: total, payment count, breakdown by head. Admin only.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['from', 'to'],
      },
    })
    t.push({
      name: 'run_sql',
      description: 'Run a READ-ONLY SQL SELECT for questions the other tools do not cover. Admin only. Useful tables: students, student_enrollments(session_id, class_id, section_id, stream_id, s_no, status, relieved), classes(name), class_sections(name), families(family_code, primary_contact_phone), payments(amount, payment_date, family_code, enrollment_id), payment_allocations(head, amount, payment_date, enrollment_id), fee_master(class_id, stream_id, monthly_tuition, annual_charge), fee_waivers, misc_fees, misc_fee_payments(is_paid), exam_fees, exam_fee_payments(is_paid), marks(marks_obtained, is_absent, assessment_id, enrollment_id, subject_id), assessments(name, max_marks), subjects(name), teachers(full_name, is_active, employee_code), teacher_attendance(date, status, time_in, time_out), student_attendance(date, status), teacher_subject_class_map, class_teacher_map, timetable_entries, time_slots, rosters. Always add a LIMIT.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A single SELECT statement.' },
        },
        required: ['query'],
      },
    })
  }

  return t
}

const WRITE_TOOLS = new Set(['mark_attendance', 'send_message'])

// ── Helpers ────────────────────────────────────────────────────────────────
async function resolveSection(db: any, caller: Caller, className: string, sectionName?: string) {
  const { data: cls } = await db.from('classes').select('class_id, name')
  const cl = (cls ?? []).find((c: any) => (c.name ?? '').toLowerCase() === String(className).toLowerCase())
  if (!cl) return { error: `No class named "${className}".` }

  const { data: secs } = await db
    .from('class_sections')
    .select('section_id, name')
    .eq('class_id', cl.class_id)
    .eq('session_id', caller.sessionId ?? '')
    .eq('is_active', true)

  let sec = sectionName
    ? (secs ?? []).find((s: any) => (s.name ?? '').toLowerCase() === String(sectionName).toLowerCase())
    : (secs ?? [])[0]
  if (!sec) return { error: `No section "${sectionName ?? ''}" in ${className}.` }

  if (caller.kind === 'teacher') {
    const ok = caller.sections.some((s) => s.section_id === sec.section_id)
    if (!ok) return { error: `You don't have access to ${className}-${sec.name}. You can only see classes you teach or are class teacher of.` }
  }
  return { class_id: cl.class_id, section_id: sec.section_id, class_name: cl.name, section_name: sec.name }
}

async function rosterOf(db: any, caller: Caller, class_id: string, section_id: string) {
  const { data } = await db
    .from('student_enrollments')
    .select('enrollment_id, roll_no, s_no, students(full_name, father_name, phone)')
    .eq('class_id', class_id)
    .eq('section_id', section_id)
    .eq('session_id', caller.sessionId ?? '')
    .eq('status', 'active')
    .eq('relieved', false)
    .order('roll_no', { nullsFirst: true })
  return data ?? []
}

// ── Tool execution ─────────────────────────────────────────────────────────
async function runTool(db: any, caller: Caller, name: string, args: any): Promise<any> {
  switch (name) {
    case 'get_class_roster': {
      const s = await resolveSection(db, caller, args.class_name, args.section_name)
      if ('error' in s) return s
      const roster = await rosterOf(db, caller, s.class_id, s.section_id)
      return {
        class: `${s.class_name}-${s.section_name}`,
        count: roster.length,
        students: roster.map((r: any) => ({
          roll: r.roll_no, name: r.students?.full_name, father: r.students?.father_name,
          phone: r.students?.phone,
        })),
      }
    }

    case 'get_class_attendance': {
      const s = await resolveSection(db, caller, args.class_name, args.section_name)
      if ('error' in s) return s
      const roster = await rosterOf(db, caller, s.class_id, s.section_id)
      const eids = roster.map((r: any) => r.enrollment_id)
      if (!eids.length) return { note: 'No students enrolled in that section.' }

      const from = args.date ?? args.from
      const to = args.date ?? args.to ?? from
      if (!from) return { error: 'Need a date or a from/to range.' }

      const { data: att } = await db
        .from('student_attendance')
        .select('enrollment_id, date, status')
        .in('enrollment_id', eids)
        .gte('date', from)
        .lte('date', to)

      const nameOf: Record<string, string> = {}
      roster.forEach((r: any) => (nameOf[r.enrollment_id] = r.students?.full_name ?? '?'))

      if (args.date) {
        const rows = att ?? []
        if (!rows.length) return { date: args.date, class: `${s.class_name}-${s.section_name}`, note: 'Attendance not marked for this date.' }
        return {
          date: args.date,
          class: `${s.class_name}-${s.section_name}`,
          total: roster.length,
          present: rows.filter((r: any) => r.status === 'P').length,
          absent: rows.filter((r: any) => r.status === 'A').length,
          late: rows.filter((r: any) => r.status === 'L').length,
          absentees: rows.filter((r: any) => r.status === 'A').map((r: any) => nameOf[r.enrollment_id]),
          late_students: rows.filter((r: any) => r.status === 'L').map((r: any) => nameOf[r.enrollment_id]),
        }
      }
      const per: Record<string, { p: number; a: number; l: number }> = {}
      ;(att ?? []).forEach((r: any) => {
        const k = nameOf[r.enrollment_id]
        per[k] = per[k] ?? { p: 0, a: 0, l: 0 }
        if (r.status === 'P') per[k].p++
        else if (r.status === 'A') per[k].a++
        else if (r.status === 'L') per[k].l++
      })
      return { class: `${s.class_name}-${s.section_name}`, from, to, per_student: per }
    }

    case 'find_student': {
      const q = String(args.query ?? '').trim()
      if (!q) return { error: 'Empty search.' }
      let sel = db
        .from('student_enrollments')
        .select('enrollment_id, roll_no, s_no, class_id, section_id, students!inner(full_name, father_name, phone), classes(name), class_sections(name)')
        .eq('session_id', caller.sessionId ?? '')
        .eq('status', 'active')
        .eq('relieved', false)
        .or(`full_name.ilike.%${q}%,father_name.ilike.%${q}%`, { foreignTable: 'students' })
        .limit(15)
      const { data } = await sel
      let rows = data ?? []
      if (caller.kind === 'teacher') {
        const allowed = new Set(caller.sections.map((s) => s.section_id))
        rows = rows.filter((r: any) => allowed.has(r.section_id))
      }
      if (!rows.length) return { note: 'No matching student you have access to.' }
      return rows.map((r: any) => ({
        name: r.students?.full_name, father: r.students?.father_name,
        class: `${r.classes?.name ?? '?'}-${r.class_sections?.name ?? '?'}`,
        roll: r.roll_no, s_no: r.s_no, phone: r.students?.phone,
      }))
    }

    case 'get_student_dues': {
      const found = await runTool(db, caller, 'find_student', { query: args.student_name })
      if (!Array.isArray(found) || !found.length) return { note: 'Student not found or not accessible.' }
      const { data: enr } = await db
        .from('student_enrollments')
        .select('enrollment_id, class_id, stream_id, tuition_override, students!inner(full_name)')
        .eq('session_id', caller.sessionId ?? '')
        .ilike('students.full_name', `%${args.student_name}%`)
        .limit(1)
      const e = (enr ?? [])[0]
      if (!e) return { note: 'Student not found.' }

      const { data: fm } = await db
        .from('fee_master')
        .select('monthly_tuition, annual_charge')
        .eq('session_id', caller.sessionId ?? '')
        .eq('class_id', e.class_id)
        .maybeSingle()
      const { data: allocs } = await db
        .from('payment_allocations')
        .select('head, amount')
        .eq('enrollment_id', e.enrollment_id)

      const paid: Record<string, number> = {}
      ;(allocs ?? []).forEach((a: any) => (paid[a.head] = (paid[a.head] ?? 0) + Number(a.amount ?? 0)))
      const tuition = e.tuition_override != null ? Number(e.tuition_override) : Number(fm?.monthly_tuition ?? 0)
      const MONTHS = ['April','May','June','July','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']
      return {
        student: e.students?.full_name,
        monthly_tuition: tuition,
        annual_charge: Number(fm?.annual_charge ?? 0),
        annual_paid: paid['Annual'] ?? 0,
        months: MONTHS.map((m) => ({
          month: m, paid: paid[m] ?? 0,
          status: (paid[m] ?? 0) <= 0 ? 'Unpaid' : (paid[m] ?? 0) >= tuition ? 'Paid' : 'Partial',
        })),
      }
    }

    case 'get_student_attendance_detail': {
      const found = await runTool(db, caller, 'find_student', { query: args.student_name })
      if (!Array.isArray(found) || !found.length) return { note: 'Student not found or not accessible.' }
      const { data: enr } = await db
        .from('student_enrollments')
        .select('enrollment_id, students!inner(full_name)')
        .eq('session_id', caller.sessionId ?? '')
        .ilike('students.full_name', `%${args.student_name}%`)
        .eq('status', 'active').eq('relieved', false)
        .limit(1)
      const e = (enr ?? [])[0]
      if (!e) return { note: 'Student not found.' }

      const { data: att } = await db
        .from('student_attendance')
        .select('date, status')
        .eq('enrollment_id', e.enrollment_id)
        .gte('date', args.from)
        .lte('date', args.to)
        .order('date')

      const rows = att ?? []
      const p = rows.filter((r: any) => r.status === 'P').length
      const a = rows.filter((r: any) => r.status === 'A').length
      const l = rows.filter((r: any) => r.status === 'L').length
      const total = p + a + l
      return {
        student: e.students?.full_name, from: args.from, to: args.to,
        total_days: total, present: p, absent: a, late: l,
        attendance_pct: total ? Math.round((p + l) / total * 100) : null,
        days: rows,
      }
    }

    case 'get_student_marks': {
      const found = await runTool(db, caller, 'find_student', { query: args.student_name })
      if (!Array.isArray(found) || !found.length) return { note: 'Student not found or not accessible.' }
      const { data: enr } = await db
        .from('student_enrollments')
        .select('enrollment_id, class_id, students!inner(full_name)')
        .eq('session_id', caller.sessionId ?? '')
        .ilike('students.full_name', `%${args.student_name}%`)
        .eq('status', 'active').eq('relieved', false)
        .limit(1)
      const e = (enr ?? [])[0]
      if (!e) return { note: 'Student not found.' }

      let assessQ = db.from('assessments').select('assessment_id, name, max_marks')
        .eq('session_id', caller.sessionId ?? '')
      if (args.assessment_name) assessQ = assessQ.ilike('name', `%${args.assessment_name}%`)
      const { data: assessments } = await assessQ
      if (!assessments?.length) return { note: 'No assessments found.' }

      const aIds = assessments.map((a: any) => a.assessment_id)
      const { data: marks } = await db
        .from('marks')
        .select('assessment_id, subject_id, marks_obtained, is_absent, subjects(name)')
        .eq('enrollment_id', e.enrollment_id)
        .in('assessment_id', aIds)

      const aMap: Record<string, any> = {}
      assessments.forEach((a: any) => { aMap[a.assessment_id] = a })

      const byAssessment: Record<string, any[]> = {}
      ;(marks ?? []).forEach((m: any) => {
        const aName = aMap[m.assessment_id]?.name ?? '?'
        if (!byAssessment[aName]) byAssessment[aName] = []
        byAssessment[aName].push({
          subject: m.subjects?.name ?? '?',
          marks: m.is_absent ? 'Absent' : m.marks_obtained,
          max_marks: aMap[m.assessment_id]?.max_marks,
        })
      })

      return { student: e.students?.full_name, results: byAssessment }
    }

    case 'get_class_marks_summary': {
      const s = await resolveSection(db, caller, args.class_name, args.section_name)
      if ('error' in s) return s

      const { data: assess } = await db.from('assessments').select('assessment_id, name, max_marks')
        .eq('session_id', caller.sessionId ?? '').ilike('name', `%${args.assessment_name}%`).limit(1)
      const a = (assess ?? [])[0]
      if (!a) return { note: `No assessment matching "${args.assessment_name}".` }

      const roster = await rosterOf(db, caller, s.class_id, s.section_id)
      const eids = roster.map((r: any) => r.enrollment_id)
      if (!eids.length) return { note: 'No students in that section.' }

      const { data: marks } = await db
        .from('marks')
        .select('enrollment_id, subject_id, marks_obtained, is_absent, subjects(name)')
        .eq('assessment_id', a.assessment_id)
        .in('enrollment_id', eids)

      const nameOf: Record<string, string> = {}
      roster.forEach((r: any) => { nameOf[r.enrollment_id] = r.students?.full_name ?? '?' })

      const studentTotals: Record<string, { name: string; total: number; subjects: number }> = {}
      const subjectSums: Record<string, { total: number; count: number }> = {}

      ;(marks ?? []).forEach((m: any) => {
        if (m.is_absent) return
        const sName = m.subjects?.name ?? '?'
        const v = Number(m.marks_obtained ?? 0)
        subjectSums[sName] = subjectSums[sName] ?? { total: 0, count: 0 }
        subjectSums[sName].total += v
        subjectSums[sName].count++

        const eid = m.enrollment_id
        studentTotals[eid] = studentTotals[eid] ?? { name: nameOf[eid], total: 0, subjects: 0 }
        studentTotals[eid].total += v
        studentTotals[eid].subjects++
      })

      const ranked = Object.values(studentTotals).sort((a, b) => b.total - a.total)
      const subAvgs: Record<string, number> = {}
      Object.entries(subjectSums).forEach(([k, v]) => { subAvgs[k] = Math.round(v.total / v.count * 10) / 10 })

      return {
        class: `${s.class_name}-${s.section_name}`,
        assessment: a.name,
        max_marks: a.max_marks,
        students_with_marks: ranked.length,
        class_average: ranked.length ? Math.round(ranked.reduce((s, r) => s + r.total, 0) / ranked.length * 10) / 10 : null,
        top_5: ranked.slice(0, 5).map((r) => ({ name: r.name, total: r.total })),
        subject_averages: subAvgs,
      }
    }

    case 'get_my_staff_attendance': {
      if (caller.kind !== 'teacher') return { note: 'Admins do not have a personal staff-attendance record here.' }
      const { data } = await db
        .from('teacher_attendance')
        .select('date, status, time_in, time_out')
        .eq('teacher_id', caller.id)
        .gte('date', args.from)
        .lte('date', args.to)
        .order('date')
      const rows = data ?? []
      return {
        from: args.from, to: args.to,
        present: rows.filter((r: any) => r.status === 'Present').length,
        late: rows.filter((r: any) => r.status === 'Late').length,
        absent: rows.filter((r: any) => r.status === 'Absent').length,
        off: rows.filter((r: any) => r.status === 'Off').length,
        days: rows,
      }
    }

    case 'get_my_timetable': {
      if (caller.kind !== 'teacher') return { error: 'Use get_class_timetable for admin.' }
      const { data: rosters } = await db.from('rosters').select('roster_id').eq('session_id', caller.sessionId ?? '').eq('is_active', true).maybeSingle()
      if (!rosters) return { note: 'No active timetable roster found.' }
      const rid = rosters.roster_id

      const { data: slots } = await db.from('time_slots').select('*').eq('roster_id', rid).order('sort_order')
      const { data: entries } = await db
        .from('timetable_entries')
        .select('slot_id, class_id, section_id, days, classes(name), class_sections(name), subjects(name)')
        .eq('roster_id', rid)
        .eq('teacher_id', caller.id)

      const day = String(args.day ?? '').trim()
      const dayEntries = (entries ?? []).filter((e: any) => (e.days ?? []).includes(day))
      const slotMap: Record<string, any> = {}
      ;(slots ?? []).forEach((s: any) => { slotMap[s.slot_id] = s })

      const schedule = dayEntries.map((e: any) => {
        const sl = slotMap[e.slot_id]
        return {
          period: sl?.name ?? '?',
          time: (sl?.start_time ?? '').slice(0, 5) + '–' + (sl?.end_time ?? '').slice(0, 5),
          class: (e.classes?.name ?? '?') + '-' + (e.class_sections?.name ?? '?'),
          subject: e.subjects?.name ?? '—',
          sort: sl?.sort_order ?? 0,
        }
      }).sort((a: any, b: any) => a.sort - b.sort)

      return { day, schedule }
    }

    case 'get_class_timetable': {
      const s = await resolveSection(db, caller, args.class_name, args.section_name)
      if ('error' in s) return s

      const { data: rosters } = await db.from('rosters').select('roster_id').eq('session_id', caller.sessionId ?? '').eq('is_active', true).maybeSingle()
      if (!rosters) return { note: 'No active timetable roster found.' }
      const rid = rosters.roster_id

      const { data: slots } = await db.from('time_slots').select('*').eq('roster_id', rid).order('sort_order')
      const { data: entries } = await db
        .from('timetable_entries')
        .select('slot_id, days, subjects(name), teachers(full_name)')
        .eq('roster_id', rid)
        .eq('class_id', s.class_id)
        .eq('section_id', s.section_id)

      const day = String(args.day ?? '').trim()
      const dayEntries = (entries ?? []).filter((e: any) => (e.days ?? []).includes(day))
      const slotMap: Record<string, any> = {}
      ;(slots ?? []).forEach((sl: any) => { slotMap[sl.slot_id] = sl })

      const schedule = dayEntries.map((e: any) => {
        const sl = slotMap[e.slot_id]
        return {
          period: sl?.name ?? '?',
          time: (sl?.start_time ?? '').slice(0, 5) + '–' + (sl?.end_time ?? '').slice(0, 5),
          subject: e.subjects?.name ?? '—',
          teacher: e.teachers?.full_name ?? '—',
          sort: sl?.sort_order ?? 0,
        }
      }).sort((a: any, b: any) => a.sort - b.sort)

      return { class: `${s.class_name}-${s.section_name}`, day, schedule }
    }

    case 'list_assessments': {
      let q = db.from('assessments').select('assessment_id, name, max_marks, commencement_date, end_date, class_id, classes(name)')
        .eq('session_id', caller.sessionId ?? '')
        .order('commencement_date', { nullsFirst: false })
      if (args.class_name) {
        const { data: cls } = await db.from('classes').select('class_id, name')
        const cl = (cls ?? []).find((c: any) => (c.name ?? '').toLowerCase() === String(args.class_name).toLowerCase())
        if (cl) q = q.eq('class_id', cl.class_id)
      }
      const { data } = await q.limit(30)
      return (data ?? []).map((a: any) => ({
        name: a.name, class: a.classes?.name ?? 'All',
        max_marks: a.max_marks,
        dates: a.commencement_date && a.end_date ? `${a.commencement_date} to ${a.end_date}` : a.commencement_date ?? '—',
      }))
    }

    case 'get_my_sections': {
      return {
        name: caller.name,
        sections: caller.sections.map((s) => ({
          class: `${s.class_name}-${s.section_name}`,
          role: s.role === 'class_teacher' ? 'Class Teacher' : 'Subject Teacher',
          subjects: s.subjects ?? [],
        })),
      }
    }

    case 'get_staff_attendance_overview': {
      if (caller.kind !== 'admin') return { error: 'Admin only.' }
      const { data: tchs } = await db.from('teachers').select('teacher_id, full_name').eq('is_active', true)
      const { data: att } = await db
        .from('teacher_attendance')
        .select('teacher_id, status')
        .gte('date', args.from)
        .lte('date', args.to)
      const per: Record<string, any> = {}
      ;(tchs ?? []).forEach((t: any) => (per[t.teacher_id] = { name: t.full_name, present: 0, late: 0, absent: 0, off: 0 }))
      ;(att ?? []).forEach((r: any) => {
        const p = per[r.teacher_id]; if (!p) return
        if (r.status === 'Present') p.present++
        else if (r.status === 'Late') p.late++
        else if (r.status === 'Absent') p.absent++
        else if (r.status === 'Off') p.off++
      })
      return { from: args.from, to: args.to, staff: Object.values(per) }
    }

    case 'get_school_stats': {
      if (caller.kind !== 'admin') return { error: 'Admin only.' }
      const today = new Date().toISOString().slice(0, 10)
      const { count: students } = await db
        .from('student_enrollments').select('*', { count: 'exact', head: true })
        .eq('session_id', caller.sessionId ?? '').eq('status', 'active').eq('relieved', false)
      const { count: families } = await db.from('families').select('*', { count: 'exact', head: true })
      const { count: staff } = await db.from('teachers').select('*', { count: 'exact', head: true }).eq('is_active', true)
      const { data: todayAtt } = await db.from('student_attendance').select('status').eq('date', today)
      const { count: reqs } = await db.from('access_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending')
      return {
        date: today,
        total_students: students ?? 0,
        total_families: families ?? 0,
        total_staff: staff ?? 0,
        students_present_today: (todayAtt ?? []).filter((r: any) => r.status === 'P' || r.status === 'L').length,
        students_absent_today: (todayAtt ?? []).filter((r: any) => r.status === 'A').length,
        pending_access_requests: reqs ?? 0,
      }
    }

    case 'get_fee_collection': {
      if (caller.kind !== 'admin') return { error: 'Admin only.' }
      let rows: any[] = [], page = 0
      while (true) {
        const { data, error } = await db
          .from('payment_allocations')
          .select('head, amount, payment_date')
          .gte('payment_date', args.from).lte('payment_date', args.to)
          .order('payment_date').range(page * 1000, (page + 1) * 1000 - 1)
        if (error) return { error: error.message }
        rows = rows.concat(data ?? [])
        if (!data || data.length < 1000) break
        if (++page > 50) break
      }
      const byHead: Record<string, number> = {}
      let total = 0
      rows.forEach((r) => { const a = Number(r.amount ?? 0); total += a; byHead[r.head] = (byHead[r.head] ?? 0) + a })
      const { count: payCount } = await db
        .from('payments').select('*', { count: 'exact', head: true })
        .gte('payment_date', args.from).lte('payment_date', args.to)
      return {
        from: args.from, to: args.to,
        total_collected: total,
        payment_count: payCount ?? 0,
        allocation_rows: rows.length,
        by_head: byHead,
      }
    }

    case 'run_sql': {
      if (caller.kind !== 'admin') return { error: 'The raw query tool is admin only.' }
      const q = String(args.query ?? '').trim()
      if (!q) return { error: 'Empty query.' }
      const { data, error } = await db.rpc('ai_run_readonly_sql', { query: q, row_limit: 200 })
      if (error) return { error: 'Query rejected or failed: ' + error.message }
      const rowCount = Array.isArray(data) ? data.length : 0
      return { row_count: rowCount, rows: data, note: rowCount >= 200 ? 'Results capped at 200 rows.' : undefined }
    }

    // ── Writes ──────────────────────────────────────────────────────────
    case 'mark_attendance': {
      if (caller.kind !== 'teacher') return { error: 'Only class teachers can mark student attendance.' }
      const s = await resolveSection(db, caller, args.class_name, args.section_name)
      if ('error' in s) return s

      // Only class teachers can mark attendance, not subject teachers
      const ctSection = caller.sections.find(
        (sec) => sec.section_id === s.section_id && sec.role === 'class_teacher'
      )
      if (!ctSection) return { error: `You can only mark attendance for sections you are class teacher of. You are a subject teacher in ${s.class_name}-${s.section_name}.` }

      const roster = await rosterOf(db, caller, s.class_id, s.section_id)
      if (!roster.length) return { error: 'No students in that section.' }

      const match = (needle: string) => {
        const n = String(needle).toLowerCase().trim()
        return roster.find(
          (r: any) => String(r.roll_no) === n || (r.students?.full_name ?? '').toLowerCase().includes(n)
        )
      }
      const absent = new Set<string>(), late = new Set<string>(), unmatched: string[] = []
      ;(args.absent_students ?? []).forEach((x: string) => { const m = match(x); m ? absent.add(m.enrollment_id) : unmatched.push(x) })
      ;(args.late_students ?? []).forEach((x: string) => { const m = match(x); m ? late.add(m.enrollment_id) : unmatched.push(x) })
      if (unmatched.length) return { error: `Could not find these students in ${s.class_name}-${s.section_name}: ${unmatched.join(', ')}. Ask the user to clarify.` }

      const records = roster.map((r: any) => ({
        enrollment_id: r.enrollment_id,
        date: args.date,
        status: absent.has(r.enrollment_id) ? 'A' : late.has(r.enrollment_id) ? 'L' : 'P',
        session_id: caller.sessionId ?? '',
      }))
      await db.from('student_attendance').delete().in('enrollment_id', records.map((r) => r.enrollment_id)).eq('date', args.date)
      const { error } = await db.from('student_attendance').insert(records)
      if (error) return { error: error.message }

      await db.from('activity_log').insert({
        user_type: 'teacher', user_id: caller.id, action_type: 'ai_mark_attendance',
        message: `AI assistant marked attendance for ${s.class_name}-${s.section_name} on ${args.date}`,
        created_at: new Date().toISOString(),
      })
      return {
        done: true, class: `${s.class_name}-${s.section_name}`, date: args.date,
        present: records.filter((r) => r.status === 'P').length,
        absent: records.filter((r) => r.status === 'A').length,
        late: records.filter((r) => r.status === 'L').length,
      }
    }

    case 'send_message': {
      let recipientType = 'admin', recipientId = ''
      if (String(args.to).toLowerCase() === 'admin') {
        const { data: a } = await db.from('admins').select('admin_id').limit(1)
        recipientId = a?.[0]?.admin_id ?? ''
        if (!recipientId) return { error: 'No admin account found.' }
      } else {
        const { data: t } = await db.from('teachers').select('teacher_id, full_name').ilike('full_name', `%${args.to}%`).limit(1)
        if (!t?.length) return { error: `No teacher matching "${args.to}".` }
        recipientType = 'teacher'; recipientId = t[0].teacher_id
      }
      const { error } = await db.from('messages').insert({
        sender_type: caller.kind, sender_id: caller.id,
        recipient_type: recipientType, recipient_id: recipientId,
        subject: args.subject, body: args.body,
        message_type: 'direct', sent_at: new Date().toISOString(),
      })
      if (error) return { error: error.message }
      return { done: true, to: args.to, subject: args.subject }
    }
  }
  return { error: `Unknown tool ${name}` }
}

// ── System prompt ──────────────────────────────────────────────────────────
function systemPrompt(caller: Caller) {
  const today = new Date().toISOString().slice(0, 10)

  let scope: string
  if (caller.kind === 'admin') {
    scope = 'You are speaking with a school ADMIN. They can see school-wide data and run raw SQL queries.'
  } else {
    const ctSections = caller.sections.filter((s) => s.role === 'class_teacher')
    const stSections = caller.sections.filter((s) => s.role === 'subject_teacher')
    const ctList = ctSections.map((s) => `${s.class_name}-${s.section_name}`).join(', ')
    const stList = stSections.map((s) => `${s.class_name}-${s.section_name} (${(s.subjects ?? []).join(', ')})`).join(', ')
    scope = `You are speaking with ${caller.name}, a TEACHER.\n`
    if (ctList) scope += `Class teacher of: ${ctList}.\n`
    if (stList) scope += `Teaches in: ${stList}.\n`
    scope += `They may ONLY see data for these sections. Never reveal data about other classes. If a tool refuses, explain it is outside their access.\n`
    scope += `Only class teachers can mark attendance for their class — subject teachers cannot.`
  }

  return `You are Sakha, the owl who lives inside Shiv Public School's management portal — the school's wise, watchful helper. "Sakha" means companion, and that's your job: a calm, friendly owl perched over the whole school, helping staff find things and get things done.

## Who you are
- Your name is Sakha. If someone asks your name, you are Sakha the owl — never "assistant", "AI", "chatbot", or "language model". You don't break character.
- You have a gentle, perceptive, slightly wise personality — an owl who has watched over many school years. Warm and encouraging, never stiff.
- You're a helper, not a show-off. The owl flavour is seasoning, not the meal.

## Your voice
- Warm, concise, a little characterful. Short sentences. Plain language.
- Open a fresh conversation with a soft owl touch — a "Hoo there!" or a friendly greeting — but once mid-task, just be helpful.
- A rare 🦉 is fine — at most once in a message. Don't spam emoji.
- When you deliver a number or a fact, be crisp and confident.

## What you do
Today is ${today}. The current academic session is "${caller.sessionId ?? 'unknown'}" and runs April to March.
${scope}

### Capabilities
You can help with:
- **Student roster**: list students in a class, search by name/father name/roll number
- **Attendance**: check who was absent/present on a date, get attendance over a range, see individual student attendance detail with percentages
- **Marks & Results**: look up a student's marks across assessments, get class-level summaries (averages, top scorers, subject-wise analysis)
- **Fee status**: check which months a student has paid, unpaid, or partial
- **Timetable**: see your own teaching schedule for a day, or a class's full timetable
- **Assessments**: list all exams/assessments in the session
- **Staff attendance**: check your own attendance record (teachers) or see all staff attendance (admin)
- **Messages**: send internal portal messages to admin or other teachers
- **Mark attendance**: class teachers can mark attendance via natural language (say who is absent/late)
${caller.kind === 'admin' ? '- **Raw SQL queries**: for any question the other tools can\'t answer — arbitrary counts, sums, groupings\n- **School stats**: total students, families, staff, today\'s attendance\n- **Fee collection**: total money collected over a date range with breakdown' : ''}

### Guidelines
- Use the tools to look things up. Never invent names, numbers, dates or fee amounts — an owl reports only what it actually sees.
- Be concise. Use a small table or list only when it genuinely helps.
- Amounts are Indian rupees (₹). Dates are day-month-year in conversation.
- For actions (marking attendance, sending a message), state exactly what you are about to do and let the confirmation step handle approval.
- If a request is ambiguous (which class? which date?), ask one short clarifying question instead of guessing.
- Protect student privacy. Do not share personal details beyond what was asked.
${caller.kind === 'admin' ? '- For run_sql: always filter enrollments by the current session_id and add a LIMIT. Summarise results in plain words.' : ''}`
}

// ── Handler ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const apiKey = Deno.env.get('NVIDIA_API_KEY')
    if (!apiKey) return json({ error: 'NVIDIA_API_KEY is not configured. Add it as a secret in the Edge Function settings.' }, 500)

    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '')
    if (!token) return json({ error: 'Not signed in.' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await authClient.auth.getUser()
    if (userErr || !userData?.user) return json({ error: 'Session expired. Please sign in again.' }, 401)

    const db = createClient(url, serviceKey, { auth: { persistSession: false } })

    const caller = await identify(db, userData.user.id)
    if (!caller) return json({ error: 'Your account is not linked to a staff profile.' }, 403)

    const body = await req.json()
    const history: any[] = Array.isArray(body.history) ? body.history.slice(-16) : []
    const confirmed = body.confirmedAction as { name: string; args: any } | undefined

    const wrappedTools = toolsFor(caller).map((t) => ({ type: 'function', function: t }))

    // ── Confirmed write ──
    if (confirmed) {
      if (!WRITE_TOOLS.has(confirmed.name)) return json({ error: 'That action cannot be confirmed this way.' }, 400)
      const result = await runTool(db, caller, confirmed.name, confirmed.args)
      const messages = [
        { role: 'system', content: systemPrompt(caller) },
        ...history.filter((m) => m.role !== 'system'),
        { role: 'user', content: `[The user approved the action. Result: ${JSON.stringify(result)}. Tell them what happened in one or two sentences.]` },
      ]
      const r = await callLLM(apiKey, { model: NVIDIA_MODEL, messages, temperature: 0.2 })
      if (!r.ok) return json({ reply: 'Done.', executed: result })
      const d = await r.json()
      const text = d?.choices?.[0]?.message?.content?.trim() || 'Done.'
      return json({ reply: text, executed: result })
    }

    const question = String(body.message ?? '').trim()
    if (!question) return json({ error: 'Empty message.' }, 400)

    const messages: any[] = [
      { role: 'system', content: systemPrompt(caller) },
      ...history.filter((m) => m.role !== 'system'),
      { role: 'user', content: question },
    ]

    for (let hop = 0; hop < 5; hop++) {
      const r = await callLLM(apiKey, {
        model: NVIDIA_MODEL,
        messages,
        tools: wrappedTools,
        tool_choice: 'auto',
        temperature: 0.2,
      })
      if (!r.ok) {
        let detail = ''
        try { detail = (await r.json())?.error?.message ?? '' } catch (_) { /* ignore */ }
        if (r.status === 429) {
          return json({
            error: 'The AI is briefly rate-limited. Wait a few seconds and try again. ' + (detail ? `(${detail})` : ''),
          }, 429)
        }
        return json({
          error: `AI service error (${r.status})${detail ? ': ' + detail : ''}`,
        }, 502)
      }

      const d = await r.json()
      const msg = d?.choices?.[0]?.message
      const toolCalls = msg?.tool_calls ?? []

      if (!toolCalls.length) {
        const text = (msg?.content ?? '').trim()
        messages.push({ role: 'assistant', content: text })
        return json({ reply: text || "I couldn't work that out — try rephrasing?", history: messages.filter((m) => m.role !== 'system') })
      }

      const writeCall = toolCalls.find((c: any) => WRITE_TOOLS.has(c.function?.name))
      if (writeCall) {
        let args: any = {}
        try { args = JSON.parse(writeCall.function.arguments || '{}') } catch (_) { /* ignore */ }
        return json({
          reply: (msg.content ?? '').trim(),
          needsConfirmation: { name: writeCall.function.name, args, summary: describeAction(writeCall.function.name, args) },
          history: messages.filter((m) => m.role !== 'system'),
        })
      }

      messages.push(msg)
      for (const c of toolCalls) {
        let args: any = {}
        try { args = JSON.parse(c.function.arguments || '{}') } catch (_) { /* ignore */ }
        const result = await runTool(db, caller, c.function.name, args)
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) })
      }
    }

    return json({ reply: 'That took too many steps — could you narrow the question down?' })
  } catch (e) {
    return json({ error: `Something went wrong: ${(e as Error).message}` }, 500)
  }
})

function describeAction(name: string, a: any) {
  if (name === 'mark_attendance') {
    const bits = []
    if (a.absent_students?.length) bits.push(`absent: ${a.absent_students.join(', ')}`)
    if (a.late_students?.length) bits.push(`late: ${a.late_students.join(', ')}`)
    return `Mark attendance for ${a.class_name}${a.section_name ? '-' + a.section_name : ''} on ${a.date}. ${
      bits.length ? bits.join('; ') + '. Everyone else present.' : 'Everyone present.'
    }`
  }
  if (name === 'send_message') return `Send a message to ${a.to} — "${a.subject}"`
  return 'Perform this action'
}
