// _shared/fulfill.ts
//
// The ONE place that actually grants a product after a Razorpay
// payment is confirmed paid. Called from both verify-razorpay-payment
// (browser callback) and razorpay-webhook (server-to-server) — so
// whichever one arrives first does the granting, and the other is a
// safe no-op. That safety comes from the atomic "claim" step below,
// not from trusting the caller.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

interface FulfillResult {
  alreadyFulfilled: boolean;
  productType?: string;
  productName?: string;
}

export async function fulfillOrder(
  supabaseAdmin: SupabaseClient,
  orderId: string,
  paymentId: string
): Promise<FulfillResult> {
  // Atomic claim: only the FIRST caller to reach this can ever get a
  // row back, because the WHERE clause excludes rows already marked
  // fulfilled. A second simultaneous call (verify + webhook racing,
  // or verify called twice) matches zero rows and is treated as
  // "already handled" below — this is what makes fulfillment
  // idempotent, not any assumption about call order.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("purchase_transactions")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      payment_gateway: "razorpay",
      payment_gateway_id: paymentId,
      fulfilled: true,
    })
    .eq("order_id", orderId)
    .eq("fulfilled", false)
    .select("*, products(*)")
    .maybeSingle();

  if (claimError) throw claimError;

  if (!claimed) {
    // Either this order was already fulfilled by the other caller,
    // or the order_id doesn't exist. Either way: do NOT grant
    // anything again.
    return { alreadyFulfilled: true };
  }

  const product = claimed.products;

  if (claimed.product_type === "PASS") {
    // Reuses the EXISTING repurchase-extension function from Phase 1
    // (extend_or_create_pass) — same rule: extends from the current
    // expiry if a valid pass already exists, otherwise starts fresh.
    // No competing expiry logic created here.
    const { error: passError } = await supabaseAdmin.rpc("extend_or_create_pass", {
      p_user_id: claimed.user_id,
      p_pass_type: claimed.pass_type,
      p_validity_days: claimed.validity_days,
    });
    if (passError) throw passError;
  } else if (claimed.product_type === "CREDIT") {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + claimed.validity_days);

    const { error: creditError } = await supabaseAdmin.from("wallet_credits").insert({
      user_id: claimed.user_id,
      credit_type: "purchased",
      credits_total: claimed.credits,
      credits_remaining: claimed.credits,
      expires_at: expiresAt.toISOString(),
    });
    if (creditError) throw creditError;

    const { error: ledgerError } = await supabaseAdmin.from("credit_transactions").insert({
      user_id: claimed.user_id,
      transaction_type: "credit_purchase",
      credits: claimed.credits,
      source: product ? product.name : "Credit package purchase",
    });
    if (ledgerError) throw ledgerError;
  }

  return {
    alreadyFulfilled: false,
    productType: claimed.product_type,
    productName: product ? product.name : undefined,
  };
}

export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}
