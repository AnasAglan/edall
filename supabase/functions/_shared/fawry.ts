export type FawryChargeResponse = Record<string, unknown> & {
  referenceNumber?: string | number;
  merchantRefNumber?: string | number;
  orderAmount?: string | number;
  paymentAmount?: string | number;
  paymentMethod?: string;
  orderStatus?: string;
  statusCode?: string | number;
  signature?: string;
};

export type FawryNotification = Record<string, unknown> & {
  requestId?: string;
  fawryRefNumber?: string | number;
  merchantRefNumber?: string | number;
  paymentRefrenceNumber?: string | number;
  paymentReferenceNumber?: string | number;
  paymentAmount?: string | number;
  orderAmount?: string | number;
  orderStatus?: string;
  paymentMethod?: string;
  messageSignature?: string;
};

export const FAWRY_STAGING_CHARGE_URL =
  "https://atfawry.fawrystaging.com/ECommerceWeb/Fawry/payments/charge";
export const FAWRY_PRODUCTION_CHARGE_URL =
  "https://www.atfawry.com/ECommerceWeb/Fawry/payments/charge";

export function isFawryEnabled(readEnv: (name: string) => string | undefined): boolean {
  return readEnv("FAWRY_PROVIDER_ENABLED") === "true";
}

export function getFawryChargeUrl(environment: string | undefined): string {
  return environment === "production" ? FAWRY_PRODUCTION_CHARGE_URL : FAWRY_STAGING_CHARGE_URL;
}

export function formatFawryAmount(value: unknown): string | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount.toFixed(2);
}

function formatOptionalAmount(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "";
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  const a = new TextEncoder().encode(left.toLowerCase());
  const b = new TextEncoder().encode(right.toLowerCase());
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

export async function createFawryRequestSignature(input: {
  merchantCode: string;
  merchantRefNum: string;
  customerProfileId?: string | null;
  paymentMethod: string;
  amount: unknown;
  secureKey: string;
}): Promise<string> {
  const amount = formatFawryAmount(input.amount);
  if (!amount || !input.merchantCode || !/^\d{1,15}$/.test(input.merchantRefNum) ||
      !input.paymentMethod || !input.secureKey) {
    throw new Error("Invalid Fawry request-signature input.");
  }
  return sha256Hex(
    input.merchantCode + input.merchantRefNum + (input.customerProfileId ?? "") +
    input.paymentMethod + amount + input.secureKey
  );
}

export async function verifyFawryChargeResponseSignature(
  response: FawryChargeResponse,
  secureKey: string,
): Promise<boolean> {
  const referenceNumber = String(response.referenceNumber ?? "");
  const merchantRefNumber = String(response.merchantRefNumber ?? "");
  const paymentAmount = formatOptionalAmount(response.paymentAmount);
  const orderAmount = formatOptionalAmount(response.orderAmount);
  const orderStatus = String(response.orderStatus ?? "");
  const paymentMethod = String(response.paymentMethod ?? "");
  const received = String(response.signature ?? "");
  if (!secureKey || !referenceNumber || !/^\d{1,15}$/.test(merchantRefNumber) ||
      !paymentAmount || !orderAmount || !orderStatus || !paymentMethod) return false;

  const message =
    referenceNumber + merchantRefNumber + paymentAmount + orderAmount + orderStatus +
    paymentMethod + formatOptionalAmount(response.fawryFees) +
    formatOptionalAmount(response.shippingFees) + String(response.authNumber ?? "") +
    String(response.customerMail ?? "") + String(response.customerMobile ?? "") + secureKey;
  return constantTimeHexEqual(await sha256Hex(message), received);
}

export async function verifyFawryNotificationSignature(
  notification: FawryNotification,
  secureKey: string,
): Promise<boolean> {
  const fawryRefNumber = String(notification.fawryRefNumber ?? "");
  const merchantRefNumber = String(notification.merchantRefNumber ?? "");
  const paymentAmount = formatOptionalAmount(notification.paymentAmount);
  const orderAmount = formatOptionalAmount(notification.orderAmount);
  const orderStatus = String(notification.orderStatus ?? "");
  const paymentMethod = String(notification.paymentMethod ?? "");
  const paymentReference = String(
    notification.paymentRefrenceNumber ?? notification.paymentReferenceNumber ?? "",
  );
  const received = String(notification.messageSignature ?? "");

  if (!secureKey || !fawryRefNumber || !/^\d{1,15}$/.test(merchantRefNumber) ||
      !paymentAmount || !orderAmount || !orderStatus || !paymentMethod) return false;

  const expected = await sha256Hex(
    fawryRefNumber + merchantRefNumber + paymentAmount + orderAmount +
    orderStatus + paymentMethod + paymentReference + secureKey
  );
  return constantTimeHexEqual(expected, received);
}

export function isFawryReferenceMatch(
  metadata: unknown,
  providerReference: unknown,
  callbackReference: unknown,
): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const expected = String((metadata as Record<string, unknown>).fawry_reference_number ?? "");
  const callback = String(callbackReference ?? "");
  const persisted = String(providerReference ?? "");
  return Boolean(callback) && expected === callback && persisted === callback;
}

export function normalizeEgyptianMobile(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  const local = digits.startsWith("20") && digits.length === 12 ? "0" + digits.slice(2) : digits;
  return /^01[0125]\d{8}$/.test(local) ? local : null;
}

export function isFawryPaidStatus(status: unknown): boolean {
  return String(status ?? "").trim().toUpperCase() === "PAID";
}
