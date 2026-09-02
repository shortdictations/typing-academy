/* ============================================================
   subscriptions.js
   ------------------------------------------------------------
   Every card here is built by combining two separate things:
     1. ADMIN CONFIGURATION — the "products" table (unchanged,
        pre-existing). Name, price, validity, features, badge,
        display_order all come from here. Nothing about a plan's
        content is hardcoded in this file.
     2. THIS USER'S OWN STATE — their own rows in user_passes and
        wallet_credits (also pre-existing tables/RLS, no new
        backend added). Whether a plan is active, its expiry date,
        and the credit balance are never stored on the product
        itself — they're read fresh per user, per page load, and
        merged onto the product data only for rendering.
   No separate "My Current Access" section — that status now
   renders directly inside each product's own card (see
   buildPassCardHtml below). Purchase buttons call the existing
   startPurchase()/payments.js flow — untouched.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return;

  await loadProductCatalog(user.id);

  // One delegated listener handles every Buy button, present or
  // future — no per-button listener wiring needed.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".buy-product-btn");
    if (!btn) return;

    hidePurchaseMessage();
    startPurchase(btn.dataset.productId, {
      buttonEl: btn,
      onSuccess: (result) => {
        const message = result.product_type === "CREDIT"
          ? "Payment successful. Your credits have been added."
          : "Payment successful. Your pass is now active.";
        showPurchaseMessage(message, true);
        // Refresh everything that could have changed — plan status,
        // credit balance, catalog, and the header's avatar dropdown
        // (plan/credits) — rather than trusting only the button's
        // own local state.
        loadProductCatalog(user.id);
        if (typeof initAuthHeader === "function") initAuthHeader(user);
      },
      onFailure: (message) => {
        showPurchaseMessage(message, false);
      },
    });
  });
});

function showPurchaseMessage(text, isSuccess) {
  const el = document.getElementById(isSuccess ? "purchaseSuccess" : "purchaseError");
  const other = document.getElementById(isSuccess ? "purchaseError" : "purchaseSuccess");
  el.textContent = text;
  el.style.display = "block";
  other.style.display = "none";
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}
function hidePurchaseMessage() {
  document.getElementById("purchaseSuccess").style.display = "none";
  document.getElementById("purchaseError").style.display = "none";
}

// Reads the admin-managed products catalog AND this user's own
// pass/credit state, then renders both grids. The frontend never
// assumes a fixed number or names of plans — it renders whatever
// active PASS/CREDIT products exist, in display_order.
async function loadProductCatalog(userId) {
  const passGrid = document.getElementById("passProductsGrid");
  const creditGrid = document.getElementById("creditProductsGrid");

  const [{ data: products, error: productsError }, { data: passRows }, { data: creditRows }] = await Promise.all([
    supabaseClient.from("products").select("*").eq("active", true).order("display_order", { ascending: true }),
    supabaseClient.from("user_passes").select("pass_type, status, starts_at, expires_at").eq("user_id", userId),
    supabaseClient.from("wallet_credits").select("credits_remaining, expires_at").eq("user_id", userId)
  ]);

  if (productsError) {
    console.error(productsError);
    passGrid.innerHTML = '<div class="empty-state">Could not load plans.</div>';
    creditGrid.innerHTML = '<div class="empty-state">Could not load credit packages.</div>';
    return;
  }

  const activePassByType = buildActivePassMap(passRows || []);
  const creditBalance = sumUnexpiredCredits(creditRows || []);

  renderAccessGrid(products.filter(p => p.product_type === "PASS"), activePassByType, creditBalance, passGrid);
  renderCreditProducts(products.filter(p => p.product_type === "CREDIT"), creditGrid);
}

// A pass is valid only when: starts_at <= now() AND expires_at > now()
// AND status != 'cancelled' — same rule the database access-control
// function (get_mock_access) uses, just re-derived here for display.
// Returns pass_type -> { expiresAt } for whichever is the
// latest-expiring valid row of each type (mirrors fetchActivePasses
// in auth.js).
function buildActivePassMap(passRows) {
  const now = new Date();
  const map = {};
  passRows.forEach(p => {
    if (p.status === "cancelled" || new Date(p.starts_at) > now || new Date(p.expires_at) <= now) return;
    if (!map[p.pass_type] || new Date(p.expires_at) > new Date(map[p.pass_type].expiresAt)) {
      map[p.pass_type] = { expiresAt: p.expires_at };
    }
  });
  return map;
}

// The credit BALANCE the user sees is just the sum of every
// unexpired lot — when one lot's own expires_at passes, it drops
// out of this sum on its own; lots are never merged into one shared
// expiry. FIFO consumption order is unchanged, decided server-side
// in start_credit_test() (oldest-expiring lot first) — this
// function only totals what's currently spendable, it doesn't
// decide which lot gets used.
function sumUnexpiredCredits(creditRows) {
  const now = new Date();
  return creditRows
    .filter(c => new Date(c.expires_at) > now)
    .reduce((sum, c) => sum + c.credits_remaining, 0);
}

// Identical icon set to index.html's planIconSvg() — same glyph per
// category everywhere a plan card appears, landing page included.
function planIconSvg(theme) {
  const icons = {
    ssc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/></svg>',
    legal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7 2 13a3 3 0 0 0 6 0L5 7Z"/><path d="M19 7l-3 6a3 3 0 0 0 6 0l-3-6Z"/><path d="M8 21h8"/></svg>',
    combo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z"/><path d="M7 5H4a3 3 0 0 0 3 5"/><path d="M17 5h3a3 3 0 0 1-3 5"/></svg>',
    credit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>'
  };
  return icons[theme] || icons.ssc;
}

function featuresListHtml(features) {
  if (!features || features.length === 0) return "";
  return '<ul class="plan-features">' +
    features.map(f => "<li>" + escapeHtmlLocal(f) + "</li>").join("") +
    "</ul>";
}

// The student no longer picks a specific mock from a list — every
// pass type (SSC, Legal, or Combo covering both) now goes straight to
// mock-test-attempt.html's own pre-test selection screen, which lets
// them pick a category there in one click. mock-test-list.html has
// been removed entirely as a student-facing page, so nothing here
// should link to it anymore.
function viewTestsHref(passType) {
  return "mock-test-attempt.html";
}

// Builds the unified grid: every active PASS product (admin config
// + this user's own active/expiry state merged in), followed by one
// simple Test Credits summary card — same grid, same card family,
// no separate "current access" section anywhere else on the page.
function renderAccessGrid(passProducts, activePassByType, creditBalance, grid) {
  const passCardsHtml = passProducts.length > 0
    ? passProducts.map(p => buildPassCardHtml(p, activePassByType[p.pass_type])).join("")
    : '<div class="empty-state">No plans available right now.</div>';
  grid.innerHTML = passCardsHtml + buildCreditsSummaryCardHtml(creditBalance);
}

function buildPassCardHtml(p, activeState) {
  const featured = p.best_value ? " featured" : "";
  const bestValueBadge = p.best_value ? '<span class="best-value-badge">Best Value</span>' : "";
  const theme = (p.pass_type || "ssc").toLowerCase();
  const catClass = "plan-" + theme;
  const iconHtml = '<div class="plan-icon">' + planIconSvg(theme) + '</div>';

  if (activeState) {
    const expiryText = new Date(activeState.expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    return `
      <div class="card pass-card ${catClass} is-owned${featured}">
        ${bestValueBadge}
        ${iconHtml}
        <div class="pass-status-row">
          <span class="pass-status-dot"></span><span class="pass-status-text">Active</span>
        </div>
        <div class="card-label">${escapeHtmlLocal(p.name)}</div>
        <div class="pass-owned-label">Your Current Plan</div>
        ${p.description ? '<p class="pass-card-description">' + escapeHtmlLocal(p.description) + "</p>" : ""}
        <div class="pass-valid-until">Valid until <strong>${expiryText}</strong></div>
        ${featuresListHtml(p.features)}
        <a class="btn btn-full" href="${viewTestsHref(p.pass_type)}">View Tests <span aria-hidden="true">&rarr;</span></a>
      </div>`;
  }

  return `
    <div class="card pass-card ${catClass}${featured}">
      ${bestValueBadge}
      ${iconHtml}
      <div class="pass-status-row pass-status-row-inactive">
        <span class="pass-status-text-inactive">Not Active</span>
      </div>
      <div class="card-label">${escapeHtmlLocal(p.name)}</div>
      <div class="pass-price">&#8377;${p.price}</div>
      <span class="pass-duration-pill">Valid for ${p.validity_days} Days</span>
      ${p.description ? '<p class="pass-card-description">' + escapeHtmlLocal(p.description) + "</p>" : ""}
      ${featuresListHtml(p.features)}
      <button class="btn btn-full buy-product-btn" data-product-id="${p.id}" data-product-type="PASS" data-pass-type="${p.pass_type}">Buy Now <span aria-hidden="true">&rarr;</span></button>
    </div>`;
}

// Deliberately minimal — no free-vs-purchased breakdown, just the
// one number a student actually needs: how many credits can I use
// right now. The source-of-credits split still exists in the
// wallet_credits table itself for accounting; it's just not
// surfaced in this card. Golden/cream treatment (icon, background,
// border) matches .plan-credit on the public landing page (see
// planIconSvg above and the app-shell.css rules mirroring
// landing.css's body.landing-v2 .plan-credit block).
function buildCreditsSummaryCardHtml(creditBalance) {
  return `
    <div class="card pass-card plan-credit credits-summary-card">
      <div class="plan-icon">${planIconSvg("credit")}</div>
      <div class="card-label">Test Credits</div>
      <div class="credits-summary-count">${creditBalance}</div>
      <div class="credits-summary-label">Credits Available</div>
      <div class="credits-summary-note">1 credit = 1 test</div>
      <a class="btn btn-ghost btn-full" href="#creditProductsGrid">Buy Credits <span aria-hidden="true">&rarr;</span></a>
    </div>`;
}

// Module-level so it survives the re-render triggered by clicking a
// different pack (see below) and by loadProductCatalog() refreshing
// after a purchase — the same pack stays selected across both.
let selectedCreditProductId = null;

// Compact horizontal purchase panel: icon+title+validity+description
// on the left, selectable pack chips in the middle, one shared "Buy
// Credits" button on the right — then a separate FIFO info notice
// below. Selecting a pack just updates which product_id the shared
// Buy button submits; the actual purchase still goes through the
// exact same startPurchase()/buy-product-btn delegated handler at
// the top of this file — nothing about the purchase flow changes,
// only which single button triggers it.
function renderCreditProducts(products, container) {
  if (products.length === 0) {
    container.innerHTML = '<div class="empty-state">No credit packages available right now.</div>';
    return;
  }

  if (!selectedCreditProductId || !products.some(p => p.id === selectedCreditProductId)) {
    selectedCreditProductId = products[0].id;
  }
  const selected = products.find(p => p.id === selectedCreditProductId) || products[0];

  // One shared "Valid for X days" line only makes sense to state once
  // if every pack actually shares it; otherwise it reflects whichever
  // pack is currently selected, and updates when the selection does —
  // never a single number silently wrong for some packs.
  const allSameValidity = products.every(p => p.validity_days === products[0].validity_days);
  const validityDays = allSameValidity ? products[0].validity_days : selected.validity_days;
  const description = selected.description || "Use credits to take mock tests on any category.";

  container.innerHTML = `
    <div class="credits-panel">
      <div class="credits-panel-icon">${planIconSvg("credit")}</div>
      <div class="credits-panel-info">
        <div class="credits-panel-title">Test Credits</div>
        <div class="credits-panel-validity">Valid for ${validityDays} days</div>
        <div class="credits-panel-desc">${escapeHtmlLocal(description)}</div>
      </div>
      <div class="credit-pack-row" role="radiogroup" aria-label="Choose a credit pack">
        ${products.map(p => creditPackChipHtml(p, p.id === selectedCreditProductId)).join("")}
      </div>
      <button class="btn credits-panel-buy-btn buy-product-btn" data-product-id="${selected.id}" data-product-type="CREDIT">
        Buy Credits <span aria-hidden="true">&rarr;</span>
      </button>
    </div>
    <div class="credits-fifo-notice">
      <span class="credits-fifo-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></span>
      <span>1 credit is equal to 1 test attempt. Credits are used on a first-in, first-out basis. Each purchase has its own validity.</span>
    </div>`;

  // Selecting a pack re-renders the whole panel with the new
  // selection — simplest way to keep the chip's selected state, the
  // Buy button's data-product-id, and the validity/description line
  // all consistent with each other, without hand-syncing three
  // separate DOM updates.
  container.querySelectorAll(".credit-pack-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      selectedCreditProductId = chip.dataset.productId;
      renderCreditProducts(products, container);
    });
  });
}

function creditPackChipHtml(p, isSelected) {
  const badge = p.badge_text ? '<span class="credit-pack-badge">' + escapeHtmlLocal(p.badge_text) + "</span>" : "";
  // Selection is never color-only: aria-checked carries it for
  // assistive tech, and the checkmark carries it visually alongside
  // the border/weight change.
  const check = isSelected ? '<span class="credit-pack-check" aria-hidden="true">&#10003;</span>' : "";
  return `
    <button type="button" class="credit-pack-chip${isSelected ? " selected" : ""}" data-product-id="${p.id}" role="radio" aria-checked="${isSelected}">
      ${badge}
      <div class="credit-pack-name">${check}${escapeHtmlLocal(p.name)}</div>
      <div class="credit-pack-price">&#8377;${p.price}</div>
    </button>`;
}

function escapeHtmlLocal(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
