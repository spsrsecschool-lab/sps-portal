/**
 * config.js — Shiv Public School Portal Configuration
 *
 * This file is loaded first by every page in the system.
 * Update SUPABASE_URL, SUPABASE_ANON, and AUTH_EMAIL_DOMAIN here
 * and all portals pick up the change automatically.
 *
 * ─── WHERE TO FIND YOUR VALUES ────────────────────────────────
 * Supabase Dashboard → Your Project → Project Settings → API
 *
 *   SUPABASE_URL  = "Project URL"
 *   SUPABASE_ANON = "anon / public" key  (safe to commit — RLS protects data)
 *                   NEVER use the service_role key in client-side code.
 *
 * ─── AUTH_EMAIL_DOMAIN ───────────────────────────────────────
 * Supabase Auth requires email format, but your teachers use
 * simple usernames (e.g. SPS-T-0142). We append a domain to
 * make a valid email: SPS-T-0142@spsrsec.school
 *
 * This does NOT need to be a real email domain. Pick anything
 * consistent and use the same domain when creating teacher/admin
 * accounts via the Admin Portal.
 *
 * ─── IMPORTANT — GITHUB PAGES SETUP ─────────────────────────
 * 1. Add config.js to your .gitignore if you prefer NOT to
 *    commit the anon key publicly (optional — it's designed to
 *    be public, but some prefer caution).
 *    Alternative: use GitHub Secrets + a build step if you want
 *    zero secrets in the repo (can set up later with Vite/Parcel).
 *
 * 2. File load order in every portal page:
 *      <script src="config.js"></script>                          ← this file
 *      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *      <script>window.PORTAL_KEY = 'main_teacher'</script>       ← portal identifier
 *      <script src="auth.js"></script>                            ← session check
 *      <script src="main-teacher.js"></script>                    ← portal logic
 *
 * ─────────────────────────────────────────────────────────────
 */

// ── FILL THESE IN ─────────────────────────────────────────────
const SUPABASE_URL      = 'https://aafigohphcegnvvcojby.supabase.co'
const SUPABASE_ANON     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhZmlnb2hwaGNlZ252dmNvamJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5MTMyODksImV4cCI6MjA5ODQ4OTI4OX0.6xeG33em-_XfCetcqAyleBMBUyk1c5B4dDYuM_AWLu8'
const AUTH_EMAIL_DOMAIN = 'spsrsec.school'
// ──────────────────────────────────────────────────────────────

/**
 * HOW TO CREATE A TEACHER/ADMIN ACCOUNT IN SUPABASE
 * ─────────────────────────────────────────────────
 * Option A — Supabase Dashboard (for now, until Admin Portal is wired up):
 *   1. Go to Authentication → Users → Invite user
 *   2. Email: SPS-T-0142@spsrsec.school  (username + @ + AUTH_EMAIL_DOMAIN)
 *   3. Password: set a temporary one, teacher changes it on first login
 *   4. After user is created, note their UUID (the "User UID" column)
 *   5. In Table Editor → teachers table:
 *      - Insert a row with that UUID in the `auth_user_id` column
 *      - Fill in teacher_id, employee_code, full_name, username, etc.
 *      - Set is_active = true
 *   6. Map the teacher to their classes/subjects in teacher_subject_class_map
 *   7. If class teacher: add a row in class_teacher_map
 *   8. If mother teacher: add a row in mother_teacher_map
 *
 * Option B — Admin Portal (once fully wired):
 *   Admin creates teachers directly from the Staff & Teachers page.
 *   The portal will call Supabase Admin API via an Edge Function to
 *   create the auth account and insert the teacher row in one flow.
 *
 * ADMIN ACCOUNT:
 *   Same process — email: admin@spsrsec.school (or your choice)
 *   Insert a row in `admins` table with the auth user's UUID in auth_user_id
 */
