-- All role mutations must pass an administrator AAL2 check in the database.
-- The UI and assistant Worker never receive direct INSERT/DELETE access.
BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON public.user_roles
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.manage_user_role(
  _user_id uuid,
  _role public.app_role,
  _operation text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _changed boolean := false;
  _admins integer;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;
  IF NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;
  IF _user_id IS NULL
     OR _role IS NULL
     OR _role::text NOT IN ('student','teacher','admin')
     OR _operation IS NULL
     OR _operation NOT IN ('grant','revoke') THEN
    RAISE EXCEPTION 'INVALID_ROLE_CHANGE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  -- Serialize role changes for this account and prevent concurrent removal
  -- of the last administrator.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(_user_id::text || ':role:' || _role::text)
  );

  IF _operation='grant' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id=_user_id AND role=_role
    ) THEN
      INSERT INTO public.user_roles(user_id,role)
      VALUES (_user_id,_role);
      _changed := true;
    END IF;
  ELSE
    IF _role='admin'::public.app_role THEN
      IF _user_id=auth.uid() THEN
        RAISE EXCEPTION 'CANNOT_REVOKE_OWN_ADMIN_ROLE';
      END IF;
      -- A single global lock makes the last-admin check safe even when two
      -- different administrators are being revoked at the same time.
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('edall-last-admin-role-guard')
      );
      SELECT count(*) INTO _admins
      FROM public.user_roles
      WHERE role='admin'::public.app_role;
      IF _admins<=1 AND EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id=_user_id AND role='admin'::public.app_role
      ) THEN
        RAISE EXCEPTION 'CANNOT_REVOKE_LAST_ADMIN';
      END IF;
    END IF;

    DELETE FROM public.user_roles
    WHERE user_id=_user_id AND role=_role;
    _changed := FOUND;
  END IF;

  -- audit_user_role_changes trigger writes the immutable audit event once.
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.manage_user_role(uuid,public.app_role,text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manage_user_role(uuid,public.app_role,text)
TO authenticated;

COMMENT ON FUNCTION public.manage_user_role(uuid,public.app_role,text) IS
  'AAL2-gated, audited role mutations. Direct table writes are revoked from client roles.';

COMMIT;
