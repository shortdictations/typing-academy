/* ============================================================
   admin-analytics.js
   ------------------------------------------------------------
   Powers the "Admin Overview" analytics section at the top of
   admin.html. All numbers come from ONE call to the
   admin_get_analytics_overview RPC (see docs/notes/admin_analytics.sql) —
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

const DETAIL_TITLES = {
  total_students: "All Students",
  active_students: "Active Students",
  mock_tests_taken: "Mock Tests Taken",
  credits_consumed: "Credits Consumed",
  pass_sales: "Pass Sales",
  revenue: "Revenue"
};

document.addEventListener("click", (event) => {
  const card = event.target.closest("[data-detail-view]");
  if (!card) return;
  openAnalyticsDetail(card.dataset.detailView);
});

function ensureAnalyticsDetailModal() {
  let modal = document.getElementById("adminAnalyticsDetailModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "adminAnalyticsDetailModal";
  modal.className = "admin-analytics-detail-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="admin-analytics-detail-backdrop" data-detail-close></div>
    <section class="admin-analytics-detail-panel" role="dialog" aria-modal="true" aria-labelledby="adminAnalyticsDetailTitle">
      <header class="admin-analytics-detail-head">
        <div>
          <p class="eyebrow">Admin Only</p>
          <h2 id="adminAnalyticsDetailTitle">Details</h2>
          <p id="adminAnalyticsDetailMeta" class="admin-analytics-detail-meta"></p>
        </div>
        <button type="button" class="admin-analytics-detail-close" data-detail-close aria-label="Close details">×</button>
      </header>
      <div id="adminAnalyticsDetailBody" class="admin-analytics-detail-body">
        <div class="loading-strip">Loading details...</div>
      </div>
    </section>`;
  document.body.appendChild(modal);

  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-detail-close]")) closeAnalyticsDetail();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) closeAnalyticsDetail();
  });
  return modal;
}

async function openAnalyticsDetail(view) {
  const modal = ensureAnalyticsDetailModal();
  const title = document.getElementById("adminAnalyticsDetailTitle");
  const meta = document.getElementById("adminAnalyticsDetailMeta");
  const body = document.getElementById("adminAnalyticsDetailBody");
  const period = document.getElementById("analyticsPeriodSelect").value;

  title.textContent = DETAIL_TITLES[view] || "Details";
  meta.textContent = view === "total_students"
    ? "Every registered student account, excluding admin accounts."
    : view === "active_students"
      ? "Students with activity in the last 30 days."
      : period === "all" ? "All recorded activity." : `Showing activity for: ${periodLabel(period)}`;

  body.innerHTML = '<div class="loading-strip">Loading details...</div>';
  modal.hidden = false;
  document.body.classList.add("admin-detail-modal-open");

  try {
    const { data, error } = await supabaseClient.rpc("admin_get_detail_data", {
      p_view: view,
      p_period: period
    });
    if (error) throw error;
    renderAnalyticsDetailTable(view, Array.isArray(data) ? data : [], body);
  } catch (error) {
    console.error("Admin detail error:", error);
    body.innerHTML = '<div class="empty-state">Unable to load these details. Please try again.</div>';
  }
}

function closeAnalyticsDetail() {
  const modal = document.getElementById("adminAnalyticsDetailModal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("admin-detail-modal-open");
}

function periodLabel(period) {
  return ({
    today: "Today",
    last_7: "Last 7 Days",
    last_30: "Last 30 Days",
    this_month: "This Month",
    this_year: "This Year",
    all: "All Time"
  })[period] || period;
}

function detailCell(value) {
  return `<td>${escapeHtmlAdminAnalytics(value == null || value === "" ? "—" : String(value))}</td>`;
}

function detailDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function renderAnalyticsDetailTable(view, rows, body) {
  if (!rows.length) {
    body.innerHTML = '<div class="empty-state">No records found for this selection.</div>';
    return;
  }

  let columns = [];
  let rowHtml = "";

  if (view === "total_students" || view === "active_students") {
    columns = ["Name", "Email", "Phone", view === "active_students" ? "Last activity" : "Joined"];
    rowHtml = rows.map(r => `
      <tr>
        ${detailCell(r.full_name)}
        ${detailCell(r.email)}
        ${detailCell(r.phone)}
        ${detailCell(detailDate(view === "active_students" ? r.last_activity : r.created_at))}
      </tr>`).join("");
  } else if (view === "pass_sales" || view === "revenue") {
    columns = ["Name", "Email", "Phone", "Product", "Type", "Amount", "Date"];
    rowHtml = rows.map(r => `
      <tr>
        ${detailCell(r.full_name)}
        ${detailCell(r.email)}
        ${detailCell(r.phone)}
        ${detailCell(r.product)}
        ${detailCell(r.transaction_type)}
        ${detailCell(formatIndianCurrency(r.amount))}
        ${detailCell(detailDate(r.paid_at))}
      </tr>`).join("");
  } else if (view === "credits_consumed") {
    columns = ["Name", "Email", "Phone", "Credits", "Source", "Test", "Date"];
    rowHtml = rows.map(r => `
      <tr>
        ${detailCell(r.full_name)}
        ${detailCell(r.email)}
        ${detailCell(r.phone)}
        ${detailCell(r.credits_used)}
        ${detailCell(r.source)}
        ${detailCell(r.test_name)}
        ${detailCell(detailDate(r.created_at))}
      </tr>`).join("");
  } else if (view === "mock_tests_taken") {
    columns = ["Name", "Email", "Test", "Category", "Net WPM", "Accuracy", "Date"];
    rowHtml = rows.map(r => `
      <tr>
        ${detailCell(r.full_name)}
        ${detailCell(r.email)}
        ${detailCell(r.test_name)}
        ${detailCell(r.category)}
        ${detailCell(r.net_wpm == null ? "—" : r.net_wpm)}
        ${detailCell(r.accuracy == null ? "—" : r.accuracy + "%")}
        ${detailCell(detailDate(r.created_at))}
      </tr>`).join("");
  }

  body.innerHTML = `
    <div class="admin-analytics-detail-table-wrap">
      <table class="admin-analytics-detail-table">
        <thead><tr>${columns.map(c => `<th>${escapeHtmlAdminAnalytics(c)}</th>`).join("")}</tr></thead>
        <tbody>${rowHtml}</tbody>
      </table>
    </div>
    <div class="admin-analytics-detail-count">${formatIndianNumber(rows.length)} record${rows.length === 1 ? "" : "s"}</div>`;
}


document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireAdmin();
  if (!user) return;

  // admin.js used to also load on this page and carried this same
  // call — now that Manage Passages has moved to its own page
  // (admin-passages.html) and admin.js moved with it, this is the
  // only remaining script on admin.html, so it needs this call
  // itself or the header dropdown/mobile drawer/logout go dead
  // again exactly as they were before that first fix.
  if (typeof initAuthHeader === "function") initAuthHeader(user);

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
      renderPassBreakdown(null);
      return;
    }

    renderStatCards(data);
    renderTopPassages(data.top_passages || []);
    renderPassBreakdown(data.pass_breakdown || null);
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
    renderPassBreakdown(null);
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
      <button type="button" class="admin-stat-card admin-stat-card-clickable" data-detail-view="${card.key}" aria-label="View ${card.label} details">
        <span class="admin-stat-icon">${STAT_ICONS[card.icon]}</span>
        <div class="admin-stat-label">${card.label}</div>
        <div class="admin-stat-value">${value}</div>
        ${card.note ? `<div class="admin-stat-note">${card.note}</div>` : ""}

      </button>`;
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

// Spec requirement: never combine upgrade revenue/counts with normal
// Combo purchase revenue/counts anywhere in reporting. purchases and
// upgrades are rendered as two visually separate tables here — never
// merged into one row or one total, even though both ultimately
// concern the same pass_type.
function renderPassBreakdown(breakdown) {
  const container = document.getElementById("analyticsPassBreakdown");
  if (!breakdown) {
    container.innerHTML = '<div class="empty-state">Unable to load.</div>';
    return;
  }

  const purchases = breakdown.purchases_by_pass_type || [];
  const upgrades = breakdown.upgrades_by_path || [];
  const activePasses = breakdown.active_passes_by_type || [];
  const expiredCount = breakdown.expired_passes_count || 0;

  const purchaseRows = purchases.length
    ? purchases.map(r => `
        <tr>
          <td>${escapeHtmlAdminAnalytics(r.pass_type)}</td>
          <td>${formatIndianNumber(r.count)}</td>
          <td>${formatIndianCurrency(r.revenue)}</td>
        </tr>`).join("")
    : '<tr><td colspan="3" class="empty-state">No purchases in this period.</td></tr>';

  const upgradeRows = upgrades.length
    ? upgrades.map(r => `
        <tr>
          <td>${escapeHtmlAdminAnalytics(r.source_pass_type || r.pass_type || "Unknown")} &rarr; Combo</td>
          <td>${formatIndianNumber(r.count)}</td>
          <td>${formatIndianCurrency(r.revenue)}</td>
        </tr>`).join("")
    : '<tr><td colspan="3" class="empty-state">No upgrades in this period.</td></tr>';

  const activeSummary = activePasses.length
    ? activePasses.map(r => escapeHtmlAdminAnalytics(r.pass_type) + ": " + formatIndianNumber(r.count)).join(" &middot; ")
    : "None";

  container.innerHTML = `
    <div class="admin-pass-breakdown-group">
      <div class="admin-pass-breakdown-label">Purchases</div>
      <table class="marksheet">
        <thead><tr><th>Pass</th><th>Count</th><th>Revenue</th></tr></thead>
        <tbody>${purchaseRows}</tbody>
      </table>
    </div>
    <div class="admin-pass-breakdown-group" style="margin-top:16px;">
      <div class="admin-pass-breakdown-label">Upgrades</div>
      <table class="marksheet">
        <thead><tr><th>Path</th><th>Count</th><th>Revenue</th></tr></thead>
        <tbody>${upgradeRows}</tbody>
      </table>
    </div>
    <div class="admin-pass-breakdown-group" style="margin-top:16px; font-size:0.88rem;">
      <strong>Active passes:</strong> ${activeSummary} &nbsp;&middot;&nbsp; <strong>Expired:</strong> ${formatIndianNumber(expiredCount)}
    </div>`;
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
