-- Audit every wallet balance/ledger mutation and payment provider configuration change.
-- This is additive and does not alter balances, transactions, or provider activation.
BEGIN;

CREATE OR REPLACE FUNCTION public.audit_wallet_transaction_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _row jsonb;
  _entity_id uuid;
  _event text;
  _details jsonb;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  _entity_id := (_row ->> 'id')::uuid;
  _event := 'wallet_transaction_' || lower(TG_OP);
  _details := jsonb_build_object(
    'user_id', _row ->> 'user_id',
    'amount', _row ->> 'amount',
    'type', _row ->> 'type',
    'created_by', _row ->> 'created_by',
    'operation', lower(TG_OP)
  );

  PERFORM public.write_platform_audit_event(
    _event, 'wallet_transactions', _entity_id, NULL, _details
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_wallet_transaction_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_wallet_transaction_mutations ON public.wallet_transactions;
CREATE TRIGGER audit_wallet_transaction_mutations
AFTER INSERT OR UPDATE OR DELETE ON public.wallet_transactions
FOR EACH ROW EXECUTE FUNCTION public.audit_wallet_transaction_change();


CREATE OR REPLACE FUNCTION public.audit_wallet_balance_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _user_id uuid;
  _old_balance numeric;
  _new_balance numeric;
  _event text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.balance IS NOT DISTINCT FROM OLD.balance THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND COALESCE(NEW.balance,0) = 0 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    _user_id := OLD.user_id;
    _old_balance := OLD.balance;
    _new_balance := NULL;
  ELSE
    _user_id := NEW.user_id;
    _old_balance := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.balance END;
    _new_balance := NEW.balance;
  END IF;
  _event := 'wallet_balance_' || lower(TG_OP);

  PERFORM public.write_platform_audit_event(
    _event,
    'wallets',
    _user_id,
    NULL,
    jsonb_build_object(
      'user_id', _user_id,
      'previous_balance', _old_balance,
      'new_balance', _new_balance,
      'operation', lower(TG_OP)
    )
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_wallet_balance_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_wallet_balance_mutations ON public.wallets;
CREATE TRIGGER audit_wallet_balance_mutations
AFTER INSERT OR UPDATE OR DELETE ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.audit_wallet_balance_change();


CREATE OR REPLACE FUNCTION public.audit_payment_provider_setting_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _row jsonb;
  _old jsonb;
  _entity_id uuid;
  _event text;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_OP = 'UPDATE' THEN
    _old := to_jsonb(OLD);
    IF (_row -> 'provider_code') IS NOT DISTINCT FROM (_old -> 'provider_code')
       AND (_row -> 'enabled') IS NOT DISTINCT FROM (_old -> 'enabled')
       AND (_row -> 'secret_binding_name') IS NOT DISTINCT FROM (_old -> 'secret_binding_name')
       AND (_row -> 'currency') IS NOT DISTINCT FROM (_old -> 'currency')
       AND (_row -> 'display_name') IS NOT DISTINCT FROM (_old -> 'display_name') THEN
      RETURN NEW;
    END IF;
  END IF;

  _entity_id := (_row ->> 'id')::uuid;
  _event := 'payment_provider_setting_' || lower(TG_OP);

  -- Record only the binding NAME. Never log a credential value or provider payload.
  PERFORM public.write_platform_audit_event(
    _event,
    'payment_provider_settings',
    _entity_id,
    NULL,
    jsonb_build_object(
      'provider_code', _row ->> 'provider_code',
      'enabled', _row ->> 'enabled',
      'currency', _row ->> 'currency',
      'secret_binding_name', _row ->> 'secret_binding_name',
      'operation', lower(TG_OP)
    )
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.audit_payment_provider_setting_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_payment_provider_setting_mutations ON public.payment_provider_settings;
CREATE TRIGGER audit_payment_provider_setting_mutations
AFTER INSERT OR UPDATE OR DELETE ON public.payment_provider_settings
FOR EACH ROW EXECUTE FUNCTION public.audit_payment_provider_setting_change();

COMMIT;
