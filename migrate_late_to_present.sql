-- Convert all student attendance records with status 'L' (Late) to 'P' (Present).
-- Run this ONCE in the Supabase SQL Editor.
-- The 'L' status is being removed from student daily attendance.
-- Staff/teacher attendance is NOT affected.

UPDATE student_attendance
SET status = 'P'
WHERE status = 'L';
