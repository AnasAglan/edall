# ED-ALL Security Hardening and Learning Suite Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Harden ED-ALL's server-side authorization and add integrated student, teacher, and administrator learning workflows.

**Architecture:** Keep the existing legacy HTML/JavaScript platform and add a modular feature client backed by additive Supabase migrations. All entitlements, role checks, payment fulfillment, grading, and certificate issuance are enforced by PostgreSQL RPCs/RLS or verified server functions.

**Tech Stack:** Supabase PostgreSQL/RLS/Storage, existing Supabase JS v2 client, vanilla JavaScript loaded by `public/ed_master.html`, existing Vitest + Node Worker tests.

**Spec:** `docs/superpowers/specs/2026-11-14-edall-security-and-learning-suite-design.md`

## Global Constraints

- Never change Electron/Windows or Android sources, yt-dlp, or NewPipe.
- Do not use Lovable agent credits; use GitHub commits and existing CI. Do not write secrets to the repository.
- Treat the Supabase database as production; migrations must be additive, idempotent, and reviewed before deployment.
- Preserve current ED-ALL theme, Arabic/English support, and existing login/session.
- Keep PWA offline caching limited to public shell/static assets; never cache private or authenticated data.
- Payment/live-meeting external providers remain disabled until real credentials/configuration are securely supplied.

## Review Focus

- Anonymous and authenticated non-enrolled users must not read paid lesson text/files/questions.
- Students must not enroll in paid courses by inserting rows, and concurrent purchase attempts must not double-charge.
- Student attempts must be server-created and submitted once; no client-callable path may reveal answer keys.
- A user must not unban themselves or alter another person's roles/profile.
- Teacher operations must be limited to courses they own and students enrolled in those courses.
- Retry, duplicate webhook, stale session, expired signed URL, malformed upload, and empty state behavior must be safe.

---

### Task 1: Security regression tests (RED)

**Files:**
- Create: `src/test/ed-security-hardening.test.ts`
- Create: `src/test/ed-learning-suite.test.ts`
- Modify: `.github/workflows/ed-piped-player-checks.yml` to run the new tests on PRs.

- [ ] Write static regression tests for payment-only enrollments, entitled lesson reads, internal-only grading, safe question RPC, protected profile fields, teacher-scoped notifications, private PDF policies, and safe public teacher search.
- [ ] Write feature-contract tests for all new tables, RLS enablement, append-only audit, payment state transitions/idempotency, and PWA private-cache exclusions.
- [ ] Run CI on the draft PR and confirm expected failures before implementation.

### Task 2: Database security migration

**Files:**
- Create: `supabase/migrations/20261114120000_harden_platform_security.sql`
- Modify: `public/ed_master.html` for secure PDF URL generation and legacy grading fallback removal.
- Modify: `supabase/functions/admin-create-user/index.ts` for strict input validation and checking every RPC/role write.
- Test: `src/test/ed-security-hardening.test.ts`

**Interfaces:**
- Preserve `public.can_access_lesson(uuid)` as the entitlement source.
- Preserve `public.start_exam_attempt(uuid)` and `public.submit_exam_attempt(uuid,jsonb)` as the student exam interface.
- Revoke direct client execution of `public.grade_exam_submission(uuid,jsonb)`; it remains callable only by the database owner through the finalization function.
- Ensure `public.get_exam_questions_safe(uuid)` requires authenticated lesson access and returns no answer key.

- [ ] Replace enrollment INSERT policy with self-enrollment only when course price is zero; paid enrollment only through purchase RPC.
- [ ] Restrict lesson SELECT using `can_access_lesson(id)` and preserve owner/admin access.
- [ ] Make `lesson-pdfs` private; rewrite stored public URLs to object paths and add SELECT policy scoped to `courseId/lessonId`.
- [ ] Add signed URL creation when displaying PDF links; never reuse a public URL.
- [ ] Revoke public/anon execution of grading RPC and old 3-argument account bootstrap overload; restrict question RPC.
- [ ] Protect `banned`, public IDs, and role-related fields from self-updates with trigger + RLS WITH CHECK.
- [ ] Replace global profile/role reads with self/admin visibility. Redact teacher email in public search.
- [ ] Restrict teacher notifications to owned-course enrollments and make broadcasts admin-only.
- [ ] Recheck existing enrollment after wallet row lock in `purchase_course`; reject negative prices and preserve idempotency.
- [ ] Make account creation validate role, bootstrap, profile, wallet, and Auth user; compensate by deleting the new Auth account on partial failure.
- [ ] Remove any client fallback that can call internal grading directly.
- [ ] Run targeted tests, full Vitest, SQL syntax checks in CI, and inspect exact migration diff.

### Task 3: Core learning schema and RPCs

**Files:**
- Create: `supabase/migrations/20261114121000_add_integrated_learning_suite.sql`
- Test: `src/test/ed-learning-suite.test.ts`

**Interfaces:**
- Student identity always comes from `auth.uid()`; never accept a target student ID for student writes.
- Teacher scope always resolves through `courses.created_by = auth.uid()`.
- Reuse existing `courses`, `lessons`, `enrollments`, `lesson_progress`, `exam_results`, and `site_settings`.

- [ ] Add assignments and submissions with due-date validation, one active submission per student, teacher-only grading, and attachment path constraints.
- [ ] Add attendance sessions and records with unique student/session pairs and teacher ownership.
- [ ] Add live-class schedule metadata, meeting URL validation, teacher scope, and enrolled-student read access.
- [ ] Add verifiable completion certificates with unique number/token, course owner/admin issuance, and a public verification RPC returning minimal fields.
- [ ] Add course/lesson discussions with author checks, enrollment visibility, owner/admin moderation, and soft-delete/moderation states.
- [ ] Add payment orders with server-owned amount/currency, idempotency keys, provider event IDs, strict state transitions, and one transactional paid-order fulfillment function.
- [ ] Add analytics RPCs with role-scoped aggregate outputs and no public student PII.
- [ ] Add append-only audit events for role, ban, course, payment, grading, and certificate actions.
- [ ] Test RLS, grants, ownership, idempotency, malformed input, and duplicate submissions.

### Task 4: Feature hub UI

**Files:**
- Create: `public/ed_features.js`
- Create: `public/ed_features.css`
- Modify: `public/ed_master.html`
- Test: `src/test/ed-learning-suite.test.ts`

- [ ] Add a role-aware “Learning Hub” navigation entry without changing existing navigation behavior.
- [ ] Implement student views: assignments and submissions, attendance, upcoming live classes, certificates, discussions, and progress.
- [ ] Implement teacher views: create/review assignments, mark attendance, schedule live classes, moderate discussions, view scoped analytics.
- [ ] Implement admin views: payment order review, global analytics, audit history, and system-level filters.
- [ ] Ensure every operation uses RPCs/policies, checks returned errors, and confirms success only after server verification.
- [ ] Add loading, empty, retry, and mobile states; use existing color variables and RTL/LTR language behavior.

### Task 5: PWA and safe offline shell

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/sw.js`
- Create: `public/ed-pwa.js`
- Modify: `public/ed_master.html`
- Test: `src/test/ed-learning-suite.test.ts`

- [ ] Add install metadata and service-worker registration.
- [ ] Cache only public shell files and versioned static assets.
- [ ] Network-only/no-store all Supabase REST/Auth/Storage/functions, private routes, signed URLs, and media requests.
- [ ] Handle cache-version upgrade and offline fallback without showing stale private data.
- [ ] Test cache allow/deny URL patterns and service-worker lifecycle.

### Task 6: Final review and delivery

**Files:** all changed files.

- [ ] Inspect all PR diffs; run all repository Vitest tests and Worker tests.
- [ ] Run JS syntax checks, TypeScript/Deno checks, and build.
- [ ] Verify CI results for the exact head SHA.
- [ ] Review role matrix and SQL grant/policy matrix.
- [ ] Verify migration deployment path and do not claim production activation until live schema and storage bucket settings are checked.
- [ ] Request review, fix every finding, then merge only if all required checks pass.
