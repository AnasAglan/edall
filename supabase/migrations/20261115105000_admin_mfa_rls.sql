-- Apply administrator AAL2 consistently to direct profile/role access and notification mutations.
BEGIN;

DROP POLICY IF EXISTS "Users view own profile or admins view all" ON public.profiles;
CREATE POLICY "Users view own profile or admins view all"
ON public.profiles FOR SELECT TO authenticated
USING (
  id=auth.uid()
  OR (
    public.has_role(auth.uid(),'admin'::public.app_role)
    AND public.admin_mfa_verified()
  )
);

DROP POLICY IF EXISTS "Users update own profile or admins update any" ON public.profiles;
CREATE POLICY "Users update own profile or admins update any"
ON public.profiles FOR UPDATE TO authenticated
USING (
  id=auth.uid()
  OR (
    public.has_role(auth.uid(),'admin'::public.app_role)
    AND public.admin_mfa_verified()
  )
)
WITH CHECK (
  id=auth.uid()
  OR (
    public.has_role(auth.uid(),'admin'::public.app_role)
    AND public.admin_mfa_verified()
  )
);

DROP POLICY IF EXISTS "Users view own roles or admins view all" ON public.user_roles;
CREATE POLICY "Users view own roles or admins view all"
ON public.user_roles FOR SELECT TO authenticated
USING (
  user_id=auth.uid()
  OR (
    public.has_role(auth.uid(),'admin'::public.app_role)
    AND public.admin_mfa_verified()
  )
);

DROP POLICY IF EXISTS "Admins notifications and teacher notifications are scoped" ON public.notifications;
CREATE POLICY "Admins notifications and teacher notifications are scoped"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (
  (
    public.has_role(auth.uid(),'admin'::public.app_role)
    AND public.admin_mfa_verified()
  )
  OR (
    public.has_role(auth.uid(),'teacher'::public.app_role)
    AND user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.enrollments e
      JOIN public.courses c ON c.id=e.course_id
      WHERE e.user_id=notifications.user_id
        AND c.created_by=auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "Users update own notifications or admins update all" ON public.notifications;
CREATE POLICY "Users update own notifications or admins update all"
ON public.notifications FOR UPDATE TO authenticated
USING (
  user_id=auth.uid()
  OR (
    public.has_role(auth.uid(),'admin'::public.app_role)
    AND public.admin_mfa_verified()
  )
)
WITH CHECK (
  user_id=auth.uid()
  OR (
    public.has_role(auth.uid(),'admin'::public.app_role)
    AND public.admin_mfa_verified()
  )
);

CREATE OR REPLACE FUNCTION public.notify_course_students(
  _course_id uuid,_title text,_message text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _count integer;
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
  IF length(btrim(COALESCE(_title,''))) NOT BETWEEN 1 AND 120
     OR length(btrim(COALESCE(_message,''))) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'INVALID_NOTIFICATION';
  END IF;

  INSERT INTO public.notifications(user_id,title,message,type)
  SELECT DISTINCT e.user_id,btrim(_title),btrim(_message),'course'
  FROM public.enrollments e
  WHERE e.course_id=_course_id;
  GET DIAGNOSTICS _count=ROW_COUNT;
  RETURN _count;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_course_students(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.notify_course_students(uuid,text,text) TO authenticated;

COMMIT;
