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

    // Refund lifecycle: record a completed full refund so the
    // transaction no longer appears as a normal paid purchase.
    // Partial refunds are recorded in metadata but do not revoke access
    // automatically because the product may already have been consumed.
    if (event.event === "refund.processed") {
      const refund = event.payload?.refund?.entity;
      const payment = event.payload?.payment?.entity;
      const paymentId = refund?.payment_id || payment?.id;

      if (!refund || !paymentId || !refund.id) {
        return new Response("Malformed refund payload", { status: 400 });
      }

      const supabaseAdmin = getAdminClient();
      const { data: txn, error: txnError } = await supabaseAdmin
        .from("purchase_transactions")
        .select("id, amount, status, fulfilled, metadata")
        .eq("payment_gateway_id", paymentId)
        .maybeSingle();

      if (txnError) throw txnError;
      if (!txn) {
        return new Response(JSON.stringify({ received: true, ignored: "unknown_payment" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const refundAmount = Number(refund.amount || 0);
      const transactionAmountInPaise = Math.round(Number(txn.amount) * 100);
      const existingMetadata = txn.metadata && typeof txn.metadata === "object"
        ? txn.metadata
        : {};

      if (refundAmount >= transactionAmountInPaise) {
        const { error: updateError } = await supabaseAdmin
          .from("purchase_transactions")
          .update({
            status: "refunded",
            metadata: {
              ...existingMetadata,
              refund_id: refund.id,
              refund_amount: refundAmount,
              refund_status: "processed",
            },
          })
          .eq("id", txn.id);

        if (updateError) throw updateError;
      } else {
        const { error: updateError } = await supabaseAdmin
          .from("purchase_transactions")
          .update({
            metadata: {
              ...existingMetadata,
              last_refund_id: refund.id,
              last_refund_amount: refundAmount,
              last_refund_status: "processed",
            },
          })
          .eq("id", txn.id);

        if (updateError) throw updateError;
      }

      return new Response(JSON.stringify({ received: true, refund_recorded: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only act on a captured payment. Other signed Razorpay events do not
    // grant entitlements.
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

    // Validate the signed Razorpay payload against our own transaction
    // record before granting anything. Signature authenticity alone does
    // not replace our application-level amount/currency invariant.
    const { data: txn, error: txnError } = await supabaseAdmin
      .from("purchase_transactions")
      .select("amount, currency")
      .eq("order_id", payment.order_id)
      .maybeSingle();

    if (txnError) throw txnError;
    if (!txn) {
      return new Response(JSON.stringify({ error: "Unknown order" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expectedAmountInPaise = Math.round(Number(txn.amount) * 100);
    const expectedCurrency = (txn.currency || "INR").toUpperCase();
    if (
      payment.amount !== expectedAmountInPaise ||
      String(payment.currency || "").toUpperCase() !== expectedCurrency
    ) {
      console.error(
        `Webhook amount mismatch for order ${payment.order_id}: expected ${expectedAmountInPaise} ${expectedCurrency}, Razorpay reports ${payment.amount} ${payment.currency}`
      );
      return new Response(JSON.stringify({ error: "Payment amount does not match the expected order amount" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
