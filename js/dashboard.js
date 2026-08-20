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

  const startMockTestBtn = document.getElementById("startMockTestBtn");
  if (startMockTestBtn) {
    startMockTestBtn.addEventListener("click", () => handleStartMockTestClick(user, startMockTestBtn));
  }

  // Every section below is independently guarded: this page has
  // several unrelated widgets (target WPM, pass/credits cards,
  // chart, recent tests), and a problem in any one of them should
  // never silently prevent the others from rendering — which is
  // exactly what an unguarded exception earlier in this function
  // used to do, since everything after it is sequential.

  // Onboarding / "Welcome back" must appear as soon as possible after
  // login — checked and shown BEFORE the (slower) dashboard stats
  // fetch below, not after, so there's no perceptible delay between
  // logging in and seeing the welcome slides.
  let onboardingCompleted = false;
  try {
    onboardingCompleted = await initTargetWpm(user.id);
  } catch (err) {
    console.error("initTargetWpm failed:", err);
  }
  maybeShowWelcomeBack(user, onboardingCompleted);

  showAdminLinkIfApplicable(user); // not awaited — doesn't block anything visual
  initAnnouncementTicker("announcementBoard", "dashboard"); // not awaited — independent of everything else on the page
  renderPassCreditsCard(user); // not awaited — independent card, uses the same fetchActivePasses/fetchTotalCredits helpers as the header dropdown (js/auth.js); internally guarded too, see below

  try {
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
    allResults = results; // kept so the Overview period dropdown can re-filter without a second fetch
    renderOverviewChart(currentPeriodDays);
    renderRecentTests(results);
    renderTargetWpmCard(); // re-render the Target WPM card now that the real average is known

    const periodSelect = document.getElementById("overviewPeriodSelect");
    if (periodSelect) {
      periodSelect.addEventListener("change", () => {
        currentPeriodDays = periodSelect.value === "all" ? null : parseInt(periodSelect.value, 10);
        renderOverviewChart(currentPeriodDays);
      });
    }
  } catch (err) {
    console.error("Could not load dashboard stats/chart/recent tests:", err);
  }
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

  // Guarded: previously an unguarded getElementById(...).addEventListener
  // here meant ANY problem reaching this line (a missing element, a
  // preferences-fetch hiccup) threw and aborted the whole awaited
  // initTargetWpm() call in DOMContentLoaded — which silently prevented
  // everything after it (the Active Pass/Credits card, Overview chart,
  // Recent Tests) from ever running too. Isolating it here means a
  // problem with the target button can't take the rest of the
  // dashboard down with it.
  const changeBtn = document.getElementById("changeTargetBtn");
  if (changeBtn) {
    changeBtn.addEventListener("click", () => openTargetModal(false));
  } else {
    console.error("changeTargetBtn not found — Set Target/Change button will not respond.");
  }
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
  // Guarded: this runs at multiple points (on load, after saving a
  // new target), so a missing element here shouldn't be able to
  // throw and take out whatever called it.
  if (!el || !changeBtn || !progressCard) {
    console.error("Target WPM card elements missing — skipping render.");
    return;
  }

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
  // Display-only — the stored full_name in Supabase is never
  // touched, only the greeting shows a shortened version of it.
  const fullName = user.user_metadata && user.user_metadata.full_name;
  const firstName = fullName ? fullName.trim().split(/\s+/)[0] : null;

  const el = document.getElementById("welcomeName");
  if (el) el.textContent = firstName || "there"; // graceful fallback if no name is set at all
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

  // "Last Test" is no longer shown as its own tile (replaced in the
  // grid by the Active Pass/Credits card), but the element is guarded
  // rather than removed outright — harmless if a future layout brings
  // it back, and this line can't silently throw if it doesn't exist.
  const lastTestEl = document.getElementById("statLastTest");
  if (lastTestEl) {
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

  return avgWpm; // read by DOMContentLoaded into currentAvgWpm, for the Target WPM card's Actual-vs-Target comparison
}

/* ---------------- Overview chart: combined WPM + Accuracy ----------------
   Same underlying data/calculation as before (net_wpm, accuracy,
   created_at from mock_test_results) — now drawn as ONE chart with
   two datasets on dual Y axes (WPM left, Accuracy % right), plus a
   period filter (Last 7 Days / Last 30 Days / All Time) that
   re-slices the already-fetched results client-side, no new fetch. */

let allResults = [];
let currentPeriodDays = 7;
let overviewChartInstance = null;

function renderOverviewChart(periodDays) {
  const note = document.getElementById("overviewChartNote");
  const emptyEl = document.getElementById("overviewChartEmpty");
  const canvas = document.getElementById("overviewChart");
  if (note) note.style.display = "none";

  const now = new Date();
  const filtered = periodDays
    ? allResults.filter(r => (now - new Date(r.created_at)) <= periodDays * 24 * 60 * 60 * 1000)
    : allResults;

  if (overviewChartInstance) {
    overviewChartInstance.destroy();
    overviewChartInstance = null;
  }

  if (filtered.length === 0) {
    canvas.style.display = "none";
    if (emptyEl) emptyEl.style.display = "block";
    return;
  }
  canvas.style.display = "block";
  if (emptyEl) emptyEl.style.display = "none";

  const chronological = filtered.slice().reverse();
  const labels = chronological.map(r => {
    const d = new Date(r.created_at);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  });
  const wpmValues = chronological.map(r => r.net_wpm);
  const accuracyValues = chronological.map(r => r.accuracy);

  // Only one real result exists — show that single point clearly
  // (not a fabricated trend line) and let the student know a trend
  // will appear once they have more.
  const isSingleResult = filtered.length === 1;
  if (isSingleResult && note) note.style.display = "block";

  const tickFont = { size: 10 };

  // Guarded: a slow/blocked Chart.js CDN load shouldn't take the
  // rest of the dashboard (Recent Tests, Target card) down with it.
  try {
    overviewChartInstance = buildOverviewChart(canvas, labels, wpmValues, accuracyValues, isSingleResult, tickFont);
  } catch (err) {
    console.error("Could not render Overview chart:", err);
    canvas.style.display = "none";
    if (emptyEl) { emptyEl.textContent = "Could not load the chart. Please refresh the page."; emptyEl.style.display = "block"; }
  }
}

function buildOverviewChart(canvas, labels, wpmValues, accuracyValues, isSingleResult, tickFont) {
  return new Chart(canvas, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Avg. WPM",
          data: wpmValues,
          borderColor: "#2F5FEC",
          backgroundColor: "rgba(47,95,236,0.10)",
          tension: 0.3,
          fill: true,
          pointRadius: isSingleResult ? 5 : 3,
          yAxisID: "yWpm"
        },
        {
          label: "Avg. Accuracy",
          data: accuracyValues,
          borderColor: "#159A48",
          backgroundColor: "rgba(21,154,72,0.08)",
          tension: 0.3,
          fill: true,
          pointRadius: isSingleResult ? 5 : 3,
          yAxisID: "yAccuracy"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false } }, // legend is drawn in HTML above the chart, matching the reference design
      scales: {
        yWpm: { type: "linear", position: "left", beginAtZero: true, ticks: { font: tickFont } },
        yAccuracy: { type: "linear", position: "right", beginAtZero: true, max: 100, grid: { drawOnChartArea: false }, ticks: { font: tickFont } },
        x: { ticks: { font: tickFont } }
      }
    }
  });
}

/* ---------------- Recent Tests table ----------------
   Reuses the SAME results array already fetched for the stats/chart
   above (mock_test_results) — no second query. Shows the 5 most
   recent (results is already ordered newest-first). Field names
   (mock_name, category, net_wpm, accuracy, created_at) match the
   ones mock-history.js already reads from this table. */
function renderRecentTests(results) {
  const body = document.getElementById("recentTestsBody");
  if (!body) return;

  const recent = results.slice(0, 5);
  if (recent.length === 0) {
    body.innerHTML = '<div class="app-recent-empty">No mock tests completed yet. Take your first one from Start Test.</div>';
    return;
  }

  const rowsHtml = recent.map(r => {
    const dateStr = new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const categoryRaw = (r.category || "-").toString();
    const categoryLabel = categoryRaw.toUpperCase() === "SSC" ? "SSC" : (categoryRaw.toUpperCase() === "LEGAL" ? "Legal" : (categoryRaw.toUpperCase() === "COMBO" ? "Combo" : categoryRaw));
    const pillClass = categoryRaw.toLowerCase();
    // data-href + delegated click below, rather than nesting an <a>
    // inside the row — a <tr> can't validly contain one spanning
    // multiple <td>s. There's no per-result detail page in this
    // project, so this links to the full Mock History list (the
    // closest real destination) rather than a fabricated one.
    return `
      <tr class="app-recent-row" data-href="mock-history.html" tabindex="0" role="link" aria-label="View ${escapeHtmlDash(r.mock_name || 'test')} in Mock History">
        <td class="app-test-name">${escapeHtmlDash(r.mock_name || "-")}</td>
        <td><span class="app-type-pill ${pillClass}">${escapeHtmlDash(categoryLabel)}</span></td>
        <td>${r.net_wpm}</td>
        <td class="app-accuracy-cell">${r.accuracy}%</td>
        <td>${dateStr}</td>
        <td class="app-recent-chevron">&#8250;</td>
      </tr>`;
  }).join("");

  body.innerHTML = `
    <div class="app-recent-table-wrap">
    <table class="app-recent-table">
      <thead>
        <tr><th>Test Name</th><th>Type</th><th>WPM</th><th>Accuracy</th><th>Date</th><th></th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    </div>`;

  // Event delegation, attached once per render — handles both click
  // and keyboard (Enter/Space) activation for the tabindex/role=link
  // rows above.
  body.querySelectorAll(".app-recent-row").forEach(row => {
    row.addEventListener("click", () => { window.location.href = row.dataset.href; });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        window.location.href = row.dataset.href;
      }
    });
  });
}

/* ---------------- Active Pass + Remaining Credits card ----------------
   Reuses fetchActivePasses()/fetchTotalCredits() from js/auth.js —
   the SAME functions that already power the header dropdown and
   mobile sidebar, so pass/credit status is computed in exactly one
   place. The only new query here is the credits expiry lookup below
   (same wallet_credits table/columns fetchTotalCredits already
   reads, just also keeping expires_at to show "days left").

   Content is deliberately trimmed to the same "icon + big value +
   one label line" shape as the other three stat tiles (Tests
   Completed / Avg WPM / Avg Accuracy) — same markup classes
   (dash-stat-icon / dash-stat-text / big / lab), not a parallel set
   of classes — so all 5 cards are guaranteed identical sizing, not
   just visually similar. Full pass/credit detail (exact valid-till
   date, etc.) is still one click away on Pass & Credits; this card
   is a glance, like its neighbors. */
async function renderPassCreditsCard(user) {
  const passBlock = document.getElementById("passBlock");
  const creditsBlock = document.getElementById("creditsBlock");
  if (!passBlock && !creditsBlock) return;

  try {
    await renderPassCreditsCardInner(user, passBlock, creditsBlock);
  } catch (err) {
    console.error("renderPassCreditsCard failed:", err);
    if (passBlock) passBlock.innerHTML = statTileHtml("dash-tile-green", passCreditsIcon("pass"), "—", "Could not load");
    if (creditsBlock) creditsBlock.innerHTML = statTileHtml("dash-tile-purple", passCreditsIcon("credits"), "—", "Could not load");
  }
}

// Same icon + big-value + label structure as the plain stat tiles
// (see the Tests Completed / Avg WPM / Avg Accuracy markup in
// dashboard.html) — built as a helper here so Active Pass and
// Remaining Credits can never drift from that shape.
function statTileHtml(tileClass, iconSvg, bigHtml, labHtml) {
  return '<div class="dash-stat-icon ' + tileClass + '">' + iconSvg + '</div>' +
    '<div class="dash-stat-text"><div class="big">' + bigHtml + '</div><div class="lab">' + labHtml + '</div></div>';
}

async function renderPassCreditsCardInner(user, passBlock, creditsBlock) {
  // Promise.allSettled instead of Promise.all: previously, if ANY one
  // of these three fetches rejected (a network blip, an RLS/schema
  // surprise on wallet_credits, etc.), the whole Promise.all rejected
  // and BOTH blocks were left permanently blank — the entire card
  // just silently never rendered. Handling each result independently
  // means one failing fetch degrades gracefully instead of blanking
  // out data that successfully loaded.
  const [passResult, creditsResult, expiryResult] = await Promise.allSettled([
    fetchActivePasses(user.id),
    fetchTotalCredits(user.id),
    fetchNearestCreditExpiry(user.id)
  ]);

  if (passResult.status === "rejected") console.error("Could not load active pass:", passResult.reason);
  if (creditsResult.status === "rejected") console.error("Could not load credits total:", creditsResult.reason);
  if (expiryResult.status === "rejected") console.error("Could not load credits expiry:", expiryResult.reason);

  const activePasses = passResult.status === "fulfilled" ? passResult.value : [];
  const creditsTotal = creditsResult.status === "fulfilled" ? creditsResult.value : "—";
  const creditsExpiry = expiryResult.status === "fulfilled" ? expiryResult.value : null;

  if (passBlock) {
    if (passResult.status === "rejected") {
      passBlock.innerHTML = statTileHtml("dash-tile-green", passCreditsIcon("pass"), "—", "Could not load");
    } else if (activePasses.length === 0) {
      stopPlanNameTypewriter(); // in case a previous render had one running (e.g. after a purchase refresh) — req #17, never leave a stray timer
      passBlock.innerHTML = statTileHtml("dash-tile-green", passCreditsIcon("pass"), "No Pass", '<a class="dash-change-link" href="subscriptions.html">Get a pass</a>');
    } else {
      // Icon/container built ONCE via statTileHtml — only
      // #dashPlanName and #dashPlanDaysLeft ever get touched again
      // after this, whether by the static single-pass path below or
      // the typewriter rotation. The icon, card, and "days left"
      // label position never re-render.
      passBlock.innerHTML = statTileHtml(
        "dash-tile-green",
        passCreditsIcon("pass"),
        '<span id="dashPlanName"></span>',
        '<span id="dashPlanDaysLeft"></span>'
      );
      const nameEl = document.getElementById("dashPlanName");
      const daysEl = document.getElementById("dashPlanDaysLeft");

      if (activePasses.length === 1) {
        stopPlanNameTypewriter(); // only one plan — no rotation, per requirement #7
        const p = activePasses[0];
        nameEl.textContent = p.label;
        daysEl.textContent = formatDaysLeft(p.expiresAt);
        const expiresText = new Date(p.expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        passBlock.title = p.label + " — valid till " + expiresText;
      } else {
        startPlanNameTypewriter(activePasses, nameEl, daysEl, passBlock);
      }
    }
  }

  if (creditsBlock) {
    const creditsValidity = creditsExpiry
      ? Math.max(0, Math.ceil((new Date(creditsExpiry) - new Date()) / (24 * 60 * 60 * 1000))) + " days left"
      : null;
    if (creditsValidity) creditsBlock.title = "Validity: " + creditsValidity;
    creditsBlock.innerHTML = statTileHtml("dash-tile-purple", passCreditsIcon("credits"), escapeHtmlDash(String(creditsTotal)), "Credits Left");
  }
}

// Same table/columns as fetchTotalCredits() in js/auth.js — this
// just also keeps expires_at so the card can show a "days left"
// pill for credits, which fetchTotalCredits's plain-number return
// doesn't carry. Read-only, same RLS, no new table.
async function fetchNearestCreditExpiry(userId) {
  const { data, error } = await supabaseClient
    .from("wallet_credits")
    .select("credits_remaining, expires_at")
    .eq("user_id", userId);

  if (error || !data) return null;

  const now = new Date();
  const live = data.filter(row => row.credits_remaining > 0 && new Date(row.expires_at) > now);
  if (live.length === 0) return null;

  return live.reduce((earliest, row) =>
    (!earliest || new Date(row.expires_at) < new Date(earliest)) ? row.expires_at : earliest, null);
}

function passCreditsIcon(kind) {
  if (kind === "credits") {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M12 3a9 9 0 1 0 9 9"/><path d="M21 3v6h-6"/></svg>';
}

function escapeHtmlDash(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ============================================================
   "Start a Mock Test" auto-selection
   ------------------------------------------------------------
   Finds ONE eligible mock the student has never attempted and
   goes straight there, instead of just linking to the category
   picker. Selection order, matching the stated access priority
   (eligible Pass, then Credit, then "pick an unattempted one"):
     1. Free mocks (always eligible) — never make the student
        spend anything they didn't have to.
     2. Mocks covered by an active eligible Pass for that
        category (SSC/LEGAL pass covers its own category, COMBO
        covers both).
     3. Mocks already claimed by a credit before but not yet
        completed — resuming this doesn't spend a NEW credit.
     4. Mocks a fresh credit could unlock (balance > 0).
   Every candidate is filtered against mock_test_results first —
   completed mocks are never in the pool at all, so this can
   never re-select something the student already attempted. The
   actual credit spend, same as everywhere else in the app, only
   happens if/when the student presses Start on the attempt page
   itself — this only navigates there.
   ============================================================ */
async function handleStartMockTestClick(user, btn) {
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = "Finding your next test...";

  try {
    const { data: mocks, error: mocksError } = await supabaseClient
      .from("mock_tests")
      .select("id, category, access_type, display_order")
      .eq("active", true)
      .order("display_order", { ascending: true });

    if (mocksError || !mocks || mocks.length === 0) {
      window.location.href = "mock-test.html";
      return;
    }
    // Group by category (SSC before Legal) on top of the
    // display_order already applied above — avoids chaining a
    // second .order() call for a two-column sort.
    mocks.sort((a, b) => (a.category === b.category ? 0 : a.category === "ssc" ? -1 : 1));

    const { data: results } = await supabaseClient
      .from("mock_test_results")
      .select("mock_test_id")
      .eq("user_id", user.id);
    const completedIds = new Set((results || []).map(r => r.mock_test_id));

    const available = mocks.filter(m => !completedIds.has(m.id));

    if (available.length === 0) {
      showAllMocksCompletedMessage(btn, originalHtml);
      return;
    }

    // Active pass categories — same "status != cancelled AND
    // starts_at <= now AND expires_at > now" rule used everywhere
    // else this is checked (fetchActivePasses in auth.js,
    // loadActivePassTypes in subscriptions.js).
    const { data: passRows } = await supabaseClient
      .from("user_passes")
      .select("pass_type, status, starts_at, expires_at")
      .eq("user_id", user.id);
    const now = new Date();
    const activePassTypes = new Set(
      (passRows || [])
        .filter(p => p.status !== "cancelled" && new Date(p.starts_at) <= now && new Date(p.expires_at) > now)
        .map(p => p.pass_type)
    );
    const passCoversCategory = (category) => {
      const wanted = category === "ssc" ? "SSC" : "LEGAL";
      return activePassTypes.has(wanted) || activePassTypes.has("COMBO");
    };

    const nonFreeCandidates = available.filter(m => m.access_type !== "free" && !passCoversCategory(m.category));
    let unlockedIds = new Set();
    if (nonFreeCandidates.length > 0) {
      const { data: unlocks } = await supabaseClient
        .from("mock_unlocks")
        .select("mock_test_id")
        .eq("user_id", user.id)
        .in("mock_test_id", nonFreeCandidates.map(m => m.id));
      unlockedIds = new Set((unlocks || []).map(u => u.mock_test_id));
    }
    const creditBalance = await fetchTotalCredits(user.id);
    const hasSpendableCredit = typeof creditBalance === "number" && creditBalance > 0;

    const free = available.find(m => m.access_type === "free");
    if (free) { window.location.href = "mock-test-attempt.html?id=" + encodeURIComponent(free.id); return; }

    const passCovered = available.find(m => m.access_type !== "free" && passCoversCategory(m.category));
    if (passCovered) { window.location.href = "mock-test-attempt.html?id=" + encodeURIComponent(passCovered.id); return; }

    const resumable = available.find(m => m.access_type !== "free" && !passCoversCategory(m.category) && unlockedIds.has(m.id));
    if (resumable) { window.location.href = "mock-test-attempt.html?id=" + encodeURIComponent(resumable.id); return; }

    if (hasSpendableCredit) {
      const creditEligible = available.find(m => m.access_type !== "free" && !passCoversCategory(m.category) && !unlockedIds.has(m.id));
      if (creditEligible) { window.location.href = "mock-test-attempt.html?id=" + encodeURIComponent(creditEligible.id); return; }
    }

    // Unattempted mocks exist, but none are currently accessible
    // (no pass, no credits) — send the student to buy access rather
    // than claiming "all completed", which would be inaccurate.
    window.location.href = "subscriptions.html";
  } catch (err) {
    console.error("handleStartMockTestClick failed:", err);
    window.location.href = "mock-test.html"; // safe fallback — never leaves the button stuck
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

function showAllMocksCompletedMessage(btn, originalHtml) {
  btn.disabled = false;
  btn.innerHTML = originalHtml;
  const existing = document.getElementById("allMocksCompletedNote");
  if (existing) existing.remove();

  const note = document.createElement("div");
  note.id = "allMocksCompletedNote";
  note.className = "dash-all-completed-note";
  note.innerHTML =
    "You&#8217;ve completed all available mock tests. " +
    '<a href="subscriptions.html">Check Pass &amp; Credits</a> for more, or ' +
    '<a href="mock-history.html">view your results</a>.';
  btn.insertAdjacentElement("afterend", note);
}

// Never "0 Days Left" or a negative number — compares CALENDAR days
// (midnight to midnight), not raw 24-hour windows, so a pass
// expiring later today reads as "Expires Today" rather than a
// misleading "1 Day Left" or the explicitly-forbidden "0 Days Left".
function formatDaysLeft(expiresAt) {
  const now = new Date();
  const expiry = new Date(expiresAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfExpiryDay = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  const dayDiff = Math.round((startOfExpiryDay - startOfToday) / (24 * 60 * 60 * 1000));

  if (dayDiff <= 0) return "Expires Today";
  if (dayDiff === 1) return "1 Day Left";
  return dayDiff + " Days Left";
}

/* ============================================================
   Dashboard Active Pass card — plan name typewriter rotation
   ------------------------------------------------------------
   Only ever touches #dashPlanName's text (character by character)
   and, once per full cycle, #dashPlanDaysLeft's text (instantly,
   no animation) — the icon, card, and everything else built by
   statTileHtml() above is never re-rendered by this. Runs only
   when there are 2+ active passes; a single pass or no pass never
   reaches this code (see renderPassCreditsCardInner above).

   One module-level controller, stopped and replaced (never
   stacked) every time this is (re)started — this is the single
   thing requirement #17 is about: without it, calling
   renderPassCreditsCard() a second time (e.g. after a purchase
   refreshes the page's data) would leave the OLD interval still
   running alongside a new one, corrupting the text with two
   simultaneous typers.
   ============================================================ */
let planNameTypewriterController = null;

function stopPlanNameTypewriter() {
  if (planNameTypewriterController) {
    planNameTypewriterController.stopped = true;
    clearTimeout(planNameTypewriterController.timeoutId);
    planNameTypewriterController = null;
  }
}

function startPlanNameTypewriter(activePasses, nameEl, daysEl, passBlock) {
  stopPlanNameTypewriter(); // exactly one controller ever runs — see comment above

  const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const controller = { stopped: false, timeoutId: null };
  planNameTypewriterController = controller;

  const showPlan = (pass) => {
    nameEl.textContent = pass.label;
    daysEl.textContent = formatDaysLeft(pass.expiresAt); // updates cleanly, never animated — requirement #5
    const expiresText = new Date(pass.expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    passBlock.title = pass.label + " — valid till " + expiresText;
  };

  if (prefersReducedMotion) {
    // Requirement #18: show the first active plan normally, no
    // repeated changes, no timers started at all.
    showPlan(activePasses[0]);
    return;
  }

  let index = 0;

  // Filters out any pass whose real expiry has passed since the
  // page loaded (requirement #15) — checked fresh against the
  // current time at every step, not just once at start, so this
  // stays correct even if the dashboard is left open for hours.
  const stillActive = (list) => list.filter(p => new Date(p.expiresAt) > new Date());

  function schedule(fn, delay) {
    if (controller.stopped) return;
    controller.timeoutId = setTimeout(() => { if (!controller.stopped) fn(); }, delay);
  }

  function cycle() {
    if (controller.stopped) return;

    const live = stillActive(activePasses);
    if (live.length === 0) {
      // Every pass expired mid-session — fall back to the existing
      // no-active-plan state rather than animating something stale.
      stopPlanNameTypewriter();
      passBlock.innerHTML = statTileHtml("dash-tile-green", passCreditsIcon("pass"), "No Pass", '<a class="dash-change-link" href="subscriptions.html">Get a pass</a>');
      return;
    }
    if (live.length === 1) {
      // Down to one live pass — stop rotating, show it plainly.
      stopPlanNameTypewriter();
      showPlan(live[0]);
      return;
    }

    index = index % live.length;
    const current = live[index];
    const next = live[(index + 1) % live.length];

    nameEl.textContent = current.label;
    daysEl.textContent = formatDaysLeft(current.expiresAt);
    hideCursor(nameEl); // full name, sitting still — no cursor during this pause (requirement #11)

    schedule(() => { showCursor(nameEl); backspace(current.label.length, next); }, 3000 + Math.random() * 1000); // pause 3–4s, requirement #3
  }

  function backspace(remainingChars, next) {
    if (controller.stopped) return;
    if (remainingChars <= 0) {
      schedule(() => typeNext(next, 0), 200 + Math.random() * 200); // brief pause at empty, requirement #13 step 4 — cursor stays visible, this is motion mid-transition, not the paused-between-plans state
      return;
    }
    nameEl.textContent = nameEl.textContent.slice(0, -1);
    schedule(() => backspace(remainingChars - 1, next), 45 + Math.random() * 30); // 45–75ms/char, requirement #2
  }

  function typeNext(next, charsTyped) {
    if (controller.stopped) return;
    if (charsTyped >= next.label.length) {
      index = (index + 1) % activePasses.length;
      schedule(cycle, 0); // full name shown — cycle() re-derives the live list, hides the cursor, and re-pauses before the next backspace
      return;
    }
    nameEl.textContent = next.label.slice(0, charsTyped + 1);
    schedule(() => typeNext(next, charsTyped + 1), 65 + Math.random() * 45); // 65–110ms/char, requirement #2
  }

  cycle();
}

// Subtle blinking cursor, only ever a sibling text node next to the
// plan name — never affects layout width, and disappears entirely
// (not just stops blinking) whenever the animation is paused,
// per requirement #11.
function showCursor(nameEl) {
  hideCursor(nameEl);
  const cursor = document.createElement("span");
  cursor.className = "typewriter-cursor";
  nameEl.insertAdjacentElement("afterend", cursor);
}
function hideCursor(nameEl) {
  const existing = nameEl.parentElement && nameEl.parentElement.querySelector(".typewriter-cursor");
  if (existing) existing.remove();
}
