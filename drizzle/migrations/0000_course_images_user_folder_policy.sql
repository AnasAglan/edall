CREATE POLICY "Users can upload course images in own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'course-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update course images in own folder"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'course-images' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'course-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete course images in own folder"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'course-images' AND (storage.foldername(name))[1] = auth.uid()::text);