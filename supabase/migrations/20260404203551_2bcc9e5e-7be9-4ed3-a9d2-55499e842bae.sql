
-- Drop the old restrictive update policy
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Create new policy: users can update own profile OR admin can update any profile
CREATE POLICY "Users can update own profile or admin can update any"
ON public.profiles
FOR UPDATE
USING (id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
