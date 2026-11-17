-- ED-ALL consolidated manual SQL migration bundle
-- Source: AnasAglan/edall main; generated 2026-11-17
-- Review actual database state and migration history before executing.

-- SOURCE FILE: 20261110170000_harden_setup_new_user_roles.sql

-- Account bootstrap must never be usable as a role-change endpoint.
-- New-user role assignment is performed by the auth.users trigger (auth.uid() is NULL).
-- An authenticated caller may only bootstrap its own profile/wallet and cannot choose or
-- replace any role that already exists.

CREATE OR REPLACE FUNCTION public.setup_new_user(
    _user_id uuid,
    _name text,
    _email text,
    _requested_role text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

REVOKE ALL ON FUNCTION public.setup_new_user(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.setup_new_user(uuid, text, text, text) TO authenticated, service_role;

