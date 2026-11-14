import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ED-ALL production authorization hardening", () => {
  const migration = read("supabase/migrations/20261114120000_harden_platform_security.sql");

  it("allows direct self-enrollment only in free courses", () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Users can enroll themselves"/);
    expect(migration).toMatch(/CREATE POLICY "[^"]*free[^"]*enroll[^"]*"\\s+ON public\\.enrollments[\\s\\S]*?WITH CHECK[\\s\\S]*?user_id\\s*=\\s*auth\\.uid\\(\\)[\\s\\S]*?COALESCE\\(c\\.price, 0\\)\\s*<=\\s*0/i);
  });

  it("gates lesson text at RLS, not by browser visibility", () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Anyone can view lessons"/);
    expect(migration).toMatch(/CREATE POLICY "[^"]*entitled[^"]*lessons[^"]*"\\s+ON public\\.lessons[\\s\\S]*?USING\\s*\\(\\s*public\\.can_access_lesson\\(id\\)\\s*\\)/i);
  });

  it("makes the legacy grading RPC internal and protects the safe question RPC", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\\.grade_exam_submission\\(uuid, jsonb\\) FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\\.get_exam_questions_safe\\(_exam_id uuid\\)/i);
    expect(migration).toMatch(/get_exam_questions_safe[\\s\\S]*?auth\\.uid\\(\\) IS NULL[\\s\\S]*?can_access_lesson/i);
    expect(read("public/ed_master.html")).not.toContain("'grade_exam_submission'");
  });

  it("makes lesson PDFs private and only readable by entitled lesson users", () => {
    expect(migration).toMatch(/UPDATE storage\\.buckets[\\s\\S]*?SET public\\s*=\\s*false[\\s\\S]*?lesson-pdfs/i);
    expect(migration).toMatch(/schemaname = 'storage'[\\s\\S]*?tablename = 'objects'[\\s\\S]*?lesson-pdfs/);
    expect(migration).toMatch(/CREATE POLICY "[^"]*lesson PDFs entitled read access"[\\s\\S]*?storage\\.objects[\\s\\S]*?can_access_lesson/i);
    expect(read("public/ed_master.html")).toMatch(/createSignedUrl/);
  });

  it("prevents users from changing their own ban and protected identity fields", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\\.protect_profile_security_fields/);
    expect(migration).toMatch(/NEW\\.banned IS DISTINCT FROM OLD\\.banned/);
    expect(migration).toMatch(/CREATE TRIGGER[^;]*protect_profile_security_fields/i);
    expect(migration).toMatch(/WITH CHECK\\s*\\(\\s*id\\s*=\\s*auth\\.uid\\(\\)[\\s\\S]*?has_role\\(auth\\.uid\\(\\), 'admin'/i);
  });

  it("does not disclose teacher emails to anonymous or non-admin users", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\\.search_teachers_public[\\s\\S]*?CASE\\s+WHEN public\\.has_role\\(auth\\.uid\\(\\), 'admin'::public\\.app_role\\) THEN p\\.email\\s+ELSE NULL\\s+END/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\\.search_teachers_public\\(text\\) FROM PUBLIC/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\\.search_teachers_public\\(text\\) TO anon, authenticated/i);
  });

  it("restricts teacher notifications to their owned courses and admin broadcasts", () => {
    expect(migration).toMatch(/DROP POLICY IF EXISTS "Admins and teachers can create notifications"/);
    expect(migration).toMatch(/CREATE POLICY "[^"]*admin[^"]*notifications[^"]*"\\s+ON public\\.notifications[\\s\\S]*?WITH CHECK/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\\.notify_course_students/);
    expect(migration).toMatch(/notify_course_students[\\s\\S]*?c\\.created_by\\s*=\\s*auth\\.uid\\(\\)[\\s\\S]*?INSERT INTO public\\.notifications/i);
  });

  it("rechecks enrollment after taking the wallet lock before charging", () => {
    const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.purchase_course");
    const end = migration.indexOf("$function$;", start);
    const purchase = migration.slice(start, end < 0 ? undefined : end);
    expect(purchase.indexOf("FOR UPDATE")).toBeGreaterThan(-1);
    expect(purchase.indexOf("FOR UPDATE")).toBeLessThan(purchase.lastIndexOf("already_enrolled"));
    expect(purchase).toMatch(/_price\\s*<\\s*0/);
  });

  it("restricts the old three-argument account bootstrap overload", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\\.setup_new_user\\(uuid, text, text\\) FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\\.get_user_role\\(uuid\\) FROM PUBLIC, anon/i);
    expect(migration).toMatch(/get_user_role[\\s\\S]*?auth\\.uid\\(\\)[\\s\\S]*?Not authorized/i);
  });

  it("validates all admin-create-user writes and compensates partial failures", () => {
    const fn = read("supabase/functions/admin-create-user/index.ts");
    expect(fn).toMatch(/\\["student", "teacher", "admin"\\]\\.includes\\(role\\)/);
    expect(fn).toMatch(/setup_new_user[\\s\\S]*?if\\s*\\(setupError/);
    expect(fn).toMatch(/user_roles[\\s\\S]*?if\\s*\\(roleInsertError/);
    expect(fn).toMatch(/auth\\.admin\\.deleteUser/);
  });
});
