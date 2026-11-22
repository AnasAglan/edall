import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getPaymobIntegrationIds } from "../_shared/paymob-methods.ts";
import {
  edallCorsHeaders,
  getEdallAppOrigins,
  isAllowedEdallOrigin,
} from "../_shared/app-origin.ts";

function json(body: Record<string,unknown>, status: number, headers: Record<string,string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function paymentMethods(): number[] {
  return getPaymobIntegrationIds(name => Deno.env.get(name));
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: (parts.shift() || "EDALL").slice(0,80),
    last_name: (parts.join(" ") || "Student").slice(0,80)
  };
}

Deno.serve(async req => {
  const origin = req.headers.get("Origin");
  const url = Deno.env.get("SUPABASE_URL") || "";
  const cors = edallCorsHeaders(origin, url);
  const originAllowed = isAllowedEdallOrigin(origin, url);

  if (req.method === "OPTIONS") {
    if (!originAllowed) return json({ error: "Origin is not allowed for this backend." },403,cors);
    return new Response(null,{status:204,headers:cors});
  }
  if (req.method !== "POST") return json({error:"Method not allowed."},405,cors);
  if (!originAllowed) return json({error:"Origin is not allowed for this backend."},403,cors);

  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json({error:"Authentication required."},401,cors);

    const appOrigins = getEdallAppOrigins(url);
    if (!url || !appOrigins.length) return json({error:"Payment backend environment is not recognized."},503,cors);
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({error:"Payment backend is not configured."},503,cors);

    // Payments remain deliberately disabled until the merchant has supplied server-side
    // credentials, payment integration IDs and an explicit provider-enable switch.
    const enabled = Deno.env.get("PAYMOB_PROVIDER_ENABLED") === "true";
    const secretKey = Deno.env.get("PAYMOB_SECRET_KEY") || "";
    const publicKey = Deno.env.get("PAYMOB_PUBLIC_KEY") || "";
    const hmacSecret = Deno.env.get("PAYMOB_HMAC_SECRET") || "";
    let integrations: number[] = [];
    try { integrations = paymentMethods(); } catch { /* checked below */ }
    if (!enabled || !secretKey || !publicKey || !hmacSecret || !integrations.length) {
      return json({
        error:"PAYMENT_PROVIDER_NOT_CONFIGURED",
        message:"Paymob checkout is disabled until PAYMOB_PROVIDER_ENABLED, the merchant keys, HMAC secret and integration IDs are configured as server secrets."
      },503,cors);
    }

    const caller = createClient(url,anonKey,{
      global:{headers:{Authorization:authorization}},
      auth:{autoRefreshToken:false,persistSession:false}
    });
    const {data:userData,error:userError}=await caller.auth.getUser();
    const user=userData?.user;
    if(userError || !user) return json({error:"Invalid or expired session."},401,cors);

    let body: Record<string,unknown>;
    try {
      const parsed=await req.json();
      if(!parsed || typeof parsed!=="object" || Array.isArray(parsed)) return json({error:"Invalid request body."},400,cors);
      body=parsed as Record<string,unknown>;
    } catch { return json({error:"Invalid JSON."},400,cors); }

    const courseId=typeof body.course_id==="string" ? body.course_id : "";
    const idempotencyKey=typeof body.idempotency_key==="string" ? body.idempotency_key : "";
    if(!/^[0-9a-f-]{36}$/i.test(courseId)) return json({error:"A valid course_id is required."},400,cors);
    if(!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return json({error:"A valid idempotency_key is required."},400,cors);

    const admin=createClient(url,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});

    // The only enabled provider row is written by this server after all required secrets exist.
    const {error:configError}=await admin.from("payment_provider_settings").upsert({
      provider_code:"primary",
      display_name:"Paymob Egypt",
      enabled:true,
      currency:"EGP",
      public_config:{integration_ids:integrations,checkout:"unified"},
      secret_binding_name:"PAYMOB_SECRET_KEY",
      updated_by:user.id,
      updated_at:new Date().toISOString()
    },{onConflict:"provider_code"});
    if(configError) {
      console.error("Paymob provider config write failed",configError.code || "database_error");
      return json({error:"Payment provider configuration could not be verified."},503,cors);
    }

    // The database derives the price and verifies enrollment; the browser sends no amount.
    const {data:orderData,error:orderError}=await caller.rpc("create_payment_order",{
      _course_id:courseId,
      _idempotency_key:idempotencyKey
    });
    if(orderError) {
      if(orderError.message?.includes("ALREADY_ENROLLED")) return json({error:"ALREADY_ENROLLED"},409,cors);
      if(orderError.message?.includes("COURSE_NOT_PAYABLE")) return json({error:"COURSE_NOT_PAYABLE"},400,cors);
      console.warn("create_payment_order rejected",orderError.code || "rpc_error");
      return json({error:orderError.message?.includes("PAYMENT_PROVIDER_NOT_CONFIGURED")
        ? "PAYMENT_PROVIDER_NOT_CONFIGURED" : "Could not create payment order."},orderError.message?.includes("PAYMENT_PROVIDER_NOT_CONFIGURED")?503:400,cors);
    }

    const order=orderData as {
      order_id?:string; amount?:number|string; currency?:string; status?:string; checkout_url?:string|null; updated_at?:string;
    };
    if(!order?.order_id || order.currency!=="EGP") return json({error:"Invalid payment order response."},502,cors);
    if(order.checkout_url && order.status==="pending") {
      return json({success:true,checkout_url:order.checkout_url,order_id:order.order_id,reused:true},200,cors);
    }

    const amount=Number(order.amount);
    const amountCents=Math.round(amount*100);
    if(!Number.isFinite(amount) || amount<=0 || amountCents<=0) return json({error:"Invalid server-side course price."},422,cors);

    const {data:profile,error:profileError}=await admin.from("profiles")
      .select("name,email,phone").eq("id",user.id).maybeSingle();
    if(profileError || !profile?.phone || !profile?.email) {
      return json({error:"Add a valid phone number and email to your ED-ALL profile before starting checkout."},422,cors);
    }
    const name=splitName(profile.name || user.user_metadata?.name || "ED ALL Student");
    // Claim a single checkout attempt for this active order. Concurrent clicks cannot
    // create multiple Paymob intentions for the same student/course order.
    if(order.status==="pending" && !order.checkout_url) {
      const updatedAt=Date.parse(order.updated_at || "");
      const staleBefore=new Date(Date.now()-5*60*1000).toISOString();
      if(!Number.isFinite(updatedAt) || updatedAt>=Date.parse(staleBefore)) {
        return json({error:"CHECKOUT_ALREADY_BEING_PREPARED",message:"A checkout attempt is already being prepared. Please wait a moment and refresh."},409,cors);
      }
      const {data:reopened,error:reopenError}=await admin.from("payment_orders")
        .update({status:"created",updated_at:new Date().toISOString()})
        .eq("id",order.order_id).eq("user_id",user.id).eq("status","pending")
        .is("checkout_url",null).lt("updated_at",staleBefore)
        .select("id").maybeSingle();
      if(reopenError) return json({error:"Could not safely retry the previous checkout attempt."},503,cors);
      if(!reopened) {
        const {data:latest}=await admin.from("payment_orders")
          .select("status,checkout_url").eq("id",order.order_id).maybeSingle();
        if(latest?.status==="pending" && latest.checkout_url) {
          return json({success:true,checkout_url:latest.checkout_url,order_id:order.order_id,reused:true},200,cors);
        }
        return json({error:"CHECKOUT_ALREADY_BEING_PREPARED"},409,cors);
      }
      order.status="created";
    }

    if(order.status!=="created") {
      return json({error:"PAYMENT_ORDER_NOT_READY",message:"This payment order is no longer available. Refresh the page and try again."},409,cors);
    }

    const {data:claimed,error:claimError}=await admin.from("payment_orders")
      .update({status:"pending",updated_at:new Date().toISOString()})
      .eq("id",order.order_id).eq("user_id",user.id).eq("status","created")
      .select("id").maybeSingle();
    if(claimError) return json({error:"Could not safely reserve the checkout attempt."},503,cors);
    if(!claimed) {
      const {data:latest}=await admin.from("payment_orders")
        .select("status,checkout_url").eq("id",order.order_id).maybeSingle();
      if(latest?.status==="pending" && latest.checkout_url) {
        return json({success:true,checkout_url:latest.checkout_url,order_id:order.order_id,reused:true},200,cors);
      }
      return json({error:"CHECKOUT_ALREADY_BEING_PREPARED"},409,cors);
    }

    const notificationUrl = `${url.replace(/\/$/,"")}/functions/v1/paymob-webhook`;
    const redirectOrigin = origin && appOrigins.includes(origin) ? origin : appOrigins[0];
    let redirectUrl = `${redirectOrigin}/?payment=return`;
    const configuredRedirectUrl = Deno.env.get("PAYMOB_REDIRECTION_URL") || "";
    if (configuredRedirectUrl) {
      try {
        const parsedRedirect = new URL(configuredRedirectUrl);
        if (!appOrigins.includes(parsedRedirect.origin)) {
          return json({ error: "Payment return URL must stay inside the active ED-ALL environment." },503,cors);
        }
        redirectUrl = parsedRedirect.toString();
      } catch {
        return json({ error: "Configured payment return URL is invalid." },503,cors);
      }
    }

    const intentionPayload={
      amount:amountCents,
      currency:"EGP",
      payment_methods:integrations,
      items:[{
        name:"ED-ALL course",
        amount:amountCents,
        description:"ED-ALL online course access",
        quantity:1
      }],
      billing_data:{
        ...name,
        email:profile.email,
        phone_number:String(profile.phone),
        apartment:"NA",
        street:"NA",
        building:"NA",
        floor:"NA",
        city:"Cairo",
        country:"EGY",
        state:"Cairo"
      },
      special_reference:order.order_id,
      extras:{edall_order_id:order.order_id,edall_user_id:user.id,edall_course_id:courseId},
      expiration:3600,
      notification_url:notificationUrl,
      redirection_url:redirectUrl
    };

    const response=await fetch("https://accept.paymob.com/v1/intention/",{
      method:"POST",
      headers:{
        "Authorization":`Token ${secretKey}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify(intentionPayload),
      signal:AbortSignal.timeout(20000)
    });
    const intention=await response.json().catch(()=>null);
    if(!response.ok || !intention?.client_secret || !intention?.id) {
      console.error("Paymob intention request failed",{status:response.status,code:intention?.detail || intention?.code || "provider_error"});
      await admin.from("payment_orders").update({status:"failed",updated_at:new Date().toISOString()})
        .eq("id",order.order_id).eq("status","pending").is("checkout_url",null);
      return json({error:"The payment provider could not create checkout. The order has not been marked as paid."},502,cors);
    }

    const checkoutUrl=new URL("https://accept.paymob.com/unifiedcheckout/");
    checkoutUrl.searchParams.set("publicKey",publicKey);
    checkoutUrl.searchParams.set("clientSecret",intention.client_secret);

    const {error:updateError}=await admin.from("payment_orders").update({
      status:"pending",
      provider_reference:String(intention.id),
      checkout_url:checkoutUrl.toString(),
      metadata:{
        intention_id:String(intention.id),
        paymob_order_id:String(intention.intention_order_id || ""),
        special_reference:order.order_id
      },
      updated_at:new Date().toISOString()
    }).eq("id",order.order_id).eq("user_id",user.id);
    if(updateError) {
      console.error("Paymob order persistence failed",updateError.code || "database_error");
      return json({error:"Checkout was created but could not be linked to the ED-ALL order. Contact support before retrying."},502,cors);
    }

    return json({success:true,checkout_url:checkoutUrl.toString(),order_id:order.order_id},200,cors);
  } catch(error) {
    const message=error instanceof Error?error.message:"Unknown error";
    console.error("create-payment-intention failed",message.slice(0,180));
    return json({error:"Could not start checkout. Please try again later."},500,cors);
  }
});
