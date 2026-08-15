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

  // Supabase deliberately does NOT throw an error for an email that's
  // already registered (confirmed or not) — that would let an
  // attacker enumerate which emails have accounts. Instead it returns
  // a user object with an EMPTY identities array. This is the
  // documented, actual signal to check — not a guess.
  const alreadyExists = !!(data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0);

  if (alreadyExists) {
    // Do NOT create a profiles row for an account that already has
    // one — the old code tried this unconditionally and the insert
    // silently failed (no error check), which is what let this whole
    // bug through undetected.
    return { user: data.user, alreadyExists: true };
  }

  // Genuinely new account — safe to create the profile row now.
  if (data.user) {
    await supabaseClient.from("profiles").insert({
      id: data.user.id,
      full_name: fullName
    });
  }

  return { user: data.user, alreadyExists: false };
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
  // Clears the per-session "welcome back" flag so a fresh login
  // always shows it again — this is intentionally NOT a database
  // field (see dashboard.js), so it must be cleared here explicitly.
  sessionStorage.removeItem("ts_welcome_back_shown");
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
    <div class="avatar-dropdown-credits">
      <div class="credits-card-top">
        <span class="credits-card-label">Credits <span class="info-dot" title="Free + purchased credits available for Credit-Based Tests">&#9432;</span></span>
        <span class="credits-card-value">&#129689; <span id="ddCredits">—</span></span>
      </div>
      <a class="credits-buy-btn" href="subscriptions.html">Buy Credits &#10024;</a>
    </div>
    <div class="avatar-dropdown-menu">
      <a class="avatar-menu-row" href="subscriptions.html">
        <span class="avatar-menu-icon">&#127891;</span>
        <span class="avatar-menu-text">
          <span class="avatar-menu-label">Manage Plan</span>
          <span class="avatar-menu-sub" id="ddPlan">—</span>
        </span>
      </a>
    </div>
    <div class="avatar-dropdown-divider"></div>
    <button class="avatar-menu-row avatar-menu-logout" id="logoutBtn" type="button">
      <span class="avatar-menu-icon">&#8674;</span>
      <span class="avatar-menu-label">Logout</span>
    </button>`;

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

  // Credits are now shown inside the dropdown (the Credits card +
  // Buy Credits button below) and, on mobile, inside the sidebar —
  // so the standalone "Credits" text link and the 🪙-count badge no
  // longer need their own separate spot in the top header bar.
  // Removed here (before the sidebar clones nav-links) so neither
  // shows up duplicated in the mobile sidebar either.
  const navLinksEl = document.querySelector(".nav-links");
  if (navLinksEl) {
    navLinksEl.querySelectorAll(".credit-badge").forEach(el => el.remove());
    navLinksEl.querySelectorAll(":scope > a").forEach(a => {
      if (a.textContent.trim() === "Credits" && a.getAttribute("href") === "subscriptions.html") {
        a.remove();
      }
    });
  }

  // ---- Populate plan + credits (used by both the dropdown and,
  // if built, the mobile sidebar) ----
  const [planText, creditsTotal] = await Promise.all([
    fetchCurrentPlanLabel(user.id),
    fetchTotalCredits(user.id)
  ]);
  const ddPlan = document.getElementById("ddPlan");
  const ddCredits = document.getElementById("ddCredits");
  if (ddPlan) { ddPlan.textContent = planText; ddPlan.title = planText; }
  if (ddCredits) { ddCredits.textContent = creditsTotal; ddCredits.title = String(creditsTotal); }

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
  stats.className = "avatar-dropdown-credits mobile-sidebar-credits";
  stats.innerHTML = `
    <div class="credits-card-top">
      <span class="credits-card-label">Credits <span class="info-dot" title="Free + purchased credits available for Credit-Based Tests">&#9432;</span></span>
      <span class="credits-card-value">&#129689; ${escapeHtmlAuth(String(creditsTotal))}</span>
    </div>
    <a class="credits-buy-btn" href="subscriptions.html">Buy Credits &#10024;</a>`;
  sidebar.appendChild(stats);

  const planRow = document.createElement("a");
  planRow.className = "avatar-menu-row mobile-sidebar-menu-row";
  planRow.href = "subscriptions.html";
  planRow.innerHTML = `
    <span class="avatar-menu-icon">&#127891;</span>
    <span class="avatar-menu-text">
      <span class="avatar-menu-label">Manage Plan</span>
      <span class="avatar-menu-sub">${escapeHtmlAuth(planText)}</span>
    </span>`;
  sidebar.appendChild(planRow);

  const sidebarDivider = document.createElement("div");
  sidebarDivider.className = "avatar-dropdown-divider mobile-sidebar-divider";
  sidebar.appendChild(sidebarDivider);

  const linksWrap = document.createElement("nav");
  linksWrap.className = "mobile-sidebar-links";
  const existingLinks = navLinks.querySelectorAll(":scope > a:not(.credit-badge)");
  existingLinks.forEach(a => {
    const clone = document.createElement("a");
    clone.className = "avatar-menu-row mobile-sidebar-menu-row";
    clone.href = a.getAttribute("href");
    clone.innerHTML = '<span class="avatar-menu-icon">&#8226;</span><span class="avatar-menu-label">' + escapeHtmlAuth(a.textContent) + '</span>';
    linksWrap.appendChild(clone);
  });
  sidebar.appendChild(linksWrap);

  const linksDivider = document.createElement("div");
  linksDivider.className = "avatar-dropdown-divider mobile-sidebar-divider";
  sidebar.appendChild(linksDivider);

  const logoutBtn = document.createElement("button");
  logoutBtn.type = "button";
  logoutBtn.className = "avatar-menu-row avatar-menu-logout mobile-sidebar-menu-row";
  logoutBtn.innerHTML = '<span class="avatar-menu-icon">&#8674;</span><span class="avatar-menu-label">Logout</span>';
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
