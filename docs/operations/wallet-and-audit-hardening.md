Wallet and payment-provider audit hardening

This additive migration creates immutable audit events for wallet transaction changes, wallet balance changes, and payment-provider configuration/activation changes. The details record user, signed amount, transaction type, before/after balance, provider, enabled state and binding name only; free-text notes, secret values and arbitrary provider payloads are deliberately excluded.

All trigger functions are SECURITY DEFINER with an empty search path, and direct execution is revoked from PUBLIC, anon and authenticated. Events flow through the existing write_platform_audit_event function and the existing immutable platform_audit_log trigger.

The migration does not change balances or transactions, enable a payment provider, or write secrets. It is source-only until applied to an isolated restored Staging database. Production release remains blocked by the unresolved migration-ledger drift and missing Staging restore proof.
