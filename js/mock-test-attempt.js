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

  // Backspace is now allowed WITHIN the current (uncommitted) word
  // only — never back into an already-committed word, since the
  // word-level cursor has already moved forward past those. Checked
  // directly against selectionStart/selectionEnd rather than trusted
  // implicitly, so this stays correct even if the browser's own
  // selection ends up somewhere unexpected (e.g. the user clicks
  // into earlier text). Enter is intercepted so it never inserts a
  // literal newline into the buffer — it commits the current word
  // (same evaluation path Space uses) and advances, without needing
  // a natural space character for the existing 'input'-event scanner
  // in onTypingInput() to detect.
  input.addEventListener("keydown", e => {
    if (!testScreenOpen) return;

    if (e.key === "Backspace") {
      if (input.selectionStart <= wordStartPos || input.selectionEnd <= wordStartPos) {
        e.preventDefault(); // would delete into already-committed text — blocked
      }
      // else: within the current word's own buffer — allow the
      // browser's default deletion; the resulting 'input' event just
      // sees a shorter typed value, which onTypingInput() already
      // handles correctly (evaluation still only happens at commit).
    } else if (e.key === "Enter") {
      e.preventDefault(); // never let a literal newline enter the buffer
      commitCurrentWord(input.value);
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

  // Hides the desktop sidebar for exactly as long as the fullscreen
  // exam is in progress — see the CSS comment on body.mock-test-active
  // in app-shell.css for the full anti-cheat reasoning. Reversed in
  // endMockTest(), the single authoritative point testScreenOpen also
  // returns to false.
  document.body.classList.add("mock-test-active");

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

// Splits the passage into paragraphs — confirmed directly against
// real passage data that a single newline marks a paragraph break in
// this project's content (not a blank line) — then flattens every
// paragraph's words into one indexed list, each entry tagged with
// which paragraph it belongs to and whether it's that paragraph's
// last word. activeWordIndex stays a single flat index into this
// list (simplest to keep every existing word-lookup working
// unchanged); the paragraph tags exist purely for rendering the
// paragraph break and are not needed for word evaluation itself —
// Enter commits/advances exactly like Space does, at any position.
function computeWordRanges(text) {
  const paragraphTexts = text.split("\n").filter(p => p.trim().length > 0);
  const words = [];
  paragraphTexts.forEach((paraText, pIdx) => {
    const paraWords = paraText.match(/\S+/g) || [];
    paraWords.forEach((word, wIdx) => {
      words.push({
        text: word,
        paragraphIndex: pIdx,
        isLastInParagraph: wIdx === paraWords.length - 1
      });
    });
  });
  return words;
}

// Renders one <span class="typing-word"> per expected word (not one
// span per character — that per-character rendering is exactly what
// caused the old cascading-highlight problem, since it visually
// implied a strict 1:1 position lock between typed and expected text
// that the input never actually enforced). Plain space text nodes
// between spans give natural line-wrapping, same as before; a real
// paragraph-break element (not just whitespace) is inserted after
// each paragraph's last word so the break stays visible even though
// browsers collapse plain whitespace.
function renderPassage() {
  const box = document.getElementById("passageBox");
  box.innerHTML = "";
  wordRanges.forEach((w, i) => {
    const span = document.createElement("span");
    span.className = "typing-word";
    span.textContent = w.text;
    span.id = "word-" + i;
    box.appendChild(span);

    if (i < wordRanges.length - 1) {
      if (w.isLastInParagraph) {
        box.appendChild(document.createElement("br"));
        box.appendChild(document.createElement("br"));
      } else {
        box.appendChild(document.createTextNode(" "));
      }
    }
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
//
// hadTrailingSpace: true only when this word was committed by an
// actual typed Space character (the normal path in onTypingInput's
// scan below) — never for Enter or for the final word at test end,
// neither of which corresponds to a real typed character at that
// position. This is the fix for the "perfect typing showed 81%"
// accuracy bug: the space itself is a real character the student
// typed and got right, but it was never being credited as a correct
// character anywhere — correctCharCount only ever covered
// WITHIN-word characters, while the total typed length used as the
// accuracy denominator included every space. Crediting exactly one
// correct character per genuinely-typed, correctly-placed space
// closes that gap without touching how word/character diffing itself
// works, and without crediting extra/missing spaces, which still
// correctly reduce accuracy (an extra space is never credited here;
// a missing space means no space character was typed at all, so
// there's nothing to credit or penalize at this specific position —
// it instead surfaces as a word-content mismatch on the merged word,
// which the diff/weak-key logic already reflects).
function evaluateWord(typedWord, hadTrailingSpace) {
  const expectedWord = activeWordIndex < wordRanges.length ? wordRanges[activeWordIndex].text : "";
  const diff = diffWordChars(expectedWord, typedWord);

  wordResults.push({
    expectedWord,
    typedWord,
    correct: typedWord === expectedWord,
    ops: diff.ops,                 // full alignment — used internally by calculateKeyAnalysis()
    characterErrors: diff.errors,  // just the errors — {type, expected, typed} shape for weak-key data
    correctCharCount: diff.correctCount,
    hadTrailingSpace: !!hadTrailingSpace
  });
  activeWordIndex++;
}

// Total "correct" characters across every committed word, INCLUDING
// the correctly-typed spaces between them — the actual fix for the
// accuracy bug. Centralized here so live stats, final stats, and the
// print view can never drift into separate/conflicting formulas.
function totalCorrectChars() {
  let total = 0;
  wordResults.forEach(r => {
    total += r.correctCharCount;
    if (r.hadTrailingSpace) total += 1;
  });
  return total;
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

// Commits whatever is in the current word's buffer (typed.substring
// (wordStartPos)) as this word's final answer, evaluates it, and
// advances to the next word. Shared by BOTH commit paths — the
// natural Space character (detected in onTypingInput's scan below)
// and the Enter keydown handler above — so a word is scored
// identically regardless of which key ended it. An empty buffer
// (Enter/extra-space pressed with nothing typed since the last
// commit) is skipped silently rather than recorded as a blank-word
// failure, matching the same "consecutive spaces" leniency already
// used for the Space path.
function commitCurrentWord(typed) {
  const word = typed.substring(wordStartPos);
  if (word.length > 0) {
    evaluateWord(word);
  }
  wordStartPos = typed.length;
  updateActiveWordHighlight();
  scrollActiveWordIntoView();

  const stats = computeLiveStats(typed);
  updateLiveStats(stats.wpm, stats.accuracy, stats.mistakes);
  checkForCompletion(typed);
}

// Two ways a test can end "naturally" (as opposed to timer/fullscreen-
// exit): every word has been committed (the student pressed Space or
// Enter after the very last word), or the student is still on the
// last word but has now typed at least as many characters as it
// requires (no trailing Space/Enter needed). The second check is
// word-aware rather than based on overall typed length reaching the
// original passage length — that raw-length approach has a drift bug
// confirmed directly: once any earlier word is over-typed (extra
// characters), total length reaches the passage's original length
// BEFORE the real last word is finished, truncating it mid-word.
function checkForCompletion(typed) {
  if (activeWordIndex >= wordRanges.length) {
    endMockTest("completed");
    return;
  }
  const onLastWord = activeWordIndex === wordRanges.length - 1;
  const lastWordLength = wordRanges.length > 0 ? wordRanges[wordRanges.length - 1].text.length : 0;
  const currentWordTypedLength = typed.length - wordStartPos;
  if (onLastWord && currentWordTypedLength >= lastWordLength) {
    endMockTest("completed");
  }
}

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
  // Enter is handled separately (see the keydown listener above) since
  // it never produces a space character for this scan to find.
  let spaceIdx;
  while ((spaceIdx = typed.indexOf(" ", wordStartPos)) !== -1) {
    const word = typed.substring(wordStartPos, spaceIdx);
    if (word.length > 0) {
      evaluateWord(word, true); // true: this word was followed by a real typed space
    }
    wordStartPos = spaceIdx + 1;
  }

  updateActiveWordHighlight();
  scrollActiveWordIntoView();

  const stats = computeLiveStats(typed);
  updateLiveStats(stats.wpm, stats.accuracy, stats.mistakes);
  checkForCompletion(typed);
}

// Live WPM/accuracy/mistakes from wordResults (already-submitted
// words) plus a simple prefix comparison of the CURRENT in-progress
// word only — that partial word is properly re-scored via the full
// character diff the moment it's actually submitted, so this partial
// estimate never leaks into permanent/saved data.
function computeLiveStats(typed) {
  let correctChars = totalCorrectChars();

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
  document.body.classList.remove("mock-test-active"); // sidebar becomes visible again for the result screen
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

  // Fixed accuracy calculation: totalCorrectChars() now credits every
  // correctly-typed space between words, not just within-word
  // characters — see the comment on evaluateWord()/totalCorrectChars()
  // for the full root-cause explanation. Used consistently here for
  // both accuracy and Net WPM, and nowhere else in the file computes
  // a competing "correct" count.
  const correct = totalCorrectChars();

  const totalTypedChars = typed.length;
  const accuracy = totalTypedChars > 0 ? Math.round((correct / totalTypedChars) * 100) : 0;
  // "errors"/"Mistakes" = incorrectly-typed WORDS, derived from the
  // same wordResults every word's own diff was recorded into — never
  // recomputed from raw typed/passage offsets, so it can't cascade.
  const errors = wordResults.filter(r => !r.correct).length;
  const totalWords = wordResults.length;

  // Completion: the passage is only "complete" if every expected word
  // was actually evaluated. This is the fix for the "20% typed, 100%
  // accuracy, still marked Passed" bug — activeWordIndex only reaches
  // wordRanges.length via a real evaluateWord() call for every word,
  // so an attempt cut short by time/fullscreen-exit/leaving the test
  // partway through is correctly NOT complete, regardless of how
  // accurate or fast the PARTIAL typing was.
  const isPassageCompleted = activeWordIndex >= wordRanges.length;

  const elapsedMinutes = testStartTime ? (Date.now() - testStartTime) / 60000 : mockTest.duration;
  const minutesForWpm = reason === "time_up" ? mockTest.duration : Math.max(elapsedMinutes, 0.05);

  const grossWpm = Math.round((totalTypedChars / 5) / minutesForWpm);
  const netWpm = Math.round((correct / 5) / minutesForWpm);

  // Single authoritative pass/fail decision — see isTestPassed() for
  // the full formula and why REQUIRED_ACCURACY/REQUIRED_NET_WPM are
  // the specific numbers used. Computed once here and threaded
  // through to the result screen and the saved record, rather than
  // re-derived separately in either place.
  const passed = isTestPassed(isPassageCompleted, accuracy, netWpm);

  // Requirement 1: exit full-screen once the mock test ends
  exitFullscreen();
  document.getElementById("fsRetryBtn").style.display = "none";

  showResultTicket({ grossWpm, netWpm, accuracy, errors, totalWords, keyAnalysis, isPassageCompleted, passed });
  await saveMockResult({ grossWpm, netWpm, accuracy, errors, totalWords, isPassageCompleted, passed });
  await saveKeyAnalysis(keyAnalysis);
}

// Single source of truth for the required thresholds — reused by
// both isTestPassed() and gradeFor() below so there is exactly one
// place either number is ever defined. No per-test configurable
// pass-criteria column exists in mock_tests (checked the live schema
// directly), so these reuse the SAME 80% / 25 WPM values gradeFor()
// already used as its "RETRY" and lowest-passing-tier thresholds,
// rather than inventing new unconfigured numbers.
const REQUIRED_ACCURACY = 80;
const REQUIRED_NET_WPM = 25;

// isPassed = passage completed AND accuracy >= required AND
// netWpm >= required — completion is checked first and is an
// unconditional gate: no amount of speed or accuracy can pass an
// incomplete attempt (Rule 2 / Part 3 of the brief).
function isTestPassed(isPassageCompleted, accuracy, netWpm) {
  return isPassageCompleted && accuracy >= REQUIRED_ACCURACY && netWpm >= REQUIRED_NET_WPM;
}

function gradeFor(netWpm, accuracy) {
  if (accuracy < REQUIRED_ACCURACY) return "RETRY";
  if (netWpm >= 45) return "A+";
  if (netWpm >= 35) return "A";
  if (netWpm >= 25) return "B";
  return "C";
}

function showResultTicket(r) {
  document.getElementById("testCard").style.display = "none";
  document.getElementById("resultCard").style.display = "block";

  // Pass/fail is now the SINGLE authoritative value computed once in
  // endMockTest() (isTestPassed()) — completion-aware, not just
  // accuracy/speed. Not recomputed here, so the result screen can
  // never show a different verdict than what gets saved.
  const passed = r.passed;
  const grade = gradeFor(r.netWpm, r.accuracy);

  document.getElementById("resultGrossWpm").textContent = r.grossWpm;
  document.getElementById("resultNetWpm").textContent = r.netWpm;
  document.getElementById("resultAccuracy").textContent = r.accuracy + "%";
  document.getElementById("resultDuration").textContent = formatDurationForResult(r);

  renderStatusCard(passed, r.isPassageCompleted);
  renderFeedbackTips(r, passed, grade);
  renderStatusBadge(passed);
  renderEncouragement(passed);
  wirePrintResults(r, passed, grade);

  showWeakKeyAnalysis(r.keyAnalysis);
}

// "Time Taken" — mm:ss of actual elapsed time when the test ended
// early/on completion, or the full scheduled duration for a time_up
// finish. testStartTime/mockTest are the same variables the rest of
// this file already uses for timing; nothing new tracked here.
function formatDurationForResult(r) {
  const elapsedMs = testStartTime ? Date.now() - testStartTime : mockTest.duration * 60000;
  const totalSeconds = Math.max(Math.round(elapsedMs / 1000), 0);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return mins + ":" + String(secs).padStart(2, "0") + " min";
}

function renderStatusCard(passed, isPassageCompleted) {
  const card = document.getElementById("mtrStatusCard");
  const icon = document.getElementById("mtrStatusIcon");
  const title = document.getElementById("mtrStatusTitle");
  const msg = document.getElementById("mtrStatusMsg");
  if (!card) return;

  card.classList.remove("mtr-status-pass", "mtr-status-fail");
  card.classList.add(passed ? "mtr-status-pass" : "mtr-status-fail");
  icon.innerHTML = passed
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>';
  title.textContent = passed ? "Test Passed" : "Test Not Passed";
  if (passed) {
    msg.textContent = "Well done! Keep up the consistent practice.";
  } else if (!isPassageCompleted) {
    // Distinct message for the "Not Passed — Incomplete" case per
    // spec — the main Passed/Not Passed status stays exactly the
    // same either way (this page's status card is a single title,
    // not separate reason badges), but the message underneath makes
    // clear WHY, since "keep practicing" would be misleading advice
    // for someone who was simply cut off before finishing.
    msg.textContent = "The full passage wasn't completed, so this attempt can't be marked as passed.";
  } else {
    msg.textContent = "Keep practicing! You'll get better with consistency.";
  }
}

// Dynamic feedback derived from the SAME accuracy/WPM thresholds
// gradeFor() already uses — deliberately not the reference image's
// illustrative 95%/35 WPM numbers, since this project has no
// configurable per-test pass-criteria columns yet (checked the live
// mock_tests schema directly before writing this: no such column
// exists). Showing a fake fixed requirement would misrepresent how
// grading actually works here; this reflects the real logic instead.
function renderFeedbackTips(r, passed, grade) {
  const list = document.getElementById("mtrFeedbackList");
  if (!list) return;

  const tips = [];
  if (!r.isPassageCompleted) {
    tips.push("You need to complete the entire passage for a test to count as passed — accuracy and speed alone aren't enough.");
  }
  if (!passed && r.accuracy < REQUIRED_ACCURACY) {
    tips.push(`To pass this exam your accuracy should have been at least ${REQUIRED_ACCURACY}%.`);
  }
  if (!passed && r.isPassageCompleted && r.netWpm < REQUIRED_NET_WPM) {
    tips.push(`To pass this exam your typing speed should have been at least ${REQUIRED_NET_WPM} WPM (Net Speed).`);
  }
  const nextTier = grade === "RETRY" ? null : grade === "C" ? { wpm: 25, label: "B" } : grade === "B" ? { wpm: 35, label: "A" } : grade === "A" ? { wpm: 45, label: "A+" } : null;
  if (nextTier && r.isPassageCompleted) {
    tips.push(`Reach ${nextTier.wpm} WPM (Net Speed) at ${REQUIRED_ACCURACY}%+ accuracy for a ${nextTier.label} grade next time.`);
  } else if (grade === "A+" && passed) {
    tips.push("You're at the top grade tier — keep this pace and accuracy consistent across tests.");
  }
  if (r.accuracy < 95 && passed) {
    tips.push("Pushing accuracy toward 95%+ will make your typing even more exam-ready.");
  }

  list.innerHTML = tips.map(t => `<div class="mtr-feedback-item"><span class="mtr-feedback-quote">&ldquo;</span>${t}</div>`).join("");
}

function renderStatusBadge(passed) {
  const badge = document.getElementById("mtrStatusBadge");
  if (!badge) return;
  badge.textContent = passed ? "Passed" : "Not Passed";
  badge.classList.remove("mtr-badge-pass", "mtr-badge-fail");
  badge.classList.add(passed ? "mtr-badge-pass" : "mtr-badge-fail");
}

function renderEncouragement(passed) {
  const title = document.getElementById("mtrEncourageTitle");
  const msg = document.getElementById("mtrEncourageMsg");
  if (!title || !msg) return;
  if (passed) {
    title.textContent = "Great work!";
    msg.textContent = "Keep this consistency going in your next attempt.";
  } else {
    title.textContent = "Don't give up!";
    msg.textContent = "Practice a little every day and you'll see great improvement.";
  }
}

// Reuses the SAME weak-key data + status already computed for the
// screen result — no separate calculation, no duplicate result
// system. Renders into the existing hidden #printResultView element
// and calls window.print() — the browser's own Save-as-PDF is
// exactly window.print()'s destination picker, so no extra library
// is needed for that requirement either.
function wirePrintResults(r, passed, grade) {
  const btn = document.getElementById("printResultsBtn");
  if (!btn) return;

  btn.onclick = () => {
    const weakKeys = getCurrentTestWeakKeys(r.keyAnalysis || {});
    const view = document.getElementById("printResultView");
    view.innerHTML = `
      <div class="print-sheet">
        <div class="print-brand">TypeShala</div>
        <h1>Typing Test Result</h1>
        <div class="print-meta">${escapeHtml(mockTest.title)} &middot; ${escapeHtml(selectedPassage.title)} &middot; ${new Date().toLocaleDateString()}</div>

        <table class="print-table">
          <tr><th>Status</th><td>${passed ? "Passed" : "Not Passed"}</td></tr>
          <tr><th>Passage Completed</th><td>${r.isPassageCompleted ? "Yes" : "No"}</td></tr>
          <tr><th>Time Taken</th><td>${formatDurationForResult(r)}</td></tr>
          <tr><th>Gross Speed</th><td>${r.grossWpm} WPM</td></tr>
          <tr><th>Net Speed</th><td>${r.netWpm} WPM</td></tr>
          <tr><th>Accuracy</th><td>${r.accuracy}%</td></tr>
          <tr><th>Total Words Typed</th><td>${r.totalWords}</td></tr>
          <tr><th>Mistakes</th><td>${r.errors}</td></tr>
        </table>

        ${weakKeys.length ? `
          <h2>Weak Keys</h2>
          <table class="print-table">
            ${weakKeys.map(k => `<tr><th>${k.key}</th><td>${Math.round(k.accuracy)}% accuracy &middot; ${k.errors} mistakes</td></tr>`).join("")}
          </table>
        ` : ""}
      </div>
    `;
    window.print();
  };
}

// Saves with the fields specified for this restructure:
// user_id, mock_test_id, mock name, category, passage, duration,
// gross WPM, net WPM, accuracy, errors, created_at (auto), plus
// is_completed/is_passed — added via migration
// add_pass_completion_status_to_mock_test_results specifically so
// the SAVED record reflects the same corrected, completion-aware
// verdict shown on screen, not just the on-screen text.
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
    total_words: r.totalWords,
    is_completed: r.isPassageCompleted,
    is_passed: r.passed
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

// A single character is trackable for weak-key purposes if it's a
// letter OR a punctuation mark — extended per explicit request to
// also flag mistyped punctuation (, . : ' " ? ( and any other ASCII
// punctuation) as weak-key errors, not just letters. Space is
// excluded here deliberately: correctly/incorrectly typed spaces are
// already tracked separately via hadTrailingSpace for accuracy
// purposes, and treating space as a "key" here would double-count
// it. Digits are intentionally NOT included — the request was
// specifically about punctuation marks, not numbers.
function isTrackableKeyChar(ch) {
  if (/^[a-zA-Z]$/.test(ch)) return true;
  if (ch === " ") return false;
  return /^[!-\/:-@[\]^_`{-~]$/.test(ch);
}

// Walks every recorded word's character-diff operations and
// attributes each one to the EXPECTED character — the key a student
// actually needs to practice, not whatever they mistakenly typed.
// "extra" operations have no expected character to blame and are
// skipped for key-level stats (an extra keystroke isn't really "the
// wrong key" for any specific expected letter). Letters and
// punctuation marks are tracked (see isTrackableKeyChar); space and
// digits are not.
function calculateKeyAnalysis() {
  const stats = {};

  wordResults.forEach(result => {
    result.ops.forEach(op => {
      if (!op.expected || !isTrackableKeyChar(op.expected)) return;

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
  const chartEl = document.getElementById("weakKeyChart");
  const button = document.getElementById("practiceWeakKeysBtn");

  // Diagnostic only — never shown to the student, just visible in
  // devtools. If the graph is ever blank again, this is the first
  // thing to check: a missing container/chart element here almost
  // always means a stale cached HTML/JS mismatch (the two files
  // shipped from different deploys), not a data problem — the
  // elements this function targets by id must exist in the current
  // mock-test-attempt.html for any of this to have anywhere to render.
  if (!container || !list || !chartEl) {
    console.warn("showWeakKeyAnalysis: expected result-page element(s) not found in the DOM.", {
      hasContainer: !!container, hasList: !!list, hasChart: !!chartEl,
      hint: "If these are missing/false, the loaded HTML and JS are very likely out of sync (a stale cached file) — hard-refresh or check the deployed file versions."
    });
  }
  if (!container || !list) return;

  const weakKeys = getCurrentTestWeakKeys(keyStats || {});
  console.debug("showWeakKeyAnalysis: keyStats keys =", keyStats ? Object.keys(keyStats) : keyStats, "-> weakKeys =", weakKeys);

  if (!weakKeys.length) {
    container.style.display = "block";
    const chart = document.getElementById("weakKeyChart");
    if (chart) chart.style.display = "none";

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
  const chart = document.getElementById("weakKeyChart");
  if (chart) chart.style.display = "flex";

  // Bar height is relative to the WORST key in this list (tallest bar
  // = 100%), so the chart always reads clearly regardless of how bad
  // or mild the actual accuracy numbers are. Severity color is by
  // rank within the list (already sorted worst-first by
  // getCurrentTestWeakKeys, untouched) rather than an absolute
  // accuracy cutoff — getCurrentTestWeakKeys already only returns
  // keys under 90% accuracy, so a fixed "accuracy < 80 = red" band
  // would rarely produce the green "OK" tier the reference shows;
  // ranking within the returned set reliably spreads across all
  // three severities the way the reference depicts.
  const worstProblem = Math.max(100 - weakKeys[weakKeys.length - 1].accuracy, 1);
  const total = weakKeys.length;

  list.innerHTML = weakKeys.map((item, i) => {
    const problem = 100 - item.accuracy;
    const heightPct = Math.max((problem / worstProblem) * 100, 8);
    const rankFraction = total > 1 ? i / (total - 1) : 0;
    const severity = rankFraction < 0.34 ? "high" : rankFraction < 0.67 ? "medium" : "low";

    return `
      <div class="mtr-bar-col">
        <div class="mtr-bar mtr-bar-${severity}" style="height:${heightPct}%;" title="${Math.round(item.accuracy)}% accuracy, ${item.errors} mistakes"></div>
        <div class="mtr-bar-label">${item.key}</div>
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
