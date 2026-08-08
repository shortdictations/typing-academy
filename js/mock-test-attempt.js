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

  document.getElementById("setupInfo").innerHTML =
    '<div style="font-family:var(--font-display); font-size:1.3rem; font-weight:700;">' + escapeHtml(mockTest.title) + '</div>' +
    '<div style="color:var(--ink-soft); margin-top:6px;">' + mockTest.duration + ' minutes &middot; ' +
    (mockTest.access_type === "premium" ? "Premium" : "Free") + '</div>' +
    '<div style="color:var(--ink-soft); margin-top:10px; font-size:0.85rem;">Your passage has already been assigned — it will appear the moment you click start.</div>';

  const startBtn = document.getElementById("startBtn");
  startBtn.style.display = "inline-block";
  startBtn.addEventListener("click", startMockTest);

  const input = document.getElementById("typeInput");
  input.addEventListener("input", onTypingInput);
  input.addEventListener("paste", e => e.preventDefault());
  input.addEventListener("drop", e => e.preventDefault());

  document.getElementById("testCard").addEventListener("contextmenu", e => e.preventDefault());

  input.addEventListener("blur", () => setTimeout(refocusTypingInput, 0));
  document.getElementById("passageBox").addEventListener("click", refocusTypingInput);
  document.getElementById("testCard").addEventListener("click", refocusTypingInput);
});

/* ---------------- Starting the test ---------------- */

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
  updateLiveStats(0, 100);

  testActive = false;
  testScreenOpen = true;
  testStartTime = null;

  if (testTimer) clearInterval(testTimer);

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
  updateLiveStats(wpm, accuracy);

  if (typed.length >= passageChars.length) {
    endMockTest("completed");
  }
}

function applyWordHighlighting(typed) {
  const cursorPos = typed.length;
  wordRanges.forEach(w => {
    for (let i = w.start; i < w.end; i++) {
      const span = document.getElementById("amch-" + i);
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

function scrollCurrentLineIntoView(typed) {
  const idx = Math.min(typed.length, passageChars.length - 1);
  const span = document.getElementById("amch-" + idx);
  if (span) span.scrollIntoView({ block: "nearest", inline: "nearest" });
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

function updateLiveStats(wpm, accuracy) {
  document.getElementById("liveWpm").textContent = wpm;
  document.getElementById("liveAccuracy").textContent = accuracy + "%";
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
  const errors = totalTypedChars - correct;

  const elapsedMinutes = testStartTime ? (Date.now() - testStartTime) / 60000 : mockTest.duration;
  const minutesForWpm = reason === "time_up" ? mockTest.duration : Math.max(elapsedMinutes, 0.05);

  const grossWpm = Math.round((totalTypedChars / 5) / minutesForWpm);
  const netWpm = Math.round((correct / 5) / minutesForWpm);

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
