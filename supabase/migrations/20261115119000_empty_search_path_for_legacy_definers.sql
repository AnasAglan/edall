-- Remove the writable public schema from the execution search path of
-- the two remaining SECURITY DEFINER functions from the legacy hardening step.
-- Their object references are already schema-qualified.
BEGIN;

ALTER FUNCTION public.protect_profile_security_fields()
  SET search_path = '';

ALTER FUNCTION public.purchase_course(uuid)
  SET search_path = '';

COMMIT;
