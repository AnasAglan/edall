# ED-ALL live-state follow-up

**Captured:** 2026-11-24 (read-only database inspection; Cloudflare settings were changed as described below)  
**Main commit at capture:** `d13efcb1ed5d1d3f5770e2bea6b865fd6f56d48c` — PR #64  
**Repository:** `AnasAglan/edall`  
**Migration source files:** 46 SQL files on `main`

## Confirmed changes since the 2026-11-23 audit

### Cloudflare Worker tracing

PR #64 was changed to ready and merged as `d13efcb1ed5d1d3f5770e2bea6b865fd6f56d48c`. The live Cloudflare API was then updated and read back for all seven deployed ED-ALL Workers:

- `edall`
- `edall-assistant`
- `edall-assistant-staging`
- `edall-invidious-extractor`
- `edall-invidious-extractor-staging`
- `edall-video-media-proxy`
- `edall-video-media-proxy-staging`

For each Worker, observed settings after the update were: observability enabled, invocation logs enabled, query-string redaction enabled, traces enabled, and trace head sampling set to `0.05` (5%). The account API reported the Free plan, a 200,000-event daily limit, normal status, and only 15 observability events in the previous 24-hour usage window at the time checked. These are point-in-time readings; review Cloudflare's current usage dashboard as traffic changes.

### Teacher analytics scope correction

A logic defect was found in PR #62: the teacher analytics RPC could enter an administrator-wide course loop, but each called per-course RPC independently required course analytics capability. The PR branch was corrected so administrators must use the existing global `get_platform_analytics()` path, while `get_teacher_analytics()` aggregates only courses where the caller has the analytics capability. A regression test was added. The updated PR head is `472417e3b99f61e4c0728d3d06cdb1bab0a7bcaa`.

At capture, the updated security/learning GitHub Actions workflow was still applying all migrations to a clean local Supabase stack; build, platform tests, Worker checks, payment signature checks, and origin-isolation checks had not yet run. The Staging isolation and video-player workflows on the same head had completed successfully. Do not treat PR #62 as fully validated until the remaining workflow steps pass.

## Current live database facts

A consolidated read-only check observed:

| Item | Production | Staging |
|---|---:|---:|
| Public tables | 35 | 37 |
| Public RLS policies | 79 | 79 |
| Public tables with RLS disabled | None observed | None observed |
| `supabase_migrations.schema_migrations` | Present, 21 rows | Missing |

Production's latest recorded migration version remains `20260730163017`. The repository has 46 SQL migration files. Do not interpret the difference (46 source files vs. 21 recorded Production versions) as a simple list of unapplied migrations: some newer objects are already present in live schemas, suggesting off-ledger or partial schema changes.

### Feature-migration object comparison

These objects were explicitly checked:

| Feature object | Production | Staging |
|---|---|---|
| `discussion_posts.is_pinned` | Missing | Present |
| `attendance_sessions.lesson_id` | Missing | Present |
| `attendance_alert_settings` / `attendance_alert_events` | Missing | Present |
| `lessons.is_final` | Missing | Present |
| `exam_attempts.question_count` | Missing | Present |
| `admin_list_users` | Missing | Present |
| `set_discussion_post_pinned` | Missing | Present |
| `get_attendance_report` | Missing | Present |
| `set_course_absence_threshold` | Missing | Present |
| `set_course_final_lesson` and auto-issue helpers/triggers | Missing | Present |
| `get_my_learning_history` | Missing | Present |
| `wallet_user_ledger` | Missing | Present |
| `get_teacher_analytics` | Missing | Present |

This comparison describes named objects/signatures only; it does not prove all migration effects, constraints, grants, triggers, Storage policies, or data values are equivalent. The old Staging project is not currently a clean, restored clone of Production.

## Release gates still open

1. **Migration reconciliation:** produce a per-file/per-object matrix for all 46 SQL migrations against Production before any migration-history repair or DDL. Staging's missing history table must not be repaired by blindly marking versions applied.
2. **Fresh Staging restore:** produce a reliable isolated Production backup/restore baseline, including schema, RLS, functions, triggers, Storage buckets/objects, and representative non-sensitive test data, then test it.
3. **Authorization test matrix:** GitHub CI tests a clean local Supabase stack. The same student / course-owner / unrelated teacher / AAL1 admin / AAL2 admin / anonymous matrix has not been run against a freshly restored live Staging project. A live fixture transaction attempt through the Lovable DB tool was blocked by safety controls; no fixture writes were made.
4. **Backups:** the operations runbook is documentation only. PITR/retention evidence, encrypted external backup, Storage backup, and a successful restore drill remain unverified.
5. **Payments:** Paymob and separate Fawry code are present; real merchant Sandbox credentials and end-to-end test transactions remain outstanding. Fawry remains dormant/disabled by default; do not activate it.
6. **Native apps:** Windows encrypted offline code and Android encrypted offline code have CI validation, but require real Windows 10 and Android device smoke tests. Android PR #1 and #2 both edit the generated Android workflow and must be reconciled into a single tested branch before release.
7. **Video availability:** automated discovery and tests do not guarantee stable public Piped/Invidious hosts for every user; recent registry health was poor. Keep the web extractor separate from Windows yt-dlp and Android NewPipe.

## No live database writes

No SQL DDL, migration-history repair, INSERT, UPDATE, DELETE, or other write was made to either live database during this follow-up. No payment provider was activated and no payment keys were changed.
