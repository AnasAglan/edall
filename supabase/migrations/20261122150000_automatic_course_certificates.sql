-- Final lesson designation and automatic, idempotent certificate issuance.
-- Reuses the existing certificate table and verification API.

BEGIN;

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS is_final boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS lessons_one_final_per_course_idx
  ON public.lessons(course_id)
  WHERE is_final = true;

CREATE OR REPLACE FUNCTION public.issue_course_certificate_internal(
  _course_id uuid,
  _student_id uuid,
  _issued_by uuid,
  _automatic boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _total integer;
  _completed integer;
  _existing public.course_certificates%ROWTYPE;
  _certificate_id uuid;
  _number text;
  _token text;
  _issuer uuid := COALESCE(_issued_by,_student_id);
BEGIN
  IF _course_id IS NULL OR _student_id IS NULL THEN
    RAISE EXCEPTION 'STUDENT_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollments AS enrollment
    WHERE enrollment.course_id = _course_id
      AND enrollment.user_id = _student_id
  ) THEN
    RAISE EXCEPTION 'STUDENT_NOT_ENROLLED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.lessons AS lesson
    WHERE lesson.course_id = _course_id
      AND lesson.is_final = true
  ) THEN
    RAISE EXCEPTION 'COURSE_FINAL_LESSON_NOT_SET';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS actor
    WHERE actor.id = _issuer
  ) THEN
    RAISE EXCEPTION 'CERTIFICATE_ISSUER_NOT_FOUND';
  END IF;

  -- Serialize concurrent completion events for the same student/course.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_course_id::text || ':' || _student_id::text,0)
  );

  SELECT *
  INTO _existing
  FROM public.course_certificates AS certificate
  WHERE certificate.course_id = _course_id
    AND certificate.student_id = _student_id;

  IF FOUND AND _existing.revoked_at IS NULL THEN
    RETURN jsonb_build_object(
      'id',_existing.id,
      'certificate_number',_existing.certificate_number,
      'verification_token',_existing.verification_token,
      'existing',true
    );
  ELSIF FOUND THEN
    RAISE EXCEPTION 'CERTIFICATE_REVOKED';
  END IF;

  -- Keep the existing course-completion contract:
  -- every required video/PDF is completed, and every exam has a passing result
  -- with all essay questions graded.
  SELECT count(*),
         count(*) FILTER (
           WHERE
             (NOT EXISTS (
               SELECT 1 FROM public.lesson_videos AS video
               WHERE video.lesson_id = lesson.id
             ) OR COALESCE(progress.video_watched,false))
             AND
             (NOT EXISTS (
               SELECT 1 FROM public.lesson_files AS file
               WHERE file.lesson_id = lesson.id
             ) OR COALESCE(progress.pdf_opened,false))
             AND
             NOT EXISTS (
               SELECT 1
               FROM public.exams AS exam
               WHERE exam.lesson_id = lesson.id
                 AND NOT EXISTS (
                   SELECT 1
                   FROM public.exam_results AS result
                   WHERE result.user_id = _student_id
                     AND result.exam_id = exam.id
                     AND result.passed = true
                     AND (NOT result.has_essay OR result.essay_graded)
                 )
             )
         )
  INTO _total,_completed
  FROM public.lessons AS lesson
  LEFT JOIN public.lesson_progress AS progress
    ON progress.lesson_id = lesson.id
   AND progress.user_id = _student_id
  WHERE lesson.course_id = _course_id;

  IF _total = 0 OR _completed <> _total THEN
    RAISE EXCEPTION 'COURSE_NOT_COMPLETED';
  END IF;

  _number := 'ED-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  _token := encode(
    extensions.digest(
      convert_to(gen_random_uuid()::text || gen_random_uuid()::text,'UTF8'),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.course_certificates(
    course_id,student_id,certificate_number,verification_token,issued_by
  )
  VALUES (_course_id,_student_id,_number,_token,_issuer)
  RETURNING id INTO _certificate_id;

  PERFORM public.write_platform_audit_event(
    'certificate_issued',
    'course_certificates',
    _certificate_id,
    _course_id,
    jsonb_build_object(
      'student_id',_student_id,
      'certificate_number',_number,
      'automatic',COALESCE(_automatic,true)
    )
  );

  RETURN jsonb_build_object(
    'id',_certificate_id,
    'certificate_number',_number,
    'verification_token',_token,
    'existing',false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_course_certificate_internal(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.try_auto_issue_course_certificate(
  _course_id uuid,
  _student_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _message text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.lessons AS lesson
    WHERE lesson.course_id = _course_id
      AND lesson.is_final = true
  ) THEN
    RETURN false;
  END IF;

  PERFORM public.issue_course_certificate_internal(
    _course_id,
    _student_id,
    COALESCE(auth.uid(),_student_id)
  );
  RETURN true;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS _message = MESSAGE_TEXT;
    IF _message IN (
      'COURSE_NOT_COMPLETED',
      'COURSE_FINAL_LESSON_NOT_SET',
      'CERTIFICATE_REVOKED',
      'STUDENT_NOT_ENROLLED'
    ) THEN
      RETURN false;
    END IF;
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.try_auto_issue_course_certificate(uuid,uuid)
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.issue_course_certificate(
  _course_id uuid,
  _student_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF _student_id IS NULL THEN
    RAISE EXCEPTION 'STUDENT_REQUIRED';
  END IF;
  IF _student_id <> auth.uid()
     AND NOT public.has_course_capability(_course_id,'certificates') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF public.has_role(auth.uid(),'admin'::public.app_role)
     AND NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;

  RETURN public.issue_course_certificate_internal(_course_id,_student_id,auth.uid(),false);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_course_certificate(uuid,uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_course_certificate(uuid,uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_course_final_lesson(
  _course_id uuid,
  _lesson_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _student_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_course_capability(_course_id,'certificates') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF public.has_role(auth.uid(),'admin'::public.app_role)
     AND NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.courses AS course WHERE course.id = _course_id
  ) THEN
    RAISE EXCEPTION 'COURSE_NOT_FOUND';
  END IF;
  IF _lesson_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.lessons AS lesson
    WHERE lesson.id = _lesson_id
      AND lesson.course_id = _course_id
  ) THEN
    RAISE EXCEPTION 'LESSON_NOT_IN_COURSE';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('edall-final-lesson:' || _course_id::text,0)
  );

  UPDATE public.lessons
  SET is_final = false
  WHERE course_id = _course_id
    AND is_final = true;

  IF _lesson_id IS NOT NULL THEN
    UPDATE public.lessons
    SET is_final = true
    WHERE id = _lesson_id
      AND course_id = _course_id;
  END IF;

  PERFORM public.write_platform_audit_event(
    CASE WHEN _lesson_id IS NULL THEN 'course_final_lesson_cleared' ELSE 'course_final_lesson_set' END,
    'lessons',
    _lesson_id,
    _course_id,
    jsonb_build_object('final_lesson_id',_lesson_id)
  );

  -- If the final lesson is designated after students already completed the
  -- course, evaluate those students immediately rather than waiting for a new event.
  FOR _student_id IN
    SELECT enrollment.user_id
    FROM public.enrollments AS enrollment
    WHERE enrollment.course_id = _course_id
  LOOP
    PERFORM public.try_auto_issue_course_certificate(_course_id,_student_id);
  END LOOP;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_course_final_lesson(uuid,uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_course_final_lesson(uuid,uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.auto_issue_course_certificate_from_lesson_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _course_id uuid;
BEGIN
  SELECT lesson.course_id
  INTO _course_id
  FROM public.lessons AS lesson
  WHERE lesson.id = NEW.lesson_id;

  IF _course_id IS NOT NULL THEN
    PERFORM public.try_auto_issue_course_certificate(_course_id,NEW.user_id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_issue_course_certificate_from_exam_result()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _course_id uuid;
  _lesson_id uuid;
BEGIN
  SELECT lesson.course_id,lesson.id
  INTO _course_id,_lesson_id
  FROM public.exams AS exam
  JOIN public.lessons AS lesson ON lesson.id = exam.lesson_id
  WHERE exam.id = NEW.exam_id;

  IF _course_id IS NOT NULL THEN
    PERFORM public.try_auto_issue_course_certificate(_course_id,NEW.user_id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_issue_course_certificate_from_lesson_progress()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.auto_issue_course_certificate_from_exam_result()
  FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS auto_issue_course_certificate_lesson_progress ON public.lesson_progress;
CREATE TRIGGER auto_issue_course_certificate_lesson_progress
AFTER INSERT OR UPDATE OF video_watched,pdf_opened,exam_completed
ON public.lesson_progress
FOR EACH ROW
EXECUTE FUNCTION public.auto_issue_course_certificate_from_lesson_progress();

DROP TRIGGER IF EXISTS auto_issue_course_certificate_exam_results ON public.exam_results;
CREATE TRIGGER auto_issue_course_certificate_exam_results
AFTER INSERT OR UPDATE OF passed,has_essay,essay_graded
ON public.exam_results
FOR EACH ROW
EXECUTE FUNCTION public.auto_issue_course_certificate_from_exam_result();

NOTIFY pgrst, 'reload schema';

COMMIT;
