# ED-ALL Source Audit Ledger

**Repair branch:** `fix/admin-mfa-and-user-directory`
**Audit mode:** remote, read-only source inspection plus reviewable branch changes
**Rule:** A directory listing is not a file review. Mark files complete only after reading the relevant source and recording the examined commit. The complete repository audit remains open.

## Reviewed source groups

| File | Scope reviewed | Status | Finding / action |
|---|---|---|---|
| `AGENTS.md` | Architecture invariants and repository instructions | Partial | Confirms monolithic HTML active UI, separate Electron boundary, Staging Worker origin/config separation. |
| `public/ed_master.html` | Auth flows, MFA scripts, `loadData`, modal helpers, user mapping, wallet UI | Partial, targeted sections | Sign-in/restored-session flows lacked TOTP gate; admin list queried profiles and roles separately, ignored errors, and defaulted missing roles to teacher. Changes are on PR #55. Full file review remains open. |
| `public/ed_features.js` | Assignment, attendance, certificate, discussion, analytics, MFA functions | Partial, targeted functions | `create_assignment` and `create_discussion_topic` currently send `_lesson_id:null`; MFA is managed in Learning Space but not in main login flow. |
| `supabase/migrations/20261114121000_add_integrated_learning_suite.sql` | Learning tables/RPC signatures | Partial | Existing assignments, attendance, certificates, discussions, analytics, payment, and audit objects should be reused rather than duplicated. |
| `supabase/migrations/20261115113000_enforce_course_and_admin_mfa.sql` | AAL2 policies and admin account search/wallet functions | Partial | Existing `admin_search_users` requires admin + AAL2 but starts from profiles and omits missing-profile Auth users. |
| `supabase/migrations/20261118190000_fix_auth_account_provisioning.sql` | Auth-user trigger provisioning | Partial | Creates profiles/wallets and least-privilege role inside trusted Auth trigger. |
| `supabase/migrations/20261118193000_repair_orphaned_auth_profiles.sql` | Legacy account repair migration | Partial | Repairs profiles for users with an existing role; the live Production audit still finds four users without profiles, so recheck why these were not repaired or why new legacy orphans remain. |
| `supabase/tests/role_and_audit_privacy_test.sql` | Role, AAL2, definer grants, audit, payment, profile security tests | Partial | Added four assertions for the new admin directory RPC on PR #55; SQL suite validation pending. |
| `src/test/ed-auth-rules.test.ts` | Auth rules and browser auth flow tests | Partial | Added administrator TOTP state/flow tests and directory-RPC integration checks; CI validation pending. |
| `.github/workflows/ed-security-suite.yml` | Security/learning DB reset, lint, SQL tests, app tests | Partial | Expanded path triggers to include auth regression test files on PR #55. |
| `docs/operations/backups-monitoring-restore.md` | Operations runbook | Read | Instructions only; not proof of configured backup service or restore success. |
| `.env`, `.gitignore` | Tracked config hygiene | Metadata/partial | `.env` is tracked despite ignore rule and contains public Supabase URL/publishable-key configuration. No service-role secret was observed in inspected lines. Removal requires confirming Vite/build and emitted config path first. |

## Prioritized findings

### P1 — Admin account directory visibility

Production has 16 Auth users, 12 profiles, and four missing profiles. `loadData()` previously depended on `profiles` and silently ignored result errors. The old code also defaulted role-less users to `teacher`, which is unsafe and misleading.

**Fix in PR #55:** new AAL2-gated `admin_list_users` RPC starts from `auth.users`, left joins profiles/roles, returns explicit `profile_state` and `role_state`, bounds search/pagination, and returns minimal UI data. Main user list consumes that RPC and checks errors. Pending SQL/CI validation and staging application.

### P1 — Administrator login MFA

MFA enrollment/challenge/verification UI existed in Learning Space, but login, restored-session, and token-refresh paths did not require AAL2 before loading platform data.

**Fix in PR #55:** TOTP check after password sign-in, restored-session loading, Auth state changes, and account creation if an admin session is present. Admin without a verified TOTP factor is routed to mandatory enrollment. Non-admin login is unchanged. Pending runtime/CI validation.

### P1 — Migration history is unreliable

Production migration ledger has 21 entries through `20260730163017`; Staging lacks the migration history relation. Yet broad live schema signatures match and both environments contain later Learning Space/security objects. Do not blindly replay repo migrations or repair history without a per-object migration diff.

### P1 — Recovery readiness is unproven

Backup instructions exist, but scheduled/PITR backups, external encrypted backup, Storage backup, and a Staging restore drill are not evidenced.

### P2 — Lesson-scoped assignments and discussions are not wired through the UI

Database columns and RPC parameters support `lesson_id`, but browser creation passes `null`. Fix UI selectors and SQL validation without duplicate tables.

### P2 — Automatic certificates and final-lesson designation

Existing issue/verification RPCs and a unique course/student certificate are present. Automatic issuance and final-lesson designation were not verified; existing completion conditions include video/PDF progress and passed exams with essays graded.

### P2 — Attendance reports/alerts

Attendance sessions and records exist. Sessions are course-scoped; the requested lesson-level link, absence-rate reporting, configurable thresholds, and idempotent notifications need completion.

### P2 — Teacher-wide analytics

A course analytics RPC exists, but aggregate analytics over all courses assigned to a teacher and robust handling of empty/failed RPCs require verification.

### P2 — Admin wallet ledger navigation

The signed-in user transaction-history page exists. The admin wallet user search flow does not yet expose the selected user's transaction ledger.

### P3 — Public landing, student record pages, downloads, native encrypted offline storage

These remain open workstreams. Android source is unavailable in this repository and must be connected separately.

## Explicit unknowns

- Trigger-level diff between Production and Staging: hashes differ; query budget exhausted before full exact diff returned.
- Exact status of each repository migration against each project's remote objects.
- Whether any Auth user missing a profile should be repaired or quarantined. Do not assign a role by default.
- Backup service/PITR/Storage backup configuration and successful restore evidence.
- Current deployment parity between all Cloudflare Worker names and repo source.
- Android source repository and current NewPipe project state.
- Whether `exam_attempts` is canonical or a partially introduced table in both environments.

## Current status

This ledger is a partial source audit. Do not describe the whole repo as line-by-line audited until every tracked runtime, SQL, config, test, workflow, desktop, and Android source group has an explicit review entry and regression evidence.