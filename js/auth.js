/* ============================================================
   auth.js
   ------------------------------------------------------------
   Shared login / registration / session helper functions.
   Used by login.html, dashboard.html, and typing.html.
   Requires supabase-config.js to be loaded first.
   ============================================================ */

/* ---------- Single active session (one device at a time) ----------
   localStorage (NOT sessionStorage) is deliberate: it's shared
   across every tab of the same browser/device, which is exactly
   what "multiple tabs on the same device should keep working" needs
   — sessionStorage is per-tab and would wrongly invalidate a second
   tab on the SAME device. The server (public.user_sessions, via the
   register/validate/clear RPCs applied in this project's Supabase
   instance) is the only authoritative source; the localStorage value
   is just this browser's claim, always checked against the server
   before being trusted for anything that matters. */
const TS_SESSION_STORAGE_KEY = "ts_session_id";
const TS_SESSION_MESSAGE_KEY = "ts_session_invalidated_message";
const TS_SESSION_CHECK_INTERVAL_MS = 45000; // 45s — within the requested 30-60s range

let tsSessionPeriodicCheckStarted = false;
let tsSessionRealtimeChannel = null;

// Called once right after a successful login (email/password AND,
// via requireLogin()'s own first-run registration below, the Google
// OAuth path too, since OAuth never calls loginStudent() directly).
// Always generates and stores a FRESH session — this is the "newest
// login replaces the previous one" step.
async function registerActiveSession() {
  const { data, error } = await supabaseClient.rpc("register_active_session");
  if (error || !data) {
    console.error("registerActiveSession failed:", error);
    return null;
  }
  localStorage.setItem(TS_SESSION_STORAGE_KEY, data);
  return data;
}

// The central single-session check. Called from requireLogin() (so
// every protected page gets it automatically, per "do not duplicate
// this logic independently on every page") and re-run periodically/
// on a Realtime event while the page stays open.
//
// If this browser has no local session id yet, it registers one
// rather than "failing" a validation that was never set up — this
// is what makes the Google OAuth landing page (which never calls
// loginStudent()) register correctly too, using the exact same code
// path as everything else instead of a separate OAuth-specific hook.
async function checkSingleActiveSession() {
  const localSessionId = localStorage.getItem(TS_SESSION_STORAGE_KEY);

  if (!localSessionId) {
    await registerActiveSession();
    return true;
  }

  try {
    const { data: isValid, error } = await supabaseClient.rpc("validate_active_session", { p_session_id: localSessionId });
    if (error) {
      // Fail OPEN on a transient network/RPC error — a connectivity
      // hiccup should not lock a legitimate single-device user out.
      console.error("checkSingleActiveSession: validation RPC failed:", error);
      return true;
    }
    if (!isValid) {
      await forceSessionLogout("Your session has expired because this account was logged in from another device.");
      return false;
    }
    return true;
  } catch (err) {
    console.error("checkSingleActiveSession threw:", err);
    return true;
  }
}

// Signs the user out because THIS browser's session was replaced —
// distinct from a normal, intentional logoutStudent() call: this one
// does not try to clear the server-side session record (it's not
// "current" anymore by definition — clearing it here could even
// delete whatever device DID just take over), it just gets this
// browser out and shows why.
async function forceSessionLogout(message) {
  localStorage.removeItem(TS_SESSION_STORAGE_KEY);
  stopSingleSessionMonitoring();
  try {
    await supabaseClient.auth.signOut();
  } catch (err) {
    console.error("forceSessionLogout: signOut failed:", err);
  }
  sessionStorage.setItem(TS_SESSION_MESSAGE_KEY, message);
  window.location.href = "login.html";
}

function stopSingleSessionMonitoring() {
  if (tsSessionRealtimeChannel) {
    supabaseClient.removeChannel(tsSessionRealtimeChannel);
    tsSessionRealtimeChannel = null;
  }
}

// Starts the two "don't rely on Realtime alone" backstops: a periodic
// poll (30-60s range) and a Realtime subscription for immediate
// detection when available. Guarded to only ever run once per page
// load even if requireLogin() is somehow called more than once.
function startSingleSessionMonitoring(userId) {
  if (tsSessionPeriodicCheckStarted) return;
  tsSessionPeriodicCheckStarted = true;

  setInterval(() => {
    checkSingleActiveSession();
  }, TS_SESSION_CHECK_INTERVAL_MS);

  // Realtime is a nice-to-have fast path, not the authoritative
  // check — if the subscription itself fails for any reason, the
  // periodic poll above still catches a replaced session within
  // TS_SESSION_CHECK_INTERVAL_MS regardless.
  try {
    tsSessionRealtimeChannel = supabaseClient
      .channel("user_sessions_" + userId)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "user_sessions", filter: "user_id=eq." + userId },
        (payload) => {
          const localSessionId = localStorage.getItem(TS_SESSION_STORAGE_KEY);
          const serverSessionId = payload.new && payload.new.session_id;
          if (serverSessionId && localSessionId && serverSessionId !== localSessionId) {
            forceSessionLogout("Your session has expired because this account was logged in from another device.");
          }
        }
      )
      .subscribe();
  } catch (err) {
    console.error("startSingleSessionMonitoring: Realtime subscription failed (periodic check still active):", err);
  }
}

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

  // Registers this device as the new active session immediately on
  // login — the "newest login replaces the previous one" step. Await
  // this before returning so login.html's redirect to dashboard.html
  // never races ahead of the session actually being registered
  // (which would make the very first requireLogin() check on the
  // dashboard see no local session id — harmless, since
  // checkSingleActiveSession() would just register one then, but
  // there's no reason to leave that gap open).
  await registerActiveSession();

  return data;
}

// Log the current student out, then send them to the login page
async function logoutStudent() {
  // Clears the per-session "welcome back" flag so a fresh login
  // always shows it again — this is intentionally NOT a database
  // field (see dashboard.js), so it must be cleared here explicitly.
  sessionStorage.removeItem("ts_welcome_back_shown");

  // Only clears the server-side session record if it STILL matches
  // this browser's own session id — this is what stops an old,
  // already-replaced device's logout from deleting a NEWER device's
  // active session (Device A logs out after Device B already
  // replaced it -> A's logout must not touch B's session).
  const localSessionId = localStorage.getItem(TS_SESSION_STORAGE_KEY);
  if (localSessionId) {
    try {
      await supabaseClient.rpc("clear_active_session_if_current", { p_session_id: localSessionId });
    } catch (err) {
      console.error("logoutStudent: clear_active_session_if_current failed:", err);
    }
  }
  localStorage.removeItem(TS_SESSION_STORAGE_KEY);
  stopSingleSessionMonitoring();

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

  // Single-active-session check — the central choke-point every
  // protected page already passes through via requireLogin(), so
  // this covers all of them (dashboard, mock test, typing test,
  // result page, profile, pass/subscription, credits, etc.) without
  // needing to be duplicated on each page individually. If this
  // browser's session was replaced by a newer login elsewhere,
  // checkSingleActiveSession() itself performs the sign-out/redirect
  // and returns false — nothing below this point should run.
  const sessionOk = await checkSingleActiveSession();
  if (!sessionOk) {
    return null;
  }
  startSingleSessionMonitoring(user.id);

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
// Builds the profile dropdown content for the header avatar — large
// avatar (with its own pencil to change it), name, email, then just
// Logout. Deliberately no Profile/Settings/Purchase History/etc
// rows here — the desktop sidebar already handles all navigation;
// this dropdown is account identity + logout only, per spec.
function accountDropdownHtml(displayName, email, logoutBtnId) {
  return `
    <div class="avatar-dropdown-avatar-wrap">
      <div class="avatar-dropdown-avatar ts-avatar-render" aria-hidden="true"></div>
      <button type="button" class="avatar-dropdown-avatar-edit ts-avatar-edit-trigger" aria-label="Change avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      </button>
    </div>
    <div class="avatar-dropdown-header">
      <div class="avatar-dropdown-name">${escapeHtmlAuth(displayName)}</div>
      <div class="avatar-dropdown-email">${escapeHtmlAuth(email)}</div>
    </div>
    <div class="avatar-dropdown-divider"></div>
    <button class="avatar-menu-row avatar-menu-logout" id="${logoutBtnId}" type="button">
      <span class="avatar-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg></span>
      <span class="avatar-menu-label">Log out</span>
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
  wireMobileProfileDrawer(user);
  wireSidebarCollapse();

  const trigger = document.getElementById("userMenuTrigger");
  const dropdown = document.getElementById("userMenuDropdown");
  if (!trigger || !dropdown) return; // page has no header user-menu at all

  const displayName = (user.user_metadata && user.user_metadata.full_name)
    ? user.user_metadata.full_name
    : user.email;
  const avatarUrl = user.user_metadata && (user.user_metadata.avatar_url || user.user_metadata.picture);

  // ---- Trigger content: small circular avatar ONLY — no name text,
  // no chevron. Clicking it opens the dropdown below, which carries
  // the name/email/large-avatar identity instead. ----
  trigger.innerHTML = "";
  const smallAvatarEl = document.createElement("span");
  smallAvatarEl.className = "user-menu-avatar-small ts-avatar-render";
  trigger.appendChild(smallAvatarEl);
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", "Profile menu");

  // ---- Dropdown content: large avatar (+ pencil), name/email, then
  // just Logout. #logoutBtn preserved so logoutStudent() wiring
  // below still finds and works with the same element. ----
  dropdown.classList.add("avatar-dropdown");
  dropdown.innerHTML = accountDropdownHtml(displayName, user.email, "logoutBtn");

  // Only safe to run now — this is the first point where BOTH the
  // mobile drawer's avatar (static markup, present since page load)
  // AND the desktop dropdown's large avatar (just built above) exist
  // in the DOM together. Wiring this from inside
  // wireMobileProfileDrawer() earlier would miss the desktop
  // elements entirely, since the dropdown didn't exist yet at that
  // point.
  wireAvatar(user);

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !dropdown.classList.contains("open");
    dropdown.classList.toggle("open");
    trigger.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) repositionDropdownIfNarrow(trigger, dropdown);
  });
  document.addEventListener("click", (e) => {
    // The avatar picker (#avatarPickerOverlay/#avatarPickerModal) is
    // a sibling of this dropdown, not nested inside it — without
    // this check, clicking an avatar option inside the picker reads
    // as "clicked outside the dropdown" and closes it too, even
    // though the picker is only ever opened from within this same
    // dropdown and should return to it afterward.
    const inPicker = e.target.closest("#avatarPickerOverlay, #avatarPickerModal");
    if (!dropdown.contains(e.target) && !trigger.contains(e.target) && !inPicker) {
      dropdown.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    }
  });
  // Close immediately after selecting any option — Logout signs out,
  // and closing here avoids the dropdown staying visibly open mid-
  // navigation. The avatar pencil is deliberately excluded: it opens
  // the avatar picker ON TOP of this dropdown (per spec, "closing
  // the selector returns to the profile dropdown"), which only works
  // if this dropdown stays open underneath rather than closing the
  // instant the pencil itself is clicked.
  dropdown.addEventListener("click", (e) => {
    if (e.target.closest(".ts-avatar-edit-trigger")) return;
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
    { href: "dashboard.html?startTest=1", icon: "&#128203;", tint: "tile-orange", title: "Mock Test", sub: "Take a new mock test" },
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
  const MENU_PRIORITY = ["dashboard.html", "dashboard.html?startTest=1", "mock-history.html"];
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

  const currentSearch = window.location.search;
  const currentPage = window.location.pathname.split("/").pop() || "dashboard.html";

  links.forEach(link => {
    const href = link.getAttribute("href") || "";
    const linkPage = href.split("?")[0];
    if (href.includes("startTest=1")) {
      // Both this link and the plain "Dashboard" one resolve to the
      // same page (dashboard.html) once query strings are stripped —
      // comparing bare page names for THIS one specifically would
      // wrongly light up both of them together whenever the student
      // is on dashboard.html at all, Start Test flow or not. Only
      // active when the URL that's actually loaded right now still
      // carries the flag (i.e. immediately after clicking this exact
      // link, before dashboard.js's own history.replaceState clears
      // it).
      link.classList.toggle("active", currentSearch.includes("startTest=1"));
    } else {
      link.classList.toggle("active", linkPage === currentPage);
    }
  });
}

/* ============================================================
   Mobile Profile drawer
   ------------------------------------------------------------
   Opened by the Profile bottom-nav button (mobile only — desktop
   never shows that button, since it sits inside the same
   max-width:700px block as the rest of the bottom nav). Not a
   second profile/settings system: the two links inside are plain
   <a href> to the EXISTING settings.html and help-support.html
   pages, and Log Out calls the EXISTING logoutStudent() defined
   above — nothing here duplicates auth/session logic.
   ============================================================ */
function wireMobileProfileDrawer(user) {
  const trigger = document.getElementById("mobileProfileTrigger");
  const overlay = document.getElementById("mobileProfileOverlay");
  const drawer = document.getElementById("mobileProfileDrawer");
  const closeBtn = document.getElementById("mobileProfileCloseBtn");
  const logoutBtn = document.getElementById("mobileProfileLogoutBtn");
  const nameEl = document.getElementById("mobileProfileDrawerName");
  if (!trigger || !overlay || !drawer || !closeBtn || !logoutBtn) return;

  const displayName = (user.user_metadata && user.user_metadata.full_name) ? user.user_metadata.full_name : user.email;
  if (nameEl) nameEl.textContent = displayName;

  let lastFocused = null;
  let hideTimeoutId = null;

  function isOpen() { return drawer.classList.contains("open"); }

  function openDrawer() {
    lastFocused = document.activeElement;
    clearTimeout(hideTimeoutId);
    overlay.hidden = false;
    drawer.hidden = false;
    // Two rAFs, not one — hidden->visible plus the transition-start
    // class need to land in separate paint frames or the browser
    // sometimes collapses them and the slide-in never animates.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.classList.add("open");
      drawer.classList.add("open");
    }));
    trigger.setAttribute("aria-expanded", "true");
    trigger.classList.add("active");
    document.addEventListener("keydown", onKeydown);
    closeBtn.focus();
    // overflow:hidden rather than the position:fixed scroll-lock
    // trick — this doesn't detach the page from its own scroll
    // position, so there's nothing to manually restore on close; the
    // browser keeps it exactly where it was. The drawer itself keeps
    // its own overflow-y:auto (see app-shell.css), so it can still
    // scroll independently if its content ever exceeds the screen
    // height, while the page behind it can't move at all.
    document.body.classList.add("ts-scroll-locked");
    document.documentElement.classList.add("ts-scroll-locked");
  }

  function closeDrawer() {
    if (!isOpen()) return;
    overlay.classList.remove("open");
    drawer.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    trigger.classList.remove("active");
    document.removeEventListener("keydown", onKeydown);
    document.body.classList.remove("ts-scroll-locked");
    document.documentElement.classList.remove("ts-scroll-locked");
    // Hide after the slide-out finishes so it's unreachable/invisible
    // to assistive tech and Tab order immediately, not just visually
    // transparent — matches the timing used for the transition
    // itself, including the reduced-motion case (near-instant).
    const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    hideTimeoutId = setTimeout(() => {
      overlay.hidden = true;
      drawer.hidden = true;
    }, prefersReducedMotion ? 0 : 320);
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  function onKeydown(e) {
    if (e.key === "Escape") { closeDrawer(); return; }
    if (e.key !== "Tab") return;
    // Basic focus trap — Tab/Shift+Tab wrap within the drawer's own
    // focusable elements while it's open.
    const focusables = drawer.querySelectorAll("a[href], button:not([disabled])");
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  trigger.addEventListener("click", () => { isOpen() ? closeDrawer() : openDrawer(); });
  closeBtn.addEventListener("click", closeDrawer);
  overlay.addEventListener("click", closeDrawer);
  logoutBtn.addEventListener("click", () => { closeDrawer(); logoutStudent(); });
}

// Two built-in flat-illustration demo avatars (no photo-upload
// system exists, and this task doesn't add one) — same size,
// composition, and stroke quality, differing only in hair
// silhouette/palette so they read as clearly male/female at a
// glance without needing facial detail.
function demoAvatarSvg(kind) {
  const src = kind === "female" ? "assets/avatars/female.png" : "assets/avatars/male.png";
  const alt = kind === "female" ? "Female avatar" : "Male avatar";
  return '<img src="' + src + '" alt="' + alt + '" width="100%" height="100%" style="width:100%;height:100%;object-fit:cover;display:block;">';
}

// Selection priority: 1) the user's own saved choice
// (user_metadata.avatar_choice, set via the picker below) always
// wins once they've picked one — 2) otherwise derive from
// user_metadata.gender if the account happens to have it (nothing
// in registration/settings currently collects this, so in practice
// this rarely applies today) — 3) male as the documented fallback.
// Technical values ("male"/"female") never surface in the UI itself,
// only the corresponding illustration.
function resolveAvatarChoice(user) {
  const meta = user.user_metadata || {};
  if (meta.avatar_choice === "male" || meta.avatar_choice === "female") return meta.avatar_choice;
  if (typeof meta.gender === "string" && meta.gender.toLowerCase() === "female") return "female";
  return "male";
}

// Called once per page load with whichever avatar-display elements
// and edit triggers actually exist on THIS page — the mobile drawer
// always has one of each; the desktop header now has two more (a
// small avatar in the trigger, a large one with its own pencil in
// the dropdown). All discovered displays stay in sync with each
// other and with whichever trigger opens the shared picker, so a
// change made from the desktop dropdown is reflected immediately in
// the header avatar too (and vice versa via the mobile drawer),
// without needing a page reload — same live-sync requirement as
// "remains consistent across desktop header / dropdown / mobile
// sidebar / avatar selector".
function wireAvatar(user) {
  const displays = Array.from(document.querySelectorAll(".ts-avatar-render"));
  const editTriggers = Array.from(document.querySelectorAll(".ts-avatar-edit-trigger"));
  const overlay = document.getElementById("avatarPickerOverlay");
  const modal = document.getElementById("avatarPickerModal");
  const cancelBtn = document.getElementById("avatarPickerCancelBtn");
  const maleBtn = document.getElementById("avatarPickerMale");
  const femaleBtn = document.getElementById("avatarPickerFemale");
  const malePreview = document.getElementById("avatarPreviewMale");
  const femalePreview = document.getElementById("avatarPreviewFemale");
  if (displays.length === 0 || !overlay || !modal) return;

  let currentChoice = resolveAvatarChoice(user);
  function renderAll() { displays.forEach(el => { el.innerHTML = demoAvatarSvg(currentChoice); }); }
  renderAll();
  if (malePreview) malePreview.innerHTML = demoAvatarSvg("male");
  if (femalePreview) femalePreview.innerHTML = demoAvatarSvg("female");

  function syncSelectedState() {
    if (maleBtn) maleBtn.classList.toggle("selected", currentChoice === "male");
    if (femaleBtn) femaleBtn.classList.toggle("selected", currentChoice === "female");
  }
  syncSelectedState();

  function openPicker() {
    // Deliberately doesn't touch the mobile drawer or desktop
    // dropdown — both stay open underneath (dimmed by this modal's
    // own overlay), so closing the picker naturally returns to
    // whichever one was open, per spec.
    overlay.hidden = false;
    modal.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.classList.add("open");
      modal.classList.add("open");
    }));
  }
  function closePicker() {
    overlay.classList.remove("open");
    modal.classList.remove("open");
    setTimeout(() => { overlay.hidden = true; modal.hidden = true; }, 220);
  }

  async function chooseAvatar(kind) {
    if (kind === currentChoice) { closePicker(); return; }
    currentChoice = kind;
    renderAll();
    syncSelectedState();
    closePicker();
    // Same persistence pattern settings.html already uses for
    // full_name/phone — no new storage mechanism introduced.
    await supabaseClient.auth.updateUser({ data: { avatar_choice: kind } });
  }

  editTriggers.forEach(btn => btn.addEventListener("click", openPicker));
  if (cancelBtn) cancelBtn.addEventListener("click", closePicker);
  overlay.addEventListener("click", closePicker);
  if (maleBtn) maleBtn.addEventListener("click", () => chooseAvatar("male"));
  if (femaleBtn) femaleBtn.addEventListener("click", () => chooseAvatar("female"));
}

/* ============================================================
   Desktop sidebar collapse/expand
   ------------------------------------------------------------
   Desktop/tablet only — the toggle button itself only exists
   inside .app-sidebar, which is display:none below 700px (see
   app-shell.css), so this has no effect on the separate mobile
   drawer system. Persisted the same way the dark/light theme
   preference already is (a plain localStorage flag read on load),
   so the collapsed state stays consistent across page navigations
   rather than resetting on every page.
   ============================================================ */
function wireSidebarCollapse() {
  const sidebar = document.getElementById("appSidebar");
  const toggleBtn = document.getElementById("sidebarToggleBtn");
  if (!sidebar || !toggleBtn) return;

  function applyState(collapsed) {
    sidebar.classList.toggle("collapsed", collapsed);
    toggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggleBtn.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
  }

  applyState(localStorage.getItem("typeshala-sidebar-collapsed") === "1");

  toggleBtn.addEventListener("click", () => {
    const collapsed = !sidebar.classList.contains("collapsed");
    applyState(collapsed);
    localStorage.setItem("typeshala-sidebar-collapsed", collapsed ? "1" : "0");
  });
}
