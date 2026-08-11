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

  const { data: results, error } = await supabaseClient
    .from("mock_test_results")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  renderSummary(results);
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
