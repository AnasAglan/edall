
-- Add bio column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio text;

-- Create lesson_files table
CREATE TABLE IF NOT EXISTS public.lesson_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
    file_url text NOT NULL,
    file_name text NOT NULL,
    sort_order integer DEFAULT 0
);
ALTER TABLE public.lesson_files ENABLE ROW LEVEL SECURITY;

-- RLS for lesson_files (same pattern as lesson_videos)
CREATE POLICY "Anyone can view lesson files" ON public.lesson_files FOR SELECT TO public USING (true);
CREATE POLICY "Course owner or admin can insert files" ON public.lesson_files FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = lesson_files.lesson_id AND (c.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Course owner or admin can update files" ON public.lesson_files FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = lesson_files.lesson_id AND (c.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Course owner or admin can delete files" ON public.lesson_files FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = lesson_files.lesson_id AND (c.created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('lesson-pdfs', 'lesson-pdfs', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('course-images', 'course-images', true) ON CONFLICT (id) DO NOTHING;

-- Storage policies for lesson-pdfs
CREATE POLICY "Anyone can view lesson pdfs" ON storage.objects FOR SELECT TO public USING (bucket_id = 'lesson-pdfs');
CREATE POLICY "Authenticated users can upload lesson pdfs" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'lesson-pdfs');
CREATE POLICY "Authenticated users can update lesson pdfs" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'lesson-pdfs');
CREATE POLICY "Authenticated users can delete lesson pdfs" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'lesson-pdfs');

-- Storage policies for course-images
CREATE POLICY "Anyone can view course images" ON storage.objects FOR SELECT TO public USING (bucket_id = 'course-images');
CREATE POLICY "Authenticated users can upload course images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'course-images');
CREATE POLICY "Authenticated users can update course images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'course-images');
CREATE POLICY "Authenticated users can delete course images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'course-images');

-- Create trigger for handle_new_user on auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Update handle_new_user to also assign role based on user count
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    _user_count integer;
    _role app_role;
BEGIN
    INSERT INTO public.profiles (id, name, email)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email), NEW.email)
    ON CONFLICT (id) DO NOTHING;
    
    SELECT count(*) INTO _user_count FROM public.user_roles;
    IF _user_count = 0 THEN
        _role := 'admin';
    ELSE
        _role := 'student';
    END IF;
    
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
    
    RETURN NEW;
END;
$function$;
