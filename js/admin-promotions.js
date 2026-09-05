/* ============================================================
   admin-promotions.js
   ------------------------------------------------------------
   Lets an admin grant free credits or a pass directly to a
   specific student, all existing students, or all future
   signups. All actual granting happens server-side via
   admin_create_promotional_campaign() / the new-signup trigger —
   this file only collects the form, calls that one RPC, and
   renders the resulting history. It never writes to
   wallet_credits, user_passes, or promotional_grants directly.
   ============================================================ */

let searchDebounceTimer = null;

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAdmin();
  if (!user) return;

  if (typeof initAuthHeader === "function") initAuthHeader(user);

  document.getElementById("cBenefitType").addEventListener("change", updateBenefitFields);
  document.getElementById("cRecipientType").addEventListener("change", updateRecipientFields);
  updateBenefitFields();
  updateRecipientFields();

  document.getElementById("cUserSearch").addEventListener("input", handleUserSearchInput);
  document.getElementById("campaignForm").addEventListener("submit", handleSubmit);

  await loadCampaigns();
});

function updateBenefitFields() {
  const isCredits = document.getElementById("cBenefitType").value === "CREDITS";
  document.getElementById("cCreditsWrap").style.display = isCredits ? "block" : "none";
}

function updateRecipientFields() {
  const type = document.getElementById("cRecipientType").value;
  document.getElementById("cSpecificWrap").style.display = type === "SPECIFIC" ? "block" : "none";
  document.getElementById("cAllExistingWarning").style.display = type === "ALL_EXISTING" ? "block" : "none";
  if (type !== "SPECIFIC") clearSelectedUser();
}

/* ---------------- User search ---------------- */

function handleUserSearchInput() {
  clearSelectedUser();
  clearTimeout(searchDebounceTimer);
  const query = document.getElementById("cUserSearch").value.trim();
  const resultsEl = document.getElementById("cUserResults");

  if (query.length < 3) {
    resultsEl.innerHTML = "";
    return;
  }

  // Debounced — admin_search_users() is a real RPC call; no reason to
  // fire one on every keystroke.
  searchDebounceTimer = setTimeout(async () => {
    const { data, error } = await supabaseClient.rpc("admin_search_users", { p_query: query });
    if (error) {
      resultsEl.innerHTML = '<p style="font-size:0.85rem; color:var(--danger, #b42318);">Search failed.</p>';
      return;
    }
    if (!data || data.length === 0) {
      resultsEl.innerHTML = '<p style="font-size:0.85rem; color:var(--ink-soft);">No matching students.</p>';
      return;
    }
    resultsEl.innerHTML = data.map(u =>
      '<button type="button" class="btn btn-ghost" style="display:block; width:100%; text-align:left; padding:8px 10px; font-size:0.85rem; margin-bottom:4px;" onclick="selectUser(\'' + u.id + '\', \'' + escapeHtml(u.email) + '\')">' +
        escapeHtml(u.email) +
      '</button>'
    ).join("");
  }, 350);
}

function selectUser(id, email) {
  document.getElementById("cSpecificUserId").value = id;
  document.getElementById("cUserResults").innerHTML = "";
  document.getElementById("cUserSearch").value = "";
  const selectedEl = document.getElementById("cSelectedUser");
  selectedEl.style.display = "block";
  selectedEl.textContent = "Selected: " + email;
}

function clearSelectedUser() {
  document.getElementById("cSpecificUserId").value = "";
  document.getElementById("cSelectedUser").style.display = "none";
  document.getElementById("cSelectedUser").textContent = "";
}

/* ---------------- Submit ---------------- */

async function handleSubmit(e) {
  e.preventDefault();
  hideFormMessages();

  const submitBtn = document.getElementById("submitBtn");
  const name = document.getElementById("cName").value.trim();
  const benefitType = document.getElementById("cBenefitType").value;
  const validityDays = parseInt(document.getElementById("cValidityDays").value, 10);
  const recipientType = document.getElementById("cRecipientType").value;
  const specificUserId = document.getElementById("cSpecificUserId").value || null;

  let credits = null;
  if (benefitType === "CREDITS") {
    credits = parseInt(document.getElementById("cCredits").value, 10);
    if (!credits || credits <= 0) {
      showFormError("Please enter a valid number of credits.");
      return;
    }
  }

  if (!validityDays || validityDays <= 0) {
    showFormError("Please enter a valid number of days.");
    return;
  }

  if (recipientType === "SPECIFIC" && !specificUserId) {
    showFormError("Please search for and select a student.");
    return;
  }

  // A confirm() dialog here is deliberate friction for the two
  // recipient types that reach many/unknown-future students at once
  // — a specific-student grant is low-blast-radius and doesn't need
  // the same pause.
  if (recipientType === "ALL_EXISTING" && !confirm("Grant this to every existing student right now? This cannot be undone from this page.")) {
    return;
  }
  if (recipientType === "ALL_NEW" && !confirm("Every new signup from now on will automatically receive this. Continue?")) {
    return;
  }

  submitBtn.disabled = true;
  try {
    const { error } = await supabaseClient.rpc("admin_create_promotional_campaign", {
      p_name: name,
      p_benefit_type: benefitType,
      p_credits: credits,
      p_validity_days: validityDays,
      p_recipient_type: recipientType,
      p_specific_user_id: specificUserId
    });
    if (error) throw error;

    showFormSuccess("Campaign created" + (recipientType === "ALL_NEW" ? ". It will apply automatically to future signups." : "."));
    document.getElementById("campaignForm").reset();
    updateBenefitFields();
    updateRecipientFields();
    clearSelectedUser();
    await loadCampaigns();
  } catch (err) {
    showFormError(err.message || "Something went wrong. Please try again.");
  } finally {
    submitBtn.disabled = false;
  }
}

/* ---------------- History ---------------- */

async function loadCampaigns() {
  const container = document.getElementById("campaignListBody");

  const { data: campaigns, error } = await supabaseClient
    .from("promotional_campaigns")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    container.innerHTML = '<div class="empty-state">Could not load campaigns.</div>';
    console.error(error);
    return;
  }

  if (!campaigns || campaigns.length === 0) {
    container.innerHTML = '<div class="empty-state">No campaigns yet.</div>';
    return;
  }

  const { data: grants } = await supabaseClient
    .from("promotional_grants")
    .select("campaign_id, status")
    .in("campaign_id", campaigns.map(c => c.id));

  const countsByCampaign = {};
  (grants || []).forEach(g => {
    if (!countsByCampaign[g.campaign_id]) countsByCampaign[g.campaign_id] = { granted: 0, failed: 0 };
    if (g.status === "GRANTED") countsByCampaign[g.campaign_id].granted++;
    else countsByCampaign[g.campaign_id].failed++;
  });

  let rows = "";
  campaigns.forEach(c => {
    const benefitLabel = c.benefit_type === "CREDITS" ? c.credits + " credits" : c.benefit_type + " pass";
    const recipientLabel = c.recipient_type === "ALL_EXISTING" ? "All existing"
      : c.recipient_type === "ALL_NEW" ? "All new signups"
      : "Specific student";
    const counts = countsByCampaign[c.id] || { granted: 0, failed: 0 };
    const countLabel = counts.failed > 0
      ? counts.granted + " granted, " + counts.failed + " failed"
      : counts.granted + " granted";
    const dateStr = new Date(c.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    rows += `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td><span class="pill">${escapeHtml(benefitLabel)}</span></td>
        <td>${c.validity_days} days</td>
        <td>${escapeHtml(recipientLabel)}</td>
        <td>${dateStr}</td>
        <td>${escapeHtml(countLabel)}</td>
      </tr>`;
  });

  container.innerHTML = `
    <div style="overflow-x:auto;">
    <table class="marksheet">
      <thead>
        <tr><th>Name</th><th>Benefit</th><th>Validity</th><th>Recipients</th><th>Created</th><th>Grants</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
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
  setTimeout(() => { el.style.display = "none"; }, 5000);
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
