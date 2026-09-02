/* ============================================================
   mock-history.js
   ------------------------------------------------------------
   Mock Test History + 6-hour per-result re-attempt window.
   The server/RPC remains authoritative for re-attempt access.
   This file only renders the history and provides presentation.
   ============================================================ */

let currentUser = null;
let countdownTimerId = null;
let allHistoryResults = [];
let sessionByResultId = new Map();
let currentHistoryPage = 1;
const HISTORY_PAGE_SIZE = 5;

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireLogin();
  if (!currentUser) return;

  const { data: results, error: resultsError } = await supabaseClient
    .from("mock_test_results")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (resultsError) {
    console.error("Could not load mock test results:", resultsError);
    document.getElementById("historyBody").innerHTML =
      '<div class="empty-state">Could not load your mock test history. Please refresh the page.</div>';
    return;
  }

  allHistoryResults = results || [];
  const resultIds = allHistoryResults.map(r => r.id).filter(Boolean);

  sessionByResultId = new Map();
  if (resultIds.length) {
    const { data: sessions, error: sessionsError } = await supabaseClient
      .from("mock_test_sessions")
      .select("result_id, reattempt_window_expires_at")
      .in("result_id", resultIds);

    if (sessionsError) {
      console.error("Could not load re-attempt windows:", sessionsError);
    } else {
      (sessions || []).forEach(session => {
        if (session.result_id) sessionByResultId.set(session.result_id, session);
      });
    }
  }

  renderHistory();
  startCountdownTicker();
});

function renderHistory() {
  const container = document.getElementById("historyBody");

  if (allHistoryResults.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No mock tests completed yet. Take your first one from the Mock Test page.</div>';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(allHistoryResults.length / HISTORY_PAGE_SIZE));
  currentHistoryPage = Math.min(Math.max(currentHistoryPage, 1), totalPages);

  const start = (currentHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const pageResults = allHistoryResults.slice(start, start + HISTORY_PAGE_SIZE);

  const rows = pageResults.map((r, pageIndex) => {
    const absoluteIndex = start + pageIndex;
    const date = new Date(r.created_at);
    const dateStr = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const rowId = "mockrow-" + absoluteIndex;
    const category = (r.category || "").toLowerCase();
    const isLegal = category === "legal";
    const categoryLabel = (r.category || "-").toUpperCase();
    const sessionForResult = sessionByResultId.get(r.id);
    const expiresAt = sessionForResult ? sessionForResult.reattempt_window_expires_at : null;
    const windowStillOpen = expiresAt && new Date(expiresAt).getTime() > Date.now();
    const accuracy = Number(r.accuracy || 0);
    const accuracyClass = accuracy >= 90 ? "mh-accuracy-good" : accuracy < 70 ? "mh-accuracy-low" : "";
    const icon = isLegal
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v17M5 7h14M7 7l-3 6a3 3 0 0 0 6 0L7 7Zm10 0-3 6a3 3 0 0 0 6 0l-3-6ZM8 21h8"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h.01M11 9h.01M15 9h.01M19 9h.01M7 13h.01M11 13h.01M15 13h.01M19 13h.01M9 17h6"/></svg>';

    const reattemptHtml = windowStillOpen
      ? `<span class="mh-reattempt-wrap" data-expires-at="${escapeHtml(expiresAt)}">` +
          `<button type="button" class="mh-action mh-action-reattempt" onclick="handleReattemptClick('${escapeHtml(r.mock_test_id)}', ${r.duration === 5 ? 5 : 10}, this)">` +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0 2 5"/><path d="M20 4v7h-7"/></svg>' +
            '<span>Re-attempt</span>' +
          '</button>' +
          '<span class="mh-reattempt-countdown"></span>' +
        '</span>'
      : "";

    return `
      <tr>
        <td data-label="Mock Name">
          <div class="mh-test-name">
            <span class="mh-test-icon ${isLegal ? "mh-test-icon-legal" : "mh-test-icon-ssc"}">${icon}</span>
            <span>${escapeHtml(r.mock_name || "-")}</span>
          </div>
        </td>
        <td data-label="Category"><span class="mh-category ${isLegal ? "mh-category-legal" : "mh-category-ssc"}">${escapeHtml(categoryLabel)}</span></td>
        <td data-label="Date"><span class="mh-date-main">${dateStr}</span><span class="mh-date-time">${timeStr}</span></td>
        <td data-label="Gross WPM" class="mh-number">${escapeHtml(String(r.gross_wpm ?? "-"))}</td>
        <td data-label="Net WPM" class="mh-number">${escapeHtml(String(r.net_wpm ?? "-"))}</td>
        <td data-label="Accuracy" class="mh-number ${accuracyClass}">${escapeHtml(String(r.accuracy ?? 0))}%</td>
        <td data-label="Errors" class="mh-number">${escapeHtml(String(r.errors ?? 0))}</td>
        <td data-label="Result">
          <div class="mh-actions">
            <button type="button" class="mh-action mh-action-result" onclick="toggleDetail('${rowId}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z"/><circle cx="12" cy="12" r="2.5"/></svg>
              <span>View Result</span>
            </button>
            ${reattemptHtml}
          </div>
        </td>
      </tr>
      <tr id="${rowId}" class="history-detail-row" style="display:none;">
        <td colspan="8">
          <div class="mh-detail-inner">
            <span><strong>Passage</strong>${escapeHtml(r.passage_title || "-")}</span>
            <span><strong>Duration</strong>${escapeHtml(String(r.duration ?? "-"))} min</span>
            <span><strong>Words Typed</strong>${escapeHtml(String(r.total_words ?? "-"))}</span>
          </div>
        </td>
      </tr>`;
  }).join("");

  container.innerHTML = `
    <div class="mh-table-wrap">
      <table class="mh-history-table">
        <thead>
          <tr>
            <th>Mock Name</th>
            <th>Category</th>
            <th>Date <span class="mh-sort-arrow">↓</span></th>
            <th>Gross WPM</th>
            <th>Net WPM</th>
            <th>Accuracy</th>
            <th>Errors</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${renderPagination(totalPages)}`;

  updateAllCountdowns();
}

function renderPagination(totalPages) {
  if (totalPages <= 1) return "";

  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    // Keep the control compact when there are many pages.
    if (totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - currentHistoryPage) <= 1) {
      pages.push(`<button type="button" class="mh-page-number ${p === currentHistoryPage ? "active" : ""}" onclick="goToHistoryPage(${p})" aria-current="${p === currentHistoryPage ? "page" : "false"}">${p}</button>`);
    } else if (pages[pages.length - 1] !== "ellipsis") {
      pages.push("ellipsis");
    }
  }

  return `<nav class="mh-pagination" aria-label="Mock test history pages">
    <button type="button" class="mh-page-control" onclick="goToHistoryPage(1)" ${currentHistoryPage === 1 ? "disabled" : ""} aria-label="First page">|&lt;</button>
    <button type="button" class="mh-page-control" onclick="goToHistoryPage(${currentHistoryPage - 1})" ${currentHistoryPage === 1 ? "disabled" : ""} aria-label="Previous page">&lsaquo;</button>
    ${pages.map(p => p === "ellipsis" ? '<span class="mh-page-ellipsis">…</span>' : p).join("")}
    <button type="button" class="mh-page-control" onclick="goToHistoryPage(${currentHistoryPage + 1})" ${currentHistoryPage === totalPages ? "disabled" : ""} aria-label="Next page">&rsaquo;</button>
    <button type="button" class="mh-page-control" onclick="goToHistoryPage(${totalPages})" ${currentHistoryPage === totalPages ? "disabled" : ""} aria-label="Last page">&gt;|</button>
  </nav>`;
}

function goToHistoryPage(page) {
  const totalPages = Math.max(1, Math.ceil(allHistoryResults.length / HISTORY_PAGE_SIZE));
  if (page < 1 || page > totalPages || page === currentHistoryPage) return;
  currentHistoryPage = page;
  renderHistory();
  document.querySelector(".mh-history-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateAllCountdowns() {
  document.querySelectorAll(".mh-reattempt-wrap").forEach(wrap => {
    const expiresAt = new Date(wrap.dataset.expiresAt).getTime();
    const remainingMs = expiresAt - Date.now();

    if (remainingMs <= 0) {
      wrap.remove();
      return;
    }

    const countdownEl = wrap.querySelector(".mh-reattempt-countdown");
    if (countdownEl) countdownEl.textContent = formatCountdown(remainingMs);
  });
}

function formatCountdown(remainingMs) {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours >= 1) return `${hours}h ${minutes}m left`;
  if (minutes >= 1) return `${minutes}m ${seconds}s left`;
  return `${seconds}s left`;
}

function startCountdownTicker() {
  if (countdownTimerId) clearInterval(countdownTimerId);
  countdownTimerId = setInterval(updateAllCountdowns, 1000);
}

async function handleReattemptClick(mockTestId, duration, btn) {
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.querySelector("span")?.replaceChildren(document.createTextNode("Please wait..."));

  try {
    const { data, error } = await supabaseClient.rpc("start_reattempt", {
      p_mock_test_id: mockTestId,
      p_duration: duration
    });

    if (error) {
      console.error("start_reattempt RPC error:", error);
      alert("Something went wrong starting the re-attempt. Please try again.");
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result || !result.session_id) {
      const reasonMessages = {
        NOT_YET_ATTEMPTED: "This mock hasn't been completed yet, so there's nothing to re-attempt.",
        REATTEMPT_WINDOW_EXPIRED: "The re-attempt window for this test has expired.",
        LOCKED: "This mock test is no longer available."
      };
      alert((result && reasonMessages[result.access_reason]) || "Could not start the re-attempt. Please try again.");
      if (result && result.access_reason === "REATTEMPT_WINDOW_EXPIRED") {
        btn.closest(".mh-reattempt-wrap")?.remove();
      }
      return;
    }

    const target = "mock-test-attempt.html?session=" + encodeURIComponent(result.session_id) + "&duration=" + encodeURIComponent(duration) + (result.is_resumed ? "&resume=1" : "");
    window.location.href = target;
  } catch (err) {
    console.error("start_reattempt failed:", err);
    alert("Something went wrong starting the re-attempt. Please try again.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function toggleDetail(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.style.display = row.style.display === "none" ? "table-row" : "none";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
