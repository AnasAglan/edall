-- Require AAL2 for administrators across every course-scoped privileged capability.
BEGIN;

CREATE OR REPLACE FUNCTION public.has_course_capability(_course_id uuid, _capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
    CASE
      WHEN public.has_role(auth.uid(),'admin'::public.app_role)
        THEN public.admin_mfa_verified()
      ELSE
        EXISTS (
          SELECT 1 FROM public.courses c
          WHERE c.id=_course_id AND c.created_by=auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.course_staff_roles r
          WHERE r.course_id=_course_id
            AND r.user_id=auth.uid()
            AND (
              r.role='instructor'
              OR (r.role='assistant' AND _capability IN ('assignments','attendance','live_classes'))
              OR (r.role='moderator' AND _capability='discussions')
              OR (r.role='analyst' AND _capability='analytics')
            )
        )
    END
  );
$function$;

REVOKE ALL ON FUNCTION public.has_course_capability(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_course_capability(uuid,text) TO authenticated,service_role;

COMMIT;
