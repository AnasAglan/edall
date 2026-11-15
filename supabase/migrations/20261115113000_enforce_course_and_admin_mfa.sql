-- Complete AAL2 and course-scoped authorization for legacy platform operations.
-- Students continue to use the safe exam RPC; only course staff can read answer keys.
BEGIN;

-- A privileged admin account must always be at AAL2 for private course access.
CREATE OR REPLACE FUNCTION public.can_access_lesson(_lesson_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.lessons l
    JOIN public.courses c ON c.id=l.course_id
    WHERE l.id=_lesson_id
      AND (
        c.price <= 0
        OR l.is_free = true
        OR EXISTS (
          SELECT 1 FROM public.enrollments e
          WHERE e.course_id=c.id AND e.user_id=auth.uid()
        )
        OR public.has_course_capability(c.id,'content')
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.can_access_lesson(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_lesson(uuid) TO anon, authenticated, service_role;

-- Courses: public catalog stays public; edits and deletes are course-scoped.
DROP POLICY IF EXISTS "Teachers and admins can create courses" ON public.courses;
CREATE POLICY "Teachers and MFA admins can create courses"
ON public.courses FOR INSERT TO authenticated
WITH CHECK (
  (public.has_role(auth.uid(),'teacher'::public.app_role)
   AND NOT public.has_role(auth.uid(),'admin'::public.app_role))
  OR (
    public.has_role(auth.uid(),'admin'::public.app_role)
    AND public.admin_mfa_verified()
  )
);

DROP POLICY IF EXISTS "Course owner or admin can update" ON public.courses;
CREATE POLICY "Course capability can update course"
ON public.courses FOR UPDATE TO authenticated
USING (public.has_course_capability(id,'content'))
WITH CHECK (public.has_course_capability(id,'content'));

DROP POLICY IF EXISTS "Course owner or admin can delete" ON public.courses;
CREATE POLICY "Course capability can delete course"
ON public.courses FOR DELETE TO authenticated
USING (public.has_course_capability(id,'content'));

-- Lessons
DROP POLICY IF EXISTS "Course owner or admin can insert lessons" ON public.lessons;
CREATE POLICY "Course capability can insert lessons"
ON public.lessons FOR INSERT TO authenticated
WITH CHECK (public.has_course_capability(course_id,'content'));

DROP POLICY IF EXISTS "Course owner or admin can update lessons" ON public.lessons;
CREATE POLICY "Course capability can update lessons"
ON public.lessons FOR UPDATE TO authenticated
USING (public.has_course_capability(course_id,'content'))
WITH CHECK (public.has_course_capability(course_id,'content'));

DROP POLICY IF EXISTS "Course owner or admin can delete lessons" ON public.lessons;
CREATE POLICY "Course capability can delete lessons"
ON public.lessons FOR DELETE TO authenticated
USING (public.has_course_capability(course_id,'content'));

-- Videos
DROP POLICY IF EXISTS "Course owner or admin can insert videos" ON public.lesson_videos;
CREATE POLICY "Course capability can insert videos"
ON public.lesson_videos FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id=lesson_videos.lesson_id
      AND public.has_course_capability(l.course_id,'content')
  )
);

DROP POLICY IF EXISTS "Course owner or admin can update videos" ON public.lesson_videos;
CREATE POLICY "Course capability can update videos"
ON public.lesson_videos FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id=lesson_videos.lesson_id
      AND public.has_course_capability(l.course_id,'content')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id=lesson_videos.lesson_id
      AND public.has_course_capability(l.course_id,'content')
  )
);

DROP POLICY IF EXISTS "Course owner or admin can delete videos" ON public.lesson_videos;
CREATE POLICY "Course capability can delete videos"
ON public.lesson_videos FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id=lesson_videos.lesson_id
      AND public.has_course_capability(l.course_id,'content')
  )
);

-- Lesson PDF metadata and object writes must belong to a permitted course.
DROP POLICY IF EXISTS "Course owner or admin can insert files" ON public.lesson_files;
CREATE POLICY "Course capability can insert files"
ON public.lesson_files FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id=lesson_files.lesson_id
      AND public.has_course_capability(l.course_id,'content')
  )
);

DROP POLICY IF EXISTS "Course owner or admin can update files" ON public.lesson_files;
CREATE POLICY "Course capability can update files"
ON public.lesson_files FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id=lesson_files.lesson_id
      AND public.has_course_capability(l.course_id,'content')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id=lesson_files.lesson_id
      AND public.has_course_capability(l.course_id,'content')
  )
);

DROP POLICY IF EXISTS "Course owner or admin can delete files" ON public.lesson_files;
CREATE POLICY "Course capability can delete files"
ON public.lesson_files FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id=lesson_files.lesson_id
      AND public.has_course_capability(l.course_id,'content')
  )
);

-- Exam metadata remains visible only when the caller is entitled to the lesson.
-- Answer keys remain hidden from students by using get_exam_questions_safe().
DROP POLICY IF EXISTS "Course owners and admins can view exam questions" ON public.exam_questions;
DROP POLICY IF EXISTS "Course owner or admin can insert questions" ON public.exam_questions;
DROP POLICY IF EXISTS "Course owner or admin can update questions" ON public.exam_questions;
DROP POLICY IF EXISTS "Course owner or admin can delete questions" ON public.exam_questions;

CREATE POLICY "Course capability can read answer keys"
ON public.exam_questions FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.exams e
    JOIN public.lessons l ON l.id=e.lesson_id
    WHERE e.id=exam_questions.exam_id
      AND public.has_course_capability(l.course_id,'exams')
  )
);

CREATE POLICY "Course capability can insert exam questions"
ON public.exam_questions FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.exams e
    JOIN public.lessons l ON l.id=e.lesson_id
    WHERE e.id=exam_questions.exam_id
      AND public.has_course_capability(l.course_id,'exams')
  )
);

CREATE POLICY "Course capability can update exam questions"
ON public.exam_questions FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.exams e
    JOIN public.lessons l ON l.id=e.lesson_id
    WHERE e.id=exam_questions.exam_id
      AND public.has_course_capability(l.course_id,'exams')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.exams e
    JOIN public.lessons l ON l.id=e.lesson_id
    WHERE e.id=exam_questions.exam_id
      AND public.has_course_capability(l.course_id,'exams')
  )
);

CREATE POLICY "Course capability can delete exam questions"
ON public.exam_questions FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.exams e
    JOIN public.lessons l ON l.id=e.lesson_id
    WHERE e.id=exam_questions.exam_id
      AND public.has_course_capability(l.course_id,'exams')
  )
);

-- Exam settings are edited only by course staff with the exam capability.
DROP POLICY IF EXISTS "Course owner or admin can insert exams" ON public.exams;
CREATE POLICY "Course capability can insert exams"
ON public.exams FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id=exams.lesson_id
      AND public.has_course_capability(l.course_id,'exams')
  )
);

DROP POLICY IF EXISTS "Course owner or admin can update exams" ON public.exams;
CREATE POLICY "Course capability can update exams"
ON public.exams FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id=exams.lesson_id
      AND public.has_course_capability(l.course_id,'exams')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id=exams.lesson_id
      AND public.has_course_capability(l.course_id,'exams')
  )
);

DROP POLICY IF EXISTS "Course owner or admin can delete exams" ON public.exams;
CREATE POLICY "Course capability can delete exams"
ON public.exams FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.lessons l
    WHERE l.id=exams.lesson_id
      AND public.has_course_capability(l.course_id,'exams')
  )
);

-- Result data: learners see their own; course staff see their course only.
DROP POLICY IF EXISTS "Users can view own results" ON public.exam_results;
CREATE POLICY "Students and course staff read exam results"
ON public.exam_results FOR SELECT TO authenticated
USING (
  user_id=auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.exams e
    JOIN public.lessons l ON l.id=e.lesson_id
    WHERE e.id=exam_results.exam_id
      AND public.has_course_capability(l.course_id,'exams')
  )
);

DROP POLICY IF EXISTS "Teachers can update results for grading" ON public.exam_results;
CREATE POLICY "Course capability can grade exam results"
ON public.exam_results FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.exams e
    JOIN public.lessons l ON l.id=e.lesson_id
    WHERE e.id=exam_results.exam_id
      AND public.has_course_capability(l.course_id,'exams')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.exams e
    JOIN public.lessons l ON l.id=e.lesson_id
    WHERE e.id=exam_results.exam_id
      AND public.has_course_capability(l.course_id,'exams')
  )
);

-- The official exam-attempt RPC is the only path for student submission.
DROP POLICY IF EXISTS "Users can insert own results" ON public.exam_results;
REVOKE INSERT ON public.exam_results FROM PUBLIC, anon, authenticated;

-- Preserve the legacy teacher grading UI, but do not let course staff rewrite
-- result ownership, exam identity, attempt identity, or submission timestamps.
REVOKE UPDATE ON public.exam_results FROM PUBLIC, anon, authenticated;
GRANT UPDATE (score, passed, essay_graded, answers)
ON public.exam_results TO authenticated;

-- Enrolment lists are visible to the student and MFA-authenticated admins.
DROP POLICY IF EXISTS "Users can view own enrollments" ON public.enrollments;
CREATE POLICY "Users and MFA admins view enrollments"
ON public.enrollments FOR SELECT TO authenticated
USING (
  user_id=auth.uid()
  OR (public.has_role(auth.uid(),'admin'::public.app_role) AND public.admin_mfa_verified())
);

DROP POLICY IF EXISTS "Admins can remove enrollments" ON public.enrollments;
CREATE POLICY "MFA admins can remove enrollments"
ON public.enrollments FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::public.app_role)
  AND public.admin_mfa_verified()
);

-- Progress and notifications: admin access requires AAL2.
DROP POLICY IF EXISTS "Users can view own progress" ON public.lesson_progress;
CREATE POLICY "Users and MFA admins view progress"
ON public.lesson_progress FOR SELECT TO authenticated
USING (
  user_id=auth.uid()
  OR (public.has_role(auth.uid(),'admin'::public.app_role) AND public.admin_mfa_verified())
);

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users update own notifications or admins update all" ON public.notifications;
CREATE POLICY "Users and MFA admins view notifications"
ON public.notifications FOR SELECT TO authenticated
USING (
  user_id=auth.uid()
  OR user_id IS NULL
  OR (public.has_role(auth.uid(),'admin'::public.app_role) AND public.admin_mfa_verified())
);

CREATE POLICY "Users update own notifications or MFA admins update all"
ON public.notifications FOR UPDATE TO authenticated
USING (
  user_id=auth.uid()
  OR (public.has_role(auth.uid(),'admin'::public.app_role) AND public.admin_mfa_verified())
)
WITH CHECK (
  user_id=auth.uid()
  OR (public.has_role(auth.uid(),'admin'::public.app_role) AND public.admin_mfa_verified())
);

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users delete own notifications or MFA admins delete all"
ON public.notifications FOR DELETE TO authenticated
USING (
  user_id=auth.uid()
  OR (public.has_role(auth.uid(),'admin'::public.app_role) AND public.admin_mfa_verified())
);

-- The public teacher search exposes no email; the admin-only search RPC requires AAL2.
CREATE OR REPLACE FUNCTION public.admin_search_users(_term text,_limit integer DEFAULT 50,_offset integer DEFAULT 0)
RETURNS TABLE(id uuid,name text,email text,avatar_url text,balance numeric,public_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.has_role(auth.uid(),'admin'::public.app_role)
     OR NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;
  RETURN QUERY
  SELECT p.id,p.name,p.email,p.avatar_url,COALESCE(w.balance,0),p.public_id
  FROM public.profiles p
  LEFT JOIN public.wallets w ON w.user_id=p.id
  WHERE COALESCE(_term,'')=''
     OR p.name ILIKE '%'||left(_term,100)||'%'
     OR p.email ILIKE '%'||left(_term,100)||'%'
     OR p.public_id ILIKE '%'||left(_term,100)||'%'
  ORDER BY p.name NULLS LAST
  LIMIT greatest(1,least(COALESCE(_limit,50),100))
  OFFSET greatest(COALESCE(_offset,0),0);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_search_users(text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text,integer,integer) TO authenticated;

-- Wallet balances and ledger are never writable directly from browser sessions.
DROP POLICY IF EXISTS "wallets_admin_write" ON public.wallets;
DROP POLICY IF EXISTS "wallet_tx_admin_write" ON public.wallet_transactions;
DROP POLICY IF EXISTS "wallets_select_own_or_admin" ON public.wallets;
DROP POLICY IF EXISTS "wallet_tx_select_own_or_admin" ON public.wallet_transactions;

CREATE POLICY "Wallet owner or MFA admin read balance"
ON public.wallets FOR SELECT TO authenticated
USING (
  user_id=auth.uid()
  OR (public.has_role(auth.uid(),'admin'::public.app_role) AND public.admin_mfa_verified())
);

CREATE POLICY "Wallet owner or MFA admin read ledger"
ON public.wallet_transactions FOR SELECT TO authenticated
USING (
  user_id=auth.uid()
  OR (public.has_role(auth.uid(),'admin'::public.app_role) AND public.admin_mfa_verified())
);

REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.wallets FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.wallet_transactions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.wallets TO authenticated;
GRANT SELECT ON public.wallet_transactions TO authenticated;

-- Replace top-up contact/settings mutation policies with MFA-gated versions.
DROP POLICY IF EXISTS "topup_contacts_admin_write" ON public.wallet_topup_contacts;
CREATE POLICY "MFA admins manage topup contacts"
ON public.wallet_topup_contacts FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::public.app_role)
  AND public.admin_mfa_verified()
)
WITH CHECK (
  public.has_role(auth.uid(),'admin'::public.app_role)
  AND public.admin_mfa_verified()
);

DROP POLICY IF EXISTS "Admins manage site settings ins" ON public.site_settings;
CREATE POLICY "MFA admins manage site settings insert"
ON public.site_settings FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(),'admin'::public.app_role)
  AND public.admin_mfa_verified()
);

DROP POLICY IF EXISTS "Admins manage site settings upd" ON public.site_settings;
CREATE POLICY "MFA admins manage site settings update"
ON public.site_settings FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::public.app_role)
  AND public.admin_mfa_verified()
)
WITH CHECK (
  public.has_role(auth.uid(),'admin'::public.app_role)
  AND public.admin_mfa_verified()
);

DROP POLICY IF EXISTS "Admins manage site settings del" ON public.site_settings;
CREATE POLICY "MFA admins manage site settings delete"
ON public.site_settings FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::public.app_role)
  AND public.admin_mfa_verified()
);

-- Trusted wallet adjustments must use the audited, serialized RPC.
CREATE OR REPLACE FUNCTION public.admin_credit_wallet(_user_id uuid,_amount numeric,_note text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _new_balance numeric;
  _current numeric;
  _admin uuid := auth.uid();
BEGIN
  IF _admin IS NULL
     OR NOT public.has_role(_admin,'admin'::public.app_role)
     OR NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;
  IF _user_id IS NULL OR _amount IS NULL OR _amount=0 OR abs(_amount)>1000000 THEN
    RAISE EXCEPTION 'INVALID_WALLET_ADJUSTMENT';
  END IF;

  INSERT INTO public.wallets(user_id,balance)
  VALUES (_user_id,0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO _current
  FROM public.wallets WHERE user_id=_user_id
  FOR UPDATE;

  IF _current+_amount<0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  UPDATE public.wallets
  SET balance=balance+_amount
  WHERE user_id=_user_id
  RETURNING balance INTO _new_balance;

  INSERT INTO public.wallet_transactions(user_id,amount,type,note,created_by)
  VALUES (
    _user_id,_amount,
    CASE WHEN _amount>0 THEN 'topup' ELSE 'adjust' END,
    left(COALESCE(_note,''),500),
    _admin
  );

  INSERT INTO public.notifications(user_id,title,message,type)
  VALUES (
    _user_id,
    CASE WHEN _amount>0 THEN 'تم شحن محفظتك' ELSE 'تم تعديل رصيد محفظتك' END,
    CASE WHEN _amount>0
      THEN 'تم إضافة '||_amount::text||' إلى رصيدك. الرصيد الحالي: '||_new_balance::text
      ELSE 'تم خصم '||abs(_amount)::text||' من رصيدك. الرصيد الحالي: '||_new_balance::text
    END,
    'wallet'
  );

  RETURN _new_balance;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_credit_wallet(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_credit_wallet(uuid,numeric,text) TO authenticated;

-- Storage object writes follow the same course-scoped roles as lesson metadata.
-- Lesson PDF keys are course-id/lesson-id/file-name.
DROP POLICY IF EXISTS "Course owners upload lesson PDFs" ON storage.objects;
CREATE POLICY "Course capability upload lesson PDFs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='lesson-pdfs'
  AND metadata->>'mimetype'='application/pdf'
  AND array_length(storage.foldername(name),1)=2
  AND EXISTS (
    SELECT 1
    FROM public.courses c
    JOIN public.lessons l ON l.course_id=c.id
    WHERE c.id::text=split_part(name,'/',1)
      AND l.id::text=split_part(name,'/',2)
      AND public.has_course_capability(c.id,'content')
  )
);

DROP POLICY IF EXISTS "Course owners replace lesson PDFs" ON storage.objects;
CREATE POLICY "Course capability replace lesson PDFs"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id='lesson-pdfs'
  AND EXISTS (
    SELECT 1
    FROM public.courses c
    JOIN public.lessons l ON l.course_id=c.id
    WHERE c.id::text=split_part(name,'/',1)
      AND l.id::text=split_part(name,'/',2)
      AND public.has_course_capability(c.id,'content')
  )
)
WITH CHECK (
  bucket_id='lesson-pdfs'
  AND metadata->>'mimetype'='application/pdf'
  AND array_length(storage.foldername(name),1)=2
  AND EXISTS (
    SELECT 1
    FROM public.courses c
    JOIN public.lessons l ON l.course_id=c.id
    WHERE c.id::text=split_part(name,'/',1)
      AND l.id::text=split_part(name,'/',2)
      AND public.has_course_capability(c.id,'content')
  )
);

DROP POLICY IF EXISTS "Course owners delete lesson PDFs" ON storage.objects;
CREATE POLICY "Course capability delete lesson PDFs"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id='lesson-pdfs'
  AND EXISTS (
    SELECT 1
    FROM public.courses c
    JOIN public.lessons l ON l.course_id=c.id
    WHERE c.id::text=split_part(name,'/',1)
      AND l.id::text=split_part(name,'/',2)
      AND public.has_course_capability(c.id,'content')
  )
);

-- Course images retain the course-id path contract and require the same role.
DROP POLICY IF EXISTS "Course owners can upload course images" ON storage.objects;
CREATE POLICY "Course capability upload course images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='course-images'
  AND EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id::text=split_part(name,'/',1)
      AND public.has_course_capability(c.id,'content')
  )
);

DROP POLICY IF EXISTS "Course owners can update course images" ON storage.objects;
CREATE POLICY "Course capability update course images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id='course-images'
  AND EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id::text=split_part(name,'/',1)
      AND public.has_course_capability(c.id,'content')
  )
)
WITH CHECK (
  bucket_id='course-images'
  AND EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id::text=split_part(name,'/',1)
      AND public.has_course_capability(c.id,'content')
  )
);

DROP POLICY IF EXISTS "Course owners can delete course images" ON storage.objects;
CREATE POLICY "Course capability delete course images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id='course-images'
  AND EXISTS (
    SELECT 1 FROM public.courses c
    WHERE c.id::text=split_part(name,'/',1)
      AND public.has_course_capability(c.id,'content')
  )
);

-- Allow rollback of only the current student's newly uploaded, unattached files.
CREATE POLICY "Students clean up unsubmitted assignment files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id='assignment-submissions'
  AND split_part(name,'/',1)=auth.uid()::text
  AND NOT EXISTS (
    SELECT 1
    FROM public.assignment_submissions s
    WHERE s.student_id=auth.uid()
      AND s.attachments @> jsonb_build_array(jsonb_build_object('path',name))
  )
);

COMMIT;
