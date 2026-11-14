-- Bring production's manually-provisioned exam attempt subsystem into migration history.
-- Harden it so only the owning student can submit/finalize an attempt and only
-- entitled students can read exam questions. Correct answers never leave the server.
BEGIN;

CREATE TABLE IF NOT EXISTS public.exam_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  submitted_at timestamptz,
  result_id uuid REFERENCES public.exam_results(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS exam_attempts_user_open_idx
  ON public.exam_attempts(user_id)
  WHERE submitted_at IS NULL;
CREATE INDEX IF NOT EXISTS exam_attempts_exam_idx
  ON public.exam_attempts(exam_id,user_id);
CREATE UNIQUE INDEX IF NOT EXISTS exam_attempts_one_open_per_user_exam_idx
  ON public.exam_attempts(user_id,exam_id)
  WHERE submitted_at IS NULL;

ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own attempts or course owner/admin" ON public.exam_attempts;
CREATE POLICY "Students and course staff read authorized attempts"
ON public.exam_attempts FOR SELECT TO authenticated
USING (
  user_id=auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.exams e
    JOIN public.lessons l ON l.id=e.lesson_id
    WHERE e.id=exam_attempts.exam_id
      AND public.has_course_capability(l.course_id,'exams')
  )
);

REVOKE ALL ON public.exam_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.exam_attempts TO authenticated;

-- Internal grading helper. Keep the answer key inside the database.
CREATE OR REPLACE FUNCTION public.grade_exam_submission(_exam_id uuid,_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _question record;
  _answer jsonb;
  _mcq_correct integer := 0;
  _mcq_total integer := 0;
  _has_essay boolean := false;
  _graded_answers jsonb := '[]'::jsonb;
  _total_questions integer := 0;
  _selected_option integer;
BEGIN
  IF _exam_id IS NULL
     OR _answers IS NULL
     OR jsonb_typeof(_answers)<>'array'
     OR jsonb_array_length(_answers)>200 THEN
    RAISE EXCEPTION 'INVALID_EXAM_ANSWERS';
  END IF;

  FOR _question IN
    SELECT q.id,q.text,q.type,q.options,q.correct_option,q.sort_order
    FROM public.exam_questions q
    WHERE q.exam_id=_exam_id
    ORDER BY q.sort_order
  LOOP
    _total_questions := _total_questions+1;
    _answer := NULL;
    SELECT a.value INTO _answer
    FROM jsonb_array_elements(_answers) AS a(value)
    WHERE (a.value->>'questionIndex') ~ '^[0-9]{1,6}$'
      AND (a.value->>'questionIndex')::integer=_question.sort_order
    LIMIT 1;

    IF _question.type='multiple'::public.question_type THEN
      _mcq_total := _mcq_total+1;
      _selected_option := NULL;
      IF COALESCE(_answer->>'selectedOption','') ~ '^-?[0-9]{1,6}$' THEN
        _selected_option := (_answer->>'selectedOption')::integer;
      END IF;
      _graded_answers := _graded_answers || jsonb_build_array(jsonb_build_object(
        'questionIndex',_question.sort_order,
        'type','multiple',
        'selectedOption',COALESCE(_selected_option,-1),
        'isCorrect',_selected_option IS NOT NULL AND _selected_option=_question.correct_option
      ));
      IF _selected_option IS NOT NULL AND _selected_option=_question.correct_option THEN
        _mcq_correct := _mcq_correct+1;
      END IF;
    ELSE
      _has_essay := true;
      _graded_answers := _graded_answers || jsonb_build_array(jsonb_build_object(
        'questionIndex',_question.sort_order,
        'type','essay',
        'answer',COALESCE(_answer->>'answer',''),
        'grade',NULL,
        'graded',false
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'mcqCorrect',_mcq_correct,
    'mcqTotal',_mcq_total,
    'totalQuestions',_total_questions,
    'hasEssay',_has_essay,
    'gradedAnswers',_graded_answers
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.grade_exam_submission(uuid,jsonb) FROM PUBLIC,anon,authenticated;

-- A single finalizer is used by the submit RPC and the timeout cleanup RPC.
CREATE OR REPLACE FUNCTION public._finalize_exam_attempt(_attempt_id uuid,_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _a public.exam_attempts%ROWTYPE;
  _exam public.exams%ROWTYPE;
  _graded jsonb;
  _late boolean := false;
  _mcq_score integer;
  _final_score integer;
  _passed boolean;
  _has_essay boolean;
  _mcq_total integer;
  _total integer;
  _result_id uuid;
BEGIN
  IF auth.uid() IS NULL OR _attempt_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO _a
  FROM public.exam_attempts
  WHERE id=_attempt_id
  FOR UPDATE;

  IF _a.id IS NULL THEN RAISE EXCEPTION 'ATTEMPT_NOT_FOUND'; END IF;
  IF _a.user_id<>auth.uid() THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;

  IF _a.submitted_at IS NOT NULL THEN
    RETURN jsonb_build_object('already_submitted',true,'result_id',_a.result_id);
  END IF;

  SELECT * INTO _exam FROM public.exams WHERE id=_a.exam_id;
  IF _exam.id IS NULL THEN RAISE EXCEPTION 'EXAM_NOT_FOUND'; END IF;

  IF _a.expires_at IS NOT NULL AND statement_timestamp()>_a.expires_at+interval '90 seconds' THEN
    _late := true;
    _answers := '[]'::jsonb;
  END IF;

  _graded := public.grade_exam_submission(_a.exam_id,COALESCE(_answers,'[]'::jsonb));
  _mcq_total := COALESCE((_graded->>'mcqTotal')::integer,0);
  _total := COALESCE((_graded->>'totalQuestions')::integer,0);
  _has_essay := COALESCE((_graded->>'hasEssay')::boolean,false);
  _mcq_score := CASE
    WHEN _mcq_total>0 THEN round(((_graded->>'mcqCorrect')::numeric*100)/_mcq_total)::integer
    ELSE 0
  END;

  IF _has_essay THEN
    _final_score := CASE
      WHEN _mcq_total>0 AND _total>0 THEN round(_mcq_score::numeric*_mcq_total/_total)::integer
      ELSE 0
    END;
    _passed := false;
  ELSE
    _final_score := _mcq_score;
    _passed := _final_score>=COALESCE(_exam.passing_grade,50);
  END IF;

  INSERT INTO public.exam_results(
    user_id,exam_id,score,passed,has_essay,essay_graded,answers
  )
  VALUES(
    _a.user_id,_a.exam_id,_final_score,_passed,_has_essay,NOT _has_essay,
    COALESCE(_graded->'gradedAnswers','[]'::jsonb)
  )
  RETURNING id INTO _result_id;

  UPDATE public.exam_attempts
  SET submitted_at=statement_timestamp(),result_id=_result_id
  WHERE id=_attempt_id;

  RETURN _graded || jsonb_build_object(
    'result_id',_result_id,'score',_final_score,'passed',_passed,
    'mcqScore',_mcq_score,'late',_late,'submitted_at',statement_timestamp()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._finalize_exam_attempt(uuid,jsonb) FROM PUBLIC,anon,authenticated;

-- Question text and choices are available only to an entitled signed-in student
-- or course staff. The answer key is never returned by this RPC.
CREATE OR REPLACE FUNCTION public.get_exam_questions_safe(_exam_id uuid)
RETURNS TABLE(
  id uuid,exam_id uuid,text text,type public.question_type,options jsonb,sort_order integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _lesson_id uuid;
BEGIN
  IF auth.uid() IS NULL OR _exam_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT e.lesson_id INTO _lesson_id
  FROM public.exams e
  WHERE e.id=_exam_id;

  IF _lesson_id IS NULL OR NOT public.can_access_lesson(_lesson_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  RETURN QUERY
  SELECT q.id,q.exam_id,q.text,q.type,q.options,q.sort_order
  FROM public.exam_questions q
  WHERE q.exam_id=_exam_id
  ORDER BY q.sort_order;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_exam_questions_safe(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_exam_questions_safe(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_exam_attempt(_exam_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _exam public.exams%ROWTYPE;
  _open public.exam_attempts%ROWTYPE;
  _used integer;
  _max integer;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO _exam FROM public.exams WHERE id=_exam_id;
  IF _exam.id IS NULL OR NOT public.can_access_lesson(_exam.lesson_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  -- Serialize start/resume and attempt-count checks for each student/exam pair.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(_user_id::text||':'||_exam_id::text)
  );

  SELECT * INTO _open
  FROM public.exam_attempts
  WHERE user_id=_user_id AND exam_id=_exam_id AND submitted_at IS NULL
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF _open.id IS NOT NULL THEN
    IF _open.expires_at IS NOT NULL
       AND statement_timestamp()>_open.expires_at+interval '90 seconds' THEN
      PERFORM public._finalize_exam_attempt(_open.id,'[]'::jsonb);
    ELSE
      RETURN jsonb_build_object(
        'attempt_id',_open.id,'started_at',_open.started_at,
        'expires_at',_open.expires_at,'server_now',statement_timestamp(),'resumed',true
      );
    END IF;
  END IF;

  SELECT count(*) INTO _used
  FROM public.exam_results
  WHERE user_id=_user_id AND exam_id=_exam_id;

  _max := CASE WHEN NOT _exam.allow_retake THEN 1 ELSE _exam.max_attempts END;
  IF _max IS NOT NULL AND _used>=_max THEN
    RAISE EXCEPTION 'MAX_ATTEMPTS_REACHED';
  END IF;

  INSERT INTO public.exam_attempts(user_id,exam_id,expires_at)
  VALUES(
    _user_id,_exam_id,
    CASE WHEN _exam.time_limit IS NOT NULL AND _exam.time_limit>0
      THEN statement_timestamp()+make_interval(mins=>_exam.time_limit)
      ELSE NULL
    END
  )
  RETURNING * INTO _open;

  RETURN jsonb_build_object(
    'attempt_id',_open.id,'started_at',_open.started_at,
    'expires_at',_open.expires_at,'server_now',statement_timestamp(),'resumed',false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_exam_attempt(_attempt_id uuid,_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.exam_attempts
    WHERE id=_attempt_id AND user_id=auth.uid()
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  RETURN public._finalize_exam_attempt(_attempt_id,_answers);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_active_exam_attempt()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _attempt record;
BEGIN
  IF _user_id IS NULL THEN RETURN NULL; END IF;

  FOR _attempt IN
    SELECT a.id
    FROM public.exam_attempts a
    WHERE a.user_id=_user_id
      AND a.submitted_at IS NULL
      AND a.expires_at IS NOT NULL
      AND statement_timestamp()>a.expires_at+interval '90 seconds'
  LOOP
    PERFORM public._finalize_exam_attempt(_attempt.id,'[]'::jsonb);
  END LOOP;

  SELECT a.id,a.exam_id,a.started_at,a.expires_at,e.lesson_id,l.course_id
  INTO _attempt
  FROM public.exam_attempts a
  JOIN public.exams e ON e.id=a.exam_id
  JOIN public.lessons l ON l.id=e.lesson_id
  WHERE a.user_id=_user_id AND a.submitted_at IS NULL
  ORDER BY a.started_at DESC
  LIMIT 1;

  IF _attempt.id IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'attempt_id',_attempt.id,'exam_id',_attempt.exam_id,
    'lesson_id',_attempt.lesson_id,'course_id',_attempt.course_id,
    'started_at',_attempt.started_at,'expires_at',_attempt.expires_at,
    'server_now',statement_timestamp()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.abandon_exam_attempt(_attempt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR _attempt_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  DELETE FROM public.exam_attempts
  WHERE id=_attempt_id
    AND user_id=auth.uid()
    AND submitted_at IS NULL
    AND expires_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.start_exam_attempt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.submit_exam_attempt(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.get_active_exam_attempt() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_active_exam_attempt() TO authenticated;
REVOKE ALL ON FUNCTION public.abandon_exam_attempt(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.abandon_exam_attempt(uuid) TO authenticated;

COMMIT;
