CREATE OR REPLACE FUNCTION public.get_course_creators_public()
RETURNS TABLE(id uuid, name text, avatar_url text, bio text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.id, p.name, p.avatar_url, p.bio
  FROM public.profiles p
  WHERE p.id IN (SELECT DISTINCT created_by FROM public.courses);
$$;

GRANT EXECUTE ON FUNCTION public.get_course_creators_public() TO anon, authenticated;