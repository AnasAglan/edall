-- Aggregate Learning Space analytics across only the courses the caller can analyze.
-- Administrators use the existing global platform analytics RPC.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_teacher_analytics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _is_admin boolean;
  _course record;
  _course_data jsonb;
  _course_rows jsonb := '[]'::jsonb;
  _totals jsonb := jsonb_build_object(
    'courses',0,
    'enrolled',0,
    'assignments',0,
    'submissions',0,
    'graded_submissions',0,
    'attendance_sessions',0,
    'attendance_records',0,
    'present',0,
    'late',0,
    'absent',0,
    'excused',0,
    'valid_certificates',0,
    'exams',0,
    'exam_results',0
  );
  _enrolled integer;
  _assignments integer;
  _submissions integer;
  _graded integer;
  _sessions integer;
  _records integer;
  _present integer;
  _late integer;
  _absent integer;
  _excused integer;
  _certificates integer;
  _exams integer;
  _exam_results integer;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  _is_admin := public.has_role(_actor,'admin'::public.app_role);
  IF _is_admin AND NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;

  -- A global admin does not accidentally receive a course-scoped teacher view.
  -- Their global dashboard remains get_platform_analytics().
  FOR _course IN
    SELECT course.id,course.title
    FROM public.courses AS course
    WHERE (
      _is_admin
      OR public.has_course_capability(course.id,'analytics')
    )
    ORDER BY course.title,course.id
  LOOP
    _course_data := public.get_course_analytics(_course.id);

    SELECT count(*)::integer INTO _exams
    FROM public.exams AS exam
    JOIN public.lessons AS lesson ON lesson.id = exam.lesson_id
    WHERE lesson.course_id = _course.id;

    SELECT count(*)::integer INTO _exam_results
    FROM public.exam_results AS result
    JOIN public.exams AS exam ON exam.id = result.exam_id
    JOIN public.lessons AS lesson ON lesson.id = exam.lesson_id
    WHERE lesson.course_id = _course.id;

    SELECT
      count(*) FILTER (WHERE record.status = 'present')::integer,
      count(*) FILTER (WHERE record.status = 'late')::integer,
      count(*) FILTER (WHERE record.status = 'absent')::integer,
      count(*) FILTER (WHERE record.status = 'excused')::integer
    INTO _present,_late,_absent,_excused
    FROM public.attendance_records AS record
    JOIN public.attendance_sessions AS session ON session.id = record.session_id
    WHERE session.course_id = _course.id;

    _enrolled := COALESCE((_course_data->>'enrolled')::integer,0);
    _assignments := COALESCE((_course_data->>'assignments')::integer,0);
    _submissions := COALESCE((_course_data->>'submissions')::integer,0);
    _graded := COALESCE((_course_data->>'graded_submissions')::integer,0);
    _sessions := COALESCE((_course_data->>'attendance_sessions')::integer,0);
    _records := COALESCE(_present,0)+COALESCE(_late,0)+COALESCE(_absent,0)+COALESCE(_excused,0);
    _certificates := COALESCE((_course_data->>'valid_certificates')::integer,0);

    _course_data := _course_data || jsonb_build_object(
      'course_title',_course.title,
      'exams',COALESCE(_exams,0),
      'exam_results',COALESCE(_exam_results,0),
      'attendance_records',_records,
      'present',COALESCE(_present,0),
      'late',COALESCE(_late,0),
      'absent',COALESCE(_absent,0),
      'excused',COALESCE(_excused,0)
    );

    _course_rows := _course_rows || jsonb_build_array(_course_data);
    _totals := jsonb_build_object(
      'courses',COALESCE((_totals->>'courses')::integer,0)+1,
      'enrolled',COALESCE((_totals->>'enrolled')::integer,0)+_enrolled,
      'assignments',COALESCE((_totals->>'assignments')::integer,0)+_assignments,
      'submissions',COALESCE((_totals->>'submissions')::integer,0)+_submissions,
      'graded_submissions',COALESCE((_totals->>'graded_submissions')::integer,0)+_graded,
      'attendance_sessions',COALESCE((_totals->>'attendance_sessions')::integer,0)+_sessions,
      'attendance_records',COALESCE((_totals->>'attendance_records')::integer,0)+_records,
      'present',COALESCE((_totals->>'present')::integer,0)+COALESCE(_present,0),
      'late',COALESCE((_totals->>'late')::integer,0)+COALESCE(_late,0),
      'absent',COALESCE((_totals->>'absent')::integer,0)+COALESCE(_absent,0),
      'excused',COALESCE((_totals->>'excused')::integer,0)+COALESCE(_excused,0),
      'valid_certificates',COALESCE((_totals->>'valid_certificates')::integer,0)+_certificates,
      'exams',COALESCE((_totals->>'exams')::integer,0)+COALESCE(_exams,0),
      'exam_results',COALESCE((_totals->>'exam_results')::integer,0)+COALESCE(_exam_results,0)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'scope',CASE WHEN _is_admin THEN 'administrator' ELSE 'assigned_courses' END,
    'totals',_totals,
    'courses',_course_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_teacher_analytics()
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_teacher_analytics()
  TO authenticated;

COMMENT ON FUNCTION public.get_teacher_analytics()
  IS 'Aggregates Learning Space metrics over only courses the caller can analyze. Global administrator reports remain on get_platform_analytics and require AAL2.';

NOTIFY pgrst, 'reload schema';

COMMIT;
