
-- 1. Create a secure grading RPC that checks answers server-side
CREATE OR REPLACE FUNCTION public.grade_exam_submission(
  _exam_id uuid,
  _answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _question RECORD;
  _mcq_correct int := 0;
  _mcq_total int := 0;
  _has_essay boolean := false;
  _answer jsonb;
  _graded_answers jsonb := '[]'::jsonb;
  _total_questions int := 0;
BEGIN
  FOR _question IN
    SELECT id, text, type, options, correct_option, sort_order
    FROM public.exam_questions
    WHERE exam_id = _exam_id
    ORDER BY sort_order
  LOOP
    _total_questions := _total_questions + 1;
    -- Find the matching answer from input
    _answer := NULL;
    SELECT value INTO _answer
    FROM jsonb_array_elements(_answers) AS value
    WHERE (value->>'questionIndex')::int = _question.sort_order
    LIMIT 1;

    IF _question.type = 'multiple' THEN
      _mcq_total := _mcq_total + 1;
      IF _answer IS NOT NULL AND (_answer->>'selectedOption')::int = _question.correct_option THEN
        _mcq_correct := _mcq_correct + 1;
        _graded_answers := _graded_answers || jsonb_build_object(
          'questionIndex', _question.sort_order,
          'type', 'multiple',
          'selectedOption', (_answer->>'selectedOption')::int,
          'isCorrect', true
        );
      ELSE
        _graded_answers := _graded_answers || jsonb_build_object(
          'questionIndex', _question.sort_order,
          'type', 'multiple',
          'selectedOption', COALESCE((_answer->>'selectedOption')::int, -1),
          'isCorrect', false,
          'correctOption', _question.correct_option
        );
      END IF;
    ELSE
      _has_essay := true;
      _graded_answers := _graded_answers || jsonb_build_object(
        'questionIndex', _question.sort_order,
        'type', 'essay',
        'answer', COALESCE(_answer->>'answer', ''),
        'grade', NULL,
        'graded', false
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'mcqCorrect', _mcq_correct,
    'mcqTotal', _mcq_total,
    'totalQuestions', _total_questions,
    'hasEssay', _has_essay,
    'gradedAnswers', _graded_answers
  );
END;
$$;

-- 2. Restrict exam_questions SELECT to course owners/admins only (for full data including correct_option)
DROP POLICY IF EXISTS "Authenticated users can view exam questions" ON public.exam_questions;

-- Students can see questions but NOT correct_option - we handle this via RPC
-- Only course owners and admins can SELECT directly (for editing)
CREATE POLICY "Course owners and admins can view exam questions"
  ON public.exam_questions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM exams e
      JOIN lessons l ON l.id = e.lesson_id
      JOIN courses c ON c.id = l.course_id
      WHERE e.id = exam_questions.exam_id
      AND (c.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
    )
  );

-- 3. Create a function to get exam questions WITHOUT correct_option (for students taking exams)
CREATE OR REPLACE FUNCTION public.get_exam_questions_safe(_exam_id uuid)
RETURNS TABLE(id uuid, exam_id uuid, text text, type question_type, options jsonb, sort_order int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT eq.id, eq.exam_id, eq.text, eq.type, eq.options, eq.sort_order
  FROM public.exam_questions eq
  WHERE eq.exam_id = _exam_id
  ORDER BY eq.sort_order;
$$;

-- 4. Fix storage: add course ownership check for lesson-pdfs
DROP POLICY IF EXISTS "Course owners can upload lesson pdfs" ON storage.objects;
CREATE POLICY "Course owners can upload lesson pdfs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lesson-pdfs' AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      (storage.foldername(name))[1] IN (
        SELECT c.id::text FROM courses c WHERE c.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Course owners can update lesson pdfs" ON storage.objects;
CREATE POLICY "Course owners can update lesson pdfs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'lesson-pdfs' AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      (storage.foldername(name))[1] IN (
        SELECT c.id::text FROM courses c WHERE c.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Course owners can delete lesson pdfs" ON storage.objects;
CREATE POLICY "Course owners can delete lesson pdfs"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'lesson-pdfs' AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      (storage.foldername(name))[1] IN (
        SELECT c.id::text FROM courses c WHERE c.created_by = auth.uid()
      )
    )
  );

-- 5. Fix storage: add course ownership check for course-images  
DROP POLICY IF EXISTS "Course owners can upload course images" ON storage.objects;
CREATE POLICY "Course owners can upload course images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'course-images' AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      (storage.foldername(name))[1] IN (
        SELECT c.id::text FROM courses c WHERE c.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Course owners can update course images" ON storage.objects;
CREATE POLICY "Course owners can update course images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'course-images' AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      (storage.foldername(name))[1] IN (
        SELECT c.id::text FROM courses c WHERE c.created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Course owners can delete course images" ON storage.objects;
CREATE POLICY "Course owners can delete course images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'course-images' AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      (storage.foldername(name))[1] IN (
        SELECT c.id::text FROM courses c WHERE c.created_by = auth.uid()
      )
    )
  );
