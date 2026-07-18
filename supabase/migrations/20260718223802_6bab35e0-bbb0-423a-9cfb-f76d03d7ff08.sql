DROP FUNCTION IF EXISTS public.admin_search_users(text, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_search_users(_term text, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, name text, email text, avatar_url text, balance numeric, public_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, p.email, p.avatar_url, COALESCE(w.balance, 0) AS balance, p.public_id
    FROM public.profiles p
    LEFT JOIN public.wallets w ON w.user_id = p.id
    WHERE _term IS NULL OR _term = ''
       OR p.name ILIKE '%'||_term||'%'
       OR p.email ILIKE '%'||_term||'%'
       OR p.public_id ILIKE '%'||_term||'%'
    ORDER BY p.name NULLS LAST
    LIMIT _limit OFFSET _offset;
END;
$function$;

UPDATE public.profiles SET public_id = public.generate_public_id() WHERE public_id IS NULL;