-- Prevent parallel/repeated checkout attempts from creating multiple payable orders
-- for the same student/course. The DB serializes order creation by user+course.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_one_open_per_user_course_idx
ON public.payment_orders(user_id,course_id)
WHERE status IN ('created','pending');

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
  IF NOT FOUND OR _order.user_id<>auth.uid() OR _order.course_id<>_course_id THEN
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

COMMIT;
