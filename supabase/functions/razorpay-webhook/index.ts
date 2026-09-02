// supabase/functions/razorpay-webhook/index.ts
//
// Razorpay calls this directly (not from the browser) — there is no
// Supabase user session here, so this function must be deployed
// WITHOUT JWT verification:
//
//   supabase functions deploy razorpay-webhook --no-verify-jwt
//
// Security instead comes entirely from the webhook signature check
// below. Configure this exact URL in Razorpay Dashboard -> Webhooks:
//   https://<your-project-ref>.supabase.co/functions/v1/razorpay-webhook

import { corsHeaders } from "../_shared/cors.ts";
import { getAdminClient, fulfillOrder } from "../_shared/fulfill.ts";

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text(); // signature is computed over the RAW body — must read as text first
    const signatureHeader = req.headers.get("x-razorpay-signature");
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;

    if (!signatureHeader) {
      return new Response("Missing signature", { status: 400 });
    }

    const expectedSignature = await hmacHex(webhookSecret, rawBody);
    if (expectedSignature !== signatureHeader) {
      // Never trust an unsigned/mis-signed payload, regardless of content.
      return new Response("Invalid signature", { status: 400 });
    }

    const event = JSON.parse(rawBody);

    // Only act on a captured payment; ignore everything else (order
    // creation notifications, refund events, etc. — those aren't
    // fulfillment triggers here).
    if (event.event !== "payment.captured") {
      return new Response(JSON.stringify({ received: true, ignored: event.event }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payment = event.payload?.payment?.entity;
    if (!payment || !payment.order_id || !payment.id) {
      return new Response("Malformed payload", { status: 400 });
    }

    const supabaseAdmin = getAdminClient();

    // Reuses the EXACT same atomic-claim fulfillment function as
    // verify-razorpay-payment. If the browser callback already
    // fulfilled this order, this call finds fulfilled = true and
    // grants nothing a second time.
    await fulfillOrder(supabaseAdmin, payment.order_id, payment.id);

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("razorpay-webhook error:", err);
    // Still return 200 for signature/parsing issues we've already
    // handled above; only genuine unexpected errors 500 here so
    // Razorpay's retry behavior stays sane.
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
