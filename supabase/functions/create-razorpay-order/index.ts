// supabase/functions/create-razorpay-order/index.ts
//
// POST body: { product_id: string }
// Returns: { order_id, amount, currency, key_id, product_name }
//
// Deploy: supabase functions deploy create-razorpay-order
// (JWT verification stays ON for this one — only logged-in
// students may call it.)

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/fulfill.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Identify the calling student from their own session JWT —
    // never trust a user_id sent in the request body.
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

    const { product_id, is_upgrade } = await req.json();
    if (!product_id) {
      return new Response(JSON.stringify({ error: "product_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client — the ONLY thing trusted for price/credits/
    // validity/pass_type. The browser sends nothing but product_id
    // (and, for a pass, is_upgrade — a ROUTING HINT ONLY, never
    // trusted for pricing: resolve_pass_purchase() independently
    // re-validates whether an upgrade is actually valid for this user
    // and rejects outright if not, rather than silently reinterpreting
    // it as a normal purchase or vice versa).
    const supabaseAdmin = getAdminClient();

    const { data: product, error: productError } = await supabaseAdmin
      .from("products")
      .select("*")
      .eq("id", product_id)
      .eq("active", true)
      .maybeSingle();

    if (productError) throw productError;
    if (!product) {
      return new Response(JSON.stringify({ error: "Product not found or not available" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let effectivePrice: number;
    let transactionType = "PURCHASE";
    let upgradeFromPassId: string | null = null;

    if (product.product_type === "PASS") {
      // The single authoritative eligibility+pricing check for passes
      // — current entitlement, purchase vs. upgrade eligibility, and
      // the correct price (regular/offer for a purchase, or the
      // source pass's own upgrade_to_combo_price for an upgrade) all
      // decided here, from the database, independently of anything
      // the client believes about its own state.
      const { data: resolved, error: resolveError } = await supabaseAdmin
        .rpc("resolve_pass_purchase", { p_product_id: product_id, p_is_upgrade: !!is_upgrade })
        .single();
      if (resolveError) throw resolveError;

      if (!resolved.allowed) {
        return new Response(JSON.stringify({ error: "Not eligible for this purchase", reason: resolved.reason }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      effectivePrice = Number(resolved.effective_price);
      transactionType = resolved.transaction_type;
      upgradeFromPassId = resolved.upgrade_from_pass_id;
    } else {
      // Non-pass products (credit packages) are unaffected by any of
      // the upgrade/entitlement logic above — same pricing path as
      // before this feature.
      const { data: computed, error: priceError } = await supabaseAdmin.rpc("compute_effective_price", {
        p_price: product.price,
        p_discount_enabled: product.discount_enabled,
        p_discount_type: product.discount_type,
        p_discount_value: product.discount_value,
        p_discount_start_at: product.discount_start_at,
        p_discount_end_at: product.discount_end_at,
      });
      if (priceError) throw priceError;
      effectivePrice = Number(computed);
    }

    const amountInPaise = Math.round(effectivePrice * 100);

    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID")!;
    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
    const basicAuth = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);

    const razorpayRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${basicAuth}`,
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: product.currency || "INR",
        receipt: `ts_${product.id}_${Date.now()}`,
        notes: {
          product_id: product.id,
          product_type: product.product_type,
          user_id: user.id,
        },
      }),
    });

    const order = await razorpayRes.json();
    if (!razorpayRes.ok) {
      console.error("Razorpay order creation failed:", order);
      return new Response(JSON.stringify({ error: "Could not create payment order" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record the transaction now, status 'created' — this is the row
    // verify-razorpay-payment / razorpay-webhook will later claim and
    // mark 'paid', exactly once. transaction_type distinguishes an
    // upgrade from a normal purchase for both fulfillment (which
    // branch runs) and reporting (spec: never combine upgrade revenue
    // with normal Combo purchase revenue). upgrade_from_pass_id is
    // stored in metadata rather than a new dedicated column, since it
    // is only ever meaningful for the one UPGRADE case.
    const { error: insertError } = await supabaseAdmin.from("purchase_transactions").insert({
      user_id: user.id,
      order_id: order.id,
      payment_gateway: "razorpay",
      product_id: product.id,
      product_type: product.product_type,
      pass_type: product.pass_type,
      credits: product.credits,
      amount: effectivePrice,
      currency: product.currency || "INR",
      validity_days: product.validity_days,
      status: "created",
      transaction_type: transactionType,
      metadata: upgradeFromPassId ? { upgrade_from_pass_id: upgradeFromPassId } : null,
    });
    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({
        order_id: order.id,
        amount: amountInPaise,
        currency: order.currency,
        key_id: razorpayKeyId, // public key only — the secret never leaves the server
        product_name: product.name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-razorpay-order error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
