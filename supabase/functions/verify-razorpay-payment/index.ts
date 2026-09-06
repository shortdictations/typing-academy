// supabase/functions/verify-razorpay-payment/index.ts
//
// POST body: { razorpay_payment_id, razorpay_order_id, razorpay_signature }
// Returns: { success, product_type, product_name, already_fulfilled }
//
// Deploy: supabase functions deploy verify-razorpay-payment
// (JWT verification stays ON — only the logged-in student who
// started the purchase should be calling this.)

import { createClient } from "npm:@supabase/supabase-js@2";
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = await req.json();
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return new Response(JSON.stringify({ error: "Missing payment details" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = getAdminClient();

    // Confirm this order actually belongs to the calling user before
    // doing anything else — a student must never be able to verify
    // (and thus fulfill) someone else's order_id.
    const { data: txn, error: txnError } = await supabaseAdmin
      .from("purchase_transactions")
      .select("user_id, amount, currency")
      .eq("order_id", razorpay_order_id)
      .maybeSingle();
    if (txnError) throw txnError;
    if (!txn || txn.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Order not found for this user" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-side signature verification — this is what actually
    // proves the payment is genuine. Checkout reporting "success" is
    // never trusted on its own.
    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
    const expectedSignature = await hmacHex(
      razorpayKeySecret,
      `${razorpay_order_id}|${razorpay_payment_id}`
    );

    if (expectedSignature !== razorpay_signature) {
      await supabaseAdmin
        .from("purchase_transactions")
        .update({ status: "failed" })
        .eq("order_id", razorpay_order_id)
        .eq("fulfilled", false); // never overwrite an already-fulfilled row
      return new Response(JSON.stringify({ error: "Payment signature verification failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Explicit amount check — a second, independent layer on top of
    // signature verification, not a replacement for it. The signature
    // alone already proves this payment_id/order_id pair is genuinely
    // from Razorpay, but it does not, by itself, prove the amount
    // Razorpay actually settled matches what create-razorpay-order
    // told Razorpay to charge at order-creation time. Fetching the
    // payment directly from Razorpay's API (never trusting anything
    // the browser sent about the amount) and comparing it against the
    // amount this same order was created with in
    // purchase_transactions catches any divergence between the two —
    // whichever end it originated from — before fulfillment ever runs.
    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID")!;
    const authHeader64 = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);
    const paymentRes = await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, {
      headers: { Authorization: `Basic ${authHeader64}` },
    });
    if (!paymentRes.ok) {
      throw new Error(`Could not fetch payment details from Razorpay (status ${paymentRes.status})`);
    }
    const paymentData = await paymentRes.json();

    if (paymentData.order_id !== razorpay_order_id) {
      return new Response(JSON.stringify({ error: "Payment does not match the expected order" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const expectedAmountInPaise = Math.round(Number(txn.amount) * 100);
    const expectedCurrency = (txn.currency || "INR").toUpperCase();
    if (paymentData.amount !== expectedAmountInPaise || (paymentData.currency || "").toUpperCase() !== expectedCurrency) {
      console.error(
        `Amount mismatch for order ${razorpay_order_id}: expected ${expectedAmountInPaise} ${expectedCurrency}, ` +
        `Razorpay reports ${paymentData.amount} ${paymentData.currency}`
      );
      await supabaseAdmin
        .from("purchase_transactions")
        .update({ status: "failed" })
        .eq("order_id", razorpay_order_id)
        .eq("fulfilled", false);
      return new Response(JSON.stringify({ error: "Payment amount does not match the expected order amount" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Razorpay's own payment status is the actual money-movement
    // truth — "captured" (or "authorized" for non-auto-capture flows)
    // is required before this is treated as a real, completed payment.
    if (paymentData.status !== "captured" && paymentData.status !== "authorized") {
      return new Response(JSON.stringify({ error: `Payment is not completed (status: ${paymentData.status})` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await fulfillOrder(supabaseAdmin, razorpay_order_id, razorpay_payment_id);

    return new Response(
      JSON.stringify({
        success: true,
        already_fulfilled: result.alreadyFulfilled,
        product_type: result.productType,
        product_name: result.productName,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("verify-razorpay-payment error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
