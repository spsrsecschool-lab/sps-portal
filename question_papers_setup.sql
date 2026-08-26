-- question_papers — stores structured question papers created by admin.
-- Run this ONCE in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS question_papers (
  paper_id      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title         TEXT,
  class_id      UUID NOT NULL REFERENCES classes(class_id),
  subject_id    UUID NOT NULL REFERENCES subjects(subject_id),
  assessment_id UUID REFERENCES assessments(assessment_id),
  max_marks     INTEGER NOT NULL,
  time_minutes  INTEGER NOT NULL DEFAULT 60,
  language      TEXT DEFAULT 'english',
  content       JSONB NOT NULL DEFAULT '{}',
  session_id    TEXT NOT NULL REFERENCES sessions(session_id),
  created_by    TEXT NOT NULL,
  status        TEXT DEFAULT 'draft',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_qp_session  ON question_papers(session_id);
CREATE INDEX idx_qp_class    ON question_papers(class_id);
CREATE INDEX idx_qp_subject  ON question_papers(subject_id);

ALTER TABLE question_papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read question papers"
  ON question_papers FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert question papers"
  ON question_papers FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update question papers"
  ON question_papers FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete question papers"
  ON question_papers FOR DELETE
  TO authenticated USING (true);
