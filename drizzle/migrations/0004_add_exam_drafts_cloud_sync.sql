CREATE TABLE public.exam_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_drafts TO authenticated;
GRANT ALL ON public.exam_drafts TO service_role;
ALTER TABLE public.exam_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exam_drafts_select_own" ON public.exam_drafts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "exam_drafts_insert_own" ON public.exam_drafts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "exam_drafts_update_own" ON public.exam_drafts FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "exam_drafts_delete_own" ON public.exam_drafts FOR DELETE TO authenticated USING (auth.uid() = user_id);