-- 1) Prevent students from unenrolling themselves
DROP POLICY IF EXISTS "Users can unenroll themselves" ON public.enrollments;
CREATE POLICY "Admins can remove enrollments"
ON public.enrollments FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 2) Access helper
CREATE OR REPLACE FUNCTION public.can_access_lesson(_lesson_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.lessons l
    JOIN public.courses c ON c.id = l.course_id
    WHERE l.id = _lesson_id
      AND (
        c.price <= 0
        OR l.is_free = true
        OR c.created_by = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
        OR EXISTS (
          SELECT 1 FROM public.enrollments e
          WHERE e.course_id = c.id AND e.user_id = auth.uid()
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_access_lesson(uuid) TO anon, authenticated, service_role;

-- 3) Lock down lesson content reads
DROP POLICY IF EXISTS "Anyone can view lesson videos" ON public.lesson_videos;
CREATE POLICY "Entitled users can view lesson videos"
ON public.lesson_videos FOR SELECT TO anon, authenticated
USING (public.can_access_lesson(lesson_id));

DROP POLICY IF EXISTS "Anyone can view lesson files" ON public.lesson_files;
CREATE POLICY "Entitled users can view lesson files"
ON public.lesson_files FOR SELECT TO anon, authenticated
USING (public.can_access_lesson(lesson_id));

DROP POLICY IF EXISTS "Anyone can view exams" ON public.exams;
CREATE POLICY "Entitled users can view exams"
ON public.exams FOR SELECT TO anon, authenticated
USING (public.can_access_lesson(lesson_id));

-- 4) Enrollees list for course owner / admin
CREATE OR REPLACE FUNCTION public.course_enrollees(_course_id uuid)
RETURNS TABLE (
  user_id uuid,
  name text,
  email text,
  public_id text,
  avatar_url text,
  enrolled_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id = _course_id
      AND (c.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.email, p.public_id, p.avatar_url, e.enrolled_at
  FROM public.enrollments e
  JOIN public.profiles p ON p.id = e.user_id
  WHERE e.course_id = _course_id
  ORDER BY e.enrolled_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.course_enrollees(uuid) TO authenticated, service_role;

-- 5) Per-student progress for course owner / admin
CREATE OR REPLACE FUNCTION public.course_student_progress(_course_id uuid, _user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lessons jsonb;
  _total int;
  _completed int;
  _enrolled_at timestamptz;
  _profile jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id = _course_id
      AND (c.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT e.enrolled_at INTO _enrolled_at
  FROM public.enrollments e
  WHERE e.course_id = _course_id AND e.user_id = _user_id;

  SELECT to_jsonb(x) INTO _profile
  FROM (SELECT p.id, p.name, p.email, p.public_id, p.avatar_url
        FROM public.profiles p WHERE p.id = _user_id) x;

  SELECT
    jsonb_agg(row_to_json(d)::jsonb ORDER BY d.sort_order),
    count(*)::int,
    count(*) FILTER (
      WHERE d.video_watched AND d.pdf_opened AND (NOT d.has_exam OR d.exam_completed)
    )::int
  INTO _lessons, _total, _completed
  FROM (
    SELECT
      l.id AS lesson_id,
      l.title,
      l.sort_order,
      l.is_free,
      COALESCE(lp.video_watched, false) AS video_watched,
      COALESCE(lp.pdf_opened, false) AS pdf_opened,
      COALESCE(lp.exam_completed, false) AS exam_completed,
      lp.updated_at AS last_activity,
      EXISTS (SELECT 1 FROM public.exams ex WHERE ex.lesson_id = l.id) AS has_exam,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'exam_id', r.exam_id, 'score', r.score, 'passed', r.passed,
          'submitted_at', r.submitted_at, 'essay_graded', r.essay_graded
        ) ORDER BY r.submitted_at DESC)
        FROM public.exam_results r
        JOIN public.exams ex2 ON ex2.id = r.exam_id
        WHERE ex2.lesson_id = l.id AND r.user_id = _user_id
      ) AS exam_results
    FROM public.lessons l
    LEFT JOIN public.lesson_progress lp
      ON lp.lesson_id = l.id AND lp.user_id = _user_id
    WHERE l.course_id = _course_id
  ) d;

  RETURN jsonb_build_object(
    'profile', _profile,
    'enrolled_at', _enrolled_at,
    'total_lessons', COALESCE(_total, 0),
    'completed_lessons', COALESCE(_completed, 0),
    'progress', CASE WHEN COALESCE(_total,0) = 0 THEN 0
                     ELSE round((COALESCE(_completed,0)::numeric * 100) / _total) END,
    'lessons', COALESCE(_lessons, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.course_student_progress(uuid, uuid) TO authenticated, service_role;