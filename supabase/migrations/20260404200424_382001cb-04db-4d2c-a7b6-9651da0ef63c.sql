
-- 1. Fix exam_questions: restrict SELECT to authenticated only
DROP POLICY IF EXISTS "Anyone can view exam questions" ON public.exam_questions;
CREATE POLICY "Authenticated users can view exam questions"
  ON public.exam_questions FOR SELECT TO authenticated
  USING (true);

-- 2. Fix profiles: restrict SELECT to own profile + admins
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view own profile or admins view all"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

-- 3. Fix storage: lesson-pdfs write policies - restrict to course owners/admins
DROP POLICY IF EXISTS "Authenticated users can upload lesson pdfs" ON storage.objects;
CREATE POLICY "Course owners can upload lesson pdfs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lesson-pdfs' AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      has_role(auth.uid(), 'teacher'::app_role)
    )
  );

DROP POLICY IF EXISTS "Authenticated users can update lesson pdfs" ON storage.objects;
CREATE POLICY "Course owners can update lesson pdfs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'lesson-pdfs' AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      has_role(auth.uid(), 'teacher'::app_role)
    )
  );

DROP POLICY IF EXISTS "Authenticated users can delete lesson pdfs" ON storage.objects;
CREATE POLICY "Course owners can delete lesson pdfs"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'lesson-pdfs' AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      has_role(auth.uid(), 'teacher'::app_role)
    )
  );

-- 4. Fix storage: course-images write policies - restrict to course owners/admins
DROP POLICY IF EXISTS "Authenticated users can upload course images" ON storage.objects;
CREATE POLICY "Course owners can upload course images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'course-images' AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      has_role(auth.uid(), 'teacher'::app_role)
    )
  );

DROP POLICY IF EXISTS "Authenticated users can update course images" ON storage.objects;
CREATE POLICY "Course owners can update course images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'course-images' AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      has_role(auth.uid(), 'teacher'::app_role)
    )
  );

DROP POLICY IF EXISTS "Authenticated users can delete course images" ON storage.objects;
CREATE POLICY "Course owners can delete course images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'course-images' AND (
      has_role(auth.uid(), 'admin'::app_role) OR
      has_role(auth.uid(), 'teacher'::app_role)
    )
  );

-- 5. Fix storage: avatars - restrict update/delete to own folder
DROP POLICY IF EXISTS "Users can update own avatars" ON storage.objects;
CREATE POLICY "Users can update own avatars"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete own avatars" ON storage.objects;
CREATE POLICY "Users can delete own avatars"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 6. Fix avatars upload - restrict to own folder
DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
CREATE POLICY "Users can upload own avatars"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]
  );
