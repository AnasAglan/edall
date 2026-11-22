-- Verifies server-side audit coverage for wallet and payment-provider changes.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(11);

SELECT ok(to_regprocedure('public.audit_wallet_transaction_change()') IS NOT NULL,
  'wallet transaction audit trigger function exists');
SELECT ok(to_regprocedure('public.audit_wallet_balance_change()') IS NOT NULL,
  'wallet balance audit trigger function exists');
SELECT ok(to_regprocedure('public.audit_payment_provider_setting_change()') IS NOT NULL,
  'payment provider settings audit trigger function exists');

SELECT ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_wallet_transaction_mutations'
  AND tgrelid='public.wallet_transactions'::regclass AND NOT tgisinternal),
  'wallet transaction inserts, updates, and deletes are audited');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_wallet_balance_mutations'
  AND tgrelid='public.wallets'::regclass AND NOT tgisinternal),
  'wallet balance changes are audited');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_payment_provider_setting_mutations'
  AND tgrelid='public.payment_provider_settings'::regclass AND NOT tgisinternal),
  'payment provider configuration changes are audited');

SELECT ok(EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.audit_wallet_transaction_change()'::regprocedure
  AND p.prosecdef AND 'search_path=""' = ANY(p.proconfig)),
  'wallet transaction audit function is SECURITY DEFINER with empty search path');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.audit_wallet_balance_change()'::regprocedure
  AND p.prosecdef AND 'search_path=""' = ANY(p.proconfig)),
  'wallet balance audit function is SECURITY DEFINER with empty search path');
SELECT ok(EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.audit_payment_provider_setting_change()'::regprocedure
  AND p.prosecdef AND 'search_path=""' = ANY(p.proconfig)),
  'provider settings audit function is SECURITY DEFINER with empty search path');

SELECT ok(
  NOT has_function_privilege('anon','public.audit_wallet_transaction_change()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.audit_wallet_transaction_change()','EXECUTE')
  AND NOT has_function_privilege('anon','public.audit_wallet_balance_change()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.audit_wallet_balance_change()','EXECUTE')
  AND NOT has_function_privilege('anon','public.audit_payment_provider_setting_change()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.audit_payment_provider_setting_change()','EXECUTE'),
  'application roles cannot execute trigger-only audit functions directly'
);

SELECT ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='platform_audit_log_immutable'
  AND tgrelid='public.platform_audit_log'::regclass AND NOT tgisinternal),
  'immutable audit log protection remains installed');

SELECT * FROM finish();
ROLLBACK;
