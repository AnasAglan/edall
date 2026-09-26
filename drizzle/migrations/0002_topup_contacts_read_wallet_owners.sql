DROP POLICY IF EXISTS "topup_contacts_read_authed" ON public.wallet_topup_contacts;
CREATE POLICY "topup_contacts_read_wallet_holders" ON public.wallet_topup_contacts
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.wallets w WHERE w.user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role));