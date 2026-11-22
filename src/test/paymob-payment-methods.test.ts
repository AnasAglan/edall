import { describe, expect, it } from "vitest";
import { getPaymobIntegrationIds } from "../../supabase/functions/_shared/paymob-methods";

function env(values: Record<string, string | undefined>) {
  return (name: string) => values[name];
}

describe("optional Paymob payment channels", () => {
  it("keeps mobile wallets and Fawry disabled unless explicitly enabled", () => {
    expect(getPaymobIntegrationIds(env({
      PAYMOB_INTEGRATION_IDS: "[100]",
      PAYMOB_MOBILE_WALLET_INTEGRATION_ID: "200",
      PAYMOB_FAWRY_INTEGRATION_ID: "300",
    }))).toEqual([100]);
  });

  it("adds a mobile-wallet integration only when its server flag is true", () => {
    expect(getPaymobIntegrationIds(env({
      PAYMOB_INTEGRATION_IDS: "100",
      PAYMOB_MOBILE_WALLET_ENABLED: "true",
      PAYMOB_MOBILE_WALLET_INTEGRATION_ID: "200",
    }))).toEqual([100, 200]);
  });

  it("adds Fawry only when its server flag is true", () => {
    expect(getPaymobIntegrationIds(env({
      PAYMOB_INTEGRATION_IDS: "100",
      PAYMOB_FAWRY_ENABLED: "true",
      PAYMOB_FAWRY_INTEGRATION_ID: "300",
    }))).toEqual([100, 300]);
  });

  it("does not treat truthy-looking values as an enablement decision", () => {
    expect(getPaymobIntegrationIds(env({
      PAYMOB_INTEGRATION_IDS: "100",
      PAYMOB_MOBILE_WALLET_ENABLED: "1",
      PAYMOB_MOBILE_WALLET_INTEGRATION_ID: "200",
      PAYMOB_FAWRY_ENABLED: "yes",
      PAYMOB_FAWRY_INTEGRATION_ID: "300",
    }))).toEqual([100]);
  });

  it("fails closed when an explicitly enabled channel has no valid integration ID", () => {
    expect(() => getPaymobIntegrationIds(env({
      PAYMOB_INTEGRATION_IDS: "100",
      PAYMOB_MOBILE_WALLET_ENABLED: "true",
    }))).toThrow(/Mobile wallet is enabled but its integration ID is missing or invalid/);

    expect(() => getPaymobIntegrationIds(env({
      PAYMOB_INTEGRATION_IDS: "100",
      PAYMOB_FAWRY_ENABLED: "true",
      PAYMOB_FAWRY_INTEGRATION_ID: "not-an-id",
    }))).toThrow(/Fawry is enabled but its integration ID is missing or invalid/);
  });

  it("deduplicates IDs when channels share a configured integration", () => {
    expect(getPaymobIntegrationIds(env({
      PAYMOB_INTEGRATION_IDS: "[100,200]",
      PAYMOB_MOBILE_WALLET_ENABLED: "true",
      PAYMOB_MOBILE_WALLET_INTEGRATION_ID: "200",
    }))).toEqual([100, 200]);
  });

  it("rejects malformed base integration configuration", () => {
    expect(() => getPaymobIntegrationIds(env({
      PAYMOB_INTEGRATION_IDS: "{not-an-array}",
    }))).toThrow(/PAYMOB_INTEGRATION_IDS/);
  });
});
