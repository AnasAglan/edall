import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ED-ALL integrated learning suite", () => {
  const migration = read("supabase/migrations/20261114121000_add_integrated_learning_suite.sql");

  const expectedTables = [
    "course_staff_roles",
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
    "platform_audit_log"
  ];

  it.each(expectedTables)("creates %s with row-level security", (table) => {
    expect(migration).toMatch(new RegExp("CREATE TABLE IF NOT EXISTS public\\." + table + "\\b", "i"));
    expect(migration).toMatch(new RegExp("ALTER TABLE public\\." + table + " ENABLE ROW LEVEL SECURITY", "i"));
  });

  it("uses authenticated identity and course-scoped capabilities for writes", () => {
    for (const rpc of [
      "assign_course_staff",
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
      "get_platform_analytics"
    ]) expect(migration).toContain("FUNCTION public." + rpc);
    expect(migration).toMatch(/submit_assignment[\s\S]*?auth\.uid\(\)/);
    expect(migration).toMatch(/grade_assignment_submission[\s\S]*?ed_can_manage_course/);
    expect(migration).toMatch(/mark_attendance[\s\S]*?ed_can_manage_course/);
  });

  it("enforces one submission and one attendance row per student", () => {
    expect(migration).toMatch(/UNIQUE\s*\(assignment_id, student_id\)/i);
    expect(migration).toMatch(/UNIQUE\s*\(session_id, student_id\)/i);
  });

  it("issues certificates only after course progress completion and exposes minimal verification data", () => {
    expect(migration).toMatch(/issue_course_certificate[\s\S]*?video_watched[\s\S]*?total_lessons/);
    expect(migration).toMatch(/verify_course_certificate[\s\S]*?certificate_number[\s\S]*?course_title/);
    expect(migration).not.toMatch(/verify_course_certificate[\s\S]*?student_email/);
  });

  it("keeps payment order amounts server-derived and webhook fulfillment privileged/idempotent", () => {
    expect(migration).toMatch(/idempotency_key\s+text\s+NOT NULL UNIQUE/i);
    expect(migration).toMatch(/provider_event_id\s+text\s+NOT NULL UNIQUE/i);
    expect(migration).toMatch(/fulfill_payment_order[\s\S]*?auth\.role\(\)\s*<>\s*'service_role'/i);
    expect(migration).toMatch(/fulfill_payment_order[\s\S]*?FOR UPDATE[\s\S]*?INSERT INTO public\.enrollments/);
  });

  it("keeps audit history append-only for application roles and gates readers on admin AAL2", () => {
    expect(migration).toMatch(/platform_audit_log[\s\S]*?ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]*?platform_audit_log FROM PUBLIC, anon, authenticated/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.write_platform_audit_event/);
    expect(migration).toMatch(/ed_admin_aal2/);
  });

  it("keeps live classes as scheduled external meetings until a provider is configured", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.live_classes[\s\S]*?meeting_url[\s\S]*?recording_url/);
    expect(migration).toMatch(/meeting_url IS NULL OR meeting_url ~ '\^https:\/\/'/);
  });

  it("does not introduce a student AI tutor, route, or tutor-specific data model", () => {
    expect(migration).not.toMatch(/student_tutor|STUDENT_TUTOR_TOOLS|AI tutor|مدرس ذكاء اصطناعي/i);
    expect(read("workers/edall-assistant/index.js")).not.toMatch(/student_tutor|STUDENT_TUTOR_TOOLS|canAccessStudentTutor/);
  });

  it("provides role-aware screens for student, teacher, and admin workflows", () => {
    const ui = read("public/ed_features.js");
    expect(ui).toContain("EDFeatures");
    for (const name of ["assignments", "attendance", "certificates", "liveClasses", "discussions", "payments", "analytics", "audit", "mfa"]) {
      expect(ui).toMatch(new RegExp(name, "i"));
    }
    expect(ui).toMatch(/window\.currentUser|currentUser/);
    expect(ui).toMatch(/window\.showPage|showPage/);
    expect(read("public/ed_master.html")).toContain("ed_features.js");
  });

  it("adds a PWA shell while excluding authenticated APIs and media from caches", () => {
    const sw = read("public/sw.js");
    expect(read("public/manifest.webmanifest")).toContain("start_url");
    expect(sw).toMatch(/storage\/v1|auth\/v1|rest\/v1|functions\/v1/);
    expect(sw).toMatch(/network-only|no-store|bypass/i);
    expect(sw).toMatch(/STATIC_CACHE|CACHE_NAME/);
  });
});
