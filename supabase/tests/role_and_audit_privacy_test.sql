-- Integration tests for the highest-risk role and audit helper boundaries.
-- Runs inside a transaction and rolls back all fixture accounts/data.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

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

SELECT * FROM finish();
ROLLBACK;
