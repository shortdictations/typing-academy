/* ============================================================
   mock-history.js
   ------------------------------------------------------------
   Loads the logged-in student's mock_test_results — kept
   completely separate from typing_results (regular practice
   history on dashboard.html).

   Re-attempt button added: shown only for a result that (a) went
   through the new session system (session_id is not null — the 42
   historical rows that predate it are left alone, since they have no
   session to count against the 2-attempt cap) and (b) is still the
   ONLY completed session for that mock (no re-attempt used yet).
   Clicking it calls start_reattempt() directly — the same RPC-driven
   flow as starting a fresh mock from mock-test.html, just targeting
   one specific mock instead of letting the server pick.
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

  // Completed-session counts per mock — the SAME thing
  // get_mock_access()/start_reattempt() check server-side, fetched
  // here only to decide whether to SHOW the button (never to decide
  // access itself — that's still fully re-checked server-side when
  // the button is actually clicked).
  const { data: sessions, error: sessionsError } = await supabaseClient
    .from("mock_test_sessions")
    .select("mock_test_id, status")
    .eq("user_id", currentUser.id)
    .eq("status", "completed");

  const completedCountByMock = {};
  if (!sessionsError) {
    (sessions || []).forEach(s => {
      completedCountByMock[s.mock_test_id] = (completedCountByMock[s.mock_test_id] || 0) + 1;
    });
  }

  renderHistory(results, completedCountByMock);
});

function renderHistory(results, completedCountByMock) {
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

    const canReattempt = r.session_id && r.mock_test_id && completedCountByMock[r.mock_test_id] === 1;
    const reattemptHtml = canReattempt
      ? `<button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;margin-left:6px;" onclick="handleReattemptClick('${r.mock_test_id}', this)">Re-attempt</button>`
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

async function handleReattemptClick(mockTestId, btn) {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Please wait...";

  try {
    const { data, error } = await supabaseClient.rpc("start_reattempt", { p_mock_test_id: mockTestId });

    if (error) {
      console.error("start_reattempt RPC error:", error);
      alert("Something went wrong starting the re-attempt. Please try again.");
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result || !result.session_id) {
      const reasonMessages = {
        NOT_YET_ATTEMPTED: "This mock hasn't been completed yet, so there's nothing to re-attempt.",
        REATTEMPT_ALREADY_USED: "You've already used your one re-attempt for this mock test.",
        NO_CREDITS: "You need an active eligible Pass or at least 1 Credit to re-attempt this test.",
        LOCKED: "This mock test is no longer available."
      };
      alert((result && reasonMessages[result.access_reason]) || "Could not start the re-attempt. Please try again.");
      return;
    }

    window.location.href = "mock-test-attempt.html?session=" + encodeURIComponent(result.session_id);
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
