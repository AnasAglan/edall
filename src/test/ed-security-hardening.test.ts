import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ED-ALL production authorization hardening", () => {
  const migration = read("supabase/migrations/20261114120000_harden_platform_security.sql");

  it("allows direct self-enrollment only in free courses", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "Users can enroll themselves"');
    expect(migration).toContain('CREATE POLICY "Free courses allow self enrollment"');
    expect(migration).toContain("ON public.enrollments");
    expect(migration).toContain("COALESCE(c.price, 0) = 0");
    expect(migration).toContain("user_id = auth.uid()");
  });

  it("gates lesson content with the lesson entitlement function", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "Anyone can view lessons"');
    expect(migration).toContain('CREATE POLICY "Entitled users can view lessons"');
    expect(migration).toContain("USING (public.can_access_lesson(id))");
  });

  it("closes the unsafe legacy grading RPC and protects the safe question RPC", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.grade_exam_submission(uuid, jsonb) FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_exam_questions_safe(_exam_id uuid)");
    expect(migration).toContain("auth.uid() IS NULL");
    expect(migration).toContain("public.can_access_lesson(_lesson_id)");
    expect(read("public/ed_master.html")).not.toContain("grade_exam_submission");
  });

  it("makes PDFs private, limits uploads, and requires signed links", () => {
    expect(migration).toContain("UPDATE storage.buckets");
    expect(migration).toContain("public = false");
    expect(migration).toContain("file_size_limit = 26214400");
    expect(migration).toContain("ARRAY['application/pdf']");
    expect(migration).toContain('CREATE POLICY "Lesson PDFs entitled read access"');
    expect(migration).toContain("public.can_access_lesson(l.id)");
    expect(migration).toContain("lf.file_url=storage.objects.name");
    expect(migration).toContain("temp_[0-9]{10,}");
    expect(read("public/ed_master.html")).toContain("createSignedUrl");
  });

  it("prevents users from changing their own ban and security identity fields", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.protect_profile_security_fields()");
    expect(migration).toContain("NEW.banned IS DISTINCT FROM OLD.banned");
    expect(migration).toContain("CREATE TRIGGER protect_profile_security_fields");
    expect(migration).toContain("WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))");
  });

  it("redacts teacher emails unless the caller is an admin", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.search_teachers_public(_term text)");
    expect(migration).toContain("WHEN public.has_role(auth.uid(), 'admin'::public.app_role) THEN p.email");
    expect(migration).toContain("ELSE NULL");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.search_teachers_public(text) FROM PUBLIC");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.search_teachers_public(text) TO anon, authenticated");
  });

  it("scopes teacher notifications and provides a course-student notification RPC", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "Admins and teachers can create notifications"');
    expect(migration).toContain('CREATE POLICY "Admins notifications and teacher notifications are scoped"');
    expect(migration).toContain("c.created_by = auth.uid()");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.notify_course_students");
  });

  it("rechecks enrollment after the wallet lock before charging", () => {
    const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.purchase_course");
    const end = migration.indexOf("$function$;", start);
    const purchase = migration.slice(start, end < 0 ? undefined : end);
    expect(purchase).toContain("FOR UPDATE");
    expect(purchase).toContain("already_enrolled");
    expect(purchase.indexOf("FOR UPDATE")).toBeLessThan(purchase.lastIndexOf("already_enrolled"));
    expect(purchase).toContain("_price < 0");
  });

  it("revokes legacy bootstrap and restricts role lookups", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.setup_new_user(uuid, text, text) FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon");
    expect(migration).toMatch(/IF auth\.uid\(\) IS NULL OR \([\s\S]*?auth\.uid\(\) <> _user_id/);
    expect(migration).toContain("RAISE EXCEPTION 'Not authorized'");
  });

  it("restricts both legacy account bootstrap overloads to trusted callers", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.setup_new_user(uuid, text, text) FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.setup_new_user(uuid, text, text, text) FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.setup_new_user(uuid, text, text, text) TO service_role");
  });

  it("does not reveal a profile or course progress for a non-enrolled user", () => {
    const reporting = read("supabase/migrations/20261115106000_admin_mfa_student_reporting.sql");
    expect(reporting).toContain("IF _enrolled_at IS NULL THEN");
    expect(reporting).toContain("RAISE EXCEPTION 'STUDENT_NOT_ENROLLED'");
  });

  it("validates account creation and rolls back partial failures", () => {
    const fn = read("supabase/functions/admin-create-user/index.ts");
    expect(fn).toContain('["student", "teacher", "admin"].includes(role)');
    expect(fn).toContain('rpc("setup_new_user"');
    expect(fn).toContain("if (setupError");
    expect(fn).toContain("if (roleInsertError");
    expect(fn).toContain("auth.admin.deleteUser");
    expect(fn).toContain("https://edall.lovable.app");
  });

  it("does not expose the media proxy to arbitrary browser origins", () => {
    const proxy = read("workers/video-media-proxy/index.js");
    expect(proxy).not.toContain('"Access-Control-Allow-Origin": "*"');
    expect(proxy).toContain("if (origin && !ALLOWED_ORIGINS.has(origin))");
    expect(proxy).toContain('responseCorsHeaders.set("Access-Control-Allow-Origin", origin)');
  });

  it("makes the administrative audit log append-only even for service-role mutations", () => {
    const migration = read("supabase/migrations/20261115101000_make_audit_log_immutable.sql");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.prevent_platform_audit_log_mutation()");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON public.platform_audit_log");
    expect(migration).toContain("RAISE EXCEPTION 'AUDIT_LOG_APPEND_ONLY'");
    expect(migration).toContain("REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.platform_audit_log");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS platform_audit_log_actor_user_id_fkey");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS platform_audit_log_course_id_fkey");
  });

  it("keeps the lesson PDF uploader within the private bucket's 25 MiB limit", () => {
    const html = read("public/ed_master.html");
    expect(html).toContain("const maxPdfSizeBytes = 25 * 1024 * 1024");
    expect(html).toContain("exceeds the 25MB limit");
    expect(html).not.toContain("maxPdfSizeBytes = 100 * 1024 * 1024");
  });

  it("correlates Paymob webhooks using the HMAC-signed provider order ID", () => {
    const webhook = read("supabase/functions/paymob-webhook/index.ts");
    expect(webhook).toContain('String(obj.order?.id ?? "")');
    expect(webhook).toContain('.filter("metadata->>paymob_order_id","eq",paymobOrderId)');
    expect(webhook).toContain("obj.order?.id");
    expect(webhook).not.toContain("nested(obj,[\"order\",\"merchant_order_id\"])");
    expect(webhook).not.toContain("obj.special_reference");
  });

  it("prevents duplicate payable orders and serializes checkout creation", () => {
    const migration = read("supabase/migrations/20261115102000_payment_order_idempotency.sql");
    expect(migration).toContain("payment_orders_one_open_per_user_course_idx");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("status IN ('created','pending')");
    expect(migration).toContain("FOR UPDATE");
  });

  it("claims one Paymob intention at a time and reuses an existing checkout", () => {
    const edge = read("supabase/functions/create-payment-intention/index.ts");
    expect(edge).toContain("CHECKOUT_ALREADY_BEING_PREPARED");
    expect(edge).toContain('.eq("status","created")');
    expect(edge).toContain('.eq("status","pending")');
    expect(edge).toContain(".is(\"checkout_url\",null)");
    expect(edge).toContain("5*60*1000");
    expect(edge).toContain("reused:true");
  });

  it("requires verified AAL2 for administrator course capabilities", () => {
    const migration = read("supabase/migrations/20261115103000_enforce_admin_mfa_course_scope.sql");
    expect(migration).toContain("WHEN public.has_role(auth.uid(),'admin'::public.app_role)");
    expect(migration).toContain("THEN public.admin_mfa_verified()");
    expect(migration).toContain("ELSE");
    expect(migration).toContain("public.course_staff_roles");
  });

  it("requires administrator AAL2 before exposing teacher emails or other users' roles", () => {
    const migration = read("supabase/migrations/20261115104000_admin_mfa_sensitive_rpcs.sql");
    expect(migration).toContain("AND public.admin_mfa_verified() THEN p.email");
    expect(migration).toContain("AND public.admin_mfa_verified()");
    expect(migration).toContain("auth.uid() <> _user_id");
    expect(migration).toContain("OR NOT public.admin_mfa_verified()");
  });

  it("requires administrator MFA for direct profile, role and notification access", () => {
    const migration = read("supabase/migrations/20261115105000_admin_mfa_rls.sql");
    expect(migration).toContain("public.admin_mfa_verified()");
    expect(migration).toContain("ON public.profiles FOR SELECT");
    expect(migration).toContain("ON public.profiles FOR UPDATE");
    expect(migration).toContain("ON public.user_roles FOR SELECT");
    expect(migration).toContain("ON public.notifications FOR INSERT");
    expect(migration).toContain("ON public.notifications FOR UPDATE");
    expect(migration).toContain("ADMIN_MFA_REQUIRED");
  });

  it("requires administrator MFA before returning student roster PII or progress", () => {
    const migration = read("supabase/migrations/20261115106000_admin_mfa_student_reporting.sql");
    expect(migration).toContain("public.course_enrollees");
    expect(migration).toContain("public.course_student_progress");
    expect(migration.match(/ADMIN_MFA_REQUIRED/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("SET search_path = ''");
  });

  it("enforces an atomic per-account quota for the staff-only assistant", () => {
    const rateLimit = read("supabase/migrations/20261115110000_assistant_rate_limiting.sql");
    const worker = read("workers/edall-assistant/index.js");
    expect(rateLimit).toContain("ALTER TABLE public.edall_assistant_rate_limits ENABLE ROW LEVEL SECURITY");
    expect(rateLimit).toContain("FORCE ROW LEVEL SECURITY");
    expect(rateLimit).toContain("pg_advisory_xact_lock");
    expect(rateLimit).toContain("RETURN _request_count <= 20");
    expect(rateLimit).toContain("TO authenticated");
    expect(worker).toContain("/rest/v1/rpc/consume_edall_assistant_request");
    expect(worker).toContain("}, 429, origin)");
    expect(worker).toContain("}, 503, origin)");
  });

  it("prevents client-side exam-completion flags without a passing graded result", () => {
    const migration = read("supabase/migrations/20261114121000_add_integrated_learning_suite.sql");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF exam_completed ON public.lesson_progress");
    expect(migration).toContain("er.user_id=NEW.user_id");
    expect(migration).toContain("RAISE EXCEPTION 'EXAM_NOT_PASSED'");
  });

  it("requires AAL2 for privileged course, exam, storage, wallet and settings operations", () => {
    const mfa = read("supabase/migrations/20261115113000_enforce_course_and_admin_mfa.sql");
    expect(mfa).toContain("public.has_course_capability(id,'content')");
    expect(mfa).toContain("public.has_course_capability(c.id,'content')");
    expect(mfa).toContain("public.has_course_capability(l.course_id,'exams')");
    expect(mfa).toContain("public.admin_mfa_verified()");
    expect(mfa).toContain("REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.wallets");
    expect(mfa).toContain("REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.wallet_transactions");
    expect(mfa).toContain("MFA admins manage site settings update");
    expect(mfa).toContain("Course capability upload lesson PDFs");
    expect(mfa).toContain("l.id::text=split_part(name,'/',2)");
    expect(mfa).toContain("metadata->>'mimetype'='application/pdf'");
    expect(mfa).toContain("Students clean up unsubmitted assignment files");
  });

  it("requires administrator AAL2 and audited RPC for all user role mutations", () => {
    const roleMigration = read("supabase/migrations/20261115112000_secure_user_role_management.sql");
    const worker = read("workers/edall-assistant/index.js");
    expect(roleMigration).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE");
    expect(roleMigration).toContain("public.admin_mfa_verified()");
    expect(roleMigration).toContain("CANNOT_REVOKE_LAST_ADMIN");
    expect(roleMigration).toContain("edall-last-admin-role-guard");
    expect(roleMigration).toContain("audit_user_role_changes trigger writes the immutable audit event once.");
    expect(roleMigration).not.toContain("PERFORM public.write_platform_audit_event(");
    expect(roleMigration).toContain("GRANT EXECUTE ON FUNCTION public.manage_user_role");
    expect(worker).toContain("/rest/v1/rpc/manage_user_role");
    expect(worker).not.toContain('"/rest/v1/user_roles", token, "POST"');
    expect(worker).not.toContain('"/rest/v1/user_roles?id=eq."');
  });

  it("does not expose unpublished assignments to enrolled students", () => {
    const learning = read("supabase/migrations/20261114121000_add_integrated_learning_suite.sql");
    const policyStart = learning.indexOf('CREATE POLICY "Enrolled students and course staff read assignments"');
    const policyEnd = learning.indexOf(");", policyStart);
    const policy = learning.slice(policyStart, policyEnd + 2);
    expect(policy).toContain("is_published = true");
    expect(policy).toContain("public.has_course_capability(course_id,'assignments')");
    expect(policy).toContain("e.user_id=auth.uid()");
  });

  it("returns complete platform statistics through one MFA-gated database snapshot", () => {
    const learning = read("supabase/migrations/20261114121000_add_integrated_learning_suite.sql");
    const worker = read("workers/edall-assistant/index.js");
    for (const field of ["lesson_video_links", "lesson_pdf_links", "enrollments", "exams", "exam_attempts"]) {
      expect(learning).toContain("'" + field + "'");
      expect(worker).toContain('"' + field + '"');
    }
    expect(learning).toContain("OR NOT public.admin_mfa_verified()");
    expect(learning).toContain("SELECT count(*) INTO _exam_attempts FROM public.exam_results");
    expect(learning).not.toContain("public.exam_attempts");
    expect(worker).toContain('/rest/v1/rpc/get_platform_analytics');
    expect(worker).toContain("Number.isSafeInteger(value)");
  });

  it("blocks account deletion when financial, certificate or academic history would cascade", () => {
    const edge = read("supabase/functions/admin-delete-user/index.ts");
    expect(edge).toContain('from("payment_orders")');
    expect(edge).toContain('from("course_certificates")');
    expect(edge).toContain('from("assignment_submissions")');
    expect(edge).toContain('from("exam_results")');
    expect(edge).toContain('from("attendance_records")');
    expect(edge).toContain("سجلات تعليمية");
  });
});
