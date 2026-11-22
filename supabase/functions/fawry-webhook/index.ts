import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  hasSufficientFawryPaidAmount,
  isFawryPaidStatus,
  isFawryReferenceMatch,
  sha256Hex,
  verifyFawryNotificationSignature,
  type FawryNotification,
} from "../_shared/fawry.ts";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function amount(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const secureKey = Deno.env.get("FAWRY_SECURE_KEY") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!secureKey || !supabaseUrl || !serviceKey) {
    return json({ error: "Fawry webhook is not configured." }, 503);
  }

  try {
    const raw = await req.text();
    if (raw.length > 128 * 1024) return json({ error: "Payload too large." }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }

    const notification = record(parsed) as FawryNotification;
    if (!await verifyFawryNotificationSignature(notification, secureKey)) {
      return json({ error: "Fawry notification signature verification failed." }, 401);
    }

    const merchantRefNumber = String(notification.merchantRefNumber || "");
    const fawryRefNumber = String(notification.fawryRefNumber || "");
    const orderAmount = amount(notification.orderAmount);
    const paymentAmount = amount(notification.paymentAmount);
    const orderStatus = String(notification.orderStatus || "").trim().toUpperCase();
    const paymentMethod = String(notification.paymentMethod || "").trim().toUpperCase();

    if (!/^\d{1,15}$/.test(merchantRefNumber) || !fawryRefNumber ||
        !orderAmount || !paymentAmount || !orderStatus || paymentMethod !== "PAYATFAWRY") {
      return json({ error: "Invalid Fawry notification details." }, 422);
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: matches, error: lookupError } = await admin.from("payment_orders")
      .select("id,amount,currency,provider,status,metadata,provider_reference")
      .eq("provider", "fawry")
      .filter("metadata->>fawry_merchant_ref", "eq", merchantRefNumber)
      .limit(2);

    if (lookupError || !matches || matches.length !== 1) {
      console.warn("Fawry callback did not resolve to one order", {
        found: matches?.length ?? 0,
        error: lookupError?.code || null,
      });
      return json({ error: "Unknown or ambiguous Fawry merchant reference." }, 404);
    }

    const order = matches[0];
    // Reject callbacks until the charge response has been verified and the actual
    // Fawry reference is persisted. A transient early callback receives non-200 so
    // Fawry can retry; a valid merchant reference alone is not sufficient.
    if (!isFawryReferenceMatch(order.metadata, order.provider_reference, fawryRefNumber)) {
      return json({ error: "Fawry reference does not match the persisted payment order." }, 409);
    }
    if (order.currency !== "EGP" || Number(order.amount).toFixed(2) !== orderAmount.toFixed(2)) {
      return json({ error: "Fawry order amount or currency mismatch." }, 409);
    }

    const rawHash = await sha256Hex(raw);
    const paymentReference = String(
      notification.paymentRefrenceNumber ?? notification.paymentReferenceNumber ?? "",
    );
    const requestId = String(notification.requestId || "");
    const eventId = paymentReference || requestId ||
      `${fawryRefNumber}:${orderStatus}:${rawHash.slice(0, 16)}`;

    if (isFawryPaidStatus(orderStatus)) {
      if (!hasSufficientFawryPaidAmount(paymentAmount, orderAmount)) {
        return json({ error: "Fawry paid amount is below the ED-ALL order amount." }, 409);
      }
      const { error: fulfillError } = await admin.rpc("fulfill_payment_order", {
        _order_id: order.id,
        _provider: "fawry",
        _provider_event_id: eventId,
        _paid_amount: orderAmount,
        _currency: "EGP",
        _payload_sha256: rawHash,
      });
      if (fulfillError) {
        console.error("Fawry fulfillment failed", fulfillError.code || "rpc_error");
        return json({ error: "Verified Fawry event could not be fulfilled; it can safely be retried." }, 500);
      }
      return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const { error: eventError } = await admin.from("payment_webhook_events").upsert({
      provider: "fawry",
      provider_event_id: eventId,
      order_id: order.id,
      payload_sha256: rawHash,
      signature_verified: true,
      processed_at: new Date().toISOString(),
    }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true });

    if (eventError) {
      console.error("Fawry notification event write failed", eventError.code || "database_error");
      return json({ error: "Could not record the verified Fawry notification." }, 500);
    }

    if (["CANCELED", "CANCELLED", "EXPIRED", "FAILED"].includes(orderStatus) && order.status !== "paid") {
      const metadata = record(order.metadata);
      const { error: updateError } = await admin.from("payment_orders")
        .update({
          status: "failed",
          metadata: {
            ...metadata,
            fawry_last_status: orderStatus,
            fawry_last_event_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .eq("provider", "fawry")
        .in("status", ["created", "pending"]);
      if (updateError) {
        console.error("Fawry terminal status update failed", updateError.code || "database_error");
        return json({ error: "Could not update the verified Fawry order status." }, 500);
      }
    } else if (orderStatus === "REFUNDED") {
      // A refund is recorded but does not silently revoke enrollment.
      console.warn("Fawry refund notification requires manual reconciliation", order.id);
    }

    return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("fawry-webhook failed", message.slice(0, 180));
    return json({ error: "Fawry notification processing failed." }, 500);
  }
});
