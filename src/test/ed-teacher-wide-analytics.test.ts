import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(),path),"utf8");

describe("teacher-wide Learning Space analytics", () => {
  const ui = read("public/ed_features.js");
  const migration = read("supabase/migrations/20261122170000_teacher_wide_learning_analytics.sql");

  it("loads all assigned course analytics through a scoped server RPC without requiring one selected course", () => {
    const loaderStart = ui.indexOf("async function loadTabData()");
    const loaderEnd = ui.indexOf("function courseSelector()",loaderStart);
    const loader = ui.slice(loaderStart,loaderEnd);
    expect(loader).toContain('state.tab === "analytics" && !isAdmin()');
    expect(loader).toContain('rpc("get_teacher_analytics"');
    expect(loader.indexOf('rpc("get_teacher_analytics"')).toBeLessThan(loader.indexOf("if (!state.courseId) return;"));
  });

  it("keeps administrator analytics global and separate", () => {
    expect(ui).toContain('rpc("get_platform_analytics", {})');
    expect(migration).toContain("public.has_role(_actor,'admin'::public.app_role)");
    expect(migration).toContain("public.admin_mfa_verified()");
  });

  it("keeps administrators on the separate global analytics RPC", () => {
    expect(ui).toContain('rpc("get_platform_analytics", {})');
    expect(migration).toContain("ADMIN_USE_PLATFORM_ANALYTICS");
    expect(migration).toContain("IF _is_admin THEN");
    expect(migration).not.toContain("_is_admin\n      OR public.has_course_capability");
    expect(migration).toContain("'scope','assigned_courses'");
  });

  it("aggregates only courses where the caller has analytics capability", () => {
    expect(migration).toContain("public.has_course_capability(course.id,'analytics')");
    expect(migration).toContain("public.get_course_analytics(_course.id)");
    expect(migration).toContain("'totals',_totals");
    expect(migration).toContain("'courses',_course_rows");
  });

  it("shows both teacher-wide totals and per-course breakdowns with meaningful learning metrics", () => {
    expect(ui).toContain("ملخص جميع دوراتك");
    expect(ui).toContain("التحليلات حسب الدورة");
    for (const key of ["enrolled","assignments","submissions","graded_submissions","attendance_sessions","present","late","absent","excused","valid_certificates","exams","exam_results"]) {
      expect(ui).toContain('["' + key + '"');
    }
    expect(ui).toContain("Download Excel (XLSX)");
    expect(ui).toContain("طباعة / حفظ PDF");
  });

  it("does not expose the aggregate RPC to anonymous callers", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.get_teacher_analytics() FROM PUBLIC,anon");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_teacher_analytics() TO authenticated");
  });
});
