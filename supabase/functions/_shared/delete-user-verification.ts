export type AuthUserLookupResult = {
  data?: unknown;
  error?: unknown;
} | null | undefined;

/**
 * Only an explicit Auth API not-found response proves a user is absent.
 * A 200 response with { user: null } and no error is ambiguous and must fail closed.
 */
export function isDefinitivelyMissingAuthUser(result: AuthUserLookupResult): boolean {
  const rawError = result && result.error;
  if (!rawError || typeof rawError !== "object") return false;

  const error = rawError as { code?: unknown; status?: unknown; statusCode?: unknown };
  const code = typeof error.code === "string" ? error.code : "";
  const statusValue = error.status ?? error.statusCode;
  const status = typeof statusValue === "number" ? statusValue : Number(statusValue);

  return code === "user_not_found" || status === 404;
}
