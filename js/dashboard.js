/* ============================================================
   dashboard.js
   ------------------------------------------------------------
   Loads the logged-in student's saved results from the
   typing_results table and renders: their name, summary stats,
   and their last 10 typing tests.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin(); // redirects to login.html if not logged in
  if (!user) return;

  showStudentName(user);
  await showAdminLinkIfApplicable(user);

  const { data: results, error } = await supabaseClient
    .from("typing_results")
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
  renderHistoryTable(results.slice(0, 10)); // last 10 tests only
  renderCharts(results);
});

function showStudentName(user) {
  const name = user.user_metadata && user.user_metadata.full_name
    ? user.user_metadata.full_name
    : user.email;
  const el = document.getElementById("welcomeName");
  if (el) el.textContent = name;
}

async function showAdminLinkIfApplicable(user) {
  const admin = await isAdminUser(user.id);
  const link = document.getElementById("adminLink");
  if (link && admin) link.style.display = "inline-block";
}

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

  const lastPracticeEl = document.getElementById("statLastPractice");
  if (testsTaken) {
    // results is ordered newest-first, so index 0 is the most recent test
    const lastDate = new Date(results[0].created_at);
    lastPracticeEl.textContent = lastDate.toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric"
    });
  } else {
    lastPracticeEl.textContent = "—";
  }
}

// Draws the WPM and Accuracy line charts using Chart.js, oldest test
// first (left) to most recent (right).
function renderCharts(results) {
  if (results.length === 0) {
    document.getElementById("wpmChart").style.display = "none";
    document.getElementById("accuracyChart").style.display = "none";
    document.getElementById("wpmChartEmpty").style.display = "block";
    document.getElementById("accuracyChartEmpty").style.display = "block";
    return;
  }

  // results comes in newest-first; charts should read left-to-right
  // in chronological order, so reverse a copy for plotting.
  const chronological = results.slice().reverse();

  const labels = chronological.map(r => {
    const d = new Date(r.created_at);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  });
  const wpmValues = chronological.map(r => r.wpm);
  const accuracyValues = chronological.map(r => r.accuracy);

  new Chart(document.getElementById("wpmChart"), {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: "WPM",
        data: wpmValues,
        borderColor: "#B23A2E",
        backgroundColor: "rgba(178,58,46,0.12)",
        tension: 0.25,
        fill: true,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });

  new Chart(document.getElementById("accuracyChart"), {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: "Accuracy %",
        data: accuracyValues,
        borderColor: "#3E6B4F",
        backgroundColor: "rgba(62,107,79,0.12)",
        tension: 0.25,
        fill: true,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, max: 100 } }
    }
  });
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
        <td>${r.duration} min</td>
        <td>${r.wpm}</td>
        <td>${r.gross_wpm != null ? r.gross_wpm : "-"}</td>
        <td>${r.net_wpm != null ? r.net_wpm : "-"}</td>
        <td>${r.accuracy}%</td>
        <td>${r.errors}</td>
        <td>${r.total_words != null ? r.total_words : "-"}</td>
      </tr>`;
  });

  container.innerHTML = `
    <div style="overflow-x:auto;">
    <table class="marksheet">
      <thead>
        <tr>
          <th>Date</th>
          <th>Passage</th>
          <th>Duration</th>
          <th>WPM</th>
          <th>Gross WPM</th>
          <th>Net WPM</th>
          <th>Accuracy</th>
          <th>Errors</th>
          <th>Total Words</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
