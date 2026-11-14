-- Per-user request quota for the ED-ALL staff assistant.
-- The authenticated caller cannot choose their identity or raise their own quota.
BEGIN;

CREATE TABLE IF NOT EXISTS public.edall_assistant_rate_limits (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count > 0),
  PRIMARY KEY (user_id, window_started_at)
);

ALTER TABLE public.edall_assistant_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edall_assistant_rate_limits FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.edall_assistant_rate_limits
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_edall_assistant_request()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _window_start timestamptz := date_trunc('minute', statement_timestamp());
  _request_count integer;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT (
    public.has_role(_user_id, 'admin'::public.app_role)
    OR public.has_role(_user_id, 'teacher'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'ASSISTANT_ACCESS_DENIED';
  END IF;

  -- Serialize concurrent requests by account before incrementing the quota.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(_user_id::text));

  INSERT INTO public.edall_assistant_rate_limits(user_id, window_started_at, request_count)
  VALUES (_user_id, _window_start, 1)
  ON CONFLICT (user_id, window_started_at)
  DO UPDATE SET request_count = public.edall_assistant_rate_limits.request_count + 1
  RETURNING request_count INTO _request_count;

  -- Prune this account's obsolete counters once per active minute.
  IF _request_count = 1 THEN
    DELETE FROM public.edall_assistant_rate_limits
    WHERE user_id = _user_id
      AND window_started_at < statement_timestamp() - interval '24 hours';
  END IF;

  RETURN _request_count <= 20;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_edall_assistant_request() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_edall_assistant_request() TO authenticated;

COMMENT ON FUNCTION public.consume_edall_assistant_request() IS
  'Atomically enforces 20 authenticated teacher/admin assistant requests per minute per user.';

COMMIT;
