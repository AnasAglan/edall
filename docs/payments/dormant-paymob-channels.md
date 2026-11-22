# Dormant Paymob payment channels

This change prepares two optional checkout channels without activating them in ED-ALL:

- Mobile-wallet payments
- Fawry payments

The existing provider master switch remains authoritative:
- `PAYMOB_PROVIDER_ENABLED` must be explicitly set to `true` before Paymob checkout can run at all.
- The optional channels below remain disabled unless their own server-side flag is exactly `true`.

## Optional server-side variables

| Channel | Enable flag | Integration ID |
|---|---|---|
| Mobile wallet | `PAYMOB_MOBILE_WALLET_ENABLED` | `PAYMOB_MOBILE_WALLET_INTEGRATION_ID` |
| Fawry | `PAYMOB_FAWRY_ENABLED` | `PAYMOB_FAWRY_INTEGRATION_ID` |

Do not add these values to browser code, `.env`, the repository, GitHub Actions logs, or chat. Configure them only as Supabase Edge Function secrets after obtaining the correct integration IDs from the Paymob merchant dashboard.

## Current state

Both optional channels are **off by default**. Supplying an integration ID without the matching enable flag does not add it to checkout. Setting an enable flag without a valid integration ID fails closed. The existing `PAYMOB_PROVIDER_ENABLED`, merchant API credentials, HMAC secret, payment-order validation, signed webhook verification, amount/currency comparison, and idempotent fulfillment remain required.

No payment setting, secret, database row, live webhook, Production environment, or deployment is changed by this source-code preparation.

## Activation checklist (not performed)

1. Confirm the merchant account supports the intended method and obtain its integration ID from Paymob.
2. Configure the ID and enable flag as Supabase Edge Function secrets in Staging only.
3. Verify the unified checkout presents the right method and exercise successful, pending, failed, duplicate, and invalid-HMAC callbacks.
4. Reconcile the paid order and enrollment through the existing server-side fulfillment path.
5. Review the complete Staging test matrix and obtain a separate explicit approval before enabling either method in Production.
