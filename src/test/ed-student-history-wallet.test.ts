import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("student exam, assignment, and certificate history", () => {
  const html = read("public/ed_master.html");
  const migration = read("supabase/migrations/20261122160000_student_history_wallet_ledger.sql");

  it("adds dedicated student history and certificate pages to the account menu", () => {
    expect(html).toContain('id="myLearningRecordsBtn"');
    expect(html).toContain('id="myCertificatesBtn"');
    expect(html).toContain('id="myLearningRecordsPage"');
    expect(html).toContain('id="myCertificatesPage"');
    expect(html).toContain("renderMyLearningRecordsPage");
    expect(html).toContain("renderMyCertificatesPage");
  });

  it("returns only the signed-in student's enrolled courses, exams, assignments and certificates", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_my_learning_history()");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("public.enrollments");
    expect(migration).toContain("public.exam_results");
    expect(migration).toContain("public.exam_attempts");
    expect(migration).toContain("public.assignment_submissions");
    expect(migration).toContain("public.course_certificates");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.get_my_learning_history() FROM PUBLIC,anon");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_my_learning_history() TO authenticated");
  });

  it("snapshots the true question count and prevents client-supplied count tampering", () => {
    expect(migration).toContain("TG_OP = 'INSERT'");
    expect(migration).toContain("NEW.question_count IS DISTINCT FROM OLD.question_count");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF exam_id,question_count");
    expect(migration).toContain("FROM public.exam_questions AS question");
  });

  it("includes real attempt start and submit times, question counts, grading and essay-pending states", () => {
    expect(migration).toContain("attempt.started_at");
    expect(migration).toContain("attempt.submitted_at");
    expect(migration).toContain("FROM public.exam_questions AS question");
    expect(migration).toContain("result.score");
    expect(migration).toContain("result.has_essay");
    expect(migration).toContain("result.essay_graded");
    expect(html).toContain("وقت البدء: ");
    expect(html).toContain("عدد الأسئلة: ");
    expect(html).toContain("بانتظار تصحيح المقال");
  });

  it("does not expose answer keys or student-private data through the history RPC", () => {
    expect(migration).not.toContain("exam_questions.correct_option");
    expect(migration).not.toContain("result.answers");
    expect(migration).not.toContain("auth.users.encrypted_password");
  });

  it("shows certificate share links and functional PNG/PDF actions for the certificate owner", () => {
    expect(html).toContain("downloadMyCertificatePng");
    expect(html).toContain("printMyCertificatePdf");
    expect(html).toContain("verification_token");
    expect(html).toContain("certificate_number");
  });
});

describe("administrator wallet user transaction history", () => {
  const html = read("public/ed_master.html");
  const migration = read("supabase/migrations/20261122160000_student_history_wallet_ledger.sql");

  it("adds a transaction history action to every selected admin user", () => {
    expect(html).toContain("openWalletUserTransactions");
    expect(html).toContain("سجل العمليات");
    expect(html).toContain("admin-user-transactions");
  });

  it("uses a read-only server RPC protected by administrator role and AAL2", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.wallet_user_ledger");
    expect(migration).toContain("public.has_role(_admin_id,'admin'::public.app_role)");
    expect(migration).toContain("public.admin_mfa_verified()");
    expect(migration).toContain("FROM public.wallet_transactions");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.wallet_user_ledger(uuid,integer,integer) FROM PUBLIC,anon");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.wallet_user_ledger(uuid,integer,integer) TO authenticated");
    expect(migration).not.toContain("INSERT INTO public.wallet_transactions");
  });
});
