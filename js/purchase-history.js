/* ============================================================
   purchase-history.js
   ------------------------------------------------------------
   Entirely read-only against the existing purchase_transactions
   table (RLS already restricts every query here to the logged-in
   user's own rows — auth.uid() = user_id, confirmed directly
   against the live policy before writing this). Nothing here
   creates, updates, or deletes a transaction, a pass, or a credit
   balance — it only displays what already happened via the real
   purchase/payment flow in payments.js.

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

  if (replace && data.length === 0) {
    renderEmptyState(listEl, loadMoreWrap);
    return;
  }

  const cardsHtml = data.map(buildTransactionCardHtml).join("");
  listEl.innerHTML = replace ? cardsHtml : listEl.innerHTML + cardsHtml;

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
  refunded: { label: "Refunded", cls: "ph-status-refunded" }
};

function transactionDisplayName(t) {
  if (t.products && t.products.name) return t.products.name;
  if (t.product_type === "PASS") return (t.pass_type || "") + " Pass";
  return (t.credits || "?") + " Test Credits";
}

function buildTransactionCardHtml(t) {
  const status = STATUS_META[t.status] || { label: t.status, cls: "" };
  const displayDate = new Date(t.paid_at || t.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const typeLabel = t.product_type === "PASS" ? "Pass" : "Credits";
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
      <div class="ph-txn-meta">${typeLabel}${t.validity_days ? " &middot; " + t.validity_days + " Days" : ""}</div>
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

function escapeHtmlPH(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}
