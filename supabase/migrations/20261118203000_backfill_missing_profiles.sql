-- Repair legacy ED-ALL accounts that already have an assigned platform role
-- but are missing their profile row. This is intentionally insert-only:
-- Auth credentials, email confirmation, roles, wallets, balances, and learning
-- records are not modified.
BEGIN;

INSERT INTO public.profiles (id, name, email, public_id)
SELECT
  u.id,
  COALESCE(
    NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'name'), ''),
    NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'full_name'), ''),
    u.email
  ),
  u.email,
  public.generate_public_id()
FROM auth.users AS u
WHERE u.email IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.user_roles AS r
    WHERE r.user_id = u.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = u.id
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;
