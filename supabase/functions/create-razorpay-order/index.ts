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

    const { product_id } = await req.json();
    if (!product_id) {
      return new Response(JSON.stringify({ error: "product_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client — the ONLY thing trusted for price/credits/
    // validity/pass_type. The browser sends nothing but product_id.
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

    // Razorpay expects amounts in the smallest currency unit (paise
    // for INR) — computed from the database price, never a browser
    // value.
    const amountInPaise = Math.round(Number(product.price) * 100);

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
    // mark 'paid', exactly once.
    const { error: insertError } = await supabaseAdmin.from("purchase_transactions").insert({
      user_id: user.id,
      order_id: order.id,
      payment_gateway: "razorpay",
      product_id: product.id,
      product_type: product.product_type,
      pass_type: product.pass_type,
      credits: product.credits,
      amount: product.price,
      currency: product.currency || "INR",
      validity_days: product.validity_days,
      status: "created",
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
