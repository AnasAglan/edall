# Dormant Paymob and Fawry payment providers

## Current state

**Neither provider is activated by this change.** The migration seeds Fawry with `enabled = false`; the checkout handler cannot enable it. No feature flag or merchant credential is configured, and no payment order, webhook event, or deployment is written by this source-only change.

- Paymob remains the existing provider on `provider_code = primary`, using its current Intention / Unified Checkout path and signed Paymob webhook.
- Fawry is a separate provider on `provider_code = fawry`, using the PayAtFawry reference-number API. It is not an extra Paymob integration ID and is not a mobile-wallet channel.
- No student checkout UI is added, so neither method is presented to students.

## Fawry server-side secrets (not configured now)

| Secret | Purpose |
|---|---|
| `FAWRY_PROVIDER_ENABLED` | Exact string `true` is required, alongside an administrator-controlled `payment_provider_settings.enabled = true` row; anything else keeps it disabled |
| `FAWRY_MERCHANT_CODE` | Fawry merchant code |
| `FAWRY_SECURE_KEY` | Fawry server-side SHA-256 signing key |
| `FAWRY_ENVIRONMENT` | `staging` by default; exact `production` chooses the production endpoint |

Never put these values in browser code, repository files, `.env`, GitHub Actions logs, or chat. Store them only in the Supabase Edge Function secret manager.

The existing Paymob secrets and `PAYMOB_PROVIDER_ENABLED` switch are unchanged.

## Server flow

1. An authenticated server request supplies only a course ID and idempotency key. The amount is read and validated from the database, never trusted from the browser.
2. A service-role-only SQL function creates/reuses a Fawry order. A cross-provider open-order guard prevents a second Paymob/Fawry order for the same student/course.
3. The Edge Function requests a PayAtFawry reference using Fawry's documented charge endpoint, with a server-generated numeric merchant reference and SHA-256 request signature.
4. The charge response signature and server-side amount are verified before the Fawry reference is returned to the caller.
5. The public Fawry webhook has Supabase JWT verification disabled but independently verifies Fawry Server Notification V2's SHA-256 message signature. Only a signed `PAID` event can call the existing idempotent `fulfill_payment_order` RPC.
6. Duplicate callback delivery is safe. Refund notifications are recorded but do not silently revoke enrollment; refunds need a separate business workflow.

## Merchant dashboard prerequisite

Fawry requires the merchant callback URL to be registered with its operations team during account setup. Register the environment-specific endpoint:

`https://<SUPABASE-PROJECT-URL>/functions/v1/fawry-webhook`

Adding `orderWebHookUrl` to a charge request does not replace merchant-account callback registration.

## Activation and release checklist (not performed)

1. Confirm the ED-ALL merchant account is approved for PayAtFawry and obtain Staging merchant credentials.
2. Configure only Staging secrets and register the Staging callback URL with Fawry.
3. Verify charge request/response signatures, callback signatures, wrong signature, duplicate callback, pending, expiry, cancellation, amount mismatch, and Fawry-to-Paymob open-order conflicts.
4. Reconcile the paid database order, payment ledger, audit event, and enrollment.
5. Complete backup/restore and Staging isolation checks.
6. Obtain separate explicit approval before enabling Fawry in Production.

Paymob remains on its separate existing checkout path. Do not merge this provider into Paymob's `PAYMOB_INTEGRATION_IDS`.
