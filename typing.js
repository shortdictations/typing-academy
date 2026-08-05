/* ============================================================
   typing.js
   ------------------------------------------------------------
   Runs the typing test screen: passage selection, countdown
   timer, live WPM/accuracy, and saving the final result to
   Supabase when the test ends.
   ============================================================ */

let currentUser = null;

// Test configuration chosen on the setup screen
let selectedCategory = "SSC";
let selectedDuration = 5;     // minutes
let selectedPassage = null;   // the passage object from passages.js

// Live test state
let testTimer = null;
let secondsLeft = 0;
let testStartTime = null;
let testActive = false;
let passageChars = [];        // array of single characters from the passage text

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireLogin();
  if (!currentUser) return;

  buildCategoryChoices();
  buildDurationChoices();
  refreshPassageOptions();

  document.getElementById("startBtn").addEventListener("click", startTest);
  document.getElementById("retryBtn").addEventListener("click", resetToSetup);
  document.getElementById("typeInput").addEventListener("input", onTypingInput);
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
    btn.addEventListener("click", () => {
      selectedCategory = cat;
      buildCategoryChoices();
      refreshPassageOptions();
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
    btn.addEventListener("click", () => {
      selectedDuration = min;
      buildDurationChoices();
    });
    wrap.appendChild(btn);
  });
}

function refreshPassageOptions() {
  const select = document.getElementById("passageSelect");
  const options = getPassagesByCategory(selectedCategory);
  select.innerHTML = "";
  options.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.title;
    select.appendChild(opt);
  });
}

/* ---------------- Starting a test ---------------- */

function startTest() {
  const passageId = document.getElementById("passageSelect").value;
  selectedPassage = getPassageById(passageId);
  if (!selectedPassage) return;

  const text = selectedDuration === 5 ? selectedPassage.short : selectedPassage.long;
  passageChars = text.split("");

  // Swap screens
  document.getElementById("setupCard").style.display = "none";
  document.getElementById("resultCard").style.display = "none";
  document.getElementById("testCard").style.display = "block";

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

  testActive = false; // becomes true on first keystroke
  testStartTime = null;

  if (testTimer) clearInterval(testTimer);
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

  const accuracy = typed.length > 0 ? Math.round((correct / typed.length) * 100) : 100;
  const minutesElapsed = testStartTime ? (Date.now() - testStartTime) / 60000 : 0;
  const wpm = minutesElapsed > 0 ? Math.round((typed.length / 5) / minutesElapsed) : 0;
  updateLiveStats(wpm, accuracy);

  // Finished the whole passage correctly and completely -> end early
  if (typed.length >= passageChars.length) {
    endTest("completed");
  }
}

function tickTimer() {
  secondsLeft--;
  updateTimerDisplay();
  if (secondsLeft <= 0) {
    endTest("time_up");
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

/* ---------------- Ending a test ---------------- */

async function endTest(reason) {
  if (testTimer) clearInterval(testTimer);
  testActive = false;

  const input = document.getElementById("typeInput");
  input.disabled = true;

  const typed = input.value;
  let correct = 0;
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] === passageChars[i]) correct++;
  }

  const totalTypedChars = typed.length;
  const accuracy = totalTypedChars > 0 ? Math.round((correct / totalTypedChars) * 100) : 0;

  // If the test ended because time ran out, use the FULL selected
  // duration for WPM. If the student finished early, use actual
  // elapsed time so fast finishers get credit for their real speed.
  const elapsedMinutes = testStartTime
    ? (Date.now() - testStartTime) / 60000
    : selectedDuration;
  const minutesForWpm = reason === "time_up" ? selectedDuration : Math.max(elapsedMinutes, 0.05);
  const wpm = Math.round((correct / 5) / minutesForWpm);

  showResultTicket(wpm, accuracy, totalTypedChars, correct);
  await saveResult(wpm, accuracy, totalTypedChars, correct);
}

function gradeFor(wpm, accuracy) {
  if (accuracy < 80) return "RETRY";
  if (wpm >= 45) return "A+";
  if (wpm >= 35) return "A";
  if (wpm >= 25) return "B";
  return "C";
}

function showResultTicket(wpm, accuracy, totalTypedChars, correct) {
  document.getElementById("testCard").style.display = "none";
  document.getElementById("resultCard").style.display = "block";

  document.getElementById("resultWpm").textContent = wpm;
  document.getElementById("resultAccuracy").textContent = accuracy + "%";
  document.getElementById("resultDuration").textContent = selectedDuration + " min";
  document.getElementById("resultChars").textContent = correct + " / " + totalTypedChars;
  document.getElementById("resultGrade").textContent = gradeFor(wpm, accuracy);
  document.getElementById("resultPassageName").textContent =
    selectedPassage.title + " (" + selectedCategory + ")";
}

async function saveResult(wpm, accuracy, totalTypedChars, correct) {
  try {
    await supabaseClient.from("results").insert({
      user_id: currentUser.id,
      passage_title: selectedPassage.title,
      category: selectedCategory,
      duration_minutes: selectedDuration,
      wpm: wpm,
      accuracy: accuracy,
      correct_chars: correct,
      total_chars: totalTypedChars
    });
  } catch (err) {
    console.error("Could not save result:", err);
  }
}

function resetToSetup() {
  document.getElementById("resultCard").style.display = "none";
  document.getElementById("testCard").style.display = "none";
  document.getElementById("setupCard").style.display = "block";
}
