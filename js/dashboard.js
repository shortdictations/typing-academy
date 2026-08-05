/* ============================================================
   dashboard.js
   ------------------------------------------------------------
   Loads the logged-in student's saved results from Supabase
   and renders the summary stats + history table.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return;

  const { data: results, error } = await supabaseClient
    .from("results")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    document.getElementById("historyBody").innerHTML =
      '<div class="empty-state">Could not load your history. Please refresh the page.</div>';
    return;
  }

  renderSummary(results);
  renderHistoryTable(results);
});

function renderSummary(results) {
  const testsTaken = results.length;
  const bestWpm = testsTaken ? Math.max(...results.map(r => r.wpm)) : 0;
  const avgWpm = testsTaken
    ? Math.round(results.reduce((sum, r) => sum + r.wpm, 0) / testsTaken)
    : 0;
  const avgAccuracy = testsTaken
    ? Math.round(results.reduce((sum, r) => sum + r.accuracy, 0) / testsTaken)
    : 0;

  document.getElementById("statTests").textContent = testsTaken;
  document.getElementById("statBestWpm").textContent = bestWpm;
  document.getElementById("statAvgWpm").textContent = avgWpm;
  document.getElementById("statAvgAccuracy").textContent = avgAccuracy + "%";
}

function renderHistoryTable(results) {
  const container = document.getElementById("historyBody");

  if (results.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No practice sessions yet. Start your first typing test to see your history here.</div>';
    return;
  }

  let rows = "";
  results.forEach(r => {
    const date = new Date(r.created_at);
    const dateStr = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

    rows += `
      <tr>
        <td>${dateStr}<br><span style="opacity:0.6;font-size:0.75rem">${timeStr}</span></td>
        <td>${escapeHtml(r.passage_title || "-")}</td>
        <td><span class="pill">${escapeHtml(r.category || "-")}</span></td>
        <td>${r.duration_minutes} min</td>
        <td>${r.wpm}</td>
        <td>${r.accuracy}%</td>
      </tr>`;
  });

  container.innerHTML = `
    <table class="marksheet">
      <thead>
        <tr>
          <th>Date</th>
          <th>Passage</th>
          <th>Category</th>
          <th>Duration</th>
          <th>WPM</th>
          <th>Accuracy</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
