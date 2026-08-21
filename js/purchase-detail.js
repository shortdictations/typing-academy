/* ============================================================
   purchase-detail.js
   ------------------------------------------------------------
   Read-only, single-transaction view. RLS on purchase_transactions
   (auth.uid() = user_id) means fetching an id that doesn't belong
   to the logged-in user simply returns nothing — the "not found"
   state below is what a spoofed/foreign ?id= actually produces,
   not a special case this file has to defend against itself.

   Neither user_passes nor wallet_credits has a direct foreign key
   back to the transaction that created it (checked directly against
   the live schema before writing this) — this associates a PASS/
   CREDIT transaction with its resulting pass/credit-lot row by
   matching user_id + type/amount + closest created_at, since that's
   the best available signal without altering the existing
   purchase-fulfillment logic. It's a best-effort display
   association only; it never feeds back into any deduction/access
   decision — those still come entirely from get_mock_access() and
   the wallet_credits/user_passes tables directly, untouched.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  const txnId = params.get("id");
  const body = document.getElementById("phDetailBody");

  if (!txnId) {
    body.innerHTML = notFoundHtml();
    return;
  }

  const { data: txn, error } = await supabaseClient
    .from("purchase_transactions")
    .select("*, products(name, description, features)")
    .eq("id", txnId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !txn) {
    body.innerHTML = notFoundHtml();
    return;
  }

  if (txn.product_type === "PASS") {
    renderPassDetail(txn, user.id, body);
  } else {
    renderCreditDetail(txn, user.id, body);
  }
});

function notFoundHtml() {
  return `
    <div class="ph-empty-state">
      <div class="ph-empty-title">Transaction not found</div>
      <p class="ph-empty-sub">This purchase doesn't exist, or isn't linked to your account.</p>
      <a class="btn dash-btn-primary" href="purchase-history.html">Back to Purchase History</a>
    </div>`;
}

const STATUS_META = {
  paid: { label: "Payment Successful", cls: "ph-status-success" },
  pending: { label: "Payment Processing", cls: "ph-status-processing" },
  created: { label: "Payment Processing", cls: "ph-status-processing" },
  failed: { label: "Payment Failed", cls: "ph-status-failed" },
  refunded: { label: "Refunded", cls: "ph-status-refunded" }
};

function transactionDisplayName(t) {
  if (t.products && t.products.name) return t.products.name;
  if (t.product_type === "PASS") return (t.pass_type || "") + " Pass";
  return (t.credits || "?") + " Test Credits";
}

function purchaseInfoHtml(t) {
  const dateStr = new Date(t.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const rows = [
    ["Purchase Date", dateStr],
    ["Order ID", t.order_id || "—"],
  ];
  // Only shown if it actually exists — never invented for a
  // created/pending/failed transaction that never reached a gateway.
  if (t.payment_gateway_id) rows.push(["Payment ID", t.payment_gateway_id]);
  rows.push(["Payment Method", t.payment_gateway || "—"]);

  return `
    <div class="ph-detail-section">
      <div class="ph-detail-section-title">Purchase Information</div>
      ${rows.map(([label, val]) => `<div class="ph-detail-row"><span>${label}</span><strong>${escapeHtmlPD(val)}</strong></div>`).join("")}
    </div>`;
}

function statusBannerHtml(t) {
  const meta = STATUS_META[t.status] || { label: t.status, cls: "" };
  let note = "";
  if (t.status === "pending" || t.status === "created") {
    note = '<p class="ph-status-note">Your payment is being verified. Your pass/credits will be activated after confirmation.</p>';
  }
  const retryBtn = (t.status === "failed" && t.product_id)
    ? `<button type="button" class="btn dash-btn-primary" id="phRetryBtn" data-product-id="${t.product_id}" data-product-type="${t.product_type}" ${t.pass_type ? 'data-pass-type="' + t.pass_type + '"' : ""} ${t.credits ? 'data-credits="' + t.credits + '"' : ""}>Try Again <span aria-hidden="true">&rarr;</span></button>`
    : "";
  return `
    <div class="ph-detail-head">
      <div class="ph-detail-name">${escapeHtmlPD(transactionDisplayName(t))}</div>
      <div class="ph-detail-status ${meta.cls}"><span class="ph-status-dot"></span>${meta.label}</div>
      <div class="ph-detail-amount">&#8377;${t.amount != null ? t.amount : "—"}</div>
      ${note}
      ${retryBtn}
    </div>`;
}

async function renderPassDetail(t, userId, body) {
  // Only a PAID transaction could have actually created a pass row —
  // for anything else (processing/failed/created), there's nothing
  // to match yet, and searching anyway risks pairing this
  // transaction with some OTHER paid transaction's real pass purely
  // because it's the closest timestamp (confirmed this happening
  // directly in testing before adding this guard — a "processing"
  // credit transaction was showing another transaction's real,
  // already-in-use credit lot). The status banner above already
  // explains processing/failed states; no section is better than a
  // wrong one.
  if (t.status !== "paid") {
    body.innerHTML = statusBannerHtml(t) + purchaseInfoHtml(t);
    wireRetryButton();
    return;
  }

  // Best-effort association — see file header. Matched by same
  // user + pass_type, picking whichever user_passes row's own
  // created_at sits closest to this transaction's.
  const { data: candidates } = await supabaseClient
    .from("user_passes")
    .select("*")
    .eq("user_id", userId)
    .eq("pass_type", t.pass_type);

  const matchedPass = closestByTime(candidates, t.paid_at || t.created_at);

  const access = (t.products && t.products.features && t.products.features[0])
    || (t.products && t.products.description)
    || null;

  let passSection = "";
  if (matchedPass) {
    const now = new Date();
    const isActive = matchedPass.status !== "cancelled" && new Date(matchedPass.expires_at) > now;
    passSection = `
      <div class="ph-detail-section">
        <div class="ph-detail-section-title">Pass Details</div>
        <div class="ph-detail-row"><span>Pass</span><strong>${escapeHtmlPD(transactionDisplayName(t))}</strong></div>
        <div class="ph-detail-row"><span>Validity</span><strong>${t.validity_days ? t.validity_days + " Days" : "—"}</strong></div>
        <div class="ph-detail-row"><span>Activated</span><strong>${formatDatePD(matchedPass.starts_at)}</strong></div>
        <div class="ph-detail-row"><span>Expires</span><strong>${formatDatePD(matchedPass.expires_at)}</strong></div>
        ${access ? `<div class="ph-detail-row"><span>Access</span><strong>${escapeHtmlPD(access)}</strong></div>` : ""}
        <div class="ph-detail-row"><span>Current Status</span><strong>${isActive ? "&#128994; Active" : "&#9898; Expired"}</strong></div>
      </div>`;
  } else {
    // Paid, but no matching pass row found (e.g. very old data) —
    // say so plainly rather than showing blank/guessed fields.
    passSection = `<div class="ph-detail-section"><div class="ph-detail-section-title">Pass Details</div><p class="ph-status-note">Pass details for this purchase are not currently available.</p></div>`;
  }

  body.innerHTML = statusBannerHtml(t) + purchaseInfoHtml(t) + passSection;
  wireRetryButton();
}

async function renderCreditDetail(t, userId, body) {
  // Same reasoning as renderPassDetail above — only search for a
  // matching credit lot when this specific transaction actually
  // succeeded.
  if (t.status !== "paid") {
    body.innerHTML = statusBannerHtml(t) + purchaseInfoHtml(t);
    wireRetryButton();
    return;
  }

  const { data: candidates } = await supabaseClient
    .from("wallet_credits")
    .select("*")
    .eq("user_id", userId)
    .eq("credit_type", "purchased")
    .eq("credits_total", t.credits);

  const matchedLot = closestByTime(candidates, t.paid_at || t.created_at);

  let creditSection = "";
  if (matchedLot) {
    const now = new Date();
    const expired = new Date(matchedLot.expires_at) <= now;
    const used = matchedLot.credits_total - matchedLot.credits_remaining;
    creditSection = `
      <div class="ph-detail-section">
        <div class="ph-detail-section-title">Credit Details</div>
        <div class="ph-detail-row"><span>Credits Purchased</span><strong>${matchedLot.credits_total}</strong></div>
        <div class="ph-detail-row"><span>Credits Used</span><strong>${used}</strong></div>
        <div class="ph-detail-row"><span>${expired ? "Unused at Expiry" : "Credits Remaining"}</span><strong>${matchedLot.credits_remaining}</strong></div>
        <div class="ph-detail-row"><span>Validity</span><strong>${t.validity_days ? t.validity_days + " Days" : "—"}</strong></div>
        <div class="ph-detail-row"><span>${expired ? "Expired" : "Expires"}</span><strong>${formatDatePD(matchedLot.expires_at)}</strong></div>
        <div class="ph-detail-row"><span>Status</span><strong>${expired ? "&#128308; Expired" : "&#128994; Active"}</strong></div>
      </div>
      <p class="ph-lot-note">This purchase is maintained as a separate credit lot with its own validity period.</p>`;
  } else {
    creditSection = `<div class="ph-detail-section"><div class="ph-detail-section-title">Credit Details</div><p class="ph-status-note">Credit lot details for this purchase are not currently available.</p></div>`;
  }

  body.innerHTML = statusBannerHtml(t) + purchaseInfoHtml(t) + creditSection;
  wireRetryButton();
}

function wireRetryButton() {
  const btn = document.getElementById("phRetryBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    // Same existing purchase flow every "Buy" button on
    // subscriptions.html uses — not a new/duplicate mechanism.
    startPurchase(btn.dataset.productId, {
      buttonEl: btn,
      onSuccess: () => { window.location.href = "purchase-history.html"; },
      onFailure: (message) => { alert(message); }
    });
  });
}

// Picks whichever candidate row's own created_at is nearest to the
// transaction's paid_at/created_at — see file header for why this
// heuristic exists instead of a direct foreign key.
function closestByTime(candidates, referenceIso) {
  if (!candidates || candidates.length === 0) return null;
  const ref = new Date(referenceIso).getTime();
  return candidates.reduce((best, c) => {
    const diff = Math.abs(new Date(c.created_at).getTime() - ref);
    const bestDiff = best ? Math.abs(new Date(best.created_at).getTime() - ref) : Infinity;
    return diff < bestDiff ? c : best;
  }, null);
}

function formatDatePD(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function escapeHtmlPD(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}
