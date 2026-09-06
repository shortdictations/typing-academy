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
  passType?: string;
  transactionType?: string;
}

export async function fulfillOrder(
  supabaseAdmin: SupabaseClient,
  orderId: string,
  paymentId: string
): Promise<FulfillResult> {
  // Atomic claim: move the transaction from `created` to a transient
  // `paid + fulfilled=false` state before granting anything. We use the
  // existing `paid` status rather than introducing a new enum/value, while
  // `fulfilled=false` tells us the entitlement is still being granted.
  // This matters because Razorpay's browser callback and webhook can arrive
  // at the same time: the second caller must wait for the first caller to
  // finish granting the pass, rather than seeing `fulfilled=true` early and
  // returning success while the entitlement is still being created.
  let claimed: any = null;

  for (let attempt = 0; attempt < 25; attempt++) {
    const { data: claim, error: claimError } = await supabaseAdmin
      .from("purchase_transactions")
      .update({ status: "paid" })
      .eq("order_id", orderId)
      .eq("status", "created")
      .eq("fulfilled", false)
      .select("*, products(*)")
      .maybeSingle();

    if (claimError) throw claimError;
    if (claim) {
      claimed = claim;
      break;
    }

    // Another verifier/webhook is already processing this same payment.
    // Wait for it to finish instead of returning a false-positive success.
    const { data: current, error: currentError } = await supabaseAdmin
      .from("purchase_transactions")
      .select("fulfilled, status, product_type, transaction_type, products(*)")
      .eq("order_id", orderId)
      .maybeSingle();

    if (currentError) throw currentError;
    if (!current) return { alreadyFulfilled: true };

    if (current.fulfilled === true && current.status === "paid") {
      return {
        alreadyFulfilled: true,
        productType: current.product_type,
        productName: current.products ? current.products.name : undefined,
        passType: current.pass_type || undefined,
        transactionType: current.transaction_type || undefined,
      };
    }

    // If the previous attempt reverted its claim after a grant failure,
    // the row is back to `created`; the next loop iteration can safely
    // claim it and retry the grant.
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  if (!claimed) {
    throw new Error(`Timed out waiting for payment fulfillment: ${orderId}`);
  }

  const product = claimed.products;

  // If granting fails after the claim, revert the row from the transient
  // `paid + fulfilled=false` state back to `created`. That lets the other
  // delivery path (or a later retry) safely claim it again instead of
  // leaving a paid purchase with no entitlement.
  try {
    if (claimed.product_type === "PASS" && claimed.transaction_type === "UPGRADE") {
      // SSC/LEGAL -> COMBO upgrade: converts the existing pass row in
      // place, preserving its expiry — never extend_or_create_pass,
      // which would treat this as a brand-new/renewed COMBO pass with
      // its own fresh validity period. upgrade_from_pass_id was set
      // at order-creation time by resolve_pass_purchase() (server-side,
      // from the student's actual entitlement then) — never anything
      // the client sent about which pass to convert.
      const upgradeFromPassId = claimed.metadata?.upgrade_from_pass_id;
      if (!upgradeFromPassId) {
        throw new Error(`UPGRADE transaction ${orderId} is missing upgrade_from_pass_id in metadata`);
      }
      const { error: upgradeError } = await supabaseAdmin.rpc("upgrade_pass_to_combo", {
        p_pass_id: upgradeFromPassId,
      });
      if (upgradeError) throw upgradeError;
    } else if (claimed.product_type === "PASS") {
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
      .update({ status: "created", fulfilled: false })
      .eq("order_id", orderId)
      .eq("status", "paid")
      .eq("fulfilled", false); // only reverts the row THIS call just claimed; a completed/paid row is never touched

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
        `this purchase_transactions row may be stuck in processing. Manual fix required.`,
        { grantError, revertError }
      );
    }
    throw grantError; // preserves the original failure for the caller's own error handling/logging — never masked by revert bookkeeping
  }

  // Only after the entitlement/credits have actually been granted do we
  // mark the transaction fulfilled and record its final paid_at timestamp.
  // This makes `fulfilled=true` a reliable signal that the user's access is
  // already visible in the DB.
  let completeError: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabaseAdmin
      .from("purchase_transactions")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        fulfilled: true,
      })
      .eq("order_id", orderId)
      .eq("status", "paid")
      .eq("fulfilled", false);

    completeError = error;
    if (!error) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  if (completeError) {
    // The entitlement itself has already been granted, so NEVER revert it
    // here. This is an exceptional bookkeeping failure and is logged for
    // manual inspection rather than risking a duplicate grant.
    throw completeError;
  }

  return {
    alreadyFulfilled: false,
    productType: claimed.product_type,
    productName: product ? product.name : undefined,
    passType: claimed.pass_type || undefined,
    transactionType: claimed.transaction_type || undefined,
  };
}

export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}
