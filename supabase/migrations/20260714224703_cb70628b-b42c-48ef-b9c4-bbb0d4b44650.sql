
-- 1) Add price to courses
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS price numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.courses ADD CONSTRAINT courses_price_nonneg CHECK (price >= 0);

-- 2) Add is_free to lessons
ALTER TABLE public.lessons ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;

-- 3) Add public_id to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS public_id text UNIQUE;

-- Generator
CREATE OR REPLACE FUNCTION public.generate_public_id()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  _candidate text;
  _exists boolean;
BEGIN
  LOOP
    _candidate := lpad((floor(random() * 90000) + 10000)::int::text, 5, '0');
    SELECT EXISTS(SELECT 1 FROM public.profiles WHERE public_id = _candidate) INTO _exists;
    EXIT WHEN NOT _exists;
  END LOOP;
  RETURN _candidate;
END;
$$;

-- Backfill existing profiles
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE public_id IS NULL LOOP
    UPDATE public.profiles SET public_id = public.generate_public_id() WHERE id = r.id;
  END LOOP;
END $$;

-- 4) site_settings key/value store
CREATE TABLE IF NOT EXISTS public.site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT ALL ON public.site_settings TO service_role;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view site settings" ON public.site_settings;
CREATE POLICY "Anyone can view site settings" ON public.site_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage site settings ins" ON public.site_settings;
CREATE POLICY "Admins manage site settings ins" ON public.site_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Admins manage site settings upd" ON public.site_settings;
CREATE POLICY "Admins manage site settings upd" ON public.site_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Admins manage site settings del" ON public.site_settings;
CREATE POLICY "Admins manage site settings del" ON public.site_settings FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.site_settings (key, value) VALUES
  ('telegram', jsonb_build_object(
    'qr_url', '/__l5e/assets-v1/e8579efa-772a-483c-84c5-1cee7151be27/telegram-qr.png',
    'chat_url', 'https://t.me/anasaglan'
  ))
ON CONFLICT (key) DO NOTHING;

-- 5) purchase_course RPC
CREATE OR REPLACE FUNCTION public.purchase_course(_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _price numeric(12,2);
  _title text;
  _created_by uuid;
  _balance numeric(12,2);
  _new_balance numeric(12,2);
  _already boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT price, title, created_by INTO _price, _title, _created_by FROM public.courses WHERE id = _course_id;
  IF _price IS NULL THEN
    RAISE EXCEPTION 'COURSE_NOT_FOUND';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.enrollments WHERE user_id = _uid AND course_id = _course_id) INTO _already;
  IF _already THEN
    RETURN jsonb_build_object('ok', true, 'already_enrolled', true);
  END IF;

  IF _price > 0 THEN
    INSERT INTO public.wallets (user_id, balance) VALUES (_uid, 0) ON CONFLICT (user_id) DO NOTHING;
    SELECT balance INTO _balance FROM public.wallets WHERE user_id = _uid FOR UPDATE;
    IF _balance < _price THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING DETAIL = jsonb_build_object('balance', _balance, 'price', _price)::text;
    END IF;
    UPDATE public.wallets SET balance = balance - _price WHERE user_id = _uid RETURNING balance INTO _new_balance;
    INSERT INTO public.wallet_transactions (user_id, amount, type, note, created_by)
      VALUES (_uid, -_price, 'purchase', 'شراء كورس: ' || _title, _uid);
  END IF;

  INSERT INTO public.enrollments (user_id, course_id) VALUES (_uid, _course_id) ON CONFLICT DO NOTHING;

  IF _created_by IS NOT NULL AND _created_by <> _uid THEN
    INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (_created_by, 'طالب جديد', 'انضم طالب إلى كورس "' || _title || '"', 'enrollment');
  END IF;

  IF _price > 0 THEN
    INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (_uid, 'تم شراء الكورس', 'تم خصم ' || _price::text || ' لشراء كورس "' || _title || '". الرصيد الحالي: ' || _new_balance::text, 'wallet');
  END IF;

  RETURN jsonb_build_object('ok', true, 'price', _price, 'new_balance', COALESCE(_new_balance, _balance));
END;
$$;

GRANT EXECUTE ON FUNCTION public.purchase_course(uuid) TO authenticated;

-- 6) Update admin_credit_wallet to prevent negative balance
CREATE OR REPLACE FUNCTION public.admin_credit_wallet(_user_id uuid, _amount numeric, _note text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_balance numeric;
  _current numeric;
  _admin uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_admin, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount = 0 THEN
    RAISE EXCEPTION 'Amount must not be zero';
  END IF;

  INSERT INTO public.wallets (user_id, balance) VALUES (_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO _current FROM public.wallets WHERE user_id = _user_id FOR UPDATE;
  IF _current + _amount < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  UPDATE public.wallets
     SET balance = balance + _amount
   WHERE user_id = _user_id
   RETURNING balance INTO _new_balance;

  INSERT INTO public.wallet_transactions (user_id, amount, type, note, created_by)
  VALUES (_user_id, _amount, CASE WHEN _amount > 0 THEN 'topup' ELSE 'adjust' END, _note, _admin);

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (_user_id,
    CASE WHEN _amount > 0 THEN 'تم شحن محفظتك' ELSE 'تم تعديل رصيد محفظتك' END,
    CASE WHEN _amount > 0
         THEN 'تم إضافة ' || _amount::text || ' إلى رصيدك. الرصيد الحالي: ' || _new_balance::text
         ELSE 'تم خصم ' || abs(_amount)::text || ' من رصيدك. الرصيد الحالي: ' || _new_balance::text
    END,
    'wallet');

  RETURN _new_balance;
END;
$function$;

-- 7) Update get_courses_sorted_by_enrollment to include price
DROP FUNCTION IF EXISTS public.get_courses_sorted_by_enrollment(integer, integer);
CREATE OR REPLACE FUNCTION public.get_courses_sorted_by_enrollment(_offset integer, _limit integer)
 RETURNS TABLE(id uuid, title text, description text, image_url text, created_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone, price numeric, enrollment_count bigint, lesson_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    c.id, c.title, c.description, c.image_url, c.created_by, c.created_at, c.updated_at, c.price,
    COALESCE(COUNT(DISTINCT e.id), 0) AS enrollment_count,
    COALESCE(COUNT(DISTINCT l.id), 0) AS lesson_count
  FROM public.courses c
  LEFT JOIN public.enrollments e ON e.course_id = c.id
  LEFT JOIN public.lessons l ON l.course_id = c.id
  GROUP BY c.id
  ORDER BY enrollment_count DESC, c.created_at DESC
  OFFSET _offset
  LIMIT _limit;
$function$;

-- 8) Update setup_new_user to assign public_id
CREATE OR REPLACE FUNCTION public.setup_new_user(_user_id uuid, _name text, _email text, _requested_role text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    _user_count integer;
    _target_role public.app_role;
    _normalized_role text;
    _has_role boolean;
    _pid text;
BEGIN
    _pid := public.generate_public_id();
    INSERT INTO public.profiles (id, name, email, public_id)
    VALUES (_user_id, COALESCE(NULLIF(trim(_name), ''), _email), _email, _pid)
    ON CONFLICT (id) DO UPDATE
    SET name = COALESCE(EXCLUDED.name, public.profiles.name),
        email = COALESCE(EXCLUDED.email, public.profiles.email),
        public_id = COALESCE(public.profiles.public_id, EXCLUDED.public_id);

    INSERT INTO public.wallets (user_id, balance) VALUES (_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id) INTO _has_role;

    IF _has_role THEN
        IF _requested_role IS NOT NULL AND NOT public.has_role(_user_id, 'admin'::public.app_role) THEN
            _normalized_role := lower(trim(_requested_role));
            IF _normalized_role IN ('teacher', 'student') THEN
                DELETE FROM public.user_roles
                WHERE user_id = _user_id
                  AND role IN ('teacher'::public.app_role, 'student'::public.app_role);
                INSERT INTO public.user_roles (user_id, role)
                VALUES (_user_id, _normalized_role::public.app_role)
                ON CONFLICT (user_id, role) DO NOTHING;
            END IF;
        END IF;
        RETURN;
    END IF;

    SELECT count(*) INTO _user_count FROM public.user_roles;
    IF _user_count = 0 THEN
        _target_role := 'admin'::public.app_role;
    ELSE
        _normalized_role := lower(trim(COALESCE(_requested_role, 'student')));
        IF _normalized_role = 'teacher' THEN
            _target_role := 'teacher'::public.app_role;
        ELSE
            _target_role := 'student'::public.app_role;
        END IF;
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, _target_role)
    ON CONFLICT (user_id, role) DO NOTHING;
END;
$function$;
