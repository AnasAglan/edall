import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ED-ALL integrated learning suite", () => {
  const migration = read("supabase/migrations/20261114121000_add_integrated_learning_suite.sql");

  const tables = [
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

  it.each(tables)("creates %s with row-level security", (table) => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public." + table);
    expect(migration).toContain("ALTER TABLE public." + table + " ENABLE ROW LEVEL SECURITY");
  });

  it("uses server-verified course capabilities for privileged actions", () => {
    for (const rpc of [
      "grant_course_staff_role",
      "revoke_course_staff_role",
      "create_assignment",
      "submit_assignment",
      "grade_assignment_submission",
      "create_attendance_session",
      "mark_attendance",
      "create_live_class",
      "update_live_class_status",
      "issue_course_certificate",
      "revoke_course_certificate",
      "create_discussion_topic",
      "create_discussion_post",
      "moderate_discussion_post",
      "moderate_discussion_topic",
      "create_payment_order",
      "fulfill_payment_order",
      "get_course_analytics",
      "get_platform_analytics"
    ]) expect(migration).toContain("FUNCTION public." + rpc);
    expect(migration).toContain("public.has_course_capability(_course_id");
    expect(migration).toContain("auth.uid() IS NULL");
    expect(migration).toContain("ENROLLMENT_REQUIRED");
  });

  it("enforces one submission per student and one attendance record per session", () => {
    expect(migration).toContain("UNIQUE (assignment_id, student_id)");
    expect(migration).toContain("UNIQUE(session_id,student_id)");
  });

  it("verifies certificates with a hard-to-guess token and exposes no email", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.verify_course_certificate(_token text)");
    expect(migration).toContain("verification_token text NOT NULL UNIQUE");
    expect(migration).toContain("extensions.digest(");
    expect(migration).toContain("certificate_number text");
    expect(migration).toContain("course_title text");
    expect(migration).not.toContain("student_email");
    expect(migration).toContain("_completed<>_total");
    expect(migration).toContain("public.lesson_files f WHERE f.lesson_id=l.id");
    expect(migration).toContain("COALESCE(lp.pdf_opened,false)");
    expect(migration).toContain("_student_id <> auth.uid()");
  });

  it("keeps provider orders disabled until configured and makes fulfillment service-role only", () => {
    expect(migration).toContain("enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("PAYMENT_PROVIDER_NOT_CONFIGURED");
    expect(migration).toContain("idempotency_key text NOT NULL UNIQUE");
    expect(migration).toContain("UNIQUE(provider,provider_event_id)");
    expect(migration).toContain("ON CONFLICT (provider,provider_event_id) DO NOTHING");
    expect(migration).toContain("auth.role() <> 'service_role'");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("PAYMENT_AMOUNT_OR_PROVIDER_MISMATCH");
    expect(migration).toContain("INSERT INTO public.enrollments");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.fulfill_payment_order");
    expect(migration).toContain("TO service_role");
  });

  it("keeps audit history read-only to app roles and requires admin AAL2 to read it", () => {
    expect(migration).toContain("ALTER TABLE public.platform_audit_log ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.platform_audit_log FROM PUBLIC,anon,authenticated");
    expect(migration).toContain("GRANT SELECT ON public.platform_audit_log TO authenticated");
    expect(migration).toContain("public.admin_mfa_verified()");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.write_platform_audit_event");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.audit_sensitive_row_change");
  });

  it("keeps live classes as external meeting links, not a pretend video-conference service", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.live_classes");
    expect(migration).toContain("meeting_url text NOT NULL");
    expect(migration).toContain("recording_url text");
    expect(migration).toContain("no video conferencing service is hosted here");
  });

  it("does not add a student AI tutor, AI student chat, or a tutor-only Worker route", () => {
    expect(migration).not.toMatch(/student_tutor|STUDENT_TUTOR_TOOLS|AI tutor|مدرس ذكاء اصطناعي/i);
    const worker = read("workers/edall-assistant/index.js");
    expect(worker).not.toMatch(/student_tutor|STUDENT_TUTOR_TOOLS|canAccessStudentTutor/);
  });

  it("provides role-aware student, teacher, and admin workflows", () => {
    const ui = read("public/ed_features.js");
    expect(ui).toContain("EDFeatures");
    for (const name of [
      "assignments",
      "attendance",
      "certificates",
      "liveClasses",
      "discussions",
      "analytics",
      "audit"
    ]) expect(ui).toContain(name);
    expect(ui).toContain("window.currentUser");
    expect(ui).toContain("window.showPage");
    expect(read("public/ed_master.html")).toContain("/ed_features.js");
  });

  it("keeps Paymob entirely out of the current user interface", () => {
    const ui = read("public/ed_features.js");
    expect(ui).not.toContain('["payments",');
    expect(ui).not.toContain('data-form="create-payment"');
    expect(ui).not.toContain('case "create-payment"');
    expect(ui).not.toContain("function renderPaymentsTab");
    expect(migration).toContain("enabled boolean NOT NULL DEFAULT false");
  });

  it("requires a passed and fully graded result for exam completion and certificates", () => {
    const migration = read("supabase/migrations/20261114121000_add_integrated_learning_suite.sql");
    expect(migration).toContain("validate_lesson_progress_exam_completion");
    expect(migration).toContain("RAISE EXCEPTION 'EXAM_NOT_PASSED'");
    expect(migration).toContain("er.user_id=_student_id");
    expect(migration).toContain("er.passed=true");
    expect(migration).toContain("(NOT er.has_essay OR er.essay_graded)");
  });

  it("adds a safe static PWA shell without caching authenticated APIs or media", () => {
    expect(read("public/manifest.webmanifest")).toContain('"start_url"');
    const sw = read("public/sw.js");
    expect(sw).toContain("/storage/v1/");
    expect(sw).toContain("/auth/v1/");
    expect(sw).toContain("/rest/v1/");
    expect(sw).toContain("/functions/v1/");
    expect(sw).toContain("CACHE_NAME");
    expect(sw).toContain("network-only");
  });

  it("shows course-scoped staff tabs only for granted capabilities", () => {
    const ui = read("public/ed_features.js");
    expect(ui).toContain('if (role === "assistant") return ["assignments","attendance","live_classes"].includes(capability)');
    expect(ui).toContain('if (role === "moderator") return capability === "discussions"');
    expect(ui).toContain('if (role === "analyst") return capability === "analytics"');
    expect(ui).toContain('state.courseStaffRoles = staffRows');
    expect(ui).toContain('const isTeacher = () => isAdmin() || isCourseOwner() || !!currentStaffRole()');
  });
});


describe("automatic course certificate issuance from final lesson completion", () => {
  const ui = read("public/ed_features.js");
  const migration = read("supabase/migrations/20261122150000_automatic_course_certificates.sql");

  it("allows only one designated final lesson per course and validates course ownership", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS is_final boolean NOT NULL DEFAULT false");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS lessons_one_final_per_course_idx");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.set_course_final_lesson");
    expect(migration).toContain("LESSON_NOT_IN_COURSE");
  });

  it("requires a designated final lesson and preserves all existing completion requirements before issuance", () => {
    expect(migration).toContain("COURSE_FINAL_LESSON_NOT_SET");
    expect(migration).toContain("result.passed = true");
    expect(migration).toContain("(NOT result.has_essay OR result.essay_graded)");
    expect(migration).toContain("public.lesson_videos AS video");
    expect(migration).toContain("public.lesson_files AS file");
  });

  it("attempts issuance after lesson progress and exam essay grading changes without blocking incomplete courses", () => {
    expect(migration).toContain("auto_issue_course_certificate_from_lesson_progress");
    expect(migration).toContain("auto_issue_course_certificate_from_exam_result");
    expect(migration).toContain("AFTER INSERT OR UPDATE OF video_watched,pdf_opened,exam_completed");
    expect(migration).toContain("AFTER INSERT OR UPDATE OF passed,has_essay,essay_graded");
    expect(migration).toContain("COURSE_NOT_COMPLETED");
  });

  it("uses a private idempotent issuance helper and keeps the public RPC permission-gated", () => {
    expect(migration).toContain("issue_course_certificate_internal");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.issue_course_certificate_internal(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated");
    expect(migration).toContain("public.has_course_capability(_course_id,'certificates')");
    expect(migration).toContain("public.admin_mfa_verified()");
  });

  it("allows course staff to designate the final lesson through the existing certificates tab", () => {
    expect(ui).toContain('data-form="set-final-lesson"');
    expect(ui).toContain('name="lesson_id"');
    expect(ui).toContain('rpc("set_course_final_lesson"');
    expect(ui).toContain("is_final");
    expect(ui).toContain("function certificateSvg");
    expect(ui).toContain("function downloadCertificateImage");
    expect(ui).toContain("function printCertificatePdf");
    expect(ui).toContain('data-action="certificate-image"');
    expect(ui).toContain('data-action="certificate-pdf"');
    expect(migration).toContain("audit_course_final_lesson_change");
    expect(migration).toContain("COALESCE(_automatic,true)");
  });
});


describe("attendance reporting, lesson links, and configurable absence alerts", () => {
  const ui = read("public/ed_features.js");
  const migration = read("supabase/migrations/20261122140000_attendance_reports_alerts.sql");

  it("supports optional lesson-linked attendance sessions", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS lesson_id uuid");
    expect(migration).toContain("LESSON_NOT_IN_COURSE");
    expect(ui).toContain('data-form="create-attendance"');
    expect(ui).toContain('_lesson_id:v.lesson_id || null');
  });

  it("reports present, late, absent and excused separately with explicit absence denominators", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_attendance_report");
    expect(migration).toContain("'present'");
    expect(migration).toContain("'late'");
    expect(migration).toContain("'absent'");
    expect(migration).toContain("'excused'");
    expect(migration).toContain("'absence_denominator'");
    expect(migration).toContain("'absence_rate_percent'");
    expect(ui).toContain("attendanceReport");
    expect(ui).toContain("غياب");
  });

  it("keeps absence alerts disabled until a course owner or authorized staff sets a threshold", () => {
    expect(migration).toContain("threshold_percent numeric(5,2)");
    expect(migration).toContain("set_course_absence_threshold");
    expect(migration).toContain("DELETE FROM public.attendance_alert_settings");
    expect(migration).toContain("IF _threshold IS NOT NULL THEN");
    expect(ui).toContain('data-form="set-attendance-threshold"');
    expect(ui).toContain('rpc("set_course_absence_threshold"');
  });

  it("deduplicates threshold alerts and writes in-app notifications only once per student/course/threshold", () => {
    expect(migration).toContain("attendance_alert_events");
    expect(migration).toContain("UNIQUE(course_id,student_id,threshold_percent)");
    expect(migration).toContain("ON CONFLICT (course_id,student_id,threshold_percent) DO NOTHING");
    expect(migration).toContain("INSERT INTO public.notifications(user_id,title,message,type)");
  });



  it("shows attendance controls only to course staff who have the attendance capability", () => {
    expect(ui).toContain('const canManageAttendance = hasCourseCapability("attendance")');
    expect(ui).toContain('state.data.attendanceReport = canManageAttendance');
    expect(ui).toContain('(canManageAttendance ? q.in("session_id",ids)');
  });

  it("protects attendance reports and threshold writes by course capability and administrator AAL2", () => {
    expect(migration).toContain("public.has_course_capability(_course_id,'attendance')");
    expect(migration).toContain("public.admin_mfa_verified()");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.get_attendance_report(uuid,timestamptz,timestamptz) FROM PUBLIC,anon");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.set_course_absence_threshold(uuid,numeric) FROM PUBLIC,anon");
  });
});


describe("lesson-scoped assignments and discussions", () => {
  const ui = read("public/ed_features.js");
  const migration = read("supabase/migrations/20261114121000_add_integrated_learning_suite.sql");

  it("loads the selected course's lessons before rendering assignment and discussion creation", () => {
    expect(ui).toContain('state.data.lessons = await rows("lessons"');
    expect(ui).toContain('q.eq("course_id",courseId)');
    expect(ui).toContain('.order("sort_order",{ascending:true})');
  });

  it("offers an optional lesson selector in assignment and discussion forms", () => {
    expect(ui).toContain('name="lesson_id"');
    expect(ui).toContain('data-form="create-assignment"');
    expect(ui).toContain('data-form="create-topic"');
    expect(ui).toContain('كل الدورة');
    expect(ui).toContain('Entire course');
  });

  it("passes the selected lesson id to both server RPCs and preserves course-level creation when blank", () => {
    expect(ui).toContain('_lesson_id:v.lesson_id || null');
    expect(ui).not.toContain('_lesson_id:null');
    expect(ui).toContain('rpc("create_assignment"');
    expect(ui).toContain('rpc("create_discussion_topic"');
  });

  it("shows the lesson label on each assignment and discussion topic", () => {
    expect(ui).toContain('function lessonLabel(');
    expect(ui).toContain('lessonLabel(a.lesson_id)');
    expect(ui).toContain('lessonLabel(t.lesson_id)');
  });

  it("validates lesson/course ownership in the trusted database functions", () => {
    expect(migration).toContain("LESSON_NOT_IN_COURSE");
    const assignmentStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.create_assignment");
    const assignmentEnd = migration.indexOf("$function$;", assignmentStart);
    const assignment = migration.slice(assignmentStart, assignmentEnd);
    expect(assignment).toContain("l.id = _lesson_id AND l.course_id = _course_id");
    const discussionStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.create_discussion_topic");
    const discussionEnd = migration.indexOf("$function$;", discussionStart);
    const discussion = migration.slice(discussionStart, discussionEnd);
    expect(discussion).toContain("l.id=_lesson_id AND l.course_id=_course_id");
  });
});


describe("pinned answers in course discussions", () => {
  const ui = read("public/ed_features.js");
  const pinMigration = read("supabase/migrations/20261122130000_pin_discussion_answers.sql");

  it("adds a pinned flag to posts without changing existing topic pinning", () => {
    expect(pinMigration).toContain("ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false");
    expect(pinMigration).toContain("CREATE INDEX IF NOT EXISTS discussion_posts_pinned_idx");
    expect(ui).toContain("t.is_pinned");
  });

  it("exposes pinned state in the authorized discussion feed and sorts pinned answers first", () => {
    expect(pinMigration).toContain("'is_pinned',post.is_pinned");
    expect(pinMigration).toContain("ORDER BY post.is_pinned DESC,post.created_at");
  });

  it("allows only discussion-capable course staff to pin or unpin an answer through an audited RPC", () => {
    expect(pinMigration).toContain("CREATE OR REPLACE FUNCTION public.set_discussion_post_pinned");
    expect(pinMigration).toContain("public.has_course_capability(_course_id,'discussions')");
    expect(pinMigration).toContain("public.admin_mfa_verified()");
    expect(pinMigration).toContain("public.write_platform_audit_event");
    expect(pinMigration).toContain("REVOKE ALL ON FUNCTION public.set_discussion_post_pinned(uuid,boolean) FROM PUBLIC,anon");
  });

  it("shows pin controls only to discussion moderators and renders the pinned answer label", () => {
    expect(ui).toContain('data-action="pin-discussion-post"');
    expect(ui).toContain('hasCourseCapability("discussions")');
    expect(ui).toContain("الإجابة المهمة المثبّتة");
    expect(ui).toContain('rpc("set_discussion_post_pinned"');
  });
});
