/* ============================================================
   mock-history.js
   ------------------------------------------------------------
   Loads the logged-in student's mock_test_results — kept
   completely separate from typing_results (regular practice
   history on dashboard.html).
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return;

  const { data: results, error } = await supabaseClient
    .from("mock_test_results")
    .select("*")
    .eq("user_id", user.id)
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

    rows += `
      <tr>
        <td data-label="Mock Name">${escapeHtml(r.mock_name || "-")}</td>
        <td data-label="Category"><span class="pill">${escapeHtml((r.category || "-").toUpperCase())}</span></td>
        <td data-label="Date">${dateStr}<br><span style="opacity:0.6;font-size:0.75rem">${timeStr}</span></td>
        <td data-label="Gross WPM">${r.gross_wpm}</td>
        <td data-label="Net WPM">${r.net_wpm}</td>
        <td data-label="Accuracy">${r.accuracy}%</td>
        <td data-label="Errors">${r.errors}</td>
        <td data-label="Result"><button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;" onclick="toggleDetail('${rowId}')">View Result</button></td>
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

function toggleDetail(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.style.display = row.style.display === "none" ? "table-row" : "none";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
