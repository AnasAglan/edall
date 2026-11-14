-- Enforce append-only audit history at the database boundary, including service-role clients.
BEGIN;

-- Keep historical actor/course UUIDs as immutable snapshots. ON DELETE SET NULL
-- would attempt to UPDATE audit rows and conflict with the immutability trigger.
ALTER TABLE public.platform_audit_log
  DROP CONSTRAINT IF EXISTS platform_audit_log_actor_user_id_fkey;
ALTER TABLE public.platform_audit_log
  DROP CONSTRAINT IF EXISTS platform_audit_log_course_id_fkey;

CREATE OR REPLACE FUNCTION public.prevent_platform_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_APPEND_ONLY';
END;
$function$;

DROP TRIGGER IF EXISTS platform_audit_log_immutable ON public.platform_audit_log;
CREATE TRIGGER platform_audit_log_immutable
BEFORE UPDATE OR DELETE ON public.platform_audit_log
FOR EACH ROW
EXECUTE FUNCTION public.prevent_platform_audit_log_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.platform_audit_log
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.prevent_platform_audit_log_mutation()
FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
