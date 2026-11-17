-- Repair legacy Auth accounts whose profile row was missed by the old browser bootstrap.
-- Only accounts that already have a persisted role are eligible. Existing roles,
-- credentials, balances, course data, and profile rows are never overwritten.

BEGIN;

DO $repair$
DECLARE
    _account record;
BEGIN
    -- Serialize with the auth.users signup trigger so a concurrent signup cannot
    -- race this one-time repair.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('edall-initial-admin-bootstrap', 0)
    );

    FOR _account IN
        SELECT
            u.id,
            COALESCE(
                NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'name'), ''),
                u.email
            ) AS account_name,
            u.email
        FROM auth.users AS u
        LEFT JOIN public.profiles AS p ON p.id = u.id
        WHERE p.id IS NULL
          AND EXISTS (
              SELECT 1
              FROM public.user_roles AS r
              WHERE r.user_id = u.id
          )
        ORDER BY u.created_at, u.id
    LOOP
        -- setup_new_user inserts the missing profile and wallet, then returns
        -- without changing roles because this account already has a role.
        PERFORM public.setup_new_user(
            _account.id,
            _account.account_name,
            _account.email,
            NULL
        );
    END LOOP;
END;
$repair$;

-- Also fill a missing zero-balance wallet for a user who already has both an
-- Auth account, a profile, and a role. Existing balances are untouched.
INSERT INTO public.wallets (user_id, balance)
SELECT DISTINCT u.id, 0
FROM auth.users AS u
JOIN public.profiles AS p ON p.id = u.id
JOIN public.user_roles AS r ON r.user_id = u.id
LEFT JOIN public.wallets AS w ON w.user_id = u.id
WHERE w.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
