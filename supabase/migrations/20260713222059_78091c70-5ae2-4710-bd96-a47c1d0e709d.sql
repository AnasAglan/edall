CREATE UNIQUE INDEX IF NOT EXISTS courses_title_unique_ci ON public.courses (lower(title));
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_ci ON public.profiles (lower(email));