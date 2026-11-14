# ED-ALL Security Hardening and Integrated Learning Suite — Design

**Date:** 2026-11-14  
**Repository:** `AnasAglan/edall`  
**Base commit:** `91f7bfeae2e511890b31af495a49b050f6f63713`

## Intent

Harden ED-ALL's production authorization boundaries and expand the existing learning platform with coherent student, teacher, and administrator workflows. The browser must never be the authority for enrollment, lesson access, grading, roles, attendance, payments, or certificates.

## Current architecture and findings

- The production web UI is the legacy single-page `public/ed_master.html`, with global Supabase client state and `public/ed_assistant.js`. The Vite React application at the repository root is not the active course-platform UI.
- The primary database is Supabase/Lovable Cloud. Existing access control uses PostgreSQL RLS, SECURITY DEFINER RPCs, and Supabase Storage.
- Existing exam attempts are already server-authoritative through `start_exam_attempt` and `submit_exam_attempt`; the old `grade_exam_submission` RPC is a separate exposed path and must no longer be callable by clients.
- Desktop and Android playback are separate products (yt-dlp and NewPipe respectively). This work must not edit their source or alter their playback engines.

## Goals

1. Close direct enrollment, lesson-content, answer-key, profile-ban, teacher-notification, and public-profile information leaks at the database boundary.
2. Make PDF access private and issue signed URLs only to users who are entitled to the lesson.
3. Make course purchase idempotent under concurrency and validate every user-creation step before reporting success.
4. Provide integrated, role-scoped systems for:
   - Assignments and submissions with teacher grading and feedback.
   - Attendance sessions and attendance records.
   - Verifiable course-completion certificates.
   - Scheduled live classes with provider-neutral meeting links and attendance.
   - Admin/teacher learning analytics with scoped aggregates.
   - Payment orders with idempotent provider webhook handling.
   - Course/lesson discussions with moderation rules.
   - PWA install and a deliberately limited offline shell.
   - Append-only administrative audit history.
5. Keep the existing visual identity, language behavior, authentication, and navigation coherent; improve the UI where it supports these workflows.
6. Add automated tests for policies, RPC contracts, role boundaries, UI modules, and regressions.

## Non-goals and external prerequisites

- Do not modify Electron/Windows or Android app code or their yt-dlp/NewPipe engines.
- Do not claim secure app-only video delivery until native clients can prove device/app identity; a shared Supabase bearer token cannot distinguish a browser from a repackaged client.
- Do not pretend a payment gateway is connected without merchant credentials, production webhook secrets, and provider account approval. Implement a provider-neutral order lifecycle and test adapter; keep live capture disabled until configured.
- Do not claim live video hosting is included. Schedule and manage externally hosted meetings; a meeting provider requires an account and credentials.
- Do not cache private lessons, exam questions, authentication responses, payment data, or signed file URLs for offline use.
- Do not expose private student content to analytics or audit readers beyond their role and course scope.

## Approaches considered

1. **Extend the current platform with modular browser code and additive Supabase migrations (chosen).** Lowest regression risk; keeps existing sign-in, theme, routes, and database, while moving sensitive decisions into RLS and RPCs.
2. Rebuild the platform in React. Rejected for this change because it would replace the active legacy UI and create migration risk across authentication, media, and app snapshots.
3. Build a separate LMS subsystem/site. Rejected because it duplicates accounts, navigation, permissions, and course data, undermining the requested integrated experience.

## Architecture

- Database migrations define tables, indexes, constraints, triggers, SECURITY DEFINER RPCs, and explicit grants. Policies use `auth.uid()`, course ownership, enrollments, and the established `can_access_lesson` function.
- UI additions are a focused feature module loaded from the existing `ed_master.html`; it consumes the existing global Supabase session and current-user event, and respects the current Arabic/English setting and CSS variables.
- Payment orders use a strict state machine (created → pending → paid/failed/cancelled), unique provider references/idempotency keys, server-verified callbacks, and a single transactional fulfillment RPC. Manual/sandbox mode is not represented as a real card payment.
- Certificates use an unguessable verification token and server-side issuance checks for enrollment and completion.
- Audit records are append-only for authenticated application roles; write access is limited to trusted server-side functions/triggers.
- PWA caches only the public application shell and versioned static resources.

## Security invariants

- Direct authenticated INSERT into `enrollments` is allowed only for free courses; paid enrollment is created only by the purchase RPC after a locked balance check.
- Student lesson SELECT requires `can_access_lesson(id)`; course owner and admin access remains intact.
- Client roles cannot call internal grading functions. A student may submit only their own active server-created attempt once. Correct answers remain available only to the authorized grader and are never part of the student response before submission.
- Only administrators may change `profiles.banned` or user roles.
- `lesson-pdfs` is private; Storage SELECT requires entitlement to the lesson whose ID is the second path segment.
- Teacher-created notifications are scoped to students enrolled in courses owned by that teacher; broadcasts are administrator-only.
- Public teacher search returns only public profile fields and never exposes email addresses.
- All payment fulfillment is server-side, idempotent, and cannot trust browser-supplied amounts or status.
- Every data-bearing new table has RLS enabled and grants restricted to the intended roles.

## UX and accessibility

Use a dedicated “مساحة التعلم”/“Learning Hub” entry in the current platform. Show only features available to the signed-in role. Student screens focus on assignments, submissions, attendance, class schedule, certificates, discussions, and progress. Teacher screens focus on assignment review, attendance, live classes, discussion moderation, and course-scoped reports. Admin screens add payment review, global analytics, and audit history. All new screens must handle loading, empty, error, retry, and mobile layouts, and must not claim success until the server confirms it.

## Delivery and verification

Implement in independently reviewable groups: (1) security migration and tests, (2) core learning schema and permission tests, (3) student/teacher/admin feature UI and server workflows, (4) PWA/offline shell, (5) final review. Run the existing Vitest suite, assistant Worker tests, syntax/type checks, and targeted static policy tests. Run CI on the PR. Do not merge or deploy a migration if its tests fail. Database changes are not live merely because the GitHub migration file exists; deploy through the authenticated Supabase/Lovable Cloud path and verify the live schema before reporting completion.
