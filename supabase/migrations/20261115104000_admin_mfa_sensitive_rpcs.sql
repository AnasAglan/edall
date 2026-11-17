-- Protect privileged identity lookups and teacher email discovery with admin AAL2.
BEGIN;

CREATE OR REPLACE FUNCTION public.search_teachers_public(_term text)
RETURNS TABLE(id uuid,name text,avatar_url text,email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT DISTINCT
    p.id,
    p.name,
    p.avatar_url,
    CASE
      WHEN public.has_role(auth.uid(),'admin'::public.app_role)
       AND public.admin_mfa_verified() THEN p.email
      ELSE NULL
    END AS email
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id=p.id
  WHERE ur.role IN ('teacher'::public.app_role,'admin'::public.app_role)
    AND (
      COALESCE(length(_term),0)=0
      OR p.name ILIKE '%' || left(_term,100) || '%'
      OR (
        public.has_role(auth.uid(),'admin'::public.app_role)
        AND public.admin_mfa_verified()
        AND p.email ILIKE '%' || left(_term,100) || '%'
      )
    )
  ORDER BY p.name
  LIMIT 20;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _role text;
BEGIN
  IF auth.uid() IS NULL OR (
    auth.uid() <> _user_id
    AND (
      NOT public.has_role(auth.uid(),'admin'::public.app_role)
      OR NOT public.admin_mfa_verified()
    )
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT ur.role::text INTO _role
  FROM public.user_roles ur
  WHERE ur.user_id=_user_id
  ORDER BY CASE ur.role
    WHEN 'admin'::public.app_role THEN 1
    WHEN 'teacher'::public.app_role THEN 2
    ELSE 3
  END
  LIMIT 1;
  RETURN _role;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_teachers_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_teachers_public(text) TO anon,authenticated;
REVOKE ALL ON FUNCTION public.get_user_role(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;

COMMIT;
