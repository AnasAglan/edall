# ED-ALL schema and release inventory

**Snapshot:** 2026-11-23  
**Repository baseline reviewed:** `main` at `be6eb37646807630c876b702aaff8bcdef55f6d7`  
**Purpose:** Record observed state without presenting unknown migration or recovery state as verified.

## Release status

- No SQL migration was applied to Production or the old Staging project during this review.
- No Production deploy or PR merge was performed.
- The existing Staging Lovable project is stale and its database migration ledger was not reconciled. It is not an acceptable release-validation target until rebuilt/restored and re-verified.
- The GitHub CI security suite applies migrations to a clean local Supabase stack. This does not prove the live Staging project is current.
- The workflow named `Validate ED-ALL Staging isolation` uses non-secret fixture environment values. A green result is a build/isolation regression check, not an end-to-end live Staging DB test.

## Database observations

A batched, read-only schema inventory of Production observed:

- 35 public tables; row-level security enabled across the public table inventory.
- 79 public RLS policies in the inspected schema snapshot.
- Core tables include `profiles`, `user_roles`, `courses`, `lessons`, `enrollments`, `lesson_progress`, `exams`, `exam_attempts`, `exam_results`, `assignments`, `assignment_submissions`, `attendance_sessions`, `attendance_records`, `course_certificates`, `wallet_transactions`, `payment_orders`, `payment_provider_settings`, `payment_webhook_events`, and `platform_audit_log`.
- `assignments.lesson_id` exists in the inspected schema.
- `platform_audit_log` has an immutability-protection trigger in the inspected schema. Existing business audit triggers cover course, role, profile-ban, payment-order, certificate, and assignment-grade changes; the initial inventory did not find wallet balance, wallet transaction, or provider-setting audit triggers. PR #71 proposes these missing triggers but is not merged.
- Payment order storage enforces one open order per student/course across providers. The payment-order idempotency and unique provider-reference constraints were also observed.
- The existing payment fulfillment RPC is server-side and accepts provider event ID, amount, currency, and payload hash.
- Storage buckets observed: private `assignment-submissions`, public `avatars`, public `course-images`, and private `lesson-pdfs`.

These observations describe schema objects only. They do not establish that the complete 43-file source migration history is fully represented in both remote ledgers.

## Migration source inventory

The repository contains 43 SQL migration files at the baseline above. Every filename below is present in source control.

**Observed Production ledger:** One consolidated read-only query confirmed `supabase_migrations.schema_migrations` exists and contains 21 rows, with the latest recorded version `20260730163017`. These entries correspond by migration sequence/time to the 21 source migrations through July 30, 2026. The repository contains 43 migration files, including 22 November 2026 migration files whose versions were not present in the observed ledger. However, the live schema already contains several objects introduced by those later source files. Therefore, those 22 files cannot safely be classified as simply unapplied: some DDL may have been applied outside the tracked migration ledger, or the live schema may be partially drifted. A per-file DDL/object reconciliation is required before any migration command or remote SQL write. The old Staging project remains stale and is not a valid comparison target.

- `supabase/migrations/20260320161341_b62843a4-98f6-4c1c-a9fd-2e0bdd6525e0.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260321181847_7a3877a3-896d-4920-822c-ce4ee584b89a.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260322094216_e684a75b-2b44-48d2-9a6e-b21a22de3d5d.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260323121505_c1d483fd-40b5-4372-9d77-15ab8e5e71a4.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260324214922_a3e7fecf-9ab0-4cea-913d-ed05e00ac70f.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260401214219_69b04339-ef01-4bf1-a303-62f03a28f6e9.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260404200424_382001cb-04db-4d2c-a7b6-9651da0ef63c.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260404200941_61e82951-1f51-4dd8-a635-f6322ea1901d.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260404203551_2bcc9e5e-7be9-4ed3-a9d2-55499e842bae.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260410002217_6ce82abc-892d-42f7-b9a6-ceedf624fe27.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260410002301_19e3bf58-e37a-4a6b-8ecd-ae76ecc04a7e.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260413220102_3ad2543f-12e3-4e83-b587-9c464eda028a.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260501201436_14e7ab45-105c-4dc7-8757-5afbb48c5a5e.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260505001709_2441734b-1308-49e4-89e4-73d1dc8cfc41.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260531133414_77b9ac99-9835-4850-ae64-5381eb42e586.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260713222059_78091c70-5ae2-4710-bd96-a47c1d0e709d.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260713230027_a8bbcd45-358b-4d4b-bc0e-294dc68506e9.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260713230052_f491b76e-643e-4a5d-8e71-424121b19ea1.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260714224703_cb70628b-b42c-48ef-b9c4-bbb0d4b44650.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260718223802_6bab35e0-bbb0-423a-9cfb-f76d03d7ff08.sql` — remote application status: **unreconciled**
- `supabase/migrations/20260730163017_daed461a-966e-453b-9dd1-25540e2d7b05.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261110170000_harden_setup_new_user_roles.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261110170500_add_lesson_web_playback_mode.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261114120000_harden_platform_security.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261114121000_add_integrated_learning_suite.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115101000_make_audit_log_immutable.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115102000_payment_order_idempotency.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115103000_enforce_admin_mfa_course_scope.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115104000_admin_mfa_sensitive_rpcs.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115105000_admin_mfa_rls.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115106000_admin_mfa_student_reporting.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115110000_assistant_rate_limiting.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115112000_secure_user_role_management.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115113000_enforce_course_and_admin_mfa.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115114000_scope_student_reports_to_course_capabilities.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115115000_harden_exam_attempt_lifecycle.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115116000_lock_down_definer_helpers.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115117000_allow_scoped_staged_lesson_pdfs.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115118000_restrict_learning_rpc_execution.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115119000_empty_search_path_for_legacy_definers.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261115120000_serialize_initial_admin_bootstrap.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261118190000_fix_auth_account_provisioning.sql` — remote application status: **unreconciled**
- `supabase/migrations/20261118193000_repair_orphaned_auth_profiles.sql` — remote application status: **unreconciled**

## Recovery and backup

- `docs/operations/backups-monitoring-restore.md` is an operational runbook.
- No provider backup receipt, PITR retention evidence, encrypted external backup, Storage backup inventory, restore log, RPO, or RTO evidence was established in this review.
- Therefore backup/restore readiness is **not verified**. A runbook is not a restore drill.
- Required next release gate: restore a verified Production backup into a dedicated isolated Staging project, validate Storage and the listed learning/payment tables, and record achieved RPO/RTO before any Production migration.

## Cloudflare Workers

Seven deployed Workers were observed:

1. `edall` (Pages-backed main Worker)
2. `edall-assistant`
3. `edall-assistant-staging`
4. `edall-invidious-extractor`
5. `edall-invidious-extractor-staging`
6. `edall-video-media-proxy`
7. `edall-video-media-proxy-staging`

The live settings review observed invocation logs enabled at the existing 100% sample rate and traces disabled. Query-string redaction was applied and the returned settings verified for all seven Workers. No trace sampling was enabled. Six Wrangler files cover the extractor, assistant, and media-proxy Production/Staging pairs; the Pages-backed main Worker is managed separately.

## Repository configuration

- The repository is public.
- `.env` is tracked and has five client-configuration entries: Supabase project URL/ID and Publishable-key variables. The values inspected were not service-role, database-password, Paymob, Fawry, or signing credentials.
- `.env.example` now exists on this documentation branch with placeholders for the five public Supabase client configuration keys. `.gitignore` already ignores `.env` and `.env.*` while allowing `.env.example`.
- Do not remove the tracked file until the build inputs are confirmed available in the deployment environment; then replace it with placeholders and untrack `.env` in a separate reviewed change.
- No Android source repository was available under the connected GitHub owner. Android-native implementation remains unverified.

## Pull request inventory at snapshot

| PR | Scope | State |
|---|---|---|
| #55 | Administrator MFA and user directory | Ready for review; not merged |
| #56 | Lesson-linked assignments and discussions | Ready for review; not merged |
| #57 | Attendance reports and absence alerts | Ready for review; not merged |
| #58 | Automatic course certificates | Ready for review; not merged |
| #59 | Student learning history and admin wallet ledger | Ready for review; not merged |
| #60 | App download prompt below videos | Ready for review; not merged |
| #61 | Public guest landing | Ready for review; not merged |
| #62 | Teacher-wide course analytics | Ready for review; not merged |
| #63 | Correct platform statistics | Ready for review; not merged |
| #64 | 5% sampled Worker traces | Draft; not enabled live |
| #65 | Guard video registry commit on successful refresh | Ready for review; not merged |
| #66 | Retry transient video instance directory failures | Ready for review; not merged |
| #67 | Incorrect mobile-wallet/Fawry interpretation | Closed; superseded by #68 |
| #68 | Independent dormant Fawry provider; existing Paymob preserved | Open; CI fix in progress; not merged |
| #69 | Query-string redaction in Wrangler configurations | Draft; all four CI checks observed successful; not merged |

All “Ready for review” entries remain unmerged. They are not deployed features.

## Release decision

**Production migration/deployment: BLOCKED.**

Unresolved release gates:

1. Reconcile the exact source migration sequence against Production and a fresh Staging ledger.
2. Provision or restore a truly isolated Staging database and confirm its URL/project lineage.
3. Prove backup/restore, including private Storage objects, and record RPO/RTO.
4. Apply the combined, reviewed migration set to Staging in one batch and run the full role matrix.
5. Reconcile the six Wrangler deploy configs and run per-Worker dry runs/health checks for changed Workers.
6. Approve Production migrations and deployment separately after the above evidence is attached.

No data-changing SQL was run as part of this inventory.
