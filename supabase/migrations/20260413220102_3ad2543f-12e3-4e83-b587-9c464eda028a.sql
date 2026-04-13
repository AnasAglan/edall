
-- Clean up all old storage policies for lesson-pdfs
DROP POLICY IF EXISTS "Course owners can upload lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Teachers and admins can upload lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Course owners can delete lesson pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete lesson pdfs" ON storage.objects;

-- Recreate clean policies
CREATE POLICY "Anyone can view lesson pdfs" ON storage.objects
  FOR SELECT USING (bucket_id = 'lesson-pdfs');

CREATE POLICY "Authenticated can upload lesson pdfs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lesson-pdfs');

CREATE POLICY "Authenticated can update lesson pdfs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'lesson-pdfs');

CREATE POLICY "Authenticated can delete lesson pdfs" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'lesson-pdfs');

-- Function to get courses sorted by enrollment count
CREATE OR REPLACE FUNCTION public.get_courses_sorted_by_enrollment(_offset int, _limit int)
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  image_url text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  enrollment_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    c.id, c.title, c.description, c.image_url, c.created_by, c.created_at, c.updated_at,
    COALESCE(COUNT(e.id), 0) AS enrollment_count
  FROM public.courses c
  LEFT JOIN public.enrollments e ON e.course_id = c.id
  GROUP BY c.id, c.title, c.description, c.image_url, c.created_by, c.created_at, c.updated_at
  ORDER BY enrollment_count DESC, c.created_at DESC
  OFFSET _offset
  LIMIT _limit;
$$;
