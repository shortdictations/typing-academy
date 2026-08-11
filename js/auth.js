/* ============================================================
   auth.js
   ------------------------------------------------------------
   Shared login / registration / session helper functions.
   Used by login.html, dashboard.html, and typing.html.
   Requires supabase-config.js to be loaded first.
   ============================================================ */

// Register a brand-new student account
async function registerStudent(fullName, email, password) {
  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
    options: {
      data: { full_name: fullName } // stored on the auth user itself
    }
  });

  if (error) throw error;

  // Also create a row in our own "profiles" table so we can
  // easily show the student's name on the dashboard later.
  if (data.user) {
    await supabaseClient.from("profiles").insert({
      id: data.user.id,
      full_name: fullName
    });
  }

  return data;
}

// Log an existing student in
async function loginStudent(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password
  });
  if (error) throw error;
  return data;
}

// Log the current student out, then send them to the login page
async function logoutStudent() {
  await supabaseClient.auth.signOut();
  window.location.href = "index.html";
}

// Get the currently logged-in user (or null if nobody is logged in)
async function getCurrentUser() {
  const { data } = await supabaseClient.auth.getUser();
  return data.user || null;
}

// Call this at the top of any PROTECTED page (dashboard, mock-test, etc).
// If nobody is logged in, it redirects to login.html automatically.
// If somebody IS logged in, it wires up the shared authenticated
// header (user-name dropdown + Logout inside it, and — if this page
// has the credit badge markup — the live total credit balance), then
// returns the user object. One shared implementation, used by every
// protected page, so header behavior stays consistent everywhere
// from a single place.
async function requireLogin() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "login.html";
    return null;
  }

  await initAuthHeader(user);
  return user;
}

// Wires the user-name dropdown (opens on click, closes on outside
// click or after Logout) and, only if this page includes the
// #creditBadgeNum element, fetches and displays the live total
// credit balance. Pages without that element simply skip it — no
// per-page branching needed.
async function initAuthHeader(user) {
  const nameEl = document.getElementById("userChip");
  if (nameEl) {
    nameEl.textContent = (user.user_metadata && user.user_metadata.full_name)
      ? user.user_metadata.full_name
      : user.email;
  }

  const trigger = document.getElementById("userMenuTrigger");
  const dropdown = document.getElementById("userMenuDropdown");
  if (trigger && dropdown) {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("open");
    });
    document.addEventListener("click", (e) => {
      if (!dropdown.contains(e.target) && !trigger.contains(e.target)) {
        dropdown.classList.remove("open");
      }
    });
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logoutStudent);
  }

  if (document.getElementById("creditBadgeNum")) {
    await renderHeaderCreditBalance(user.id);
  }
}

// Total credits = free + purchased, read live from the existing
// wallet_credits table (same source subscriptions.html/mock-test.html
// already use) — no second credit balance is created here.
async function renderHeaderCreditBalance(userId) {
  const el = document.getElementById("creditBadgeNum");
  if (!el) return;

  const { data, error } = await supabaseClient
    .from("wallet_credits")
    .select("credits_remaining, expires_at")
    .eq("user_id", userId);

  if (error) {
    console.error("Could not load header credit balance:", error);
    el.textContent = "—";
    return;
  }

  const now = new Date();
  const total = (data || [])
    .filter(row => new Date(row.expires_at) > now)
    .reduce((sum, row) => sum + row.credits_remaining, 0);

  el.textContent = total;
}

// Check whether a given user id is in the "admins" table
async function isAdminUser(userId) {
  const { data, error } = await supabaseClient
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Admin check failed:", error);
    return false;
  }
  return !!data;
}

// Call this at the top of admin.html instead of requireLogin().
// It first makes sure someone is logged in, THEN makes sure they
// are an admin. Non-admins are redirected to dashboard.html.
async function requireAdmin() {
  const user = await requireLogin();
  if (!user) return null; // requireLogin already redirected to login.html

  const admin = await isAdminUser(user.id);
  if (!admin) {
    alert("You do not have access to this page.");
    window.location.href = "dashboard.html";
    return null;
  }
  return user;
}
