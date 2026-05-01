DROP POLICY IF EXISTS "Course owners can update lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can replace lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can remove lesson pdfs" ON storage.objects;

CREATE POLICY "Anyone can view lesson pdfs"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'lesson-pdfs');

CREATE POLICY "Authenticated users can upload lesson pdfs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'lesson-pdfs');

CREATE POLICY "Authenticated users can replace lesson pdfs"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'lesson-pdfs')
WITH CHECK (bucket_id = 'lesson-pdfs');

CREATE POLICY "Authenticated users can remove lesson pdfs"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'lesson-pdfs');

DROP FUNCTION IF EXISTS public.get_courses_sorted_by_enrollment(integer, integer);

CREATE FUNCTION public.get_courses_sorted_by_enrollment(_offset int, _limit int)
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  image_url text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  enrollment_count bigint,
  lesson_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    c.id,
    c.title,
    c.description,
    c.image_url,
    c.created_by,
    c.created_at,
    c.updated_at,
    COALESCE(COUNT(DISTINCT e.id), 0) AS enrollment_count,
    COALESCE(COUNT(DISTINCT l.id), 0) AS lesson_count
  FROM public.courses c
  LEFT JOIN public.enrollments e ON e.course_id = c.id
  LEFT JOIN public.lessons l ON l.course_id = c.id
  GROUP BY c.id, c.title, c.description, c.image_url, c.created_by, c.created_at, c.updated_at
  ORDER BY enrollment_count DESC, c.created_at DESC
  OFFSET _offset
  LIMIT _limit;
$$;