# ED-ALL Security Hardening and Integrated Learning Suite

**Goal:** Harden the existing platform and add coherent workflows for students, teachers, and administrators. A student AI tutor or AI teacher is explicitly excluded and must not be introduced.

**Architecture:** Preserve the active legacy HTML/JavaScript platform and its Supabase session. Add server-authoritative Supabase migrations/RPCs and a small modular browser feature hub. Provider integrations remain disabled until genuine account credentials are configured.

## Non-negotiable boundaries
- Do not modify Windows/Electron/yt-dlp or Android/NewPipe sources.
- Do not modify Piped, Invidious, Plyr, extractor, or video-proxy logic in this task.
- Do not add a student AI tutor, student teaching assistant, tutor route, tutor tools, prompt, worker, table, or UI.
- Preserve ED-ALL visual identity, Arabic/English, RTL/LTR, login, and existing navigation.
- PWA caching may include only versioned, public static shell assets. Never cache authenticated API, private content, signed URLs, or media.
- Treat Supabase as production. Do not apply migrations until live schema, function signatures, grants, and Storage policies are verified.

## Workstreams

### 1. Security and integrity
- [ ] Replace direct student self-enrollment with free-course-only enrollment.
- [ ] Serialize purchases with a wallet lock and recheck the enrollment after acquiring the lock.
- [ ] Restrict lessons, exams, questions, and PDFs at RLS/RPC boundaries; remove client access to legacy grading.
- [ ] Make lesson PDFs private with owner/entitlement reads, upload ownership validation, PDF-only MIME policy, and size limit.
- [ ] Prevent self-service ban/identity changes and reduce profile/role disclosure.
- [ ] Scope teacher notifications to their own enrolled course students.
- [ ] Validate all account bootstrap/role/profile/wallet creation writes and rollback partial accounts.

### 2. Learning workflows
- [ ] Assignments, submissions, attachments, teacher grading, and feedback.
- [ ] Attendance sessions and unique attendance records per student/session.
- [ ] Scheduled live classes with external meeting and recording URLs.
- [ ] Completion certificates with unguessable verification URLs and minimal public fields.
- [ ] Course discussions/Q&A and course-scoped moderation.
- [ ] Granular course staff roles and permissions.

### 3. Payments, analytics, and operations
- [ ] Server-priced, idempotent EGP payment orders.
- [ ] Paymob Intention API adapter and HMAC-SHA512 verified webhook; production checkout stays disabled until merchant keys and integration IDs are configured securely.
- [ ] Teacher-scoped and AAL2-protected admin analytics.
- [ ] Append-only admin audit log for role, ban, course, grading, attendance, payment, and certificate actions.
- [ ] MFA enrollment/challenge/verification for administrators; sensitive admin RPCs require AAL2.
- [ ] Excel-compatible CSV export and print/PDF reporting.
- [ ] Backup/restore instructions and restore-drill checklist, plus monitoring/rate-limit review.

### 4. Integrated UI and PWA
- [ ] Add a mobile-friendly role-aware Learning Hub in the existing page flow.
- [ ] Students see assignments, attendance, live-class schedule, certificates, discussions, and progress.
- [ ] Teachers see assignment creation/review, attendance, scheduling, discussions, and scoped analytics.
- [ ] Admins see payment status, global analytics, course-staff roles, MFA, and audit history.
- [ ] Every screen supports loading, empty, error, retry, and mobile states; no success message before server verification.
- [ ] Installable PWA with static-shell-only caching and explicit bypass of private/auth/media requests.

### 5. Validation and release
- [ ] Run all Vitest suites, worker tests, JS syntax, Deno checks, and production build.
- [ ] Verify CI for the exact PR head SHA.
- [ ] Review SQL grants, RLS matrix, RPC authorization, storage path constraints, webhook idempotency, and offline-cache exclusions.
- [ ] Keep PR unmerged and production DB untouched until all checks and live-schema verification pass.
