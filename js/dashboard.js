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
  showOnboardingWelcomeName(user);

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
  const onboardingCompleted = await initTargetWpm(user.id, avgWpm);
  maybeShowWelcomeBack(user, onboardingCompleted);
});

/* ---------------- Returning-user "Welcome back" — session-scoped only ----------------
   Deliberately NOT a database field (per spec): onboarding_completed
   only ever means "has the user finished first-time setup," and must
   stay that way. This flag lives in sessionStorage, which persists
   across refreshes/navigation within the SAME tab but is explicitly
   cleared in logoutStudent() (js/auth.js) — so it always resets on a
   genuinely new login, without ever touching the database. */

const WELCOME_BACK_SESSION_KEY = "ts_welcome_back_shown";

function hasShownWelcomeBackThisSession() {
  return sessionStorage.getItem(WELCOME_BACK_SESSION_KEY) === "true";
}
function markWelcomeBackShown() {
  sessionStorage.setItem(WELCOME_BACK_SESSION_KEY, "true");
}

// Decides whether the returning-user welcome applies, and opens the
// real custom "Welcome back" card (part of the same onboarding
// modal/overlay as the first-time flow) — never a browser alert.
// No target WPM setup is shown here under any circumstance; the
// user's saved target is left completely untouched.
function maybeShowWelcomeBack(user, onboardingCompleted) {
  if (!onboardingCompleted) return; // first-time modal (initTargetWpm) already handles this case entirely
  if (hasShownWelcomeBackThisSession()) return;

  markWelcomeBackShown();
  openWelcomeBackModal(user);
}

function openWelcomeBackModal(user) {
  const firstName = (user.user_metadata && user.user_metadata.full_name)
    ? user.user_metadata.full_name.trim().split(/\s+/)[0]
    : "there";
  document.getElementById("welcomeBackName").textContent = firstName;

  // Hide the "01/02" step indicator — this is a single standalone
  // card, not part of the first-time step wizard.
  document.getElementById("onboardingSteps").style.display = "none";

  document.querySelectorAll(".onboarding-card").forEach(c => {
    c.classList.remove("step-active", "step-enter", "step-exit");
  });

  const card = document.getElementById("welcomeBackCard");
  card.classList.add("step-active", "step-enter");
  card.addEventListener("animationend", function handler(){
    card.classList.remove("step-enter");
    card.removeEventListener("animationend", handler);
  }, { once: true });

  document.getElementById("onboardingOverlay").style.display = "flex";

  document.getElementById("continueWelcomeBackBtn").addEventListener("click", closeWelcomeBackModal, { once: true });
}

function closeWelcomeBackModal() {
  document.getElementById("onboardingOverlay").style.display = "none";
  document.getElementById("welcomeBackCard").classList.remove("step-active", "step-enter", "step-exit");
  // Restore the step indicator for the first-time flow, so the two
  // flows can't bleed into each other if this ever runs again later
  // in the same page lifetime.
  document.getElementById("onboardingSteps").style.display = "flex";
}

/* ---------------- Target WPM: onboarding modal + persistence ----------------
   Data layer unchanged from Part 2 (user_preferences.target_wpm /
   onboarding_completed, same upsert, same authenticated user.id).
   This is the visual/interaction layer: 3-step wizard (Welcome ->
   Target slider -> Complete), 6s auto-advance on step 1, live slider
   value, and careful timer cleanup so nothing keeps running once the
   modal is closed. */

let currentTargetWpm = null;
let autoAdvanceInterval = null;
let autoAdvanceRemaining = 6;

async function initTargetWpm(userId, avgWpm) {
  // Load onboarding state BEFORE showing anything, so a completed
  // user never even briefly sees the modal.
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
  wireOnboardingControls(userId, avgWpm);

  // No row at all, or a row that was never completed -> first-login
  // onboarding. This is the ONLY case the modal opens automatically;
  // afterward it only reopens via the explicit "Change"/"Set Target" button.
  const onboardingCompleted = !!(data && data.onboarding_completed);
  if (!onboardingCompleted) {
    openTargetModal(true);
  }

  return onboardingCompleted; // lets DOMContentLoaded decide whether the returning-user welcome applies
}

function openTargetModal(isFirstLogin) {
  const heading = document.getElementById("targetCardHeading");
  const eyebrow = document.getElementById("targetEyebrow");
  if (isFirstLogin) {
    heading.innerHTML = 'Choose your<br><span class="onboarding-highlight">target speed.</span>';
    eyebrow.textContent = "Your starting point";
  } else {
    heading.innerHTML = 'Change your<br><span class="onboarding-highlight">target speed.</span>';
    eyebrow.textContent = "Update anytime";
  }

  const slider = document.getElementById("targetWpmSlider");
  const startValue = currentTargetWpm || 55;
  slider.value = startValue;
  document.getElementById("wpmSliderValue").textContent = startValue;

  hideOnboardingError();
  document.getElementById("onboardingOverlay").style.display = "flex";

  // First login walks through Welcome (with auto-advance) -> Target;
  // reopening later via "Change"/"Set Target" jumps straight to the
  // slider — no need to replay the welcome message every time.
  if (isFirstLogin) {
    goToStep(1, false);
    startAutoAdvance();
  } else {
    stopAutoAdvance();
    goToStep(2, false);
  }
}

// 6-second auto-advance on Step 1, with a visual fill bar. Cleared
// on manual advance, on going back, and on modal close — never left
// running in the background.
function startAutoAdvance() {
  stopAutoAdvance();
  autoAdvanceRemaining = 6;
  const fill = document.getElementById("autoAdvanceFill");
  const secondsEl = document.getElementById("autoAdvanceSeconds");
  fill.style.transition = "none";
  fill.style.width = "0%";
  secondsEl.textContent = autoAdvanceRemaining;

  requestAnimationFrame(() => {
    fill.style.transition = "width 1s linear";
  });

  autoAdvanceInterval = setInterval(() => {
    autoAdvanceRemaining -= 1;
    secondsEl.textContent = Math.max(autoAdvanceRemaining, 0);
    fill.style.width = ((6 - autoAdvanceRemaining) / 6 * 100) + "%";

    if (autoAdvanceRemaining <= 0) {
      stopAutoAdvance();
      goToStep(2, true);
    }
  }, 1000);
}

function stopAutoAdvance() {
  if (autoAdvanceInterval) {
    clearInterval(autoAdvanceInterval);
    autoAdvanceInterval = null;
  }
}

// Handles the slide/fade transition between onboarding cards and
// keeps the "01/02" step-label indicator in sync. Step 3
// (completion) is reached only programmatically after a successful
// save, never via the step-label indicator (which only covers 1/2,
// matching the spec).
function goToStep(stepNumber, animate) {
  const cards = document.querySelectorAll(".onboarding-card");
  cards.forEach(card => {
    const isTarget = parseInt(card.dataset.step, 10) === stepNumber;
    const wasActive = card.classList.contains("step-active");

    if (isTarget && !wasActive) {
      card.classList.remove("step-exit");
      card.classList.add("step-active");
      if (animate) {
        card.classList.add("step-enter");
        card.addEventListener("animationend", function handler(){
          card.classList.remove("step-enter");
          card.removeEventListener("animationend", handler);
        }, { once: true });
      }
    } else if (!isTarget && wasActive) {
      if (animate) {
        card.classList.add("step-exit");
        card.addEventListener("animationend", function handler(){
          card.classList.remove("step-active", "step-exit");
          card.removeEventListener("animationend", handler);
        }, { once: true });
      } else {
        card.classList.remove("step-active");
      }
    } else if (!isTarget) {
      card.classList.remove("step-active", "step-enter", "step-exit");
    }
  });

  document.querySelectorAll(".step-label").forEach(label => {
    label.classList.toggle("active", parseInt(label.dataset.step, 10) === stepNumber);
  });
}

function wireOnboardingControls(userId, avgWpm) {
  const slider = document.getElementById("targetWpmSlider");
  const valueEl = document.getElementById("wpmSliderValue");
  const saveBtn = document.getElementById("saveTargetBtn");

  // "Set my pace" advances immediately and cancels the timer — the
  // student is never made to wait once they've acted.
  document.getElementById("welcomeNextBtn").addEventListener("click", () => {
    stopAutoAdvance();
    goToStep(2, true);
  });

  document.getElementById("backToWelcomeBtn").addEventListener("click", () => {
    goToStep(1, true);
    startAutoAdvance(); // resets correctly on return, per spec
  });

  slider.addEventListener("input", () => {
    valueEl.textContent = slider.value;
  });

  saveBtn.addEventListener("click", async () => {
    const value = parseInt(slider.value, 10);
    if (!value || value < 20 || value > 120) return; // matches the DB check constraint from Part 2

    hideOnboardingError();
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    const { error } = await supabaseClient
      .from("user_preferences")
      .upsert({ user_id: userId, target_wpm: value, onboarding_completed: true }, { onConflict: "user_id" });

    saveBtn.disabled = false;
    saveBtn.textContent = "Start practicing \u2713";

    if (error) {
      // Do NOT mark complete, do NOT close the modal — let the
      // student retry.
      console.error("Could not save target WPM:", error);
      showOnboardingError("Could not save your target. Please check your connection and try again.");
      return;
    }

    currentTargetWpm = value;
    renderTargetWpmCard(avgWpm);
    goToStep(3, true);
  });

  document.getElementById("beginSessionBtn").addEventListener("click", () => {
    document.getElementById("onboardingOverlay").style.display = "none";
    stopAutoAdvance();
  });
}

function showOnboardingError(text) {
  let el = document.getElementById("onboardingError");
  if (!el) {
    el = document.createElement("div");
    el.id = "onboardingError";
    el.style.cssText = "margin-top:14px;padding:10px 12px;border-radius:8px;background:rgba(178,58,46,0.15);border:1px solid rgba(178,58,46,0.4);color:#F2B8B0;font-size:0.8rem;";
    document.getElementById("targetCard").appendChild(el);
  }
  el.textContent = text;
  el.style.display = "block";
}
function hideOnboardingError() {
  const el = document.getElementById("onboardingError");
  if (el) el.style.display = "none";
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

// Onboarding modal greeting uses just the first name — never the
// email as a fallback, since that would look wrong in this context.
function showOnboardingWelcomeName(user) {
  const el = document.getElementById("welcomeUserName");
  if (!el) return;
  const fullName = user.user_metadata && user.user_metadata.full_name;
  el.textContent = fullName ? fullName.trim().split(/\s+/)[0] : "there";
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
