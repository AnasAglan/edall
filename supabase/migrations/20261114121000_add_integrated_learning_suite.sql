-- ED-ALL integrated learning suite.
-- Server-authoritative data model: identities, prices, completion, and course
-- ownership are derived from trusted database records, never from browser claims.
-- External payment and meeting providers remain disabled until configured.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Course-scoped staff permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.course_staff_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('instructor','assistant','moderator','analyst')),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)
);

CREATE OR REPLACE FUNCTION public.has_course_capability(_course_id uuid, _capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = _course_id AND c.created_by = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.course_staff_roles r
      WHERE r.course_id = _course_id
        AND r.user_id = auth.uid()
        AND (
          r.role = 'instructor'
          OR (r.role = 'assistant' AND _capability IN ('assignments','attendance','live_classes'))
          OR (r.role = 'moderator' AND _capability = 'discussions')
          OR (r.role = 'analyst' AND _capability = 'analytics')
        )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.grant_course_staff_role(
  _course_id uuid,
  _user_id uuid,
  _role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _id uuid;
BEGIN
  IF auth.uid() IS NULL OR (
    NOT public.has_role(auth.uid(), 'admin'::public.app_role)
    AND NOT EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = _course_id AND c.created_by = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF _role NOT IN ('instructor','assistant','moderator','analyst') THEN
    RAISE EXCEPTION 'INVALID_COURSE_ROLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role IN ('teacher'::public.app_role,'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'COURSE_STAFF_MUST_BE_TEACHER_OR_ADMIN';
  END IF;

  INSERT INTO public.course_staff_roles(course_id,user_id,role,granted_by)
  VALUES (_course_id,_user_id,_role,auth.uid())
  ON CONFLICT (course_id,user_id)
  DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by
  RETURNING id INTO _id;

  PERFORM public.write_platform_audit_event(
    'course_staff_role_granted','course_staff_roles',_id,_course_id,
    jsonb_build_object('user_id',_user_id,'role',_role)
  );
  RETURN _id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_course_staff_role(_course_id uuid,_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _deleted uuid;
BEGIN
  IF auth.uid() IS NULL OR (
    NOT public.has_role(auth.uid(), 'admin'::public.app_role)
    AND NOT EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = _course_id AND c.created_by = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  DELETE FROM public.course_staff_roles
  WHERE course_id = _course_id AND user_id = _user_id
  RETURNING id INTO _deleted;
  IF _deleted IS NOT NULL THEN
    PERFORM public.write_platform_audit_event(
      'course_staff_role_revoked','course_staff_roles',_deleted,_course_id,
      jsonb_build_object('user_id',_user_id)
    );
  END IF;
  RETURN _deleted IS NOT NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Assignments and submissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 180),
  description text NOT NULL DEFAULT '',
  due_at timestamptz,
  max_score numeric(8,2) NOT NULL DEFAULT 100 CHECK (max_score > 0 AND max_score <= 100000),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignments_lesson_matches_course CHECK (lesson_id IS NULL OR course_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.assignment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array'),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  is_late boolean NOT NULL DEFAULT false,
  score numeric(8,2),
  feedback text,
  graded_at timestamptz,
  graded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS assignments_course_due_idx
  ON public.assignments(course_id,due_at);
CREATE INDEX IF NOT EXISTS assignment_submissions_student_idx
  ON public.assignment_submissions(student_id,submitted_at DESC);
CREATE INDEX IF NOT EXISTS assignment_submissions_assignment_idx
  ON public.assignment_submissions(assignment_id,submitted_at DESC);

CREATE OR REPLACE FUNCTION public.create_assignment(
  _course_id uuid,
  _lesson_id uuid,
  _title text,
  _description text,
  _due_at timestamptz,
  _max_score numeric DEFAULT 100
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_course_capability(_course_id,'assignments') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF length(btrim(COALESCE(_title,''))) NOT BETWEEN 1 AND 180
     OR length(COALESCE(_description,'')) > 12000
     OR _max_score IS NULL OR _max_score <= 0 OR _max_score > 100000 THEN
    RAISE EXCEPTION 'INVALID_ASSIGNMENT';
  END IF;
  IF _lesson_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.lessons l WHERE l.id = _lesson_id AND l.course_id = _course_id
  ) THEN
    RAISE EXCEPTION 'LESSON_NOT_IN_COURSE';
  END IF;

  INSERT INTO public.assignments(course_id,lesson_id,title,description,due_at,max_score,created_by)
  VALUES (_course_id,_lesson_id,btrim(_title),COALESCE(_description,''),_due_at,_max_score,auth.uid())
  RETURNING id INTO _id;

  PERFORM public.write_platform_audit_event(
    'assignment_created','assignments',_id,_course_id,jsonb_build_object('title',btrim(_title))
  );
  RETURN _id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_assignment(
  _assignment_id uuid,
  _content text,
  _attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _course_id uuid;
  _due_at timestamptz;
  _id uuid;
  _attachment jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT a.course_id,a.due_at INTO _course_id,_due_at
  FROM public.assignments a
  WHERE a.id = _assignment_id AND a.is_published = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.course_id = _course_id AND e.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'ENROLLMENT_REQUIRED';
  END IF;
  IF length(COALESCE(_content,'')) > 30000
     OR jsonb_typeof(COALESCE(_attachments,'[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(_attachments,'[]'::jsonb)) > 5 THEN
    RAISE EXCEPTION 'INVALID_SUBMISSION';
  END IF;

  FOR _attachment IN SELECT value FROM jsonb_array_elements(COALESCE(_attachments,'[]'::jsonb))
  LOOP
    IF COALESCE(_attachment->>'path','') !~ (
      '^' || auth.uid()::text || '/' || _assignment_id::text || '/[A-Za-z0-9_. -]{1,180}$'
    ) THEN
      RAISE EXCEPTION 'INVALID_ATTACHMENT_PATH';
    END IF;
  END LOOP;

  INSERT INTO public.assignment_submissions(assignment_id,student_id,content,attachments,is_late)
  VALUES (_assignment_id,auth.uid(),COALESCE(_content,''),COALESCE(_attachments,'[]'::jsonb),_due_at IS NOT NULL AND now() > _due_at)
  ON CONFLICT (assignment_id,student_id)
  DO UPDATE SET
    content = EXCLUDED.content,
    attachments = EXCLUDED.attachments,
    submitted_at = now(),
    is_late = EXCLUDED.is_late,
    score = NULL,
    feedback = NULL,
    graded_at = NULL,
    graded_by = NULL,
    updated_at = now()
  RETURNING id INTO _id;

  RETURN _id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.grade_assignment_submission(
  _submission_id uuid,
  _score numeric,
  _feedback text DEFAULT ''
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _course_id uuid; _max_score numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT a.course_id,a.max_score INTO _course_id,_max_score
  FROM public.assignment_submissions s
  JOIN public.assignments a ON a.id=s.assignment_id
  WHERE s.id=_submission_id;
  IF NOT FOUND OR NOT public.has_course_capability(_course_id,'assignments') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF _score IS NULL OR _score < 0 OR _score > _max_score OR length(COALESCE(_feedback,'')) > 6000 THEN
    RAISE EXCEPTION 'INVALID_GRADE';
  END IF;
  UPDATE public.assignment_submissions
  SET score=_score,feedback=COALESCE(_feedback,''),graded_at=now(),graded_by=auth.uid(),updated_at=now()
  WHERE id=_submission_id;

  PERFORM public.write_platform_audit_event(
    'assignment_graded','assignment_submissions',_submission_id,_course_id,
    jsonb_build_object('score',_score,'max_score',_max_score)
  );
  RETURN true;
END;
$function$;

-- Private student file submissions, using path studentId/assignmentId/fileName.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES (
  'assignment-submissions','assignment-submissions',false,20971520,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public=false,
  file_size_limit=20971520,
  allowed_mime_types=EXCLUDED.allowed_mime_types;

DO $assignment_storage_cleanup$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='storage'
      AND tablename='objects'
      AND (
        COALESCE(qual,'') ILIKE '%assignment-submissions%'
        OR COALESCE(with_check,'') ILIKE '%assignment-submissions%'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects',p.policyname);
  END LOOP;
END;
$assignment_storage_cleanup$;

CREATE POLICY "Students upload own assignment files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='assignment-submissions'
  AND split_part(name,'/',1)=auth.uid()::text
  AND split_part(name,'/',1) ~* '^[0-9a-f-]{36}$'
  AND split_part(name,'/',2) ~* '^[0-9a-f-]{36}$'
  AND EXISTS (
    SELECT 1 FROM public.assignments a
    JOIN public.enrollments e ON e.course_id=a.course_id
    WHERE a.id::text=split_part(name,'/',2)
      AND e.user_id=auth.uid()
  )
);

CREATE POLICY "Students and course staff read assignment files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='assignment-submissions'
  AND split_part(name,'/',1) ~* '^[0-9a-f-]{36}$'
  AND split_part(name,'/',2) ~* '^[0-9a-f-]{36}$'
  AND EXISTS (
    SELECT 1
    FROM public.assignment_submissions s
    JOIN public.assignments a ON a.id=s.assignment_id
    WHERE a.id::text=split_part(name,'/',2)
      AND (
        s.student_id=auth.uid()
        OR public.has_course_capability(a.course_id,'assignments')
      )
  )
);

-- ---------------------------------------------------------------------------
-- 3. Attendance
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 180),
  starts_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('present','absent','late','excused')),
  note text,
  marked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  marked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,student_id)
);
CREATE INDEX IF NOT EXISTS attendance_sessions_course_idx
  ON public.attendance_sessions(course_id,starts_at DESC);
CREATE INDEX IF NOT EXISTS attendance_records_student_idx
  ON public.attendance_records(student_id,marked_at DESC);

CREATE OR REPLACE FUNCTION public.create_attendance_session(
  _course_id uuid,_title text,_starts_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_course_capability(_course_id,'attendance') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF length(btrim(COALESCE(_title,''))) NOT BETWEEN 1 AND 180 THEN
    RAISE EXCEPTION 'INVALID_ATTENDANCE_SESSION';
  END IF;
  INSERT INTO public.attendance_sessions(course_id,title,starts_at,created_by)
  VALUES (_course_id,btrim(_title),COALESCE(_starts_at,now()),auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_attendance(
  _session_id uuid,_student_id uuid,_status text,_note text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _course_id uuid; _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT s.course_id INTO _course_id FROM public.attendance_sessions s WHERE s.id=_session_id;
  IF NOT FOUND OR NOT public.has_course_capability(_course_id,'attendance') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF _status NOT IN ('present','absent','late','excused')
     OR length(COALESCE(_note,'')) > 500 THEN
    RAISE EXCEPTION 'INVALID_ATTENDANCE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.course_id=_course_id AND e.user_id=_student_id
  ) THEN RAISE EXCEPTION 'STUDENT_NOT_ENROLLED'; END IF;

  INSERT INTO public.attendance_records(session_id,student_id,status,note,marked_by)
  VALUES (_session_id,_student_id,_status,COALESCE(_note,''),auth.uid())
  ON CONFLICT (session_id,student_id)
  DO UPDATE SET status=EXCLUDED.status,note=EXCLUDED.note,marked_by=EXCLUDED.marked_by,marked_at=now()
  RETURNING id INTO _id;
  PERFORM public.write_platform_audit_event(
    'attendance_marked','attendance_records',_id,_course_id,
    jsonb_build_object('session_id',_session_id,'student_id',_student_id,'status',_status)
  );
  RETURN _id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Live-class scheduling (meeting links only; no hosted video service)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.live_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 180),
  description text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  meeting_url text NOT NULL,
  provider text NOT NULL DEFAULT 'external',
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled','completed')),
  recording_url text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (meeting_url ~* '^https://[^[:space:]]+$'),
  CHECK (recording_url IS NULL OR recording_url ~* '^https://[^[:space:]]+$')
);
CREATE INDEX IF NOT EXISTS live_classes_course_start_idx
  ON public.live_classes(course_id,starts_at);

CREATE OR REPLACE FUNCTION public.create_live_class(
  _course_id uuid,_title text,_description text,_starts_at timestamptz,
  _ends_at timestamptz,_meeting_url text,_provider text DEFAULT 'external'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_course_capability(_course_id,'live_classes') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF length(btrim(COALESCE(_title,''))) NOT BETWEEN 1 AND 180
     OR length(COALESCE(_description,'')) > 5000
     OR _starts_at IS NULL OR _ends_at IS NULL OR _ends_at <= _starts_at
     OR COALESCE(_meeting_url,'') !~* '^https://[^[:space:]]+$'
     OR _provider NOT IN ('external','zoom','google_meet','microsoft_teams','other') THEN
    RAISE EXCEPTION 'INVALID_LIVE_CLASS';
  END IF;
  INSERT INTO public.live_classes(course_id,title,description,starts_at,ends_at,meeting_url,provider,created_by)
  VALUES (_course_id,btrim(_title),COALESCE(_description,''),_starts_at,_ends_at,_meeting_url,_provider,auth.uid())
  RETURNING id INTO _id;
  PERFORM public.write_platform_audit_event(
    'live_class_created','live_classes',_id,_course_id,
    jsonb_build_object('title',btrim(_title),'starts_at',_starts_at,'ends_at',_ends_at,'provider',_provider)
  );
  RETURN _id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_live_class_status(
  _live_class_id uuid,_status text,_recording_url text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _course_id uuid;
BEGIN
  SELECT c.course_id INTO _course_id
  FROM public.live_classes c WHERE c.id=_live_class_id;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_course_capability(_course_id,'live_classes') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF _status NOT IN ('scheduled','cancelled','completed')
     OR (_recording_url IS NOT NULL AND _recording_url !~* '^https://[^[:space:]]+$') THEN
    RAISE EXCEPTION 'INVALID_LIVE_CLASS_STATUS';
  END IF;
  UPDATE public.live_classes
  SET status=_status,recording_url=_recording_url,updated_at=now()
  WHERE id=_live_class_id;
  PERFORM public.write_platform_audit_event(
    'live_class_updated','live_classes',_live_class_id,_course_id,
    jsonb_build_object('status',_status,'recording_url_present',_recording_url IS NOT NULL)
  );
  RETURN true;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Course certificates with private verification tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.course_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  certificate_number text NOT NULL UNIQUE,
  verification_token text NOT NULL UNIQUE,
  issued_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(course_id,student_id)
);
CREATE INDEX IF NOT EXISTS course_certificates_student_idx
  ON public.course_certificates(student_id,issued_at DESC);

CREATE OR REPLACE FUNCTION public.issue_course_certificate(_course_id uuid,_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _total integer;
  _completed integer;
  _existing public.course_certificates%ROWTYPE;
  _id uuid;
  _number text;
  _token text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_course_capability(_course_id,'certificates') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.course_id=_course_id AND e.user_id=_student_id
  ) THEN RAISE EXCEPTION 'STUDENT_NOT_ENROLLED'; END IF;

  SELECT count(*),
         count(*) FILTER (WHERE COALESCE(lp.video_watched,false) OR COALESCE(lp.exam_completed,false))
  INTO _total,_completed
  FROM public.lessons l
  LEFT JOIN public.lesson_progress lp
    ON lp.lesson_id=l.id AND lp.user_id=_student_id
  WHERE l.course_id=_course_id;

  IF _total=0 OR _completed<>_total THEN
    RAISE EXCEPTION 'COURSE_NOT_COMPLETED';
  END IF;

  SELECT * INTO _existing FROM public.course_certificates
  WHERE course_id=_course_id AND student_id=_student_id;
  IF FOUND AND _existing.revoked_at IS NULL THEN
    RETURN jsonb_build_object(
      'id',_existing.id,'certificate_number',_existing.certificate_number,
      'verification_token',_existing.verification_token,'existing',true
    );
  ELSIF FOUND THEN
    RAISE EXCEPTION 'CERTIFICATE_REVOKED';
  END IF;

  _number := 'ED-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
  _token := encode(
    sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text,'UTF8')),
    'hex'
  );
  INSERT INTO public.course_certificates(course_id,student_id,certificate_number,verification_token,issued_by)
  VALUES (_course_id,_student_id,_number,_token,auth.uid())
  RETURNING id INTO _id;

  PERFORM public.write_platform_audit_event(
    'certificate_issued','course_certificates',_id,_course_id,
    jsonb_build_object('student_id',_student_id,'certificate_number',_number)
  );
  RETURN jsonb_build_object(
    'id',_id,'certificate_number',_number,'verification_token',_token,'existing',false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_course_certificate(_certificate_id uuid,_reason text DEFAULT '')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _course_id uuid;
BEGIN
  SELECT c.course_id INTO _course_id FROM public.course_certificates c WHERE c.id=_certificate_id;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_course_capability(_course_id,'certificates') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF length(COALESCE(_reason,'')) > 1000 THEN RAISE EXCEPTION 'INVALID_REASON'; END IF;
  UPDATE public.course_certificates
  SET revoked_at=COALESCE(revoked_at,now()),revoked_by=auth.uid()
  WHERE id=_certificate_id;
  PERFORM public.write_platform_audit_event(
    'certificate_revoked','course_certificates',_certificate_id,_course_id,
    jsonb_build_object('reason',COALESCE(_reason,''))
  );
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_course_certificate(_token text)
RETURNS TABLE(
  certificate_number text,
  course_title text,
  student_name text,
  issued_at timestamptz,
  is_valid boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT cc.certificate_number,c.title,p.name,cc.issued_at,(cc.revoked_at IS NULL)
  FROM public.course_certificates cc
  JOIN public.courses c ON c.id=cc.course_id
  JOIN public.profiles p ON p.id=cc.student_id
  WHERE cc.verification_token=_token
    AND _token ~ '^[0-9a-f]{64}$'
  LIMIT 1;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Course discussions and moderation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discussion_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.lessons(id) ON DELETE SET NULL,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 180),
  is_pinned boolean NOT NULL DEFAULT false,
  is_hidden boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.discussion_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.discussion_topics(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 12000),
  is_hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discussion_topics_course_idx
  ON public.discussion_topics(course_id,created_at DESC);
CREATE INDEX IF NOT EXISTS discussion_posts_topic_idx
  ON public.discussion_posts(topic_id,created_at);

CREATE OR REPLACE FUNCTION public.create_discussion_topic(
  _course_id uuid,_lesson_id uuid,_title text,_content text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT (
    public.has_course_capability(_course_id,'discussions')
    OR EXISTS (SELECT 1 FROM public.enrollments e WHERE e.course_id=_course_id AND e.user_id=auth.uid())
  ) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF length(btrim(COALESCE(_title,''))) NOT BETWEEN 1 AND 180
     OR length(btrim(COALESCE(_content,''))) NOT BETWEEN 1 AND 12000 THEN
    RAISE EXCEPTION 'INVALID_DISCUSSION';
  END IF;
  IF _lesson_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.lessons l WHERE l.id=_lesson_id AND l.course_id=_course_id
  ) THEN RAISE EXCEPTION 'LESSON_NOT_IN_COURSE'; END IF;

  INSERT INTO public.discussion_topics(course_id,lesson_id,author_id,title)
  VALUES (_course_id,_lesson_id,auth.uid(),btrim(_title))
  RETURNING id INTO _id;
  INSERT INTO public.discussion_posts(topic_id,author_id,content)
  VALUES (_id,auth.uid(),btrim(_content));
  RETURN _id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_discussion_post(_topic_id uuid,_content text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _course_id uuid; _locked boolean; _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT t.course_id,t.is_locked INTO _course_id,_locked
  FROM public.discussion_topics t
  WHERE t.id=_topic_id AND NOT t.is_hidden;
  IF NOT FOUND OR _locked THEN RAISE EXCEPTION 'DISCUSSION_CLOSED'; END IF;
  IF NOT (
    public.has_course_capability(_course_id,'discussions')
    OR EXISTS (SELECT 1 FROM public.enrollments e WHERE e.course_id=_course_id AND e.user_id=auth.uid())
  ) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;
  IF length(btrim(COALESCE(_content,''))) NOT BETWEEN 1 AND 12000 THEN
    RAISE EXCEPTION 'INVALID_DISCUSSION_POST';
  END IF;
  INSERT INTO public.discussion_posts(topic_id,author_id,content)
  VALUES (_topic_id,auth.uid(),btrim(_content))
  RETURNING id INTO _id;
  RETURN _id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.moderate_discussion_post(_post_id uuid,_hidden boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _course_id uuid;
BEGIN
  SELECT t.course_id INTO _course_id
  FROM public.discussion_posts p
  JOIN public.discussion_topics t ON t.id=p.topic_id
  WHERE p.id=_post_id;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_course_capability(_course_id,'discussions') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  UPDATE public.discussion_posts SET is_hidden=_hidden,updated_at=now() WHERE id=_post_id;
  PERFORM public.write_platform_audit_event(
    'discussion_post_moderated','discussion_posts',_post_id,_course_id,
    jsonb_build_object('hidden',_hidden)
  );
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.moderate_discussion_topic(
  _topic_id uuid,_hidden boolean,_locked boolean,_pinned boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _course_id uuid;
BEGIN
  SELECT t.course_id INTO _course_id FROM public.discussion_topics t WHERE t.id=_topic_id;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT public.has_course_capability(_course_id,'discussions') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  UPDATE public.discussion_topics
  SET is_hidden=_hidden,is_locked=_locked,is_pinned=_pinned,updated_at=now()
  WHERE id=_topic_id;
  PERFORM public.write_platform_audit_event(
    'discussion_topic_moderated','discussion_topics',_topic_id,_course_id,
    jsonb_build_object('hidden',_hidden,'locked',_locked,'pinned',_pinned)
  );
  RETURN true;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Egyptian payment provider adapter boundary (disabled by default)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_provider_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency='EGP'),
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_binding_name text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.payment_provider_settings(provider_code,display_name,enabled,currency)
VALUES ('primary','Payment provider not configured',false,'EGP')
ON CONFLICT (provider_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'EGP' CHECK (currency='EGP'),
  provider text NOT NULL DEFAULT 'unconfigured',
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','pending','paid','failed','cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  provider_reference text UNIQUE,
  checkout_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS payment_orders_user_idx
  ON public.payment_orders(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS payment_orders_status_idx
  ON public.payment_orders(status,created_at);

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  order_id uuid REFERENCES public.payment_orders(id) ON DELETE SET NULL,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  signature_verified boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_event_id)
);
CREATE INDEX IF NOT EXISTS payment_webhook_events_order_idx
  ON public.payment_webhook_events(order_id,received_at DESC);

CREATE OR REPLACE FUNCTION public.create_payment_order(_course_id uuid,_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _price numeric(12,2);
  _provider public.payment_provider_settings%ROWTYPE;
  _order public.payment_orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF length(COALESCE(_idempotency_key,'')) NOT BETWEEN 16 AND 120 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY';
  END IF;
  SELECT * INTO _provider FROM public.payment_provider_settings
  WHERE provider_code='primary' AND enabled=true;
  IF NOT FOUND OR _provider.secret_binding_name IS NULL OR btrim(_provider.secret_binding_name)='' THEN
    RAISE EXCEPTION 'PAYMENT_PROVIDER_NOT_CONFIGURED';
  END IF;
  SELECT c.price INTO _price FROM public.courses c WHERE c.id=_course_id;
  IF NOT FOUND OR _price IS NULL OR _price<=0 THEN RAISE EXCEPTION 'COURSE_NOT_PAYABLE'; END IF;
  IF EXISTS (SELECT 1 FROM public.enrollments e WHERE e.user_id=auth.uid() AND e.course_id=_course_id) THEN
    RAISE EXCEPTION 'ALREADY_ENROLLED';
  END IF;

  INSERT INTO public.payment_orders(user_id,course_id,amount,currency,provider,status,idempotency_key)
  VALUES (auth.uid(),_course_id,_price,'EGP',_provider.provider_code,'created',_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO _order;

  IF NOT FOUND THEN
    SELECT * INTO _order FROM public.payment_orders WHERE idempotency_key=_idempotency_key;
  END IF;
  IF _order.user_id<>auth.uid() OR _order.course_id<>_course_id THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT';
  END IF;

  RETURN jsonb_build_object(
    'order_id',_order.id,'status',_order.status,'amount',_order.amount,
    'currency',_order.currency,'checkout_url',_order.checkout_url,
    'provider',_order.provider
  );
END;
$function$;

-- This RPC is callable only by a server-role webhook after provider-specific
-- signature verification, merchant/order matching, amount and currency checks.
CREATE OR REPLACE FUNCTION public.fulfill_payment_order(
  _order_id uuid,
  _provider text,
  _provider_event_id text,
  _paid_amount numeric,
  _currency text,
  _payload_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _order public.payment_orders%ROWTYPE;
  _existing_event public.payment_webhook_events%ROWTYPE;
  _event_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED'; END IF;
  IF length(COALESCE(_provider_event_id,'')) NOT BETWEEN 1 AND 200
     OR COALESCE(_payload_sha256,'') !~ '^[0-9a-f]{64}$'
     OR _currency <> 'EGP' THEN
    RAISE EXCEPTION 'INVALID_VERIFIED_PAYMENT_EVENT';
  END IF;

  INSERT INTO public.payment_webhook_events(
    provider,provider_event_id,order_id,payload_sha256,signature_verified
  ) VALUES (_provider,_provider_event_id,_order_id,_payload_sha256,true)
  ON CONFLICT (provider,provider_event_id) DO NOTHING
  RETURNING id INTO _event_id;

  IF _event_id IS NULL THEN
    SELECT * INTO _existing_event
    FROM public.payment_webhook_events
    WHERE provider=_provider AND provider_event_id=_provider_event_id;
    IF NOT FOUND
       OR _existing_event.order_id IS DISTINCT FROM _order_id
       OR _existing_event.payload_sha256 IS DISTINCT FROM _payload_sha256
       OR _existing_event.signature_verified IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'WEBHOOK_EVENT_ID_CONFLICT';
    END IF;
    SELECT * INTO _order FROM public.payment_orders WHERE id=_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
    RETURN jsonb_build_object('ok',_order.status='paid','duplicate_event',true,'status',_order.status);
  END IF;

  SELECT * INTO _order FROM public.payment_orders WHERE id=_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF _order.status='paid' THEN
    UPDATE public.payment_webhook_events SET processed_at=now() WHERE id=_event_id;
    RETURN jsonb_build_object('ok',true,'already_paid',true,'status','paid');
  END IF;
  IF _order.provider<>_provider OR _order.amount<>_paid_amount OR _order.currency<>_currency THEN
    RAISE EXCEPTION 'PAYMENT_AMOUNT_OR_PROVIDER_MISMATCH';
  END IF;
  IF _order.status NOT IN ('created','pending') THEN RAISE EXCEPTION 'ORDER_NOT_PAYABLE'; END IF;

  UPDATE public.payment_orders
  SET status='paid',paid_at=now(),updated_at=now(),
      provider_reference=_provider_event_id
  WHERE id=_order_id;

  INSERT INTO public.enrollments(user_id,course_id)
  VALUES (_order.user_id,_order.course_id)
  ON CONFLICT DO NOTHING;

  UPDATE public.payment_webhook_events SET processed_at=now() WHERE id=_event_id;
  PERFORM public.write_platform_audit_event(
    'payment_fulfilled','payment_orders',_order_id,NULL,
    jsonb_build_object('provider',_provider,'amount',_paid_amount,'currency',_currency)
  );
  RETURN jsonb_build_object('ok',true,'status','paid','order_id',_order_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Course analytics (aggregated only; no public student PII)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_course_analytics(_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _enrolled integer;
  _assignments integer;
  _submissions integer;
  _graded integer;
  _attendance_sessions integer;
  _attendance_records integer;
  _certificates integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_course_capability(_course_id,'analytics') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  SELECT count(*) INTO _enrolled FROM public.enrollments WHERE course_id=_course_id;
  SELECT count(*) INTO _assignments FROM public.assignments WHERE course_id=_course_id;
  SELECT count(*),count(*) FILTER (WHERE s.graded_at IS NOT NULL)
    INTO _submissions,_graded
  FROM public.assignment_submissions s
  JOIN public.assignments a ON a.id=s.assignment_id
  WHERE a.course_id=_course_id;
  SELECT count(*) INTO _attendance_sessions FROM public.attendance_sessions WHERE course_id=_course_id;
  SELECT count(*) INTO _attendance_records
  FROM public.attendance_records r
  JOIN public.attendance_sessions s ON s.id=r.session_id
  WHERE s.course_id=_course_id AND r.status IN ('present','late');
  SELECT count(*) INTO _certificates FROM public.course_certificates
  WHERE course_id=_course_id AND revoked_at IS NULL;

  RETURN jsonb_build_object(
    'course_id',_course_id,'enrolled',_enrolled,'assignments',_assignments,
    'submissions',_submissions,'graded_submissions',_graded,
    'attendance_sessions',_attendance_sessions,'present_or_late_records',_attendance_records,
    'valid_certificates',_certificates
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_platform_analytics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _users integer;
  _students integer;
  _teachers integer;
  _admins integer;
  _courses integer;
  _lessons integer;
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
  SELECT count(*) INTO _users FROM public.profiles;
  SELECT count(DISTINCT user_id) INTO _students FROM public.user_roles WHERE role='student'::public.app_role;
  SELECT count(DISTINCT user_id) INTO _teachers FROM public.user_roles WHERE role='teacher'::public.app_role;
  SELECT count(DISTINCT user_id) INTO _admins FROM public.user_roles WHERE role='admin'::public.app_role;
  SELECT count(*) INTO _courses FROM public.courses;
  SELECT count(*) INTO _lessons FROM public.lessons;
  SELECT count(*) INTO _assignments FROM public.assignments;
  SELECT count(*) INTO _submissions FROM public.assignment_submissions;
  SELECT count(*) INTO _live_classes FROM public.live_classes;
  SELECT count(*) INTO _certificates FROM public.course_certificates WHERE revoked_at IS NULL;
  SELECT count(*) INTO _payment_orders FROM public.payment_orders;
  RETURN jsonb_build_object(
    'users',_users,'students',_students,'teachers',_teachers,'admins',_admins,
    'courses',_courses,'lessons',_lessons,'assignments',_assignments,
    'submissions',_submissions,'live_classes',_live_classes,
    'certificates',_certificates,'payment_orders',_payment_orders
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Append-only administrative audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_audit_log_created_idx
  ON public.platform_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_log_entity_idx
  ON public.platform_audit_log(entity_type,entity_id,created_at DESC);
CREATE INDEX IF NOT EXISTS platform_audit_log_course_idx
  ON public.platform_audit_log(course_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_mfa_verified()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(auth.jwt()->>'aal','')='aal2';
$function$;

CREATE OR REPLACE FUNCTION public.write_platform_audit_event(
  _event_type text,
  _entity_type text,
  _entity_id uuid,
  _course_id uuid DEFAULT NULL,
  _details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _id uuid;
BEGIN
  IF length(COALESCE(_event_type,'')) NOT BETWEEN 1 AND 100
     OR length(COALESCE(_entity_type,'')) NOT BETWEEN 1 AND 100
     OR jsonb_typeof(COALESCE(_details,'{}'::jsonb)) <> 'object'
     OR octet_length(COALESCE(_details,'{}'::jsonb)::text) > 8000 THEN
    RAISE EXCEPTION 'INVALID_AUDIT_EVENT';
  END IF;
  INSERT INTO public.platform_audit_log(
    actor_user_id,event_type,entity_type,entity_id,course_id,details
  ) VALUES (
    auth.uid(),_event_type,_entity_type,_entity_id,_course_id,COALESCE(_details,'{}'::jsonb)
  ) RETURNING id INTO _id;
  RETURN _id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_sensitive_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _entity_id uuid;
  _course_id uuid;
  _event text;
  _details jsonb := '{}'::jsonb;
BEGIN
  IF TG_TABLE_NAME='profiles' THEN
    IF TG_OP='UPDATE' AND NEW.banned IS DISTINCT FROM OLD.banned THEN
      _entity_id := NEW.id;
      _event := CASE WHEN NEW.banned THEN 'user_banned' ELSE 'user_unbanned' END;
      _details := jsonb_build_object('target_user_id',NEW.id);
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME='user_roles' THEN
    IF TG_OP='DELETE' THEN
      _entity_id := OLD.user_id;
      _details := jsonb_build_object('target_user_id',OLD.user_id,'role',OLD.role::text);
    ELSE
      _entity_id := NEW.user_id;
      _details := jsonb_build_object('target_user_id',NEW.user_id,'role',NEW.role::text);
    END IF;
    _event := 'user_role_' || lower(TG_OP);
  ELSIF TG_TABLE_NAME='payment_orders' THEN
    IF TG_OP='INSERT' THEN
      _entity_id := NEW.id;
      _event := 'payment_order_created';
      _details := jsonb_build_object('status',NEW.status,'amount',NEW.amount,'currency',NEW.currency);
    ELSIF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      _entity_id := NEW.id;
      _event := 'payment_status_changed';
      _details := jsonb_build_object('status',NEW.status,'amount',NEW.amount,'currency',NEW.currency);
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME='course_certificates' THEN
    _entity_id := NEW.id;
    _course_id := NEW.course_id;
    _event := CASE WHEN TG_OP='INSERT' THEN 'certificate_created' ELSE 'certificate_updated' END;
    _details := jsonb_build_object('student_id',NEW.student_id);
  ELSIF TG_TABLE_NAME='assignment_submissions' THEN
    IF TG_OP='UPDATE' AND NEW.score IS DISTINCT FROM OLD.score THEN
      _entity_id := NEW.id;
      SELECT a.course_id INTO _course_id
      FROM public.assignments a WHERE a.id=NEW.assignment_id;
      _event := 'assignment_submission_graded';
      _details := jsonb_build_object('student_id',NEW.student_id,'score',NEW.score);
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.write_platform_audit_event(
    _event,TG_TABLE_NAME,_entity_id,_course_id,_details
  );
  IF TG_OP='DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS audit_profile_security_changes ON public.profiles;
CREATE TRIGGER audit_profile_security_changes
AFTER UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_row_change();

DROP TRIGGER IF EXISTS audit_user_role_changes ON public.user_roles;
CREATE TRIGGER audit_user_role_changes
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_row_change();

DROP TRIGGER IF EXISTS audit_payment_order_changes ON public.payment_orders;
CREATE TRIGGER audit_payment_order_changes
AFTER INSERT OR UPDATE ON public.payment_orders
FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_row_change();

DROP TRIGGER IF EXISTS audit_certificate_changes ON public.course_certificates;
CREATE TRIGGER audit_certificate_changes
AFTER INSERT OR UPDATE ON public.course_certificates
FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_row_change();

DROP TRIGGER IF EXISTS audit_assignment_grades ON public.assignment_submissions;
CREATE TRIGGER audit_assignment_grades
AFTER UPDATE ON public.assignment_submissions
FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_row_change();

-- ---------------------------------------------------------------------------
-- 10. Row-level security and explicit grants
-- ---------------------------------------------------------------------------
ALTER TABLE public.course_staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discussion_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discussion_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_provider_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Course staff see their own grants or course owners see grants"
ON public.course_staff_roles FOR SELECT TO authenticated
USING (
  user_id=auth.uid()
  OR public.has_course_capability(course_id,'staff')
);

CREATE POLICY "Enrolled students and course staff read assignments"
ON public.assignments FOR SELECT TO authenticated
USING (
  public.has_course_capability(course_id,'assignments')
  OR EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.course_id=assignments.course_id AND e.user_id=auth.uid()
  )
);

CREATE POLICY "Students and course staff read assignment submissions"
ON public.assignment_submissions FOR SELECT TO authenticated
USING (
  student_id=auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.id=assignment_submissions.assignment_id
      AND public.has_course_capability(a.course_id,'assignments')
  )
);

CREATE POLICY "Enrolled students and course staff read attendance sessions"
ON public.attendance_sessions FOR SELECT TO authenticated
USING (
  public.has_course_capability(course_id,'attendance')
  OR EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.course_id=attendance_sessions.course_id AND e.user_id=auth.uid()
  )
);

CREATE POLICY "Students and course staff read attendance records"
ON public.attendance_records FOR SELECT TO authenticated
USING (
  student_id=auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.attendance_sessions s
    WHERE s.id=attendance_records.session_id
      AND public.has_course_capability(s.course_id,'attendance')
  )
);

CREATE POLICY "Enrolled students and course staff read live classes"
ON public.live_classes FOR SELECT TO authenticated
USING (
  public.has_course_capability(course_id,'live_classes')
  OR EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.course_id=live_classes.course_id AND e.user_id=auth.uid()
  )
);

CREATE POLICY "Students and course staff read certificates"
ON public.course_certificates FOR SELECT TO authenticated
USING (
  student_id=auth.uid()
  OR public.has_course_capability(course_id,'certificates')
);

CREATE POLICY "Course members read discussion topics"
ON public.discussion_topics FOR SELECT TO authenticated
USING (
  (NOT is_hidden OR public.has_course_capability(course_id,'discussions'))
  AND (
    public.has_course_capability(course_id,'discussions')
    OR EXISTS (
      SELECT 1 FROM public.enrollments e
      WHERE e.course_id=discussion_topics.course_id AND e.user_id=auth.uid()
    )
  )
);

CREATE POLICY "Course members read visible discussion posts"
ON public.discussion_posts FOR SELECT TO authenticated
USING (
  (NOT is_hidden OR EXISTS (
    SELECT 1 FROM public.discussion_topics t
    WHERE t.id=discussion_posts.topic_id
      AND public.has_course_capability(t.course_id,'discussions')
  ))
  AND EXISTS (
    SELECT 1 FROM public.discussion_topics t
    WHERE t.id=discussion_posts.topic_id
      AND (
        public.has_course_capability(t.course_id,'discussions')
        OR EXISTS (
          SELECT 1 FROM public.enrollments e
          WHERE e.course_id=t.course_id AND e.user_id=auth.uid()
        )
      )
  )
);

CREATE POLICY "Users read own payment orders and MFA admins read all"
ON public.payment_orders FOR SELECT TO authenticated
USING (
  user_id=auth.uid()
  OR (
    public.has_role(auth.uid(),'admin'::public.app_role)
    AND public.admin_mfa_verified()
  )
);

CREATE POLICY "MFA admins read provider configuration"
ON public.payment_provider_settings FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::public.app_role)
  AND public.admin_mfa_verified()
);

CREATE POLICY "MFA admins read webhook events"
ON public.payment_webhook_events FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::public.app_role)
  AND public.admin_mfa_verified()
);

CREATE POLICY "MFA admins read audit history"
ON public.platform_audit_log FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::public.app_role)
  AND public.admin_mfa_verified()
);

REVOKE ALL ON public.course_staff_roles FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.assignments FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.assignment_submissions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.attendance_sessions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.attendance_records FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.live_classes FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.course_certificates FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.discussion_topics FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.discussion_posts FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.payment_provider_settings FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.payment_orders FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.payment_webhook_events FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.platform_audit_log FROM PUBLIC,anon,authenticated;

GRANT SELECT ON public.course_staff_roles TO authenticated;
GRANT SELECT ON public.assignments TO authenticated;
GRANT SELECT ON public.assignment_submissions TO authenticated;
GRANT SELECT ON public.attendance_sessions TO authenticated;
GRANT SELECT ON public.attendance_records TO authenticated;
GRANT SELECT ON public.live_classes TO authenticated;
GRANT SELECT ON public.course_certificates TO authenticated;
GRANT SELECT ON public.discussion_topics TO authenticated;
GRANT SELECT ON public.discussion_posts TO authenticated;
GRANT SELECT ON public.payment_orders TO authenticated;
GRANT SELECT ON public.payment_provider_settings TO authenticated;
GRANT SELECT ON public.payment_webhook_events TO authenticated;
GRANT SELECT ON public.platform_audit_log TO authenticated;

-- Public certificate verification returns a deliberately minimal record.
REVOKE ALL ON FUNCTION public.verify_course_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_course_certificate(text) TO anon,authenticated;

REVOKE ALL ON FUNCTION public.has_course_capability(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_course_capability(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_mfa_verified() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_mfa_verified() TO authenticated;

REVOKE ALL ON FUNCTION public.grant_course_staff_role(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.grant_course_staff_role(uuid,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.revoke_course_staff_role(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revoke_course_staff_role(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_assignment(uuid,uuid,text,text,timestamptz,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_assignment(uuid,uuid,text,text,timestamptz,numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_assignment(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_assignment(uuid,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.grade_assignment_submission(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.grade_assignment_submission(uuid,numeric,text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_attendance_session(uuid,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_attendance_session(uuid,text,timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_attendance(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_attendance(uuid,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_live_class(uuid,text,text,timestamptz,timestamptz,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_live_class(uuid,text,text,timestamptz,timestamptz,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.update_live_class_status(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_live_class_status(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_course_certificate(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_course_certificate(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.revoke_course_certificate(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revoke_course_certificate(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_discussion_topic(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_discussion_topic(uuid,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_discussion_post(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_discussion_post(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.moderate_discussion_post(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.moderate_discussion_post(uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.moderate_discussion_topic(uuid,boolean,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.moderate_discussion_topic(uuid,boolean,boolean,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.create_payment_order(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_payment_order(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.fulfill_payment_order(uuid,text,text,numeric,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_order(uuid,text,text,numeric,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.get_course_analytics(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_course_analytics(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_platform_analytics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_platform_analytics() TO authenticated;

REVOKE ALL ON FUNCTION public.write_platform_audit_event(text,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.audit_sensitive_row_change() FROM PUBLIC,anon,authenticated;

COMMENT ON TABLE public.assignments IS 'Course assignments; all writes are enforced through security-definer RPCs.';
COMMENT ON TABLE public.attendance_sessions IS 'Teacher-owned attendance sessions scoped to a course.';
COMMENT ON TABLE public.live_classes IS 'Meeting scheduling metadata only; no video conferencing service is hosted here.';
COMMENT ON TABLE public.course_certificates IS 'Certificate registry with unguessable verification tokens.';
COMMENT ON TABLE public.payment_orders IS 'Provider-neutral EGP payment lifecycle; checkout remains disabled until provider secrets are configured.';
COMMENT ON TABLE public.payment_webhook_events IS 'Stores verified webhook event metadata only; never stores payment secrets or raw webhook payloads.';
COMMENT ON TABLE public.platform_audit_log IS 'Append-only security and administrative audit history; readers require administrator role and AAL2.';

COMMIT;
