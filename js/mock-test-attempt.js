/* ============================================================
   mock-test-attempt.js
   ------------------------------------------------------------
   Loads ONE mock test attempt, identified by a session id
   (?session=...) rather than a mock id — the mock itself is
   assigned server-side by start_or_resume_mock_test()/
   start_reattempt() (called from mock-test.html / mock-history.js)
   BEFORE this page ever loads. Access (pass or credit) is already
   resolved and, if a credit was needed, already spent by that point
   — this page never calls can_access_mock/start_mock_test/
   start_credit_test at all; it only loads the session's already-
   assigned mock+passage, runs the timed test, and completes the
   session via complete_mock_session() at the end.
   ============================================================ */

let currentUser = null;
let mockTest = null;      // the mock_tests row
let selectedPassage = null; // the joined passages row
let currentSession = null; // the mock_test_sessions row this attempt belongs to

// User-selectable fixed test duration (5 or 10 minutes) — defaults
// to the mock test's own configured duration, but the setup screen's
// duration picker (wired in initSetupScreen) can override it before
// the test starts. Everything time-based (timer, WPM math, the
// "required duration completed" pass condition) reads THIS variable,
// never mockTest.duration directly, once the test is running.
let selectedDurationMinutes = 10;

let testTimer = null;
let secondsLeft = 0;
let testStartTime = null;
let testActive = false;
let testScreenOpen = false;
// Guards cancelUnstartedTest() against firing twice for the same ESC
// press — the browser's native fullscreen-exit (caught via
// handleFullscreenChange) and the input's own keydown listener (the
// fallback for when fullscreen never engaged) can both observe the
// same Escape keystroke.
let testCancelled = false;
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
  const sessionId = params.get("session");

  if (!sessionId) {
    document.getElementById("setupInfo").textContent = "No test session was specified. Please start a mock test from the Mock Test page.";
    return;
  }

  // RLS already scopes this to the caller's own session rows — no
  // separate ownership check needed beyond .eq("user_id", ...), which
  // is here for defense-in-depth/clarity, not as the real security
  // boundary.
  const { data: sessionRow, error: sessionError } = await supabaseClient
    .from("mock_test_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (sessionError || !sessionRow) {
    document.getElementById("setupInfo").innerHTML =
      '<div style="color:var(--ink-soft); font-size:0.9rem;">This test session could not be found. ' +
      '<a href="mock-test.html">Start a new mock test</a>.</div>';
    return;
  }

  if (sessionRow.status !== "in_progress") {
    // Already completed or expired (e.g. a stale bookmark/back-button
    // to a session that finished or timed out in another tab) — never
    // let a non-in_progress session re-enter the live test screen.
    document.getElementById("setupInfo").innerHTML =
      '<div style="color:var(--ink-soft); font-size:0.9rem;">This test session is no longer active. ' +
      '<a href="mock-test.html">Start a new mock test</a>.</div>';
    return;
  }

  currentSession = sessionRow;

  const { data, error } = await supabaseClient
    .from("mock_tests")
    .select("*, passages(*)")
    .eq("id", sessionRow.mock_test_id)
    .eq("active", true)
    .maybeSingle();

  if (error || !data || !data.passages) {
    document.getElementById("setupInfo").textContent =
      "This mock test could not be loaded. It may be inactive or no longer exist.";
    return;
  }

  mockTest = data;
  selectedPassage = data.passages;

  // Defaults to whichever of 5/10 the mock test's own configured
  // duration is closest to, but the picker below lets the student
  // change it before starting — selectedDurationMinutes (not
  // mockTest.duration) drives the timer/pass-check once the test is
  // running.
  selectedDurationMinutes = mockTest.duration <= 7 ? 5 : 10;

  // Dashboard's Step 1/Step 2 selection flow (js/dashboard.js) already
  // collected both category and duration before ever navigating here
  // — ?duration=&autostart=1 carry that choice over so this page can
  // skip its own duration picker and go straight into the test rather
  // than showing a setup screen asking for something already chosen.
  // Only ever overrides the DEFAULT above — never touches
  // mockTest.duration itself, and does nothing at all to the test
  // engine (startMockTest()/the timer/WPM math) that follows.
  const requestedDuration = Number(params.get("duration"));
  if (requestedDuration === 5 || requestedDuration === 10) {
    selectedDurationMinutes = requestedDuration;
  }
  const shouldAutostart = params.get("autostart") === "1";

  // Access/payment is already settled — this label reflects HOW this
  // session was funded (set by start_or_resume_mock_test/
  // start_reattempt), never re-derived here.
  const accessLabel = mockTest.access_type === "free" ? "Free"
    : sessionRow.access_method === "pass" ? "PASS INCLUDED"
    : "1 CREDIT";

  document.getElementById("setupInfo").innerHTML =
    '<div class="mock-test-title">' + escapeHtml(mockTest.title) + (sessionRow.is_reattempt ? ' <span class="pill">Re-attempt</span>' : '') + '</div>' +
    '<div class="mock-test-meta">' + accessLabel + '</div>' +
    '<div class="mock-duration-picker" id="durationPicker" role="radiogroup" aria-label="Test duration">' +
      '<button type="button" class="mock-duration-btn" data-duration="5">5 Minutes</button>' +
      '<button type="button" class="mock-duration-btn" data-duration="10">10 Minutes</button>' +
    '</div>' +
    '<div class="mock-test-message">Your passage has already been assigned — it will appear the moment you click start.</div>';

  const durationButtons = document.querySelectorAll("#durationPicker .mock-duration-btn");
  function refreshDurationButtons() {
    durationButtons.forEach(btn => {
      const isActive = Number(btn.dataset.duration) === selectedDurationMinutes;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }
  durationButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      selectedDurationMinutes = Number(btn.dataset.duration);
      refreshDurationButtons();
    });
  });
  refreshDurationButtons();

  const startBtn = document.getElementById("startBtn");
  startBtn.style.display = "inline-flex";
  startBtn.addEventListener("click", handleStartClick);

  if (shouldAutostart) {
    // Hidden immediately (before the async checkSingleActiveSession
    // inside handleStartClick even resolves) so the setup screen
    // never has a chance to flash into view first — matches "close
    // the selection card -> enter the typing-test interface" reading
    // as one seamless motion rather than a visible in-between step.
    document.getElementById("setupCard").style.display = "none";
    // Calls the EXACT same function the Start button's own click
    // fires — not a parallel path, so every existing safety check
    // inside it (the just-in-time single-session re-check, marking
    // test_started_at) still runs identically to a manual click.
    handleStartClick();
  }

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
      // Enter is only a valid commit here if the ORIGINAL passage
      // actually has a paragraph break at the current word — i.e.
      // this word is genuinely the last word of its paragraph
      // (isLastInParagraph, set in computeWordRanges() from the
      // real \n positions in the passage content). An Enter pressed
      // anywhere else is ignored completely: no commit, no word
      // advance, no character inserted, nothing counted as an error
      // — exactly as if the keystroke never happened.
      const currentWord = wordRanges[activeWordIndex];
      if (currentWord && currentWord.isLastInParagraph) {
        commitCurrentWord(input.value);
      }
    } else if (e.key === "Escape" && !testActive) {
      // Fallback path for when full-screen never actually engaged
      // (blocked by the browser, or the Fullscreen API unsupported —
      // see enterFullscreen()'s fsRetryBtn branch): in that case
      // there's no fullscreen for the browser to exit, so
      // handleFullscreenChange() would never fire on its own. This
      // keydown listener catches Escape directly in that situation.
      // When fullscreen DID engage, the browser's native exit fires
      // fullscreenchange anyway, which reaches the same
      // cancelUnstartedTest() — the testCancelled guard there means
      // whichever path fires first (or both) only cancels once.
      // Deliberately does NOT preventDefault(): if this browser IS in
      // fullscreen, Escape's native fullscreen-exit is a browser
      // security behavior JS cannot and should not try to block.
      cancelUnstartedTest();
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

  // "Test Not Started" popup — dismiss only, no navigation of its
  // own (cancelUnstartedTest() already returned to the setup screen
  // before this ever shows).
  document.getElementById("testNotStartedOkBtn").addEventListener("click", () => {
    document.getElementById("testNotStartedOverlay").hidden = true;
    document.getElementById("testNotStartedModal").hidden = true;
  });
});

/* ---------------- Starting the test ---------------- */

// Runs when the student presses "Start Mock Test". Unlike the old
// flow, this click no longer touches access/credit logic AT ALL —
// the session already exists and was already fully paid for (pass or
// credit) back on mock-test.html, before this page even loaded. This
// click's only job is to show the test screen/fullscreen.
async function handleStartClick() {

  // Before starting the test (and before any pass/credit consumption
  // later, at first keystroke), re-verify this browser's session is
  // still the active one — a just-in-time check, not just relying on
  // the page-load check from requireLogin(), since a student could
  // sit on this setup screen for a while before clicking Start.
  // checkSingleActiveSession() itself handles the sign-out/redirect
  // if this session was replaced.
  const sessionOk = await checkSingleActiveSession();
  if (!sessionOk) return;

  // Marks the moment the student actually pressed Start (entering the
  // test screen), distinct from when the session itself was created
  // (back on mock-test.html/mock-history.html, when the mock was
  // assigned and any credit consumed). This is what mock-test.html's
  // "Continue Test" banner checks for — a session that was created
  // but never actually started here must not show as resumable,
  // since the student never got past the setup screen for it. A
  // failure here is logged but never blocks starting the test itself
  // — this flag is purely informational for the hub page's banner,
  // not part of access control.
  if (currentSession) {
    const { error } = await supabaseClient.rpc("mark_test_started", { p_session_id: currentSession.id });
    if (error) console.error("mark_test_started RPC error:", error);
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
    mockTest.title + " · " + selectedDurationMinutes + " min · " + selectedPassage.title;

  renderPassage();

  const input = document.getElementById("typeInput");
  input.value = "";
  input.disabled = false;
  input.focus();

  secondsLeft = selectedDurationMinutes * 60;
  updateTimerDisplay();
  updateLiveStats(0, 100, 0);

  testActive = false;
  testScreenOpen = true;
  testStartTime = null;
  testCancelled = false;

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
  } else if (testScreenOpen) {
    // Left full-screen (ESC or otherwise) before typing anything —
    // the test was never started, so this must never be treated as a
    // submission. cancelUnstartedTest() is idempotent (guarded by
    // testCancelled) since the keydown-based Escape handler below can
    // also reach it for the same keystroke.
    cancelUnstartedTest();
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
  // Nothing left in the assigned passage to compare against — this
  // is a fixed-DURATION test now (passage length is only the typing
  // material, never a completion/pass criterion), so reaching the
  // end of the passage does not end the test; it just means there is
  // nothing further to score until the timer itself ends the
  // attempt. Silently stop advancing rather than evaluating against
  // an empty expected string.
  if (activeWordIndex >= wordRanges.length) return;
  if (word.length > 0) {
    evaluateWord(word);
  }
  wordStartPos = typed.length;
  updateActiveWordHighlight();
  scrollActiveWordIntoView();

  const stats = computeLiveStats(typed);
  updateLiveStats(stats.wpm, stats.accuracy, stats.mistakes);
}

function onTypingInput(e) {
  if (!testActive) {
    testActive = true;
    testStartTime = Date.now();
    testTimer = setInterval(tickTimer, 1000);
    // Access/credit consumption already happened before this page
    // loaded (start_or_resume_mock_test/start_reattempt, called from
    // mock-test.html/mock-history.js) — nothing to consume here
    // anymore. The timer still only starts on the first real
    // keystroke, same as before, purely for a responsive/expected
    // typing-test feel — it no longer has anything to do with
    // whether anything gets spent.
  }

  const typed = e.target.value;

  // Evaluate every word boundary (space) that has appeared since the
  // last event — normally just one, but a loop handles any input
  // coalescing safely. wordStartPos always advances from wherever the
  // PREVIOUS space actually landed in `typed`, never from a fixed
  // passage offset — that dynamic anchoring is what keeps word
  // boundaries synchronized even after a missed/extra character.
  // Enter is handled separately (see the keydown listener above) since
  // it never produces a space character for this scan to find. Stops
  // once activeWordIndex reaches the end of the assigned passage —
  // same reasoning as commitCurrentWord() above: this is a fixed-
  // duration test, so running out of passage text just means waiting
  // for the timer, not ending the attempt.
  let spaceIdx;
  while (activeWordIndex < wordRanges.length && (spaceIdx = typed.indexOf(" ", wordStartPos)) !== -1) {
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

/* ---------------- Cancelling an unstarted test ---------------- */

// Called when the student exits (via ESC/fullscreen-exit) BEFORE
// typing anything — testActive is still false, so no timer ever ran.
// This is deliberately NOT a variant of endMockTest(): it never saves
// a result, never touches wordResults/scoring, and never can
// (testActive stays false the whole time, so even if this function
// were somehow skipped, nothing downstream would treat the attempt as
// scoreable). Its only jobs are (1) clean up exactly the same
// page-level state startMockTest() set up — fullscreen, the
// sidebar-hiding body class, the beforeunload guard — and (2) tell
// the student their progress is saved, not lost.
//
// IMPORTANT: unlike the old flow, access/credit consumption already
// happened BEFORE this page even loaded (start_or_resume_mock_test/
// start_reattempt, called from mock-test.html/mock-history.js) — so
// this function does NOT mean "nothing was spent". What it DOES mean
// is that the session itself is untouched here (still status =
// 'in_progress' in the database, since this function never calls any
// RPC) — so the student can pick up the exact same session later from
// the Mock Test page's "Continue Test" card, at no additional cost.
function cancelUnstartedTest(customMessage) {
  if (testCancelled) return;
  testCancelled = true;

  if (testTimer) clearInterval(testTimer);
  testActive = false;
  testScreenOpen = false;
  document.body.classList.remove("mock-test-active");
  window.removeEventListener("beforeunload", beforeUnloadHandler);

  const input = document.getElementById("typeInput");
  if (input) input.disabled = true;

  // Belt-and-suspenders: if still in fullscreen for any reason (e.g.
  // this was reached via the keydown fallback rather than an actual
  // fullscreen-exit), leave it — a cancelled test should never leave
  // the student stuck in a full-screen view of a hidden test card.
  const isFs = document.fullscreenElement || document.webkitFullscreenElement;
  if (isFs) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document).catch(() => {});
  }

  document.getElementById("testCard").style.display = "none";
  document.getElementById("resultCard").style.display = "none";
  document.getElementById("setupCard").style.display = "block";

  showTestNotStartedModal(customMessage);
}

function showTestNotStartedModal(customMessage) {
  const modal = document.getElementById("testNotStartedModal");
  const overlay = document.getElementById("testNotStartedOverlay");
  const msgEl = document.getElementById("testNotStartedMessage");
  if (!modal || !overlay) return;
  if (msgEl) {
    msgEl.textContent = customMessage ||
      "You exited before starting. Your test is still saved — you can continue it anytime from the Mock Test page, at no additional cost.";
  }
  overlay.hidden = false;
  modal.hidden = false;
}

/* ---------------- Ending the test ---------------- */

async function endMockTest(reason) {
  if (testResultSaved) return;

  // Just-in-time re-check before recording/saving anything — a test
  // can run for the full 5-10 minute duration, during which another
  // device could log in and replace this session. checkSingleActiveSession()
  // itself performs the sign-out/redirect/message if invalid; this
  // function must stop completely before touching credits, results,
  // or pass status if that happens — no partial save, no consumed
  // credit, nothing.
  const sessionOk = await checkSingleActiveSession();
  if (!sessionOk) return;

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

  // "Words Typed" is now just this raw count — passage length is
  // deliberately NEVER compared against it (no completion %, no
  // "X / Y words"). wordRanges.length (the passage's own word count)
  // is not read anywhere in this function anymore.
  const wordsTyped = totalWords;

  const elapsedMinutes = testStartTime ? (Date.now() - testStartTime) / 60000 : selectedDurationMinutes;
  const minutesForWpm = reason === "time_up" ? selectedDurationMinutes : Math.max(elapsedMinutes, 0.05);
  const elapsedSeconds = Math.max(Math.round((testStartTime ? Date.now() - testStartTime : selectedDurationMinutes * 60000) / 1000), 0);

  const grossWpm = Math.round((totalTypedChars / 5) / minutesForWpm);
  const netWpm = Math.round((correct / 5) / minutesForWpm);

  // This is now a FIXED-DURATION test, not a passage-completion test.
  // The only way "the required duration was completed" is true is if
  // the timer itself reached zero (reason === "time_up") — any other
  // end reason (fullscreen exit, leaving mid-test) means the student
  // left before the selected 5/10-minute duration elapsed, full stop,
  // regardless of how much of the passage they'd typed or how good
  // their WPM/accuracy were at that moment. Passage length/completion
  // plays no role in this decision at all.
  const requiredDurationCompleted = reason === "time_up";

  // Single authoritative pass/fail decision — see isTestPassed() for
  // the full formula. Computed once here and threaded through to the
  // result screen and the saved record, rather than re-derived
  // separately in either place.
  const passed = isTestPassed(requiredDurationCompleted, accuracy, netWpm);
  const failReasons = passed ? [] : buildFailReasons(requiredDurationCompleted, accuracy, netWpm);

  // weakKeys computed once here (not re-derived separately by the
  // result screen and the print view) so every consumer of the
  // result object sees the identical list.
  const weakKeys = getCurrentTestWeakKeys(keyAnalysis);

  // Requirement 1: exit full-screen once the mock test ends
  exitFullscreen();
  document.getElementById("fsRetryBtn").style.display = "none";

  const result = {
    testDurationMinutes: selectedDurationMinutes,
    wordsTyped,
    elapsedTime: elapsedSeconds,
    grossWpm,
    accuracy,
    netWpm,
    weakKeys,
    keyAnalysis,
    errors,
    passed,
    failReasons,
    requiredDurationCompleted
  };

  showResultTicket(result);
  await saveMockResult(result);
  await saveKeyAnalysis(keyAnalysis);
}

// Builds the specific reason string(s) requested — one per failed
// condition, so e.g. "both fail" produces two entries, matching the
// brief's own worked examples exactly. Only called when passed is
// already false, so this never needs to explain a pass.
function buildFailReasons(requiredDurationCompleted, accuracy, netWpm) {
  const reasons = [];
  if (!requiredDurationCompleted) {
    reasons.push(`Test ended before the required ${selectedDurationMinutes}-minute duration.`);
  }
  if (accuracy < REQUIRED_ACCURACY) {
    reasons.push(`Accuracy was below the required ${REQUIRED_ACCURACY}%.`);
  }
  if (netWpm < REQUIRED_NET_WPM) {
    reasons.push(`Net typing speed was below the required ${REQUIRED_NET_WPM} WPM.`);
  }
  return reasons;
}

// Single source of truth for the required thresholds — this is now
// an EXPLICIT, fixed standard (95% accuracy, 35 WPM net), not reused
// from any prior grade-tier system. Every place that needs these
// numbers (isTestPassed, buildFailReasons, renderPassCriteria) reads
// these two constants, never a hard-coded literal.
const REQUIRED_ACCURACY = 95;
const REQUIRED_NET_WPM = 35;

// This is a FIXED-DURATION test: passed = the selected 5/10-minute
// duration was actually completed (requiredDurationCompleted, true
// only when the test ended via the timer reaching zero — see
// endMockTest) AND accuracy >= 95% AND net WPM >= 35. Passage length
///completion plays no role here at all — a student who exits early
// can never pass regardless of how much of the passage they typed or
// how good their stats were at that moment.
function isTestPassed(requiredDurationCompleted, accuracy, netWpm) {
  return requiredDurationCompleted && accuracy >= REQUIRED_ACCURACY && netWpm >= REQUIRED_NET_WPM;
}

function showResultTicket(r) {
  document.getElementById("testCard").style.display = "none";
  document.getElementById("resultCard").style.display = "block";

  // Pass/fail is now the SINGLE authoritative value computed once in
  // endMockTest() (isTestPassed()) — completion-aware, not just
  // accuracy/speed. Not recomputed here, so the result screen can
  // never show a different verdict than what gets saved.
  const passed = r.passed;

  document.getElementById("resultGrossWpm").textContent = r.grossWpm;
  document.getElementById("resultNetWpm").textContent = r.netWpm;
  document.getElementById("resultAccuracy").textContent = r.accuracy + "%";
  document.getElementById("resultDuration").textContent = formatDurationForResult(r);
  document.getElementById("resultWordsTyped").textContent = r.wordsTyped;

  renderStatusCard(passed, r.requiredDurationCompleted, r.failReasons);
  renderPassCriteria(r);
  renderStatusBadge(passed);
  renderEncouragement(passed);
  wirePrintResults(r, passed);

  showWeakKeyAnalysis(r.keyAnalysis);
}

// "Time Taken" — mm:ss of actual elapsed time when the test ended
// early, or the full scheduled duration for a time_up finish. Reads
// selectedDurationMinutes (the user's actual 5/10-minute choice for
// THIS attempt), never a hard-coded value.
function formatDurationForResult(r) {
  const elapsedMs = testStartTime ? Date.now() - testStartTime : selectedDurationMinutes * 60000;
  const totalSeconds = Math.max(Math.round(elapsedMs / 1000), 0);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return mins + ":" + String(secs).padStart(2, "0") + " min";
}

function renderStatusCard(passed, requiredDurationCompleted, failReasons) {
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
  } else if (!requiredDurationCompleted) {
    // This is a FIXED-DURATION test — the primary "why not passed"
    // reason when the student left early is the duration itself, not
    // anything about the passage (there is no passage-completion
    // concept in this model at all).
    msg.textContent = `Test ended before the required ${selectedDurationMinutes}-minute duration.`;
  } else {
    // Duration was completed but accuracy/speed fell short — join
    // whichever of those failReasons actually apply (could be one or
    // both, per the brief's own "both fail" example).
    msg.textContent = (failReasons && failReasons.length ? failReasons.join(" ") : "Keep practicing! You'll get better with consistency.");
  }
}

// Exact wording requested: a fixed explanatory sentence, then the
// three concrete requirements for THIS attempt's selected duration —
// no passage-completion mention anywhere, no grade tiers.
// Replaces the old "Feedback & Tips" card — three fixed criteria,
// each with a dynamic pass/fail mark computed directly from the same
// result values already used for the overall pass/fail decision
// (r.requiredDurationCompleted / r.accuracy / r.netWpm, and the same
// REQUIRED_ACCURACY/REQUIRED_NET_WPM constants isTestPassed() and
// buildFailReasons() already use) — no new thresholds, no
// duplicate pass/fail logic, this is purely a visual breakdown of
// the SAME decision already made in endMockTest().
function renderPassCriteria(r) {
  const list = document.getElementById("mtrFeedbackList");
  if (!list) return;

  const criteria = [
    { met: r.requiredDurationCompleted, text: "You must complete the selected test duration" },
    { met: r.accuracy >= REQUIRED_ACCURACY, text: "Your accuracy must be at least " + REQUIRED_ACCURACY + "%" },
    { met: r.netWpm >= REQUIRED_NET_WPM, text: "Your net typing speed must be at least " + REQUIRED_NET_WPM + " WPM" }
  ];

  list.innerHTML = criteria.map(c => `
    <div class="mtr-criteria-item">
      <span class="mtr-criteria-mark ${c.met ? "mtr-criteria-met" : "mtr-criteria-unmet"}" aria-hidden="true">
        ${c.met
          ? '<svg width="14" height="14" style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
          : '<svg width="14" height="14" style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'}
      </span>
      <span class="mtr-criteria-text">${c.text}</span>
    </div>
  `).join("");
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
function wirePrintResults(r, passed) {
  const btn = document.getElementById("printResultsBtn");
  if (!btn) return;

  btn.onclick = () => {
    // Reuses r.weakKeys (computed once in endMockTest()) rather than
    // recomputing separately — same list the screen itself shows,
    // never a second independent calculation that could drift.
    const weakKeys = r.weakKeys || [];
    const view = document.getElementById("printResultView");
    view.innerHTML = `
      <div class="print-sheet">
        <div class="print-brand">TypeShala</div>
        <h1>Typing Test Result</h1>
        <div class="print-meta">${escapeHtml(mockTest.title)} &middot; ${escapeHtml(selectedPassage.title)} &middot; ${new Date().toLocaleDateString()}</div>

        <table class="print-table">
          <tr><th>Status</th><td>${passed ? "Passed" : "Not Passed"}</td></tr>
          <tr><th>Test Duration</th><td>${r.testDurationMinutes} minutes</td></tr>
          <tr><th>Words Typed</th><td>${r.wordsTyped}</td></tr>
          <tr><th>Time Taken</th><td>${formatDurationForResult(r)}</td></tr>
          <tr><th>Gross Speed</th><td>${r.grossWpm} WPM</td></tr>
          <tr><th>Net Speed</th><td>${r.netWpm} WPM</td></tr>
          <tr><th>Accuracy</th><td>${r.accuracy}%</td></tr>
          <tr><th>Mistakes</th><td>${r.errors}</td></tr>
          ${!passed && r.failReasons && r.failReasons.length ? `<tr><th>Reason</th><td>${r.failReasons.map(escapeHtml).join(" ")}</td></tr>` : ""}
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
// gross WPM, net WPM, accuracy, errors, created_at (auto).
//
// This is now a FIXED-DURATION test model — duration is the user's
// actual 5/10-minute selection for this attempt (r.testDurationMinutes),
// not the mock test's own configured default. is_completed now means
// "the selected duration was completed" (requiredDurationCompleted),
// not passage completion — same column, re-purposed meaning, since a
// boolean "was this attempt fully completed as required" is still
// exactly what it represents under the new model.
//
// total_passage_words / completion_percentage are intentionally NOT
// populated anymore (left null going forward) — passage length/
// completion is no longer part of this model at all, per explicit
// instruction to stop using those fields. The columns themselves are
// left in place rather than dropped (unnecessary, riskier schema
// change for fields that simply go unused now).
async function saveMockResult(r) {
  if (!currentUser) {
    console.warn("No logged-in user — mock test result was not saved.");
    return;
  }

  if (!currentSession) {
    console.error("No session context — mock test result was not saved.");
    return;
  }

  // Calls complete_mock_session() instead of inserting into
  // mock_test_results directly — this is what atomically marks the
  // SESSION completed (linking result_id back to it) in the same
  // operation as saving the result, which is what makes re-attempt
  // counting and "Tests Completed" both derive from one consistent
  // source of truth. Exact same result fields as the old direct
  // insert — no new value invented, exam_name still left null since
  // the old insert never set it either.
  const { error } = await supabaseClient.rpc("complete_mock_session", {
    p_session_id: currentSession.id,
    p_exam_name: null,
    p_passage_title: selectedPassage.title,
    p_duration: r.testDurationMinutes,
    p_gross_wpm: r.grossWpm,
    p_net_wpm: r.netWpm,
    p_accuracy: r.accuracy,
    p_errors: r.errors,
    p_total_words: r.wordsTyped,
    p_mock_name: mockTest.title,
    p_category: mockTest.category,
    p_passage_id: selectedPassage.id,
    p_is_completed: r.requiredDurationCompleted,
    p_is_passed: r.passed,
    p_words_typed: r.wordsTyped
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

// Continuous RED -> ORANGE -> YELLOW -> GREEN severity gradient,
// reusing this project's own theme colors as the four stops rather
// than inventing new ones (--ts-red / --ts-orange / --ts-gold /
// --ts-green from app-shell.css). t=0 is least severe (green), t=1
// is most severe (red) — smooth linear RGB interpolation between
// whichever two stops t falls between, not a jump between fixed
// bands, so two keys with close-but-different mistake counts get
// visibly close-but-different colors instead of landing in the same
// bucket.
const SEVERITY_GRADIENT_STOPS = [
  { t: 0,    rgb: [21, 154, 72] },   // --ts-green
  { t: 0.34, rgb: [245, 179, 1] },   // --ts-gold (used as the "yellow" stop)
  { t: 0.67, rgb: [224, 124, 42] },  // --ts-orange
  { t: 1,    rgb: [209, 67, 67] }    // --ts-red
];

function severityColorForT(t) {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < SEVERITY_GRADIENT_STOPS.length - 1; i++) {
    const a = SEVERITY_GRADIENT_STOPS[i];
    const b = SEVERITY_GRADIENT_STOPS[i + 1];
    if (clamped >= a.t && clamped <= b.t) {
      const localT = (b.t === a.t) ? 0 : (clamped - a.t) / (b.t - a.t);
      const rgb = [0, 1, 2].map(ch => Math.round(a.rgb[ch] + (b.rgb[ch] - a.rgb[ch]) * localT));
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }
  }
  return `rgb(${SEVERITY_GRADIENT_STOPS[SEVERITY_GRADIENT_STOPS.length - 1].rgb.join(", ")})`;
}

function showWeakKeyAnalysis(keyStats) {
  const container = document.getElementById("weakKeyAnalysis");
  const list = document.getElementById("weakKeyList");
  const chartEl = document.getElementById("weakKeyChart");
  const button = document.getElementById("practiceWeakKeysBtn");
  const tipBox = document.querySelector("#weakKeyAnalysis .mtr-tip-box");
  const axisLeft = document.querySelector("#weakKeyAnalysis .mtr-chart-axis-left");
  const axisRight = document.querySelector("#weakKeyAnalysis .mtr-chart-axis-right");

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

  // The card (and its chart area) is now ALWAYS visible, regardless
  // of whether this test happened to produce any qualifying weak
  // keys — this was the actual bug: the code used to set
  // chartEl.style.display = "none" in the empty case, which hid the
  // ENTIRE chart area (axis labels included) — the exact element the
  // "no weak keys" message was simultaneously being written into,
  // making that message invisible too. The card header and this
  // chart area are unconditional now; only the axis labels/tip box
  // (which only make sense when bars are actually present) and the
  // bar list's own content vary between the two states.
  container.style.display = "block";
  chartEl.style.display = "flex";

  const weakKeys = getCurrentTestWeakKeys(keyStats || {});
  console.debug("showWeakKeyAnalysis: keyStats keys =", keyStats ? Object.keys(keyStats) : keyStats, "-> weakKeys =", weakKeys);

  if (!weakKeys.length) {
    if (axisLeft) axisLeft.style.display = "none";
    if (axisRight) axisRight.style.display = "none";
    if (tipBox) tipBox.style.display = "none";

    // Exact required wording — centered via .weak-key-empty itself
    // (position:absolute; inset:0; flex-centered — see app-shell.css),
    // not just padding, so it's genuinely centered both ways within
    // the full chart height regardless of how tall that ends up being
    // at any viewport width.
    list.innerHTML = '<div class="weak-key-empty">No such weak key detected</div>';

    if (button) button.style.display = "none";
    return;
  }

  if (axisLeft) axisLeft.style.display = "";
  if (axisRight) axisRight.style.display = "";
  if (tipBox) tipBox.style.display = "";

  // Bar HEIGHT is now the actual mistake count, relative to the
  // worst key in this list (tallest bar = the highest error count
  // among THIS test's weak keys, not an accuracy-derived score).
  // Bar COLOR is a continuous severity gradient (see
  // severityColorForT above) based on the same error counts,
  // normalized between the min and max errors actually present here
  // — never fixed thresholds, so the same key can land anywhere on
  // the gradient depending on what the rest of that test's weak keys
  // looked like. If every weak key has the identical error count,
  // min===max and every bar gets the same neutral mid-gradient
  // color rather than one arbitrarily reading as "worse".
  const maxErrors = Math.max(...weakKeys.map(k => k.errors));
  const minErrors = Math.min(...weakKeys.map(k => k.errors));
  const errorRange = maxErrors - minErrors;

  // Display order only — sorted by actual mistake count descending so
  // the tallest/reddest bar is always leftmost, matching "bar height
  // must always represent the actual mistake count". This doesn't
  // touch getCurrentTestWeakKeys()'s own selection/ranking (which
  // sorts by accuracy for choosing WHICH keys qualify) — errors and
  // accuracy don't always agree on ORDER (a key with fewer attempts
  // can have worse accuracy despite fewer raw mistakes), so this
  // re-sorts only for display, on a copy, not the original array.
  const sortedForDisplay = weakKeys.slice().sort((a, b) => b.errors - a.errors);

  list.innerHTML = sortedForDisplay.map((item) => {
    const heightPct = Math.max((item.errors / maxErrors) * 100, 8);
    const severityT = errorRange > 0 ? (item.errors - minErrors) / errorRange : 0.5;
    const barColor = severityColorForT(severityT);

    return `
      <div class="mtr-bar-col">
        <div class="mtr-bar" style="height:${heightPct}%; background-color:${barColor};" title="${item.errors} mistakes, ${Math.round(item.accuracy)}% accuracy"></div>
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
