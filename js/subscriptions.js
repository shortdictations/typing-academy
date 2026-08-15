/* ============================================================
   subscriptions.js
   ------------------------------------------------------------
   Populates "My Current Access" on the purchase page by reading
   the student's own rows from user_passes and wallet_credits
   (both already allow "select own rows" via existing RLS — no
   new backend logic was added for this). Purchase buttons are
   inert placeholders; no payment logic here yet.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return;

  const [{ data: passes, error: passesError }, { data: credits, error: creditsError }] = await Promise.all([
    supabaseClient.from("user_passes").select("*").eq("user_id", user.id),
    supabaseClient.from("wallet_credits").select("*").eq("user_id", user.id)
  ]);

  if (passesError) console.error(passesError);
  if (creditsError) console.error(creditsError);

  renderPassStatus("SSC", passes || [], document.getElementById("accessSsc"));
  renderPassStatus("LEGAL", passes || [], document.getElementById("accessLegal"));
  renderPassStatus("COMBO", passes || [], document.getElementById("accessCombo"));
  renderCreditStatus(credits || [], document.getElementById("accessCredits"));

  await loadProductCatalog();

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
        // Refresh everything that could have changed — access status,
        // catalog, and the header's avatar dropdown (plan/credits) —
        // rather than trusting only the button's own local state.
        loadProductCatalog();
        loadCurrentAccess(user.id);
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

// Re-fetches and re-renders the "My Current Access" strip after a
// successful purchase, so the new pass/credits show immediately
// without requiring a manual page refresh.
async function loadCurrentAccess(userId) {
  const [{ data: passes }, { data: credits }] = await Promise.all([
    supabaseClient.from("user_passes").select("*").eq("user_id", userId),
    supabaseClient.from("wallet_credits").select("*").eq("user_id", userId)
  ]);
  renderPassStatus("SSC", passes || [], document.getElementById("accessSsc"));
  renderPassStatus("LEGAL", passes || [], document.getElementById("accessLegal"));
  renderPassStatus("COMBO", passes || [], document.getElementById("accessCombo"));
  renderCreditStatus(credits || [], document.getElementById("accessCredits"));
}

// Reads the admin-managed products catalog and renders both
// sections. "Buy" stays an inert placeholder — no payment gateway
// is connected yet.
async function loadProductCatalog() {
  const passGrid = document.getElementById("passProductsGrid");
  const creditGrid = document.getElementById("creditProductsGrid");

  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .eq("active", true)
    .order("display_order", { ascending: true });

  if (error) {
    console.error(error);
    passGrid.innerHTML = '<div class="empty-state">Could not load plans.</div>';
    creditGrid.innerHTML = '<div class="empty-state">Could not load credit packages.</div>';
    return;
  }

  // Real active-pass check, read fresh from user_passes every time
  // this runs (page load AND right after a successful purchase) —
  // never cached, so it can't go stale. Deliberately NOT applied to
  // credit products — those stay purchasable multiple times.
  const activePassTypes = await loadActivePassTypes();

  renderPassProducts(data.filter(p => p.product_type === "PASS"), passGrid, activePassTypes);
  renderCreditProducts(data.filter(p => p.product_type === "CREDIT"), creditGrid);
}

// Same validity rule as get_mock_access(): status != 'cancelled' AND
// starts_at <= now() AND expires_at > now(). An expired pass simply
// won't be in this set, so its Buy button re-enables automatically
// on the next load — no separate "re-enable" logic needed.
async function loadActivePassTypes() {
  const { data: user } = await supabaseClient.auth.getUser();
  if (!user || !user.user) return new Set();

  const { data, error } = await supabaseClient
    .from("user_passes")
    .select("pass_type, status, starts_at, expires_at")
    .eq("user_id", user.user.id);

  if (error || !data) return new Set();

  const now = new Date();
  const active = new Set();
  data.forEach(p => {
    if (p.status !== "cancelled" && new Date(p.starts_at) <= now && new Date(p.expires_at) > now) {
      active.add(p.pass_type);
    }
  });
  return active;
}

function featuresListHtml(features) {
  if (!features || features.length === 0) return "";
  return '<ul class="plan-features">' +
    features.map(f => "<li>" + escapeHtmlLocal(f) + "</li>").join("") +
    "</ul>";
}

function renderPassProducts(products, grid, activePassTypes) {
  if (products.length === 0) {
    grid.innerHTML = '<div class="empty-state">No plans available right now.</div>';
    return;
  }

  grid.innerHTML = products.map(p => {
    const featured = p.best_value ? " featured" : "";
    const badge = p.best_value ? '<span class="best-value-badge">Best Value</span>' : "";
    const isActive = activePassTypes.has(p.pass_type);
    const buttonHtml = isActive
      ? '<button class="btn btn-full" disabled style="opacity:0.6; cursor:not-allowed;">&#10003; Active</button>'
      : '<button class="btn btn-full buy-product-btn" data-product-id="' + p.id + '" data-product-type="PASS" data-pass-type="' + p.pass_type + '">Buy ' + escapeHtmlLocal(p.name) + '</button>';
    return `
      <div class="card pass-card${featured}">
        ${badge}
        <div class="card-label">${escapeHtmlLocal(p.name)}</div>
        <div class="pass-price">&#8377;${p.price}</div>
        <div class="pass-duration">${p.validity_days} Days &middot; Non-recurring</div>
        ${p.description ? '<p style="font-size:0.85rem;color:var(--ink-soft);margin:0 0 10px;">' + escapeHtmlLocal(p.description) + "</p>" : ""}
        ${featuresListHtml(p.features)}
        ${buttonHtml}
      </div>`;
  }).join("");
}

function renderCreditProducts(products, grid) {
  if (products.length === 0) {
    grid.innerHTML = '<div class="empty-state">No credit packages available right now.</div>';
    return;
  }

  grid.innerHTML = products.map(p => `
      <div class="card pass-card">
        <div class="card-label">${escapeHtmlLocal(p.name)}</div>
        <div class="pass-price">&#8377;${p.price}</div>
        <div class="pass-duration">${p.credits} Credits &middot; Valid for ${p.validity_days} Days</div>
        ${p.description ? '<p style="font-size:0.85rem;color:var(--ink-soft);margin:0 0 10px;">' + escapeHtmlLocal(p.description) + "</p>" : ""}
        ${featuresListHtml(p.features)}
        <button class="btn btn-ghost btn-full buy-product-btn"
          data-product-id="${p.id}" data-product-type="CREDIT" data-credits="${p.credits}">
          Buy ${escapeHtmlLocal(p.name)}
        </button>
      </div>`).join("");
}

function escapeHtmlLocal(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// A pass is valid only when: starts_at <= now() AND expires_at > now()
// AND status != 'cancelled' — same rule the database access-control
// function uses, just for display here.
function renderPassStatus(passType, passes, el) {
  const now = new Date();
  const rows = passes.filter(p => p.pass_type === passType);
  const validRow = rows.find(p =>
    p.status !== "cancelled" &&
    new Date(p.starts_at) <= now &&
    new Date(p.expires_at) > now
  );

  const card = el.closest(".access-card");

  if (validRow) {
    const expiryText = new Date(validRow.expires_at).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric"
    });
    if (card) card.classList.add("is-active");
    el.innerHTML =
      '<span class="access-status-badge"><span class="access-status-dot"></span>Active</span>' +
      '<div class="access-card-detail">Valid until <strong>' + expiryText + '</strong></div>';
  } else {
    if (card) card.classList.remove("is-active");
    el.innerHTML =
      '<span class="access-status-badge">Not Active</span>' +
      '<div class="access-card-detail">Purchase below to unlock</div>';
  }
}

function renderCreditStatus(credits, el) {
  const now = new Date();
  const unexpired = credits.filter(c => new Date(c.expires_at) > now);
  const free = unexpired.filter(c => c.credit_type === "free").reduce((sum, c) => sum + c.credits_remaining, 0);
  const purchased = unexpired.filter(c => c.credit_type === "purchased").reduce((sum, c) => sum + c.credits_remaining, 0);
  const total = free + purchased;

  const card = el.closest(".access-card");
  if (card) card.classList.toggle("is-active", total > 0);

  el.innerHTML =
    '<span class="access-status-badge">' +
      (total > 0 ? '<span class="access-status-dot"></span>' : '') +
      total + ' Available</span>' +
    '<div class="access-card-detail">&#127873; Free: <strong>' + free + '</strong> &middot; &#128179; Purchased: <strong>' + purchased + '</strong></div>';
}
