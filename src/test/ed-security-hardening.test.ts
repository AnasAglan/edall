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
  });
});
