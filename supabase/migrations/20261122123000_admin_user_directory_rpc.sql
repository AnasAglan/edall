-- AAL2-protected administrator directory.
-- Includes Auth users with missing profiles/roles so account-integrity issues are visible
-- instead of silently omitting accounts or assigning a guessed default role.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_users(
  _term text DEFAULT '',
  _limit integer DEFAULT 100,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  phone text,
  avatar_url text,
  bio text,
  banned boolean,
  roles public.app_role[],
  last_active timestamptz,
  joined_at timestamptz,
  public_id text,
  profile_state text,
  role_state text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _admin_id uuid := auth.uid();
  _needle text := left(btrim(COALESCE(_term, '')), 100);
BEGIN
  IF _admin_id IS NULL
     OR NOT public.has_role(_admin_id, 'admin'::public.app_role)
     OR NOT public.admin_mfa_verified() THEN
    RAISE EXCEPTION 'ADMIN_MFA_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    COALESCE(p.email, u.email, ''),
    COALESCE(NULLIF(p.name, ''), NULLIF(u.raw_user_meta_data ->> 'name', ''), u.email, ''),
    p.phone,
    p.avatar_url,
    p.bio,
    COALESCE(p.banned, false),
    COALESCE(role_data.roles, ARRAY[]::public.app_role[]),
    p.last_active,
    COALESCE(p.joined_at, u.created_at),
    p.public_id,
    CASE WHEN p.id IS NULL THEN 'missing' ELSE 'ready' END,
    CASE
      WHEN COALESCE(cardinality(role_data.roles), 0) = 0 THEN 'missing'
      ELSE 'ready'
    END
  FROM auth.users AS u
  LEFT JOIN public.profiles AS p ON p.id = u.id
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT ur.role ORDER BY ur.role) AS roles
    FROM public.user_roles AS ur
    WHERE ur.user_id = u.id
  ) AS role_data ON true
  WHERE
    _needle = ''
    OR COALESCE(p.name, u.raw_user_meta_data ->> 'name', '') ILIKE '%' || _needle || '%'
    OR COALESCE(p.email, u.email, '') ILIKE '%' || _needle || '%'
    OR COALESCE(p.public_id, '') ILIKE '%' || _needle || '%'
  ORDER BY COALESCE(NULLIF(p.name, ''), u.email, ''), u.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 100)
  OFFSET GREATEST(COALESCE(_offset, 0), 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_users(text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, integer, integer)
  TO authenticated;

COMMENT ON FUNCTION public.admin_list_users(text, integer, integer)
  IS 'AAL2-gated admin user directory. Includes Auth users with missing profile/role state; never exposes credentials or raw Auth metadata.';

COMMIT;
