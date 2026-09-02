/* ============================================================
   settings.js
   ------------------------------------------------------------
   Full Name, Mobile Number, Email (display + verification status),
   and password updates. Name/password go through Supabase Auth's
   own supabaseClient.auth.updateUser() — the same session already
   established by requireLogin(), no separate backend. full_name is
   also mirrored into the "profiles" table, matching the same
   mirroring registerStudent() already does at signup (js/auth.js),
   so the two never drift apart.

   Mobile number is stored in user_metadata.phone (NOT Supabase
   Auth's built-in `phone` field, which is a second sign-in identity
   requiring SMS/OTP verification that isn't configured in this
   project) — same no-schema-change mechanism full_name already
   uses, so this needed no database migration.

   Each row's "Change" button expands an inline form for just that
   field, rather than one big always-open form — data-toggle on the
   button names the row id to show/hide, handled by one delegated
   listener rather than one bespoke handler per row.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin(); // redirects to login.html if not logged in
  if (!user) return;

  renderAccountDisplays(user);
  wireToggleButtons();

  document.getElementById("nameForm").addEventListener("submit", handleNameSave);
  document.getElementById("mobileForm").addEventListener("submit", handleMobileSave);
  document.getElementById("passwordForm").addEventListener("submit", handlePasswordSave);
});

function renderAccountDisplays(user) {
  const name = (user.user_metadata && user.user_metadata.full_name) || "";
  const mobile = (user.user_metadata && user.user_metadata.phone) || "";

  document.getElementById("nameDisplay").textContent = name || "Not added";
  document.getElementById("settingsName").value = name;

  document.getElementById("mobileDisplay").textContent = mobile || "Not added";
  document.getElementById("settingsMobile").value = mobile;

  document.getElementById("emailDisplay").textContent = user.email || "—";

  // email_confirmed_at is set by Supabase Auth itself once the
  // student clicks the confirmation link in their signup email —
  // real verification status, not something this page tracks itself.
  const verifiedPill = document.getElementById("emailVerifiedPill");
  if (user.email_confirmed_at) {
    verifiedPill.textContent = "Verified ✓";
    verifiedPill.className = "settings-verified-pill";
  } else {
    verifiedPill.textContent = "Not verified";
    verifiedPill.className = "settings-verified-pill settings-unverified-pill";
  }
}

// Every "Change"/"Cancel" button carries data-toggle="<row id>" —
// one delegated listener instead of one per row/button.
function wireToggleButtons() {
  document.querySelectorAll("[data-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = document.getElementById(btn.dataset.toggle);
      if (row) row.style.display = row.style.display === "none" ? "block" : "none";
    });
  });
}

async function handleNameSave(e) {
  e.preventDefault();
  hideSettingsMessages("profile");

  const name = document.getElementById("settingsName").value.trim();
  if (!name) return;

  const btn = document.getElementById("nameSaveBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const { data: sessionData } = await supabaseClient.auth.getUser();
    const currentUser = sessionData.user;

    const { error } = await supabaseClient.auth.updateUser({ data: { full_name: name } });
    if (error) throw error;

    if (currentUser) {
      await supabaseClient.from("profiles").update({ full_name: name }).eq("id", currentUser.id);
    }

    document.getElementById("nameDisplay").textContent = name;
    showSettingsSuccess("profile", "Name updated.");
    document.getElementById("nameEditRow").style.display = "none";
  } catch (err) {
    showSettingsError("profile", err.message || "Could not save your changes. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

async function handleMobileSave(e) {
  e.preventDefault();
  hideSettingsMessages("mobile");

  const mobile = document.getElementById("settingsMobile").value.trim();

  const btn = document.getElementById("mobileSaveBtn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const { error } = await supabaseClient.auth.updateUser({ data: { phone: mobile } });
    if (error) throw error;

    document.getElementById("mobileDisplay").textContent = mobile || "Not added";
    showSettingsSuccess("mobile", "Mobile number updated.");
    document.getElementById("mobileEditRow").style.display = "none";
  } catch (err) {
    showSettingsError("mobile", err.message || "Could not save your changes. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
}

async function handlePasswordSave(e) {
  e.preventDefault();
  hideSettingsMessages("password");

  const newPassword = document.getElementById("newPassword").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (newPassword.length < 6) {
    showSettingsError("password", "Password must be at least 6 characters.");
    return;
  }
  if (newPassword !== confirmPassword) {
    showSettingsError("password", "Passwords do not match.");
    return;
  }

  const btn = document.getElementById("passwordSaveBtn");
  btn.disabled = true;
  btn.textContent = "Updating...";

  try {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw error;
    showSettingsSuccess("password", "Password updated.");
    document.getElementById("passwordForm").reset();
    document.getElementById("passwordEditRow").style.display = "none";
  } catch (err) {
    showSettingsError("password", err.message || "Could not update your password. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Update Password";
  }
}

function hideSettingsMessages(scope) {
  document.getElementById(scope + "Error").style.display = "none";
  document.getElementById(scope + "Success").style.display = "none";
}
function showSettingsError(scope, text) {
  const el = document.getElementById(scope + "Error");
  el.textContent = text;
  el.style.display = "block";
}
function showSettingsSuccess(scope, text) {
  const el = document.getElementById(scope + "Success");
  el.textContent = text;
  el.style.display = "block";
}
