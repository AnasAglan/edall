-- Attendance reporting, optional lesson links, and configurable idempotent absence alerts.
-- No direct client writes to alert tables: all mutations go through audited RPCs.

BEGIN;

ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS lesson_id uuid
  REFERENCES public.lessons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS attendance_sessions_lesson_idx
  ON public.attendance_sessions(lesson_id,starts_at DESC)
  WHERE lesson_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.attendance_alert_settings (
  course_id uuid PRIMARY KEY REFERENCES public.courses(id) ON DELETE CASCADE,
  threshold_percent numeric(5,2) NOT NULL
    CHECK (threshold_percent > 0 AND threshold_percent <= 100),
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attendance_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  threshold_percent numeric(5,2) NOT NULL
    CHECK (threshold_percent > 0 AND threshold_percent <= 100),
  absent_count integer NOT NULL CHECK (absent_count >= 0),
  tracked_count integer NOT NULL CHECK (tracked_count > 0),
  absence_rate_percent numeric(5,2) NOT NULL
    CHECK (absence_rate_percent >= 0 AND absence_rate_percent <= 100),
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id,student_id,threshold_percent)
);

CREATE INDEX IF NOT EXISTS attendance_alert_events_course_created_idx
  ON public.attendance_alert_events(course_id,created_at DESC);

ALTER TABLE public.attendance_alert_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_alert_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.attendance_alert_settings FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.attendance_alert_events FROM PUBLIC,anon,authenticated;

DROP FUNCTION IF EXISTS public.create_attendance_session(uuid,text,timestamptz);

CREATE OR REPLACE FUNCTION public.create_attendance_session(
  _course_id uuid,
  _title text,
  _starts_at timestamptz DEFAULT now(),
  _lesson_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_course_capability(_course_id,'attendance') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF public.has_role(auth.uid(),'admin'::public.app_role)
     AND NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;
  IF length(btrim(COALESCE(_title,''))) NOT BETWEEN 1 AND 180
     OR _starts_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_ATTENDANCE_SESSION';
  END IF;
  IF _lesson_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.lessons AS lesson
    WHERE lesson.id = _lesson_id
      AND lesson.course_id = _course_id
  ) THEN
    RAISE EXCEPTION 'LESSON_NOT_IN_COURSE';
  END IF;

  INSERT INTO public.attendance_sessions(course_id,lesson_id,title,starts_at,created_by)
  VALUES (_course_id,_lesson_id,btrim(_title),_starts_at,auth.uid())
  RETURNING id INTO _id;

  PERFORM public.write_platform_audit_event(
    'attendance_session_created',
    'attendance_sessions',
    _id,
    _course_id,
    jsonb_build_object('title',btrim(_title),'starts_at',_starts_at,'lesson_id',_lesson_id)
  );
  RETURN _id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_attendance_session(uuid,text,timestamptz,uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_attendance_session(uuid,text,timestamptz,uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_course_absence_threshold(
  _course_id uuid,
  _threshold_percent numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_course_capability(_course_id,'attendance') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF public.has_role(auth.uid(),'admin'::public.app_role)
     AND NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;
  IF _threshold_percent IS NOT NULL
     AND (_threshold_percent <= 0 OR _threshold_percent > 100) THEN
    RAISE EXCEPTION 'INVALID_ABSENCE_THRESHOLD';
  END IF;

  IF _threshold_percent IS NULL THEN
    DELETE FROM public.attendance_alert_settings
    WHERE course_id = _course_id;
  ELSE
    INSERT INTO public.attendance_alert_settings(
      course_id,threshold_percent,updated_by,updated_at
    )
    VALUES (_course_id,_threshold_percent,auth.uid(),now())
    ON CONFLICT (course_id)
    DO UPDATE SET
      threshold_percent = EXCLUDED.threshold_percent,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;
  END IF;

  PERFORM public.write_platform_audit_event(
    'attendance_absence_threshold_updated',
    'attendance_alert_settings',
    NULL,
    _course_id,
    jsonb_build_object('threshold_percent',_threshold_percent)
  );
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_course_absence_threshold(uuid,numeric)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_course_absence_threshold(uuid,numeric)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_attendance(
  _session_id uuid,
  _student_id uuid,
  _status text,
  _note text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _course_id uuid;
  _course_owner uuid;
  _course_title text;
  _student_name text;
  _id uuid;
  _alert_id uuid;
  _threshold numeric(5,2);
  _absent_count integer;
  _tracked_count integer;
  _absence_rate numeric(5,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT session.course_id
  INTO _course_id
  FROM public.attendance_sessions AS session
  WHERE session.id = _session_id;

  IF NOT FOUND OR NOT public.has_course_capability(_course_id,'attendance') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF public.has_role(auth.uid(),'admin'::public.app_role)
     AND NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;
  IF _status NOT IN ('present','absent','late','excused')
     OR length(COALESCE(_note,'')) > 500 THEN
    RAISE EXCEPTION 'INVALID_ATTENDANCE';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.enrollments AS enrollment
    WHERE enrollment.course_id = _course_id
      AND enrollment.user_id = _student_id
  ) THEN
    RAISE EXCEPTION 'STUDENT_NOT_ENROLLED';
  END IF;

  INSERT INTO public.attendance_records(session_id,student_id,status,note,marked_by)
  VALUES (_session_id,_student_id,_status,COALESCE(_note,''),auth.uid())
  ON CONFLICT (session_id,student_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    note = EXCLUDED.note,
    marked_by = EXCLUDED.marked_by,
    marked_at = now()
  RETURNING id INTO _id;

  PERFORM public.write_platform_audit_event(
    'attendance_marked',
    'attendance_records',
    _id,
    _course_id,
    jsonb_build_object('session_id',_session_id,'student_id',_student_id,'status',_status)
  );

  SELECT setting.threshold_percent
  INTO _threshold
  FROM public.attendance_alert_settings AS setting
  WHERE setting.course_id = _course_id;

  IF _threshold IS NOT NULL THEN
    SELECT
      count(*) FILTER (WHERE record.status = 'absent')::integer,
      count(*) FILTER (WHERE record.status IN ('present','late','absent'))::integer
    INTO _absent_count,_tracked_count
    FROM public.attendance_records AS record
    JOIN public.attendance_sessions AS session ON session.id = record.session_id
    WHERE session.course_id = _course_id
      AND record.student_id = _student_id;

    IF COALESCE(_tracked_count,0) > 0 THEN
      _absence_rate := round(_absent_count::numeric * 100 / _tracked_count,2);
      IF _absence_rate >= _threshold THEN
        INSERT INTO public.attendance_alert_events(
          course_id,student_id,threshold_percent,absent_count,tracked_count,absence_rate_percent
        )
        VALUES (
          _course_id,_student_id,_threshold,_absent_count,_tracked_count,_absence_rate
        )
        ON CONFLICT (course_id,student_id,threshold_percent) DO NOTHING
        RETURNING id INTO _alert_id;

        IF _alert_id IS NOT NULL THEN
          SELECT course.created_by,course.title
          INTO _course_owner,_course_title
          FROM public.courses AS course
          WHERE course.id = _course_id;

          SELECT COALESCE(profile.name,'طالب')
          INTO _student_name
          FROM public.profiles AS profile
          WHERE profile.id = _student_id;
          _student_name := COALESCE(_student_name,'طالب');

          IF _course_owner IS NOT NULL THEN
            INSERT INTO public.notifications(user_id,title,message,type)
            VALUES (
              _course_owner,
              'تنبيه ارتفاع نسبة الغياب',
              'تجاوز غياب ' || _student_name || ' نسبة ' ||
                _absence_rate::text || '% في دورة ' || COALESCE(_course_title,''),
              'warning'
            )
            RETURNING id INTO _id;

            UPDATE public.attendance_alert_events
            SET notification_id = _id
            WHERE id = _alert_id;
          END IF;

          PERFORM public.write_platform_audit_event(
            'attendance_absence_threshold_reached',
            'attendance_alert_events',
            _alert_id,
            _course_id,
            jsonb_build_object(
              'student_id',_student_id,
              'threshold_percent',_threshold,
              'absence_rate_percent',_absence_rate,
              'absent_count',_absent_count,
              'tracked_count',_tracked_count
            )
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN (
    SELECT record.id
    FROM public.attendance_records AS record
    WHERE record.session_id = _session_id
      AND record.student_id = _student_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_attendance(uuid,uuid,text,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_attendance(uuid,uuid,text,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_attendance_report(
  _course_id uuid,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _sessions integer;
  _enrolled integer;
  _expected_slots integer;
  _records integer;
  _present integer;
  _late integer;
  _absent integer;
  _excused integer;
  _tracked integer;
  _threshold numeric(5,2);
  _students jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_course_capability(_course_id,'attendance') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF public.has_role(auth.uid(),'admin'::public.app_role)
     AND NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;
  IF _from IS NOT NULL AND _to IS NOT NULL AND _to < _from THEN
    RAISE EXCEPTION 'INVALID_ATTENDANCE_DATE_RANGE';
  END IF;

  SELECT count(*)::integer
  INTO _sessions
  FROM public.attendance_sessions AS session
  WHERE session.course_id = _course_id
    AND (_from IS NULL OR session.starts_at >= _from)
    AND (_to IS NULL OR session.starts_at <= _to);

  SELECT count(*)::integer
  INTO _enrolled
  FROM public.enrollments AS enrollment
  WHERE enrollment.course_id = _course_id;

  SELECT count(*)::integer
  INTO _expected_slots
  FROM public.attendance_sessions AS session
  JOIN public.enrollments AS enrollment
    ON enrollment.course_id = session.course_id
   AND enrollment.enrolled_at <= session.starts_at
  WHERE session.course_id = _course_id
    AND (_from IS NULL OR session.starts_at >= _from)
    AND (_to IS NULL OR session.starts_at <= _to);

  SELECT
    count(record.id)::integer,
    count(record.id) FILTER (WHERE record.status = 'present')::integer,
    count(record.id) FILTER (WHERE record.status = 'late')::integer,
    count(record.id) FILTER (WHERE record.status = 'absent')::integer,
    count(record.id) FILTER (WHERE record.status = 'excused')::integer
  INTO _records,_present,_late,_absent,_excused
  FROM public.attendance_sessions AS session
  JOIN public.attendance_records AS record ON record.session_id = session.id
  JOIN public.enrollments AS enrollment
    ON enrollment.course_id = session.course_id
   AND enrollment.user_id = record.student_id
   AND enrollment.enrolled_at <= session.starts_at
  WHERE session.course_id = _course_id
    AND (_from IS NULL OR session.starts_at >= _from)
    AND (_to IS NULL OR session.starts_at <= _to);

  _tracked := COALESCE(_present,0) + COALESCE(_late,0) + COALESCE(_absent,0);

  SELECT setting.threshold_percent
  INTO _threshold
  FROM public.attendance_alert_settings AS setting
  WHERE setting.course_id = _course_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'student_id',student_stats.student_id,
        'student_name',student_stats.student_name,
        'public_id',student_stats.public_id,
        'present',student_stats.present_count,
        'late',student_stats.late_count,
        'absent',student_stats.absent_count,
        'excused',student_stats.excused_count,
        'absence_denominator',student_stats.absence_denominator,
        'absence_rate_percent',CASE
          WHEN student_stats.absence_denominator = 0 THEN NULL
          ELSE round(student_stats.absent_count::numeric * 100 / student_stats.absence_denominator,2)
        END
      )
      ORDER BY
        CASE WHEN student_stats.absence_denominator = 0 THEN -1
             ELSE student_stats.absent_count::numeric / student_stats.absence_denominator END DESC,
        student_stats.student_name
    ),
    '[]'::jsonb
  )
  INTO _students
  FROM (
    SELECT
      enrollment.user_id AS student_id,
      COALESCE(profile.name,'') AS student_name,
      profile.public_id,
      count(record.id) FILTER (WHERE record.status = 'present')::integer AS present_count,
      count(record.id) FILTER (WHERE record.status = 'late')::integer AS late_count,
      count(record.id) FILTER (WHERE record.status = 'absent')::integer AS absent_count,
      count(record.id) FILTER (WHERE record.status = 'excused')::integer AS excused_count,
      count(record.id) FILTER (WHERE record.status IN ('present','late','absent'))::integer AS absence_denominator
    FROM public.enrollments AS enrollment
    LEFT JOIN public.profiles AS profile ON profile.id = enrollment.user_id
    LEFT JOIN public.attendance_sessions AS session
      ON session.course_id = enrollment.course_id
     AND session.starts_at >= enrollment.enrolled_at
     AND (_from IS NULL OR session.starts_at >= _from)
     AND (_to IS NULL OR session.starts_at <= _to)
    LEFT JOIN public.attendance_records AS record
      ON record.session_id = session.id
     AND record.student_id = enrollment.user_id
    WHERE enrollment.course_id = _course_id
    GROUP BY enrollment.user_id,profile.name,profile.public_id
  ) AS student_stats;

  RETURN jsonb_build_object(
    'course_id',_course_id,
    'sessions',COALESCE(_sessions,0),
    'enrolled_students',COALESCE(_enrolled,0),
    'expected_attendance_slots',COALESCE(_expected_slots,0),
    'records',COALESCE(_records,0),
    'unmarked',GREATEST(COALESCE(_expected_slots,0)-COALESCE(_records,0),0),
    'present',COALESCE(_present,0),
    'late',COALESCE(_late,0),
    'absent',COALESCE(_absent,0),
    'excused',COALESCE(_excused,0),
    'absence_denominator',COALESCE(_tracked,0),
    'absence_rate_percent',CASE
      WHEN COALESCE(_tracked,0) = 0 THEN NULL
      ELSE round(COALESCE(_absent,0)::numeric * 100 / _tracked,2)
    END,
    'absence_threshold_percent',_threshold,
    'students',COALESCE(_students,'[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_attendance_report(uuid,timestamptz,timestamptz)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_report(uuid,timestamptz,timestamptz)
  TO authenticated;

COMMIT;
