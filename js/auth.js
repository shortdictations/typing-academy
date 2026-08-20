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
  // Guarded: a network hiccup or Supabase error here used to throw
  // straight out of this function — which meant requireLogin()'s own
  // "if (!user) redirect to login" logic never even ran (the throw
  // skipped past it entirely), and the calling page's whole setup
  // script died with it. Now any failure here just resolves to "not
  // logged in", which requireLogin() already knows how to handle
  // correctly (redirect) — the intended behavior per "if the user is
  // not authenticated, follow the existing authentication flow."
  try {
    const { data, error } = await supabaseClient.auth.getUser();
    if (error) {
      console.error("getCurrentUser: Supabase returned an error:", error);
      return null;
    }
    return data.user || null;
  } catch (err) {
    console.error("getCurrentUser failed unexpectedly:", err);
    return null;
  }
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

  // Guarded: initAuthHeader() builds the header avatar/dropdown and
  // populates the credit badge — none of that should be able to
  // break the actual page. Previously, if initAuthHeader threw for
  // ANY reason (a malformed field, a Supabase query hiccup), that
  // exception propagated out of requireLogin() itself — so on every
  // page calling "const user = await requireLogin(); ..." at the top
  // of its own script, the WHOLE REST of that page's setup silently
  // never ran (search wiring, button handlers, form submission —
  // everything after that line). A failed avatar shouldn't be able
  // to take an entire page down with it.
  try {
    await initAuthHeader(user);
  } catch (err) {
    console.error("initAuthHeader failed — header/avatar may be incomplete, but the rest of the page will still work:", err);
  }
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
// Builds the account-dropdown content for the header avatar —
// name/email, then Profile / Settings / Logout. Kept intentionally
// minimal (no credits/plans here — those already have their own
// cards on the dashboard and their own page).
function accountDropdownHtml(displayName, email, logoutBtnId) {
  return `
    <div class="avatar-dropdown-header">
      <div class="avatar-dropdown-name">${escapeHtmlAuth(displayName)}</div>
      <div class="avatar-dropdown-email">${escapeHtmlAuth(email)}</div>
    </div>
    <div class="avatar-dropdown-divider"></div>
    <a class="avatar-menu-row" href="settings.html">
      <span class="avatar-menu-label">Profile</span>
    </a>
    <a class="avatar-menu-row" href="settings.html">
      <span class="avatar-menu-label">Settings</span>
    </a>
    <div class="avatar-dropdown-divider"></div>
    <button class="avatar-menu-row avatar-menu-logout" id="${logoutBtnId}" type="button">
      <span class="avatar-menu-label">Logout</span>
    </button>`;
}

// Below ~700px, this project's header wraps onto two lines (brand on
// top, nav icons below), so the avatar trigger often isn't flush
// against the right edge of the screen the way the dropdown's
// default CSS (position:absolute; right:0 relative to the trigger)
// assumes — which can push the dropdown left of the viewport entirely.
// This clamps it back on-screen with a fixed position, computed at
// open-time, only when that assumption might not hold. Desktop/tablet
// (where the header stays single-row and the trigger IS flush right)
// are untouched — the default CSS positioning already works there.
function repositionDropdownIfNarrow(trigger, dropdown) {
  if (window.innerWidth > 700) {
    dropdown.style.position = "";
    dropdown.style.left = "";
    dropdown.style.top = "";
    dropdown.style.right = "";
    return;
  }
  const triggerRect = trigger.getBoundingClientRect();
  const ddWidth = dropdown.offsetWidth || 210;
  const margin = 10;
  let left = triggerRect.right - ddWidth;
  left = Math.max(margin, Math.min(left, window.innerWidth - ddWidth - margin));
  dropdown.style.position = "fixed";
  dropdown.style.left = left + "px";
  dropdown.style.top = (triggerRect.bottom + 8) + "px";
  dropdown.style.right = "auto";
  dropdown.style.marginTop = "0";
}

async function initAuthHeader(user) {
  // Independent of the avatar/dropdown below — runs even if this
  // page somehow has no header user-menu, since the bottom nav is a
  // separate element.
  wireBottomNavActiveState();

  const trigger = document.getElementById("userMenuTrigger");
  const dropdown = document.getElementById("userMenuDropdown");
  if (!trigger || !dropdown) return; // page has no header user-menu at all

  const displayName = (user.user_metadata && user.user_metadata.full_name)
    ? user.user_metadata.full_name
    : user.email;
  const avatarUrl = user.user_metadata && (user.user_metadata.avatar_url || user.user_metadata.picture);

  // ---- Trigger content: avatar + name + chevron, replacing the
  // skeleton placeholder that was there while this was loading.
  // Name is hidden on narrow viewports via CSS (see .user-menu-name),
  // leaving just the compact avatar + chevron there. ----
  trigger.innerHTML = "";
  trigger.appendChild(buildAvatarEl(displayName, avatarUrl));

  const nameEl = document.createElement("span");
  nameEl.className = "user-menu-name";
  nameEl.textContent = displayName;
  trigger.appendChild(nameEl);

  trigger.insertAdjacentHTML("beforeend",
    '<svg class="user-menu-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
  );
  trigger.setAttribute("aria-expanded", "false");

  // ---- Dropdown content: name/email, Profile, Settings, Logout.
  // existing #logoutBtn preserved so logoutStudent() wiring below
  // still finds and works with the same element. ----
  dropdown.classList.add("avatar-dropdown");
  dropdown.innerHTML = accountDropdownHtml(displayName, user.email, "logoutBtn");

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !dropdown.classList.contains("open");
    dropdown.classList.toggle("open");
    trigger.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) repositionDropdownIfNarrow(trigger, dropdown);
  });
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && !trigger.contains(e.target)) {
      dropdown.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    }
  });
  // Close immediately after selecting any option — Profile/Settings
  // navigate away and Logout signs out, but closing here too avoids
  // the dropdown staying visibly open mid-navigation.
  dropdown.addEventListener("click", (e) => {
    if (e.target.closest("a, button")) {
      dropdown.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    }
  });
  document.getElementById("logoutBtn").addEventListener("click", logoutStudent);

  // ---- Credits/active-passes are still fetched here (not shown in
  // the dropdown anymore) because the top-bar credit badge and the
  // legacy mobile hamburger sidebar (buildMobileSidebar, used on
  // pages not yet migrated to the app-shell layout) both still need
  // them. ----
  const [activePasses, creditsTotal] = await Promise.all([
    fetchActivePasses(user.id),
    fetchTotalCredits(user.id)
  ]);

  // Existing top-bar credit badge (🪙 N), if this page has one —
  // unchanged from before, just reuses the total already fetched.
  const badgeEl = document.getElementById("creditBadgeNum");
  if (badgeEl) badgeEl.textContent = creditsTotal;

  buildMobileSidebar(user, displayName, avatarUrl, activePasses, creditsTotal);
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
  // Guarded: name is normally always a string (full_name or email),
  // but if it's ever missing/null this used to throw on .trim() —
  // which, before the requireLogin() fix above, could silently take
  // down the rest of the page with it. Now it just falls back to a
  // generic placeholder instead.
  if (!name || typeof name !== "string") return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
}

function colorForName(name) {
  const safeName = (name && typeof name === "string") ? name : "?";
  const palette = ["#A9803F", "#B23A2E", "#3E6B4F", "#1B2A3D", "#8F2D23"];
  let hash = 0;
  for (let i = 0; i < safeName.length; i++) hash = safeName.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

// "Current Plan" reads the same user_passes table the access-
// control system itself uses — a pass counts only while it's
// actually valid (status/expiry checked), same rule as everywhere
// else in the app. Returns EVERY currently active pass (not just
// the first) — the caller decides how to render them.
async function fetchActivePasses(userId) {
  const { data, error } = await supabaseClient
    .from("user_passes")
    .select("pass_type, status, starts_at, expires_at")
    .eq("user_id", userId);

  if (error || !data) return [];

  const now = new Date();
  return data
    .filter(p =>
      p.status !== "cancelled" &&
      new Date(p.starts_at) <= now &&
      new Date(p.expires_at) > now
    )
    .map(p => ({
      label: passTypeLabel(p.pass_type),
      expiresAt: p.expires_at
    }))
    .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
}

function passTypeLabel(passType) {
  if (passType === "COMBO") return "Combo Pass";
  if (passType === "SSC") return "SSC Pass";
  if (passType === "LEGAL") return "Legal Pass";
  return passType;
}

function renderDropdownPlans(activePasses, targetId) {
  const list = document.getElementById(targetId || "ddPlansList");
  if (!list) return;

  if (activePasses.length === 0) {
    list.innerHTML = '<div class="avatar-dropdown-plan-empty">No active pass</div>';
    return;
  }

  list.innerHTML = activePasses.map(p => {
    const expiresText = new Date(p.expiresAt).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric"
    });
    return '<div class="avatar-dropdown-plan-row">' +
      '<span class="avatar-dropdown-plan-check">&#10003;</span>' +
      '<span class="avatar-dropdown-plan-text">' +
        '<span class="avatar-dropdown-plan-name">' + escapeHtmlAuth(p.label) + '</span>' +
        '<span class="avatar-dropdown-plan-expiry">Active until ' + expiresText + '</span>' +
      '</span>' +
    '</div>';
  }).join("");
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
function buildMobileSidebar(user, displayName, avatarUrl, activePasses, creditsTotal) {
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

  // ---- Dark header: avatar, name, email, close ----
  const header = document.createElement("div");
  header.className = "mobile-sidebar-header";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "mobile-sidebar-close";
  closeBtn.innerHTML = "&times;";
  header.appendChild(closeBtn);

  const userRow = document.createElement("div");
  userRow.className = "mobile-sidebar-user";
  userRow.appendChild(buildAvatarEl(displayName, avatarUrl));
  const userText = document.createElement("div");
  userText.innerHTML =
    '<div class="mobile-sidebar-name">' + escapeHtmlAuth(displayName) + '</div>' +
    '<div class="mobile-sidebar-email">' + escapeHtmlAuth(user.email) + '</div>';
  userRow.appendChild(userText);
  header.appendChild(userRow);

  const creditsCard = document.createElement("div");
  creditsCard.className = "mobile-sidebar-credits-card";
  creditsCard.innerHTML =
    '<span class="mobile-sidebar-credits-icon">&#129689;</span>' +
    '<span class="mobile-sidebar-credits-text">' +
      '<span class="mobile-sidebar-credits-label">Credits Available</span>' +
      '<span class="mobile-sidebar-credits-num">' + escapeHtmlAuth(String(creditsTotal)) + '</span>' +
    '</span>' +
    '<a class="mobile-sidebar-credits-btn" href="subscriptions.html">Buy Credits &#10024;</a>';
  header.appendChild(creditsCard);
  sidebar.appendChild(header);

  // ---- Light body: Active Plans, then Menu ----
  const body = document.createElement("div");
  body.className = "mobile-sidebar-body";

  const plansSection = document.createElement("div");
  plansSection.className = "mobile-sidebar-section";
  const plansRowsHtml = activePasses.length === 0
    ? '<div class="avatar-dropdown-plan-empty">No active pass</div>'
    : activePasses.map(p => {
        const expiresText = new Date(p.expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        return '<a class="mobile-sidebar-plan-row" href="subscriptions.html">' +
          '<span class="mobile-sidebar-plan-check">&#10003;</span>' +
          '<span class="mobile-sidebar-plan-text">' +
            '<span class="mobile-sidebar-plan-name">' + escapeHtmlAuth(p.label) + '</span>' +
            '<span class="mobile-sidebar-plan-expiry">Active until ' + expiresText + '</span>' +
          '</span>' +
          '<span class="mobile-sidebar-chevron">&#8250;</span>' +
        '</a>';
      }).join("");
  plansSection.innerHTML =
    '<div class="mobile-sidebar-section-heading"><span>Active Plans</span><span>&#127891;</span></div>' +
    plansRowsHtml;
  body.appendChild(plansSection);

  // Menu — Dashboard is always included (real page, always valid to
  // link to); the rest are this page's own real nav links, cloned
  // exactly as before, just restyled as icon-tile rows. Nothing
  // fictional like "My Wallet" or "Question Bank" is added — those
  // aren't real TypeShala pages.
  const menuSection = document.createElement("div");
  menuSection.className = "mobile-sidebar-section";
  // These three are always present, on every page, regardless of
  // whether the current page's own header nav happens to link to
  // them (e.g. dashboard.html has no Mock History link at all, and
  // mock-test.html has no self-link to itself).
  const menuEntries = [
    { href: "dashboard.html", icon: "&#128202;", tint: "tile-purple", title: "Dashboard", sub: "Overview & stats" },
    { href: "mock-test.html", icon: "&#128203;", tint: "tile-orange", title: "Mock Test", sub: "Take a new mock test" },
    { href: "mock-history.html", icon: "&#128200;", tint: "tile-purple", title: "Mock History", sub: "View your mock test history" },
    { href: "subscriptions.html", icon: "&#128081;", tint: "tile-blue", title: "Subscribe", sub: "View plans & credits" }
  ];
  const ALWAYS_PRESENT_HREFS = menuEntries.map(e => e.href);

  const existingLinks = navLinks.querySelectorAll(":scope > a:not(.credit-badge)");
  existingLinks.forEach(a => {
    const label = a.textContent.trim();
    const href = a.getAttribute("href");
    if (ALWAYS_PRESENT_HREFS.includes(href)) return; // already covered above, don't duplicate
    const meta = mobileMenuIconFor(label);
    menuEntries.push({ href, icon: meta.icon, tint: meta.tint, title: label, sub: meta.sub });
  });

  // Fixed priority order for the always-present three; any other
  // real page-specific link (Credits, admin pages, etc.) keeps its
  // natural position after them.
  const MENU_PRIORITY = ["dashboard.html", "mock-test.html", "mock-history.html"];
  menuEntries.sort((a, b) => {
    const ai = MENU_PRIORITY.indexOf(a.href);
    const bi = MENU_PRIORITY.indexOf(b.href);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  let menuRowsHtml = '<div class="mobile-sidebar-section-heading"><span>Menu</span></div>';
  menuEntries.forEach(e => {
    menuRowsHtml += mobileMenuRowHtml(e.href, e.icon, e.tint, e.title, e.sub);
  });
  menuSection.innerHTML = menuRowsHtml;
  body.appendChild(menuSection);

  const logoutBtn = document.createElement("button");
  logoutBtn.type = "button";
  logoutBtn.className = "mobile-sidebar-logout-row";
  logoutBtn.innerHTML =
    '<span class="mobile-sidebar-tile tile-danger">&#8674;</span>' +
    '<span class="mobile-sidebar-menu-text">' +
      '<span class="mobile-sidebar-menu-title">Logout</span>' +
      '<span class="mobile-sidebar-menu-sub">Sign out from your account</span>' +
    '</span>' +
    '<span class="mobile-sidebar-chevron">&#8250;</span>';
  logoutBtn.addEventListener("click", logoutStudent);
  body.appendChild(logoutBtn);

  sidebar.appendChild(body);

  // ---- Dark footer ----
  const footer = document.createElement("div");
  footer.className = "mobile-sidebar-footer";
  footer.innerHTML =
    '<span class="mobile-sidebar-footer-seal">TS</span>' +
    '<span class="mobile-sidebar-footer-text">' +
      '<span class="mobile-sidebar-footer-name">TypeShala</span>' +
      '<span class="mobile-sidebar-footer-tagline">Typing Practice Centre</span>' +
    '</span>';
  sidebar.appendChild(footer);

  document.body.appendChild(overlay);
  document.body.appendChild(sidebar);

  const openSidebar = () => {
    sidebar.classList.add("open");
    overlay.classList.add("open");
    document.documentElement.classList.add("sidebar-scroll-lock"); // prevents the page behind from scrolling while the sidebar is open
    document.body.classList.add("sidebar-scroll-lock");
  };
  const closeSidebar = () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
    document.documentElement.classList.remove("sidebar-scroll-lock");
    document.body.classList.remove("sidebar-scroll-lock");
  };

  hamburger.addEventListener("click", openSidebar);
  closeBtn.addEventListener("click", closeSidebar);
  overlay.addEventListener("click", closeSidebar);
}

function mobileMenuRowHtml(href, icon, tint, title, sub) {
  return '<a class="mobile-sidebar-menu-row" href="' + href + '">' +
    '<span class="mobile-sidebar-tile ' + tint + '">' + icon + '</span>' +
    '<span class="mobile-sidebar-menu-text">' +
      '<span class="mobile-sidebar-menu-title">' + escapeHtmlAuth(title) + '</span>' +
      '<span class="mobile-sidebar-menu-sub">' + escapeHtmlAuth(sub) + '</span>' +
    '</span>' +
    '<span class="mobile-sidebar-chevron">&#8250;</span>' +
  '</a>';
}

// Best-effort icon/subtitle for whichever real nav links this page
// happens to have — since different pages show different links
// (Mock Tests, Mock History, Credits, admin links, etc.), this
// pattern-matches on the label rather than hardcoding a fixed list.
function mobileMenuIconFor(label) {
  const l = label.toLowerCase();
  if (l.includes("history")) return { icon: "&#128200;", tint: "tile-purple", sub: "View your mock test history" };
  if (l.includes("mock")) return { icon: "&#128203;", tint: "tile-orange", sub: "Take a new mock test" };
  if (l.includes("credit")) return { icon: "&#129689;", tint: "tile-purple", sub: "View or buy credits" };
  if (l.includes("subscription")) return { icon: "&#128179;", tint: "tile-purple", sub: "Manage your plan" };
  if (l.includes("passage")) return { icon: "&#128220;", tint: "tile-purple", sub: "Manage passages" };
  if (l.includes("admin")) return { icon: "&#128736;", tint: "tile-purple", sub: "Admin tools" };
  return { icon: "&#8226;", tint: "tile-purple", sub: "" };
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

/* ============================================================
   Mobile bottom nav — active-state detection
   ------------------------------------------------------------
   Previously "active" was a static class hand-written into each
   page's own copy of the bottom-nav markup — but it was only ever
   actually set on dashboard.html's own Dashboard link; every other
   page's bottom nav showed nothing as active (checked directly:
   subscriptions.html, settings.html, help-support.html all had zero
   "active" occurrences). This replaces that with real route
   detection — every page gets this call via initAuthHeader() above,
   so there's one implementation, not eight hand-maintained copies
   that can drift out of sync with each other or with which items
   exist (this is also how Settings, newly added as a 5th item,
   correctly becomes active on settings.html without any per-page
   HTML edit).
   ============================================================ */
function wireBottomNavActiveState() {
  const links = document.querySelectorAll(".app-bottom-nav-link");
  if (links.length === 0) return;

  let currentPage = window.location.pathname.split("/").pop() || "dashboard.html";
  // mock-test-list.html (choosing a category/specific mock) is part
  // of the same "Start Test" flow as mock-test.html, not its own
  // bottom-nav destination.
  if (currentPage === "mock-test-list.html") currentPage = "mock-test.html";

  links.forEach(link => {
    const linkPage = (link.getAttribute("href") || "").split("?")[0];
    link.classList.toggle("active", linkPage === currentPage);
  });
}
