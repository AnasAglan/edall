CREATE OR REPLACE FUNCTION public.setup_new_user(
    _user_id uuid,
    _name text,
    _email text,
    _requested_role text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    _user_count integer;
    _target_role public.app_role;
    _normalized_role text;
    _has_role boolean;
BEGIN
    INSERT INTO public.profiles (id, name, email)
    VALUES (_user_id, COALESCE(NULLIF(trim(_name), ''), _email), _email)
    ON CONFLICT (id) DO UPDATE
    SET name = COALESCE(EXCLUDED.name, public.profiles.name),
        email = COALESCE(EXCLUDED.email, public.profiles.email);

    SELECT EXISTS (
        SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    ) INTO _has_role;

    IF _has_role THEN
        IF _requested_role IS NOT NULL AND NOT public.has_role(_user_id, 'admin'::public.app_role) THEN
            _normalized_role := lower(trim(_requested_role));
            IF _normalized_role IN ('teacher', 'student') THEN
                DELETE FROM public.user_roles
                WHERE user_id = _user_id
                  AND role IN ('teacher'::public.app_role, 'student'::public.app_role);

                INSERT INTO public.user_roles (user_id, role)
                VALUES (_user_id, _normalized_role::public.app_role)
                ON CONFLICT (user_id, role) DO NOTHING;
            END IF;
        END IF;
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
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    PERFORM public.setup_new_user(
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
        NEW.email,
        NEW.raw_user_meta_data->>'requested_role'
    );
    RETURN NEW;
END;
$$;