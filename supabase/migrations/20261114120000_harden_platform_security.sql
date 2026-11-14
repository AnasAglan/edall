-- ED-ALL security hardening. Additive and safe to apply after the existing platform migrations.
-- Sensitive authorization is enforced here, not by UI visibility.

-- 1. Paid enrollment must go through purchase_course (which locks the wallet row).
DROP POLICY IF EXISTS "Users can enroll themselves" ON public.enrollments;
DROP POLICY IF EXISTS "Free courses allow self enrollment" ON public.enrollments;
CREATE POLICY "Free courses allow self enrollment"
ON public.enrollments
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id = course_id
      AND COALESCE(c.price, 0) <= 0
  )
);

-- 2. Lesson text is private unless the account can access the lesson.
DROP POLICY IF EXISTS "Anyone can view lessons" ON public.lessons;
DROP POLICY IF EXISTS "Authenticated users can view all lessons" ON public.lessons;
DROP POLICY IF EXISTS "Entitled users can view lessons" ON public.lessons;
CREATE POLICY "Entitled users can view lessons"
ON public.lessons
FOR SELECT TO anon, authenticated
USING (public.can_access_lesson(id));

-- 3. Remove the public, repeatable answer-key grading endpoint.
-- _finalize_exam_attempt() is SECURITY DEFINER and calls this function internally.
-- Students submit exactly once through submit_exam_attempt() using a server-created attempt.
REVOKE ALL ON FUNCTION public.grade_exam_submission(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- The student-facing question RPC returns only safe columns and checks lesson access.
CREATE OR REPLACE FUNCTION public.get_exam_questions_safe(_exam_id uuid)
RETURNS TABLE(
  id uuid,
  exam_id uuid,
  text text,
  type public.question_type,
  options jsonb,
  sort_order int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _lesson_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT e.lesson_id INTO _lesson_id
  FROM public.exams e
  WHERE e.id = _exam_id;

  IF _lesson_id IS NULL OR NOT public.can_access_lesson(_lesson_id) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  RETURN QUERY
  SELECT q.id, q.exam_id, q.text, q.type, q.options, q.sort_order
  FROM public.exam_questions q
  WHERE q.exam_id = _exam_id
  ORDER BY q.sort_order, q.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_exam_questions_safe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_questions_safe(uuid) TO authenticated;

-- 4. Make lesson PDFs private and permit signed reads only for entitled lessons.
UPDATE storage.buckets
SET public = false
WHERE id = 'lesson-pdfs';

DO $storage_policy_cleanup$
DECLARE
  _policy record;
BEGIN
  FOR _policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND cmd = 'SELECT'
      AND COALESCE(qual, '') ILIKE '%lesson-pdfs%'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', _policy.policyname);
  END LOOP;
END;
$storage_policy_cleanup$;

CREATE POLICY "Lesson PDFs entitled read access"
ON storage.objects
FOR SELECT TO anon, authenticated
USING (
  bucket_id = 'lesson-pdfs'
  AND EXISTS (
    SELECT 1
    FROM public.lessons l
    WHERE l.id::text = (storage.foldername(name))[2]
      AND public.can_access_lesson(l.id)
  )
);

-- The path format is courseId/lessonId/fileName. Convert legacy public URLs
-- to private object paths; the client signs them only when the user opens a file.
UPDATE public.lesson_files
SET file_url = regexp_replace(
  file_url,
  '^https?://[^/]+/storage/v1/object/public/lesson-pdfs/',
  ''
)
WHERE file_url ~ '^https?://[^/]+/storage/v1/object/public/lesson-pdfs/';

-- 5. Protect profile security fields against self-service changes.
CREATE OR REPLACE FUNCTION public.protect_profile_security_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() = OLD.id THEN
    IF NEW.banned IS DISTINCT FROM OLD.banned
      OR NEW.public_id IS DISTINCT FROM OLD.public_id
      OR NEW.email IS DISTINCT FROM OLD.email
      OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
    THEN
      RAISE EXCEPTION 'Protected profile fields can only be changed by trusted administration';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS protect_profile_security_fields ON public.profiles;
CREATE TRIGGER protect_profile_security_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_security_fields();

DO $profile_policy_cleanup$
DECLARE
  _policy record;
BEGIN
  FOR _policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND cmd IN ('SELECT', 'UPDATE')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', _policy.policyname);
  END LOOP;
END;
$profile_policy_cleanup$;

CREATE POLICY "Users view own profile or admins view all"
ON public.profiles
FOR SELECT TO authenticated
USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Users update own profile or admins update any"
ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- Roles are readable by their owner and administrators only.
DO $role_policy_cleanup$
DECLARE
  _policy record;
BEGIN
  FOR _policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_roles'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.user_roles', _policy.policyname);
  END LOOP;
END;
$role_policy_cleanup$;

CREATE POLICY "Users view own roles or admins view all"
ON public.user_roles
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- 6. Teacher discovery remains public, but email is private to administrators.
CREATE OR REPLACE FUNCTION public.search_teachers_public(_term text)
RETURNS TABLE(id uuid, name text, avatar_url text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT DISTINCT
    p.id,
    p.name,
    p.avatar_url,
    CASE
      WHEN public.has_role(auth.uid(), 'admin'::public.app_role) THEN p.email
      ELSE NULL
    END AS email
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role IN ('teacher'::public.app_role, 'admin'::public.app_role)
    AND (
      COALESCE(length(_term), 0) = 0
      OR p.name ILIKE '%' || left(_term, 100) || '%'
      OR (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        AND p.email ILIKE '%' || left(_term, 100) || '%'
      )
    )
  ORDER BY p.name
  LIMIT 20;
$function$;

REVOKE ALL ON FUNCTION public.search_teachers_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_teachers_public(text) TO anon, authenticated;

-- 7. Restrict teacher notifications to students enrolled in courses they own.
DROP POLICY IF EXISTS "Admins and teachers can create notifications" ON public.notifications;
CREATE POLICY "Admins notifications and teacher notifications are scoped"
ON public.notifications
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (
    public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.enrollments e
      JOIN public.courses c ON c.id = e.course_id
      WHERE e.user_id = notifications.user_id
        AND c.created_by = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications or admins update all"
ON public.notifications
FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.notify_course_students(
  _course_id uuid,
  _title text,
  _message text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND NOT EXISTS (
       SELECT 1 FROM public.courses c
       WHERE c.id = _course_id AND c.created_by = auth.uid()
     )
  THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
  IF length(trim(COALESCE(_title, ''))) NOT BETWEEN 1 AND 120
     OR length(trim(COALESCE(_message, ''))) NOT BETWEEN 1 AND 2000
  THEN
    RAISE EXCEPTION 'INVALID_NOTIFICATION';
  END IF;

  INSERT INTO public.notifications(user_id, title, message, type)
  SELECT DISTINCT e.user_id, trim(_title), trim(_message), 'course'
  FROM public.enrollments e
  WHERE e.course_id = _course_id;
  GET DIAGNOSTICS _count = ROW_COUNT;
  RETURN _count;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_course_students(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_course_students(uuid, text, text) TO authenticated;

-- 8. Re-check enrollment after acquiring the wallet lock. Concurrent requests for the
-- same course now serialize and only the first request can debit the balance.
CREATE OR REPLACE FUNCTION public.purchase_course(_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _price numeric(12,2);
  _title text;
  _created_by uuid;
  _balance numeric(12,2);
  _new_balance numeric(12,2);
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT c.price, c.title, c.created_by
    INTO _price, _title, _created_by
  FROM public.courses c
  WHERE c.id = _course_id
  FOR SHARE;

  IF NOT FOUND THEN RAISE EXCEPTION 'COURSE_NOT_FOUND'; END IF;
  _price := COALESCE(_price, 0);
  IF _price < 0 THEN RAISE EXCEPTION 'INVALID_COURSE_PRICE'; END IF;

  INSERT INTO public.wallets(user_id, balance)
  VALUES (_uid, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT w.balance INTO _balance
  FROM public.wallets w
  WHERE w.user_id = _uid
  FOR UPDATE;

  -- Essential second check: a concurrent request may have enrolled this user
  -- while the current request waited for the wallet lock.
  IF EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.user_id = _uid AND e.course_id = _course_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_enrolled', true,
      'balance', _balance,
      'course_id', _course_id
    );
  END IF;

  IF _price > 0 THEN
    IF COALESCE(_balance, 0) < _price THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE'
        USING DETAIL = jsonb_build_object('balance', _balance, 'price', _price)::text;
    END IF;

    UPDATE public.wallets
      SET balance = balance - _price
      WHERE user_id = _uid
      RETURNING balance INTO _new_balance;

    INSERT INTO public.wallet_transactions(user_id, amount, type, note, created_by)
    VALUES (_uid, -_price, 'purchase', 'شراء كورس: ' || _title, _uid);
  ELSE
    _new_balance := COALESCE(_balance, 0);
  END IF;

  INSERT INTO public.enrollments(user_id, course_id)
  VALUES (_uid, _course_id);

  IF _created_by IS NOT NULL AND _created_by <> _uid THEN
    INSERT INTO public.notifications(user_id, title, message, type)
    VALUES (
      _created_by,
      'طالب جديد',
      'انضم طالب إلى كورس "' || _title || '"',
      'enrollment'
    );
  END IF;

  IF _price > 0 THEN
    INSERT INTO public.notifications(user_id, title, message, type)
    VALUES (
      _uid,
      'تم شراء الكورس',
      'تم خصم ' || _price::text || ' لشراء كورس "' || _title ||
        '". الرصيد الحالي: ' || _new_balance::text,
      'wallet'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_enrolled', false,
    'price', _price,
    'new_balance', _new_balance,
    'course_id', _course_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.purchase_course(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_course(uuid) TO authenticated;

-- 9. Close legacy bootstrap/role lookup overloads which predate the secured RPC.
REVOKE ALL ON FUNCTION public.setup_new_user(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _role text;
BEGIN
  IF auth.uid() IS NULL OR (
    auth.uid() <> _user_id
    AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT ur.role::text INTO _role
  FROM public.user_roles ur
  WHERE ur.user_id = _user_id
  ORDER BY CASE ur.role WHEN 'admin' THEN 1 WHEN 'teacher' THEN 2 ELSE 3 END
  LIMIT 1;
  RETURN _role;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;

COMMENT ON FUNCTION public.purchase_course(uuid) IS
  'Transactional, idempotent course purchase. Wallet row lock serializes duplicate requests before enrollment check and debit.';
COMMENT ON FUNCTION public.get_exam_questions_safe(uuid) IS
  'Returns safe exam question fields only to authenticated users entitled to the lesson.';
