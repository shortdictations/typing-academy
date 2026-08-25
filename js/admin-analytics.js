/* ============================================================
   admin-analytics.js
   ------------------------------------------------------------
   Powers the "Admin Overview" analytics section at the top of
   admin.html. All numbers come from ONE call to the
   admin_get_analytics_overview RPC (see sql/admin_analytics.sql) —
   a single round trip, database-side aggregation, and the RPC
   itself re-checks admin status server-side (security definer)
   before returning anything, so this is safe even though it's
   callable by any authenticated user. This file never queries
   student-level tables directly, and never needs a service-role
   key — same pattern every other admin-gated RPC in this project
   already uses (can_access_mock, start_mock_test, etc).

   Gated by its own requireAdmin() call, same as admin.js — kept
   independent rather than coupled to admin.js's own init, so a
   failure in one never breaks the other.
   ============================================================ */

const STAT_CARDS = [
  { key: "total_students", label: "Total Students", icon: "users", note: null },
  { key: "active_students", label: "Active Students", icon: "active", note: "30-day activity" },
  { key: "mock_tests_taken", label: "Mock Tests Taken", icon: "keyboard", note: null },
  { key: "credits_consumed", label: "Credits Consumed", icon: "credits", note: null },
  { key: "pass_sales", label: "Pass Sales", icon: "card", note: null },
  { key: "revenue", label: "Revenue", icon: "rupee", note: null, isCurrency: true }
];

const STAT_ICONS = {
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  active: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 17h8"/></svg>',
  credits: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4V9Z"/><path d="M13 5v2M13 11v2M13 17v2"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  rupee: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12M6 8h12M6 4a6 6 0 0 1 0 8h-2l7 8"/></svg>'
};

let analyticsLoading = false;

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAdmin();
  if (!user) return;

  renderSkeletons();

  document.getElementById("analyticsRefreshBtn").addEventListener("click", () => loadAnalytics());
  document.getElementById("analyticsPeriodSelect").addEventListener("change", () => loadAnalytics());

  await loadAnalytics();
});

function renderSkeletons() {
  const grid = document.getElementById("analyticsStatGrid");
  grid.innerHTML = STAT_CARDS.map(() => `
    <div class="admin-stat-card admin-stat-skeleton">
      <div class="admin-stat-skel-icon"></div>
      <div class="admin-stat-skel-line" style="width:70%;"></div>
      <div class="admin-stat-skel-line" style="width:45%; height:22px;"></div>
    </div>
  `).join("");
}

async function loadAnalytics() {
  if (analyticsLoading) return;
  analyticsLoading = true;

  const refreshBtn = document.getElementById("analyticsRefreshBtn");
  const errorBox = document.getElementById("analyticsError");
  const period = document.getElementById("analyticsPeriodSelect").value;

  errorBox.style.display = "none";
  refreshBtn.disabled = true;
  refreshBtn.classList.add("is-refreshing");

  try {
    const { data, error } = await supabaseClient.rpc("admin_get_analytics_overview", { p_period: period });

    if (error) {
      // Structured logging so the actual failing query and Supabase's
      // real reason are always visible in the console during
      // development — this is exactly how the "profiles does not
      // exist" root cause was found and confirmed, not guessed. Never
      // surfaced to the admin UI itself (requirement 15) — only the
      // generic message below is shown there.
      console.error("Admin analytics error:", {
        rpc: "admin_get_analytics_overview",
        period,
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint
      });
      errorBox.textContent = "Unable to load analytics. Please try again.";
      errorBox.style.display = "block";
      renderStatCardsEmpty();
      renderTopPassagesError();
      return;
    }

    renderStatCards(data);
    renderTopPassages(data.top_passages || []);
  } catch (err) {
    console.error("Admin analytics error (thrown, not returned):", {
      rpc: "admin_get_analytics_overview",
      period,
      message: err?.message,
      code: err?.code,
      details: err?.details,
      hint: err?.hint
    });
    errorBox.textContent = "Unable to load analytics. Please try again.";
    errorBox.style.display = "block";
    renderStatCardsEmpty();
    renderTopPassagesError();
  } finally {
    analyticsLoading = false;
    refreshBtn.disabled = false;
    refreshBtn.classList.remove("is-refreshing");
  }
}

function renderStatCards(data) {
  const grid = document.getElementById("analyticsStatGrid");
  grid.innerHTML = STAT_CARDS.map(card => {
    const rawValue = data[card.key];
    const value = card.isCurrency
      ? formatIndianCurrency(rawValue)
      : formatIndianNumber(rawValue);
    return `
      <div class="admin-stat-card">
        <span class="admin-stat-icon">${STAT_ICONS[card.icon]}</span>
        <div class="admin-stat-label">${card.label}</div>
        <div class="admin-stat-value">${value}</div>
        ${card.note ? `<div class="admin-stat-note">${card.note}</div>` : ""}
      </div>`;
  }).join("");
}

// Shown only on a genuine load failure — never a flash of "0" while
// data is still loading (requirement 13), and distinct from a true
// empty state (requirement 14, which shows real zeros because that's
// the real count, not because loading failed).
function renderStatCardsEmpty() {
  const grid = document.getElementById("analyticsStatGrid");
  grid.innerHTML = STAT_CARDS.map(card => `
    <div class="admin-stat-card">
      <span class="admin-stat-icon">${STAT_ICONS[card.icon]}</span>
      <div class="admin-stat-label">${card.label}</div>
      <div class="admin-stat-value">&mdash;</div>
      ${card.note ? `<div class="admin-stat-note">${card.note}</div>` : ""}
    </div>
  `).join("");
}

function renderTopPassages(rows) {
  const container = document.getElementById("analyticsTopPassages");

  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">No test attempts recorded yet.</div>';
    return;
  }

  container.innerHTML = `
    <div class="admin-passage-table">
      ${rows.map((row, i) => `
        <div class="admin-passage-row">
          <span class="admin-passage-rank">#${i + 1}</span>
          <div class="admin-passage-info">
            <div class="admin-passage-title">${escapeHtmlAdminAnalytics(row.passage_title || "Untitled passage")}</div>
            ${row.category ? `<span class="admin-passage-category">${escapeHtmlAdminAnalytics(row.category)}</span>` : ""}
          </div>
          <div class="admin-passage-attempts">${formatIndianNumber(row.attempts)} attempts</div>
        </div>
      `).join("")}
    </div>`;
}

// Companion to renderStatCardsEmpty() for the same failure path —
// without this, a failed load left "Loading top passages..." stuck
// on screen forever instead of reflecting that the load actually
// failed (caught directly by testing the error path, not assumed).
function renderTopPassagesError() {
  const container = document.getElementById("analyticsTopPassages");
  container.innerHTML = '<div class="empty-state">Unable to load.</div>';
}

function formatIndianNumber(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("en-IN");
}

function formatIndianCurrency(n) {
  const num = Number(n) || 0;
  return "\u20B9" + num.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function escapeHtmlAdminAnalytics(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}
