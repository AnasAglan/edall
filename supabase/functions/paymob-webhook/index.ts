import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256Hex, verifyPaymobTransactionHmac } from "../_shared/paymob-hmac.ts";

function json(body: Record<string,unknown>,status=200) {
  return new Response(JSON.stringify(body),{
    status,
    headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}

function nested(obj: Record<string,any>,path: string[]): unknown {
  let current: any=obj;
  for(const key of path) current=current && typeof current==="object"?current[key]:undefined;
  return current;
}

Deno.serve(async req=>{
  if(req.method!=="POST") return json({error:"Method not allowed."},405);
  const secret=Deno.env.get("PAYMOB_HMAC_SECRET") || "";
  const supabaseUrl=Deno.env.get("SUPABASE_URL") || "";
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if(!secret || !supabaseUrl || !serviceKey) return json({error:"Webhook is not configured."},503);

  const receivedHmac=new URL(req.url).searchParams.get("hmac") || "";
  if(!/^[0-9a-f]{128}$/i.test(receivedHmac)) return json({error:"Missing or invalid HMAC."},401);

  try {
    const raw=await req.text();
    if(raw.length>256*1024) return json({error:"Payload too large."},413);
    let body: Record<string,any>;
    try { body=JSON.parse(raw); } catch { return json({error:"Invalid JSON."},400); }

    // This endpoint is configured for Paymob's transaction-processed callback only.
    if(body.type && body.type!=="TRANSACTION") return json({ok:true,ignored:true},200);
    const obj=body.obj;
    if(!obj || typeof obj!=="object") return json({error:"Transaction object missing."},400);
    if(!(await verifyPaymobTransactionHmac(obj,receivedHmac,secret))) {
      return json({error:"HMAC verification failed."},401);
    }

    const merchantReference=
      nested(obj,["order","merchant_order_id"]) ??
      nested(obj,["order","special_reference"]) ??
      obj.merchant_order_id ??
      obj.special_reference;
    if(typeof merchantReference!=="string" || !/^[0-9a-f-]{36}$/i.test(merchantReference)) {
      return json({error:"Merchant order reference is invalid."},422);
    }

    const transactionId=String(obj.id ?? "");
    const amountCents=Number(obj.amount_cents);
    if(!/^\d+$/.test(transactionId) || !Number.isSafeInteger(amountCents) || amountCents<=0 || obj.currency!=="EGP") {
      return json({error:"Invalid transaction details."},422);
    }

    const admin=createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:order,error:orderError}=await admin.from("payment_orders")
      .select("id,amount,currency,provider,status").eq("id",merchantReference).maybeSingle();
    if(orderError || !order) {
      console.warn("Paymob callback references unknown order",transactionId);
      return json({error:"Unknown merchant order."},404);
    }
    if(order.provider!=="primary" || order.currency!=="EGP" ||
       Number(order.amount).toFixed(2)!==(amountCents/100).toFixed(2)) {
      return json({error:"Payment amount or provider mismatch."},409);
    }

    const payloadHash=await sha256Hex(raw);
    const succeeded=obj.success===true && obj.pending!==true &&
      obj.error_occured!==true && obj.is_refunded!==true && obj.is_voided!==true;

    if(obj.pending===true) {
      // An authenticated pending callback is not a failed or paid transaction.
      return json({ok:true,pending:true},200);
    }

    if(!succeeded) {
      // Use a distinct event key so a later successful transaction callback
      // can still be processed with the real Paymob transaction ID.
      const {error:eventError}=await admin.from("payment_webhook_events").upsert({
        provider:"primary",
        provider_event_id:transactionId + ":failed",
        order_id:merchantReference,
        payload_sha256:payloadHash,
        signature_verified:true,
        processed_at:new Date().toISOString()
      },{onConflict:"provider,provider_event_id",ignoreDuplicates:true});
      if(eventError) {
        console.error("Paymob failure event write failed",eventError.code || "database_error");
        return json({error:"Could not record the verified callback."},500);
      }
      if(order.status!=="paid") {
        const {error:updateError}=await admin.from("payment_orders").update({
          status:"failed",
          updated_at:new Date().toISOString()
        }).eq("id",merchantReference).neq("status","paid");
        if(updateError) return json({error:"Could not update the failed order."},500);
      }
      return json({ok:true,paid:false},200);
    }

    const {data:fulfillment,error:fulfillmentError}=await admin.rpc("fulfill_payment_order",{
      _order_id:merchantReference,
      _provider:"primary",
      _provider_event_id:transactionId,
      _paid_amount:Number((amountCents/100).toFixed(2)),
      _currency:"EGP",
      _payload_sha256:payloadHash
    });
    if(fulfillmentError) {
      console.error("Paymob fulfillment failed",fulfillmentError.code || "rpc_error");
      return json({error:"Verified callback could not be fulfilled; it can safely be retried."},500);
    }

    return json({ok:true,fulfillment},200);
  } catch(error) {
    const message=error instanceof Error?error.message:"Unknown error";
    console.error("paymob webhook failed",message.slice(0,160));
    return json({error:"Webhook processing failed."},500);
  }
});
