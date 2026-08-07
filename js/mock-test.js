/* ============================================================
   mock-test.js
   ------------------------------------------------------------
   Runs the Mock Test page. Kept completely independent from
   typing.js so the regular practice test can never be affected
   by anything here.

   Exam name -> passages.category mapping:
     SSC Typing Test       -> 'SSC'
     Court Typing Test     -> 'Court'
     General Practice Test -> 'General'
   ============================================================ */

let currentUser = null;

const EXAM_CATEGORY_MAP = {
  "SSC Typing Test": "SSC",
  "Court Typing Test": "Court",
  "General Practice Test": "General"
};

let selectedExam = "SSC Typing Test";
let selectedDuration = 10; // minutes — 10, 15, or 20 only for mock tests
let selectedPassage = null;

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

  buildExamChoices();
  buildDurationChoices();
  updateSetupNote();

  document.getElementById("startBtn").addEventListener("click", startMockTest);
  document.getElementById("retryBtn").addEventListener("click", resetToSetup);

  const input = document.getElementById("typeInput");
  input.addEventListener("input", onTypingInput);

  // Prevent paste
  input.addEventListener("paste", e => e.preventDefault());
  input.addEventListener("drop", e => e.preventDefault());

  // Prevent right-click during the test
  document.getElementById("testCard").addEventListener("contextmenu", e => e.preventDefault());

  // Keep the caret in the typing box
  input.addEventListener("blur", () => setTimeout(refocusTypingInput, 0));
  document.getElementById("passageBox").addEventListener("click", refocusTypingInput);
  document.getElementById("testCard").addEventListener("click", refocusTypingInput);
});

/* ---------------- Setup screen ---------------- */

function buildExamChoices() {
  const wrap = document.getElementById("examChoices");
  const exams = Object.keys(EXAM_CATEGORY_MAP);
  wrap.innerHTML = "";
  exams.forEach(exam => {
    const btn = document.createElement("div");
    btn.className = "choice" + (exam === selectedExam ? " selected" : "");
    btn.textContent = exam;
    btn.addEventListener("click", () => {
      selectedExam = exam;
      buildExamChoices();
      updateSetupNote();
    });
    wrap.appendChild(btn);
  });
}

function buildDurationChoices() {
  const wrap = document.getElementById("durationChoices");
  const durations = [10, 15, 20];
  wrap.innerHTML = "";
  durations.forEach(min => {
    const btn = document.createElement("div");
    btn.className = "choice" + (min === selectedDuration ? " selected" : "");
    btn.textContent = min + " minutes";
    btn.addEventListener("click", () => {
      selectedDuration = min;
      buildDurationChoices();
      updateSetupNote();
    });
    wrap.appendChild(btn);
  });
}

function updateSetupNote() {
  document.getElementById("setupNote").textContent =
    "A passage will be picked at random for " + selectedExam + " (" + selectedDuration + " min) when you start.";
}

/* ---------------- Starting the test ---------------- */

async function startMockTest() {
  const startBtn = document.getElementById("startBtn");
  startBtn.disabled = true;
  startBtn.textContent = "Loading passage...";

  const category = EXAM_CATEGORY_MAP[selectedExam];

  const { data: passages, error } = await supabaseClient
    .from("passages")
    .select("*")
    .eq("category", category)
    .eq("duration", selectedDuration)
    .eq("active", true);

  startBtn.disabled = false;
  startBtn.textContent = "Start Mock Test";

  if (error || !passages || passages.length === 0) {
    document.getElementById("setupNote").textContent =
      "No passages available yet for " + selectedExam + " at " + selectedDuration +
      " minutes. Please choose a different duration, or ask your admin to add one.";
    return;
  }

  // Requirement: randomly select an active passage
  selectedPassage = passages[Math.floor(Math.random() * passages.length)];

  passageChars = selectedPassage.content.split("");
  wordRanges = computeWordRanges(selectedPassage.content);

  document.getElementById("setupCard").style.display = "none";
  document.getElementById("resultCard").style.display = "none";
  document.getElementById("testCard").style.display = "block";
  hideWarningBanner();

  document.getElementById("testPassageTitle").textContent =
    selectedExam + " · " + selectedDuration + " min · " + selectedPassage.title;

  renderPassage();

  const input = document.getElementById("typeInput");
  input.value = "";
  input.disabled = false;
  input.focus();

  secondsLeft = selectedDuration * 60;
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
    span.id = "mch-" + i;
    box.appendChild(span);
  });
  if (passageChars.length > 0) {
    document.getElementById("mch-0").classList.add("current");
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
    const span = document.getElementById("mch-" + i);
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
      const span = document.getElementById("mch-" + i);
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
  const span = document.getElementById("mch-" + idx);
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
    endMockTest("time_up"); // Disable typing after time ends
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

  const elapsedMinutes = testStartTime ? (Date.now() - testStartTime) / 60000 : selectedDuration;
  const minutesForWpm = reason === "time_up" ? selectedDuration : Math.max(elapsedMinutes, 0.05);

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
  document.getElementById("resultDuration").textContent = selectedDuration + " min";
  document.getElementById("resultErrors").textContent = r.errors;
  document.getElementById("resultTotalWords").textContent = r.totalWords;
  document.getElementById("resultGrade").textContent = gradeFor(r.netWpm, r.accuracy);
  document.getElementById("resultPassageName").textContent =
    selectedExam + " — " + selectedPassage.title;
}

async function saveMockResult(r) {
  if (!currentUser) {
    console.warn("No logged-in user — mock test result was not saved.");
    return;
  }

  const { error } = await supabaseClient.from("mock_test_results").insert({
    user_id: currentUser.id,
    exam_name: selectedExam,
    passage_title: selectedPassage.title,
    duration: selectedDuration,
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

function resetToSetup() {
  hideWarningBanner();
  document.getElementById("resultCard").style.display = "none";
  document.getElementById("testCard").style.display = "none";
  document.getElementById("setupCard").style.display = "block";
  updateSetupNote();
}
