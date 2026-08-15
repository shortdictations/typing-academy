/* ============================================================
   mock-test-attempt.js
   ------------------------------------------------------------
   Loads ONE specific mock test (?id=...) from the mock_tests
   catalog, auto-loads its assigned passage (the student never
   picks a passage), runs the timed test, and saves the result
   to mock_test_results with the mock's identity attached.
   ============================================================ */

let currentUser = null;
let mockTest = null;      // the mock_tests row
let selectedPassage = null; // the joined passages row

let testTimer = null;
let secondsLeft = 0;
let testStartTime = null;
let testActive = false;
let testScreenOpen = false;
let passageChars = [];
let wordRanges = [];

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireLogin();
  if (!currentUser) return;

  const params = new URLSearchParams(window.location.search);
  const mockId = params.get("id");

  if (!mockId) {
    document.getElementById("setupInfo").textContent = "No mock test was specified.";
    return;
  }

  const { data, error } = await supabaseClient
    .from("mock_tests")
    .select("*, passages(*)")
    .eq("id", mockId)
    .eq("active", true)
    .maybeSingle();

  if (error || !data || !data.passages) {
    document.getElementById("setupInfo").textContent =
      "This mock test could not be loaded. It may be inactive or no longer exist.";
    return;
  }

  mockTest = data;
  selectedPassage = data.passages;

  // Real DB-level access check — reads the same can_access_mock()
  // function used to enforce saving, so a student who reaches this
  // page by guessing/pasting a premium mock's URL is stopped here
  // too, not just left to discover it after finishing the test.
  if (mockTest.access_type === "premium") {
    const { data: allowed, error: accessError } = await supabaseClient.rpc("can_access_mock", { mock_id: mockTest.id });

    if (accessError || !allowed) {
      const categoryLabel = mockTest.category === "ssc" ? "SSC" : "Legal";
      document.getElementById("setupInfo").innerHTML =
        '<div style="font-family:var(--font-display); font-size:1.2rem; font-weight:700; color:var(--stamp);">Premium — ' + categoryLabel + ' Subscription Required</div>' +
        '<div style="color:var(--ink-soft); margin-top:8px; font-size:0.9rem;">You need an active ' + categoryLabel + ' subscription to take this mock test.</div>' +
        '<a class="btn" style="margin-top:14px; display:inline-block;" href="subscriptions.html">View Subscription Plans</a>';
      return; // startBtn is never shown, so the test cannot be started
    }
  }

  // Credit Based Test: read-only check here (never deducts) — if
  // this specific test was already consumed by this student, show
  // that plainly instead of a Start button that would just be
  // rejected. The actual credit spend/consumption only happens
  // inside start_credit_test(), called from handleStartClick below.
  if (mockTest.access_type === "credit") {
    const { data: existingUnlock } = await supabaseClient
      .from("mock_unlocks")
      .select("id")
      .eq("user_id", currentUser.id)
      .eq("mock_test_id", mockTest.id)
      .maybeSingle();

    if (existingUnlock) {
      document.getElementById("setupInfo").innerHTML =
        '<div style="font-family:var(--font-display); font-size:1.2rem; font-weight:700;">&#10003; Completed</div>' +
        '<div style="color:var(--ink-soft); margin-top:8px; font-size:0.9rem;">You have already completed this Credit Based Test. It cannot be retaken.</div>' +
        '<a class="btn" style="margin-top:14px; display:inline-block;" href="mock-history.html">View Result</a>';
      return; // startBtn is never shown
    }
  }

  document.getElementById("setupInfo").innerHTML =
    '<div class="mock-test-title">' + escapeHtml(mockTest.title) + '</div>' +
    '<div class="mock-test-meta">' + mockTest.duration + ' minutes &middot; ' +
    (mockTest.access_type === "credit" ? "1 Credit" : (mockTest.access_type === "premium" ? "Premium" : "Free")) + '</div>' +
    '<div class="mock-test-message">Your passage has already been assigned — it will appear the moment you click start.</div>';

  const startBtn = document.getElementById("startBtn");
  startBtn.style.display = "flex";
  startBtn.addEventListener("click", handleStartClick);

  const input = document.getElementById("typeInput");
  input.addEventListener("input", onTypingInput);
  input.addEventListener("paste", e => e.preventDefault());
  input.addEventListener("drop", e => e.preventDefault());

  // Requirement 2: completely disable Backspace during an active mock
  // test. testScreenOpen is true from the moment the test screen shows
  // until the test ends, so this only ever blocks Backspace while a
  // mock test is actually in progress.
  input.addEventListener("keydown", e => {
    if (testScreenOpen && e.key === "Backspace") {
      e.preventDefault();
    }
  });

  document.getElementById("testCard").addEventListener("contextmenu", e => e.preventDefault());

  input.addEventListener("blur", () => setTimeout(refocusTypingInput, 0));
  document.getElementById("passageBox").addEventListener("click", refocusTypingInput);
  document.getElementById("testCard").addEventListener("click", refocusTypingInput);

  // Requirement 1: full-screen handling
  document.getElementById("fsRetryBtn").addEventListener("click", () => {
    enterFullscreen();
  });
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
});

/* ---------------- Starting the test ---------------- */

// Runs when the student presses "Start Mock Test". For premium
// mocks this is the ONE place a free sample can be consumed —
// the page-load check above (can_access_mock) is read-only and
// only decides whether to show the Start button at all. This
// keeps consumption tied to the moment the student actually
// begins, not to merely viewing the page, and re-verifies access
// atomically in case something changed (e.g. the last free sample
// was used in another tab) between page load and this click.
async function handleStartClick() {
  const startBtn = document.getElementById("startBtn");

  if (mockTest.access_type === "premium") {
    startBtn.disabled = true;
    startBtn.textContent = "Checking access...";

    const { data, error } = await supabaseClient.rpc("start_mock_test", { mock_id: mockTest.id });

    startBtn.disabled = false;
    startBtn.textContent = "Start Mock Test";

    const result = Array.isArray(data) ? data[0] : data;

    if (error || !result || !result.has_access) {
      const categoryLabel = mockTest.category === "ssc" ? "SSC" : "Legal";
      document.getElementById("setupInfo").innerHTML =
        '<div style="font-family:var(--font-display); font-size:1.2rem; font-weight:700; color:var(--stamp);">Premium — ' + categoryLabel + ' Subscription Required</div>' +
        '<div style="color:var(--ink-soft); margin-top:8px; font-size:0.9rem;">You need an active ' + categoryLabel + ' subscription, pass, or a remaining free sample to take this mock test.</div>' +
        '<a class="btn" style="margin-top:14px; display:inline-block;" href="subscriptions.html">View Subscription Plans</a>';
      startBtn.style.display = "none";
      return;
    }
  } else if (mockTest.access_type === "credit") {
    // The ONLY place a credit is ever spent — this call is the real
    // security boundary. Frontend visibility on mock-test.html was
    // never access control; this atomic, server-side check/deduct
    // is what actually decides whether the test may start.
    startBtn.disabled = true;
    startBtn.textContent = "Checking credit balance...";

    const { data, error } = await supabaseClient.rpc("start_credit_test", { mock_id: mockTest.id });

    startBtn.disabled = false;
    startBtn.textContent = "Start Mock Test";

    const result = Array.isArray(data) ? data[0] : data;

    if (error || !result || !result.has_access) {
      document.getElementById("setupInfo").innerHTML =
        '<div style="font-family:var(--font-display); font-size:1.2rem; font-weight:700; color:var(--stamp);">&#128274; No Credits Remaining</div>' +
        '<div style="color:var(--ink-soft); margin-top:8px; font-size:0.9rem;">You need at least 1 credit to take this test.</div>' +
        '<a class="btn" style="margin-top:14px; display:inline-block;" href="subscriptions.html">Buy Credits</a>';
      startBtn.style.display = "none";
      return;
    }

    if (result.access_reason === "ALREADY_COMPLETED") {
      document.getElementById("setupInfo").innerHTML =
        '<div style="font-family:var(--font-display); font-size:1.2rem; font-weight:700;">&#10003; Completed</div>' +
        '<div style="color:var(--ink-soft); margin-top:8px; font-size:0.9rem;">You have already completed this Credit Based Test. It cannot be retaken.</div>' +
        '<a class="btn" style="margin-top:14px; display:inline-block;" href="mock-history.html">View Result</a>';
      startBtn.style.display = "none";
      return;
    }
    // result.access_reason === "CREDIT_USED" — 1 credit was just
    // deducted and this test is now permanently claimed for this
    // student. Proceed to the timed test below.
  }

  startMockTest();
}

function startMockTest() {
  passageChars = selectedPassage.content.split("");
  wordRanges = computeWordRanges(selectedPassage.content);

  document.getElementById("setupCard").style.display = "none";
  document.getElementById("resultCard").style.display = "none";
  document.getElementById("testCard").style.display = "block";
  hideWarningBanner();

  document.getElementById("testPassageTitle").textContent =
    mockTest.title + " · " + mockTest.duration + " min · " + selectedPassage.title;

  renderPassage();

  const input = document.getElementById("typeInput");
  input.value = "";
  input.disabled = false;
  input.focus();

  secondsLeft = mockTest.duration * 60;
  updateTimerDisplay();
  updateLiveStats(0, 100, 0);

  testActive = false;
  testScreenOpen = true;
  testStartTime = null;

  if (testTimer) clearInterval(testTimer);

  window.addEventListener("beforeunload", beforeUnloadHandler);

  // Requirement 1: enter full-screen when the mock test starts
  enterFullscreen();
}

/* ---------------- Full-screen handling ---------------- */

function enterFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;

  if (!req) {
    // Browser doesn't support the Fullscreen API at all — let the
    // student continue normally, just show the manual button in case
    // a later interaction lets them trigger it themselves.
    document.getElementById("fsRetryBtn").style.display = "inline-block";
    return;
  }

  try {
    const result = req.call(el);
    if (result && typeof result.catch === "function") {
      result
        .then(() => { document.getElementById("fsRetryBtn").style.display = "none"; })
        .catch(() => {
          // Automatic full-screen was blocked — show a clear manual button instead.
          document.getElementById("fsRetryBtn").style.display = "inline-block";
        });
    } else {
      document.getElementById("fsRetryBtn").style.display = "none";
    }
  } catch (err) {
    document.getElementById("fsRetryBtn").style.display = "inline-block";
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
  if (isFs) {
    document.getElementById("fsRetryBtn").style.display = "none";
  } else if (testActive) {
    // Student left full-screen mid-test — end the test, same as an
    // invigilated exam would, and explain why on the result page.
    showWarningBanner("This mock test was submitted early because full-screen mode was exited.");
    endMockTest("fullscreen_exit");
  }
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
    span.id = "amch-" + i;
    box.appendChild(span);
  });
  if (passageChars.length > 0) {
    document.getElementById("amch-0").classList.add("current");
  }
}

function refocusTypingInput() {
  const input = document.getElementById("typeInput");
  if (input && !input.disabled && testScreenOpen) input.focus();
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
    const span = document.getElementById("amch-" + i);
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

  applyWordHighlighting(typed);
  scrollCurrentLineIntoView(typed);

  const accuracy = typed.length > 0 ? Math.round((correct / typed.length) * 100) : 100;
  const minutesElapsed = testStartTime ? (Date.now() - testStartTime) / 60000 : 0;
  const wpm = minutesElapsed > 0 ? Math.round((correct / 5) / minutesElapsed) : 0;
  const liveMistakes = computeWordMistakeCount(typed);
  updateLiveStats(wpm, accuracy, liveMistakes);

  if (typed.length >= passageChars.length) {
    endMockTest("completed");
  }
}

function applyWordHighlighting(typed) {
  // Visual word-level decoration removed per redesign — correctness is
  // conveyed purely by each character's own color (.correct/.wrong).
  // word-current only gives the not-yet-typed part of the active word
  // a hair more contrast than future text; no background/box/underline.
  const cursorPos = typed.length;
  wordRanges.forEach(w => {
    for (let i = w.start; i < w.end; i++) {
      const span = document.getElementById("amch-" + i);
      if (!span) continue;
      span.classList.remove("word-current");
      if (cursorPos >= w.start && cursorPos <= w.end) {
        span.classList.add("word-current");
      }
    }
  });
}

// Word-wise mistake count (Requirement: 1+ wrong chars in a word = 1
// mistake, never more). Compares only the portion of each word actually
// typed so far, so it's accurate live (a word can start counting as a
// mistake mid-word, before it's finished) and identical at test end.
function computeWordMistakeCount(typed) {
  let mistakes = 0;
  wordRanges.forEach(w => {
    const typedEnd = Math.min(typed.length, w.end);
    if (typedEnd <= w.start) return; // nothing typed in this word yet
    const typedPortion = typed.substring(w.start, typedEnd);
    const expectedPortion = w.text.substring(0, typedEnd - w.start);
    if (typedPortion !== expectedPortion) mistakes++;
  });
  return mistakes;
}

// Auto-scroll: only moves the passage box's own scroll position when
// the current character is about to leave a comfortable "safe zone"
// (top 20%–75% of the box) — never on every keystroke, never touches
// page scroll, never touches focus. Repositions the line into the
// lower-middle of the box, not jammed against an edge.
function scrollCurrentLineIntoView(typed) {
  const idx = Math.min(typed.length, passageChars.length - 1);
  const span = document.getElementById("amch-" + idx);
  const box = document.getElementById("passageBox");
  if (!span || !box) return;

  const boxRect = box.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  const safeTop = boxRect.top + boxRect.height * 0.20;
  const safeBottom = boxRect.top + boxRect.height * 0.75;

  if (spanRect.top < safeTop || spanRect.bottom > safeBottom) {
    const delta = (spanRect.top - boxRect.top) - (boxRect.height * 0.35);
    box.scrollTo({ top: box.scrollTop + delta, behavior: "smooth" });
  }
}

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
    endMockTest("time_up");
  }
}

function updateTimerDisplay() {
  const m = Math.floor(secondsLeft / 60).toString().padStart(2, "0");
  const s = (secondsLeft % 60).toString().padStart(2, "0");
  document.getElementById("timerBox").textContent = m + ":" + s;
}

function updateLiveStats(wpm, accuracy, mistakes) {
  document.getElementById("liveWpm").textContent = wpm;
  document.getElementById("liveAccuracy").textContent = accuracy + "%";
  const mistakesEl = document.getElementById("liveMistakes");
  if (mistakesEl) mistakesEl.textContent = mistakes;
}

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

function beforeUnloadHandler(e) {
  e.preventDefault();
  e.returnValue = "";
  return "";
}

/* ---------------- Ending the test ---------------- */

async function endMockTest(reason) {
  if (testTimer) clearInterval(testTimer);
  testActive = false;
  testScreenOpen = false;
  window.removeEventListener("beforeunload", beforeUnloadHandler);

  const input = document.getElementById("typeInput");
  input.disabled = true; // Disable typing after time ends / completion

  const typed = input.value;
  let correct = 0;
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] === passageChars[i]) correct++;
  }

  const totalTypedChars = typed.length;
  const accuracy = totalTypedChars > 0 ? Math.round((correct / totalTypedChars) * 100) : 0;
  const wordStats = computeWordStats(typed);
  // "errors"/"Mistakes" now means incorrectly-typed WORDS, not characters.
  // Accuracy above is untouched — it was already character-based and
  // does not depend on this value, per the explicit instruction not to
  // change it unless it directly relied on the old character-error count.
  const errors = computeWordMistakeCount(typed);

  const elapsedMinutes = testStartTime ? (Date.now() - testStartTime) / 60000 : mockTest.duration;
  const minutesForWpm = reason === "time_up" ? mockTest.duration : Math.max(elapsedMinutes, 0.05);

  const grossWpm = Math.round((totalTypedChars / 5) / minutesForWpm);
  const netWpm = Math.round((correct / 5) / minutesForWpm);

  // Requirement 1: exit full-screen once the mock test ends
  exitFullscreen();
  document.getElementById("fsRetryBtn").style.display = "none";

  showResultTicket({ grossWpm, netWpm, accuracy, errors, totalWords: wordStats.totalWords });
  await saveMockResult({ grossWpm, netWpm, accuracy, errors, totalWords: wordStats.totalWords });
}

function gradeFor(netWpm, accuracy) {
  if (accuracy < 80) return "RETRY";
  if (netWpm >= 45) return "A+";
  if (netWpm >= 35) return "A";
  if (netWpm >= 25) return "B";
  return "C";
}

function showResultTicket(r) {
  document.getElementById("testCard").style.display = "none";
  document.getElementById("resultCard").style.display = "block";

  document.getElementById("resultGrossWpm").textContent = r.grossWpm;
  document.getElementById("resultNetWpm").textContent = r.netWpm;
  document.getElementById("resultAccuracy").textContent = r.accuracy + "%";
  document.getElementById("resultDuration").textContent = mockTest.duration + " min";
  document.getElementById("resultErrors").textContent = r.errors;
  document.getElementById("resultTotalWords").textContent = r.totalWords;
  document.getElementById("resultGrade").textContent = gradeFor(r.netWpm, r.accuracy);
  document.getElementById("resultPassageName").textContent = mockTest.title;
}

// Saves with the fields specified for this restructure:
// user_id, mock_test_id, mock name, category, passage, duration,
// gross WPM, net WPM, accuracy, errors, created_at (auto).
async function saveMockResult(r) {
  if (!currentUser) {
    console.warn("No logged-in user — mock test result was not saved.");
    return;
  }

  const { error } = await supabaseClient.from("mock_test_results").insert({
    user_id: currentUser.id,
    mock_test_id: mockTest.id,
    mock_name: mockTest.title,
    category: mockTest.category,
    passage_id: selectedPassage.id,
    passage_title: selectedPassage.title,
    duration: mockTest.duration,
    gross_wpm: r.grossWpm,
    net_wpm: r.netWpm,
    accuracy: r.accuracy,
    errors: r.errors,
    total_words: r.totalWords
  });

  if (error) {
    console.error("Could not save mock test result:", error);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
