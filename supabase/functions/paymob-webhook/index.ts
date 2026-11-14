import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function canonicalValue(value: unknown): string {
  if(value===true) return "true";
  if(value===false) return "false";
  if(value===null || value===undefined) return "";
  return String(value);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes,value=>value.toString(16).padStart(2,"0")).join("");
}

function equalConstantTime(left: string,right: string): boolean {
  const a=new TextEncoder().encode(left.toLowerCase());
  const b=new TextEncoder().encode(right.toLowerCase());
  if(a.length!==b.length) return false;
  let difference=0;
  for(let i=0;i<a.length;i++) difference|=a[i]^b[i];
  return difference===0;
}

async function verifyPaymobTransactionHmac(obj: Record<string,any>,received: string,secret: string): Promise<boolean> {
  const values=[
    obj.amount_cents,
    obj.created_at,
    obj.currency,
    obj.error_occured,
    obj.has_parent_transaction,
    obj.id,
    obj.integration_id,
    obj.is_3d_secure,
    obj.is_auth,
    obj.is_capture,
    obj.is_refunded,
    obj.is_standalone_payment,
    obj.is_voided,
    nested(obj,["order","id"]),
    obj.owner,
    obj.pending,
    nested(obj,["source_data","pan"]),
    nested(obj,["source_data","sub_type"]),
    nested(obj,["source_data","type"]),
    obj.success
  ];
  if(values.some(value=>value===undefined)) return false;
  const message=values.map(canonicalValue).join("");
  const key=await crypto.subtle.importKey(
    "raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-512"},false,["sign"]
  );
  const signature=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message));
  return equalConstantTime(hex(new Uint8Array(signature)),received);
}

async function sha256(value: string): Promise<string> {
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
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

    const payloadHash=await sha256(raw);
    const succeeded=obj.success===true && obj.pending!==true &&
      obj.error_occured!==true && obj.is_refunded!==true && obj.is_voided!==true;

    if(!succeeded) {
      // Record the verified failure without ever downgrading an already paid order.
      const {error:eventError}=await admin.from("payment_webhook_events").upsert({
        provider:"primary",
        provider_event_id:transactionId,
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
          provider_reference:transactionId,
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
