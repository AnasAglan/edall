# ED-ALL Live Schema and Release Inventory

**Captured:** 2026-11-22 (read-only inspection)
**Repository baseline:** main `24bf4555df50203fd8c999112f3f0b64d981a77d`
**Environments:** Lovable Production and separate Lovable Staging projects

## Current findings

### Runtime and database access

| Item | Production | Staging |
|---|---:|---:|
| Database | Supabase / PostgreSQL 17.x (minor version not confirmed) | Supabase / PostgreSQL 17.x (minor version not confirmed) |
| Database enabled | Yes | Yes |
| Public base tables | 35 | 35 |
| Public columns | 255 | 255 |
| Public RLS policies | 79 | 79 |
| Public tables with RLS enabled | 35 | 35 |
| Auth users | 16 | 0 |
| Profiles | 12 | 0 |
| Auth users without profiles | 4 | 0 |
| Auth users without a role row | 0 | 0 |
| Auth users with unconfirmed email | 4 | 0 |
| `supabase_migrations.schema_migrations` | Exists | **Missing** |

The table-column, policy, public-function, and enum signature hashes were identical between Production and Staging at inspection time. This establishes broad schema parity for those inventories, not proof that every constraint, grant, trigger, Storage policy, or data value is equivalent.

Trigger signature hashes differ:
- Production: `949b0611e57502c1e925ed4ee533168f`
- Staging: `86bd65b120f2816b024ebffcbc2d02e0`

The exact trigger-by-trigger diff remains open because the Lovable free-plan database action allowance was exhausted during this read-only inventory. No further database query should be attempted until the tool limit resets. The difference is not assumed to be harmless.

### Migration history

- The repository contains 43 SQL migration files.
- Production has 21 rows in `supabase_migrations.schema_migrations`; the latest recorded version observed was `20260730163017`.
- Staging has no `supabase_migrations.schema_migrations` relation.
- Repository migrations after July 2026 include November security, learning-suite, payment, audit, MFA, and account-provisioning work.
- Both live environments currently expose the same observed counts and signature hashes for columns, policies, functions, and enums, and both already contain Learning Space tables and admin MFA functions.
- It is therefore unsafe to infer that later repository migrations are all unapplied, or that they are all fully applied. Effects may have been applied outside the migration ledger.

**Status:** migration-to-live-object reconciliation is `UNKNOWN / INCOMPLETE` for both projects. No migration repair, `db push`, SQL DDL, or live write has been performed by this audit.

### Accounts and admin user listing

Production has 16 Auth users but 12 profiles, leaving four Auth users invisible to a directory implemented as `profiles SELECT *`. The existing `admin_search_users` is AAL2-gated but also starts from `profiles`, so it cannot reveal those orphaned Auth accounts.

The repair branch adds a new AAL2-protected RPC, `public.admin_list_users(text,integer,integer)`, which starts from `auth.users`, left-joins `profiles`, left-joins user roles, returns explicit missing-profile/missing-role states, applies bounded pagination, and does not return password hashes or raw Auth metadata. This is source code only; the migration has not been applied to either live DB.

### Backups and restore

`docs/operations/backups-monitoring-restore.md` is a runbook, not proof of configured scheduled backups or a successful restore drill.

**Status:** provider retention/PITR configuration, encrypted external backup, Storage-object backup, and restore drill remain `UNKNOWN / NOT VERIFIED`. A Production schema change remains blocked until a successful Staging restore and recovery test are evidenced.

### Cloudflare Workers

Cloudflare inspection previously found seven deployed scripts:
- `edall`
- `edall-assistant`
- `edall-assistant-staging`
- `edall-invidious-extractor`
- `edall-invidious-extractor-staging`
- `edall-video-media-proxy`
- `edall-video-media-proxy-staging`

Cloudflare showed Workers Logs enabled and Traces disabled on the inspected scripts. This is a metadata finding, not proof of runtime health. No Worker configuration or deployment was changed during this inventory.

### Video architecture invariants

- Web platform: Piped + Invidious + Plyr.
- Windows desktop: yt-dlp.
- Android: NewPipe.
- No extraction or playback implementation was moved between these environments.
- The Android project source is not present in `AnasAglan/edall`; Android-native changes cannot be verified or implemented until the separate source repository is made available.

## Release status

| Gate | Status |
|---|---|
| Read-only schema counts/signatures captured | Complete |
| Trigger-level Production/Staging comparison | Open — query allowance exhausted |
| Migration history / object-level reconciliation | Open — unknown |
| Backup retention configuration | Open — not verified |
| Storage backup configuration | Open — not verified |
| Staging restore drill | Open — not verified |
| New admin directory RPC | Added on repair branch; not applied |
| Admin MFA login fix | Added on repair branch; CI validation running |
| Production SQL write/deployment | Not performed |

No Production or Staging database data has been changed by these steps.