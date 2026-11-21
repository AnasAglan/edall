# ED-ALL Comprehensive Platform Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Repair and complete ED-ALL's existing web, database, security, learning, wallet, native-video, and operational workflows without replacing its design or mixing platform-specific video extractors.

**Architecture:** Preserve the active HTML/JavaScript application in public/ed_master.html and the Learning Space in public/ed_features.js. Keep Supabase as the source of truth through additive SQL migrations, RLS, and narrow RPCs; keep Cloudflare Workers isolated by environment. Implement in small testable workstreams on the repair branch and release through Staging before Production.

**Tech Stack:** HTML/CSS/JavaScript, Supabase Auth/PostgreSQL/RLS/Storage, Supabase SQL migrations and pgTAP, Cloudflare Workers/Wrangler, Electron/yt-dlp, Android/NewPipe (external source required), Bun/Vitest/Playwright, GitHub Actions.

**Spec:** docs/superpowers/specs/2026-11-22-edall-comprehensive-repair-design.md

## Global Constraints

- Preserve current ED-ALL layout, brand, login, navigation, Arabic/English strings, and RTL/LTR behavior.
- Do not migrate the active platform to React or replace existing page flows.
- Web video remains Piped + Invidious + Plyr; Windows desktop remains yt-dlp; Android remains NewPipe.
- Never combine web, Windows, and Android extraction or playback implementations.
- Do not expose Supabase service-role credentials, database passwords, payment keys, webhook secrets, or signing keys to the browser or repository.
- Do not apply migrations until both projects' migration history and actual schema are reconciled.
- Never apply a Staging-tested migration to Production before a verified backup and restore-readiness gate.
- Teachers remain course-scoped; administrators are global but require AAL2 for privileged operations.
- Audit rows are append-only and cannot be edited/deleted by platform admins.
- Payment fulfillment remains server-only, signature-verified, amount-checked, and idempotent.
- Keep private Storage objects and signed URLs out of service-worker caches and public pages.
- Keep the assistant restricted to authorized teacher/admin workflows; no student AI tutor is included.
- Do not claim app-level encryption is unbreakable DRM or prevents screen recording.
- Android native work cannot be considered complete until its separate source repository is available and tested.

## Review Focus

1. An administrator has a password session at AAL1, an enrolled TOTP factor, or no enrolled factor; no admin route or data may load before successful AAL2.
2. An Auth user has no profiles row or has a role row missing; the admin user list must not silently omit or misclassify the user.
3. A teacher submits a lesson ID belonging to another course; every RPC must reject it even if the browser is bypassed.
4. A learner has a passed multiple-choice exam but an ungraded essay, a late assignment, an excused absence, or a revoked certificate; status and eligibility must be correct.
5. A video/app download is attempted with expired entitlement, offline connectivity, a rooted/compromised device, or a failed native extractor; access must fail safely without changing another platform's extractor.

---

## Workstream 0 — Release safety and repository baseline

### Task 1: Reconcile project lineage, migration drift, and recovery readiness

**Files:**
- Create: docs/operations/edall-schema-and-release-inventory.md
- Review: supabase/migrations/*.sql
- Review: supabase/tests/role_and_audit_privacy_test.sql
- Review: docs/operations/backups-monitoring-restore.md
- Review: .env, .gitignore, .github/workflows/*

**Interfaces:**
- Produces: a checked-in migration matrix containing every migration as applied, missing, partially applied, or unknown separately for Staging and Production.
- Produces: a schema-object inventory for tables, columns, constraints, indexes, policies, triggers, functions, grants, buckets, and Storage policies.

- [ ] **Step 1: Capture current evidence without writing to either database.** Record project refs, app commits, 43 repository migration filenames, remote migration history, schema-only diff, and Storage bucket names. Do not print credentials or data rows.
- [ ] **Step 2: Compare remote history and schema.** Use the installed Supabase CLI's migration-list and db-diff workflows for each project independently. Do not run migration repair or db push as a shortcut.
- [ ] **Step 3: Write the drift matrix.** Mark migrations whose effects exist but whose ledger row is missing as partially applied/unknown until the exact objects are verified.
- [ ] **Step 4: Verify backup capabilities.** Confirm current provider retention, PITR availability, Storage backup method, external encrypted copy destination, and restore permissions. A written runbook alone is not a pass.
- [ ] **Step 5: Restore a backup into the dedicated Staging project.** Verify auth, profiles, roles, courses, enrollments, lesson assets, exams, assignment submissions, attendance, certificates, wallets, and required Storage objects. Record achieved RPO and RTO.
- [ ] **Step 6: Remove tracked local configuration safely.** Replace tracked .env with a placeholder .env.example and remove .env from Git tracking. Inspect repository history for actual private keys; rotate only confirmed exposed secrets through their provider dashboards.
- [ ] **Step 7: Commit the inventory and recovery evidence.**

**Verification:**
- Read-only migration/schema comparison succeeds for both environments.
- Every uncertain object remains explicitly marked unknown; none is guessed as applied.
- Restore drill is repeatable on Staging and does not touch Production.
- A repository scan finds no service-role key, database password, payment secret, or signing key in tracked files.

## Workstream 1 — Authentication, administrator access, and accounts

### Task 2: Enforce administrator MFA during sign-in and restored sessions

**Files:**
- Modify: public/ed_master.html — handleSignIn, session restoration, route/page gating, loadCurrentUserFromSupabase call sites.
- Create: public/ed_auth_mfa.js — TOTP factor state, assurance-level checks, challenge/verify orchestration.
- Create: src/test/ed-mfa-login.test.ts
- Modify: .github/workflows/ed-security-suite.yml

**Interfaces:**
- Produces: requireAdminAal2(user, session) -> { allowed, factorId, reason }.
- Produces: startAdminMfaChallenge(factorId) -> challengeId.
- Produces: verifyAdminMfaCode(factorId, challengeId, code) -> verified session/AAL2 state.
- Uses Supabase JS v2 MFA methods and getAuthenticatorAssuranceLevel; UI state is never the security boundary.

- [ ] **Step 1: Add failing tests** for admin login with verified TOTP at AAL1, successful challenge to AAL2, incorrect/expired code, no enrolled factor, non-admin login, and restored AAL1 session.
- [ ] **Step 2: Run the new tests** and verify they fail for the missing login challenge.
- [ ] **Step 3: Implement the MFA flow** after signInWithPassword and on every restored session. Admins without a verified factor enter mandatory enrollment; admins with a factor must challenge and verify before loadData, admin pages, wallet controls, role management, or admin assistant tools are enabled.
- [ ] **Step 4: Keep server enforcement authoritative.** Verify that existing RPCs/RLS continue to reject admin AAL1; add missing AAL2 checks only where audit finds a bypass.
- [ ] **Step 5: Add error/recovery states** for expired challenges, repeated failures, session refresh, recovery, and sign-out. Do not silently skip OTP on network errors.
- [ ] **Step 6: Run MFA tests, auth tests, SQL role tests, and staging-isolation tests.**
- [ ] **Step 7: Commit the focused auth change.**

**Verification:**
- Tests prove AAL1 cannot open admin screens or invoke privileged RPCs.
- Non-admin users retain the existing login flow.
- MFA is admin-required by default; no new student OTP requirement is introduced by assumption.

### Task 3: Repair the global admin user list and account integrity

**Files:**
- Modify: public/ed_master.html — loadData user loading and admin user list error handling.
- Modify: supabase/migrations — add a new additive migration; do not edit historical migrations.
- Create: supabase/tests/admin_user_directory_test.sql
- Create: src/test/ed-admin-users.test.ts

**Interfaces:**
- Produces: admin_list_users(_term text, _limit integer, _offset integer) returning only the approved admin directory fields plus profile_state/role_state.
- Reuses or safely replaces: admin_search_users(text,integer,integer), preserving its AAL2 requirement and wallet/admin search behavior.

- [ ] **Step 1: Add failing SQL and browser tests** for normal profiles, missing profiles, missing role rows, multiple roles, empty result, pagination, denied AAL1, and query error.
- [ ] **Step 2: Implement a bounded SECURITY DEFINER directory RPC** that checks admin role and AAL2, safely joins Auth identities with profiles and user_roles, and reports missing profile state without exposing credentials or raw Auth metadata.
- [ ] **Step 3: Switch the admin list from parallel direct profiles/user_roles reads to the RPC.** Inspect and surface errors rather than destructuring away .error. Never assign a default teacher role when a role row is missing.
- [ ] **Step 4: Add explicit repair tooling** for orphaned Auth users/profile rows, using an idempotent server-side function and preserving existing account IDs and roles.
- [ ] **Step 5: Run SQL tests and browser tests** against Staging fixtures.
- [ ] **Step 6: Commit the account directory repair.**

**Verification:**
- Admin list count matches the eligible Auth/profile inventory and pagination is stable.
- A missing profile is visible as a repair-needed state, not silently lost.
- Students and teachers cannot call the admin directory RPC.

## Workstream 2 — Student navigation and learning workflows

### Task 4: Add student pages for exam/assignment history and certificates

**Files:**
- Modify: public/ed_master.html — user dropdown navigation and page routing.
- Modify: public/ed_features.js — student record data loading and renderers.
- Modify: public/ed_features.css — responsive history/certificate styles.
- Create: src/test/ed-student-records.test.ts

**Interfaces:**
- Produces: student_course_records(userId) view model assembled from the authenticated user's enrollments, exam results, assignment submissions, and certificates.
- Uses: existing exam_results, assignments, assignment_submissions, course_certificates, and public certificate verification route.

- [ ] **Step 1: Add failing tests** for enrolled course grouping, completed exam/assignment status, timestamps, question count, automatic score, pending essay grade, missing submission, revoked certificate, and empty state.
- [ ] **Step 2: Implement “امتحاناتي وواجباتي”** in the user dropdown. Group by enrolled course and show exam/assignment name, start/submission/end times where stored, question count, objective score, essay grading pending/completed, assignment score/feedback, and completion status. Do not invent unavailable timestamps; label them unavailable.
- [ ] **Step 3: Implement “شهاداتي”** in the user dropdown. Show all valid and revoked certificates, public share/verification links, certificate preview, PNG and PDF download actions.
- [ ] **Step 4: Add loading, empty, error/retry, mobile, Arabic/English, RTL/LTR states.**
- [ ] **Step 5: Verify each query is limited to the current student on the server.**
- [ ] **Step 6: Run focused tests and commit.**

**Verification:**
- Student A cannot read Student B's records by changing a URL, query, or user ID.
- Essay-pending results are not displayed as fully graded.
- Revoked certificates remain visible as revoked and cannot be presented as valid.

### Task 5: Complete lesson-specific assignments and course discussions/Q&A

**Files:**
- Modify: public/ed_features.js — renderAssignmentTab, renderDiscussionsTab, handleSubmit, loadTabData.
- Modify: public/ed_features.css — lesson labels, pinned answer, reply layout.
- Modify: supabase/migrations — additive RPC/column/index migration only where required.
- Create: supabase/tests/lesson_learning_scope_test.sql
- Create: src/test/ed-learning-links.test.ts

**Interfaces:**
- Assignment creation calls existing create_assignment with _course_id, selected _lesson_id, _title, _description, _due_at, and _max_score.
- Discussion creation calls existing create_discussion_topic with _course_id, selected _lesson_id, _title, and _content.
- Discussion replies use create_discussion_post; pinning uses a new audited capability-checked moderation RPC if no equivalent exists.

- [ ] **Step 1: Add failing tests** for course-level optional assignment, lesson-specific assignment, lesson mismatch rejection, lesson-specific topic, Q&A replies, teacher answer, and pin/unpin permissions.
- [ ] **Step 2: Add lesson selectors** to assignment and discussion creation forms; populate only lessons from the selected course.
- [ ] **Step 3: Replace _lesson_id:null** with the selected UUID or null for an intentionally course-level item.
- [ ] **Step 4: Add pinned-answer support** to discussion_posts only if a schema audit confirms it is absent. Add server-side teacher/moderator capability checks and immutable audit events for pin/unpin.
- [ ] **Step 5: Update feed loading/rendering** to show lesson title, question/answer relationship, pinned answer, locked/hidden state, and teacher identity.
- [ ] **Step 6: Run SQL and UI tests** as student, course teacher, unrelated teacher, and admin AAL2.
- [ ] **Step 7: Commit.**

**Verification:**
- Lesson/course mismatch is rejected by SQL even when the browser is bypassed.
- Teachers can pin/unpin within their course only; students can post/reply but cannot moderate.
- Existing course-level discussions and assignments remain readable.

### Task 6: Finish per-lesson attendance, absence rates, reports, and alerts

**Files:**
- Modify: public/ed_features.js — renderAttendanceTab, attendance session creation and report rendering.
- Modify: public/ed_master.html — navigation integration if required.
- Modify: supabase/migrations — optional attendance_sessions.lesson_id, threshold settings, reporting RPC, and notification outbox if absent.
- Create: supabase/tests/attendance_thresholds_test.sql
- Create: src/test/ed-attendance-analytics.test.ts
- Create: workers/edall-notifications/index.js only if no supported existing scheduler exists.

**Interfaces:**
- Attendance sessions optionally accept a lesson ID belonging to the same course.
- attendance_report(_course_id, _from, _to) returns scoped totals, present, late, absent, excused, denominator, absence rate, and student/course rows permitted to the caller.
- Threshold settings are configurable per course with a platform default.
- Notification outbox events are idempotent and processed by a scheduled worker.

- [ ] **Step 1: Add failing tests** for each status, duplicate marking, course/lesson mismatch, denominator handling, unmarked students, date filters, threshold crossing, duplicate alert suppression, and teacher scope.
- [ ] **Step 2: Add lesson linking** to attendance sessions using an additive migration and validate lesson.course_id.
- [ ] **Step 3: Implement scoped reporting RPCs**. Define denominator explicitly as students enrolled for the course/session at the attendance snapshot; do not count excused records as absences.
- [ ] **Step 4: Add per-course and overall teacher analytics** across only courses the teacher owns or is explicitly assigned to. Admins may see platform totals with AAL2.
- [ ] **Step 5: Add configurable absence thresholds** and an outbox event when the configured threshold is crossed. Avoid repeated alerts for the same threshold crossing.
- [ ] **Step 6: Add scheduled delivery** with retry/backoff, provider-independent templates, delivery audit, and safe redaction. Email delivery stays disabled until provider credentials are securely configured.
- [ ] **Step 7: Run SQL, role-matrix, and UI tests; commit.**

**Verification:**
- Present, late, absent, and excused are counted correctly.
- No alert is emitted twice for one threshold-crossing event.
- Teacher totals cannot include another teacher's course or students.

### Task 7: Automate certificate issuance and complete certificate exports

**Files:**
- Modify: public/ed_features.js — renderCertificatesTab and issuance UI.
- Modify: public/ed_master.html — course lesson editor final-lesson designation if present.
- Modify: public/ed_features.css — polished print/image certificate layout.
- Modify: supabase/migrations — additive final-lesson marker, constraint, trigger/function migration.
- Create: supabase/tests/certificate_completion_test.sql
- Create: src/test/ed-certificates.test.ts

**Interfaces:**
- One final lesson per course, enforced in PostgreSQL.
- maybe_issue_course_certificate(_course_id, _student_id, _actor_id) is internal, server-authoritative, idempotent, and reuses the existing certificate table and verification token design.
- Existing verify_course_certificate public response remains limited to certificate number, course title, student display name, issue time, and validity.

- [ ] **Step 1: Add failing SQL tests** for no final lesson, multiple final lessons, incomplete lesson, unviewed required video/PDF, failed exam, ungraded essay, successful completion, duplicate trigger invocation, and revoked certificate.
- [ ] **Step 2: Add final-lesson designation** with a partial unique index or a course-level final_lesson_id after schema comparison confirms the best existing pattern.
- [ ] **Step 3: Implement automatic issue checks** on the completion events that can make a course complete, including final lesson progress and essay grading. Reuse the existing unique course/student constraint and audit event; do not create duplicate certificates.
- [ ] **Step 4: Preserve manual admin/teacher issuance only as an audited exception** if the platform owner explicitly retains that override; otherwise remove the manual button from normal student/teacher flows.
- [ ] **Step 5: Build one certificate renderer** that uses the student's display name, course title, certificate number, issue date, brand, and public verification URL.
- [ ] **Step 6: Add PNG/image download and PDF download** using existing dependencies where suitable; add a dependency only after bundle-size, browser compatibility, and license review.
- [ ] **Step 7: Run tests for Arabic names, long names, RTL text, small screens, printing, image export, PDF export, public verify, and revoked status; commit.**

**Verification:**
- One and only one valid certificate is created once all completion requirements pass.
- A course with an ungraded essay never receives a certificate.
- The public page cannot expose student email, internal IDs, or other private profile data.

## Workstream 3 — Administrator operations and platform quality

### Task 8: Complete administrator global privileges, audit coverage, and wallet history

**Files:**
- Modify: public/ed_master.html — admin navigation, selected-user wallet details, destructive action confirmation.
- Modify: public/ed_features.js — audit/permission screens if needed.
- Modify: supabase/migrations — missing audited RPCs/policies only after full privilege audit.
- Create: supabase/tests/admin_operations_audit_test.sql
- Create: src/test/ed-wallet-admin.test.ts

**Interfaces:**
- Admin operations call narrow, AAL2-protected RPCs.
- wallet_user_ledger(_user_id uuid, _limit integer, _offset integer) returns read-only transactions for one selected user to an AAL2 administrator.
- Existing admin_credit_wallet and payment fulfillment invariants remain authoritative.

- [ ] **Step 1: Add failing tests** for admin vs teacher vs student, AAL1 vs AAL2, immutable audit, wallet ledger ownership, user deletion, price change, role changes, and denied bypasses.
- [ ] **Step 2: Inventory every admin page/action** and compare UI controls with RLS/RPC capabilities. Restore missing admin controls without widening teacher/student permissions.
- [ ] **Step 3: Add a selected-user “Transaction history” button** on the admin wallet search row. Open a centered detail modal/page with paginated read-only ledger rows and balance reconciliation.
- [ ] **Step 4: Audit all privileged changes**: course price, user deletion, role/permission change, wallet adjustment, payment state, certificate revocation, and security settings. Add actor, timestamp, target, request/event ID, and redacted before/after fields.
- [ ] **Step 5: Verify audit immutability** at grants, RLS, and trigger/function levels. Admins can read but cannot update/delete events or use any RPC to rewrite them.
- [ ] **Step 6: Run the complete permission matrix and UI tests; commit.**

**Verification:**
- Admin has global operational capability only after AAL2.
- Teacher privileges remain limited to assigned courses.
- Wallet history matches the selected user and every adjustment is auditable.
- No application administrator can rewrite or erase audit history.

### Task 9: Ensure the public guest landing page and user-facing states

**Files:**
- Modify: public/ed_master.html — guest route/page guards and public landing content.
- Modify: public/ed_features.css — only targeted responsive fixes.
- Modify: public/manifest.webmanifest, public/robots.txt, public/sitemap.xml only if the audit finds a mismatch.
- Create: src/test/ed-guest-landing.test.ts

- [ ] **Step 1: Add failing guest tests** for unauthenticated entry, public course cards, login/signup CTA, private course links, and no leakage of account/payment/lesson details.
- [ ] **Step 2: Reuse the current public home page** if it already serves guests; repair its routing and empty/error states instead of creating a duplicate landing page.
- [ ] **Step 3: Validate responsive layout, bilingual text, keyboard navigation, and public SEO metadata.**
- [ ] **Step 4: Run build and browser tests; commit.**

**Verification:**
- A guest can open the platform and understand the product and public course catalog.
- Private lessons, student records, exam answers, wallet details, and assistant controls remain inaccessible.

## Workstream 4 — Native offline video delivery and monitoring

### Task 10: Add the web app-download prompt without altering web playback

**Files:**
- Modify: public/ed_master.html — video action strip and centered download-app modal.
- Modify: public/ed_features.css or the existing video modal stylesheet.
- Create: src/test/ed-video-app-download.test.ts

- [ ] **Step 1: Add failing UI tests** that every eligible video shows a download-app action, the modal is centered and keyboard accessible, and Windows/Android links are distinct.
- [ ] **Step 2: Implement the app-download prompt** with verified official release URLs and a clear explanation that offline downloads are performed inside the native app.
- [ ] **Step 3: Confirm web playback still uses only Piped/Invidious + Plyr.** No yt-dlp or NewPipe code enters the browser.
- [ ] **Step 4: Run existing video-provider, Plyr, and origin-isolation tests; commit.**

**Verification:**
- The modal does not alter playback, quality extraction, or web fallback behavior.
- A guest or ineligible student cannot use the prompt to bypass course entitlement.

### Task 11: Complete encrypted offline storage in native applications

**Files:**
- Windows: electron/main.cjs, electron/preload.cjs, electron/installer.nsi, and focused Electron tests.
- Android: separate Android repository/source tree required; not present in this repository.
- Do not modify: public/ed_piped_player.js, workers/extract-youtube-stream/index.ts, or web player provider selection as part of native downloads.

**Interfaces:**
- Desktop downloads continue to use the existing yt-dlp invocation through narrowly validated IPC.
- Android downloads continue to use NewPipe extraction in the Android codebase.
- Both clients store encrypted content in app-private storage and play it through the app's own player.

- [ ] **Step 1: Audit existing native download and playback code** and define the encrypted container format, authenticated metadata, key lifecycle, and resume behavior.
- [ ] **Step 2: Add failing desktop tests** for authorized download, expired entitlement, interrupted download, tampered file, key loss, offline playback, and path traversal.
- [ ] **Step 3: Implement desktop encrypted download/storage** using OS-backed key protection where available; keep yt-dlp isolated and never expose arbitrary shell execution to the renderer.
- [ ] **Step 4: Obtain/connect the Android source repository** before implementing the Android half. Add tests for NewPipe download, Android Keystore key protection, app-private storage, offline playback, tamper rejection, and logout/removal policy.
- [ ] **Step 5: Avoid persistent plaintext files.** Stream decryption to the player or a bounded protected temporary stream; delete incomplete encrypted chunks safely.
- [ ] **Step 6: Document limitations**: app-level encryption cannot prevent screen recording, rooted-device extraction, or all memory inspection. Do not market this as unbreakable DRM.
- [ ] **Step 7: Test Windows and Android independently; commit each native app separately.**

**Verification:**
- Each app can play its own authorized encrypted offline copy after network loss.
- Files are not written as ordinary plaintext videos in public Downloads.
- Desktop uses yt-dlp only; Android uses NewPipe only; the web player is unchanged.

### Task 12: Harden assistant, Worker observability, and scheduled monitoring

**Files:**
- Modify: workers/edall-assistant/index.js and its existing tests only for verified defects.
- Modify: workers/extract-youtube-stream/index.ts only for web extractor health defects.
- Modify: workers/video-media-proxy/index.js only for verified proxy defects.
- Modify: wrangler*.toml and .github/workflows/deploy-*.yml after environment comparison.
- Modify: .github/workflows/validate-edall-assistant.yml, ed-piped-player-checks.yml, ed-security-suite.yml, and video-instances-sync.yml.
- Create: worker smoke/monitoring tests or scripts where gaps exist.

- [ ] **Step 1: Capture baseline health** for all seven deployed Workers, including script names, environments, current versions, log settings, trace settings, and secret binding names only (never secret values).
- [ ] **Step 2: Add regression tests** for assistant streaming, image upload, tool authorization, statistics with non-empty values, tool errors, empty model responses, and rate limits.
- [ ] **Step 3: Add monitoring** for Worker 5xx/latency, extractor healthy/degraded/failed ratio, scheduled registry refresh, assistant empty responses/tool failure, and notification delivery failures.
- [ ] **Step 4: Enable structured logs and sampled traces** in the correct staging/production Worker configs. Redact query strings, tokens, user content, and secrets from telemetry.
- [ ] **Step 5: Verify staging workers** use only staging backend refs, origins, and secrets; never copy production secrets/data into previews.
- [ ] **Step 6: Run Worker tests and Wrangler dry runs** with the intended config/environment; a dry run is not proof of runtime health.
- [ ] **Step 7: Commit and verify the exact workflow/Worker versions.**

**Verification:**
- All staging/production Worker name pairs are separated and correctly allowlisted.
- Logs/traces contain enough operational context but no bearer tokens, signed URLs, private lesson URLs, payment secrets, or raw chat content.
- The daily video-instance job reports actual success/failure and leaves a non-empty usable registry.

## Workstream 5 — Whole-platform validation and release

### Task 13: Build the complete three-role release gate

**Files:**
- Modify: .github/workflows/ed-security-suite.yml
- Modify: .github/workflows/validate-staging-isolation.yml
- Modify: .github/workflows/validate-edall-assistant.yml
- Modify: .github/workflows/ed-piped-player-checks.yml
- Create/update: src/test/*, workers/*/*.test.*, supabase/tests/*.sql, scripts/*smoke-test*

- [ ] **Step 1: Define the role matrix**: guest/anon, student, teacher owning a course, teacher assigned a course role, unrelated teacher, administrator AAL1, administrator AAL2, and service_role webhook context.
- [ ] **Step 2: Add end-to-end student tests** for login, enrollment, lesson access, exams, assignments, attendance, certificate, wallet, and guest restrictions.
- [ ] **Step 3: Add teacher tests** for lesson assignments/discussions, grading, attendance, analytics across assigned courses, moderation, and forbidden global access.
- [ ] **Step 4: Add administrator tests** for MFA, global listing, course/user operations, wallet history, immutable audit, analytics, and permissions.
- [ ] **Step 5: Run unit, SQL, Worker, JS syntax, build, lint, and browser suites** on the exact release candidate.
- [ ] **Step 6: Perform Staging restore and regression tests** against the restored database, then run the same test matrix against live Staging with safe test accounts.
- [ ] **Step 7: Review the full diff and security boundaries** with a fresh code review; resolve every blocking/high finding.
- [ ] **Step 8: Create a release report** listing changed files/migrations, test evidence, unresolved limitations, backup point, restore result, and rollback steps.
- [ ] **Step 9: Keep production migration, merge, and deployment as separate approvals.** Production rollout is blocked until the Staging and backup gates pass.

**Verification commands:**
- bun run lint
- bun run test
- bun run build
- node --test workers/edall-assistant/authorization.test.mjs workers/edall-assistant/provider.test.mjs
- node --test scripts/sync-video-instances.node-test.mjs
- Supabase CLI database tests and migration checks against the isolated test/Staging targets
- Wrangler dry-run for each changed Worker configuration

### Task 14: Prepare the 100 + 100 expansion backlog after core stability

**Files:**
- Modify: roadmap.md
- Create: docs/product/edall-world-class-backlog.md

- [ ] **Step 1: Audit current features and existing roadmap items** to avoid duplicates.
- [ ] **Step 2: Propose 100 distinct user-facing features** across learning, teacher productivity, assessment, accessibility, parent communication, analytics, community, payments, certificates, and integrations.
- [ ] **Step 3: Propose 100 distinct operational improvements/advanced techniques** across reliability, security, support, performance, automation, monitoring, data quality, release safety, and privacy.
- [ ] **Step 4: Score each item** for user value, implementation effort, recurring cost, data sensitivity, dependencies, and regression risk.
- [ ] **Step 5: Mark items as proposal only** until approved and implement them in individually testable releases.

**Verification:**
- No duplicate or vague filler entries.
- Each item has a measurable outcome, affected role, dependency, and risk/cost note.
- No expansion item is allowed to bypass the same security and release gates as core functionality.

---

## Execution order and release gates

1. Task 1 must produce the schema/migration/backup facts before any database write.
2. Tasks 2 and 3 establish admin access and reliable account visibility before broader administrative UI work.
3. Tasks 4–7 complete the student and Learning Space workflows on top of the verified database.
4. Task 8 completes wallet/admin control and audit coverage.
5. Tasks 9–12 complete guest access, native-video UX, native-app protection, and operational monitoring.
6. Task 13 is required before any production rollout.
7. Task 14 starts only after core stability; its output is a scored roadmap, not 200 unreviewed code changes.

Each workstream should be a separate reviewable PR or bounded commit series. Do not merge a broad PR simply because all files compile. Keep the repair branch based on the current main commit; refresh it before each implementation PR and avoid force-pushing over newer platform changes.

## Current blockers

- Lovable previously reported the workspace had run out of credits. Continue source review and GitHub work; do not claim live database inspection or Lovable-side edits until access is restored.
- Current live migration history and schema need read-only revalidation. No database migration has been applied by this plan.
- Android source is not present in AnasAglan/edall. Its implementation requires the separate Android repository.
- Backup retention, Storage backup, and secure email delivery depend on provider configuration and plan capabilities.
