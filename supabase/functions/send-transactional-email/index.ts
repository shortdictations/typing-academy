import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL");

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayName(user: any): string {
  const meta = user?.user_metadata || {};
  return String(meta.full_name || meta.name || [meta.first_name, meta.last_name].filter(Boolean).join(" ") || "there").trim();
}

function passLabel(passType: string | null | undefined): string {
  if (passType === "SSC") return "SSC Pass";
  if (passType === "LEGAL") return "Legal Pass";
  if (passType === "COMBO") return "Combo Pass";
  return "TypeShala Pass";
}

async function sendEmail(to: string, subject: string, html: string, idempotencyKey: string) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    throw new Error("Transactional email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [to],
      subject,
      html,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Resend returned HTTP ${response.status}`);
  }
  return data;
}

function purchaseEmailHtml(name: string, txn: any, productName: string, passExpiry: string | null, creditBalance: number | null) {
  const isPass = txn.product_type === "PASS";
  const isCredit = txn.product_type === "CREDIT";
  const benefit = isPass
    ? `${passLabel(txn.pass_type)}${txn.transaction_type === "UPGRADE" ? " — Upgrade" : ""}`
    : `${txn.credits || 0} Test Credits`;

  const detail = isPass && passExpiry
    ? `Active until <strong>${esc(new Date(passExpiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }))}</strong>.`
    : isCredit
      ? `Your available credit balance is now <strong>${esc(creditBalance ?? "—")}</strong>.`
      : "Your purchase has been activated on your TypeShala account.";

  return `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:Arial,sans-serif;color:#1f2937">
  <div style="max-width:620px;margin:32px auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
    <div style="padding:24px 28px;border-bottom:1px solid #eee"><strong style="font-size:22px;color:#8f2f24">TypeShala</strong></div>
    <div style="padding:30px 28px">
      <h1 style="margin:0 0 10px;font-size:24px">Purchase successful</h1>
      <p style="margin:0 0 22px;color:#667085">Hi ${esc(name)}, your TypeShala purchase has been successfully completed.</p>
      <div style="background:#faf9f6;border:1px solid #ece8df;border-radius:10px;padding:18px">
        <div style="font-size:13px;color:#667085">Product</div><div style="font-size:17px;font-weight:700;margin-top:4px">${esc(productName || benefit)}</div>
        <div style="margin-top:14px;font-size:13px;color:#667085">Amount paid</div><div style="font-size:16px;font-weight:700;margin-top:4px">₹${esc(Number(txn.amount || 0).toFixed(2))}</div>
        <div style="margin-top:14px;font-size:13px;color:#667085">Order ID</div><div style="font-size:13px;margin-top:4px;word-break:break-all">${esc(txn.order_id)}</div>
        <div style="margin-top:14px;font-size:13px;color:#667085">Payment ID</div><div style="font-size:13px;margin-top:4px;word-break:break-all">${esc(txn.payment_gateway_id)}</div>
      </div>
      <p style="margin:20px 0 0;line-height:1.6">${detail}</p>
      <p style="margin:24px 0 0;color:#667085;font-size:13px">You can start using your entitlement immediately after signing in to TypeShala.</p>
    </div>
    <div style="padding:18px 28px;background:#faf9f6;color:#667085;font-size:12px">© TypeShala 2026. This is a transactional email related to your account.</div>
  </div></body></html>`;
}

function giftEmailHtml(name: string, campaign: any) {
  const benefit = campaign.benefit_type === "CREDITS"
    ? `${campaign.credits} Test Credits`
    : passLabel(campaign.benefit_type);
  return `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:Arial,sans-serif;color:#1f2937">
  <div style="max-width:620px;margin:32px auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
    <div style="padding:24px 28px;border-bottom:1px solid #eee"><strong style="font-size:22px;color:#8f2f24">TypeShala</strong></div>
    <div style="padding:30px 28px">
      <h1 style="margin:0 0 10px;font-size:24px">You've received a gift 🎁</h1>
      <p style="margin:0 0 22px;color:#667085">Hi ${esc(name)}, a TypeShala benefit has been added to your account.</p>
      <div style="background:#faf9f6;border:1px solid #ece8df;border-radius:10px;padding:18px">
        <div style="font-size:13px;color:#667085">Gift</div><div style="font-size:18px;font-weight:700;margin-top:4px">${esc(benefit)}</div>
        <div style="margin-top:14px;font-size:13px;color:#667085">Validity</div><div style="font-size:16px;font-weight:700;margin-top:4px">${esc(campaign.validity_days)} days</div>
        <div style="margin-top:14px;font-size:13px;color:#667085">From</div><div style="font-size:15px;font-weight:700;margin-top:4px">TypeShala</div>
      </div>
      <p style="margin:20px 0 0;line-height:1.6">The benefit is already active on your TypeShala account. Sign in to start using it.</p>
    </div>
    <div style="padding:18px 28px;background:#faf9f6;color:#667085;font-size:12px">© TypeShala 2026. This is a transactional account notification.</div>
  </div></body></html>`;
}

async function getAuthContext(req: Request) {
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  let defaultSecret = "";
  try {
    defaultSecret = JSON.parse(secretKeysRaw || "{}")?.default || "";
  } catch {}

  const apiKey = req.headers.get("apikey") || "";
  if ((serviceRole && apiKey === serviceRole) || (defaultSecret && apiKey === defaultSecret)) {
    return { kind: "service" as const, user: null };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return { kind: "none" as const, user: null };

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return { kind: "none" as const, user: null };
  return { kind: "user" as const, user };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const ctx = await getAuthContext(req);
    if (ctx.kind === "none") {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const body = await req.json();
    const type = body?.type;

    if (type === "purchase") {
      if (ctx.kind !== "service") {
        return new Response(JSON.stringify({ error: "Internal access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const transactionId = body?.purchase_transaction_id;
      if (!transactionId) throw new Error("purchase_transaction_id is required");

      const { data: txn, error: txnError } = await admin
        .from("purchase_transactions")
        .select("*")
        .eq("id", transactionId)
        .maybeSingle();
      if (txnError) throw txnError;
      if (!txn || txn.status !== "paid" || txn.fulfilled !== true) throw new Error("Purchase is not fully fulfilled");

      if (txn.receipt_email_sent_at) {
        return new Response(JSON.stringify({ success: true, already_sent: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: user, error: userError } = await admin.auth.admin.getUserById(txn.user_id);
      if (userError) throw userError;
      if (!user?.user?.email) throw new Error("User has no email address");

      const { data: product } = txn.product_id
        ? await admin.from("products").select("name").eq("id", txn.product_id).maybeSingle()
        : { data: null };

      let passExpiry: string | null = null;
      let creditBalance: number | null = null;
      if (txn.product_type === "PASS") {
        const { data: pass } = await admin.from("user_passes").select("expires_at").eq("user_id", txn.user_id).eq("pass_type", txn.pass_type).eq("status", "active").order("expires_at", { ascending: false }).limit(1).maybeSingle();
        passExpiry = pass?.expires_at || null;
      } else if (txn.product_type === "CREDIT") {
        const { data: lots } = await admin.from("wallet_credits").select("credits_remaining").eq("user_id", txn.user_id);
        creditBalance = (lots || []).reduce((sum, row) => sum + Number(row.credits_remaining || 0), 0);
      }

      await sendEmail(user.user.email, txn.transaction_type === "UPGRADE" ? "Your TypeShala upgrade is active" : "Your TypeShala purchase is confirmed", purchaseEmailHtml(displayName(user.user), txn, product?.name || "", passExpiry, creditBalance), `purchase/${txn.id}`);
      const { error: markError } = await admin.from("purchase_transactions").update({ receipt_email_sent_at: new Date().toISOString() }).eq("id", txn.id).is("receipt_email_sent_at", null);
      if (markError) throw markError;

      return new Response(JSON.stringify({ success: true, sent: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (type === "campaign") {
      if (ctx.kind !== "user" || !ctx.user) {
        return new Response(JSON.stringify({ error: "Admin login required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: isAdmin } = await admin.from("admins").select("user_id").eq("user_id", ctx.user.id).maybeSingle();
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const campaignId = body?.campaign_id;
      if (!campaignId) throw new Error("campaign_id is required");

      const { data: campaign, error: campaignError } = await admin.from("promotional_campaigns").select("*").eq("id", campaignId).maybeSingle();
      if (campaignError) throw campaignError;
      if (!campaign) throw new Error("Campaign not found");

      const { data: grants, error: grantsError } = await admin.from("promotional_grants").select("id,user_id,email_sent_at,status").eq("campaign_id", campaignId).eq("status","GRANTED").is("email_sent_at",null).limit(100);
      if (grantsError) throw grantsError;

      let sent = 0;
      for (const grant of grants || []) {
        const { data: user, error: userError } = await admin.auth.admin.getUserById(grant.user_id);
        if (userError || !user?.user?.email) continue;
        try {
          await sendEmail(user.user.email, "You've received a TypeShala gift 🎁", giftEmailHtml(displayName(user.user), campaign), `gift/${grant.id}`);
          const { error: markError } = await admin.from("promotional_grants").update({ email_sent_at: new Date().toISOString() }).eq("id", grant.id).is("email_sent_at", null);
          if (!markError) sent++;
        } catch (emailError) {
          console.error("Gift email failed:", emailError);
        }
      }

      return new Response(JSON.stringify({ success: true, sent, pending: Math.max(0, (grants || []).length - sent) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown email type" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("send-transactional-email error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
