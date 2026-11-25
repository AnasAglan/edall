-- Integration tests for the highest-risk role and audit helper boundaries.
-- Runs inside a transaction and rolls back all fixture accounts/data.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(84);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'authenticated','authenticated','edall-rls-student@example.test','',
    statement_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"ED-ALL RLS Student"}'::jsonb,statement_timestamp(),statement_timestamp()
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'authenticated','authenticated','edall-rls-teacher@example.test','',
    statement_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"ED-ALL RLS Teacher"}'::jsonb,statement_timestamp(),statement_timestamp()
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'authenticated','authenticated','edall-rls-admin@example.test','',
    statement_timestamp(),'{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"ED-ALL RLS Admin"}'::jsonb,statement_timestamp(),statement_timestamp()
  );

-- Give the deterministic fixtures the exact roles this test needs.
DELETE FROM public.user_roles
WHERE user_id IN (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003'
);
INSERT INTO public.user_roles(user_id,role) VALUES
  ('10000000-0000-4000-8000-000000000001','student'),
  ('10000000-0000-4000-8000-000000000002','teacher'),
  ('10000000-0000-4000-8000-000000000003','admin');

-- Authenticated student: own role is visible, another account's role is not.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
SELECT is(
  public.has_role('10000000-0000-4000-8000-000000000001','student'::public.app_role),
  true,
  'a user can check their own role'
);
SELECT is(
  public.has_role('10000000-0000-4000-8000-000000000002','teacher'::public.app_role),
  false,
  'a student cannot enumerate another account role'
);
SELECT throws_ok(
  $$SELECT public.get_user_role('10000000-0000-4000-8000-000000000002')$$,
  'P0001','ADMIN_MFA_REQUIRED',
  'a student cannot read another account role'
);
SELECT throws_ok(
  $$SELECT public.write_platform_audit_event('forged','profiles',NULL::uuid,NULL::uuid,'{}'::jsonb)$$,
  '42501',NULL,
  'an authenticated client cannot forge an audit event'
);

-- Administrator without AAL2 still cannot inspect other users or their email.
SET LOCAL request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
SET LOCAL request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}';
SELECT is(
  public.has_role('10000000-0000-4000-8000-000000000002','teacher'::public.app_role),
  false,
  'an administrator at AAL1 cannot enumerate another role'
);
SELECT throws_ok(
  $$SELECT public.get_user_role('10000000-0000-4000-8000-000000000002')$$,
  'P0001','ADMIN_MFA_REQUIRED',
  'an administrator at AAL1 cannot read another account role'
);
SELECT is(
  (SELECT t.email IS NULL FROM public.search_teachers_public('') t
   WHERE t.id='10000000-0000-4000-8000-000000000002'),
  true,
  'teacher email is hidden before MFA verification'
);

-- AAL2 administrator may access cross-user administrative data.
SET LOCAL request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}';
SELECT is(
  public.has_role('10000000-0000-4000-8000-000000000002','teacher'::public.app_role),
  true,
  'an administrator at AAL2 can check staff roles'
);
SELECT is(
  public.get_user_role('10000000-0000-4000-8000-000000000002'),
  'teacher',
  'an administrator at AAL2 can read the requested role'
);
SELECT is(
  (SELECT t.email IS NOT NULL FROM public.search_teachers_public('') t
   WHERE t.id='10000000-0000-4000-8000-000000000002'),
  true,
  'teacher email is available only after MFA verification'
);

-- Anonymous callers cannot inspect roles or teacher email.
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SELECT is(
  public.has_role('10000000-0000-4000-8000-000000000003','admin'::public.app_role),
  false,
  'anonymous role lookup always returns false'
);
SELECT is(
  (SELECT t.email IS NULL FROM public.search_teachers_public('') t
   WHERE t.id='10000000-0000-4000-8000-000000000002'),
  true,
  'anonymous teacher search never exposes email'
);

-- Privileged SECURITY DEFINER RPCs must not inherit PostgreSQL's default
-- PUBLIC execute grant. The certificate verifier is intentionally public.
SELECT ok(
  NOT has_function_privilege('anon','public.grant_course_staff_role(uuid,uuid,text)','EXECUTE'),
  'anonymous callers cannot grant course staff roles'
);
SELECT ok(
  NOT has_function_privilege('anon','public.submit_assignment(uuid,text,jsonb)','EXECUTE'),
  'anonymous callers cannot submit assignments'
);
SELECT ok(
  NOT has_function_privilege('anon','public.mark_attendance(uuid,uuid,text,text)','EXECUTE'),
  'anonymous callers cannot alter attendance'
);
SELECT ok(
  NOT has_function_privilege('anon','public.moderate_discussion_post(uuid,boolean)','EXECUTE'),
  'anonymous callers cannot moderate discussions'
);
SELECT ok(
  NOT has_function_privilege('anon','public.create_payment_order(uuid,text)','EXECUTE'),
  'anonymous callers cannot create payment orders'
);
SELECT ok(
  NOT has_function_privilege('authenticated','public.fulfill_payment_order(uuid,text,text,numeric,text,text)','EXECUTE'),
  'authenticated clients cannot fulfill payment orders'
);
SELECT ok(
  has_function_privilege('service_role','public.fulfill_payment_order(uuid,text,text,numeric,text,text)','EXECUTE'),
  'trusted service role can fulfill verified payment webhooks'
);
SELECT ok(
  has_function_privilege('anon','public.verify_course_certificate(text)','EXECUTE'),
  'public certificate verification remains available to visitors'
);
SELECT ok(
  has_function_privilege('authenticated','public.create_assignment(uuid,uuid,text,text,timestamptz,numeric)','EXECUTE'),
  'authenticated course staff can call the assignment creation RPC'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.protect_profile_security_fields()'::regprocedure
      AND 'search_path=""' = ANY(p.proconfig)
  ),
  'profile security trigger function has an empty search path'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.purchase_course(uuid)'::regprocedure
      AND 'search_path=""' = ANY(p.proconfig)
  ),
  'wallet purchase SECURITY DEFINER function has an empty search path'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.setup_new_user(uuid,text,text,text)'::regprocedure
      AND 'search_path=""' = ANY(p.proconfig)
  ),
  'new-user bootstrap SECURITY DEFINER function has an empty search path'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.handle_new_user()'::regprocedure
      AND 'search_path=""' = ANY(p.proconfig)
  ),
  'auth signup trigger SECURITY DEFINER function has an empty search path'
);

-- Course staff may only update the fields used by the legacy essay-grading UI.
SELECT ok(
  has_column_privilege('authenticated','public.exam_results','score','UPDATE'),
  'authenticated course staff can update exam scores'
);
SELECT ok(
  has_column_privilege('authenticated','public.exam_results','passed','UPDATE'),
  'authenticated course staff can update pass state'
);
SELECT ok(
  has_column_privilege('authenticated','public.exam_results','essay_graded','UPDATE'),
  'authenticated course staff can mark essay grading complete'
);
SELECT ok(
  has_column_privilege('authenticated','public.exam_results','answers','UPDATE'),
  'authenticated course staff can save graded answers'
);
SELECT ok(
  NOT has_column_privilege('authenticated','public.exam_results','user_id','UPDATE'),
  'authenticated course staff cannot change result ownership'
);
SELECT ok(
  NOT has_column_privilege('authenticated','public.exam_results','exam_id','UPDATE'),
  'authenticated course staff cannot move a result to another exam'
);
SELECT ok(
  NOT has_column_privilege('authenticated','public.exam_results','submitted_at','UPDATE'),
  'authenticated course staff cannot rewrite submission timestamps'
);
SELECT ok(
  NOT has_column_privilege('authenticated','public.exam_results','id','UPDATE'),
  'authenticated course staff cannot rewrite result identifiers'
);
SELECT ok(
  NOT has_column_privilege('anon','public.exam_results','score','UPDATE'),
  'anonymous clients cannot update exam results'
);

SELECT ok(
  NOT has_table_privilege('authenticated','public.exam_results','INSERT'),
  'authenticated clients cannot insert exam results directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated','public.exam_results','DELETE'),
  'authenticated clients cannot delete exam results'
);
SELECT ok(
  NOT has_table_privilege('authenticated','public.exam_results','TRUNCATE'),
  'authenticated clients cannot truncate exam results'
);
SELECT ok(
  NOT has_table_privilege('authenticated','public.exam_results','TRIGGER'),
  'authenticated clients cannot attach triggers to exam results'
);
SELECT ok(
  NOT has_table_privilege('anon','public.exam_results','INSERT'),
  'anonymous clients cannot insert exam results directly'
);
SELECT ok(
  NOT has_table_privilege('anon','public.exam_results','DELETE'),
  'anonymous clients cannot delete exam results'
);
SELECT ok(
  NOT has_table_privilege('anon','public.exam_results','TRUNCATE'),
  'anonymous clients cannot truncate exam results'
);
SELECT ok(
  NOT has_table_privilege('anon','public.exam_results','TRIGGER'),
  'anonymous clients cannot attach triggers to exam results'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage'
      AND tablename='objects'
      AND policyname='Course staff update staged lesson PDFs'
      AND cmd='UPDATE'
      AND position('temp_' in COALESCE(qual,'')) > 0
      AND position('temp_' in COALESCE(with_check,'')) > 0
      AND position('has_course_capability' in COALESCE(qual,'')) > 0
      AND position('has_course_capability' in COALESCE(with_check,'')) > 0
  ),
  'staged lesson PDF retries stay limited to course content managers'
);

WITH function_definition AS (
  SELECT upper(
    pg_get_functiondef('public.setup_new_user(uuid,text,text,text)'::regprocedure)
  ) AS source
),
positions AS (
  SELECT
    position('SELECT COUNT(*) INTO _USER_COUNT' IN source) AS initial_count,
    position('PG_ADVISORY_XACT_LOCK' IN source) AS lock_position,
    position(
      'SELECT COUNT(*) INTO _USER_COUNT'
      IN substring(source FROM position('PG_ADVISORY_XACT_LOCK' IN source) + 1)
    ) AS recount_after_lock,
    position('EDALL-INITIAL-ADMIN-BOOTSTRAP' IN source) AS shared_lock_key
  FROM function_definition
)
SELECT ok(
  initial_count > 0
  AND lock_position > initial_count
  AND recount_after_lock > 0
  AND shared_lock_key > 0,
  'first-admin bootstrap recounts after a shared lock only when roles are empty'
)
FROM positions;

SELECT ok(
  to_regprocedure('public.admin_list_users(text,integer,integer)') IS NOT NULL,
  'administrator user directory RPC exists'
);
SELECT ok(
  NOT has_function_privilege('anon','public.admin_list_users(text,integer,integer)','EXECUTE'),
  'anonymous callers cannot list authenticated user accounts'
);
SELECT ok(
  has_function_privilege('authenticated','public.admin_list_users(text,integer,integer)','EXECUTE'),
  'authenticated callers can invoke the RPC subject to its internal administrator and AAL2 gate'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.admin_list_users(text,integer,integer)'::regprocedure
      AND p.prosecdef
      AND 'search_path=""' = ANY(p.proconfig)
  ),
  'administrator directory RPC is SECURITY DEFINER with an empty search path'
);

SELECT ok(
  to_regprocedure('public.set_discussion_post_pinned(uuid,boolean)') IS NOT NULL,
  'course discussion pin RPC exists'
);
SELECT ok(
  NOT has_function_privilege('anon','public.set_discussion_post_pinned(uuid,boolean)','EXECUTE'),
  'anonymous callers cannot pin discussion answers'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.set_discussion_post_pinned(uuid,boolean)'::regprocedure
      AND p.prosecdef
      AND 'search_path=""' = ANY(p.proconfig)
  ),
  'discussion pin RPC is SECURITY DEFINER with an empty search path'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid='public.attendance_sessions'::regclass
      AND attname='lesson_id'
      AND NOT attisdropped
  ),
  'attendance sessions can be linked to a lesson'
);
SELECT ok(
  to_regclass('public.attendance_alert_settings') IS NOT NULL
  AND to_regclass('public.attendance_alert_events') IS NOT NULL,
  'attendance threshold settings and alert deduplication tables exist'
);
SELECT ok(
  to_regprocedure('public.get_attendance_report(uuid,timestamptz,timestamptz)') IS NOT NULL,
  'scoped attendance report RPC exists'
);
SELECT ok(
  NOT has_function_privilege('anon','public.get_attendance_report(uuid,timestamptz,timestamptz)','EXECUTE'),
  'anonymous callers cannot read attendance reports'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.get_attendance_report(uuid,timestamptz,timestamptz)'::regprocedure
      AND p.prosecdef
      AND 'search_path=""' = ANY(p.proconfig)
  ),
  'attendance report RPC is SECURITY DEFINER with an empty search path'
);
SELECT ok(
  NOT has_function_privilege('anon','public.set_course_absence_threshold(uuid,numeric)','EXECUTE'),
  'anonymous callers cannot change attendance alert thresholds'
);
SELECT ok(
  has_function_privilege('authenticated','public.create_attendance_session(uuid,text,timestamptz,uuid)','EXECUTE'),
  'authenticated callers can create attendance sessions subject to the internal course permission gate'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='lessons' AND column_name='is_final'
  ),
  'lessons include a final lesson designation'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='lessons_one_final_per_course_idx'
  ),
  'a course can have at most one final lesson'
);
SELECT ok(
  to_regprocedure('public.set_course_final_lesson(uuid,uuid)') IS NOT NULL,
  'course final lesson management RPC exists'
);
SELECT ok(
  NOT has_function_privilege('anon','public.set_course_final_lesson(uuid,uuid)','EXECUTE'),
  'anonymous callers cannot designate a course final lesson'
);
SELECT ok(
  NOT has_function_privilege('authenticated','public.issue_course_certificate_internal(uuid,uuid,uuid,boolean)','EXECUTE'),
  'authenticated clients cannot invoke the internal certificate issuer'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='auto_issue_course_certificate_lesson_progress'
      AND NOT tgisinternal
  )
  AND EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='auto_issue_course_certificate_exam_results'
      AND NOT tgisinternal
  ),
  'lesson progress and exam result changes trigger automatic certificate checks'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.audit_course_final_lesson_change()'::regprocedure
      AND p.prosecdef
      AND 'search_path=""' = ANY(p.proconfig)
  ),
  'final lesson changes are audited by a protected trigger function'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='lessons' AND column_name='is_final'
  ),
  'lessons include a final lesson designation'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='lessons_one_final_per_course_idx'
  ),
  'a course can have at most one final lesson'
);
SELECT ok(
  to_regprocedure('public.set_course_final_lesson(uuid,uuid)') IS NOT NULL,
  'course final lesson management RPC exists'
);
SELECT ok(
  NOT has_function_privilege('anon','public.set_course_final_lesson(uuid,uuid)','EXECUTE'),
  'anonymous callers cannot designate a course final lesson'
);
SELECT ok(
  NOT has_function_privilege('authenticated','public.issue_course_certificate_internal(uuid,uuid,uuid,boolean)','EXECUTE'),
  'authenticated clients cannot invoke the internal certificate issuer'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='auto_issue_course_certificate_lesson_progress'
      AND tgrelid='public.lesson_progress'::regclass
      AND NOT tgisinternal
  )
  AND EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='auto_issue_course_certificate_exam_results'
      AND tgrelid='public.exam_results'::regclass
      AND NOT tgisinternal
  ),
  'lesson progress and exam result changes trigger automatic certificate checks'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.audit_course_final_lesson_change()'::regprocedure
      AND p.prosecdef
      AND 'search_path=""' = ANY(p.proconfig)
  ),
  'final lesson changes are audited by a protected trigger function'
);

SELECT ok(
  to_regprocedure('public.get_my_learning_history()') IS NOT NULL,
  'student learning history RPC exists'
);
SELECT ok(
  NOT has_function_privilege('anon','public.get_my_learning_history()','EXECUTE'),
  'anonymous callers cannot read student learning history'
);
SELECT ok(
  has_function_privilege('authenticated','public.get_my_learning_history()','EXECUTE'),
  'authenticated students can call their own history RPC'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.get_my_learning_history()'::regprocedure
      AND p.prosecdef
      AND 'search_path=""' = ANY(p.proconfig)
  ),
  'student learning history RPC is SECURITY DEFINER with an empty search path'
);
SELECT ok(
  to_regprocedure('public.wallet_user_ledger(uuid,integer,integer)') IS NOT NULL,
  'administrator wallet ledger RPC exists'
);
SELECT ok(
  NOT has_function_privilege('anon','public.wallet_user_ledger(uuid,integer,integer)','EXECUTE'),
  'anonymous callers cannot access administrator wallet transaction history'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.wallet_user_ledger(uuid,integer,integer)'::regprocedure
      AND p.prosecdef
      AND 'search_path=""' = ANY(p.proconfig)
      AND position('admin_mfa_verified' in p.prosrc) > 0
  ),
  'wallet ledger RPC is a SECURITY DEFINER function with an internal AAL2 check'
);

SELECT ok(
  to_regprocedure('public.get_teacher_analytics()') IS NOT NULL,
  'teacher-wide learning analytics RPC exists'
);
SELECT ok(
  NOT has_function_privilege('anon','public.get_teacher_analytics()','EXECUTE'),
  'anonymous callers cannot invoke teacher analytics'
);
SELECT ok(
  has_function_privilege('authenticated','public.get_teacher_analytics()','EXECUTE'),
  'authenticated callers can invoke scoped teacher analytics subject to the internal capability check'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.get_teacher_analytics()'::regprocedure
      AND p.prosecdef
      AND 'search_path=""' = ANY(p.proconfig)
      AND position('has_course_capability' in p.prosrc) > 0
  ),
  'teacher analytics RPC is SECURITY DEFINER and enforces course-scoped analytics capabilities'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.get_teacher_analytics()'::regprocedure
      AND position('admin_mfa_verified' in p.prosrc) > 0
  ),
  'administrator access through teacher analytics requires AAL2'
);

SELECT * FROM finish();
ROLLBACK;
