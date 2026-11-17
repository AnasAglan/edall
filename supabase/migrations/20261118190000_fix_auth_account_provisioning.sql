-- Provision profile, wallet, and a least-privilege signup role inside the trusted
-- auth.users trigger. Browser clients must never call setup_new_user directly:
-- that function is intentionally restricted to service_role.
BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    _user_count integer;
    _target_role public.app_role;
    _requested_role text;
BEGIN
    -- Serialize signup bootstrap so concurrent first signups cannot both become admins.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('edall-initial-admin-bootstrap', 0)
    );

    INSERT INTO public.profiles (id, name, email, public_id)
    VALUES (
        NEW.id,
        COALESCE(NULLIF(pg_catalog.btrim(NEW.raw_user_meta_data->>'name'), ''), NEW.email),
        NEW.email,
        public.generate_public_id()
    )
    ON CONFLICT (id) DO UPDATE
    SET name = COALESCE(NULLIF(EXCLUDED.name, ''), public.profiles.name),
        email = COALESCE(EXCLUDED.email, public.profiles.email),
        public_id = COALESCE(public.profiles.public_id, EXCLUDED.public_id);

    INSERT INTO public.wallets (user_id, balance)
    VALUES (NEW.id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT count(*) INTO _user_count FROM public.user_roles;
    IF _user_count = 0 THEN
        -- Preserve the platform's initial administrator bootstrap.
        _target_role := 'admin'::public.app_role;
    ELSE
        _requested_role := pg_catalog.lower(
            pg_catalog.btrim(COALESCE(NEW.raw_user_meta_data->>'requested_role', 'student'))
        );
        -- Public signup may request student or teacher only; never admin.
        IF _requested_role = 'teacher' THEN
            _target_role := 'teacher'::public.app_role;
        ELSE
            _target_role := 'student'::public.app_role;
        END IF;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, _target_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

COMMIT;
