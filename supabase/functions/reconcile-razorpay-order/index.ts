// Reconcile an order after checkout dismissal or a failed payment attempt.
// JWT verification stays enabled. This endpoint never trusts browser status.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getAdminClient, fulfillOrder } from "../_shared/fulfill.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Not authenticated" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Not authenticated" }, 401);

    const { razorpay_order_id } = await req.json();
    if (!razorpay_order_id || typeof razorpay_order_id !== "string") return json({ error: "Missing order ID" }, 400);

    const admin = getAdminClient();
    const { data: allowed, error: rateError } = await admin.rpc("check_edge_rate_limit", {
      p_rate_key: `reconcile-order:${user.id}`, p_limit: 20, p_window_seconds: 60,
    });
    if (rateError || allowed !== true) return json({ error: "Too many requests. Please try again shortly." }, 429);

    const { data: txn, error: txnError } = await admin.from("purchase_transactions")
      .select("id,user_id,order_id,amount,currency,status,fulfilled")
      .eq("order_id", razorpay_order_id).maybeSingle();
    if (txnError) throw txnError;
    if (!txn || txn.user_id !== user.id) return json({ error: "Order not found" }, 404);
    if (txn.status === "paid" && txn.fulfilled) return json({ status: "paid", fulfilled: true });

    const keyId = Deno.env.get("RAZORPAY_KEY_ID")!;
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")!;
    const auth = "Basic " + btoa(`${keyId}:${keySecret}`);
    const response = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpay_order_id)}/payments`, {
      headers: { Authorization: auth },
    });
    if (!response.ok) throw new Error(`Razorpay payment lookup failed: ${response.status}`);
    const payload = await response.json();
    const payments = Array.isArray(payload.items) ? payload.items : [];

    const expectedAmount = Math.round(Number(txn.amount) * 100);
    const expectedCurrency = String(txn.currency || "INR").toUpperCase();
    // Only captured payments are eligible for fulfillment. An authorized
    // payment is not proof of capture and must never grant a pass or credits.
    const successful = payments.find((payment: any) =>
      String(payment.status || "").toLowerCase() === "captured" &&
      Number(payment.amount) === expectedAmount &&
      String(payment.currency || "").toUpperCase() === expectedCurrency
    );
    if (successful) {
      await fulfillOrder(admin, razorpay_order_id, successful.id);
      return json({ status: "paid", fulfilled: true });
    }

    // Razorpay can leave an abandoned checkout attempt in "created".
    // Keep it processing briefly in case the customer is still completing
    // checkout; after a 2-minute grace period, it is treated as abandoned.
    // Any later captured payment is still recoverable through verified
    // reconciliation/webhook fulfillment.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const isRecentCreated = (payment: any) => {
      const createdAt = Number(payment.created_at || 0);
      return createdAt > 0 && nowSeconds - createdAt < 120;
    };
    const unresolved = payments.some((payment: any) => {
      const status = String(payment.status || "").toLowerCase();
      return status === "authorized" || status === "pending" ||
        (status === "created" && isRecentCreated(payment));
    });

    if (unresolved) {
      const { error: updateError } = await admin.from("purchase_transactions")
        .update({ status: "pending" })
        .eq("order_id", razorpay_order_id)
        .eq("fulfilled", false)
        .in("status", ["created", "pending", "cancelled", "failed"]);
      if (updateError) throw updateError;
      return json({ status: "pending" });
    }

    // No payments means checkout was opened and dismissed without creating
    // a payment. Aged "created" attempts are abandoned; all failed attempts
    // are failed. Unknown states remain pending rather than guessing.
    const statuses = payments.map((payment: any) => String(payment.status || "").toLowerCase());
    const allFailed = statuses.length > 0 && statuses.every((status: string) => status === "failed");
    const onlyAbandonedOrFailed = statuses.length > 0 && statuses.every((status: string, i: number) =>
      status === "failed" || (status === "created" && !isRecentCreated(payments[i]))
    );
    let nextStatus: string;
    if (payments.length === 0 || (onlyAbandonedOrFailed && !allFailed)) nextStatus = "cancelled";
    else if (allFailed) nextStatus = "failed";
    else nextStatus = "pending";

    const { error: updateError } = await admin.from("purchase_transactions")
      .update({ status: nextStatus })
      .eq("order_id", razorpay_order_id)
      .eq("fulfilled", false)
      .in("status", ["created", "pending", "cancelled", "failed"]);
    if (updateError) throw updateError;
    return json({ status: nextStatus });
  } catch (error) {
    console.error("reconcile-razorpay-order error:", error);
    return json({ error: "Could not verify payment status. Please check Purchase History shortly." }, 500);
  }
});
