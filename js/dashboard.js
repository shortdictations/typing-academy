/* ============================================================
   dashboard.js
   ------------------------------------------------------------
   Powers the Performance Dashboard from mock_test_results — the
   SAME table already used by mock-test-attempt.js for SSC Mock
   Tests, Legal Mock Tests, AND Credit-Based Tests (all three test
   types share this one result table; confirmed by inspecting the
   save logic in js/mock-test-attempt.js). No merge with
   typing_results is needed or performed — that table belonged to
   the retired practice system and is no longer read here at all.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin(); // redirects to login.html if not logged in
  if (!user) return;

  showStudentName(user);
  await showAdminLinkIfApplicable(user);

  // mock_tests(access_type) is joined via the existing mock_test_id
  // foreign key so each row's Test Type (SSC/Legal/Credit-Based) can
  // be shown without guessing or storing a duplicate field.
  const { data: results, error } = await supabaseClient
    .from("mock_test_results")
    .select("*, mock_tests(access_type)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    document.getElementById("historyBody").innerHTML =
      '<div class="empty-state">Could not load your history. Please refresh the page.</div>';
    return;
  }

  renderSummary(results);
  renderMockTestHistory(results); // complete history — no 10-row limit
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

// Test Type is derived from the joined mock_tests row, not stored
// redundantly. Falls back gracefully if the original mock_tests row
// was ever deleted (mock_test_id -> SET NULL on delete).
function testTypeLabel(row) {
  if (!row.mock_tests) return "Mock Test";
  if (row.mock_tests.access_type === "credit") return "Credit-Based Test";
  return row.category === "ssc" ? "SSC Mock Test" : "Legal Mock Test";
}

function renderSummary(results) {
  const testsTaken = results.length;

  // Primary WPM metric: Net WPM — the same accuracy-adjusted figure
  // already used for grading (gradeFor()) on the result page itself,
  // so the dashboard's headline number matches what students already
  // see immediately after finishing a test. Gross WPM remains visible
  // per-row in the history table below, just not used for this average.
  const avgWpm = testsTaken
    ? Math.round(results.reduce((sum, r) => sum + r.net_wpm, 0) / testsTaken)
    : 0;
  const avgAccuracy = testsTaken
    ? Math.round(results.reduce((sum, r) => sum + r.accuracy, 0) / testsTaken)
    : 0;

  document.getElementById("statTests").textContent = testsTaken;
  document.getElementById("statAvgWpm").textContent = avgWpm;
  document.getElementById("statAvgAccuracy").textContent = avgAccuracy + "%";

  const lastTestEl = document.getElementById("statLastTest");
  if (testsTaken) {
    // results is ordered newest-first, so index 0 is the most recent test
    const lastDate = new Date(results[0].created_at);
    lastTestEl.textContent = lastDate.toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric"
    });
  } else {
    lastTestEl.textContent = "—";
  }
}

// Draws the WPM (Net WPM) and Accuracy line charts using Chart.js,
// oldest test first (left) to most recent (right). Same chart
// implementation as before — only the data source and field changed.
function renderCharts(results) {
  if (results.length === 0) {
    document.getElementById("wpmChart").style.display = "none";
    document.getElementById("accuracyChart").style.display = "none";
    document.getElementById("wpmChartEmpty").style.display = "block";
    document.getElementById("accuracyChartEmpty").style.display = "block";
    return;
  }

  const chronological = results.slice().reverse();

  const labels = chronological.map(r => {
    const d = new Date(r.created_at);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  });
  const wpmValues = chronological.map(r => r.net_wpm);
  const accuracyValues = chronological.map(r => r.accuracy);

  new Chart(document.getElementById("wpmChart"), {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: "Net WPM",
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

// Complete Mock Test History — SSC + Legal + Credit-Based unified,
// newest first, no row limit. "View Result" reuses the same inline-
// expand pattern already used on mock-history.html, rather than
// building a separate result-viewing page.
function renderMockTestHistory(results) {
  const container = document.getElementById("historyBody");

  if (results.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No tests completed yet.<br><br>' +
      '<a class="btn" href="mock-test.html">Take a Mock Test</a></div>';
    return;
  }

  let rows = "";
  results.forEach((r, i) => {
    const date = new Date(r.created_at);
    const dateStr = date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const timeStr = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const categoryLabel = r.category === "ssc" ? "SSC" : (r.category === "legal" ? "Legal" : "-");
    const rowId = "hist-" + i;

    rows += `
      <tr>
        <td>${escapeHtml(r.mock_name || r.passage_title || "-")}</td>
        <td><span class="pill">${escapeHtml(testTypeLabel(r))}</span></td>
        <td>${escapeHtml(categoryLabel)}</td>
        <td>${r.net_wpm}</td>
        <td>${r.accuracy}%</td>
        <td>${dateStr}<br><span style="opacity:0.6;font-size:0.75rem">${timeStr}</span></td>
        <td><button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:0.75rem;" onclick="toggleHistoryDetail('${rowId}')">View Result</button></td>
      </tr>
      <tr id="${rowId}" style="display:none;">
        <td colspan="7" style="background:var(--paper-dark); font-size:0.85rem;">
          <strong>Passage:</strong> ${escapeHtml(r.passage_title || "-")}
          &nbsp;&middot;&nbsp;
          <strong>Duration:</strong> ${r.duration} min
          &nbsp;&middot;&nbsp;
          <strong>Gross WPM:</strong> ${r.gross_wpm}
          &nbsp;&middot;&nbsp;
          <strong>Errors:</strong> ${r.errors}
          &nbsp;&middot;&nbsp;
          <strong>Total Words:</strong> ${r.total_words}
        </td>
      </tr>`;
  });

  container.innerHTML = `
    <div style="overflow-x:auto;">
    <table class="marksheet">
      <thead>
        <tr>
          <th>Test Name</th>
          <th>Test Type</th>
          <th>Category</th>
          <th>WPM</th>
          <th>Accuracy</th>
          <th>Date</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
}

function toggleHistoryDetail(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.style.display = row.style.display === "none" ? "table-row" : "none";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
