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
  showOnboardingWelcomeName(user);

  // Onboarding / "Welcome back" must appear as soon as possible after
  // login — checked and shown BEFORE the (slower) dashboard stats
  // fetch below, not after, so there's no perceptible delay between
  // logging in and seeing the welcome slides.
  const onboardingCompleted = await initTargetWpm(user.id);
  maybeShowWelcomeBack(user, onboardingCompleted);

  showAdminLinkIfApplicable(user); // not awaited — doesn't block anything visual

  const { data: results, error } = await supabaseClient
    .from("mock_test_results")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  currentAvgWpm = renderSummary(results);
  renderCharts(results);
  renderTargetWpmCard(); // re-render the Target WPM card now that the real average is known
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

  startWordmarkTyping();

  const card = document.getElementById("welcomeBackCard");
  showSlide(card, false); // first thing shown this modal-open, so no exit animation needed

  document.getElementById("onboardingOverlay").style.display = "flex";

  document.getElementById("continueWelcomeBackBtn").addEventListener("click", () => {
    showCompleteSlide({ withBackLink: false }); // returning flow has no "target" slide to go back to
  }, { once: true });
}

/* ---------------- Target WPM: onboarding modal + persistence ----------------
   Data layer unchanged from Part 2 (user_preferences.target_wpm /
   onboarding_completed, same upsert, same authenticated user.id).
   This is the visual/interaction layer: 3-step wizard (Welcome ->
   Target slider -> Complete), 6s auto-advance on step 1, live slider
   value, and careful timer cleanup so nothing keeps running once the
   modal is closed. */

let currentTargetWpm = null;
let currentAvgWpm = 0; // populated once dashboard stats load; renderTargetWpmCard() reads this directly instead of taking it as a parameter, so the onboarding modal can open before stats are fetched
let autoAdvanceInterval = null;
let wordmarkTyped = false; // ensures the TypeShala typing animation runs at most once per page load
let openedAsFirstLogin = false; // tracks which flow the target slide was opened from, so Save/Back behave correctly for each

async function initTargetWpm(userId) {
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
  renderTargetWpmCard();

  document.getElementById("changeTargetBtn").addEventListener("click", () => openTargetModal(false));
  wireOnboardingControls(userId);

  // No row at all, or a row that was never completed -> first-login
  // onboarding. This is the ONLY case the modal opens automatically;
  // afterward it only reopens via the explicit "Change"/"Set Target" button.
  const onboardingCompleted = !!(data && data.onboarding_completed);
  if (!onboardingCompleted) {
    openTargetModal(true);
  }

  return onboardingCompleted; // lets DOMContentLoaded decide whether the returning-user welcome applies
}

function updateWpmProgressFill(value) {
  const fill = document.getElementById("wpmProgressFill");
  if (!fill) return;
  const pct = ((value - 20) / (120 - 20)) * 100;
  fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
}

function openTargetModal(isFirstLogin) {
  openedAsFirstLogin = isFirstLogin;

  const heading = document.getElementById("targetCardHeading");
  const eyebrow = document.getElementById("targetEyebrow");
  const saveBtn = document.getElementById("saveTargetBtn");
  if (isFirstLogin) {
    heading.innerHTML = 'Choose your<br><span class="onboarding-highlight">target speed.</span>';
    eyebrow.textContent = "Your starting point";
    saveBtn.innerHTML = "Continue &rarr;";
  } else {
    heading.innerHTML = 'Change your<br><span class="onboarding-highlight">target speed.</span>';
    eyebrow.textContent = "Update anytime";
    saveBtn.innerHTML = "Start practicing";
  }

  const slider = document.getElementById("targetWpmSlider");
  const startValue = currentTargetWpm || 55;
  slider.value = startValue;
  document.getElementById("wpmSliderValue").textContent = startValue;
  updateWpmProgressFill(startValue);

  hideOnboardingError();
  document.getElementById("onboardingOverlay").style.display = "flex";
  startWordmarkTyping(); // guarded to run only once per session, regardless of entry point

  // "Back to welcome" only makes sense as part of the sequential
  // first-time flow — reopening via the dashboard's "Change"/"Set
  // Target" button opens the target step alone, with nothing to
  // go back to.
  document.getElementById("backToWelcomeBtn").style.display = isFirstLogin ? "" : "none";

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

// ~5-second auto-advance on Step 1, driven by the bottom progress
// bar only — no countdown text anywhere. Cleared on manual advance,
// on going back, and on modal close — this is the ONLY slide timer;
// nothing else creates a competing interval.
const AUTO_ADVANCE_SECONDS = 5;

function startAutoAdvance() {
  stopAutoAdvance();
  const fill = document.getElementById("autoAdvanceFill");
  fill.style.transition = "none";
  fill.style.width = "0%";

  requestAnimationFrame(() => {
    fill.style.transition = "width " + AUTO_ADVANCE_SECONDS + "s linear";
    fill.style.width = "100%";
  });

  autoAdvanceInterval = setTimeout(() => {
    stopAutoAdvance();
    goToStep(2, true);
  }, AUTO_ADVANCE_SECONDS * 1000);
}

function stopAutoAdvance() {
  if (autoAdvanceInterval) {
    clearTimeout(autoAdvanceInterval);
    autoAdvanceInterval = null;
  }
}

// Root-cause fix for the jerky transition: instead of swapping
// between separate full-card elements via display:none/block, there
// is now ONE persistent card frame and each "step" is a plain
// content panel inside it. This function crossfades panels — old
// fades+lifts out, THEN new fades+lifts in — using real CSS
// transitions driven by transitionend events (never a guessed
// setTimeout), so it can't desync from the actual animation. The
// slide viewport has a fixed min-height (see style.css), so all
// slides render at the same size regardless of content — the card
// frame, the wordmark above it, and the progress bar never move.
function goToStep(stepNumber, animate) {
  const target = document.querySelector('.onboarding-slide[data-step="' + stepNumber + '"]');
  showSlide(target, animate);
}

function showSlide(targetSlide, animate) {
  if (!targetSlide) return;
  const oldSlide = document.querySelector(".onboarding-slide.slide-active");
  if (targetSlide === oldSlide) return;

  if (!animate || !oldSlide) {
    document.querySelectorAll(".onboarding-slide").forEach(s => {
      s.classList.remove("slide-active", "slide-settled", "slide-animating", "slide-exiting");
    });
    targetSlide.classList.add("slide-active", "slide-settled");
    return;
  }

  oldSlide.classList.add("slide-animating");
  requestAnimationFrame(() => {
    oldSlide.classList.remove("slide-settled");
    oldSlide.classList.add("slide-exiting");
  });

  function onOldExit(e) {
    if (e.propertyName !== "opacity") return; // opacity and transform both transition; only act once
    oldSlide.removeEventListener("transitionend", onOldExit);
    oldSlide.classList.remove("slide-active", "slide-settled", "slide-animating", "slide-exiting");

    targetSlide.classList.add("slide-active"); // starts at the base "entering" state (opacity 0, translateY(8px))
    void targetSlide.offsetWidth; // force layout so the enter transition below actually starts from that state
    targetSlide.classList.add("slide-animating");
    requestAnimationFrame(() => {
      targetSlide.classList.add("slide-settled");
    });

    function onNewEnter(e2) {
      if (e2.propertyName !== "opacity") return;
      targetSlide.removeEventListener("transitionend", onNewEnter);
      targetSlide.classList.remove("slide-animating");
    }
    targetSlide.addEventListener("transitionend", onNewEnter);
  }
  oldSlide.addEventListener("transitionend", onOldExit);
}

// Types "TypeShala" character-by-character exactly once per page
// load, regardless of which onboarding entry point triggers it
// (first-time or returning-user) — guarded by wordmarkTyped so a
// second call (which shouldn't happen, since the two flows are
// mutually exclusive per session, but is guarded anyway) is a no-op.
// Runs independently of the slide timer — nothing here ever
// restarts it, and slide changes never touch this element.
function startWordmarkTyping() {
  if (wordmarkTyped) return;
  wordmarkTyped = true;

  const word = "TypeShala";
  const textEl = document.getElementById("wordmarkText");
  const cursorEl = document.getElementById("wordmarkCursor");
  if (!textEl) return;

  cursorEl.style.animation = "none"; // solid (non-blinking) cursor while actively typing
  let i = 0;

  const typeNext = () => {
    i += 1;
    textEl.textContent = word.slice(0, i);
    if (i < word.length) {
      setTimeout(typeNext, 100 + Math.random() * 40); // 100-140ms/char
    } else {
      setTimeout(() => {
        cursorEl.style.animation = ""; // resume normal blinking after typing completes
      }, 300);
    }
  };

  setTimeout(typeNext, 100 + Math.random() * 40);
}

function showCompleteSlide(options) {
  const backLink = document.getElementById("backToTargetBtn");
  // Only meaningful in the first-time sequential flow — the
  // returning-user flow doesn't have a "target" slide to go back to.
  backLink.style.display = (options && options.withBackLink) ? "" : "none";
  showSlide(document.getElementById("completeCard"), true);
}

function wireOnboardingControls(userId) {
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

  document.getElementById("backToTargetBtn").addEventListener("click", () => {
    goToStep(2, true);
  });

  slider.addEventListener("input", () => {
    valueEl.textContent = slider.value;
    updateWpmProgressFill(slider.value);
  });

  saveBtn.addEventListener("click", async () => {
    const value = parseInt(slider.value, 10);
    if (!value || value < 20 || value > 120) return; // matches the DB check constraint from Part 2

    hideOnboardingError();
    const wasFirstLogin = openedAsFirstLogin; // capture before any async gap
    const savingLabel = wasFirstLogin ? "Continuing..." : "Saving...";
    saveBtn.disabled = true;
    saveBtn.textContent = savingLabel;

    const { error } = await supabaseClient
      .from("user_preferences")
      .upsert({ user_id: userId, target_wpm: value, onboarding_completed: true }, { onConflict: "user_id" });

    saveBtn.disabled = false;
    saveBtn.innerHTML = wasFirstLogin ? "Continue &rarr;" : "Start practicing";

    if (error) {
      // Do NOT mark complete, do NOT close the modal — let the
      // student retry.
      console.error("Could not save target WPM:", error);
      showOnboardingError("Could not save your target. Please check your connection and try again.");
      return;
    }

    currentTargetWpm = value;
    renderTargetWpmCard();

    if (wasFirstLogin) {
      // First-time flow: advance to the completion slide.
      showCompleteSlide({ withBackLink: true });
    } else {
      // "Change Speed" from the dashboard: save and close directly —
      // no completion slide.
      document.getElementById("onboardingOverlay").style.display = "none";
    }
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

function renderTargetWpmCard() {
  const el = document.getElementById("statTargetWpm");
  const changeBtn = document.getElementById("changeTargetBtn");
  const progressCard = document.getElementById("targetProgressCard");

  if (currentTargetWpm) {
    el.textContent = currentTargetWpm; // icon is now its own separate element in the card, not inline with the number
    changeBtn.textContent = "Change";

    progressCard.style.display = "flex";
    document.getElementById("progressActual").textContent = currentAvgWpm;
    document.getElementById("progressTarget").textContent = currentTargetWpm;
    const pct = Math.max(0, Math.min(100, Math.round((currentAvgWpm / currentTargetWpm) * 100)));
    document.getElementById("progressBarFill").style.width = pct + "%";
    document.getElementById("progressPct").textContent = pct + "%";
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
  document.getElementById("statTestsLabel").textContent = testsTaken === 1 ? "Test Completed" : "Tests Completed";
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

  return avgWpm; // read by DOMContentLoaded into currentAvgWpm, for the Target WPM card's Actual-vs-Target comparison
}

// Draws the WPM (Net WPM) and Accuracy line charts using Chart.js,
// oldest test first (left) to most recent (right). Same data source
// and calculation as before — only the presentation changed: fixed
// compact height (maintainAspectRatio:false) and a dedicated,
// non-alarming single-point state instead of a mostly-empty chart.
function renderCharts(results) {
  const wpmNote = document.getElementById("wpmChartNote");
  const accuracyNote = document.getElementById("accuracyChartNote");
  wpmNote.style.display = "none";
  accuracyNote.style.display = "none";

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

  // Only one real result exists — show that single point clearly
  // (not a fabricated trend line) and let the student know a trend
  // will appear once they have more.
  const isSingleResult = results.length === 1;
  if (isSingleResult) {
    wpmNote.style.display = "block";
    accuracyNote.style.display = "block";
  }

  const tickFont = { size: 10 };

  new Chart(document.getElementById("wpmChart"), {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: "Net WPM",
        data: wpmValues,
        borderColor: "#3B5BDB",
        backgroundColor: "rgba(59,91,219,0.12)",
        tension: 0.25,
        fill: true,
        pointRadius: isSingleResult ? 5 : 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { font: tickFont } },
        x: { ticks: { font: tickFont } }
      }
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
        pointRadius: isSingleResult ? 5 : 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { font: tickFont } },
        x: { ticks: { font: tickFont } }
      }
    }
  });
}
