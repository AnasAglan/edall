-- Student rosters and individual progress expose PII; administrators need AAL2.
BEGIN;

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
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF public.has_role(auth.uid(),'admin'::public.app_role) THEN
    IF NOT public.admin_mfa_verified() THEN RAISE EXCEPTION 'ADMIN_MFA_REQUIRED'; END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id=_course_id AND c.created_by=auth.uid()
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  RETURN QUERY
  SELECT p.id,p.name,p.email,p.public_id,p.avatar_url,e.enrolled_at
  FROM public.enrollments e
  JOIN public.profiles p ON p.id=e.user_id
  WHERE e.course_id=_course_id
  ORDER BY e.enrolled_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.course_student_progress(_course_id uuid,_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _lessons jsonb;
  _total integer;
  _completed integer;
  _enrolled_at timestamptz;
  _profile jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF public.has_role(auth.uid(),'admin'::public.app_role) THEN
    IF NOT public.admin_mfa_verified() THEN RAISE EXCEPTION 'ADMIN_MFA_REQUIRED'; END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id=_course_id AND c.created_by=auth.uid()
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT e.enrolled_at INTO _enrolled_at
  FROM public.enrollments e
  WHERE e.course_id=_course_id AND e.user_id=_user_id;

  -- Never disclose a profile or learning record for a user outside this course.
  IF _enrolled_at IS NULL THEN
    RAISE EXCEPTION 'STUDENT_NOT_ENROLLED';
  END IF;

  SELECT to_jsonb(x) INTO _profile
  FROM (
    SELECT p.id,p.name,p.email,p.public_id,p.avatar_url
    FROM public.profiles p WHERE p.id=_user_id
  ) x;

  SELECT
    jsonb_agg(row_to_json(d)::jsonb ORDER BY d.sort_order),
    count(*)::integer,
    count(*) FILTER (
      WHERE d.video_watched AND d.pdf_opened AND (NOT d.has_exam OR d.exam_completed)
    )::integer
  INTO _lessons,_total,_completed
  FROM (
    SELECT
      l.id AS lesson_id,
      l.title,
      l.sort_order,
      l.is_free,
      COALESCE(lp.video_watched,false) AS video_watched,
      COALESCE(lp.pdf_opened,false) AS pdf_opened,
      COALESCE(lp.exam_completed,false) AS exam_completed,
      lp.updated_at AS last_activity,
      EXISTS (SELECT 1 FROM public.exams ex WHERE ex.lesson_id=l.id) AS has_exam,
      (
        SELECT jsonb_agg(jsonb_build_object(
          'exam_id',r.exam_id,'score',r.score,'passed',r.passed,
          'submitted_at',r.submitted_at,'essay_graded',r.essay_graded
        ) ORDER BY r.submitted_at DESC)
        FROM public.exam_results r
        JOIN public.exams ex2 ON ex2.id=r.exam_id
        WHERE ex2.lesson_id=l.id AND r.user_id=_user_id
      ) AS exam_results
    FROM public.lessons l
    LEFT JOIN public.lesson_progress lp
      ON lp.lesson_id=l.id AND lp.user_id=_user_id
    WHERE l.course_id=_course_id
  ) d;

  RETURN jsonb_build_object(
    'profile',_profile,
    'enrolled_at',_enrolled_at,
    'total_lessons',COALESCE(_total,0),
    'completed_lessons',COALESCE(_completed,0),
    'progress',CASE WHEN COALESCE(_total,0)=0 THEN 0
      ELSE round((COALESCE(_completed,0)::numeric*100)/_total) END,
    'lessons',COALESCE(_lessons,'[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.course_enrollees(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.course_enrollees(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.course_student_progress(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.course_student_progress(uuid,uuid) TO authenticated,service_role;

COMMIT;
