export type EnvironmentReader = (name: string) => string | undefined;

function parseIntegrationIds(raw: string): number[] {
  let values: unknown;
  try {
    values = raw.trim().startsWith("[")
      ? JSON.parse(raw)
      : raw.split(",").map((value) => value.trim()).filter(Boolean);
  } catch {
    throw new Error("PAYMOB_INTEGRATION_IDS must be a JSON array or comma-separated list.");
  }

  if (!Array.isArray(values)) {
    throw new Error("PAYMOB_INTEGRATION_IDS must contain an array of integration IDs.");
  }

  const ids = values.map((value) => {
    if (typeof value !== "number" && typeof value !== "string") return Number.NaN;
    return Number(value);
  });

  if (!ids.length || ids.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("PAYMOB_INTEGRATION_IDS is missing or invalid.");
  }

  return ids;
}

function optionalIntegrationId(
  readEnv: EnvironmentReader,
  enabledVariable: string,
  integrationIdVariable: string,
  displayName: string,
): number | null {
  // Optional payment channels are opt-in only. Missing, empty, or non-"true"
  // flags keep the channel unavailable, even when an integration ID is present.
  if (readEnv(enabledVariable) !== "true") return null;

  const raw = readEnv(integrationIdVariable)?.trim() ?? "";
  const id = Number(raw);
  if (!raw || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`${displayName} is enabled but its integration ID is missing or invalid.`);
  }
  return id;
}

/**
 * Returns Paymob integration IDs for the unified checkout.
 *
 * Mobile wallets and Fawry are deliberately disabled unless their individual
 * server-side feature flags are explicitly set to the exact string "true".
 * The top-level PAYMOB_PROVIDER_ENABLED switch is still required separately.
 */
export function getPaymobIntegrationIds(readEnv: EnvironmentReader): number[] {
  const baseIds = parseIntegrationIds(readEnv("PAYMOB_INTEGRATION_IDS") ?? "");
  const optionalIds = [
    optionalIntegrationId(
      readEnv,
      "PAYMOB_MOBILE_WALLET_ENABLED",
      "PAYMOB_MOBILE_WALLET_INTEGRATION_ID",
      "Mobile wallet",
    ),
    optionalIntegrationId(
      readEnv,
      "PAYMOB_FAWRY_ENABLED",
      "PAYMOB_FAWRY_INTEGRATION_ID",
      "Fawry",
    ),
  ].filter((id): id is number => id !== null);

  return [...new Set([...baseIds, ...optionalIds])];
}
