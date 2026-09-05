/* ============================================================
   admin-products.js
   ------------------------------------------------------------
   Manages the products catalog (Pass Plans + Credit Packages).
   This is the price list only — it never touches user_passes,
   wallet_credits, purchase_transactions, or credit_transactions.
   Editing or deactivating a product here has zero effect on
   anything a student has already purchased, by construction:
   this table has no foreign key relationship to those tables at
   all. Gated by requireAdmin(); real security is the products
   RLS policies (admin-only write).
   ============================================================ */

let editingId = null;

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAdmin();
  if (!user) return;

  // Same call dashboard.js/subscriptions.js already make — wires the
  // header avatar dropdown, mobile profile drawer, bottom nav active
  // state, and sidebar collapse toggle. Not previously called on any
  // admin page (checked directly), which left the header's logout
  // button dead even before this redesign.
  if (typeof initAuthHeader === "function") initAuthHeader(user);

  document.getElementById("pType").addEventListener("change", updateTypeFields);
  updateTypeFields();

  document.getElementById("pDiscountEnabled").addEventListener("change", updateDiscountFieldsVisibility);
  ["pPrice", "pDiscountType", "pDiscountValue"].forEach(id => {
    document.getElementById(id).addEventListener("input", updateDiscountPreview);
  });
  updateDiscountFieldsVisibility();

  document.getElementById("productForm").addEventListener("submit", handleSubmit);
  document.getElementById("cancelEditBtn").addEventListener("click", exitEditMode);
  document.getElementById("saveFreeCreditsBtn").addEventListener("click", saveFreeCredits);

  await loadFreeCreditsSetting();
  await loadProducts();
});

async function loadFreeCreditsSetting() {
  const { data, error } = await supabaseClient
    .from("app_settings")
    .select("free_signup_credits")
    .eq("id", true)
    .maybeSingle();

  if (error || !data) {
    console.error(error);
    return;
  }
  document.getElementById("freeCreditsInput").value = data.free_signup_credits;
}

async function saveFreeCredits() {
  const errorEl = document.getElementById("settingsError");
  const successEl = document.getElementById("settingsSuccess");
  errorEl.style.display = "none";
  successEl.style.display = "none";

  const value = parseInt(document.getElementById("freeCreditsInput").value, 10);
  if (isNaN(value) || value < 0) {
    errorEl.textContent = "Please enter a valid number (0 or more).";
    errorEl.style.display = "block";
    return;
  }

  const btn = document.getElementById("saveFreeCreditsBtn");
  btn.disabled = true;

  const { error } = await supabaseClient
    .from("app_settings")
    .update({ free_signup_credits: value })
    .eq("id", true);

  btn.disabled = false;

  if (error) {
    errorEl.textContent = error.message || "Could not save. Please try again.";
    errorEl.style.display = "block";
    return;
  }

  successEl.textContent = "Saved. This applies to new signups from now on — existing users' credits are unaffected.";
  successEl.style.display = "block";
  setTimeout(() => { successEl.style.display = "none"; }, 4000);
}

function updateTypeFields() {
  const type = document.getElementById("pType").value;
  document.getElementById("passTypeWrap").style.display = type === "PASS" ? "block" : "none";
  document.getElementById("creditsWrap").style.display = type === "CREDIT" ? "block" : "none";
  // Featured/badge is now available for BOTH product types — only one
  // product across the whole catalog can hold it at a time (see
  // clearOtherBestValue, no longer scoped to product_type).
}

// Mirrors compute_effective_price() (the database function the
// payment edge function and student pricing RPC both actually use)
// purely for a live admin preview — this number is never sent
// anywhere or trusted for anything; the server always recalculates
// its own answer independently from the saved row.
function updateDiscountFieldsVisibility() {
  const enabled = document.getElementById("pDiscountEnabled").checked;
  document.getElementById("discountFields").style.display = enabled ? "block" : "none";
  updateDiscountPreview();
}

function updateDiscountPreview() {
  const enabled = document.getElementById("pDiscountEnabled").checked;
  const previewEl = document.getElementById("pDiscountPreview");
  const price = parseFloat(document.getElementById("pPrice").value);

  if (!enabled || isNaN(price)) {
    previewEl.textContent = "—";
    return;
  }

  const type = document.getElementById("pDiscountType").value;
  const value = parseFloat(document.getElementById("pDiscountValue").value);
  if (isNaN(value)) {
    previewEl.textContent = "—";
    return;
  }

  let final = type === "PERCENTAGE" ? price - (price * value / 100) : price - value;
  if (final < 0) final = 0;
  if (final > price) final = price;
  previewEl.textContent = "\u20B9" + final.toFixed(2) + " (was \u20B9" + price.toFixed(2) + ")";
}

/* ---------------- Loading / rendering ---------------- */

async function loadProducts() {
  const { data, error } = await supabaseClient
    .from("products")
    .select("*")
    .order("product_type", { ascending: true })
    .order("display_order", { ascending: true });

  if (error) {
    document.getElementById("passListBody").innerHTML = '<div class="empty-state">Could not load products.</div>';
    document.getElementById("creditListBody").innerHTML = "";
    console.error(error);
    return;
  }

  window._productLookup = {};
  data.forEach(p => { window._productLookup[p.id] = p; });

  renderList(data.filter(p => p.product_type === "PASS"), document.getElementById("passListBody"), "No pass plans yet.");
  renderList(data.filter(p => p.product_type === "CREDIT"), document.getElementById("creditListBody"), "No credit packages yet.");
}

function renderList(products, container, emptyText) {
  if (products.length === 0) {
    container.innerHTML = '<div class="empty-state">' + emptyText + '</div>';
    return;
  }

  let rows = "";
  products.forEach(p => {
    const subLabel = p.product_type === "PASS" ? p.pass_type : (p.credits + " credits");
    const featuredCell = p.best_value
      ? '<td><span class="pill">&#9733; ' + escapeHtml(p.badge_text || "Featured") + '</span></td>'
      : '<td></td>';
    const featuredAction = '<button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;" onclick="toggleBestValue(\'' + p.id + '\')">' + (p.best_value ? "Remove Featured" : "Set Featured") + '</button>';
    const discountCell = discountStatusCell(p);
    rows += `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td><span class="pill">${escapeHtml(subLabel)}</span></td>
        <td>&#8377;${p.price}</td>
        <td>${p.validity_days} days</td>
        ${discountCell}
        <td>${p.display_order}</td>
        <td>${p.active ? "Active" : "Inactive"}</td>
        ${featuredCell}
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;" onclick="startEdit('${p.id}')">Edit</button>
          <button type="button" class="btn" style="padding:5px 10px;font-size:0.75rem;" onclick="toggleActive('${p.id}')">${p.active ? "Deactivate" : "Activate"}</button>
          ${featuredAction}
          <button type="button" class="btn" style="padding:5px 10px;font-size:0.75rem;" onclick="deleteProduct('${p.id}')">Delete</button>
        </td>
      </tr>`;
  });

  container.innerHTML = `
    <div style="overflow-x:auto;">
    <table class="marksheet">
      <thead>
        <tr><th>Name</th><th>Type</th><th>Price</th><th>Validity</th><th>Discount</th><th>Order</th><th>Status</th><th>Featured</th><th>Actions</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
}

// Mirrors compute_effective_price()'s own active-window check
// (enabled + type/value set + now() within start/end) purely for
// this at-a-glance list column — never trusted as pricing authority,
// same as the live form preview above.
function discountStatusCell(p) {
  if (!p.discount_enabled || !p.discount_type || p.discount_value == null) {
    return "<td>&mdash;</td>";
  }
  const now = new Date();
  const started = !p.discount_start_at || new Date(p.discount_start_at) <= now;
  const ended = p.discount_end_at && new Date(p.discount_end_at) < now;
  if (!started) return '<td><span class="pill">Scheduled</span></td>';
  if (ended) return '<td><span class="pill">Expired</span></td>';
  const label = p.discount_type === "PERCENTAGE" ? p.discount_value + "% off" : "\u20B9" + p.discount_value + " off";
  return '<td><span class="pill">' + escapeHtml(label) + '</span></td>';
}

/* ---------------- Add / Edit ---------------- */

async function handleSubmit(e) {
  e.preventDefault();
  hideFormMessages();

  const submitBtn = document.getElementById("submitBtn");
  submitBtn.disabled = true;

  const type = document.getElementById("pType").value;
  const featuresRaw = document.getElementById("pFeatures").value;
  const features = featuresRaw.split("\n").map(f => f.trim()).filter(f => f.length > 0);

  const payload = {
    product_type: type,
    pass_type: type === "PASS" ? document.getElementById("pPassType").value : null,
    credits: type === "CREDIT" ? parseInt(document.getElementById("pCredits").value, 10) : null,
    name: document.getElementById("pName").value.trim(),
    price: parseFloat(document.getElementById("pPrice").value),
    validity_days: parseInt(document.getElementById("pValidity").value, 10),
    description: document.getElementById("pDescription").value.trim() || null,
    features: features.length ? features : null,
    display_order: parseInt(document.getElementById("pOrder").value, 10) || 0,
    active: document.getElementById("pActive").value === "true",
    // Featured is now available for either product type — enforcement
    // that only one product total can hold it lives in
    // clearOtherBestValue below, not in a type check here.
    best_value: document.getElementById("pBestValue").checked,
    badge_text: document.getElementById("pBadgeText").value.trim() || null
  };

  const discountEnabled = document.getElementById("pDiscountEnabled").checked;
  payload.discount_enabled = discountEnabled;
  if (discountEnabled) {
    const discountType = document.getElementById("pDiscountType").value;
    const discountValue = parseFloat(document.getElementById("pDiscountValue").value);
    const startRaw = document.getElementById("pDiscountStart").value;
    const endRaw = document.getElementById("pDiscountEnd").value;

    // Mirrors the database's own check constraints — this catches an
    // invalid configuration with a clear message before ever
    // attempting the save, but the constraints themselves are what
    // actually stop it from being persisted even if this check were
    // somehow bypassed.
    if (isNaN(discountValue)) {
      showFormError("Please enter a discount value.");
      submitBtn.disabled = false;
      return;
    }
    if (discountType === "PERCENTAGE" && (discountValue < 0 || discountValue > 100)) {
      showFormError("Percentage discount must be between 0 and 100.");
      submitBtn.disabled = false;
      return;
    }
    if (discountType === "FIXED" && (discountValue < 0 || discountValue > payload.price)) {
      showFormError("Fixed discount cannot be negative or exceed the regular price.");
      submitBtn.disabled = false;
      return;
    }
    if (startRaw && endRaw && startRaw > endRaw) {
      showFormError("Discount start date cannot be after the end date.");
      submitBtn.disabled = false;
      return;
    }

    payload.discount_type = discountType;
    payload.discount_value = discountValue;
    payload.discount_start_at = startRaw ? new Date(startRaw + "T00:00:00").toISOString() : null;
    payload.discount_end_at = endRaw ? new Date(endRaw + "T23:59:59").toISOString() : null;
  } else {
    payload.discount_type = null;
    payload.discount_value = null;
    payload.discount_start_at = null;
    payload.discount_end_at = null;
  }

  // plan_code is only ever set on CREATION — the field is disabled during
  // edit and excluded from the payload entirely, so an existing product's
  // stable identifier can never be silently changed and break the meaning
  // behind entitlements that already reference it.
  if (!editingId) {
    const planCode = document.getElementById("pPlanCode").value.trim();
    if (planCode) payload.plan_code = planCode;
  }

  if (type === "CREDIT" && !payload.credits) {
    showFormError("Please enter the number of credits for this package.");
    submitBtn.disabled = false;
    return;
  }

  try {
    // Only ONE active PASS product can be Best Value at a time — if this
    // save turns it on, clear it from every other PASS product first.
    // (Also backstopped by a partial unique index in the database, so
    // this can never race into two rows being true at once.)
    if (payload.best_value) {
      await clearOtherBestValue(editingId);
    }

    if (editingId) {
      const { error } = await supabaseClient.from("products").update(payload).eq("id", editingId);
      if (error) throw error;
      showFormSuccess("Product updated. Any credits/passes already purchased by students are unaffected.");
    } else {
      const { error } = await supabaseClient.from("products").insert(payload);
      if (error) throw error;
      showFormSuccess("Product added.");
    }
    exitEditMode();
    await loadProducts();
  } catch (err) {
    showFormError(err.message || "Something went wrong. Please try again.");
  } finally {
    submitBtn.disabled = false;
  }
}

// Clears best_value on every product (either type) except the one
// being saved (excludeId is null when creating a brand-new product) —
// only one product across the whole catalog can be Featured at a time.
async function clearOtherBestValue(excludeId) {
  let query = supabaseClient
    .from("products")
    .update({ best_value: false })
    .eq("best_value", true);
  if (excludeId) query = query.neq("id", excludeId);
  const { error } = await query;
  if (error) throw error;
}

// Quick toggle from the Pass Plans list, without opening the edit form.
async function toggleBestValue(id) {
  const p = window._productLookup[id];
  if (!p) return;

  try {
    if (!p.best_value) {
      await clearOtherBestValue(id);
    }
    const { error } = await supabaseClient.from("products").update({ best_value: !p.best_value }).eq("id", id);
    if (error) throw error;
    await loadProducts();
  } catch (err) {
    alert("Could not update: " + (err.message || "Please try again."));
  }
}

function startEdit(id) {
  const p = window._productLookup[id];
  if (!p) return;

  editingId = id;
  document.getElementById("pType").value = p.product_type;
  updateTypeFields();
  document.getElementById("pPlanCode").value = p.plan_code || "";
  document.getElementById("pPlanCode").disabled = true;
  if (p.product_type === "PASS") document.getElementById("pPassType").value = p.pass_type;
  if (p.product_type === "CREDIT") document.getElementById("pCredits").value = p.credits;
  document.getElementById("pBestValue").checked = !!p.best_value;
  document.getElementById("pBadgeText").value = p.badge_text || "";
  document.getElementById("pDiscountEnabled").checked = !!p.discount_enabled;
  document.getElementById("pDiscountType").value = p.discount_type || "PERCENTAGE";
  document.getElementById("pDiscountValue").value = p.discount_value != null ? p.discount_value : "";
  document.getElementById("pDiscountStart").value = p.discount_start_at ? p.discount_start_at.slice(0, 10) : "";
  document.getElementById("pDiscountEnd").value = p.discount_end_at ? p.discount_end_at.slice(0, 10) : "";
  document.getElementById("pName").value = p.name;
  document.getElementById("pPrice").value = p.price;
  document.getElementById("pValidity").value = p.validity_days;
  document.getElementById("pDescription").value = p.description || "";
  document.getElementById("pFeatures").value = (p.features || []).join("\n");
  document.getElementById("pOrder").value = p.display_order;
  document.getElementById("pActive").value = p.active ? "true" : "false";
  updateDiscountFieldsVisibility();

  document.getElementById("formLabel").textContent = "Editing: " + p.name;
  document.getElementById("submitBtn").textContent = "Update Product";
  document.getElementById("cancelEditBtn").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exitEditMode() {
  editingId = null;
  document.getElementById("productForm").reset();
  document.getElementById("pPlanCode").disabled = false;
  updateTypeFields();
  updateDiscountFieldsVisibility();
  document.getElementById("formLabel").textContent = "Add a New Product";
  document.getElementById("submitBtn").textContent = "Add Product";
  document.getElementById("cancelEditBtn").style.display = "none";
}

async function toggleActive(id) {
  const p = window._productLookup[id];
  if (!p) return;
  const { error } = await supabaseClient.from("products").update({ active: !p.active }).eq("id", id);
  if (error) { alert("Could not update: " + error.message); return; }
  await loadProducts();
}

async function deleteProduct(id) {
  const p = window._productLookup[id];
  const label = p ? p.name : "this product";
  if (!confirm('Delete "' + label + '"? Prefer Deactivate if this package has ever been purchased — deleting only removes it from the catalog, it never affects credits/passes students already have.')) return;

  const { error } = await supabaseClient.from("products").delete().eq("id", id);
  if (error) { alert("Could not delete: " + error.message); return; }
  await loadProducts();
}

/* ---------------- Helpers ---------------- */

function hideFormMessages() {
  document.getElementById("formError").style.display = "none";
  document.getElementById("formSuccess").style.display = "none";
}
function showFormError(text) {
  const el = document.getElementById("formError");
  el.textContent = text;
  el.style.display = "block";
}
function showFormSuccess(text) {
  const el = document.getElementById("formSuccess");
  el.textContent = text;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 4000);
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
