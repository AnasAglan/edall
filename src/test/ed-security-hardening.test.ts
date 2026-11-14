import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ED-ALL production authorization hardening", () => {
  const migration = read("supabase/migrations/20261114120000_harden_platform_security.sql");

  it("allows direct self-enrollment only in zero-priced courses", () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Users can enroll themselves"/);
    expect(migration).toMatch(/CREATE POLICY "Free courses allow self enrollment"[\s\S]*?ON public\.enrollments[\s\S]*?WITH CHECK[\s\S]*?user_id\s*=\s*auth\.uid\(\)[\s\S]*?COALESCE\(c\.price,\s*0\)\s*<=\s*0/i);
  });

  it("gates lesson text at RLS and retains course-owner/admin access through the entitlement helper", () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Anyone can view lessons"/);
    expect(migration).toMatch(/CREATE POLICY "Entitled users can view lessons"[\s\S]*?ON public\.lessons[\s\S]*?USING\s*\(public\.can_access_lesson\(id\)\)/i);
  });

  it("removes client access to legacy grading and returns no exam answer key", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.grade_exam_submission\(uuid, jsonb\) FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.get_exam_questions_safe\(_exam_id uuid\)/i);
    expect(migration).toMatch(/get_exam_questions_safe[\s\S]*?auth\.uid\(\) IS NULL[\s\S]*?can_access_lesson/i);
    expect(migration).not.toMatch(/RETURNS TABLE\([\s\S]*?correct_option/i);
    expect(read("public/ed_master.html")).not.toContain("'grade_exam_submission'");
  });

  it("makes lesson PDFs private, scoped, and upload-limited", () => {
    expect(migration).toMatch(/UPDATE storage\.buckets[\s\S]*?SET public\s*=\s*false[\s\S]*?lesson-pdfs/i);
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Anyone can view lesson pdfs"/i);
    expect(migration).toMatch(/CREATE POLICY "Lesson PDFs entitled read access"[\s\S]*?storage\.objects[\s\S]*?can_access_lesson/i);
    expect(migration).toMatch(/file_size_limit\s*=\s*26214400/i);
    expect(migration).toMatch(/allowed_mime_types\s*=\s*ARRAY\['application\/pdf'\]/i);
    expect(read("public/ed_master.html")).toMatch(/createSignedUrl/);
  });

  it("prevents users from changing their own ban and protected identity fields", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.protect_profile_security_fields/);
    expect(migration).toMatch(/NEW\.banned IS DISTINCT FROM OLD\.banned/);
    expect(migration).toMatch(/CREATE TRIGGER[^;]*protect_profile_security_fields/i);
    expect(migration).toMatch(/WITH CHECK\s*\(\s*id\s*=\s*auth\.uid\(\)[\s\S]*?has_role\(auth\.uid\(\), 'admin'/i);
  });

  it("does not disclose teacher email to anonymous or non-admin callers", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.search_teachers_public[\s\S]*?CASE[\s\S]*?WHEN public\.has_role\(auth\.uid\(\), 'admin'::public\.app_role\) THEN p\.email[\s\S]*?ELSE NULL[\s\S]*?END/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.search_teachers_public\(text\) FROM PUBLIC/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.search_teachers_public\(text\) TO anon, authenticated/i);
  });

  it("restricts teacher notifications to enrolled students in their own courses", () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Admins and teachers can create notifications"/);
    expect(migration).toMatch(/CREATE POLICY "Admins notifications and teacher notifications are scoped"[\s\S]*?WITH CHECK[\s\S]*?c\.created_by\s*=\s*auth\.uid\(\)/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.notify_course_students/);
  });

  it("rechecks enrollment after acquiring the wallet lock before debiting", () => {
    const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.purchase_course");
    const end = migration.indexOf("$function$;", start);
    const purchase = migration.slice(start, end < 0 ? undefined : end);
    expect(purchase.indexOf("FOR UPDATE")).toBeGreaterThan(-1);
    expect(purchase.indexOf("FOR UPDATE")).toBeLessThan(purchase.lastIndexOf("already_enrolled"));
    expect(purchase).toMatch(/_price\s*<\s*0/);
  });

  it("revokes the legacy bootstrap overload and scopes role lookup to self/admin", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.setup_new_user\(uuid, text, text\) FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.get_user_role\(uuid\) FROM PUBLIC, anon/i);
    expect(migration).toMatch(/get_user_role[\s\S]*?auth\.uid\(\)[\s\S]*?Not authorized/i);
  });

  it("validates admin-created accounts and compensates partial failures", () => {
    const fn = read("supabase/functions/admin-create-user/index.ts");
    expect(fn).toMatch(/\["student", "teacher", "admin"\]\.includes\(role\)/);
    expect(fn).toMatch(/setup_new_user[\s\S]*?if\s*\(setupError/);
    expect(fn).toMatch(/user_roles[\s\S]*?if\s*\(roleInsertError/);
    expect(fn).toMatch(/auth\.admin\.deleteUser/);
  });
});
