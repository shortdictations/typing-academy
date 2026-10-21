/* ============================================================
   purchase-history.js
   ------------------------------------------------------------
   Reads purchase_transactions and displays payment records. When
   unfinished orders are visible, it requests server-side reconciliation;
   only the authenticated Edge Function may update transaction status.
   This page never directly grants or removes passes or credits.

   Filtering and "Load More" pagination both go back to the server
   (not client-side slicing of one fetched batch), so they stay
   correct together regardless of how many transactions of a given
   type/status exist.
   ============================================================ */

const PAGE_SIZE = 10;
let currentUser = null;
let currentOffset = 0;
let currentFilters = { type: "all", status: "all" };
let reachedEnd = false;
// Avoid repeated reconciliation calls while this page remains open.
const reconciliationAttempted = new Set();

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireLogin();
  if (!currentUser) return;

  wireFilters();
  await loadPage(true);
});

function wireFilters() {
  document.getElementById("phTypeFilter").addEventListener("click", (e) => {
    const btn = e.target.closest(".ph-filter-btn");
    if (!btn) return;
    document.querySelectorAll(".ph-filter-btn").forEach(b => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });
    currentFilters.type = btn.dataset.filterType;
    resetAndReload();
  });

  document.getElementById("phStatusFilter").addEventListener("change", (e) => {
    currentFilters.status = e.target.value;
    resetAndReload();
  });
}

function resetAndReload() {
  currentOffset = 0;
  reachedEnd = false;
  loadPage(true);
}

async function loadPage(replace) {
  const listEl = document.getElementById("phTransactionList");
  const loadMoreWrap = document.getElementById("phLoadMoreWrap");
  if (replace) listEl.innerHTML = '<div class="loading-strip">Loading your purchase history...</div>';

  let query = supabaseClient
    .from("purchase_transactions")
    .select("*, products(name, description, features)")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (currentFilters.type !== "all") query = query.eq("product_type", currentFilters.type);
  if (currentFilters.status !== "all") query = query.eq("status", currentFilters.status);

  query = query.range(currentOffset, currentOffset + PAGE_SIZE - 1);
  const { data, error } = await query;

  if (error) {
    listEl.innerHTML = '<div class="empty-state">Could not load your purchase history.</div>';
    loadMoreWrap.innerHTML = "";
    return;
  }

  // Reconcile visible unfinished orders with Razorpay when Purchase History
  // opens. This also repairs older rows that were left Processing by the
  // previous server logic. The server verifies payment status; browser state
  // is never used to mark an order cancelled or paid.
  const unfinished = data.filter(t =>
    (t.status === "created" || t.status === "pending") &&
    t.order_id &&
    !reconciliationAttempted.has(t.order_id)
  );
  if (unfinished.length) {
    unfinished.forEach(t => reconciliationAttempted.add(t.order_id));
    await Promise.all(unfinished.map(async t => {
      try {
        const { data: result, error: invokeError } = await supabaseClient.functions.invoke(
          "reconcile-razorpay-order",
          { body: { razorpay_order_id: t.order_id } }
        );
        if (invokeError) {
          console.warn("Purchase reconciliation deferred:", t.order_id, invokeError);
          return;
        }
        if (result?.error) {
          console.warn("Purchase reconciliation returned an error:", t.order_id, result.error);
        }
      } catch (error) {
        console.warn("Purchase reconciliation deferred:", t.order_id, error);
      }
    }));
    return loadPage(replace);
  }

  // Load the user's pass rows as well as credit lots. Purchase cards show
  // live remaining days for the matching pass, not the original validity.
  let passRows = [];
  const hasPaidPassPurchase = data.some(t => t.product_type === "PASS" && t.status === "paid");
  let passRowsAvailable = true;
  if (hasPaidPassPurchase) {
    const { data: passes, error: passesError } = await supabaseClient
      .from("user_passes")
      .select("pass_type, status, starts_at, expires_at, created_at")
      .eq("user_id", currentUser.id);
    if (passesError || !passes) {
      passRowsAvailable = false;
      console.warn("Could not load pass validity details:", passesError);
    } else {
      passRows = passes;
    }
  }

  // Load individual credit lots so each purchase shows its own balance and expiry.
  let creditLots = [];
  const hasPaidCreditPurchase = data.some(t => t.product_type === "CREDIT" && t.status === "paid");
  let creditLotsAvailable = true;
  if (hasPaidCreditPurchase) {
    const { data: lots, error: lotsError } = await supabaseClient
      .from("wallet_credits")
      .select("credit_type, credits_total, credits_remaining, expires_at, created_at")
      .eq("user_id", currentUser.id)
      .eq("credit_type", "purchased");
    if (lotsError || !lots) {
      creditLotsAvailable = false;
      console.warn("Could not load individual credit lots:", lotsError);
    } else {
      creditLots = lots;
    }
  }

  // Promotional benefits are displayed as FREE history entries.
  let promotions = [];
  if (replace) {
    const { data: promotionData, error: promotionsError } = await supabaseClient.rpc("get_my_promotional_history");
    if (promotionsError) console.warn("Could not load promotional history:", promotionsError);
    else promotions = promotionData || [];
  }

  if (replace && data.length === 0 && promotions.length === 0) {
    renderEmptyState(listEl, loadMoreWrap);
    return;
  }

  const promotionHtml = replace ? promotions.map(buildPromotionCardHtml).join("") : "";
  const cardsHtml = data.map(t => buildTransactionCardHtml(t, creditLots, creditLotsAvailable, passRows, passRowsAvailable)).join("");
  listEl.innerHTML = replace ? promotionHtml + cardsHtml : listEl.innerHTML + cardsHtml;

  currentOffset += data.length;
  reachedEnd = data.length < PAGE_SIZE;
  renderLoadMore(loadMoreWrap);
}

// A dedicated no-purchases-at-all state is only correct with NO
// filters active — if the user has purchases but the current
// filter/status combination matches none, that's a "no results for
// this filter" case, not "you've never purchased anything".
function renderEmptyState(listEl, loadMoreWrap) {
  loadMoreWrap.innerHTML = "";
  const filtersActive = currentFilters.type !== "all" || currentFilters.status !== "all";
  if (filtersActive) {
    listEl.innerHTML = '<div class="empty-state">No purchases match this filter.</div>';
    return;
  }
  listEl.innerHTML = `
    <div class="ph-empty-state">
      <div class="ph-empty-title">No purchases yet</div>
      <p class="ph-empty-sub">Your pass and credit purchases will appear here.</p>
      <a class="btn dash-btn-primary" href="subscriptions.html">Explore Passes <span aria-hidden="true">&rarr;</span></a>
    </div>`;
}

function renderLoadMore(loadMoreWrap) {
  if (reachedEnd) { loadMoreWrap.innerHTML = ""; return; }
  loadMoreWrap.innerHTML = '<button type="button" class="btn btn-ghost" id="phLoadMoreBtn">Load More</button>';
  document.getElementById("phLoadMoreBtn").addEventListener("click", () => loadPage(false));
}

const STATUS_META = {
  paid: { label: "Successful", cls: "ph-status-success" },
  pending: { label: "Processing", cls: "ph-status-processing" },
  created: { label: "Processing", cls: "ph-status-processing" },
  failed: { label: "Failed", cls: "ph-status-failed" },
  cancelled: { label: "Cancelled", cls: "ph-status-cancelled" },
  refunded: { label: "Refunded", cls: "ph-status-refunded" }
};

function transactionDisplayName(t) {
  // An upgrade uses the Combo product_id because that is the product
  // being unlocked, but it is NOT a normal Combo purchase. Keep the
  // transaction type authoritative for purchase-history presentation.
  if (t.product_type === "PASS" && String(t.transaction_type || "").toUpperCase() === "UPGRADE") {
    return "Upgrade to Combo";
  }
  if (t.products && t.products.name) return t.products.name;
  if (t.product_type === "PASS") return (t.pass_type || "") + " Pass";
  return (t.credits || "?") + " Test Credits";
}

function buildTransactionCardHtml(t, creditLots = [], creditLotsAvailable = true, passRows = [], passRowsAvailable = true) {
  const status = STATUS_META[t.status] || { label: t.status, cls: "" };
  const displayDate = new Date(t.paid_at || t.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const isUpgrade = t.product_type === "PASS" && String(t.transaction_type || "").toUpperCase() === "UPGRADE";
  const typeLabel = isUpgrade ? "Pass Upgrade" : (t.product_type === "PASS" ? "Pass" : "Credits");
  const meta = t.product_type === "CREDIT"
    ? creditPurchaseMeta(t, creditLots, creditLotsAvailable)
    : (t.product_type === "PASS"
      ? passPurchaseMeta(t, passRows, passRowsAvailable, typeLabel)
      : typeLabel);
  const icon = t.product_type === "PASS"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 10-10-5L2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>';

  return `
    <a class="ph-txn-card" href="purchase-detail.html?id=${encodeURIComponent(t.id)}">
      <div class="ph-txn-top">
        <span class="ph-txn-icon">${icon}</span>
        <span class="ph-txn-name">${escapeHtmlPH(transactionDisplayName(t))}</span>
        <span class="ph-txn-amount">&#8377;${t.amount != null ? t.amount : "—"}</span>
      </div>
      <div class="ph-txn-meta">${meta}</div>
      <div class="ph-txn-row2">
        <span class="ph-txn-date">${displayDate}</span>
        <span class="ph-txn-status ${status.cls}"><span class="ph-status-dot"></span>${status.label}</span>
      </div>
      <div class="ph-txn-row3">
        <span class="ph-txn-order">${t.order_id ? "Order: " + escapeHtmlPH(t.order_id) : ""}</span>
        <span class="ph-txn-view">View Details <span aria-hidden="true">&rarr;</span></span>
      </div>
    </a>`;
}

function passPurchaseMeta(t, passes, passesAvailable, typeLabel) {
  if (t.status === "created" || t.status === "pending") return "Pass &middot; Activation pending";
  if (t.status !== "paid") return typeLabel + " &middot; Payment not completed";
  if (!passesAvailable) return typeLabel + " &middot; Validity unavailable";

  const targetType = String(t.pass_type || "").toUpperCase();
  const matching = (passes || []).filter(p => String(p.pass_type || "").toUpperCase() === targetType && p.status !== "cancelled");
  if (!matching.length) return typeLabel + " &middot; Pass details unavailable";

  const now = Date.now();
  const active = matching.filter(p => new Date(p.expires_at).getTime() > now);
  const targetTime = new Date(t.paid_at || t.created_at).getTime();
  // Prefer the active pass with expiry nearest to this purchase's timestamp;
  // a pass upgrade may preserve the original pass row and expiry.
  const pool = active.length ? active : matching;
  const matched = pool.reduce((best, p) => {
    const distance = Math.abs(new Date(p.created_at || p.starts_at || p.expires_at).getTime() - targetTime);
    return !best || distance < best.distance ? { pass: p, distance } : best;
  }, null)?.pass;
  if (!matched) return typeLabel + " &middot; Pass details unavailable";

  const expiry = new Date(matched.expires_at).getTime();
  if (!Number.isFinite(expiry) || expiry <= now) return "Pass &middot; Expired";
  const daysLeft = Math.max(1, Math.ceil((expiry - now) / 86400000));
  return escapeHtmlPH(typeLabel) + " &middot; " + escapeHtmlPH(String(daysLeft)) +
    (daysLeft === 1 ? " day left" : " days left");
}
function creditPurchaseMeta(t, lots, lotsAvailable) {
  if (t.status === "created" || t.status === "pending") return "Credits &middot; Activation pending";
  if (t.status !== "paid") return "Credits &middot; Payment not completed";
  if (!lotsAvailable) return "Credits &middot; Balance unavailable";
  const targetTime = new Date(t.paid_at || t.created_at).getTime();
  const candidates = (lots || []).filter(lot => Number(lot.credits_total) === Number(t.credits));
  if (!candidates.length) return "Credits &middot; Activation pending";
  const matchedLot = candidates.reduce((best, lot) => {
    const distance = Math.abs(new Date(lot.created_at).getTime() - targetTime);
    return !best || distance < best.distance ? { lot, distance } : best;
  }, null)?.lot;
  if (!matchedLot) return "Credits &middot; Balance unavailable";
  const expiryTime = new Date(matchedLot.expires_at).getTime();
  if (!Number.isFinite(expiryTime) || expiryTime <= Date.now()) return "0 usable credits &middot; Expired";
  const daysLeft = Math.max(1, Math.ceil((expiryTime - Date.now()) / 86400000));
  const creditsLeft = Math.max(0, Number(matchedLot.credits_remaining) || 0);
  return escapeHtmlPH(String(creditsLeft)) + " credits left &middot; " +
    escapeHtmlPH(String(daysLeft)) + (daysLeft === 1 ? " day left" : " days left");
}
function escapeHtmlPH(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}


function buildPromotionCardHtml(g) {
  const date = new Date(g.granted_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const benefit = String(g.benefit_type || "").toUpperCase() === "CREDITS"
    ? ((g.credits || 0) + " Test Credits")
    : (g.campaign_name || "Promotional Pass");
  return `
    <div class="ph-txn-card ph-promotion-card">
      <div class="ph-txn-top">
        <span class="ph-txn-icon ph-promotion-icon">🎁</span>
        <span class="ph-txn-name">${escapeHtmlPH(g.campaign_name || "Promotional Offer")}</span>
        <span class="ph-txn-amount">FREE</span>
      </div>
      <div class="ph-txn-meta">Promotional Benefit &middot; ${escapeHtmlPH(benefit)}${g.validity_days ? " &middot; " + g.validity_days + " Days" : ""}</div>
      <div class="ph-txn-row2">
        <span class="ph-txn-date">${date}</span>
        <span class="ph-txn-status ph-status-success"><span class="ph-status-dot"></span>Granted</span>
      </div>
      <div class="ph-txn-row3">
        <span class="ph-txn-order">${escapeHtmlPH(g.campaign_name || "Promotional Benefit")}</span>
        <span class="ph-txn-view">No payment required</span>
      </div>
    </div>`;
}
