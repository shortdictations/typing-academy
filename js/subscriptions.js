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
      isUpgrade: btn.dataset.isUpgrade === "true",
      onSuccess: async (result) => {
        // The payment verifier now waits until fulfillment has completed,
        // so these reads should see the newly granted entitlement. Await
        // both refreshes before showing the success message; the student
        // should never see "pass is active" while the card still says
        // "Not Active".
        // Do not show the final success message until the entitlement is
        // actually visible in the user's current database state. Razorpay's
        // browser callback and webhook can complete very close together, so
        // a single immediate SELECT can still briefly see the pre-payment
        // state. Poll for a short, bounded period instead of asking the
        // student to reload the page.
        const activated = await waitForPurchaseActivation(user.id, result);
        if (typeof initAuthHeader === "function") await initAuthHeader(user);

        if (!activated) {
          showPurchaseMessage(
            result.product_type === "CREDIT"
              ? "Payment received. Your credits are still being activated. Please wait a moment."
              : "Payment received. Your pass is still being activated. Please wait a moment.",
            false
          );
          return;
        }

        const message = result.product_type === "CREDIT"
          ? "Payment successful. Your credits have been added."
          : "Payment successful. Your pass is now active.";
        showPurchaseMessage(message, true);
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
// pass/credit state, then renders the pass cards and the combined
// Test Credits card. Credit purchase choices are admin-priced but
// limited to the three supported quantities: 10, 20 and 30.
async function waitForPurchaseActivation(userId, result) {
  const expectedPassType = result?.product_type === "PASS"
    ? (result.pass_type || (result.transaction_type === "UPGRADE" ? "COMBO" : null))
    : null;

  // Up to ~12 seconds, with the first refresh immediate. This handles the
  // normal browser/webhook race without making the UI feel stuck forever.
  for (let attempt = 0; attempt < 24; attempt++) {
    const state = await loadProductCatalog(userId);

    if (result?.product_type === "CREDIT") {
      if (state && state.creditBalance > 0) return true;
    } else if (expectedPassType && state?.activePassByType?.[expectedPassType]) {
      return true;
    }

    if (attempt < 23) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return false;
}

async function loadProductCatalog(userId) {
  const passGrid = document.getElementById("passProductsGrid");
  if (!passGrid) return null;

  // Never leave the page stuck on "Loading your plans...". Some browsers,
  // extensions, network conditions, or a Supabase RPC can leave one request
  // pending much longer than the UI should wait. Each request below is bounded
  // and the catalog has a direct-table fallback.
  // IMPORTANT: Supabase requests can REJECT (network/CORS/fetch errors),
  // not just return { error }. The previous wrapper only handled the latter,
  // so a rejected RPC escaped the fallback branch and sent the whole page
  // straight to the generic error card. Convert rejections into the same
  // { data, error } shape so the direct products-table fallback can run.
  // Accept a function rather than an already-created Promise so synchronous
  // Supabase/client errors are caught as well. This is important because an
  // exception thrown while constructing .rpc()/.from() otherwise escapes
  // before Promise.race() gets a chance to handle it.
  const withTimeout = async (operation, ms, label) => {
    let promise;
    try {
      promise = Promise.resolve().then(operation);
    } catch (err) {
      console.warn(`[subscriptions] ${label} failed synchronously:`, err);
      return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
    }

    return Promise.race([
      promise.catch((err) => {
        console.warn(`[subscriptions] ${label} failed:`, err);
        return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
      }),
      new Promise((resolve) => setTimeout(() => {
        console.warn(`[subscriptions] ${label} timed out after ${ms}ms`);
        resolve({ data: null, error: new Error(`${label} timed out`) });
      }, ms))
    ]);
  };

  try {
    let productsResult = await withTimeout(
      () => supabaseClient.rpc("get_products_with_pricing"),
      7000,
      "product catalog RPC"
    );

    // The RPC is preferred because it calculates the same effective pricing
    // used by checkout. If it errors/times out, fall back to the public product
    // rows so the page can still render and the server remains authoritative
    // when a purchase is actually made.
    if (productsResult.error || !Array.isArray(productsResult.data)) {
      console.warn("[subscriptions] Pricing RPC unavailable; using product-table fallback.", productsResult.error);
      productsResult = await withTimeout(
        () => supabaseClient
          .from("products")
          .select("id, product_type, pass_type, credits, name, price, currency, validity_days, description, features, display_order, active, plan_code, best_value, badge_text, discount_enabled, discount_type, discount_value, discount_start_at, discount_end_at, upgrade_to_combo_price")
          .eq("active", true)
          .order("display_order", { ascending: true }),
        7000,
        "product catalog fallback"
      );
    }

    let products = Array.isArray(productsResult.data) ? productsResult.data : [];

    // Direct-table fallback does not include the RPC-computed pricing fields,
    // so calculate those display-only fields locally when the RPC is down.
    // Checkout still uses the server-authoritative price; this is only a
    // rendering fallback so the page never becomes unusable because the
    // pricing RPC is temporarily unavailable.
    products = products.map(normalizeFallbackProductPricing);

    // User-state queries are deliberately independent. A problem reading one
    // user's pass/credit rows must not prevent the product cards from showing.
    const [passResult, creditResult] = await Promise.all([
      withTimeout(
        () => supabaseClient
          .from("user_passes")
          .select("pass_type, status, starts_at, expires_at")
          .eq("user_id", userId),
        7000,
        "active-pass query"
      ),
      withTimeout(
        () => supabaseClient
          .from("wallet_credits")
          .select("credits_remaining, expires_at")
          .eq("user_id", userId),
        7000,
        "credit-balance query"
      )
    ]);

    const activePassByType = buildActivePassMap(Array.isArray(passResult.data) ? passResult.data : []);
    const creditBalance = sumUnexpiredCredits(Array.isArray(creditResult.data) ? creditResult.data : []);

    const creditProducts = products
      .filter(p => p.product_type === "CREDIT" && [10, 20, 30].includes(Number(p.credits)))
      .sort((a, b) => Number(a.credits) - Number(b.credits));

    renderAccessGrid(
      products.filter(p => p.product_type === "PASS"),
      activePassByType,
      creditBalance,
      passGrid,
      creditProducts
    );

    if (!products.length) {
      passGrid.insertAdjacentHTML("afterbegin", '<div class="empty-state">No plans are currently available.</div>');
    }

    return { products, activePassByType, creditBalance };
  } catch (err) {
    console.error("[subscriptions] Failed to load subscription catalog:", err);
    passGrid.innerHTML = `
      <div class="subscription-load-error">
        <strong>We couldn't load the plans.</strong>
        <span>Please refresh the page and try again.</span>
        <button type="button" class="btn btn-ghost" onclick="window.location.reload()">Refresh</button>
      </div>`;
    return null;
  }
}


function normalizeFallbackProductPricing(p) {
  const out = { ...p };
  const enabled = Boolean(p.discount_enabled);
  const now = Date.now();
  const startsOk = !p.discount_start_at || now >= new Date(p.discount_start_at).getTime();
  const endsOk = !p.discount_end_at || now <= new Date(p.discount_end_at).getTime();
  const active = enabled && !!p.discount_type && p.discount_value != null && startsOk && endsOk;

  out.discount_active = active;
  if (!active) {
    out.effective_price = p.price;
    return out;
  }

  const base = Number(p.price);
  const value = Number(p.discount_value);
  let effective = base;
  if (p.discount_type === "PERCENTAGE") {
    effective = base - (base * value / 100);
  } else if (p.discount_type === "FIXED") {
    effective = base - value;
  }
  out.effective_price = Math.max(0, effective);
  return out;
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

// Builds the access grid from the admin product catalog plus this user's
// own active pass state. The UI intentionally shows only the plan relevant
// to the user's current entitlement:
//   - No active pass: SSC + Legal + Combo purchase cards.
//   - Active SSC: only the SSC current-plan card, with Combo upgrade inside it.
//   - Active Legal: only the Legal current-plan card, with Combo upgrade inside it.
//   - Active Combo: only the Combo current-plan card.
//
// resolve_pass_purchase() remains the server-authoritative eligibility/price
// check. This rendering logic is never trusted to authorize a payment.
function renderAccessGrid(passProducts, activePassByType, creditBalance, grid, creditProducts = []) {
  const hasSSC = !!activePassByType.SSC;
  const hasLegal = !!activePassByType.LEGAL;
  const hasCombo = !!activePassByType.COMBO || (hasSSC && hasLegal);

  // No active pass: show all configured purchase cards.
  // Active SSC: show only SSC, with the Combo upgrade inside the SSC card.
  // Active Legal: show only Legal, with the Combo upgrade inside the Legal card.
  // Active Combo: show only Combo as the current plan.
  // Server-side purchase/eligibility validation remains authoritative.
  let passCardsHtml = "";

  if (hasCombo) {
    const comboProduct = passProducts.find(p => p.pass_type === "COMBO");
    const comboState = activePassByType.COMBO;
    if (comboProduct && comboState) {
      passCardsHtml = buildPassCardHtml(comboProduct, comboState);
    } else if (comboProduct && (hasSSC || hasLegal)) {
      // Legacy fallback: if both category entitlements exist without a
      // Combo row, display one full-access Combo card using the latest expiry.
      const expiryCandidates = [activePassByType.SSC, activePassByType.LEGAL]
        .filter(Boolean)
        .map(state => new Date(state.expiresAt).getTime());
      const latestExpiry = expiryCandidates.length ? Math.max(...expiryCandidates) : null;
      if (latestExpiry) {
        passCardsHtml = buildPassCardHtml(comboProduct, {
          expiresAt: new Date(latestExpiry).toISOString()
        });
      }
    }
  } else if (hasSSC) {
    const sscProduct = passProducts.find(p => p.pass_type === "SSC");
    const comboProduct = passProducts.find(p => p.pass_type === "COMBO");
    if (sscProduct) {
      passCardsHtml = buildOwnedPassCardHtml(sscProduct, activePassByType.SSC, comboProduct);
    }
  } else if (hasLegal) {
    const legalProduct = passProducts.find(p => p.pass_type === "LEGAL");
    const comboProduct = passProducts.find(p => p.pass_type === "COMBO");
    if (legalProduct) {
      passCardsHtml = buildOwnedPassCardHtml(legalProduct, activePassByType.LEGAL, comboProduct);
    }
  } else {
    passCardsHtml = passProducts.map(p => buildPassCardHtml(p, null)).join("");
  }

  grid.innerHTML = (passCardsHtml || '<div class="empty-state">No plans available right now.</div>') + buildCreditsSummaryCardHtml(creditBalance, creditProducts);
  bindCombinedCreditCard(grid, creditProducts);

  // Layout is based on the TOTAL visible cards, including the combined
  // Test Credit card.  This gives the pricing section a deliberate
  // composition instead of allowing two cards to stretch too wide:
  //   4 cards -> 2 x 2
  //   2 cards -> 2 in one row
  //   3 cards -> 2 + 1 (the last card is centred by CSS)
  //   1 card  -> single centred card
  const cardCount = grid.querySelectorAll(':scope > .pass-card, :scope > .credits-summary-card').length;
  grid.classList.toggle('passes-grid--two', cardCount === 2);
  grid.classList.toggle('passes-grid--four', cardCount === 4);
  grid.classList.toggle('passes-grid--three', cardCount === 3);
  grid.classList.toggle('passes-grid--one', cardCount === 1);
}

// Active SSC/Legal users see their current plan and the upgrade CTA in the
// SAME card. The separate Combo card is hidden for these users.
function getDaysLeft(expiresAt) {
  const now = new Date();
  const expiry = new Date(expiresAt);
  const difference = expiry.getTime() - now.getTime();
  if (difference <= 0) return 0;
  return Math.ceil(difference / (1000 * 60 * 60 * 24));
}

function buildOwnedPassCardHtml(p, activeState, comboProduct) {
  const passType = (p.pass_type || "").toUpperCase();
  const currentCategory = passType === "SSC" ? "SSC" : "Legal";
  const unlockedCategory = passType === "SSC" ? "Legal" : "SSC";
  const daysLeft = getDaysLeft(activeState.expiresAt);
  const upgradePrice = p.upgrade_to_combo_price;
  const canUpgrade = !!comboProduct && upgradePrice != null;

  const upgradeHtml = canUpgrade ? `
    <div class="pass-upgrade-box">
      <div class="pass-upgrade-heading">
        <span class="pass-upgrade-title">GET UNLIMITED ${unlockedCategory.toUpperCase()} MOCKS</span>
        <span class="pass-upgrade-price">JUST AT &#8377;${upgradePrice}</span>
      </div>
      <div class="pass-upgrade-text">
        Upgrade to Combo and unlock all ${unlockedCategory} typing mocks.
      </div>
    </div>

    <button class="btn btn-full pass-upgrade-btn buy-product-btn"
      data-product-id="${comboProduct.id}"
      data-is-upgrade="true"
      data-product-type="PASS"
      data-pass-type="COMBO">
      Unlock Unlimited ${unlockedCategory} Mocks
      <span class="pass-upgrade-btn-price">&#183; &#8377;${upgradePrice}</span>
      <span aria-hidden="true">&rarr;</span>
    </button>

    <div class="pass-upgrade-note">Your current validity will remain the same.</div>
  ` : `
    <div class="pass-upgrade-box pass-upgrade-box-unavailable">
      Combo upgrade is currently unavailable.
    </div>
  `;

  return `
    <div class="card pass-card ${"plan-" + currentCategory.toLowerCase()} is-owned">
      <div class="pass-card-header">
        <div class="card-label">${currentCategory} PASS</div>
        <span class="pass-active-badge"><span class="pass-status-dot"></span>ACTIVE</span>
      </div>

      <div class="pass-current-plan-box">
        <div class="pass-current-plan-title">Your Current Plan</div>
        <div class="pass-plan-detail-row">
          <span>Validity</span>
          <strong>${daysLeft} ${daysLeft === 1 ? "day" : "days"} left</strong>
        </div>
        <div class="pass-plan-detail-row">
          <span>Access</span>
          <strong>All ${currentCategory} typing mocks</strong>
        </div>
      </div>
      <ul class="pass-feature-list active-pass-features">
        <li>Unlimited mock tests</li>
        <li>All ${currentCategory} typing mocks</li>
        <li>Choose test duration: 5 mins / 10 mins</li>
        <li>Access throughout the validity period</li>
        <li>Performance analysis</li>
        <li>Weak key analysis</li>
      </ul>

      ${upgradeHtml}
    </div>`;
}

function buildPassCardHtml(p, activeState) {
  const featured = p.best_value ? " featured" : "";
  // best_value and discount_active are independent (spec: a pass may
  // be discounted but not Featured, Featured but not discounted, both,
  // or neither) — but there is only one badge_text field, so when
  // either applies it shows the same admin-set text, falling back to
  // a sensible default only when the admin left it blank.
  const showBadge = p.best_value || p.discount_active;
  const defaultBadgeText = p.best_value ? "Best Value" : discountBadgeFallback(p);
  const bestValueBadge = showBadge ? '<span class="best-value-badge">' + escapeHtmlLocal(p.badge_text || defaultBadgeText) + '</span>' : "";
  const theme = (p.pass_type || "ssc").toLowerCase();
  const catClass = "plan-" + theme;
  const priceHtml = priceDisplayHtml(p);

  if (activeState) {
    const accessText = p.pass_type === "COMBO" ? "All SSC + Legal mocks" : `All ${p.pass_type === "SSC" ? "SSC" : "Legal"} mocks`;
    const daysLeft = getDaysLeft(activeState.expiresAt);
    return `
      <div class="card pass-card ${catClass} is-owned${featured}">
        ${bestValueBadge}
        <div class="pass-card-header">
          <div class="card-label">${escapeHtmlLocal(p.name)}</div>
          <span class="pass-active-badge"><span class="pass-status-dot"></span>ACTIVE</span>
        </div>

        <div class="pass-current-plan-box">
          <div class="pass-current-plan-title">Your Current Plan</div>
          <div class="pass-plan-detail-row">
            <span>Validity</span>
            <strong>${daysLeft} ${daysLeft === 1 ? "day" : "days"} left</strong>
          </div>
          <div class="pass-plan-detail-row">
            <span>Access</span>
            <strong>${accessText}</strong>
          </div>
        </div>

        <ul class="pass-feature-list active-pass-features">
          <li>Unlimited mock tests</li>
          <li>All ${p.pass_type === "COMBO" ? "SSC + Legal" : (p.pass_type === "SSC" ? "SSC" : "Legal")} typing mocks</li>
          <li>Choose test duration: 5 mins / 10 mins</li>
          <li>Access throughout the validity period</li>
          <li>Performance analysis</li>
          <li>Weak key analysis</li>
        </ul>
        <a class="btn btn-full" href="${viewTestsHref(p.pass_type)}">View Tests <span aria-hidden="true">&rarr;</span></a>
      </div>`;
  }

  return `
    <div class="card pass-card ${catClass}${featured}">
      ${bestValueBadge}
      <div class="pass-status-row pass-status-row-inactive">
        <span class="pass-status-text-inactive">Not Active</span>
      </div>
      <div class="card-label">${escapeHtmlLocal(p.name)}</div>
      ${priceHtml}
      <span class="pass-duration-pill">Valid for ${p.validity_days} Days</span>
      ${p.description ? '<p class="pass-card-description">' + escapeHtmlLocal(p.description) + "</p>" : ""}
      ${featuresListHtml(p.features)}
      <button class="btn btn-full buy-product-btn" data-product-id="${p.id}" data-product-type="PASS" data-pass-type="${p.pass_type}">Buy Now <span aria-hidden="true">&rarr;</span></button>
    </div>`;
}

// Only ever used when the admin left badge_text blank AND there's no
// Featured badge to fall back to instead — a plain, compact label so
// the card is never left with an empty badge span when a discount is
// active but unlabeled.
function discountBadgeFallback(p) {
  if (!p.discount_active) return "";
  return p.discount_type === "PERCENTAGE" ? p.discount_value + "% OFF" : "\u20B9" + p.discount_value + " OFF";
}

// discount_active/effective_price come from get_products_with_pricing()
// (server-computed, same function the payment edge function itself
// uses) — never recalculated here. This is purely which of the two
// numbers to show and how, not a pricing decision.
function priceDisplayHtml(p) {
  if (!p.discount_active) {
    return '<div class="pass-price">&#8377;' + p.price + '</div>';
  }
  return (
    '<div class="pass-price pass-price-discounted">' +
      '<span class="pass-price-original">&#8377;' + p.price + '</span>' +
      '<span class="pass-price-final">&#8377;' + p.effective_price + '</span>' +
    '</div>'
  );
}

// Deliberately minimal — no free-vs-purchased breakdown, just the
// one number a student actually needs: how many credits can I use
// right now. The source-of-credits split still exists in the
// wallet_credits table itself for accounting; it's just not
// surfaced in this card. Golden/cream treatment (icon, background,
// border) matches .plan-credit on the public landing page (see
// planIconSvg above and the app-shell.css rules mirroring
// landing.css's body.landing-v2 .plan-credit block).
function buildCreditsSummaryCardHtml(creditBalance, products = []) {
  const visibleProducts = products.filter(p => [10, 20, 30].includes(Number(p.credits)));
  const selectedId = selectedCreditProductId && visibleProducts.some(p => p.id === selectedCreditProductId)
    ? selectedCreditProductId
    : (visibleProducts[0]?.id || "");
  const packsHtml = visibleProducts.length
    ? visibleProducts.map(p => creditPackChipHtml(p, p.id === selectedId)).join("")
    : '<div class="credits-empty-packs">Credit packages are currently unavailable.</div>';

  return `
    <section class="card pass-card plan-credit credits-summary-card credits-combined-card" aria-label="Test Credits">
      <div class="credits-card-topline">
        <h2 class="credits-card-title">TEST CREDIT</h2>
        <span class="credits-card-badge">PAY AS YOU GO</span>
      </div>
      <p class="credits-card-subtitle">Use credit and take mock tests whenever you want.</p>

      <div class="credits-balance-panel">
        <div class="credits-balance-main">
          <div class="credits-balance-number">${creditBalance}</div>
          <div>
            <div class="credits-balance-heading">Available Credits</div>
            <div class="credits-balance-note">1 credit = 1 test attempt</div>
          </div>
        </div>
        <a class="credits-history-link" href="purchase-history.html">
          <span>View History</span><span aria-hidden="true">&rarr;</span>
        </a>
      </div>

      <div class="credits-benefits">
        <div class="credits-benefit"><span class="credits-benefit-icon" aria-hidden="true">&#8734;</span><strong>Use for SSC or Legal mocks</strong></div>
        <div class="credits-benefit"><span class="credits-benefit-icon" aria-hidden="true">&#43;</span><strong>Buy multiple credits anytime</strong></div>
        <div class="credits-benefit"><span class="credits-benefit-icon credits-calendar-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M7.5 3v4M16.5 3v4M3.5 9.5h17"/></svg>
        </span><strong>Valid for 365 days</strong></div>
      </div>

      <div class="credits-purchase-section">
        <div class="credits-purchase-title">Buy Test Credits</div>
        <div class="credits-purchase-label">Select number of credits</div>
        <div class="credit-pack-row credits-pack-row-large" role="radiogroup" aria-label="Choose number of test credits">
          ${packsHtml}
        </div>
        ${visibleProducts.length ? `
          <button class="btn credits-panel-buy-btn credits-combined-buy-btn buy-product-btn" data-product-id="${selectedId}" data-product-type="CREDIT">
            Buy Test Credits <span aria-hidden="true">&rarr;</span>
          </button>` : ""}
      </div>
    </section>`;
}

function bindCombinedCreditCard(grid, products = []) {
  const card = grid.querySelector(".credits-combined-card");
  if (!card) return;
  const visibleProducts = products.filter(p => [10, 20, 30].includes(Number(p.credits)));
  card.querySelectorAll(".credit-pack-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      selectedCreditProductId = chip.dataset.productId;
      const selected = visibleProducts.find(p => p.id === selectedCreditProductId);
      if (!selected) return;
      card.querySelectorAll(".credit-pack-chip").forEach(item => {
        const active = item.dataset.productId === selectedCreditProductId;
        item.classList.toggle("selected", active);
        item.setAttribute("aria-checked", String(active));

      });
      const buyBtn = card.querySelector(".credits-combined-buy-btn");
      if (buyBtn) buyBtn.dataset.productId = selected.id;
    });
  });
}

// Module-level so it survives the re-render triggered by clicking a
// different pack and by loadProductCatalog() refreshing after a purchase —
// the same pack stays selected across both.
let selectedCreditProductId = null;

// Renders one selectable credit package. The package quantities are limited
// to 10/20/30 by renderAccessGrid(), while the actual product id and price
// always come from the admin-managed products table. No per-test pricing is
// displayed here.
function creditPackChipHtml(p, selected) {
  const credits = Number(p.credits);
  const name = p.name || `${credits} Credits`;
  const price = p.discount_active ? p.effective_price : p.price;
  const originalPrice = p.discount_active ? p.price : null;
  const badge = p.badge_text || (p.description && /best offer/i.test(p.description) ? p.description : "");

  return `
    <button type="button"
      class="credit-pack-chip${selected ? " selected" : ""}"
      role="radio"
      aria-checked="${selected ? "true" : "false"}"
      data-product-id="${escapeHtmlLocal(p.id)}">
      ${badge ? `<span class="credit-pack-badge">${escapeHtmlLocal(badge)}</span>` : ""}
      <span class="credit-pack-name">${escapeHtmlLocal(name)}</span>
      <span class="credit-pack-price${originalPrice != null ? " credit-pack-price-discounted" : ""}">
        ${originalPrice != null ? `<span class="credit-pack-price-original">&#8377;${originalPrice}</span>` : ""}
        <span class="credit-pack-price-final">&#8377;${price}</span>
      </span>
    </button>`;
}


function escapeHtmlLocal(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
