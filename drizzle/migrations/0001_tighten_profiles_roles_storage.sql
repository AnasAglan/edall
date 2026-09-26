DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;
CREATE POLICY "Users view own profile, admins view all" ON public.profiles
FOR SELECT TO authenticated
USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Authenticated users can view all roles" ON public.user_roles;
CREATE POLICY "Users view own roles, admins view all" ON public.user_roles
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- Public buckets: stop anonymous listing (public URLs keep working)
DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view course images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view lesson pdfs" ON storage.objects;

CREATE POLICY "Owners can read own avatars" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (auth.uid())::text);

CREATE POLICY "Owners can read own course images" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'course-images' AND (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (storage.foldername(name))[1] = (auth.uid())::text
  OR (storage.foldername(name))[1] IN (SELECT c.id::text FROM public.courses c WHERE c.created_by = auth.uid())
));

-- Lesson PDFs: only course owners (folder = course id) or admins can manage
DROP POLICY IF EXISTS "Authenticated users can upload lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can replace lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can remove lesson pdfs" ON storage.objects;

CREATE POLICY "Course owners can read lesson pdfs" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'lesson-pdfs' AND (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (storage.foldername(name))[1] IN (SELECT c.id::text FROM public.courses c WHERE c.created_by = auth.uid())
));
CREATE POLICY "Course owners can upload lesson pdfs" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'lesson-pdfs' AND (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (storage.foldername(name))[1] IN (SELECT c.id::text FROM public.courses c WHERE c.created_by = auth.uid())
));
CREATE POLICY "Course owners can replace lesson pdfs" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'lesson-pdfs' AND (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (storage.foldername(name))[1] IN (SELECT c.id::text FROM public.courses c WHERE c.created_by = auth.uid())
))
WITH CHECK (bucket_id = 'lesson-pdfs' AND (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (storage.foldername(name))[1] IN (SELECT c.id::text FROM public.courses c WHERE c.created_by = auth.uid())
));
CREATE POLICY "Course owners can remove lesson pdfs" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'lesson-pdfs' AND (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (storage.foldername(name))[1] IN (SELECT c.id::text FROM public.courses c WHERE c.created_by = auth.uid())
));