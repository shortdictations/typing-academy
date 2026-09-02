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
      .select("user_id")
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
