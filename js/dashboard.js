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

  const avgWpm = renderSummary(results);
  renderCharts(results);
  await initTargetWpm(user.id, avgWpm);
});

/* ---------------- Target WPM: onboarding modal + persistence ---------------- */

let currentTargetWpm = null;

async function initTargetWpm(userId, avgWpm) {
  const { data, error } = await supabaseClient
    .from("user_preferences")
    .select("target_wpm, onboarding_completed")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Could not load preferences:", error);
  }

  currentTargetWpm = data ? data.target_wpm : null;
  renderTargetWpmCard(avgWpm);

  document.getElementById("changeTargetBtn").addEventListener("click", () => openTargetModal(false));
  wireTargetModalControls(userId, avgWpm);

  // No row at all, or a row that was never completed -> first-login
  // onboarding. This is the ONLY case the modal opens automatically;
  // afterward it only reopens via the explicit "Change"/"Set Target" button.
  if (!data || !data.onboarding_completed) {
    openTargetModal(true);
  }
}

function openTargetModal(isFirstLogin) {
  document.getElementById("welcomeCard").style.display = isFirstLogin ? "block" : "none";
  document.getElementById("targetCardHeading").textContent = isFirstLogin ? "Set Your Target WPM" : "Change Your Target WPM";

  // Pre-fill the current target (if any) when reopened later, so the
  // student sees their existing choice rather than a blank picker.
  document.querySelectorAll(".target-wpm-btn").forEach(b => b.classList.remove("selected"));
  const customInput = document.getElementById("targetWpmCustom");
  customInput.value = "";
  const saveBtn = document.getElementById("saveTargetBtn");
  saveBtn.disabled = true;

  if (currentTargetWpm) {
    const matchBtn = document.querySelector('.target-wpm-btn[data-value="' + currentTargetWpm + '"]');
    if (matchBtn) {
      matchBtn.classList.add("selected");
    } else {
      customInput.value = currentTargetWpm;
    }
    saveBtn.disabled = false;
  }

  document.getElementById("onboardingOverlay").style.display = "flex";
}

function wireTargetModalControls(userId, avgWpm) {
  const optionsWrap = document.getElementById("targetWpmOptions");
  const customInput = document.getElementById("targetWpmCustom");
  const saveBtn = document.getElementById("saveTargetBtn");

  optionsWrap.querySelectorAll(".target-wpm-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      optionsWrap.querySelectorAll(".target-wpm-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      customInput.value = "";
      saveBtn.disabled = false;
    });
  });

  customInput.addEventListener("input", () => {
    if (customInput.value.trim() !== "") {
      optionsWrap.querySelectorAll(".target-wpm-btn").forEach(b => b.classList.remove("selected"));
      saveBtn.disabled = false;
    } else {
      saveBtn.disabled = !optionsWrap.querySelector(".target-wpm-btn.selected");
    }
  });

  saveBtn.addEventListener("click", async () => {
    const selectedBtn = optionsWrap.querySelector(".target-wpm-btn.selected");
    const value = customInput.value.trim() !== ""
      ? parseInt(customInput.value, 10)
      : (selectedBtn ? parseInt(selectedBtn.dataset.value, 10) : null);

    if (!value || value <= 0) return;

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const { error } = await supabaseClient
      .from("user_preferences")
      .upsert({ user_id: userId, target_wpm: value, onboarding_completed: true }, { onConflict: "user_id" });

    saveBtn.textContent = "Continue";
    saveBtn.disabled = false;

    if (error) {
      console.error("Could not save target WPM:", error);
      return;
    }

    currentTargetWpm = value;
    document.getElementById("onboardingOverlay").style.display = "none";
    renderTargetWpmCard(avgWpm);
  });
}

function renderTargetWpmCard(avgWpm) {
  const el = document.getElementById("statTargetWpm");
  const changeBtn = document.getElementById("changeTargetBtn");
  const progressCard = document.getElementById("targetProgressCard");

  if (currentTargetWpm) {
    el.textContent = "\u{1F3AF} " + currentTargetWpm;
    changeBtn.textContent = "Change";

    progressCard.style.display = "block";
    document.getElementById("progressActual").textContent = avgWpm;
    document.getElementById("progressTarget").textContent = currentTargetWpm;
    const pct = Math.max(0, Math.min(100, Math.round((avgWpm / currentTargetWpm) * 100)));
    document.getElementById("progressBarFill").style.width = pct + "%";
  } else {
    el.textContent = "—";
    changeBtn.textContent = "Set Target";
    progressCard.style.display = "none";
  }
}

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

  return avgWpm; // needed by initTargetWpm() for the Actual-vs-Target comparison
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
