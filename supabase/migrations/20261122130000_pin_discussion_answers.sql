-- Support pinning important answers independently from discussion topics.
-- All writes pass through a course-capability checked, audited RPC.

BEGIN;

ALTER TABLE public.discussion_posts
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS discussion_posts_pinned_idx
  ON public.discussion_posts(topic_id,is_pinned DESC,created_at ASC);

CREATE OR REPLACE FUNCTION public.set_discussion_post_pinned(
  _post_id uuid,
  _pinned boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _course_id uuid;
  _actor_id uuid := auth.uid();
BEGIN
  IF _actor_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF _post_id IS NULL OR _pinned IS NULL THEN
    RAISE EXCEPTION 'INVALID_DISCUSSION_PIN';
  END IF;

  SELECT topic.course_id
  INTO _course_id
  FROM public.discussion_posts AS post
  JOIN public.discussion_topics AS topic ON topic.id = post.topic_id
  WHERE post.id = _post_id;

  IF NOT FOUND
     OR NOT public.has_course_capability(_course_id,'discussions') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  IF public.has_role(_actor_id,'admin'::public.app_role)
     AND NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;

  UPDATE public.discussion_posts
  SET is_pinned = _pinned,
      updated_at = now()
  WHERE id = _post_id;

  PERFORM public.write_platform_audit_event(
    CASE WHEN _pinned THEN 'discussion_answer_pinned' ELSE 'discussion_answer_unpinned' END,
    'discussion_posts',
    _post_id,
    _course_id,
    jsonb_build_object('is_pinned',_pinned)
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_discussion_post_pinned(uuid,boolean)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_discussion_post_pinned(uuid,boolean)
  TO authenticated;

COMMENT ON COLUMN public.discussion_posts.is_pinned
  IS 'Marks an important answer within its topic; updates are restricted to the audited pin RPC.';

-- Keep the feed scoped to enrolled learners and course-capable staff, and expose
-- only the public answer fields plus the pin state required by the UI.
CREATE OR REPLACE FUNCTION public.get_course_discussion_feed(_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _feed jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_course_capability(_course_id,'discussions')
    OR EXISTS (
      SELECT 1
      FROM public.enrollments AS enrollment
      WHERE enrollment.course_id = _course_id
        AND enrollment.user_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',topic.id,
        'course_id',topic.course_id,
        'lesson_id',topic.lesson_id,
        'author_id',topic.author_id,
        'author_name',profile.name,
        'title',topic.title,
        'is_pinned',topic.is_pinned,
        'is_locked',topic.is_locked,
        'is_hidden',topic.is_hidden,
        'created_at',topic.created_at,
        'posts',COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id',post.id,
              'author_id',post.author_id,
              'author_name',author_profile.name,
              'content',post.content,
              'created_at',post.created_at,
              'is_hidden',post.is_hidden,
              'is_pinned',post.is_pinned
            )
            ORDER BY post.is_pinned DESC,post.created_at ASC
          )
          FROM public.discussion_posts AS post
          JOIN public.profiles AS author_profile ON author_profile.id = post.author_id
          WHERE post.topic_id = topic.id
            AND (
              NOT post.is_hidden
              OR public.has_course_capability(_course_id,'discussions')
            )
        ),'[]'::jsonb)
      )
      ORDER BY topic.is_pinned DESC,topic.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO _feed
  FROM public.discussion_topics AS topic
  JOIN public.profiles AS profile ON profile.id = topic.author_id
  WHERE topic.course_id = _course_id
    AND (
      NOT topic.is_hidden
      OR public.has_course_capability(_course_id,'discussions')
    );

  RETURN _feed;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_course_discussion_feed(uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_course_discussion_feed(uuid)
  TO authenticated;

COMMIT;
