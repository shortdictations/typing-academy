/* ============================================================
   typing.js
   ------------------------------------------------------------
   Runs the typing test screen as an SSC / Court exam style test:
   - passages loaded live from Supabase (unchanged from before)
   - current-word and wrong-word highlighting
   - paste disabled, right-click disabled
   - full-screen mode during the test
   - countdown timer with auto-submit
   - "leaving the page" warning while a test is active
   - Gross WPM, Net WPM, Accuracy, word-level stats
   - detailed result page, all metrics saved to Supabase
   ============================================================ */

let currentUser = null;

// Test configuration chosen on the setup screen
let selectedCategory = "SSC";
let selectedDuration = 5;     // minutes
let selectedPassage = null;   // the passage row fetched from Supabase

// Passages currently loaded for the chosen category + duration
let loadedPassages = [];

// Live test state
let testTimer = null;
let secondsLeft = 0;
let testStartTime = null;
let testActive = false;       // true once the timer is running
let testScreenOpen = false;   // true from the moment the test screen is shown
let passageChars = [];        // array of single characters from the passage text
let wordRanges = [];          // [{start, end, text}] word boundaries within passageChars

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireLogin();
  if (!currentUser) return;

  buildCategoryChoices();
  buildDurationChoices();
  await refreshPassageOptions();

  document.getElementById("startBtn").addEventListener("click", startTest);
  document.getElementById("retryBtn").addEventListener("click", resetToSetup);

  const input = document.getElementById("typeInput");
  input.addEventListener("input", onTypingInput);

  // Requirement 3: disable paste into the typing box
  input.addEventListener("paste", e => e.preventDefault());
  input.addEventListener("drop", e => e.preventDefault()); // also block drag-and-drop text

  // Requirement 4: disable right-click during the test (on the passage + typing area)
  document.getElementById("testCard").addEventListener("contextmenu", e => e.preventDefault());

  // Requirement 5: keep the caret in the typing box during an active test
  input.addEventListener("blur", () => {
    // small delay so this doesn't fight the browser's own focus handling
    // (e.g. when the test ends and we intentionally disable the box)
    setTimeout(refocusTypingInput, 0);
  });
  document.getElementById("passageBox").addEventListener("click", refocusTypingInput);
  document.getElementById("testCard").addEventListener("click", refocusTypingInput);

  // Detect the student leaving full-screen mid-test (Esc, etc.) and end the test,
  // same as an invigilated exam would.
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
});

/* ---------------- Setup screen ---------------- */

function buildCategoryChoices() {
  const wrap = document.getElementById("categoryChoices");
  const categories = ["SSC", "Stenographer"];
  wrap.innerHTML = "";
  categories.forEach(cat => {
    const btn = document.createElement("div");
    btn.className = "choice" + (cat === selectedCategory ? " selected" : "");
    btn.textContent = cat;
    btn.addEventListener("click", async () => {
      selectedCategory = cat;
      buildCategoryChoices();
      await refreshPassageOptions();
    });
    wrap.appendChild(btn);
  });
}

function buildDurationChoices() {
  const wrap = document.getElementById("durationChoices");
  const durations = [5, 10];
  wrap.innerHTML = "";
  durations.forEach(min => {
    const btn = document.createElement("div");
    btn.className = "choice" + (min === selectedDuration ? " selected" : "");
    btn.textContent = min + " minutes";
    btn.addEventListener("click", async () => {
      selectedDuration = min;
      buildDurationChoices();
      await refreshPassageOptions();
    });
    wrap.appendChild(btn);
  });
}

async function refreshPassageOptions() {
  const select = document.getElementById("passageSelect");
  const startBtn = document.getElementById("startBtn");

  select.innerHTML = '<option>Loading passages...</option>';
  startBtn.disabled = true;

  loadedPassages = await fetchPassages(selectedCategory, selectedDuration);

  select.innerHTML = "";
  if (loadedPassages.length === 0) {
    select.innerHTML = '<option>No passages available for this selection</option>';
    startBtn.disabled = true;
    return;
  }

  loadedPassages.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.title + (p.difficulty ? " (" + p.difficulty + ")" : "");
    select.appendChild(opt);
  });
  startBtn.disabled = false;
}

/* ---------------- Starting a test ---------------- */

function startTest() {
  const passageId = document.getElementById("passageSelect").value;
  selectedPassage = loadedPassages.find(p => p.id === passageId);
  if (!selectedPassage) return;

  passageChars = selectedPassage.content.split("");
  wordRanges = computeWordRanges(selectedPassage.content);

  // Swap screens
  document.getElementById("setupCard").style.display = "none";
  document.getElementById("resultCard").style.display = "none";
  document.getElementById("testCard").style.display = "block";
  hideWarningBanner();

  document.getElementById("testPassageTitle").textContent =
    selectedPassage.title + " · " + selectedCategory + " · " + selectedDuration + " min test";

  renderPassage();

  const input = document.getElementById("typeInput");
  input.value = "";
  input.disabled = false;
  input.focus();

  secondsLeft = selectedDuration * 60;
  updateTimerDisplay();
  updateLiveStats(0, 100);

  testActive = false; // becomes true on first keystroke (timer starts then)
  testScreenOpen = true;
  testStartTime = null;

  if (testTimer) clearInterval(testTimer);

  // Requirement 5: full-screen exam mode
  enterFullscreen();

  // Requirement 8: warn before refresh/close while the test screen is open
  window.addEventListener("beforeunload", beforeUnloadHandler);
}

function computeWordRanges(text) {
  const ranges = [];
  const regex = /\S+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  return ranges;
}

function renderPassage() {
  const box = document.getElementById("passageBox");
  box.innerHTML = "";
  passageChars.forEach((ch, i) => {
    const span = document.createElement("span");
    span.className = "char";
    span.textContent = ch;
    span.id = "ch-" + i;
    box.appendChild(span);
  });
  if (passageChars.length > 0) {
    document.getElementById("ch-0").classList.add("current");
  }
}

/* ---------------- Full-screen handling ---------------- */

function enterFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (!req) return; // browser doesn't support it — test still works normally
  try {
    req.call(el).catch(() => { /* user or browser blocked it — continue anyway */ });
  } catch (err) {
    // Some browsers throw synchronously instead of rejecting a promise
  }
}

function exitFullscreen() {
  const isFs = document.fullscreenElement || document.webkitFullscreenElement;
  if (!isFs) return;
  const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (exit) {
    try { exit.call(document); } catch (err) { /* ignore */ }
  }
}

function handleFullscreenChange() {
  const isFs = document.fullscreenElement || document.webkitFullscreenElement;
  if (!isFs && testActive) {
    showWarningBanner("Test ended early — full-screen mode was exited.");
    endTest("fullscreen_exit");
  }
}

/* ---------------- Live typing ---------------- */

function onTypingInput(e) {
  if (!testActive) {
    testActive = true;
    testStartTime = Date.now();
    testTimer = setInterval(tickTimer, 1000);
  }

  const typed = e.target.value;
  let correct = 0;

  for (let i = 0; i < passageChars.length; i++) {
    const span = document.getElementById("ch-" + i);
    span.classList.remove("correct", "wrong", "current");

    if (i < typed.length) {
      if (typed[i] === passageChars[i]) {
        span.classList.add("correct");
        correct++;
      } else {
        span.classList.add("wrong");
      }
    } else if (i === typed.length) {
      span.classList.add("current");
    }
  }

  // Requirement 1, 2 & 3: current word + correct/wrong word highlighting
  applyWordHighlighting(typed);

  // Requirement 4: keep the current line visible as the passage scrolls
  scrollCurrentLineIntoView(typed);

  const accuracy = typed.length > 0 ? Math.round((correct / typed.length) * 100) : 100;
  const minutesElapsed = testStartTime ? (Date.now() - testStartTime) / 60000 : 0;
  const wpm = minutesElapsed > 0 ? Math.round((correct / 5) / minutesElapsed) : 0;
  updateLiveStats(wpm, accuracy);

  // Finished the whole passage correctly and completely -> end early
  if (typed.length >= passageChars.length) {
    endTest("completed");
  }
}

// Highlights the word currently being typed (Requirement 1), marks
// completed words green when correct (Requirement 2) or red when
// wrong (Requirement 3).
function applyWordHighlighting(typed) {
  const cursorPos = typed.length;

  wordRanges.forEach(w => {
    for (let i = w.start; i < w.end; i++) {
      const span = document.getElementById("ch-" + i);
      if (!span) continue;
      span.classList.remove("word-current", "word-correct", "word-wrong");

      if (w.end <= cursorPos) {
        const typedWord = typed.substring(w.start, w.end);
        span.classList.add(typedWord === w.text ? "word-correct" : "word-wrong");
      } else if (cursorPos >= w.start && cursorPos <= w.end) {
        span.classList.add("word-current");
      }
    }
  });
}

// Requirement 4: auto-scroll the passage box so the line the
// student is currently typing stays visible, without needing to
// scroll manually.
function scrollCurrentLineIntoView(typed) {
  const box = document.getElementById("passageBox");
  if (!box) return;
  const idx = Math.min(typed.length, passageChars.length - 1);
  const span = document.getElementById("ch-" + idx);
  if (span) {
    span.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

// Requirement 5: make sure the caret stays in the typing box while
// a test is running, even if a stray click lands on the (unselectable)
// passage text instead of the textarea.
function refocusTypingInput() {
  const input = document.getElementById("typeInput");
  if (input && !input.disabled && testScreenOpen) {
    input.focus();
  }
}

// Compares the final typed text against the passage word-by-word.
// Only counts words that were fully typed (matches how SSC/Court
// tests score completed words, ignoring an unfinished trailing word).
function computeWordStats(typed) {
  let correctWords = 0, wrongWords = 0, totalWords = 0;
  wordRanges.forEach(w => {
    if (w.end <= typed.length) {
      totalWords++;
      const typedWord = typed.substring(w.start, w.end);
      if (typedWord === w.text) correctWords++; else wrongWords++;
    }
  });
  return { correctWords, wrongWords, totalWords };
}

function tickTimer() {
  secondsLeft--;
  updateTimerDisplay();
  if (secondsLeft <= 0) {
    endTest("time_up"); // Requirement 7: auto-submit when time ends
  }
}

function updateTimerDisplay() {
  const m = Math.floor(secondsLeft / 60).toString().padStart(2, "0");
  const s = (secondsLeft % 60).toString().padStart(2, "0");
  document.getElementById("timerBox").textContent = m + ":" + s;
}

function updateLiveStats(wpm, accuracy) {
  document.getElementById("liveWpm").textContent = wpm;
  document.getElementById("liveAccuracy").textContent = accuracy + "%";
}

/* ---------------- Warning banner ---------------- */

function showWarningBanner(text) {
  const el = document.getElementById("testWarningBanner");
  if (!el) return;
  el.textContent = text;
  el.style.display = "block";
}
function hideWarningBanner() {
  const el = document.getElementById("testWarningBanner");
  if (el) el.style.display = "none";
}

/* ---------------- Refresh / close warning ---------------- */

function beforeUnloadHandler(e) {
  e.preventDefault();
  e.returnValue = ""; // required for the browser's native confirm dialog to show
  return "";
}

/* ---------------- Ending a test ---------------- */

async function endTest(reason) {
  // Stop everything first so fullscreenchange / timer can't re-trigger this
  if (testTimer) clearInterval(testTimer);
  testActive = false;
  testScreenOpen = false;
  window.removeEventListener("beforeunload", beforeUnloadHandler);

  const input = document.getElementById("typeInput");
  input.disabled = true;

  const typed = input.value;
  let correct = 0;
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] === passageChars[i]) correct++;
  }

  const totalTypedChars = typed.length;
  const accuracy = totalTypedChars > 0 ? Math.round((correct / totalTypedChars) * 100) : 0;
  const wordStats = computeWordStats(typed);

  // If the test ended because time ran out, use the FULL selected
  // duration for WPM. If the student finished early or the test was
  // cut short (fullscreen exit), use actual elapsed time.
  const elapsedMinutes = testStartTime
    ? (Date.now() - testStartTime) / 60000
    : selectedDuration;
  const minutesForWpm = reason === "time_up" ? selectedDuration : Math.max(elapsedMinutes, 0.05);

  // Requirement 9 & 10: Gross WPM (all typed chars) vs Net WPM (correct chars only)
  const grossWpm = Math.round((totalTypedChars / 5) / minutesForWpm);
  const netWpm = Math.round((correct / 5) / minutesForWpm);

  exitFullscreen();

  showResultTicket({
    grossWpm, netWpm, accuracy,
    totalTypedChars, correct,
    correctWords: wordStats.correctWords,
    wrongWords: wordStats.wrongWords,
    totalWords: wordStats.totalWords,
    reason
  });

  await saveResult({
    grossWpm, netWpm, accuracy,
    totalTypedChars, correct,
    correctWords: wordStats.correctWords,
    wrongWords: wordStats.wrongWords,
    totalWords: wordStats.totalWords
  });
}

function gradeFor(netWpm, accuracy) {
  if (accuracy < 80) return "RETRY";
  if (netWpm >= 45) return "A+";
  if (netWpm >= 35) return "A";
  if (netWpm >= 25) return "B";
  return "C";
}

// Requirement 12: detailed result page
function showResultTicket(r) {
  document.getElementById("testCard").style.display = "none";
  document.getElementById("resultCard").style.display = "block";

  document.getElementById("resultGrossWpm").textContent = r.grossWpm;
  document.getElementById("resultNetWpm").textContent = r.netWpm;
  document.getElementById("resultAccuracy").textContent = r.accuracy + "%";
  document.getElementById("resultDuration").textContent = selectedDuration + " min";
  document.getElementById("resultCorrectWords").textContent = r.correctWords;
  document.getElementById("resultWrongWords").textContent = r.wrongWords;
  document.getElementById("resultTotalWords").textContent = r.totalWords;
  document.getElementById("resultChars").textContent = r.correct + " / " + r.totalTypedChars;
  document.getElementById("resultErrors").textContent = r.totalTypedChars - r.correct;
  document.getElementById("resultDateTime").textContent = new Date().toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
  document.getElementById("resultGrade").textContent = gradeFor(r.netWpm, r.accuracy);
  document.getElementById("resultPassageName").textContent =
    selectedPassage.title + " (" + selectedCategory + ")";

  if (r.reason === "fullscreen_exit") {
    showWarningBanner("This test was submitted early because full-screen mode was exited.");
  }
}

// Requirement 13: save all metrics to Supabase
async function saveResult(r) {
  if (!currentUser) {
    console.warn("No logged-in user — result was not saved.");
    return;
  }

  const errors = r.totalTypedChars - r.correct;

  try {
    await supabaseClient.from("typing_results").insert({
      user_id: currentUser.id,
      passage_title: selectedPassage.title,
      wpm: r.netWpm,          // kept for backward compatibility with the dashboard
      accuracy: r.accuracy,
      errors: errors,
      duration: selectedDuration,
      gross_wpm: r.grossWpm,
      net_wpm: r.netWpm,
      correct_words: r.correctWords,
      wrong_words: r.wrongWords,
      total_words: r.totalWords
    });
  } catch (err) {
    console.error("Could not save result:", err);
  }
}

async function resetToSetup() {
  hideWarningBanner();
  document.getElementById("resultCard").style.display = "none";
  document.getElementById("testCard").style.display = "none";
  document.getElementById("setupCard").style.display = "block";
  await refreshPassageOptions(); // pick up any admin changes since the last test
}
