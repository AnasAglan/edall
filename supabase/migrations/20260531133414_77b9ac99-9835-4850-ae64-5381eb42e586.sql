-- Allow users to delete their own notifications, admins delete any
CREATE POLICY "Users can delete own notifications"
ON public.notifications
FOR DELETE
TO authenticated
USING ((user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- Public RPC to search teacher/admin profiles (visible to guests)
CREATE OR REPLACE FUNCTION public.search_teachers_public(_term text)
RETURNS TABLE(id uuid, name text, avatar_url text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.id, p.name, p.avatar_url, p.email
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role IN ('teacher'::public.app_role, 'admin'::public.app_role)
    AND (
      _term IS NULL OR _term = '' OR
      p.name ILIKE '%' || _term || '%' OR
      p.email ILIKE '%' || _term || '%'
    )
  LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.search_teachers_public(text) TO anon, authenticated;