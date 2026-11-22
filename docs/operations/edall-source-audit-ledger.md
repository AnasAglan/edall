# ED-ALL source audit ledger

**Snapshot:** 2026-11-23  
**Repository:** `AnasAglan/edall`  
**Baseline:** `be6eb37646807630c876b702aaff8bcdef55f6d7`

This ledger records only source areas actually examined during the current repair pass. It is not a claim that every tracked file in the repository has been reviewed line-by-line.

## Reviewed this pass

| Area | Files / implementation | Result | Evidence / remaining action |
|---|---|---|---|
| Admin MFA | `public/ed_master.html`, admin-directory SQL migration, auth rule tests | Reviewed | Admin session calls AAL2 enforcement before normal auth-state loading; sensitive admin directory RPC independently checks admin role and AAL2. Full live Staging AAL1/AAL2 role matrix still required. |
| User directory | `admin_list_users` migration and its joins | Reviewed | Includes Auth users even when profile/role state is missing; does not guess a default role. Confirm live Auth/profile reconciliation only on restored Staging. |
| Assignments/discussions | lesson-specific migration and Learning Space source | Reviewed | Lesson IDs are validated against the selected course; pin/moderation functions are capability- and audit-gated. Run the full student/owner/unrelated-teacher/AAL2-admin matrix on Staging. |
| Attendance | attendance reporting/threshold migration | Reviewed | Reports separate present/late/absent/excused; excused rows are excluded from the absence denominator; duplicate threshold alert rows are suppressed. Delivery/retry of notifications still requires a separate end-to-end verification. |
| Certificates | automatic certificate migration and triggers | Reviewed | One final lesson per course is constrained; issuance requires completion of all course lesson requirements and passed/graded exams; issue action is idempotent/audited. PNG/PDF/Arabic RTL visual export still needs browser verification. |
| Student history/wallet | student history and wallet ledger migration | Reviewed | Student history is scoped to `auth.uid()`; admin ledger is read-only and AAL2-gated. UI and real data results require restored Staging verification. PR #71 adds audit triggers for wallet transactions/balances and provider-setting changes; it is draft and pending CI. |
| Teacher analytics | teacher-wide analytics migration | Reviewed | Teacher aggregation is limited by course analytics capability; admin path checks AAL2. Validate assigned-course edge cases with fixtures and real Staging accounts. |
| Platform statistics | platform assistant statistics migration/Worker | Reviewed | Fix targets actual Auth users and exam-attempt counts instead of empty labels. Verify live values only against a safe Staging database. |
| Paymob | existing payment Edge Function and signed webhook | Reviewed | Existing Paymob Intention/Unified Checkout and signed webhook remain the provider path. No payment keys changed. |
| Fawry | new dormant Edge Functions/shared signature code and migration in PR #68 | Reviewed | Fawry is a distinct PayAtFawry provider, not a Paymob submethod and not mobile wallet. The checkout handler no longer self-enables the database setting; migration seeds it false and activation needs the separate DB and server switches. A test-file syntax error was identified from CI and fixed in the branch; rerun CI is required. No credentials, checkout UI, DB writes, or deployment. Actual Fawry Staging merchant test remains outstanding. |
| Worker query privacy | seven live Worker settings and six Wrangler configs in PR #69 | Reviewed | `redact_query_string=true` verified live on all seven Workers; invocation logs/sampling unchanged; traces remain disabled. PR #69's four CI checks completed successfully; it remains unmerged. |
| Video registry automation | daily refresh workflow in PR #65 | Reviewed | Registry validation now precedes auto-commit so an incomplete discovery run cannot commit a partial registry. Updated CI passed. |
| Video retry path | PR #66 | Reviewed | Transient directory fetch retry test/build checks passed. |
| Windows desktop | `electron/main.cjs`, `electron/preload.cjs` | Partial review | Existing yt-dlp path is distinct from web extraction; no encrypted download implementation exists. Do not write plaintext downloads or alter playback as a shortcut. |
| Android | accessible GitHub repositories | Availability checked | Only `ED-ALL` and `edall` repositories were returned; no Android source repository is currently connected. Native NewPipe work is blocked on source access. |
| Backup/restore | `docs/operations/backups-monitoring-restore.md` | Documentation reviewed | Runbook exists; no actual backup/restore evidence, PITR receipt, Storage backup, RPO or RTO was available. Release gate remains open. |
| Repository environment | `.env`, `.gitignore`, repository visibility | Partial review | Public tracked `.env` contains client Publishable-key/URL/project ID configuration only; no service-role or payment credentials were found. Move values to deployment variables and add `.env.example` before untracking it. |


## Database-ledger evidence (read-only, consolidated query)

- Production `supabase_migrations.schema_migrations` exists and returned 21 rows in the inspected snapshot; latest version was `20260730163017`.
- The main branch contains 43 SQL migration files. 22 November 2026 source files have no corresponding versions in the observed ledger.
- The live schema already includes some objects described by the November source migrations. Therefore, the 22 are not safely classifiable as entirely unapplied; schema effects may have been applied outside the ledger or only partially applied.
- No migration write was attempted. Reconcile source file DDL, live catalogs and recorded versions before applying anything.
- PR #71 proposes the missing wallet/provider audit triggers but remains source-only.

## Findings and priority

| Priority | Finding | Impact | Required action |
|---|---|---|---|
| P1 | Old Staging project has no expected migration ledger and differs from Production | Cannot safely prove migrations or test real data writes | Recreate/restore a dedicated isolated Staging project; compare schema and full migration ledger |
| P1 | No backup/restore evidence was produced | Production rollback/recovery is not proven | Verify provider retention/PITR, encrypted backup, private Storage coverage, restore drill, RPO/RTO |
| P1 | Migration source/remote-ledger reconciliation is incomplete | Merging several SQL PRs risks applying already-present or partially-applied objects | Produce a per-migration status matrix before any remote SQL writes |
| P1 | Native encrypted downloads are not implemented in Windows; Android repository unavailable | Offline secure downloads are incomplete | Design authenticated entitlement + OS/Keystore protected key lifecycle; implement Windows and Android separately |
| P2 | `.env` remains tracked in a public repository | Unnecessary local environment coupling, even though inspected values are client-public | Confirm deployed build variables, add placeholder example, then untrack `.env` |
| P2 | Fawry has no merchant Staging credentials/callback registration | Code is unit-tested but not provider-end-to-end verified | Obtain merchant sandbox access, configure secrets in secure provider console, register callback, execute test matrix |
| P2 | PR #69 full security CI is still running at this snapshot | Privacy config PR not yet fully validated | Wait for clean local Supabase migration reset/tests and complete CI before making it ready |
| P2 | PR #64 would enable 5% sampled traces | Ongoing telemetry can increase cost and data collection | Keep Draft until trace data policy and cost are approved |

## Deliberately not done

- No Production or old-Staging SQL writes.
- No merging of feature PRs into `main`.
- No Cloudflare Worker deployments.
- No enabling of Paymob or Fawry switches; existing Paymob behavior was preserved.
- No activation of trace sampling.
- No desktop/Android extractor changes.
- No claim of successful real Staging restore or live payment test.

## Next validation sequence

1. Complete the migration drift and backup/restore gates in the companion schema inventory.
2. Reconcile the PR migrations and combine all required SQL into one reviewed Staging migration batch.
3. Run the complete guest/student/teacher/admin AAL1/AAL2/service-role matrix against restored Staging.
4. Verify certificates, attendance, wallet ledger, Fawry sandbox callbacks, and student history on that database.
5. Verify per-Worker runtime health and video playback on staging.
6. Produce a release report and obtain separate Production merge, migration, and deployment approvals.
