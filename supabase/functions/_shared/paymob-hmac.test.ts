import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { paymobTransactionHmacMessage, verifyPaymobTransactionHmac } from "./paymob-hmac.ts";

Deno.test("Paymob transaction HMAC follows the documented 20-field order and lowercase booleans", async () => {
  const obj={
    amount_cents:25000,
    created_at:"2026-11-14T20:00:00Z",
    currency:"EGP",
    error_occured:false,
    has_parent_transaction:false,
    id:123456789,
    integration_id:9876,
    is_3d_secure:true,
    is_auth:false,
    is_capture:false,
    is_refunded:false,
    is_standalone_payment:true,
    is_voided:false,
    order:{id:654321,merchant_order_id:"11111111-1111-4111-8111-111111111111"},
    owner:1234,
    pending:false,
    source_data:{pan:"1234",sub_type:"Mastercard",type:"card"},
    success:true
  };
  const message=paymobTransactionHmacMessage(obj);
  assert(message);
  assert(message.includes("falsefalse"));
  const secret="unit-test-secret";
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-512"},false,["sign"]);
  const signature=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message));
  const expected=Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,"0")).join("");
  assertEquals(await verifyPaymobTransactionHmac(obj,expected,secret),true);
  assertEquals(await verifyPaymobTransactionHmac({...obj,success:false},expected,secret),false);
});

Deno.test("Paymob transaction HMAC rejects missing signed fields and malformed signatures", async () => {
  assertEquals(paymobTransactionHmacMessage({id:1}),null);
  assertEquals(await verifyPaymobTransactionHmac({id:1},"abc","secret"),false);
});
