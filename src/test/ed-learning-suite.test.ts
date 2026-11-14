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
    "platform_audit_log"
  ];

  it.each(expectedTables)("creates the %s data model with RLS", (table) => {
    expect(migration).toMatch(new RegExp("CREATE TABLE IF NOT EXISTS public\\." + table + "\\b", "i"));
    expect(migration).toMatch(new RegExp("ALTER TABLE public\\." + table + " ENABLE ROW LEVEL SECURITY", "i"));
  });

  it("uses server identity and teacher course ownership for write RPCs", () => {
    for (const rpc of [
      "submit_assignment",
      "grade_assignment_submission",
      "mark_attendance",
      "issue_course_certificate",
      "create_payment_order",
      "fulfill_payment_order",
      "create_discussion_post",
      "get_course_analytics"
    ]) expect(migration).toContain("FUNCTION public." + rpc);
    expect(migration).toMatch(/submit_assignment[\s\S]*?auth\.uid\(\)/);
    expect(migration).toMatch(/grade_assignment_submission[\s\S]*?created_by\s*=\s*auth\.uid\(\)/);
    expect(migration).toMatch(/mark_attendance[\s\S]*?created_by\s*=\s*auth\.uid\(\)/);
  });

  it("enforces one student submission per assignment and one attendance row per student/session", () => {
    expect(migration).toMatch(/UNIQUE\s*\(assignment_id, student_id\)/i);
    expect(migration).toMatch(/UNIQUE\s*\(session_id, student_id\)/i);
  });

  it("issues certificates only after completion and exposes only minimal verification data", () => {
    expect(migration).toMatch(/issue_course_certificate[\s\S]*?completed_lessons[\s\S]*?total_lessons/);
    expect(migration).toMatch(/verify_course_certificate[\s\S]*?certificate_number[\s\S]*?course_title/);
    expect(migration).not.toMatch(/verify_course_certificate[\s\S]*?student_email/);
  });

  it("uses idempotent payment orders and never trusts client-supplied paid state", () => {
    expect(migration).toMatch(/idempotency_key\s+text\s+NOT NULL UNIQUE/i);
    expect(migration).toMatch(/provider_event_id\s+text\s+UNIQUE/i);
    expect(migration).toMatch(/fulfill_payment_order[\s\S]*?status\s*=\s*'paid'[\s\S]*?FOR UPDATE/);
    expect(migration).toMatch(/fulfill_payment_order[\s\S]*?INSERT INTO public\.enrollments/);
  });

  it("keeps audit history append-only for app roles", () => {
    expect(migration).toMatch(/platform_audit_log[\s\S]*?ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/REVOKE (ALL|INSERT, UPDATE, DELETE)[\s\S]*?platform_audit_log/i);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.write_platform_audit_event/);
  });

  it("adds a separate student tutor route with an allowlisted read-only tool set", () => {
    const worker = read("workers/edall-assistant/index.js");
    expect(worker).toMatch(/student_tutor/);
    expect(worker).toMatch(/STUDENT_TUTOR_TOOLS/);
    expect(worker).toMatch(/STUDENT_TUTOR_TOOLS[\s\S]*?get_student_course_context/);
    expect(worker).toMatch(/canAccessStudentTutor[\s\S]*?student/);
    expect(worker).not.toMatch(/STUDENT_TUTOR_TOOLS[\s\S]*?create_course/);
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
    expect(ui).toMatch(/currentUser|window\.currentUser/);
    expect(ui).toMatch(/showPage|learningHub/);
    expect(read("public/ed_master.html")).toContain("ed_features.js");
  });

  it("adds a PWA shell while keeping authenticated APIs and private media out of caches", () => {
    const sw = read("public/sw.js");
    expect(read("public/manifest.webmanifest")).toContain("start_url");
    expect(sw).toMatch(/storage\/v1|auth\/v1|rest\/v1|functions\/v1/);
    expect(sw).toMatch(/network-only|no-store|bypass/i);
    expect(sw).toMatch(/STATIC_CACHE|CACHE_NAME/);
  });
});
