-- Serialize first-account bootstrap so concurrent first signups cannot
-- both observe an empty role table and both receive administrator access.
BEGIN;

CREATE OR REPLACE FUNCTION public.setup_new_user(
    _user_id uuid,
    _name text,
    _email text,
    _requested_role text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    _user_count integer;
    _target_role public.app_role;
    _normalized_role text;
    _has_role boolean;
    _pid text;
BEGIN
    IF auth.uid() IS NOT NULL AND auth.uid() <> _user_id THEN
        RAISE EXCEPTION 'Not authorized to initialize another account';
    END IF;

    _pid := public.generate_public_id();
    INSERT INTO public.profiles (id, name, email, public_id)
    VALUES (_user_id, COALESCE(NULLIF(trim(_name), ''), _email), _email, _pid)
    ON CONFLICT (id) DO UPDATE
    SET name = COALESCE(EXCLUDED.name, public.profiles.name),
        email = COALESCE(EXCLUDED.email, public.profiles.email),
        public_id = COALESCE(public.profiles.public_id, EXCLUDED.public_id);

    INSERT INTO public.wallets (user_id, balance)
    VALUES (_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    ) INTO _has_role;

    -- Browser/RPC calls can repair the profile and wallet, but must never change roles.
    IF auth.uid() IS NOT NULL THEN
        IF NOT _has_role THEN
            RAISE EXCEPTION 'Account role has not been initialized by the signup trigger';
        END IF;
        RETURN;
    END IF;

    -- This branch is for trusted database-trigger/service execution only.
    IF _has_role THEN
        RETURN;
    END IF;

    SELECT count(*) INTO _user_count FROM public.user_roles;
    IF _user_count = 0 THEN
        -- Only the empty-table bootstrap path needs serialization. Re-count
        -- after obtaining the lock because another first signup may have
        -- committed while this transaction was waiting.
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('edall-initial-admin-bootstrap', 0)
        );
        SELECT count(*) INTO _user_count FROM public.user_roles;
    END IF;
    IF _user_count = 0 THEN
        _target_role := 'admin'::public.app_role;
    ELSE
        _normalized_role := lower(trim(COALESCE(_requested_role, 'student')));
        IF _normalized_role = 'teacher' THEN
            _target_role := 'teacher'::public.app_role;
        ELSE
            _target_role := 'student'::public.app_role;
        END IF;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, _target_role)
    ON CONFLICT (user_id, role) DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION public.setup_new_user(uuid, text, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.setup_new_user(uuid, text, text, text)
TO service_role;

COMMIT;
