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
// Word-level typing state (replaces the old character-index model).
// activeWordIndex/wordStartPos/wordResults are the three variables
// the rest of this engine is built around now — see onTypingInput(),
// evaluateWord(), and the brief's own recommended architecture.
let activeWordIndex = 0;
let wordStartPos = 0; // offset into `typed` where the active word begins
let wordResults = [];
// Guards against endMockTest() finalizing (and saving) a test twice
// if more than one end-trigger fires close together — e.g. the user
// finishes typing the exact instant the timer also expires. Reset at
// the start of every new attempt, set the moment finalization begins.
let testResultSaved = false;

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

  // ---------------- Access priority (new TypeShala access model) ----------------
  // PASS and CREDIT are now two access METHODS for the same SSC/Legal
  // test library — not two separate libraries. For any non-free test:
  //   STEP 1: does the student have an active eligible pass? (checked
  //           via the SAME can_access_mock() function used to enforce
  //           saving — never re-implemented client-side.) If yes:
  //           unlimited access, no credit involved, regardless of
  //           whether this specific test used to be "premium" or
  //           "credit" — that distinction no longer changes behaviour.
  //   STEP 2: no eligible pass — fall back to the existing credit
  //           system exactly as before (1 credit, once).
  //   STEP 3: neither — locked, show purchase options.
  let hasEligiblePass = false;

  if (mockTest.access_type !== "free") {
    const { data: allowed, error: accessError } = await supabaseClient.rpc("can_access_mock", { mock_id: mockTest.id });
    if (accessError) console.error("can_access_mock RPC error:", accessError);
    hasEligiblePass = !accessError && !!allowed;
  }

  if (mockTest.access_type !== "free" && !hasEligiblePass) {
    // No eligible pass — read-only check here (never deducts) so a
    // test already claimed with a credit shows that plainly instead
    // of a Start button that would just be rejected. The actual
    // credit spend only happens inside start_credit_test(), called
    // from handleStartClick below.
    const { data: existingUnlock } = await supabaseClient
      .from("mock_unlocks")
      .select("id")
      .eq("user_id", currentUser.id)
      .eq("mock_test_id", mockTest.id)
      .maybeSingle();

    if (existingUnlock) {
      document.getElementById("setupInfo").innerHTML =
        '<div style="font-family:var(--font-display); font-size:1.2rem; font-weight:700;">&#10003; Completed</div>' +
        '<div style="color:var(--ink-soft); margin-top:8px; font-size:0.9rem;">You have already completed this test using a credit. It cannot be retaken unless you have an active eligible Pass.</div>' +
        '<a class="btn" style="margin-top:14px; display:inline-block;" href="mock-history.html">View Result</a>';
      return; // startBtn is never shown
    }
  }

  document.getElementById("setupInfo").innerHTML =
    '<div class="mock-test-title">' + escapeHtml(mockTest.title) + '</div>' +
    '<div class="mock-test-meta">' + mockTest.duration + ' minutes &middot; ' +
    (mockTest.access_type === "free" ? "Free" : (hasEligiblePass ? "PASS INCLUDED" : "1 CREDIT")) + '</div>' +
    '<div class="mock-test-message">Your passage has already been assigned — it will appear the moment you click start.</div>';

  const startBtn = document.getElementById("startBtn");
  startBtn.style.display = "inline-flex";
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

  if (mockTest.access_type !== "free") {
    // ---------------- STEP 1: eligible Pass ----------------
    // Tried FIRST for every non-free test regardless of whether the
    // test used to be "premium" or "credit" — an eligible pass always
    // wins and NEVER consumes a credit. Re-verified atomically here
    // (not just trusted from the page-load check).
    startBtn.disabled = true;
    startBtn.textContent = "Checking access...";

    const { data: passData, error: passError } = await supabaseClient.rpc("start_mock_test", { mock_id: mockTest.id });
    if (passError) console.error("start_mock_test RPC error:", passError);
    const passResult = Array.isArray(passData) ? passData[0] : passData;
    const passGranted = !passError && passResult && passResult.has_access;

    if (!passGranted) {
      // ---------------- STEP 2: Credit fallback ----------------
      // No eligible pass — the ONLY place a credit is ever spent.
      // Frontend visibility was never access control; this atomic,
      // server-side check/deduct is what actually decides whether
      // the test may start.
      startBtn.textContent = "Checking credit balance...";

      const { data, error } = await supabaseClient.rpc("start_credit_test", { mock_id: mockTest.id });
      if (error) console.error("start_credit_test RPC error:", error);

      startBtn.disabled = false;
      startBtn.textContent = "Start Mock Test";

      const result = Array.isArray(data) ? data[0] : data;

      if (error || !result || !result.has_access) {
        // ---------------- STEP 3: neither pass nor credit ----------------
        document.getElementById("setupInfo").innerHTML =
          '<div style="font-family:var(--font-display); font-size:1.2rem; font-weight:700; color:var(--stamp);">&#128274; Access Required</div>' +
          '<div style="color:var(--ink-soft); margin-top:8px; font-size:0.9rem;">You need an active eligible Pass or at least 1 Credit to take this test.</div>' +
          '<a class="btn" style="margin-top:14px; display:inline-block;" href="subscriptions.html">View Passes &amp; Credits</a>';
        startBtn.style.display = "none";
        return;
      }

      if (result.access_reason === "ALREADY_COMPLETED") {
        document.getElementById("setupInfo").innerHTML =
          '<div style="font-family:var(--font-display); font-size:1.2rem; font-weight:700;">&#10003; Completed</div>' +
          '<div style="color:var(--ink-soft); margin-top:8px; font-size:0.9rem;">You have already completed this test using a credit. It cannot be retaken unless you have an active eligible Pass.</div>' +
          '<a class="btn" style="margin-top:14px; display:inline-block;" href="mock-history.html">View Result</a>';
        startBtn.style.display = "none";
        return;
      }
      // result.access_reason === "CREDIT_USED" — 1 credit was just
      // deducted and this test is now claimed for this student
      // (unless/until an eligible Pass covers it later). Proceed to
      // the timed test below.
    } else {
      startBtn.disabled = false;
      startBtn.textContent = "Start Mock Test";
    }
  }

  startMockTest();
}

function startMockTest() {
  testResultSaved = false;
  passageChars = selectedPassage.content.split("");
  wordRanges = computeWordRanges(selectedPassage.content);
  activeWordIndex = 0;
  wordStartPos = 0;
  wordResults = [];

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

// Renders one <span class="typing-word"> per expected word (not one
// span per character — that per-character rendering is exactly what
// caused the old cascading-highlight problem, since it visually
// implied a strict 1:1 position lock between typed and expected text
// that the input never actually enforced). Plain space text nodes
// between spans give natural line-wrapping, same as before.
function renderPassage() {
  const box = document.getElementById("passageBox");
  box.innerHTML = "";
  wordRanges.forEach((w, i) => {
    const span = document.createElement("span");
    span.className = "typing-word";
    span.textContent = w.text;
    span.id = "word-" + i;
    box.appendChild(span);
    if (i < wordRanges.length - 1) box.appendChild(document.createTextNode(" "));
  });
  if (wordRanges.length > 0) {
    document.getElementById("word-0").classList.add("active");
  }
}

function refocusTypingInput() {
  const input = document.getElementById("typeInput");
  if (input && !input.disabled && testScreenOpen) input.focus();
}

/* ---------------- Character-level diff (per word) ----------------
   Standard Levenshtein alignment with backtrace, scoped to a single
   word (always short — a handful to ~15 characters — so the O(n*m)
   cost here is trivial). This is what actually prevents cascading
   errors: instead of assuming typed[i] lines up with the passage's
   character i (the assumption that broke on any missed/extra
   character), each word's typed text is aligned against ONLY that
   word's own expected text, independently of every other word.
   Produces one operation per aligned position:
     match        — expected[i] === typed[j]
     substitution — expected[i] !== typed[j] (wrong key)
     missing      — expected[i] has no typed counterpart (skipped key)
     extra        — typed[j] has no expected counterpart (extra key)
   "missing" and "substitution" both carry the EXPECTED character —
   exactly the key a student needs to practice — matching the
   {expected, typed, position} shape used elsewhere in this project's
   weak-key data. */
function diffWordChars(expected, typed) {
  const m = expected.length, n = typed.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (expected[i - 1] === typed[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && expected[i - 1] === typed[j - 1]) {
      ops.push({ type: "match", expected: expected[i - 1] });
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.push({ type: "substitution", expected: expected[i - 1], typed: typed[j - 1] });
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ type: "missing", expected: expected[i - 1] });
      i--;
    } else {
      ops.push({ type: "extra", typed: typed[j - 1] });
      j--;
    }
  }
  ops.reverse();

  return {
    ops,
    errors: ops.filter(op => op.type !== "match"),
    correctCount: ops.filter(op => op.type === "match").length
  };
}

// Evaluates the word the student just finished typing (Space was
// pressed, or the test ended mid-word) against wordRanges[activeWordIndex]
// — the CURRENT active word, never a fixed offset into the original
// passage — then advances to the next word. This is the core of the
// cascading-error fix: each word's evaluation is independent of every
// other word's length, so one missed character in word 2 has zero
// effect on how word 3, 4, 5... are compared.
function evaluateWord(typedWord) {
  const expectedWord = activeWordIndex < wordRanges.length ? wordRanges[activeWordIndex].text : "";
  const diff = diffWordChars(expectedWord, typedWord);

  wordResults.push({
    expectedWord,
    typedWord,
    correct: typedWord === expectedWord,
    ops: diff.ops,                 // full alignment — used internally by calculateKeyAnalysis()
    characterErrors: diff.errors,  // just the errors — {type, expected, typed} shape for weak-key data
    correctCharCount: diff.correctCount
  });
  activeWordIndex++;
}

function updateActiveWordHighlight() {
  wordRanges.forEach((w, i) => {
    const span = document.getElementById("word-" + i);
    if (span) span.classList.remove("active");
  });
  if (activeWordIndex < wordRanges.length) {
    const activeSpan = document.getElementById("word-" + activeWordIndex);
    if (activeSpan) activeSpan.classList.add("active");
  }
  // Subtle WORD-level (not character-level) feedback on completed
  // words only — satisfies "no letter-by-letter highlighting" while
  // still giving some visual progress feedback.
  wordResults.forEach((r, i) => {
    const span = document.getElementById("word-" + i);
    if (!span) return;
    span.classList.remove("word-correct", "word-wrong");
    span.classList.add(r.correct ? "word-correct" : "word-wrong");
  });
}

/* ---------------- Live typing ---------------- */

function onTypingInput(e) {
  if (!testActive) {
    testActive = true;
    testStartTime = Date.now();
    testTimer = setInterval(tickTimer, 1000);
  }

  const typed = e.target.value;

  // Evaluate every word boundary (space) that has appeared since the
  // last event — normally just one, but a loop handles any input
  // coalescing safely. wordStartPos always advances from wherever the
  // PREVIOUS space actually landed in `typed`, never from a fixed
  // passage offset — that dynamic anchoring is what keeps word
  // boundaries synchronized even after a missed/extra character.
  let spaceIdx;
  while ((spaceIdx = typed.indexOf(" ", wordStartPos)) !== -1) {
    const word = typed.substring(wordStartPos, spaceIdx);
    if (word.length > 0) {
      evaluateWord(word);
    }
    // else: consecutive spaces with nothing typed between them —
    // skipped silently rather than recorded as a blank-word failure.
    wordStartPos = spaceIdx + 1;
  }

  updateActiveWordHighlight();
  scrollActiveWordIntoView();

  const stats = computeLiveStats(typed);
  updateLiveStats(stats.wpm, stats.accuracy, stats.mistakes);

  // Completion: waits for the user to finish typing the LAST expected
  // word specifically, not "overall typed length reaches passage
  // length" — that raw-length check (preserved unchanged from the old
  // engine at first) turned out to have its own latent drift bug: once
  // any earlier word is over-typed (extra characters), the total
  // typed length can reach the passage's original length BEFORE the
  // user actually finishes the real last word, ending the test early
  // and cutting it off mid-word. Confirmed this by testing the
  // brief's own "extra character" case (quiick) — fox was truncated
  // to "fo" before this fix. Word-aware completion has no such drift
  // since it only cares about the current (last) word's own progress.
  const onLastWord = activeWordIndex === wordRanges.length - 1;
  const lastWordLength = wordRanges.length > 0 ? wordRanges[wordRanges.length - 1].text.length : 0;
  const currentWordTypedLength = typed.length - wordStartPos;
  if (onLastWord && currentWordTypedLength >= lastWordLength) {
    endMockTest("completed");
  }
}

// Live WPM/accuracy/mistakes from wordResults (already-submitted
// words) plus a simple prefix comparison of the CURRENT in-progress
// word only — that partial word is properly re-scored via the full
// character diff the moment it's actually submitted, so this partial
// estimate never leaks into permanent/saved data.
function computeLiveStats(typed) {
  let correctChars = 0;
  wordResults.forEach(r => { correctChars += r.correctCharCount; });

  const expectedWord = activeWordIndex < wordRanges.length ? wordRanges[activeWordIndex].text : "";
  const partialTyped = typed.substring(wordStartPos);
  for (let i = 0; i < partialTyped.length && i < expectedWord.length; i++) {
    if (partialTyped[i] === expectedWord[i]) correctChars++;
  }

  const totalTyped = typed.length;
  const accuracy = totalTyped > 0 ? Math.round((correctChars / totalTyped) * 100) : 100;
  const minutesElapsed = testStartTime ? (Date.now() - testStartTime) / 60000 : 0;
  const wpm = minutesElapsed > 0 ? Math.round((correctChars / 5) / minutesElapsed) : 0;
  const mistakes = wordResults.filter(r => !r.correct).length;

  return { correctChars, accuracy, wpm, mistakes };
}

// Same safe-zone auto-scroll behavior as before, now keyed off the
// active WORD span instead of a character span.
function scrollActiveWordIntoView() {
  const idx = Math.min(activeWordIndex, wordRanges.length - 1);
  const span = document.getElementById("word-" + idx);
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
  if (testResultSaved) return;
  testResultSaved = true;

  if (testTimer) clearInterval(testTimer);
  testActive = false;
  testScreenOpen = false;
  window.removeEventListener("beforeunload", beforeUnloadHandler);

  const input = document.getElementById("typeInput");
  input.disabled = true; // Disable typing after time ends / completion

  const typed = input.value;

  // Finalize whatever word was still in progress — the student can
  // finish the very last word without ever pressing Space, or the
  // timer/fullscreen-exit can end the test mid-word. Same evaluateWord()
  // path every other word goes through, so the last word is scored
  // identically, not as a special case.
  const trailingWord = typed.substring(wordStartPos);
  if (trailingWord.length > 0 && activeWordIndex < wordRanges.length) {
    evaluateWord(trailingWord);
    wordStartPos = typed.length;
  }
  updateActiveWordHighlight();

  const keyAnalysis = calculateKeyAnalysis();

  let correct = 0;
  wordResults.forEach(r => { correct += r.correctCharCount; });

  const totalTypedChars = typed.length;
  const accuracy = totalTypedChars > 0 ? Math.round((correct / totalTypedChars) * 100) : 0;
  // "errors"/"Mistakes" = incorrectly-typed WORDS, derived from the
  // same wordResults every word's own diff was recorded into — never
  // recomputed from raw typed/passage offsets, so it can't cascade.
  const errors = wordResults.filter(r => !r.correct).length;
  const totalWords = wordResults.length;

  const elapsedMinutes = testStartTime ? (Date.now() - testStartTime) / 60000 : mockTest.duration;
  const minutesForWpm = reason === "time_up" ? mockTest.duration : Math.max(elapsedMinutes, 0.05);

  const grossWpm = Math.round((totalTypedChars / 5) / minutesForWpm);
  const netWpm = Math.round((correct / 5) / minutesForWpm);

  // Requirement 1: exit full-screen once the mock test ends
  exitFullscreen();
  document.getElementById("fsRetryBtn").style.display = "none";

  showResultTicket({ grossWpm, netWpm, accuracy, errors, totalWords, keyAnalysis });
  await saveMockResult({ grossWpm, netWpm, accuracy, errors, totalWords });
  await saveKeyAnalysis(keyAnalysis);
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

  showWeakKeyAnalysis(r.keyAnalysis);
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

/* ============================================================
   Weak-Key Analysis (V1 — additive only)
   ------------------------------------------------------------
   Now derived entirely from wordResults[].ops (the per-word
   character diffs computed in evaluateWord()/diffWordChars()) rather
   than a raw passageChars[i]-vs-typed[i] scan — that raw scan was
   itself vulnerable to the exact same cascading-position problem the
   typing engine just had, since a single missed character earlier in
   the passage would misalign every subsequent index and misattribute
   errors to the wrong keys. wordResults is immune to that by
   construction (each word's diff only ever compares against its own
   expected text), so key attribution stays correct.
   ============================================================ */

// Walks every recorded word's character-diff operations and
// attributes each one to the EXPECTED character — the key a student
// actually needs to practice, not whatever they mistakenly typed.
// "extra" operations have no expected character to blame and are
// skipped for key-level stats (an extra keystroke isn't really "the
// wrong key" for any specific expected letter). Only A-Z; space/
// punctuation/numbers stay excluded for V1, same as before.
function calculateKeyAnalysis() {
  const stats = {};

  wordResults.forEach(result => {
    result.ops.forEach(op => {
      if (!op.expected || !/^[a-zA-Z]$/.test(op.expected)) return;

      const key = op.expected.toUpperCase();
      if (!stats[key]) {
        stats[key] = { attempts: 0, correct: 0, errors: 0 };
      }

      stats[key].attempts++;
      if (op.type === "match") {
        stats[key].correct++;
      } else {
        stats[key].errors++;
      }
    });
  });

  return stats;
}

// Accumulates this test's key stats into the user's lifetime totals
// in typing_key_stats — one row per (user, key), read-modify-write
// since Postgres upsert-with-increment needs the current value first
// (matches the read-then-update pattern already used elsewhere in
// this codebase rather than introducing a raw SQL increment).
async function saveKeyAnalysis(keyStats) {
  if (!currentUser || !keyStats) return;

  const rows = Object.entries(keyStats).map(([key, stat]) => ({
    user_id: currentUser.id,
    key,
    attempts: stat.attempts,
    correct_count: stat.correct,
    error_count: stat.errors,
    last_attempted_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  if (!rows.length) return;

  for (const row of rows) {
    const { data: existing, error: fetchError } = await supabaseClient
      .from("typing_key_stats")
      .select("attempts, correct_count, error_count")
      .eq("user_id", currentUser.id)
      .eq("key", row.key)
      .maybeSingle();

    if (fetchError) {
      console.error("Could not read key statistics:", fetchError);
      continue;
    }

    if (existing) {
      const { error } = await supabaseClient
        .from("typing_key_stats")
        .update({
          attempts: existing.attempts + row.attempts,
          correct_count: existing.correct_count + row.correct_count,
          error_count: existing.error_count + row.error_count,
          last_attempted_at: row.last_attempted_at,
          updated_at: row.updated_at
        })
        .eq("user_id", currentUser.id)
        .eq("key", row.key);

      if (error) {
        console.error("Could not update key statistics:", error);
      }
    } else {
      const { error } = await supabaseClient
        .from("typing_key_stats")
        .insert(row);

      if (error) {
        console.error("Could not insert key statistics:", error);
      }
    }
  }
}

// THIS test's weak keys only (not lifetime) — a higher error/lower
// attempt bar than the dashboard's lifetime view, since a single
// test may never reach 30 occurrences of any one key. Requiring
// attempts>=5 AND errors>=2 keeps one stray typo from flagging a key
// that's otherwise fine.
function getCurrentTestWeakKeys(keyStats) {
  return Object.entries(keyStats)
    .map(([key, stat]) => {
      const accuracy = stat.attempts > 0
        ? (stat.correct / stat.attempts) * 100
        : 100;

      return {
        key,
        attempts: stat.attempts,
        errors: stat.errors,
        accuracy
      };
    })
    .filter(item =>
      item.attempts >= 5 &&
      item.errors >= 2 &&
      item.accuracy < 90
    )
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5);
}

function showWeakKeyAnalysis(keyStats) {
  const container = document.getElementById("weakKeyAnalysis");
  const list = document.getElementById("weakKeyList");
  const button = document.getElementById("practiceWeakKeysBtn");

  if (!container || !list) return;

  const weakKeys = getCurrentTestWeakKeys(keyStats || {});

  if (!weakKeys.length) {
    container.style.display = "block";

    list.innerHTML = `
      <div class="weak-key-empty">
        <strong>Great job!</strong>
        <p>No significant weak keys were detected in this test.</p>
      </div>
    `;

    if (button) button.style.display = "none";
    return;
  }

  container.style.display = "block";

  list.innerHTML = weakKeys.map(item => {
    const status =
      item.accuracy < 85 ? "Weak" : "Needs Practice";

    return `
      <div class="weak-key-item">
        <div class="weak-key-letter">${item.key}</div>

        <div class="weak-key-info">
          <div class="weak-key-name">${status}</div>
          <div class="weak-key-meta">
            ${item.errors} mistakes &middot; ${Math.round(item.accuracy)}% accuracy
          </div>
        </div>

        <div class="weak-key-percent">
          ${Math.round(item.accuracy)}%
        </div>
      </div>
    `;
  }).join("");

  if (button) {
    button.style.display = "inline-flex";

    button.onclick = () => {
      const keys = weakKeys.map(item => item.key).join(",");
      window.location.href =
        `weak-keys.html?keys=${encodeURIComponent(keys)}`;
    };
  }
}
