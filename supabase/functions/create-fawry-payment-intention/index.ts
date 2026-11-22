import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createFawryRequestSignature,
  formatFawryAmount,
  getFawryChargeUrl,
  hasSufficientFawryPaidAmount,
  isFawryEnabled,
  normalizeEgyptianMobile,
  sha256Hex,
  verifyFawryChargeResponseSignature,
  type FawryChargeResponse,
} from "../_shared/fawry.ts";
import {
  edallCorsHeaders,
  getEdallAppOrigins,
  isAllowedEdallOrigin,
} from "../_shared/app-origin.ts";

function json(body: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function createMerchantReference(): string {
  const random = new Uint8Array(1);
  crypto.getRandomValues(random);
  return String(Date.now()) + String(random[0] % 100).padStart(2, "0");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const cors = edallCorsHeaders(origin, supabaseUrl);
  const originAllowed = isAllowedEdallOrigin(origin, supabaseUrl);

  if (req.method === "OPTIONS") {
    if (!originAllowed) return json({ error: "Origin is not allowed for this backend." }, 403, cors);
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405, cors);
  if (!originAllowed) return json({ error: "Origin is not allowed for this backend." }, 403, cors);

  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return json({ error: "Authentication required." }, 401, cors);
    }

    if (!isFawryEnabled((name) => Deno.env.get(name))) {
      return json({
        error: "PAYMENT_METHOD_DISABLED",
        message: "Fawry payments are not enabled for this ED-ALL environment.",
      }, 503, cors);
    }

    const merchantCode = Deno.env.get("FAWRY_MERCHANT_CODE") || "";
    const secureKey = Deno.env.get("FAWRY_SECURE_KEY") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
    if (!supabaseUrl || !serviceKey || !anonKey || !merchantCode || !secureKey) {
      return json({ error: "Fawry payment provider is not configured." }, 503, cors);
    }

    if (!getEdallAppOrigins(supabaseUrl).length) {
      return json({ error: "Payment backend environment is not recognized." }, 503, cors);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "Invalid request body." }, 400, cors);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON." }, 400, cors);
    }

    const courseId = typeof body.course_id === "string" ? body.course_id : "";
    const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
    if (!isUuid(courseId)) return json({ error: "A valid course_id is required." }, 400, cors);
    if (!/^[A-Za-z0-9_-]{16,120}$/.test(idempotencyKey)) {
      return json({ error: "A valid idempotency_key is required." }, 400, cors);
    }

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userError } = await caller.auth.getUser();
    const user = userData?.user;
    if (userError || !user) return json({ error: "Invalid or expired session." }, 401, cors);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("name,email,phone")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) return json({ error: "Could not validate the account details." }, 503, cors);

    const customerEmail = String(profile?.email || user.email || "").trim();
    const customerMobile = normalizeEgyptianMobile(profile?.phone);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) || !customerMobile) {
      return json({
        error: "PROFILE_CONTACT_REQUIRED",
        message: "Add a valid email and Egyptian mobile number to your ED-ALL profile before using Fawry.",
      }, 422, cors);
    }

    const environment = Deno.env.get("FAWRY_ENVIRONMENT") === "production" ? "production" : "staging";
    // Do not self-enable the database provider from a checkout request.
    // The independent payment_provider_settings.enabled switch is managed
    // administratively and must remain false until a deliberate activation.

    const { data: orderData, error: orderError } = await admin.rpc("create_payment_order_for_provider", {
      _user_id: user.id,
      _course_id: courseId,
      _idempotency_key: idempotencyKey,
      _provider_code: "fawry",
    });
    if (orderError) {
      const message = String(orderError.message || "");
      if (message.includes("ALREADY_ENROLLED")) return json({ error: "ALREADY_ENROLLED" }, 409, cors);
      if (message.includes("COURSE_NOT_PAYABLE")) return json({ error: "COURSE_NOT_PAYABLE" }, 400, cors);
      if (message.includes("OPEN_PAYMENT_ORDER_FOR_DIFFERENT_PROVIDER")) {
        return json({ error: "OPEN_PAYMENT_ORDER_FOR_DIFFERENT_PROVIDER" }, 409, cors);
      }
      console.warn("create_payment_order_for_provider rejected", orderError.code || "rpc_error");
      return json({
        error: message.includes("PAYMENT_PROVIDER_NOT_CONFIGURED")
          ? "PAYMENT_PROVIDER_NOT_CONFIGURED"
          : "Could not create Fawry payment order.",
      }, message.includes("PAYMENT_PROVIDER_NOT_CONFIGURED") ? 503 : 400, cors);
    }

    const order = record(orderData);
    const orderId = String(order.order_id || "");
    const orderAmount = formatFawryAmount(order.amount);
    if (!isUuid(orderId) || !orderAmount || order.currency !== "EGP" || order.provider !== "fawry") {
      return json({ error: "Invalid server-side Fawry order response." }, 502, cors);
    }

    const existingMetadata = record(order.metadata);
    if (order.status === "pending" && existingMetadata.fawry_reference_number) {
      return json({
        success: true,
        provider: "fawry",
        merchant_reference: String(existingMetadata.fawry_merchant_ref || ""),
        reference_number: String(existingMetadata.fawry_reference_number),
        amount: orderAmount,
        currency: "EGP",
        reused: true,
      }, 200, cors);
    }
    if (order.status !== "created") {
      return json({
        error: "FAWRY_ORDER_ALREADY_PROCESSING",
        message: "A Fawry request is already being prepared or needs provider reconciliation. Do not create another payment.",
      }, 409, cors);
    }

    const merchantRefNum = createMerchantReference();
    const claimedMetadata = {
      ...existingMetadata,
      fawry_merchant_ref: merchantRefNum,
      fawry_environment: environment,
      fawry_request_started_at: new Date().toISOString(),
    };
    const { data: claimed, error: claimError } = await admin.from("payment_orders")
      .update({
        status: "pending",
        provider_reference: merchantRefNum,
        metadata: claimedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("user_id", user.id)
      .eq("provider", "fawry")
      .eq("status", "created")
      .select("id")
      .maybeSingle();

    if (claimError) return json({ error: "Could not reserve this Fawry order safely." }, 503, cors);
    if (!claimed) {
      return json({
        error: "FAWRY_ORDER_ALREADY_PROCESSING",
        message: "Another request has already claimed this Fawry order. Refresh before continuing.",
      }, 409, cors);
    }

    const customerName = String(profile?.name || user.user_metadata?.name || "ED-ALL Student")
      .replace(/[\r\n\u0000-\u001f]/g, " ")
      .trim()
      .slice(0, 100) || "ED-ALL Student";
    const description = "ED-ALL course access";
    const paymentMethod = "PayAtFawry";
    const paymentExpiry = Date.now() + 24 * 60 * 60 * 1000;
    const signature = await createFawryRequestSignature({
      merchantCode,
      merchantRefNum,
      paymentMethod,
      amount: orderAmount,
      secureKey,
    });
    const hookUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/fawry-webhook`;
    const payload = {
      merchantCode,
      merchantRefNum,
      customerName,
      customerMobile,
      customerEmail,
      paymentMethod,
      amount: orderAmount,
      currencyCode: "EGP",
      paymentExpiry: String(paymentExpiry),
      description,
      orderWebHookUrl: hookUrl,
      language: "ar-eg",
      chargeItems: [{
        itemId: orderId.replace(/-/g, "").slice(0, 32),
        description,
        price: orderAmount,
        quantity: "1",
      }],
      signature,
    };

    let providerResponse: Response;
    try {
      providerResponse = await fetch(getFawryChargeUrl(environment), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      console.warn("Fawry charge request outcome is unknown", error instanceof Error ? error.name : "network_error");
      return json({
        error: "FAWRY_REQUEST_OUTCOME_UNKNOWN",
        message: "Fawry could not confirm the request. The order is held for reconciliation to prevent duplicate payment references.",
      }, 502, cors);
    }

    const responseBody = await providerResponse.json().catch(() => null);
    const fawry = record(responseBody) as FawryChargeResponse;
    const responseAmount = formatFawryAmount(fawry.orderAmount);
    const responseStatus = String(fawry.orderStatus || "").trim().toUpperCase();
    const paidAmountIsValid = responseStatus !== "PAID" ||
      hasSufficientFawryPaidAmount(fawry.paymentAmount, orderAmount);
    const validResponse =
      providerResponse.ok &&
      Number(fawry.statusCode) === 200 &&
      String(fawry.merchantRefNumber || "") === merchantRefNum &&
      Boolean(String(fawry.referenceNumber || "")) &&
      responseAmount === orderAmount &&
      paidAmountIsValid &&
      await verifyFawryChargeResponseSignature(fawry, secureKey);

    if (!validResponse) {
      console.error("Fawry charge response failed verification", {
        httpStatus: providerResponse.status,
        statusCode: fawry.statusCode || null,
      });
      return json({
        error: "FAWRY_RESPONSE_NOT_VERIFIED",
        message: "The provider response was not verified. The order remains pending for safe reconciliation.",
      }, 502, cors);
    }

    const finalMetadata = {
      ...claimedMetadata,
      fawry_reference_number: String(fawry.referenceNumber),
      fawry_order_status: String(fawry.orderStatus || "NEW"),
      fawry_payment_method: String(fawry.paymentMethod || paymentMethod),
      fawry_order_amount: orderAmount,
      fawry_payment_amount: formatFawryAmount(fawry.paymentAmount),
      fawry_fees: fawry.fawryFees ?? null,
    };
    const { error: persistError } = await admin.from("payment_orders")
      .update({
        provider_reference: String(fawry.referenceNumber),
        metadata: finalMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("user_id", user.id)
      .eq("provider", "fawry");

    if (persistError) {
      console.error("Fawry reference persistence failed", persistError.code || "database_error");
      return json({ error: "Fawry reference could not be linked to the payment order. Contact support before paying." }, 502, cors);
    }

    if (String(fawry.orderStatus || "").toUpperCase() === "PAID") {
      const { error: fulfillError } = await admin.rpc("fulfill_payment_order", {
        _order_id: orderId,
        _provider: "fawry",
        _provider_event_id: `charge:${String(fawry.referenceNumber)}`,
        _paid_amount: Number(orderAmount),
        _currency: "EGP",
        _payload_sha256: await sha256Hex(JSON.stringify(fawry)),
      });
      if (fulfillError) {
        console.error("Fawry immediate fulfillment failed", fulfillError.code || "rpc_error");
        return json({ error: "The verified payment needs a safe fulfillment retry. Contact support if access is not updated." }, 503, cors);
      }
    }

    return json({
      success: true,
      provider: "fawry",
      merchant_reference: merchantRefNum,
      reference_number: String(fawry.referenceNumber),
      amount: orderAmount,
      currency: "EGP",
      status: String(fawry.orderStatus || "NEW"),
      expires_at: new Date(paymentExpiry).toISOString(),
    }, 200, cors);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("create-fawry-payment-intention failed", message.slice(0, 180));
    return json({ error: "Could not start Fawry payment. Please try again later." }, 500, cors);
  }
});
