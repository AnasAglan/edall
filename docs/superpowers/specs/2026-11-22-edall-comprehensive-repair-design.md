# ED-ALL Comprehensive Platform Repair — Design

**Date:** 2026-11-22  
**Repository:** AnasAglan/edall  
**Base commit:** 24bf4555df50203fd8c999112f3f0b64d981a77d  
**Working branch:** fix/edall-platform-repair-no-lovable

## Intent

Restore the correctness, security, and operational reliability of the existing ED-ALL learning platform, then complete the learning workflows and native-app experience requested by the platform owner. The goal is to repair and finish the existing product without replacing its visual identity or duplicating systems already in the database.

The platform serves students, teachers, and administrators. Teachers operate within their assigned courses. Administrators have global operational authority, with mandatory MFA and immutable auditing for privileged actions.

## Existing architecture and verified baseline

- Production Lovable project latest commit matches repository main at 24bf4555df50203fd8c999112f3f0b64d981a77d. The separate Staging project is on an older commit, 17e06a8212f50e33d7bdbf0ecfd8d5c3be27b549, last edited 2026-11-16.
- The active student/teacher/admin web interface is public/ed_master.html, a large legacy HTML/JavaScript application. public/ed_features.js and public/ed_features.css implement the Learning Space. The root Vite/React source is not a reason to rewrite the active platform.
- public/ed_master.html currently loads administrator users from profiles and user_roles directly and ignores query errors in the Promise.all result. It also builds a fallback teacher role when a profile has no matching role.
- The sign-in handler in public/ed_master.html calls signInWithPassword and continues into loadData without a mandatory TOTP challenge or an explicit AAL2 check.
- The database already contains admin_search_users, which requires administrator MFA, but the main loadData user list does not use it. The search RPC currently starts from profiles, so orphaned Auth users still need an explicit handling strategy.
- The learning migration already defines lesson_id on assignments and discussion_topics. The browser module currently sends _lesson_id:null when creating both, so the feature is course-level despite the schema supporting lesson scope.
- Attendance sessions currently have course_id but no lesson_id. Attendance records already support present, absent, late, and excused and enforce one record per student/session.
- course_certificates, issue_course_certificate, and verify_course_certificate already exist. The issue RPC checks course completion and creates a unique certificate number and verification token, but the UI still exposes manual issuance / eligibility checks. No verified automatic completion-to-issuance trigger or final-lesson designation was found in the inspected migration.
- discussion_topics supports pinning topics, but discussion_posts does not yet expose a pinned-answer state.
- get_course_analytics and get_platform_analytics already exist. The analytics UI serializes returned values generically and the platform has previously shown blank statistic values; teacher-wide aggregation across all assigned courses still requires verification.
- The wallet UI already shows the signed-in user's transaction history. The admin user search RPC returns the user's balance, but the requested selected-user transaction-history view is not present in the inspected flow.
- There are 43 Supabase migration files in the repository. Prior audits recorded migration-history/schema drift between the projects. Current live schema and migration status must be rechecked before any SQL is applied.
- docs/operations/backups-monitoring-restore.md is a runbook, not proof that scheduled backups or a restore drill are active.
- Seven Cloudflare Worker scripts are present: edall, edall-assistant, edall-assistant-staging, edall-invidious-extractor, edall-invidious-extractor-staging, edall-video-media-proxy, and edall-video-media-proxy-staging. Cloudflare reports Workers Logs enabled but Traces disabled on the inspected scripts.
- The repository contains web and Electron desktop source. The Android project is not in this repository tree and cannot be safely changed until its own repository/source is available.
- .env is tracked in Git even though .gitignore excludes it. The inspected variable names are Supabase URL and publishable-key configuration, not a service-role key. It should still be removed from version control and replaced with a placeholder .env.example; review Git history for any actual secret before deciding whether rotation is needed.
- Existing automated checks include Vitest suites for auth, signup OTP, learning, security, video playback, staging isolation, and media-proxy security; SQL role/audit tests; and assistant Worker authorization/provider tests.

## Goals

1. Make administrator login consistently require a verified TOTP factor and AAL2 before any administrator data or privileged operation is available.
2. Repair administrator user discovery, including missing profile rows, pagination, query failures, and clear user-facing errors.
3. Complete student navigation pages for exams and assignments and earned certificates.
4. Bind assignments and discussions/Q&A to lessons; support teacher answers and pinning important answers.
5. Complete lesson attendance, per-course attendance reports, absence percentages, and configurable threshold notifications.
6. Complete final-lesson designation and automatic, idempotent certificate issuance after all course completion requirements are met; provide polished PNG/image and PDF downloads plus public verification.
7. Provide course analytics and teacher-wide analytics over only the teacher's assigned courses; administrators can view platform-wide analytics.
8. Add a secure admin view of the selected user's wallet ledger and retain audited, server-authoritative balance adjustments.
9. Restore full administrator operational capabilities across the platform while preserving AAL2, least-privilege server boundaries, payment integrity, and append-only audit history.
10. Provide a public guest landing experience without exposing private course content or user information.
11. Add an app-download prompt below every web video and complete encrypted offline video storage/playback in native clients without merging their extraction paths.
12. Complete operational controls: real backup scheduling and restore proof, monitoring/alerting, notification/email delivery, assistant health, and release tests for student, teacher, and administrator roles.
13. Preserve the current design, bilingual Arabic/English behavior, RTL/LTR layout, and existing navigation.

## Non-goals and anti-goals

- Do not rebuild the active web platform in React or replace its visual identity.
- Do not change the Windows desktop extractor from yt-dlp.
- Do not change the Android extractor from NewPipe.
- Do not replace the web Piped/Invidious + Plyr playback path with either native-app extractor.
- Do not put service-role keys, payment secrets, database passwords, or signing keys in browser code, public repository files, logs, or chat.
- Do not give teachers global access to unrelated courses.
- Do not allow administrators to rewrite/delete audit history or bypass payment validation.
- Do not claim that application-level file encryption is unbreakable DRM. Rooted/compromised devices, memory extraction, and screen recording remain possible. Strong commercial DRM requires a compatible DRM licensing ecosystem.
- Do not add a student AI tutor as part of these repairs. The existing operational ED-ALL Assistant remains for authorized teacher/admin workflows unless a separate product decision is made.
- Do not implement an arbitrary set of 200 feature ideas before core correctness, security, and release quality are proven.

## Approaches considered

### A. One large production batch
This would combine frontend, database, authentication, native apps, and Cloudflare changes in one release. It is rejected because the migration ledgers are not yet reconciled, Staging is older, and a failure would be difficult to isolate or roll back.

### B. Replace the active app with a new React implementation
This may create a cleaner architecture but conflicts with the requirement to preserve the existing site and risks breaking established login, navigation, payments, and video paths. It is rejected.

### C. One coordinated repair program with isolated, tested workstreams
Keep the current architecture, add only additive migrations after schema comparison, repair one subsystem at a time, and deliver each as a reviewable commit/PR behind Staging tests. This is the selected approach. It gives the owner one coordinated roadmap while keeping database and production risk controlled.

## Architecture and security decisions

### Authentication and roles
Use Supabase Auth TOTP MFA and inspect the current assurance level after password sign-in and on restored sessions. Administrators must enroll and verify a factor before administrator routes/data are enabled; they must reach AAL2 for privileged operations. This plan interprets the current MFA requirement as mandatory for administrators, consistent with existing database policies. It does not newly force OTP on every student account. Do not trust frontend role flags: server RPCs and RLS remain authoritative.

### Administrator user discovery
Use a narrowly scoped SECURITY DEFINER RPC protected by has_role(admin) and AAL2. It must join Auth users and profiles safely, include/flag missing profiles rather than silently omitting Auth users, paginate with a bounded limit, and return only the fields the admin screen needs. Never expose auth.users or service-role access directly to the browser.

### Learning workflows
Reuse assignments, assignment_submissions, attendance_sessions, attendance_records, course_certificates, discussion_topics, discussion_posts, and existing RPCs. Add only the missing fields/constraints/functions. Validate that a lesson belongs to the selected course in SQL, not only in the browser. Use server-side idempotency for certificate issuance and notification generation.

### Attendance and alerts
Keep the current four statuses. Link attendance sessions to an optional lesson. Make absence thresholds configurable at platform/course level; do not hard-code an arbitrary percentage. Store notification outbox events and process them with an idempotent scheduled job, with retry and delivery status.

### Certificates
Represent one designated final lesson per course, with a database constraint preventing multiple final lessons. Completion means all required course lessons, videos/files as configured, passing exams, and completed essay grading. Auto-issuance must be server-side, idempotent, audited, and must not issue a certificate early. Public verification exposes only certificate number, course title, student display name, issue date, and validity. Provide a consistent, accessible certificate layout with downloadable image and PDF.

### Wallet and audit
Use the existing read policies and audited wallet RPCs. Admin transaction history must be read-only and scoped to the selected user. All balance adjustments, user deletion, role changes, course price changes, permission changes, certificate revocations, and payment events must write append-only audit events. An admin may run platform operations but cannot alter the audit log itself.

### Video and native applications
The web video page continues to use Piped/Invidious and Plyr. Its download button opens a centered app-download prompt with platform-specific release links. Windows continues using yt-dlp; Android continues using NewPipe. Native clients store downloads encrypted in app-private storage and decrypt for playback through the app's player; use OS-backed key storage where available and avoid persistent plaintext exports. The Windows code exists in this repository; Android implementation is blocked until its separate source repository is available. Treat this as app-level offline protection, not absolute DRM.

### Cloudflare and assistant operations
Preserve separate staging/production Worker names, bindings, origins, and secrets. Enable structured logs and sampled traces where supported, add health/smoke checks for assistant/extractor/media proxy, and alert on sustained 5xx, latency, failed extraction, assistant empty responses/tool failures, and schedule failures. Never copy production secrets or data into staging previews.

### Database, backups, and releases
Treat the repository migration files as desired history, not proof of the live database state. Build a three-way inventory of repository migrations, each project's remote migration history, and actual schema objects. Do not run all migrations blindly or use migration repair to hide drift. Prove a staging restore including Storage objects before production migration. Keep production schema changes, source merge, and deployment as separate release operations.

## External dependencies and unresolved facts

- Lovable workspace previously returned an out-of-credits error for Plan Mode. GitHub source work and documentation can continue, but Lovable database queries/agent edits may remain unavailable until quota is restored.
- Current Staging and Production database migration histories need a fresh read-only comparison. No production SQL changes are authorized by this design.
- Automated backup retention and restore access depend on the actual Supabase plan and available secure backup destination.
- Paymob and email provider credentials must be configured through a secure dashboard/secret mechanism; they are not to be invented or committed.
- Android source is outside this repository and must be supplied or connected before native Android work.
- Proposed absence thresholds remain configurable and must be chosen in the admin settings rather than embedded in code.
- The user previously requested a backlog of 100 feature ideas and 100 advanced improvements. After the core release gates pass, prepare that as a separate scored roadmap: deduplicate, categorize, estimate effort/cost, identify risks, and implement only items that pass value and regression review.

## Acceptance criteria

The release is acceptable only when:
- An administrator with a verified TOTP factor is prompted at login and reaches AAL2 before admin content loads; an administrator without an enrolled factor is routed to mandatory enrollment and cannot bypass it.
- Admin user listing accurately displays all eligible users, clearly handles missing profiles, paginates, and surfaces query/RPC failures.
- Lesson assignment/discussion creation persists the selected lesson and rejects cross-course lesson IDs.
- Attendance reports correctly distinguish present, late, absent, and excused, calculate denominators correctly, and send at most one threshold notification per threshold-crossing event.
- A certificate is issued automatically once, only after the final course completion condition passes; revoked certificates remain verifiably revoked; both image and PDF downloads open and render correctly.
- Teacher analytics never include unauthorized courses; admin analytics show platform totals with no blank fields caused by ignored errors.
- Admin wallet transaction history matches the selected account and all wallet changes appear in immutable audit history.
- Guest routes expose no private student, payment, exam-answer, or lesson content.
- Native offline downloads remain inside each app's private encrypted storage and are playable offline by that app; extraction engines remain isolated.
- Backup restore is demonstrated on Staging, all relevant role-based tests pass, and no required CI check is failing.
- No production migration or deployment occurs without a verified backup, staging proof, and explicit release approval.
