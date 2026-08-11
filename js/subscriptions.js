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
});

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

  renderPassProducts(data.filter(p => p.product_type === "PASS"), passGrid);
  renderCreditProducts(data.filter(p => p.product_type === "CREDIT"), creditGrid);
}

function featuresListHtml(features) {
  if (!features || features.length === 0) return "";
  return '<ul class="plan-features">' +
    features.map(f => "<li>" + escapeHtmlLocal(f) + "</li>").join("") +
    "</ul>";
}

function renderPassProducts(products, grid) {
  if (products.length === 0) {
    grid.innerHTML = '<div class="empty-state">No plans available right now.</div>';
    return;
  }

  grid.innerHTML = products.map(p => {
    const featured = p.pass_type === "COMBO" ? " featured" : "";
    const badge = p.pass_type === "COMBO" ? '<span class="best-value-badge">Best Value</span>' : "";
    return `
      <div class="card pass-card${featured}">
        ${badge}
        <div class="card-label">${escapeHtmlLocal(p.name)}</div>
        <div class="pass-price">&#8377;${p.price}</div>
        <div class="pass-duration">${p.validity_days} Days &middot; Non-recurring</div>
        ${p.description ? '<p style="font-size:0.85rem;color:var(--ink-soft);margin:0 0 10px;">' + escapeHtmlLocal(p.description) + "</p>" : ""}
        ${featuresListHtml(p.features)}
        <button class="btn btn-full" disabled style="opacity:0.6; cursor:not-allowed;"
          data-product-id="${p.id}" data-product-type="PASS" data-pass-type="${p.pass_type}">
          Buy ${escapeHtmlLocal(p.name)} — Coming Soon
        </button>
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
        <button class="btn btn-ghost btn-full" disabled style="opacity:0.6; cursor:not-allowed;"
          data-product-id="${p.id}" data-product-type="CREDIT" data-credits="${p.credits}">
          Buy ${escapeHtmlLocal(p.name)} — Coming Soon
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

  if (validRow) {
    const expiryText = new Date(validRow.expires_at).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric"
    });
    el.innerHTML = 'Active until<br><strong style="color:var(--ink);">' + expiryText + '</strong>';
  } else {
    el.textContent = "Not active";
  }
}

function renderCreditStatus(credits, el) {
  const now = new Date();
  const unexpired = credits.filter(c => new Date(c.expires_at) > now);
  const free = unexpired.filter(c => c.credit_type === "free").reduce((sum, c) => sum + c.credits_remaining, 0);
  const purchased = unexpired.filter(c => c.credit_type === "purchased").reduce((sum, c) => sum + c.credits_remaining, 0);
  const total = free + purchased;

  el.innerHTML =
    '&#127873; Free: ' + free + '<br>' +
    '&#128179; Purchased: ' + purchased + '<br>' +
    '<strong>Total: ' + total + '</strong>';
}
