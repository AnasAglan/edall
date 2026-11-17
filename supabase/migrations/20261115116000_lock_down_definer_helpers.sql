-- Lock down remaining SECURITY DEFINER helpers and close audit/role disclosure paths.
BEGIN;

-- has_role may be used by public RLS policies, so anon execution is retained;
-- anonymous callers always receive false and cannot enumerate another user's roles.
-- Authenticated users may check their own roles. Cross-user role checks require
-- the caller to be an administrator at AAL2.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid,_role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND _user_id IS NOT NULL
    AND (
      _user_id=auth.uid()
      OR (
        EXISTS (
          SELECT 1 FROM public.user_roles caller_role
          WHERE caller_role.user_id=auth.uid()
            AND caller_role.role='admin'::public.app_role
        )
        AND COALESCE(auth.jwt()->>'aal','')='aal2'
      )
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles target_role
      WHERE target_role.user_id=_user_id
        AND target_role.role=_role
    );
$function$;

REVOKE ALL ON FUNCTION public.has_role(uuid,public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO anon,authenticated,service_role;

-- Role lookup is private to the account holder or an MFA-verified administrator.
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _role text;
BEGIN
  IF auth.uid() IS NULL OR _user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF _user_id<>auth.uid() AND NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;

  SELECT ur.role::text INTO _role
  FROM public.user_roles ur
  WHERE ur.user_id=_user_id
  ORDER BY CASE ur.role
    WHEN 'admin'::public.app_role THEN 1
    WHEN 'teacher'::public.app_role THEN 2
    ELSE 3
  END
  LIMIT 1;
  RETURN _role;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_role(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated,service_role;

-- Public teacher discovery exposes display fields only. Email is available only
-- to a real AAL2 administrator and may only be searched by that administrator.
CREATE OR REPLACE FUNCTION public.search_teachers_public(_term text)
RETURNS TABLE(id uuid,name text,avatar_url text,email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT DISTINCT
    p.id,
    p.name,
    p.avatar_url,
    CASE WHEN public.admin_mfa_verified() THEN p.email ELSE NULL END AS email
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id=p.id
  WHERE ur.role IN ('teacher'::public.app_role,'admin'::public.app_role)
    AND (
      COALESCE(length(_term),0)=0
      OR p.name ILIKE '%'||left(_term,100)||'%'
      OR (
        public.admin_mfa_verified()
        AND p.email ILIKE '%'||left(_term,100)||'%'
      )
    )
  ORDER BY p.name
  LIMIT 20;
$function$;

REVOKE ALL ON FUNCTION public.search_teachers_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_teachers_public(text) TO anon,authenticated,service_role;

-- Exam grading data contains student identity and answers; scope it to staff with
-- the course's exam capability. This implies MFA for platform administrators.
CREATE OR REPLACE FUNCTION public.exam_grading_list(_exam_id uuid)
RETURNS TABLE(
  result_id uuid,
  user_id uuid,
  name text,
  public_id text,
  score integer,
  passed boolean,
  has_essay boolean,
  essay_graded boolean,
  answers jsonb,
  submitted_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE _course_id uuid;
BEGIN
  IF auth.uid() IS NULL OR _exam_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  SELECT l.course_id INTO _course_id
  FROM public.exams e
  JOIN public.lessons l ON l.id=e.lesson_id
  WHERE e.id=_exam_id;
  IF NOT FOUND OR NOT public.has_course_capability(_course_id,'exams') THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;

  RETURN QUERY
  SELECT r.id,r.user_id,p.name,p.public_id,r.score,r.passed,
         r.has_essay,r.essay_graded,r.answers,r.submitted_at
  FROM public.exam_results r
  LEFT JOIN public.profiles p ON p.id=r.user_id
  WHERE r.exam_id=_exam_id
  ORDER BY r.submitted_at ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.exam_grading_list(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.exam_grading_list(uuid) TO authenticated,service_role;

-- Event creation must be reachable only from trusted SECURITY DEFINER functions
-- and triggers; otherwise clients can forge immutable audit records.
REVOKE ALL ON FUNCTION public.write_platform_audit_event(text,text,uuid,uuid,jsonb)
FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.audit_sensitive_row_change()
FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user()
FROM PUBLIC,anon,authenticated;

COMMIT;
