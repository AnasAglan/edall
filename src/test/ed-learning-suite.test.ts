import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ED-ALL integrated learning suite", () => {
  const migration = read("supabase/migrations/20261114121000_add_integrated_learning_suite.sql");

  const expectedTables = [
    "assignments",
    "assignment_submissions",
    "attendance_sessions",
    "attendance_records",
    "live_classes",
    "course_certificates",
    "discussion_topics",
    "discussion_posts",
    "payment_orders",
    "payment_webhook_events",
    "platform_audit_log",
    "course_staff_roles"
  ];

  it.each(expectedTables)("creates the %s data model with RLS", (table) => {
    expect(migration).toMatch(new RegExp("CREATE TABLE IF NOT EXISTS public\\." + table + "\\b", "i"));
    expect(migration).toMatch(new RegExp("ALTER TABLE public\\." + table + " ENABLE ROW LEVEL SECURITY", "i"));
  });

  it("uses server identity and teacher course ownership for write RPCs", () => {
    for (const rpc of [
      "create_assignment",
      "submit_assignment",
      "grade_assignment_submission",
      "create_attendance_session",
      "mark_attendance",
      "create_live_class",
      "issue_course_certificate",
      "create_payment_order",
      "fulfill_payment_order",
      "create_discussion_topic",
      "create_discussion_post",
      "get_course_analytics",
      "get_platform_analytics",
      "grant_course_staff_role"
    ]) expect(migration).toContain("FUNCTION public." + rpc);
    expect(migration).toMatch(/submit_assignment[\\s\\S]*?auth\\.uid\\(\\)/);
    expect(migration).toMatch(/grade_assignment_submission[\\s\\S]*?has_course_capability/);
    expect(migration).toMatch(/mark_attendance[\\s\\S]*?has_course_capability/);
  });

  it("enforces unique student submissions and attendance per session", () => {
    expect(migration).toMatch(/UNIQUE\\s*\\(assignment_id, student_id\\)/i);
    expect(migration).toMatch(/UNIQUE\\s*\\(session_id, student_id\\)/i);
  });

  it("issues certificates only after completion and exposes minimal verification data", () => {
    expect(migration).toMatch(/issue_course_certificate[\\s\\S]*?video_watched[\\s\\S]*?total_lessons/);
    expect(migration).toMatch(/verify_course_certificate[\\s\\S]*?certificate_number[\\s\\S]*?course_title/);
    expect(migration).not.toMatch(/verify_course_certificate[\\s\\S]*?student_email/);
  });

  it("keeps payment orders server-priced and fulfillment service-role only", () => {
    expect(migration).toMatch(/idempotency_key\\s+text\\s+NOT NULL UNIQUE/i);
    expect(migration).toMatch(/provider_event_id\\s+text\\s+UNIQUE/i);
    expect(migration).toMatch(/fulfill_payment_order[\\s\\S]*?auth\\.role\\(\\)\\s+<>\\s+'service_role'/i);
    expect(migration).toMatch(/fulfill_payment_order[\\s\\S]*?FOR UPDATE[\\s\\S]*?INSERT INTO public\\.enrollments/);
    expect(migration).toMatch(/PAYMENT_PROVIDER_NOT_CONFIGURED/);
  });

  it("keeps audit history append-only for application roles", () => {
    expect(migration).toMatch(/platform_audit_log[\\s\\S]*?ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/REVOKE ALL ON public\\.platform_audit_log FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\\.write_platform_audit_event/);
  });

  it("provides role-aware student, teacher, and admin screens", () => {
    const ui = read("public/ed_features.js");
    expect(ui).toContain("EDFeatures");
    for (const name of [
      "assignments",
      "attendance",
      "certificates",
      "liveClasses",
      "discussions",
      "payments",
      "analytics",
      "audit"
    ]) expect(ui).toMatch(new RegExp(name, "i"));
    expect(ui).toMatch(/currentUser|window\\.currentUser/);
    expect(ui).toMatch(/showPage|learningHubPage/);
    expect(read("public/ed_master.html")).toContain("ed_features.js");
  });

  it("adds a PWA shell while keeping authenticated APIs and private media out of caches", () => {
    const sw = read("public/sw.js");
    expect(read("public/manifest.webmanifest")).toContain("start_url");
    expect(sw).toMatch(/storage\\/v1|auth\\/v1|rest\\/v1|functions\\/v1/);
    expect(sw).toMatch(/network-only|no-store|bypass/i);
    expect(sw).toMatch(/STATIC_CACHE|CACHE_NAME/);
  });

  it("does not introduce a student AI tutor", () => {
    const worker = read("workers/edall-assistant/index.js");
    expect(worker).not.toMatch(/student_tutor|STUDENT_TUTOR_TOOLS|canAccessStudentTutor/);
    expect(migration).not.toMatch(/student_tutor|AI tutor|مدرس ذكاء اصطناعي/i);
  });
});
