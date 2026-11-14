const TRANSACTION_FIELDS: Array<(obj: Record<string,any>) => unknown> = [
  obj => obj.amount_cents,
  obj => obj.created_at,
  obj => obj.currency,
  obj => obj.error_occured,
  obj => obj.has_parent_transaction,
  obj => obj.id,
  obj => obj.integration_id,
  obj => obj.is_3d_secure,
  obj => obj.is_auth,
  obj => obj.is_capture,
  obj => obj.is_refunded,
  obj => obj.is_standalone_payment,
  obj => obj.is_voided,
  obj => obj.order?.id,
  obj => obj.owner,
  obj => obj.pending,
  obj => obj.source_data?.pan,
  obj => obj.source_data?.sub_type,
  obj => obj.source_data?.type,
  obj => obj.success
];

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

export function paymobTransactionHmacMessage(obj: Record<string,any>): string | null {
  const values=TRANSACTION_FIELDS.map(get=>get(obj));
  if(values.some(value=>value===undefined)) return null;
  return values.map(canonicalValue).join("");
}

export async function verifyPaymobTransactionHmac(
  obj: Record<string,any>,
  received: string,
  secret: string
): Promise<boolean> {
  if(!/^[0-9a-f]{128}$/i.test(received) || !secret) return false;
  const message=paymobTransactionHmacMessage(obj);
  if(message===null) return false;
  const key=await crypto.subtle.importKey(
    "raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-512"},false,["sign"]
  );
  const signature=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message));
  return equalConstantTime(hex(new Uint8Array(signature)),received);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}
