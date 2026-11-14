-- Enforce the platform's web-playback switch in PostgreSQL, not only in the browser.
-- A RESTRICTIVE policy composes with existing teacher/admin write/read policies and
-- requires every existing permissive SELECT policy to also pass this entitlement gate.
BEGIN;

ALTER TABLE public.lesson_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enforce web playback entitlement" ON public.lesson_videos;
CREATE POLICY "Enforce web playback entitlement"
ON public.lesson_videos
AS RESTRICTIVE
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.lessons l
    WHERE l.id = lesson_videos.lesson_id
      AND l.web_playback_enabled IS TRUE
      AND public.can_access_lesson(l.id)
  )
);

COMMENT ON POLICY "Enforce web playback entitlement" ON public.lesson_videos IS
  'Restrictive SELECT gate: lesson video URLs are visible only when the viewer is entitled and web playback is enabled. Does not change Windows/Android clients.';

COMMIT;
