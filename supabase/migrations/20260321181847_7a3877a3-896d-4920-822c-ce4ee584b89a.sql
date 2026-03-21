
-- Create a security definer function to setup new users (bypasses RLS)
CREATE OR REPLACE FUNCTION public.setup_new_user(_user_id uuid, _name text, _email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    _user_count integer;
    _role app_role;
BEGIN
    -- Insert profile (ignore if exists)
    INSERT INTO public.profiles (id, name, email)
    VALUES (_user_id, _name, _email)
    ON CONFLICT (id) DO NOTHING;
    
    -- Check if this is the first user (make them admin)
    SELECT count(*) INTO _user_count FROM public.user_roles;
    
    IF _user_count = 0 THEN
        _role := 'admin';
    ELSE
        _role := 'student';
    END IF;
    
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

-- Create a function to get user role (callable from client)
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT role::text FROM public.user_roles WHERE user_id = _user_id LIMIT 1;
$$;
