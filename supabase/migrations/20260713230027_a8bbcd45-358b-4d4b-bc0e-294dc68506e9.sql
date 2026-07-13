
-- 1) wallets
CREATE TABLE public.wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallets_select_own_or_admin" ON public.wallets FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "wallets_admin_write" ON public.wallets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER trg_wallets_updated
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) wallet_transactions
CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  type TEXT NOT NULL DEFAULT 'topup',
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_transactions TO authenticated;
GRANT ALL ON public.wallet_transactions TO service_role;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wallet_tx_select_own_or_admin" ON public.wallet_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "wallet_tx_admin_write" ON public.wallet_transactions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX wallet_tx_user_idx ON public.wallet_transactions(user_id, created_at DESC);

-- 3) wallet_topup_contacts
CREATE TABLE public.wallet_topup_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  link TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_topup_contacts TO authenticated;
GRANT ALL ON public.wallet_topup_contacts TO service_role;
ALTER TABLE public.wallet_topup_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topup_contacts_read_authed" ON public.wallet_topup_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "topup_contacts_admin_write" ON public.wallet_topup_contacts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER trg_topup_contacts_updated
  BEFORE UPDATE ON public.wallet_topup_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Auto-create wallet for new users; add to setup_new_user
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
BEGIN
    INSERT INTO public.profiles (id, name, email)
    VALUES (_user_id, COALESCE(NULLIF(trim(_name), ''), _email), _email)
    ON CONFLICT (id) DO UPDATE
    SET name = COALESCE(EXCLUDED.name, public.profiles.name),
        email = COALESCE(EXCLUDED.email, public.profiles.email);

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

-- Backfill wallets for existing users
INSERT INTO public.wallets (user_id, balance)
SELECT id, 0 FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- 5) admin_credit_wallet
CREATE OR REPLACE FUNCTION public.admin_credit_wallet(_user_id uuid, _amount numeric, _note text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_balance numeric;
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
$$;

-- 6) admin_search_users
CREATE OR REPLACE FUNCTION public.admin_search_users(_term text, _limit int DEFAULT 50, _offset int DEFAULT 0)
RETURNS TABLE(id uuid, name text, email text, avatar_url text, balance numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY
    SELECT p.id, p.name, p.email, p.avatar_url, COALESCE(w.balance, 0) AS balance
    FROM public.profiles p
    LEFT JOIN public.wallets w ON w.user_id = p.id
    WHERE _term IS NULL OR _term = ''
       OR p.name ILIKE '%'||_term||'%'
       OR p.email ILIKE '%'||_term||'%'
    ORDER BY p.name NULLS LAST
    LIMIT _limit OFFSET _offset;
END;
$$;
