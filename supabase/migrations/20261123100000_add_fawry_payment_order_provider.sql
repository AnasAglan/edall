-- Add a separate, server-only order creator for Fawry.
-- The existing Paymob create_payment_order() and provider_code='primary' flow remain unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_payment_order_for_provider(
  _user_id uuid,
  _course_id uuid,
  _idempotency_key text,
  _provider_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _price numeric(12,2);
  _provider public.payment_provider_settings%ROWTYPE;
  _order public.payment_orders%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  IF _user_id IS NULL OR _course_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_ORDER_OWNER';
  END IF;
  IF _provider_code IS DISTINCT FROM 'fawry' THEN
    RAISE EXCEPTION 'UNSUPPORTED_PAYMENT_PROVIDER';
  END IF;
  IF length(COALESCE(_idempotency_key,'')) NOT BETWEEN 16 AND 120 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(_user_id::text),
    pg_catalog.hashtext(_course_id::text)
  );

  SELECT * INTO _provider
  FROM public.payment_provider_settings
  WHERE provider_code = 'fawry'
    AND enabled = true
    AND secret_binding_name = 'FAWRY_SECURE_KEY';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_PROVIDER_NOT_CONFIGURED';
  END IF;

  SELECT c.price INTO _price FROM public.courses c WHERE c.id = _course_id;
  IF NOT FOUND OR _price IS NULL OR _price <= 0 THEN
    RAISE EXCEPTION 'COURSE_NOT_PAYABLE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.user_id = _user_id AND e.course_id = _course_id
  ) THEN
    RAISE EXCEPTION 'ALREADY_ENROLLED';
  END IF;

  -- There can be only one open payment order per student/course across providers.
  SELECT * INTO _order
  FROM public.payment_orders
  WHERE user_id = _user_id
    AND course_id = _course_id
    AND status IN ('created','pending')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF _order.provider <> 'fawry' THEN
      RAISE EXCEPTION 'OPEN_PAYMENT_ORDER_FOR_DIFFERENT_PROVIDER';
    END IF;
    RETURN jsonb_build_object(
      'order_id',_order.id,'status',_order.status,'amount',_order.amount,
      'currency',_order.currency,'provider',_order.provider,
      'provider_reference',_order.provider_reference,'metadata',_order.metadata,
      'updated_at',_order.updated_at
    );
  END IF;

  INSERT INTO public.payment_orders(
    user_id,course_id,amount,currency,provider,status,idempotency_key
  )
  VALUES (_user_id,_course_id,_price,'EGP','fawry','created',_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO _order;

  IF NOT FOUND THEN
    SELECT * INTO _order
    FROM public.payment_orders
    WHERE idempotency_key = _idempotency_key;
  END IF;

  IF NOT FOUND
     OR _order.user_id IS DISTINCT FROM _user_id
     OR _order.course_id IS DISTINCT FROM _course_id
     OR _order.provider IS DISTINCT FROM 'fawry' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT';
  END IF;

  RETURN jsonb_build_object(
    'order_id',_order.id,'status',_order.status,'amount',_order.amount,
    'currency',_order.currency,'provider',_order.provider,
    'provider_reference',_order.provider_reference,'metadata',_order.metadata,
    'updated_at',_order.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_payment_order_for_provider(uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_payment_order_for_provider(uuid,uuid,text,text)
  TO service_role;

-- Prevent the legacy Paymob order RPC from reusing a Fawry order (or vice versa).
-- Keep Paymob's provider_code='primary' and existing payment flow unchanged.
CREATE OR REPLACE FUNCTION public.create_payment_order(_course_id uuid,_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _price numeric(12,2);
  _provider public.payment_provider_settings%ROWTYPE;
  _order public.payment_orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF length(COALESCE(_idempotency_key,'')) NOT BETWEEN 16 AND 120 THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(auth.uid()::text),
    pg_catalog.hashtext(_course_id::text)
  );

  SELECT * INTO _provider FROM public.payment_provider_settings
  WHERE provider_code='primary' AND enabled=true;
  IF NOT FOUND OR _provider.secret_binding_name IS NULL OR btrim(_provider.secret_binding_name)='' THEN
    RAISE EXCEPTION 'PAYMENT_PROVIDER_NOT_CONFIGURED';
  END IF;

  SELECT c.price INTO _price FROM public.courses c WHERE c.id=_course_id;
  IF NOT FOUND OR _price IS NULL OR _price<=0 THEN RAISE EXCEPTION 'COURSE_NOT_PAYABLE'; END IF;
  IF EXISTS (SELECT 1 FROM public.enrollments e WHERE e.user_id=auth.uid() AND e.course_id=_course_id) THEN
    RAISE EXCEPTION 'ALREADY_ENROLLED';
  END IF;

  SELECT * INTO _order
  FROM public.payment_orders
  WHERE user_id=auth.uid()
    AND course_id=_course_id
    AND status IN ('created','pending')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF _order.provider <> _provider.provider_code THEN
      RAISE EXCEPTION 'OPEN_PAYMENT_ORDER_FOR_DIFFERENT_PROVIDER';
    END IF;
    RETURN jsonb_build_object(
      'order_id',_order.id,'status',_order.status,'amount',_order.amount,
      'currency',_order.currency,'checkout_url',_order.checkout_url,
      'provider',_order.provider,'updated_at',_order.updated_at
    );
  END IF;

  INSERT INTO public.payment_orders(user_id,course_id,amount,currency,provider,status,idempotency_key)
  VALUES (auth.uid(),_course_id,_price,'EGP',_provider.provider_code,'created',_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO _order;

  IF NOT FOUND THEN
    SELECT * INTO _order FROM public.payment_orders WHERE idempotency_key=_idempotency_key;
  END IF;
  IF NOT FOUND OR _order.user_id<>auth.uid() OR _order.course_id<>_course_id
     OR _order.provider<>_provider.provider_code THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT';
  END IF;

  RETURN jsonb_build_object(
    'order_id',_order.id,'status',_order.status,'amount',_order.amount,
    'currency',_order.currency,'checkout_url',_order.checkout_url,
    'provider',_order.provider,'updated_at',_order.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_payment_order(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_payment_order(uuid,text) TO authenticated;


-- Register Fawry as an available but disabled provider. Checkout requests must
-- never turn this switch on; a separate administrator action and server secret
-- are both required before the provider can accept payments.
INSERT INTO public.payment_provider_settings (
  provider_code, display_name, enabled, currency, public_config, secret_binding_name
)
VALUES (
  'fawry',
  'Fawry',
  false,
  'EGP',
  '{"checkout":"PayAtFawry-reference","environment":"staging"}'::jsonb,
  'FAWRY_SECURE_KEY'
)
ON CONFLICT (provider_code) DO UPDATE
SET enabled = false,
    updated_at = now();

COMMIT;
