-- Correct platform-wide statistics to count Auth accounts and actual in-progress attempts.
-- Keep the function deployable on clean environments where the manually introduced
-- exam_attempts table does not yet exist; report its tracking availability explicitly.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_platform_analytics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _users integer;
  _profiles integer;
  _unlinked_profiles integer;
  _students integer;
  _teachers integer;
  _admins integer;
  _courses integer;
  _lessons integer;
  _lesson_videos integer;
  _lesson_files integer;
  _enrollments integer;
  _exams integer;
  _exam_attempts integer := 0;
  _exam_attempts_tracked boolean := false;
  _assignments integer;
  _submissions integer;
  _live_classes integer;
  _certificates integer;
  _payment_orders integer;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(),'admin'::public.app_role)
     OR NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;

  -- Count actual Auth accounts, including accounts with missing profiles.
  SELECT count(*)::integer INTO _users FROM auth.users;
  SELECT count(*)::integer INTO _profiles FROM public.profiles;
  _unlinked_profiles := GREATEST(_users - _profiles, 0);

  SELECT count(DISTINCT user_id)::integer INTO _students
  FROM public.user_roles WHERE role='student'::public.app_role;
  SELECT count(DISTINCT user_id)::integer INTO _teachers
  FROM public.user_roles WHERE role='teacher'::public.app_role;
  SELECT count(DISTINCT user_id)::integer INTO _admins
  FROM public.user_roles WHERE role='admin'::public.app_role;

  SELECT count(*)::integer INTO _courses FROM public.courses;
  SELECT count(*)::integer INTO _lessons FROM public.lessons;
  SELECT count(*)::integer INTO _lesson_videos FROM public.lesson_videos;
  SELECT count(*)::integer INTO _lesson_files FROM public.lesson_files;
  SELECT count(*)::integer INTO _enrollments FROM public.enrollments;
  SELECT count(*)::integer INTO _exams FROM public.exams;

  -- exam_attempts was created outside the original migration chain in some
  -- environments. Probe it safely and never substitute submitted results for attempts.
  IF pg_catalog.to_regclass('public.exam_attempts') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::integer FROM public.exam_attempts'
      INTO _exam_attempts;
    _exam_attempts_tracked := true;
  END IF;

  SELECT count(*)::integer INTO _assignments FROM public.assignments;
  SELECT count(*)::integer INTO _submissions FROM public.assignment_submissions;
  SELECT count(*)::integer INTO _live_classes FROM public.live_classes;
  SELECT count(*)::integer INTO _certificates
  FROM public.course_certificates WHERE revoked_at IS NULL;
  SELECT count(*)::integer INTO _payment_orders FROM public.payment_orders;

  RETURN jsonb_build_object(
    'users',_users,
    'profiles',_profiles,
    'unlinked_profiles',_unlinked_profiles,
    'students',_students,
    'teachers',_teachers,
    'admins',_admins,
    'courses',_courses,
    'lessons',_lessons,
    'lesson_video_links',_lesson_videos,
    'lesson_pdf_links',_lesson_files,
    'enrollments',_enrollments,
    'exams',_exams,
    'exam_attempts',_exam_attempts,
    'exam_attempts_tracked',_exam_attempts_tracked,
    'assignments',_assignments,
    'submissions',_submissions,
    'live_classes',_live_classes,
    'certificates',_certificates,
    'payment_orders',_payment_orders
  );
END;
$function$;

COMMENT ON FUNCTION public.get_platform_analytics()
  IS 'AAL2-protected platform statistics. Counts Auth accounts and distinguishes real exam_attempts tracking from submitted exam_results.';

NOTIFY pgrst, 'reload schema';

COMMIT;
