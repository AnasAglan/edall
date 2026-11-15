-- Permit the legacy lesson-editor pre-upload flow without making staged
-- PDFs public or allowing arbitrary accounts to populate another course.
-- Files are staged under: <course-uuid>/temp_<unix-ms>/<file-name>, then the
-- lesson_files row binds the object path to the final lesson after creation.
BEGIN;

DROP POLICY IF EXISTS "Course capability upload lesson PDFs" ON storage.objects;
CREATE POLICY "Course capability upload lesson PDFs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='lesson-pdfs'
  AND metadata->>'mimetype'='application/pdf'
  AND array_length(storage.foldername(name),1)=2
  AND EXISTS (
    SELECT 1
    FROM public.courses c
    WHERE c.id::text=split_part(name,'/',1)
      AND public.has_course_capability(c.id,'content')
      AND (
        EXISTS (
          SELECT 1
          FROM public.lessons l
          WHERE l.course_id=c.id
            AND l.id::text=split_part(name,'/',2)
        )
        OR split_part(name,'/',2) ~ '^temp_[0-9]{10,}$'
      )
  )
);

-- The legacy mobile uploader retries the same temporary key with x-upsert:true.
-- Permit replacement only inside this course's temporary staging folder.
DROP POLICY IF EXISTS "Course staff update staged lesson PDFs" ON storage.objects;
CREATE POLICY "Course staff update staged lesson PDFs"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id='lesson-pdfs'
  AND array_length(storage.foldername(name),1)=2
  AND split_part(name,'/',2) ~ '^temp_[0-9]{10,}-- or the lesson form is abandoned. Restrict this exception to the staging path
-- and course content managers; final lesson objects keep the stricter policy.
DROP POLICY IF EXISTS "Course staff delete staged lesson PDFs" ON storage.objects;
CREATE POLICY "Course staff delete staged lesson PDFs"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id='lesson-pdfs'
  AND array_length(storage.foldername(name),1)=2
  AND split_part(name,'/',2) ~ '^temp_[0-9]{10,}$'
  AND EXISTS (
    SELECT 1
    FROM public.courses c
    WHERE c.id::text=split_part(name,'/',1)
      AND public.has_course_capability(c.id,'content')
  )
);

COMMIT;

  AND EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id::text=split_part(name,'/',1)
      AND public.has_course_capability(c.id,'content')
  )
)
WITH CHECK (
  bucket_id='lesson-pdfs'
  AND metadata->>'mimetype'='application/pdf'
  AND array_length(storage.foldername(name),1)=2
  AND split_part(name,'/',2) ~ '^temp_[0-9]{10,}-- or the lesson form is abandoned. Restrict this exception to the staging path
-- and course content managers; final lesson objects keep the stricter policy.
DROP POLICY IF EXISTS "Course staff delete staged lesson PDFs" ON storage.objects;
CREATE POLICY "Course staff delete staged lesson PDFs"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id='lesson-pdfs'
  AND array_length(storage.foldername(name),1)=2
  AND split_part(name,'/',2) ~ '^temp_[0-9]{10,}$'
  AND EXISTS (
    SELECT 1
    FROM public.courses c
    WHERE c.id::text=split_part(name,'/',1)
      AND public.has_course_capability(c.id,'content')
  )
);

COMMIT;

  AND EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id::text=split_part(name,'/',1)
      AND public.has_course_capability(c.id,'content')
  )
);

-- The lesson editor deletes its own staged objects when an upload is cancelled
-- or the lesson form is abandoned. Restrict this exception to the staging path
-- and course content managers; final lesson objects keep the stricter policy.
DROP POLICY IF EXISTS "Course staff delete staged lesson PDFs" ON storage.objects;
CREATE POLICY "Course staff delete staged lesson PDFs"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id='lesson-pdfs'
  AND array_length(storage.foldername(name),1)=2
  AND split_part(name,'/',2) ~ '^temp_[0-9]{10,}$'
  AND EXISTS (
    SELECT 1
    FROM public.courses c
    WHERE c.id::text=split_part(name,'/',1)
      AND public.has_course_capability(c.id,'content')
  )
);

COMMIT;
