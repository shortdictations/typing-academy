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

  document.getElementById("pType").addEventListener("change", updateTypeFields);
  updateTypeFields();

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
    rows += `
      <tr>
        <td>${escapeHtml(p.name)}</td>
        <td><span class="pill">${escapeHtml(subLabel)}</span></td>
        <td>&#8377;${p.price}</td>
        <td>${p.validity_days} days</td>
        <td>${p.display_order}</td>
        <td>${p.active ? "Active" : "Inactive"}</td>
        <td style="white-space:nowrap;">
          <button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;" onclick="startEdit('${p.id}')">Edit</button>
          <button type="button" class="btn" style="padding:5px 10px;font-size:0.75rem;" onclick="toggleActive('${p.id}')">${p.active ? "Deactivate" : "Activate"}</button>
          <button type="button" class="btn" style="padding:5px 10px;font-size:0.75rem;" onclick="deleteProduct('${p.id}')">Delete</button>
        </td>
      </tr>`;
  });

  container.innerHTML = `
    <div style="overflow-x:auto;">
    <table class="marksheet">
      <thead>
        <tr><th>Name</th><th>Type</th><th>Price</th><th>Validity</th><th>Order</th><th>Status</th><th>Actions</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
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
    active: document.getElementById("pActive").value === "true"
  };

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
  document.getElementById("pName").value = p.name;
  document.getElementById("pPrice").value = p.price;
  document.getElementById("pValidity").value = p.validity_days;
  document.getElementById("pDescription").value = p.description || "";
  document.getElementById("pFeatures").value = (p.features || []).join("\n");
  document.getElementById("pOrder").value = p.display_order;
  document.getElementById("pActive").value = p.active ? "true" : "false";

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
