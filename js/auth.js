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

// Builds the entire authenticated header UI — circular avatar
// (Google profile picture if available, otherwise generated
// initials), an enriched dropdown (name, email, current plan,
// total credits, Logout), and — for mobile — a hamburger button
// that opens a slide-in sidebar with the same info plus this
// page's own nav links. Everything here is created in JavaScript
// and attached to the existing #userMenuTrigger/#userMenuDropdown
// elements (or, for the sidebar, appended to <body>) — no HTML
// file needed any markup changes for this.
async function initAuthHeader(user) {
  const trigger = document.getElementById("userMenuTrigger");
  const dropdown = document.getElementById("userMenuDropdown");
  if (!trigger || !dropdown) return; // page has no header user-menu at all

  const displayName = (user.user_metadata && user.user_metadata.full_name)
    ? user.user_metadata.full_name
    : user.email;
  const avatarUrl = user.user_metadata && (user.user_metadata.avatar_url || user.user_metadata.picture);

  // ---- Avatar button (replaces the old name+chevron text) ----
  trigger.innerHTML = "";
  trigger.appendChild(buildAvatarEl(displayName, avatarUrl));

  // ---- Enriched dropdown content (name/email/plan/credits header,
  // existing #logoutBtn preserved so logoutStudent() wiring below
  // still finds and works with the same element) ----
  dropdown.classList.add("avatar-dropdown");
  dropdown.innerHTML = `
    <div class="avatar-dropdown-header">
      <div class="avatar-dropdown-name">${escapeHtmlAuth(displayName)}</div>
      <div class="avatar-dropdown-email">${escapeHtmlAuth(user.email)}</div>
    </div>
    <div class="avatar-dropdown-row"><span>Current Plan</span><strong id="ddPlan">—</strong></div>
    <div class="avatar-dropdown-row"><span>Total Credits</span><strong id="ddCredits">—</strong></div>
    <button class="avatar-dropdown-logout" id="logoutBtn" type="button">Logout</button>`;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && !trigger.contains(e.target)) {
      dropdown.classList.remove("open");
    }
  });
  document.getElementById("logoutBtn").addEventListener("click", logoutStudent);

  // ---- Populate plan + credits (used by both the dropdown and,
  // if built, the mobile sidebar) ----
  const [planText, creditsTotal] = await Promise.all([
    fetchCurrentPlanLabel(user.id),
    fetchTotalCredits(user.id)
  ]);
  const ddPlan = document.getElementById("ddPlan");
  const ddCredits = document.getElementById("ddCredits");
  if (ddPlan) ddPlan.textContent = planText;
  if (ddCredits) ddCredits.textContent = creditsTotal;

  // Existing top-bar credit badge (🪙 N), if this page has one —
  // unchanged from before, just reuses the total already fetched.
  const badgeEl = document.getElementById("creditBadgeNum");
  if (badgeEl) badgeEl.textContent = creditsTotal;

  buildMobileSidebar(user, displayName, avatarUrl, planText, creditsTotal);
}

// Google OAuth users get their real profile photo; everyone else
// gets a generated circle with their initials (first letters of
// up to two words in their name, or the first letter of their
// email if no name is set). Background color is picked
// deterministically from the name/email so the same user always
// gets the same color.
function buildAvatarEl(displayName, avatarUrl, sizeClass) {
  const el = document.createElement("span");
  el.className = "avatar-btn" + (sizeClass ? " " + sizeClass : "");

  if (avatarUrl) {
    const img = document.createElement("img");
    img.src = avatarUrl;
    img.alt = displayName;
    img.referrerPolicy = "no-referrer";
    img.onerror = () => { img.remove(); el.textContent = initialsFor(displayName); };
    el.appendChild(img);
  } else {
    el.textContent = initialsFor(displayName);
    el.style.background = colorForName(displayName);
  }
  return el;
}

function initialsFor(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

function colorForName(name) {
  const palette = ["#A9803F", "#B23A2E", "#3E6B4F", "#1B2A3D", "#8F2D23"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

// "Current Plan" reads the same user_passes table the access-
// control system itself uses — a pass counts only while it's
// actually valid (status/expiry checked), same rule as everywhere
// else in the app.
async function fetchCurrentPlanLabel(userId) {
  const { data, error } = await supabaseClient
    .from("user_passes")
    .select("pass_type, status, starts_at, expires_at")
    .eq("user_id", userId);

  if (error || !data) return "No active plan";

  const now = new Date();
  const active = data.find(p =>
    p.status !== "cancelled" &&
    new Date(p.starts_at) <= now &&
    new Date(p.expires_at) > now
  );

  if (!active) return "No active plan";
  if (active.pass_type === "COMBO") return "Combo Pass";
  if (active.pass_type === "SSC") return "SSC Pass";
  if (active.pass_type === "LEGAL") return "Legal Pass";
  return active.pass_type;
}

async function fetchTotalCredits(userId) {
  const { data, error } = await supabaseClient
    .from("wallet_credits")
    .select("credits_remaining, expires_at")
    .eq("user_id", userId);

  if (error || !data) return "—";

  const now = new Date();
  return data
    .filter(row => new Date(row.expires_at) > now)
    .reduce((sum, row) => sum + row.credits_remaining, 0);
}

// Hamburger + slide-in sidebar for mobile. Built once per page
// load: the hamburger is appended into this page's own .nav-links
// (so CSS can hide everything else there under 700px and show
// only the hamburger), and the sidebar/overlay are appended to
// <body>. Sidebar nav links are cloned from whatever links this
// page's .nav-links already had — no per-page link list needed.
function buildMobileSidebar(user, displayName, avatarUrl, planText, creditsTotal) {
  const navLinks = document.querySelector(".nav-links");
  if (!navLinks || document.getElementById("hamburgerBtn")) return; // already built, or no header here

  const hamburger = document.createElement("button");
  hamburger.type = "button";
  hamburger.id = "hamburgerBtn";
  hamburger.className = "hamburger-btn";
  hamburger.innerHTML = "&#9776;";
  navLinks.appendChild(hamburger);

  const overlay = document.createElement("div");
  overlay.className = "mobile-sidebar-overlay";
  overlay.id = "mobileSidebarOverlay";

  const sidebar = document.createElement("div");
  sidebar.className = "mobile-sidebar";
  sidebar.id = "mobileSidebar";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "mobile-sidebar-close";
  closeBtn.innerHTML = "&times;";
  sidebar.appendChild(closeBtn);

  const userRow = document.createElement("div");
  userRow.className = "mobile-sidebar-user";
  userRow.appendChild(buildAvatarEl(displayName, avatarUrl));
  const userText = document.createElement("div");
  userText.innerHTML =
    '<div class="mobile-sidebar-name">' + escapeHtmlAuth(displayName) + '</div>' +
    '<div class="mobile-sidebar-email">' + escapeHtmlAuth(user.email) + '</div>';
  userRow.appendChild(userText);
  sidebar.appendChild(userRow);

  const stats = document.createElement("div");
  stats.className = "mobile-sidebar-stats";
  stats.innerHTML =
    '<div><span>Current Plan</span><strong>' + escapeHtmlAuth(planText) + '</strong></div>' +
    '<div><span>Total Credits</span><strong>' + escapeHtmlAuth(String(creditsTotal)) + '</strong></div>';
  sidebar.appendChild(stats);

  const linksWrap = document.createElement("nav");
  linksWrap.className = "mobile-sidebar-links";
  const existingLinks = navLinks.querySelectorAll("a:not(.credit-badge)");
  existingLinks.forEach(a => {
    const clone = document.createElement("a");
    clone.href = a.getAttribute("href");
    clone.textContent = a.textContent;
    linksWrap.appendChild(clone);
  });
  sidebar.appendChild(linksWrap);

  const logoutBtn = document.createElement("button");
  logoutBtn.type = "button";
  logoutBtn.className = "mobile-sidebar-logout";
  logoutBtn.textContent = "Logout";
  logoutBtn.addEventListener("click", logoutStudent);
  sidebar.appendChild(logoutBtn);

  document.body.appendChild(overlay);
  document.body.appendChild(sidebar);

  const openSidebar = () => { sidebar.classList.add("open"); overlay.classList.add("open"); };
  const closeSidebar = () => { sidebar.classList.remove("open"); overlay.classList.remove("open"); };

  hamburger.addEventListener("click", openSidebar);
  closeBtn.addEventListener("click", closeSidebar);
  overlay.addEventListener("click", closeSidebar);
}

function escapeHtmlAuth(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
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
