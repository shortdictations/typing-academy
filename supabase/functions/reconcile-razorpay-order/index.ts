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
    const successful = payments.find((payment: any) =>
      (payment.status === "captured" || payment.status === "authorized") &&
      Number(payment.amount) === expectedAmount &&
      String(payment.currency || "").toUpperCase() === expectedCurrency
    );
    if (successful) {
      await fulfillOrder(admin, razorpay_order_id, successful.id);
      return json({ status: "paid", fulfilled: true });
    }

    const hasUnresolved = payments.some((payment: any) =>
      ["created", "authorized", "pending"].includes(String(payment.status || "").toLowerCase())
    );
    const allFailed = payments.length > 0 && payments.every((payment: any) =>
      ["failed", "cancelled"].includes(String(payment.status || "").toLowerCase())
    );

    // A status transition is conditional and never overwrites a fulfilled
    // purchase. If Razorpay has an unresolved attempt, leave it processing.
    if (hasUnresolved) {
      await admin.from("purchase_transactions").update({ status: "pending" })
        .eq("order_id", razorpay_order_id).eq("fulfilled", false).in("status", ["created", "pending"]);
      return json({ status: "pending" });
    }

    const nextStatus = payments.length === 0 ? "cancelled" : (allFailed ? "failed" : "pending");
    await admin.from("purchase_transactions").update({ status: nextStatus })
      .eq("order_id", razorpay_order_id).eq("fulfilled", false).in("status", ["created", "pending"]);
    return json({ status: nextStatus });
  } catch (error) {
    console.error("reconcile-razorpay-order error:", error);
    return json({ error: "Could not verify payment status. Please check Purchase History shortly." }, 500);
  }
});
