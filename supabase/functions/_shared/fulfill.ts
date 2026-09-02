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

  // The claim above is already atomic and prevents double-granting —
  // but if granting itself fails AFTER that claim succeeds (a
  // transient DB error, extend_or_create_pass rejecting an
  // unexpected value, etc.), the row is already fulfilled=true and a
  // retry from either caller would see alreadyFulfilled and never
  // grant anything. Reverting the claim on any grant failure is what
  // actually closes that gap: it puts the row back to fulfilled=false
  // so the NEXT retry (webhook or browser callback) can re-enter the
  // atomic claim above and try granting again, instead of the
  // purchase being silently stuck as "paid" with nothing delivered.
  try {
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
  } catch (grantError) {
    const { error: revertError } = await supabaseAdmin
      .from("purchase_transactions")
      .update({ fulfilled: false })
      .eq("order_id", orderId)
      .eq("fulfilled", true); // only reverts the row THIS call just claimed, never a row some other successful call already finished granting for

    if (revertError) {
      // The double-failure case a single revert attempt can't fully
      // rule out: the grant failed AND the revert itself failed. No
      // retry can self-heal from here — this transaction needs a
      // human to look at payment_gateway_id (paymentId) and
      // order_id directly. Logged distinctly from the grant error
      // itself so this specific, worse outcome isn't lost in the
      // stack trace of an ordinary retryable failure.
      console.error(
        `fulfillOrder: grant failed AND revert failed for order ${orderId} (payment ${paymentId}) — ` +
        `this purchase_transactions row is now stuck fulfilled=true with nothing granted. Manual fix required.`,
        { grantError, revertError }
      );
    }
    throw grantError; // preserves the original failure for the caller's own error handling/logging — never masked by revert bookkeeping
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
