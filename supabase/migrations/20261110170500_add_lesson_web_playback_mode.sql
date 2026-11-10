-- Default to browser + official app playback for all legacy lessons.
-- A false value makes the web UI omit the video player and explain that the lesson
-- should be opened from the official app. This is a presentation policy only until
-- the Android client can prove its identity to the server (the browser and app
-- currently share the same Supabase user token).
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS web_playback_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.lessons.web_playback_enabled IS
  'Whether lesson videos are displayed in the web platform. FALSE means app-only in the web UI; secure API separation requires verifiable app identity.';
