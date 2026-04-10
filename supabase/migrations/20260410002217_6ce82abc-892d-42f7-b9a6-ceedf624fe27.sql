
DROP POLICY IF EXISTS "Users can view own profile or admins view all" ON public.profiles;

CREATE POLICY "Authenticated users can view all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);
