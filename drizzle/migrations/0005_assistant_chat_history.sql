-- Persistent, user-owned ED-ALL assistant conversations and messages.
CREATE TABLE IF NOT EXISTS public.assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'محادثة جديدة' CHECK (char_length(title) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_conversations_id_user_unique UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (char_length(content) <= 20000),
  has_attachments boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_messages_conversation_owner_fkey
    FOREIGN KEY (conversation_id, user_id)
    REFERENCES public.assistant_conversations(id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS assistant_conversations_user_updated_idx
  ON public.assistant_conversations (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS assistant_messages_conversation_created_idx
  ON public.assistant_messages (conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS assistant_messages_user_created_idx
  ON public.assistant_messages (user_id, created_at DESC);

ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own assistant conversations" ON public.assistant_conversations;
CREATE POLICY "Users read own assistant conversations"
  ON public.assistant_conversations FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users create own assistant conversations" ON public.assistant_conversations;
CREATE POLICY "Users create own assistant conversations"
  ON public.assistant_conversations FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users update own assistant conversations" ON public.assistant_conversations;
CREATE POLICY "Users update own assistant conversations"
  ON public.assistant_conversations FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users delete own assistant conversations" ON public.assistant_conversations;
CREATE POLICY "Users delete own assistant conversations"
  ON public.assistant_conversations FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users read own assistant messages" ON public.assistant_messages;
CREATE POLICY "Users read own assistant messages"
  ON public.assistant_messages FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.assistant_conversations c
      WHERE c.id = conversation_id AND c.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users create own assistant messages" ON public.assistant_messages;
CREATE POLICY "Users create own assistant messages"
  ON public.assistant_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.assistant_conversations c
      WHERE c.id = conversation_id AND c.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users delete own assistant messages" ON public.assistant_messages;
CREATE POLICY "Users delete own assistant messages"
  ON public.assistant_messages FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.assistant_conversations c
      WHERE c.id = conversation_id AND c.user_id = (SELECT auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assistant_conversations TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.assistant_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_assistant_conversation_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.assistant_conversations
  SET updated_at = now()
  WHERE id = NEW.conversation_id AND user_id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_assistant_conversation_updated_at ON public.assistant_messages;
CREATE TRIGGER touch_assistant_conversation_updated_at
AFTER INSERT ON public.assistant_messages
FOR EACH ROW
EXECUTE FUNCTION public.touch_assistant_conversation_updated_at();
