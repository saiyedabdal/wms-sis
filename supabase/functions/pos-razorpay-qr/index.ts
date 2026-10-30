// Creates a single-use, amount-locked Razorpay UPI QR for a pending POS payment (Decision 4: dynamic UPI QR).
// The caller must be able to see the payment under RLS. Keys stay in Edge Function secrets, one pair per
// invoicing entity: RAZORPAY_KEY_ID__<ENTITY_CODE> / RAZORPAY_KEY_SECRET__<ENTITY_CODE> (code with - as _).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });

  let paymentId: number;
  try {
    paymentId = Number((await req.json()).payment_id);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // RLS decides whether this user may see the payment at all
  const { data: pay } = await caller.from("pos_payments")
    .select("id, invoice_id, amount, mode, status, gateway_ref").eq("id", paymentId).maybeSingle();
  if (!pay) return json({ error: "Payment not found" }, 404);
  if (pay.mode !== "upi_razorpay" || pay.status !== "pending") return json({ error: "This payment is not waiting for Razorpay" }, 409);

  const { data: inv } = await caller.from("pos_invoices").select("id, entity_id, facility_id").eq("id", pay.invoice_id).single();
  const { data: entity } = await caller.from("pos_entities").select("code, legal_name, razorpay_enabled").eq("id", inv!.entity_id).single();
  if (!entity?.razorpay_enabled) return json({ error: "Razorpay is not enabled for this invoicing entity" }, 409);

  const suffix = entity.code.replace(/-/g, "_");
  const keyId = Deno.env.get(`RAZORPAY_KEY_ID__${suffix}`);
  const keySecret = Deno.env.get(`RAZORPAY_KEY_SECRET__${suffix}`);
  if (!keyId || !keySecret) return json({ error: `Razorpay keys for ${entity.code} are not configured` }, 501);

  const res = await fetch("https://api.razorpay.com/v1/payments/qr_codes", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` },
    body: JSON.stringify({
      type: "upi_qr",
      name: entity.legal_name.slice(0, 40),
      usage: "single_use",
      fixed_amount: true,
      payment_amount: Math.round(Number(pay.amount) * 100),
      description: `POS payment ${pay.id}`,
      close_by: Math.floor(Date.now() / 1000) + 15 * 60,
      notes: { pos_payment_id: String(pay.id), pos_invoice_id: String(inv!.id), facility_id: String(inv!.facility_id) },
    }),
  });
  const qr = await res.json();
  if (!res.ok) return json({ error: qr?.error?.description ?? "Razorpay refused the QR request" }, 502);

  // link the QR to the payment so the webhook can find it (service role: pos_attach_gateway_ref is not for browsers)
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.rpc("pos_attach_gateway_ref", { p_payment_id: pay.id, p_gateway_ref: qr.id });
  if (error) return json({ error: error.message }, 500);

  return json({ qr_id: qr.id, image_url: qr.image_url, close_by: qr.close_by });
});
