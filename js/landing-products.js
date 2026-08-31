/* ============================================================
   landing-products.js
   ------------------------------------------------------------
   Renders the landing page's Pass Plans, Credit Packages, and
   free-signup-credits copy entirely from the database — nothing
   about price, validity, features, or which product is Featured
   is hard-coded here. Admin changes in admin-products.html (and
   the Free Credits setting there) reach this page automatically
   on next load, no redeploy needed.

   Read-only — never writes anything, never touches Razorpay,
   purchase_transactions, or any payment logic. The actual price
   charged at checkout is decided server-side by the existing
   purchase flow, which is untouched by this file; what's rendered
   here is display only.
   ============================================================ */

// Icon + accent color per pass_type — this is a purely visual
// convention (kept in code, same as the icons already used
// elsewhere on this page), not a business value the brief asks
// Admin to control. Falls back to a generic look for any pass_type
// not in this list, so a new one added later in admin-products.html
// still renders instead of breaking.
const PASS_VISUALS = {
  SSC:   { icon: "graduation-cap", bg: "blue-bg",   btnClass: "lp-btn-outline" },
  LEGAL: { icon: "scale",          bg: "green-bg",  btnClass: "lp-btn-green" },
  COMBO: { icon: "layers-2",       bg: "purple-bg", btnClass: "lp-btn-purple" }
};
const DEFAULT_PASS_VISUAL = { icon: "star", bg: "blue-bg", btnClass: "lp-btn-outline" };

document.addEventListener("DOMContentLoaded", () => {
  loadPricing();
  loadFreeCreditsCopy();
});

async function loadPricing() {
  const grid = document.getElementById("pricingGrid");
  const creditOptions = document.getElementById("creditOptions");
  if (!grid || !creditOptions) return;

  try {
    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .eq("active", true)
      .order("display_order", { ascending: true });

    if (error) throw error;

    const passes = (data || []).filter(p => p.product_type === "PASS");
    const credits = (data || []).filter(p => p.product_type === "CREDIT");

    renderPasses(passes, grid);
    renderCredits(credits, creditOptions);
  } catch (err) {
    console.error("Could not load products for landing page:", err);
    // Fallback per spec: never show stale/incorrect commercial
    // information — a clear, honest message instead.
    grid.innerHTML = '<p class="plans-unavailable">Plans currently unavailable. Please check back shortly.</p>';
    creditOptions.innerHTML = "";
  }
}

function renderPasses(passes, grid) {
  if (!passes.length) {
    grid.innerHTML = '<p class="plans-unavailable">Plans currently unavailable. Please check back shortly.</p>';
    return;
  }

  grid.innerHTML = passes.map(p => {
    const visual = PASS_VISUALS[p.pass_type] || DEFAULT_PASS_VISUAL;
    const featuredClass = p.best_value ? " featured" : "";
    const badge = (p.best_value && p.badge_text)
      ? `<div class="best-value">${escapeHtmlLP(p.badge_text.toUpperCase())}</div>`
      : "";
    const features = (p.features || []).map(f => `<li>${escapeHtmlLP(f)}</li>`).join("");

    return `
      <article class="price-card${featuredClass}">
        ${badge}
        <div class="price-top"><span class="price-icon ${visual.bg}"><i data-lucide="${visual.icon}"></i></span><span>${escapeHtmlLP(p.pass_type || "")}</span></div>
        <h3>${escapeHtmlLP(p.name)}</h3>
        <div class="price">₹${formatPriceLP(p.price)} <small>${p.validity_days} days</small></div>
        <ul>${features}</ul>
        <a class="lp-btn ${visual.btnClass}" href="register.html">Get Started</a>
      </article>`;
  }).join("");

  if (window.lucide) lucide.createIcons();
}

function renderCredits(credits, container) {
  if (!credits.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = credits.map(p => {
    const bestClass = p.best_value ? " credit-best" : "";
    const badge = (p.best_value && p.badge_text)
      ? `<small>${escapeHtmlLP(p.badge_text)}</small>`
      : "";
    return `
      <div class="${bestClass.trim()}">
        <strong>${p.credits}</strong><span>₹${formatPriceLP(p.price)}</span>${badge}
      </div>`;
  }).join("");
}

async function loadFreeCreditsCopy() {
  let amount = 3; // safe visual fallback only — never used for actual signup allocation, which is enforced server-side regardless of this page
  try {
    const { data, error } = await supabaseClient.rpc("get_public_free_signup_credits");
    if (error) throw error;
    if (typeof data === "number") amount = data;
  } catch (err) {
    console.error("Could not load free-credits setting, showing fallback copy:", err);
  }

  document.querySelectorAll("[data-free-credits]").forEach(el => {
    const template = el.getAttribute("data-free-credits");
    el.textContent = template.replace("{n}", amount);
  });
}

function formatPriceLP(price) {
  const n = Number(price);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function escapeHtmlLP(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}
