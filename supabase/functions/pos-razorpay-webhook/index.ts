// Razorpay webhook for POS UPI QR payments. Configure one webhook per Razorpay account (invoicing entity):
//   https://<project>.supabase.co/functions/v1/pos-razorpay-webhook?entity=<ENTITY_CODE>
// with events qr_code.credited and payment.failed, secret in RAZORPAY_WEBHOOK_SECRET__<ENTITY_CODE>.
// A confirmed payment always finalises the invoice or lands on Needs attention (Lesson 1); pos_gateway_payment
// is idempotent, so Razorpay's retries are safe. Deploy with verify_jwt = false (Razorpay sends no Supabase JWT).
import { createClient } from "jsr:@supabase/supabase-js@2";

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const entity = (new URL(req.url).searchParams.get("entity") ?? "").replace(/-/g, "_");
  const secret = Deno.env.get(`RAZORPAY_WEBHOOK_SECRET__${entity}`);
  if (!entity || !secret) return new Response("Unknown entity", { status: 400 });

  const raw = await req.text();
  if (!safeEqual(await hmacHex(secret, raw), req.headers.get("x-razorpay-signature") ?? "")) {
    return new Response("Bad signature", { status: 401 });
  }

  const evt = JSON.parse(raw);
  const qrId: string | undefined = evt.payload?.qr_code?.entity?.id;
  const payment = evt.payload?.payment?.entity;
  if (!qrId || !payment) return new Response("ignored", { status: 200 });   // not a POS QR event

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.rpc("pos_gateway_payment", {
    p_gateway_ref: qrId,
    p_gateway_payment_id: payment.id,
    p_amount: Number(payment.amount) / 100,
    p_status: evt.event === "payment.failed" ? "failed" : "captured",
  });
  // a 5xx makes Razorpay retry; the RPC is idempotent on the payment id
  if (error) return new Response(error.message, { status: 500 });
  return new Response("ok", { status: 200 });
});
