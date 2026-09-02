/* ============================================================
   mock-history.js
   ------------------------------------------------------------
   Loads the logged-in student's mock_test_results — kept
   completely separate from typing_results (regular practice
   history on dashboard.html).

   Re-attempt button + live countdown: shown for a completed result
   only while its (user, mock) chain's fixed 6-hour re-attempt window
   is still open — reattempt_window_expires_at, set once on the
   ORIGINAL attempt's completion and copied forward unchanged onto
   every re-attempt in the chain (never recalculated, never
   extended), fetched here via a join to mock_test_sessions. This
   file never decides whether clicking Re-attempt is actually
   ALLOWED — that's start_reattempt()'s own re-check against the
   same authoritative column, server-side, every time. The client-
   side countdown shown here is purely a display convenience and
   updates every second with no server round-trip and no page
   refresh; when it reaches zero, the button and countdown are
   removed immediately, from the same client-side tick — no
   "disabled" state, no reload needed.
   ============================================================ */

let currentUser = null;
let countdownTimerId = null;

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireLogin();
  if (!currentUser) return;

  // Do NOT use a nested Supabase/PostgREST relation here.
  // In the current session architecture, mock_test_sessions.result_id
  // points back to mock_test_results.id (the session is the child row),
  // so embedding mock_test_sessions from mock_test_results is not a
  // reliable relation in this project and can make the entire history
  // query fail. Load the two tables separately and join them in memory.
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

  const safeResults = results || [];
  const resultIds = safeResults.map(r => r.id).filter(Boolean);
  const sessionByResultId = new Map();

  if (resultIds.length) {
    const { data: sessions, error: sessionsError } = await supabaseClient
      .from("mock_test_sessions")
      .select("result_id, reattempt_window_expires_at")
      .in("result_id", resultIds);

    if (sessionsError) {
      // History itself should still load if the optional re-attempt-window
      // lookup fails. Older result rows also legitimately have no session.
      console.error("Could not load re-attempt windows:", sessionsError);
    } else {
      (sessions || []).forEach(session => {
        if (session.result_id) sessionByResultId.set(session.result_id, session);
      });
    }
  }

  renderHistory(safeResults, sessionByResultId);
  startCountdownTicker();
});

function renderHistory(results, sessionByResultId = new Map()) {
  const container = document.getElementById("historyBody");

  if (results.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No mock tests completed yet. Take your first one from the Mock Test page.</div>';
    return;
  }

  let rows = "";
  results.forEach((r, i) => {
    const date = new Date(r.created_at);
    const dateStr = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const rowId = "mockrow-" + i;

    // Sessions are loaded separately because the current schema links
    // mock_test_sessions.result_id -> mock_test_results.id.
    // Historical rows without a linked session simply have no window.
    const sessionForResult = sessionByResultId.get(r.id);
    const expiresAt = sessionForResult ? sessionForResult.reattempt_window_expires_at : null;
    const windowStillOpen = expiresAt && new Date(expiresAt).getTime() > Date.now();

    // Duration passed through so a re-attempt defaults to the same
    // length as this original attempt — purely a starting suggestion,
    // not authoritative; the student can still change it on
    // mock-test-attempt.html's own picker, which keeps the session's
    // actually-stored duration in sync when they do.
    const reattemptHtml = windowStillOpen
      ? `<span class="mh-reattempt-wrap" data-expires-at="${escapeHtml(expiresAt)}">` +
          `<button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;margin-left:6px;" onclick="handleReattemptClick('${r.mock_test_id}', ${r.duration === 5 ? 5 : 10}, this)">Re-attempt</button>` +
          `<span class="mh-reattempt-countdown"></span>` +
        `</span>`
      : "";

    rows += `
      <tr>
        <td data-label="Mock Name">${escapeHtml(r.mock_name || "-")}</td>
        <td data-label="Category"><span class="pill">${escapeHtml((r.category || "-").toUpperCase())}</span></td>
        <td data-label="Date">${dateStr}<br><span style="opacity:0.6;font-size:0.75rem">${timeStr}</span></td>
        <td data-label="Gross WPM">${r.gross_wpm}</td>
        <td data-label="Net WPM">${r.net_wpm}</td>
        <td data-label="Accuracy">${r.accuracy}%</td>
        <td data-label="Errors">${r.errors}</td>
        <td data-label="Result">
          <button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;" onclick="toggleDetail('${rowId}')">View Result</button>${reattemptHtml}
        </td>
      </tr>
      <tr id="${rowId}" class="history-detail-row" style="display:none;">
        <td colspan="8" style="background:var(--paper-dark); font-size:0.85rem;">
          <strong>Passage:</strong> ${escapeHtml(r.passage_title || "-")}
          &nbsp;&middot;&nbsp;
          <strong>Duration:</strong> ${r.duration} min
          &nbsp;&middot;&nbsp;
          <strong>Total Words Typed:</strong> ${r.total_words}
        </td>
      </tr>`;
  });

  container.innerHTML = `
    <div style="overflow-x:auto;">
    <table class="marksheet history-table">
      <thead>
        <tr>
          <th>Mock Name</th>
          <th>Category</th>
          <th>Date</th>
          <th>Gross WPM</th>
          <th>Net WPM</th>
          <th>Accuracy</th>
          <th>Errors</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;

  // renderHistory() replaces #historyBody's entire innerHTML, which
  // would otherwise leave any already-rendered countdown wrappers as
  // stale DOM references — re-running the ticker's own DOM query
  // immediately after picks up the freshly-rendered elements right
  // away, rather than waiting up to a second for the next tick.
  updateAllCountdowns();
}

// "4h 32m left" / "58m 42s left" / "42s left" — ticks every second via
// startCountdownTicker(). The instant any row's remaining time hits
// zero, its entire Re-attempt button + countdown wrapper is removed
// from the DOM outright — never a disabled button, never left showing
// "0s left", and never requiring a page refresh, exactly as specified.
function updateAllCountdowns() {
  const wraps = document.querySelectorAll(".mh-reattempt-wrap");
  wraps.forEach(wrap => {
    const expiresAt = new Date(wrap.dataset.expiresAt).getTime();
    const remainingMs = expiresAt - Date.now();

    if (remainingMs <= 0) {
      wrap.remove();
      return;
    }

    const countdownEl = wrap.querySelector(".mh-reattempt-countdown");
    countdownEl.textContent = formatCountdown(remainingMs);
  });
}

function formatCountdown(remainingMs) {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours >= 1) return hours + "h " + minutes + "m left";
  if (minutes >= 1) return minutes + "m " + seconds + "s left";
  return seconds + "s left";
}

function startCountdownTicker() {
  if (countdownTimerId) clearInterval(countdownTimerId);
  countdownTimerId = setInterval(updateAllCountdowns, 1000);
}

async function handleReattemptClick(mockTestId, duration, btn) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Please wait...";

  try {
    const { data, error } = await supabaseClient.rpc("start_reattempt", { p_mock_test_id: mockTestId, p_duration: duration });

    if (error) {
      console.error("start_reattempt RPC error:", error);
      alert("Something went wrong starting the re-attempt. Please try again.");
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result || !result.session_id) {
      const reasonMessages = {
        NOT_YET_ATTEMPTED: "This mock hasn't been completed yet, so there's nothing to re-attempt.",
        // Should be rare in practice (the button is only shown while
        // the window is open, per the same authoritative column) —
        // this is the safety net for the narrow race where the
        // window expires in the moments between page load and click.
        REATTEMPT_WINDOW_EXPIRED: "The re-attempt window for this test has expired.",
        LOCKED: "This mock test is no longer available."
      };
      alert((result && reasonMessages[result.access_reason]) || "Could not start the re-attempt. Please try again.");
      if (result && result.access_reason === "REATTEMPT_WINDOW_EXPIRED") {
        btn.closest(".mh-reattempt-wrap").remove();
      }
      return;
    }

    // A resumed session that never actually had its page opened
    // (e.g. the tab closed mid-redirect on a previous attempt) looks,
    // from the student's own point of view, exactly like starting
    // fresh — skip the modal in that case; the redirect below still
    // safely resumes the SAME session either way.
    //
    // When the page WAS genuinely opened before: a resumed session
    // may point to a COMPLETELY DIFFERENT mock than the one Re-attempt
    // was clicked on — one active session per user is checked FIRST
    // and always takes priority, blocking a new re-attempt from being
    // created while one is still unfinished. Silently redirecting in
    // that case would look like a broken/wrong-mock bug rather than
    // the intended "finish your current test first" behavior. Cancel
    // means the student stays right here, on Mock History, with
    // nothing navigated.
    if (result.is_resumed && result.page_opened) {
      const proceed = await showUnfinishedTestModal({
        mockTitle: result.mock_title,
        category: result.mock_category,
        duration: result.mock_duration,
        startedAt: result.session_started_at,
        title: "Test Not Started",
        subtitle: "You exited before starting.<br>Your unfinished mock is still active.",
        cancelLabel: "Back"
      });
      if (!proceed) return;
    }

    window.location.href = "mock-test-attempt.html?session=" + encodeURIComponent(result.session_id) + "&duration=" + duration;
  } catch (err) {
    console.error("start_reattempt failed:", err);
    alert("Something went wrong starting the re-attempt. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
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
