/* ============================================================
   mock-history.js
   ------------------------------------------------------------
   Loads the logged-in student's mock_test_results — kept
   completely separate from typing_results (regular practice
   history on dashboard.html).

   Re-attempt button: shown for any completed result that went
   through the new session system (session_id is not null — the
   handful of historical rows that predate it are left alone, since
   they have no session to re-attempt against at all). Unlimited
   re-attempts are allowed — this file never counts or limits how
   many times a mock has already been completed; it only decides
   whether to show the button at all, never whether clicking it is
   ALLOWED. Access (Pass = unlimited, no Pass = 1 credit per
   re-attempt, and the "one active session, checked first" rule) is
   fully re-checked server-side by start_reattempt() every time the
   button is actually clicked.
   ============================================================ */

let currentUser = null;

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireLogin();
  if (!currentUser) return;

  const { data: results, error } = await supabaseClient
    .from("mock_test_results")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    document.getElementById("historyBody").innerHTML =
      '<div class="empty-state">Could not load your mock test history. Please refresh the page.</div>';
    return;
  }

  renderHistory(results);
});

function renderHistory(results) {
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

    // Duration passed through so a re-attempt defaults to the same
    // length as this original attempt — purely a starting suggestion,
    // not authoritative; the student can still change it on
    // mock-test-attempt.html's own picker, which keeps the session's
    // actually-stored duration in sync when they do.
    const canReattempt = r.session_id && r.mock_test_id;
    const reattemptHtml = canReattempt
      ? `<button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;margin-left:6px;" onclick="handleReattemptClick('${r.mock_test_id}', ${r.duration === 5 ? 5 : 10}, this)">Re-attempt</button>`
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
        NO_CREDITS: "You need an active eligible Pass or at least 1 Credit to re-attempt this test.",
        LOCKED: "This mock test is no longer available."
      };
      alert((result && reasonMessages[result.access_reason]) || "Could not start the re-attempt. Please try again.");
      return;
    }

    // A resumed session may point to a COMPLETELY DIFFERENT mock than
    // the one Re-attempt was clicked on — one active session per user
    // is checked FIRST and always takes priority, blocking a new
    // re-attempt from being created while one is still unfinished.
    // Silently redirecting in that case would look like a broken/
    // wrong-mock bug rather than the intended "finish your current
    // test first" behavior.
    if (result.is_resumed) {
      alert("You have an unfinished mock test in progress.\n\nContinuing that one — finish it before starting a different mock.");
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
