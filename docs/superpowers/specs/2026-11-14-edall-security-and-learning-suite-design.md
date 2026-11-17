# ED-ALL Security Hardening and Integrated Learning Suite — Design

**Date:** 2026-11-14  
**Repository:** `AnasAglan/edall`  
**Base commit:** `91f7bfeae2e511890b31af495a49b050f6f63713`

## Intent
Harden ED-ALL's production authorization boundaries and add integrated learning workflows for students, teachers, and administrators. **A student AI tutor/AI teacher is out of scope and must not be added.** The existing ED-ALL operational assistant remains separate and unchanged.

## Existing architecture
- The active course UI is the legacy single-page `public/ed_master.html`; the root Vite React app is not the active course UI.
- Supabase PostgreSQL RLS, SECURITY DEFINER RPCs, and Storage enforce access.
- Browser modules reuse the existing authenticated Supabase client/session.
- Video playback is separated: web uses Piped/Invidious + Plyr, Windows uses yt-dlp, Android uses NewPipe. Do not change these engines or their boundaries.
- Live class schedules point to external meeting/recording providers; they do not themselves host or record media.
- Payment intents are created on the server from the course's authoritative price; only a verified Paymob webhook can fulfill enrollment.
- PWA caches only the public static shell. Private APIs, lessons, media, and signed URLs are never stored offline.
- Admin-sensitive analytics and audit access require MFA/AAL2.

## Included systems
1. Security hardening: free-only direct enrollment; transactional wallet purchase; lesson/question access; internal grading; private PDF storage; protected profiles/roles; teacher-scoped notifications; strict account bootstrap.
2. Learning: assignments/submissions/grading, attendance, scheduled live classes, completion certificates, course discussions/Q&A, course-scoped staff roles.
3. Payments: EGP Paymob intention adapter and idempotent HMAC-verified webhook flow, disabled until secrets/payment integration IDs are securely configured.
4. Admin operations: scoped analytics, CSV/print reports, append-only audit log, MFA/AAL2.
5. PWA and operations: public-shell caching only, upload constraints, backup/restore guidance, monitoring/rate-limit review.

## External prerequisites
- No student AI tutor route, worker, prompt, tool set, data table, or UI.
- Do not claim Paymob is live until the merchant Secret Key, Public Key, HMAC Secret, and payment method Integration IDs have been securely configured.
- Do not claim automatic meeting-room creation/recording without an external meeting provider and credentials.
- Do not cache private lessons, exam questions, auth responses, payment details, signed URLs, or media.
- Backup instructions are not equivalent to an already configured backup job or proven restore.

## Authorization invariants
- Direct enrollment insertion is only for zero-priced courses. Paid enrollment comes through a server transaction or verified payment callback.
- RLS and RPCs use `auth.uid()`, enrollment, course ownership, or explicit course-scoped staff capability.
- Students never receive answer-key fields or internal grading permission.
- Only admins can change roles and ban status; sensitive admin paths require AAL2.
- Lesson PDFs are private; both reads and writes check ownership/entitlement and validated object path segments.
- Teachers cannot operate on other teachers' courses or their students.
- Payment amounts are derived from the database. Duplicate callbacks cannot duplicate enrollment or change a paid order.
- Public certificate verification returns only certificate number, course title, student display name, and issue date.
- Audit history is append-only for application roles; admin readers require AAL2.
- The service worker caches only an allowlist of versioned, same-origin static resources.

## UX
Add “مساحة التعلم” / “Learning Hub” within the existing platform. Students receive assignments/submissions, attendance, schedule, certificates, discussions, and progress. Teachers receive assignment creation/grading, attendance, schedule, moderation, and scoped reports. Admins receive payment status, global analytics, staff-role administration, MFA, and audit history. All screens require loading/empty/error/retry/mobile states and bilingual RTL/LTR support.

## Delivery
Implement security first, then database workflows, role-aware UI, payment adapter/webhook, and PWA. Run full tests and CI on the exact branch head. Do not merge or apply production migrations while required checks or live schema verification remain incomplete.
