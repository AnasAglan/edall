ALTER TABLE public.exams ADD COLUMN IF NOT EXISTS max_attempts integer;

CREATE TABLE public.exam_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  exam_id uuid NOT NULL REFERENCES public.exams(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  submitted_at timestamptz,
  result_id uuid REFERENCES public.exam_results(id) ON DELETE SET NULL
);
CREATE INDEX exam_attempts_user_open_idx ON public.exam_attempts(user_id) WHERE submitted_at IS NULL;
CREATE INDEX exam_attempts_exam_idx ON public.exam_attempts(exam_id, user_id);

GRANT SELECT ON public.exam_attempts TO authenticated;
GRANT ALL ON public.exam_attempts TO service_role;
ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own attempts or course owner/admin" ON public.exam_attempts FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'::public.app_role) OR EXISTS (
  SELECT 1 FROM public.exams e JOIN public.lessons l ON l.id=e.lesson_id JOIN public.courses c ON c.id=l.course_id
  WHERE e.id = exam_attempts.exam_id AND c.created_by = auth.uid()));

-- results are now only created by the server-side submit function
DROP POLICY IF EXISTS "Users can insert own results" ON public.exam_results;

CREATE OR REPLACE FUNCTION public._finalize_exam_attempt(_attempt_id uuid, _answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _a public.exam_attempts;
  _exam public.exams;
  _g jsonb;
  _late boolean := false;
  _mcq_score int; _final int; _passed boolean; _has_essay boolean;
  _mcq_total int; _total int; _rid uuid;
BEGIN
  SELECT * INTO _a FROM public.exam_attempts WHERE id = _attempt_id FOR UPDATE;
  IF _a.id IS NULL THEN RAISE EXCEPTION 'ATTEMPT_NOT_FOUND'; END IF;
  IF _a.submitted_at IS NOT NULL THEN
    RETURN jsonb_build_object('already_submitted', true, 'result_id', _a.result_id);
  END IF;
  SELECT * INTO _exam FROM public.exams WHERE id = _a.exam_id;
  IF _a.expires_at IS NOT NULL AND now() > _a.expires_at + interval '90 seconds' THEN
    _late := true;
    _answers := '[]'::jsonb;
  END IF;
  _g := public.grade_exam_submission(_a.exam_id, COALESCE(_answers,'[]'::jsonb));
  _mcq_total := (_g->>'mcqTotal')::int;
  _total := (_g->>'totalQuestions')::int;
  _has_essay := (_g->>'hasEssay')::boolean;
  _mcq_score := CASE WHEN _mcq_total > 0 THEN round(((_g->>'mcqCorrect')::numeric * 100) / _mcq_total) ELSE 0 END;
  IF _has_essay THEN
    _final := CASE WHEN _mcq_total > 0 AND _total > 0 THEN round(_mcq_score::numeric * _mcq_total / _total) ELSE 0 END;
    _passed := false;
  ELSE
    _final := _mcq_score;
    _passed := _final >= COALESCE(_exam.passing_grade, 50);
  END IF;
  INSERT INTO public.exam_results (user_id, exam_id, score, passed, has_essay, essay_graded, answers)
  VALUES (_a.user_id, _a.exam_id, _final, _passed, _has_essay, NOT _has_essay, _g->'gradedAnswers')
  RETURNING id INTO _rid;
  UPDATE public.exam_attempts SET submitted_at = now(), result_id = _rid WHERE id = _attempt_id;
  RETURN _g || jsonb_build_object('result_id', _rid, 'score', _final, 'passed', _passed,
    'mcqScore', _mcq_score, 'late', _late, 'submitted_at', now());
END; $$;
REVOKE ALL ON FUNCTION public._finalize_exam_attempt(uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_exam_attempt(_exam_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid();
  _exam public.exams;
  _open public.exam_attempts;
  _used int; _max int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _exam FROM public.exams WHERE id = _exam_id;
  IF _exam.id IS NULL OR NOT public.can_access_lesson(_exam.lesson_id) THEN RAISE EXCEPTION 'NOT_ALLOWED'; END IF;

  SELECT * INTO _open FROM public.exam_attempts
   WHERE user_id = _uid AND exam_id = _exam_id AND submitted_at IS NULL
   ORDER BY started_at DESC LIMIT 1;
  IF _open.id IS NOT NULL THEN
    IF _open.expires_at IS NOT NULL AND now() > _open.expires_at + interval '90 seconds' THEN
      PERFORM public._finalize_exam_attempt(_open.id, '[]'::jsonb);
    ELSE
      RETURN jsonb_build_object('attempt_id', _open.id, 'started_at', _open.started_at,
        'expires_at', _open.expires_at, 'server_now', now(), 'resumed', true);
    END IF;
  END IF;

  SELECT count(*) INTO _used FROM public.exam_results WHERE user_id = _uid AND exam_id = _exam_id;
  _max := CASE WHEN NOT _exam.allow_retake THEN 1 ELSE _exam.max_attempts END;
  IF _max IS NOT NULL AND _used >= _max THEN RAISE EXCEPTION 'MAX_ATTEMPTS_REACHED'; END IF;

  INSERT INTO public.exam_attempts (user_id, exam_id, expires_at)
  VALUES (_uid, _exam_id, CASE WHEN _exam.time_limit IS NOT NULL AND _exam.time_limit > 0
                               THEN now() + make_interval(mins => _exam.time_limit) END)
  RETURNING * INTO _open;
  RETURN jsonb_build_object('attempt_id', _open.id, 'started_at', _open.started_at,
    'expires_at', _open.expires_at, 'server_now', now(), 'resumed', false);
END; $$;

CREATE OR REPLACE FUNCTION public.submit_exam_attempt(_attempt_id uuid, _answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.exam_attempts WHERE id = _attempt_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  RETURN public._finalize_exam_attempt(_attempt_id, _answers);
END; $$;

CREATE OR REPLACE FUNCTION public.abandon_exam_attempt(_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- only untimed exams can be abandoned; timed ones keep running on the server
  DELETE FROM public.exam_attempts
   WHERE id = _attempt_id AND user_id = auth.uid() AND submitted_at IS NULL AND expires_at IS NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.get_active_exam_attempt()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _uid uuid := auth.uid();
  _r record;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  FOR _r IN SELECT id FROM public.exam_attempts
    WHERE user_id = _uid AND submitted_at IS NULL AND expires_at IS NOT NULL
      AND now() > expires_at + interval '90 seconds'
  LOOP
    PERFORM public._finalize_exam_attempt(_r.id, '[]'::jsonb);
  END LOOP;

  SELECT a.id, a.exam_id, a.started_at, a.expires_at, e.lesson_id, l.course_id INTO _r
  FROM public.exam_attempts a
  JOIN public.exams e ON e.id = a.exam_id
  JOIN public.lessons l ON l.id = e.lesson_id
  WHERE a.user_id = _uid AND a.submitted_at IS NULL
  ORDER BY a.started_at DESC LIMIT 1;
  IF _r.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('attempt_id', _r.id, 'exam_id', _r.exam_id, 'lesson_id', _r.lesson_id,
    'course_id', _r.course_id, 'started_at', _r.started_at, 'expires_at', _r.expires_at, 'server_now', now());
END; $$;

CREATE OR REPLACE FUNCTION public.exam_grading_list(_exam_id uuid)
RETURNS TABLE(result_id uuid, user_id uuid, name text, public_id text, score integer, passed boolean,
  has_essay boolean, essay_graded boolean, answers jsonb, submitted_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.exams e JOIN public.lessons l ON l.id=e.lesson_id JOIN public.courses c ON c.id=l.course_id
    WHERE e.id = _exam_id AND (c.created_by = auth.uid() OR public.has_role(auth.uid(),'admin'::public.app_role))
  ) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT r.id, r.user_id, p.name, p.public_id, r.score, r.passed, r.has_essay, r.essay_graded, r.answers, r.submitted_at
  FROM public.exam_results r LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.exam_id = _exam_id
  ORDER BY r.submitted_at ASC;
END; $$;

REVOKE ALL ON FUNCTION public.start_exam_attempt(uuid), public.submit_exam_attempt(uuid, jsonb),
  public.abandon_exam_attempt(uuid), public.get_active_exam_attempt(), public.exam_grading_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_exam_attempt(uuid), public.submit_exam_attempt(uuid, jsonb),
  public.abandon_exam_attempt(uuid), public.get_active_exam_attempt(), public.exam_grading_list(uuid) TO authenticated;