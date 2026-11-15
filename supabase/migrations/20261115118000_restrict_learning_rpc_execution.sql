-- Explicit execution grants for the SECURITY DEFINER learning RPC surface.
-- Internal authorization checks remain mandatory; ACLs provide a second boundary.
BEGIN;

REVOKE ALL ON FUNCTION public.grant_course_staff_role(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_course_staff_role(uuid,uuid,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.revoke_course_staff_role(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_course_staff_role(uuid,uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_assignment(uuid,uuid,text,text,timestamptz,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_assignment(uuid,uuid,text,text,timestamptz,numeric) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_assignment(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_assignment(uuid,text,jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.grade_assignment_submission(uuid,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_assignment_submission(uuid,numeric,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_course_students(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_course_students(uuid,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_assignment_submissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_assignment_submissions(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_attendance_session(uuid,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_attendance_session(uuid,text,timestamptz) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_attendance(uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_attendance(uuid,uuid,text,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_live_class(uuid,text,text,timestamptz,timestamptz,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_live_class(uuid,text,text,timestamptz,timestamptz,text,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_live_class_status(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_live_class_status(uuid,text,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.issue_course_certificate(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_course_certificate(uuid,uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.revoke_course_certificate(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_course_certificate(uuid,text) TO authenticated, service_role;

-- Public certificate verification is intentionally read-only and reveals only
-- the fields needed to verify a certificate.
REVOKE ALL ON FUNCTION public.verify_course_certificate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_course_certificate(text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_discussion_topic(uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_discussion_topic(uuid,uuid,text,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_discussion_post(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_discussion_post(uuid,text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.moderate_discussion_post(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_discussion_post(uuid,boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.moderate_discussion_topic(uuid,boolean,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_discussion_topic(uuid,boolean,boolean,boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_course_discussion_feed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_discussion_feed(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_payment_order(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_payment_order(uuid,text) TO authenticated, service_role;

-- Only trusted server-side webhook processing may turn a pending order into
-- enrollment. The function still validates the service-role claim and payload.
REVOKE ALL ON FUNCTION public.fulfill_payment_order(uuid,text,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_order(uuid,text,text,numeric,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.get_course_analytics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_course_analytics(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_platform_analytics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_analytics() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_mfa_verified() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mfa_verified() TO authenticated, service_role;

COMMIT;
