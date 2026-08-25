-- student_half_days — records when a student leaves school early (half day).
-- Run this ONCE in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS student_half_days (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  enrollment_id UUID NOT NULL REFERENCES student_enrollments(enrollment_id),
  date          DATE NOT NULL,
  leave_time    TEXT NOT NULL,
  reason        TEXT,
  approved_by   TEXT NOT NULL REFERENCES teachers(teacher_id),
  session_id    TEXT NOT NULL REFERENCES sessions(session_id),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shd_enrollment ON student_half_days(enrollment_id);
CREATE INDEX idx_shd_session    ON student_half_days(session_id);
CREATE INDEX idx_shd_date       ON student_half_days(date);

ALTER TABLE student_half_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read half days"
  ON student_half_days FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert half days"
  ON student_half_days FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can delete half days"
  ON student_half_days FOR DELETE
  TO authenticated USING (true);
