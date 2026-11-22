import { describe, expect, it } from "vitest";
import {
  createFawryRequestSignature,
  formatFawryAmount,
  getFawryChargeUrl,
  isFawryEnabled,
  isFawryPaidStatus,
  normalizeEgyptianMobile,
  verifyFawryChargeResponseSignature,
  verifyFawryNotificationSignature,
} from "../../supabase/functions/_shared/fawry";

const SECURE_KEY = "test-secure-key";
const readEnv = (values: Record<string, string | undefined>) => (name: string) => values[name];

describe("dormant Fawry payment provider", () => {
  it("stays disabled unless the exact server flag is true", () => {
    expect(isFawryEnabled(readEnv({}))).toBe(false);
    expect(isFawryEnabled(readEnv({ FAWRY_PROVIDER_ENABLED: "false" }))).toBe(false);
    expect(isFawryEnabled(readEnv({ FAWRY_PROVIDER_ENABLED: "TRUE" }))).toBe(false);
    expect(isFawryEnabled(readEnv({ FAWRY_PROVIDER_ENABLED: "true" }))).toBe(true);
  });

  it("defaults to the Fawry staging endpoint and permits only the fixed production endpoint", () => {
    expect(getFawryChargeUrl(undefined)).toBe("https://atfawry.fawrystaging.com/ECommerceWeb/Fawry/payments/charge");
    expect(getFawryChargeUrl("production")).toBe("https://www.atfawry.com/ECommerceWeb/Fawry/payments/charge");
    expect(getFawryChargeUrl("https://attacker.invalid")).toContain("fawrystaging.com");
  });

  it("formats only finite positive EGP amounts", () => {
    expect(formatFawryAmount(356.5)).toBe("356.50");
    expect(formatFawryAmount("20")).toBe("20.00");
    expect(formatFawryAmount(0)).toBeNull();
    expect(formatFawryAmount(-1)).toBeNull();
    expect(formatFawryAmount("not-money")).toBeNull();
    expect(formatFawryAmount(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("normalizes Egyptian mobile numbers without accepting invalid prefixes", () => {
    expect(normalizeEgyptianMobile("010 1234 5678")).toBe("01012345678");
    expect(normalizeEgyptianMobile("+20 1012345678")).toBe("01012345678");
    expect(normalizeEgyptianMobile("02123456789")).toBeNull();
    expect(normalizeEgyptianMobile("0101234567")).toBeNull();
  });

  it("creates a server-side PayAtFawry request signature", async () => {
    await expect(createFawryRequestSignature({
      merchantCode: "merchant",
      merchantRefNum: "1234567890123",
      paymentMethod: "PayAtFawry",
      amount: "356.50",
      secureKey: SECURE_KEY,
    })).resolves.toBe("e4a1a1295e03a8022ef555c457f499ce0c51a8efcd67be9df053064b18b848f1");
    await expect(createFawryRequestSignature({
      merchantCode: "merchant",
      merchantRefNum: "invalid",
      paymentMethod: "PayAtFawry",
      amount: "356.50",
      secureKey: SECURE_KEY,
    })).rejects.toThrow("Invalid Fawry request-signature input.");
  });

  it("verifies charge response signatures and rejects modified responses", async () => {
    const response = {
      referenceNumber: "/850090916",
      merchantRefNumber: "1234567890123",
      paymentAmount: "356.50",
      orderAmount: "356.50",
      orderStatus: "NEW",
      paymentMethod: "PayAtFawry",
      fawryFees: "1.00",
      customerMail: "student@example.com",
      customerMobile: "01012345678",
      signature: "3df633188c514c1cbdd07872537f355733da5bc8c7763f0ca7e1b87d31f80c03",
    };
    expect(await verifyFawryChargeResponseSignature(response, SECURE_KEY)).toBe(true);
    expect(await verifyFawryChargeResponseSignature({ ...response, orderAmount: "356.51" }, SECURE_KEY)).toBe(false);
  });

  it("verifies the Server Notification V2 signature and rejects altered amounts", async () => {
    const notification = {
      requestId: "callback-1",
      fawryRefNumber: "970177",
      merchantRefNumber: "1234567890123",
      paymentAmount: "358.50",
      orderAmount: "356.50",
      fawryFees: "2.00",
      orderStatus: "PAID",
      paymentMethod: "PAYATFAWRY",
      paymentRefrenceNumber: "369552233",
      messageSignature: "5492192ecab555fa9bae27a539e89d8a7fdc8e5db40109414346e24ccb68bce7",
    };
    expect(await verifyFawryNotificationSignature(notification, SECURE_KEY)).toBe(true);
    expect(await verifyFawryNotificationSignature({ ...notification, paymentAmount: "359.50" }, SECURE_KEY)).toBe(false);
  });

  it("recognizes only the provider's PAID state as payment success", () => {
    expect(isFawryPaidStatus("PAID")).toBe(true);
    expect(isFawryPaidStatus("paid")).toBe(true);
    expect(isFawryPaidStatus("NEW")).toBe(false);
    expect(isFawryPaidStatus("DELIVERED")).toBe(false);
  });
});
