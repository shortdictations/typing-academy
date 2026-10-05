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
let availableStudents = [];
let selectedStudents = [];

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAdmin();
  if (!user) return;

  if (typeof initAuthHeader === "function") initAuthHeader(user);

  document.getElementById("cBenefitType").addEventListener("change", updateBenefitFields);
  document.getElementById("cRecipientType").addEventListener("change", updateRecipientFields);
  updateBenefitFields();
  updateRecipientFields();

  const userSearch = document.getElementById("cUserSearch");
  userSearch.addEventListener("input", handleUserSearchInput);
  const userPickerToggle = document.getElementById("cUserPickerToggle");
  userPickerToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    const results = document.getElementById("cUserResults");
    if (results.classList.contains("is-open")) {
      closeUserDropdown();
    } else {
      renderUserResults(userSearch.value.trim());
      userSearch.focus();
    }
  });
  userSearch.addEventListener("focus", () => {
    if (userSearch.value.trim()) renderUserResults(userSearch.value.trim());
  });
  userSearch.addEventListener("click", () => {
    if (userSearch.value.trim()) renderUserResults(userSearch.value.trim());
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#cSpecificWrap")) closeUserDropdown();
  });
  userSearch.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeUserDropdown();
  });
  document.getElementById("campaignForm").addEventListener("submit", handleSubmit);

  await Promise.all([loadStudentEmails(), loadCampaigns()]);
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

async function loadStudentEmails() {
  const resultsEl = document.getElementById("cUserResults");
  resultsEl.innerHTML = '<div class="promotion-user-list-loading">Loading student email IDs...</div>';

  const { data, error } = await supabaseClient.rpc("admin_list_student_emails");
  if (error) {
    console.error("Could not load student emails:", error);
    resultsEl.innerHTML = '<p style="font-size:0.85rem; color:var(--danger, #b42318);">Could not load student email IDs.</p>';
    return;
  }

  availableStudents = Array.isArray(data) ? data : [];
  renderUserResults("");
}

function handleUserSearchInput() {
  renderUserResults(document.getElementById("cUserSearch").value.trim());
}

function closeUserDropdown() {
  const results = document.getElementById("cUserResults");
  results?.classList.remove("is-open");
  document.getElementById("cUserSearch")?.setAttribute("aria-expanded", "false");
  document.getElementById("cUserPickerToggle")?.classList.remove("is-open");
}

function renderUserResults(query) {
  const resultsEl = document.getElementById("cUserResults");
  const normalized = query.toLowerCase();

  const matches = availableStudents.filter(u =>
    (u.email || "").toLowerCase().includes(normalized)
  );

  if (!matches.length) {
    resultsEl.innerHTML = '<div class="promotion-user-dropdown-empty">No matching student email IDs.</div>';
    resultsEl.classList.add("is-open");
    return;
  }

  resultsEl.innerHTML = `
    <div class="promotion-user-results-list">
      ${matches.map(u => `
        <button type="button" class="promotion-user-result" data-user-id="${escapeHtml(u.id)}" data-user-email="${escapeHtml(u.email)}">
          <span>${escapeHtml(u.email)}</span>
        </button>
      `).join("")}
    </div>`;

  resultsEl.classList.add("is-open");
  document.getElementById("cUserSearch")?.setAttribute("aria-expanded", "true");
  document.getElementById("cUserPickerToggle")?.classList.add("is-open");
  resultsEl.querySelectorAll(".promotion-user-result").forEach(button => {
    button.addEventListener("click", () => {
      toggleSelectedUser(button.dataset.userId, button.dataset.userEmail);
    });
  });
}

function toggleSelectedUser(id, email) {
  const index = selectedStudents.findIndex(s => s.id === id);
  if (index >= 0) selectedStudents.splice(index, 1);
  else selectedStudents.push({ id, email });
  renderSelectedUsers();
}

function renderSelectedUsers() {
  const el = document.getElementById("cSelectedUser");
  if (!selectedStudents.length) { el.style.display = "none"; el.textContent = ""; return; }
  el.style.display = "block";
  el.textContent = "Selected " + selectedStudents.length + " student" + (selectedStudents.length === 1 ? "" : "s") + ": " + selectedStudents.map(s => s.email).join(", ");
}

function clearSelectedUser() {
  selectedStudents = [];
  document.getElementById("cSpecificUserId").value = "";
  renderSelectedUsers();
  document.getElementById("cUserResults").classList.remove("is-open");
}

/* ---------------- Submit ---------------- */

async function sendCampaignGiftEmails(campaignId) {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return { sent: 0, pending: 0 };

    const response = await fetch(SUPABASE_URL + "/functions/v1/send-transactional-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + session.access_token,
      },
      body: JSON.stringify({ type: "campaign", campaign_id: campaignId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not send gift emails.");
    return data;
  } catch (error) {
    console.error("Campaign gift email request failed:", error);
    return { sent: 0, pending: 0, error: error.message || "Could not send gift emails." };
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  hideFormMessages();

  const submitBtn = document.getElementById("submitBtn");
  const name = document.getElementById("cName").value.trim();
  const benefitType = document.getElementById("cBenefitType").value;
  const validityDays = parseInt(document.getElementById("cValidityDays").value, 10);
  const recipientType = document.getElementById("cRecipientType").value;
  const specificUserId = selectedStudents.length === 1 ? selectedStudents[0].id : null;
  const specificUserIds = selectedStudents.map(s => s.id);

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

  if (recipientType === "SPECIFIC" && !specificUserIds.length) {
    showFormError("Please search for and select at least one student.");
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
    const { data: campaignId, error } = await supabaseClient.rpc("admin_create_promotional_campaign", {
      p_name: name,
      p_benefit_type: benefitType,
      p_credits: credits,
      p_validity_days: validityDays,
      p_recipient_type: recipientType,
      p_specific_user_id: specificUserId,
      p_specific_user_ids: specificUserIds
    });
    if (error) throw error;

    const emailResult = await sendCampaignGiftEmails(campaignId);
    if (emailResult.error) {
      showFormSuccess("Campaign created, but gift emails are waiting to be sent.");
    } else if (emailResult.sent > 0) {
      showFormSuccess("Campaign created. Gift email sent to " + emailResult.sent + " student" + (emailResult.sent === 1 ? "" : "s") + ".");
    } else {
      showFormSuccess("Campaign created" + (recipientType === "ALL_NEW" ? ". It will apply automatically to future signups." : "."));
    }
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
    .select("campaign_id, user_id, status")
    .in("campaign_id", campaigns.map(c => c.id));

  const countsByCampaign = {};
  const usersByCampaign = {};
  (grants || []).forEach(g => {
    if (!countsByCampaign[g.campaign_id]) countsByCampaign[g.campaign_id] = { granted: 0, failed: 0 };
    if (g.status === "GRANTED") countsByCampaign[g.campaign_id].granted++;
    else countsByCampaign[g.campaign_id].failed++;
  });

  let rows = "";
  campaigns.forEach(c => {
    const benefitLabel = c.benefit_type === "CREDITS" ? c.credits + " credits" : c.benefit_type + " pass";
    const counts = countsByCampaign[c.id] || { granted: 0, failed: 0 };
    const campaignUsers = (grants || []).filter(g => g.campaign_id === c.id && g.status === "GRANTED").map(g => availableStudents.find(u => u.id === g.user_id)).filter(Boolean);
    const recipientLabel = c.recipient_type === "ALL_EXISTING" ? "All existing"
      : c.recipient_type === "ALL_NEW" ? "All new signups"
      : (campaignUsers.length > 1 ? campaignUsers.length + " specific students" : "Specific student");
    const specificStudent = c.recipient_type === "SPECIFIC" ? campaignUsers[0] : null;
    const recipientCell = c.recipient_type === "SPECIFIC" && campaignUsers.length
      ? campaignUsers.map(u => escapeHtml(u.email)).join("<br>")
      : escapeHtml(recipientLabel);
    const countLabel = counts.failed > 0
      ? counts.granted + " granted, " + counts.failed + " failed"
      : counts.granted + " granted";
    const dateStr = new Date(c.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    rows += `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td><span class="pill">${escapeHtml(benefitLabel)}</span></td>
        <td>${c.validity_days} days</td>
        <td>${recipientCell}</td>
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
