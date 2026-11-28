# Offline download authorization deployment

The `authorize-offline-download` Edge Function verifies a signed-in user's access to the exact lesson and YouTube video using the caller's JWT and existing Row Level Security. It does not need a database migration and must not use a service-role key.

## Separate Supabase targets

| Environment | Supabase project ref | Deployment |
| --- | --- | --- |
| Staging | `atpltvpwfammcnxcpvop` | Automatic after relevant changes on `main`, or manual via **Deploy Android offline authorization to Staging** |
| Production | `iuaddjoofgrirzslzqfy` | Manual only via **Deploy offline authorization to Production** |

Never substitute one project ref for the other. The production page uses the Production Supabase URL; a Staging deployment does not make the Production app's function available.

## Required GitHub secret

Add `SUPABASE_ACCESS_TOKEN` in repository **Settings → Secrets and variables → Actions**, or add an environment-scoped secret with the same name to the matching GitHub environment. Do not commit the value, print it in logs, or send it in chat.

The token must be authorized to deploy Edge Functions to the target project(s). If using separate tokens, use environment-scoped secrets for `staging` and `production` and adjust the workflow secret names before dispatch.

## Safe order

1. Add the deployment credential in GitHub.
2. Run or re-run **Deploy Android offline authorization to Staging**. Confirm its endpoint check passes.
3. Test an authorized and an unauthorized lesson with real Staging accounts. The existing workflow's unauthenticated GET check verifies reachability only; it does not prove entitlement logic.
4. Configure GitHub's `production` Environment with a required reviewer before using the Production workflow.
5. Dispatch **Deploy offline authorization to Production** only after Staging checks pass. Set `confirm_production_deploy` to `true`; otherwise the deploy job is skipped.
6. Confirm the Production endpoint rejects unauthenticated requests and test the function with a real authorized Production account before releasing the Windows download UI.

Both workflows use `--use-api --yes` so the CLI can bundle without Docker and complete its hosted-mutation confirmation non-interactively. They deploy only `authorize-offline-download`, never all Edge Functions.

## Current release limitations

- The GitHub secret is not configured yet; deployments cannot proceed until it is added.
- The Staging workflow's HTTP smoke check is not a substitute for authenticated entitlement tests.
- A successful Staging deploy does not deploy the function to Production.
- Windows encrypted downloads remain unreleased until the Production function is deployed and a real Windows 10 packaging/playback smoke test passes.
