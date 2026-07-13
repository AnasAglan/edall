
REVOKE EXECUTE ON FUNCTION public.admin_credit_wallet(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_search_users(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_credit_wallet(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, int, int) TO authenticated;
