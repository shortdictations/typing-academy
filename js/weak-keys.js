/* ============================================================
   weak-keys.js
   ------------------------------------------------------------
   Standalone practice flow — deliberately separate from the real
   mock-test engine in js/mock-test-attempt.js (no fullscreen, no
   timer, no paste/backspace blocking, no pass/credit access
   control). This page is casual practice, not a scored test, so it
   doesn't need any of that; nothing here modifies mock_test_results,
   mock_unlocks, or any pass/credit logic.

   V1, no AI: a small local word dictionary per letter, matching the
   brief. Extended to cover all 26 letters (the brief's own example
   only showed T/R/H/G) so the page works for whichever key a
   student is actually weak on, not just those four.
   ============================================================ */

const weakKeyWords = {
  A: ["about", "again", "answer", "always", "after", "along", "area", "ability"],
  B: ["because", "between", "before", "business", "better", "begin", "below"],
  C: ["correct", "career", "could", "create", "control", "count", "current"],
  D: ["during", "different", "develop", "detail", "design", "decide", "duty"],
  E: ["every", "example", "each", "either", "effect", "enough", "explain"],
  F: ["first", "found", "form", "further", "focus", "finish", "field"],
  G: ["great", "typing", "going", "good", "again", "training", "growth"],
  H: ["the", "there", "three", "high", "right", "health", "through"],
  I: ["important", "include", "instead", "information", "inside", "into"],
  J: ["just", "job", "join", "judge", "journal", "journey"],
  K: ["keep", "know", "kind", "key", "known", "keyboard"],
  L: ["level", "little", "language", "large", "learn", "local", "long"],
  M: ["make", "most", "month", "material", "member", "moment", "measure"],
  N: ["never", "number", "need", "note", "next", "nature", "notice"],
  O: ["other", "over", "office", "order", "often", "operate", "outcome"],
  P: ["practice", "people", "place", "point", "public", "prepare", "produce"],
  Q: ["quick", "quality", "question", "quiet", "quite"],
  R: ["right", "write", "great", "practice", "correct", "result", "career"],
  S: ["should", "system", "service", "similar", "start", "student", "success"],
  T: ["the", "that", "there", "three", "through", "time", "today", "type", "typing"],
  U: ["under", "until", "unit", "using", "usual", "update"],
  V: ["value", "various", "visit", "version", "view"],
  W: ["would", "write", "with", "work", "world", "week"],
  X: ["export", "extra", "exact", "example", "exercise"],
  Y: ["your", "year", "yet", "yourself"],
  Z: ["zero", "zone"]
};

let currentUser = null;
let practiceKeys = [];
let practicePassage = "";
let baselineStats = {}; // key -> {accuracy} at the moment this page loaded

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return;
  currentUser = user;

  const params = new URLSearchParams(window.location.search);
  const urlKeys = (params.get("keys") || "").split(",").map(k => k.trim().toUpperCase()).filter(Boolean);

  practiceKeys = urlKeys.length ? urlKeys : await loadWeakestKeysFromDb(user.id);

  if (!practiceKeys.length) {
    document.getElementById("practiceSetupCard").style.display = "none";
    document.getElementById("practiceEmptyCard").style.display = "block";
    return;
  }

  await loadBaseline(user.id, practiceKeys);
  setupPracticeSession();

  document.getElementById("finishPracticeBtn").addEventListener("click", finishPractice);
  document.getElementById("practiceAgainBtn").addEventListener("click", () => {
    setupPracticeSession();
    document.getElementById("practiceResultCard").style.display = "none";
    document.getElementById("practiceSetupCard").style.display = "block";
  });
});

// No keys passed in the URL (e.g. the student navigated here
// directly) — fall back to their real weakest keys, same lifetime
// threshold as the dashboard card so the two stay consistent.
async function loadWeakestKeysFromDb(userId) {
  const { data, error } = await supabaseClient
    .from("typing_key_stats")
    .select("key, attempts, correct_count, error_count")
    .eq("user_id", userId)
    .gte("attempts", 30)
    .order("error_count", { ascending: false })
    .limit(5);

  if (error || !data) return [];

  return data
    .map(item => ({ key: item.key, accuracy: item.attempts > 0 ? (item.correct_count / item.attempts) * 100 : 100 }))
    .filter(item => item.accuracy < 90)
    .map(item => item.key);
}

// Baseline accuracy per key BEFORE this practice session, so the
// "Overall improvement" figure at the end reflects this session's
// effect, not just an absolute number with nothing to compare to.
async function loadBaseline(userId, keys) {
  baselineStats = {};
  const { data } = await supabaseClient
    .from("typing_key_stats")
    .select("key, attempts, correct_count")
    .eq("user_id", userId)
    .in("key", keys);

  (data || []).forEach(row => {
    baselineStats[row.key] = row.attempts > 0 ? (row.correct_count / row.attempts) * 100 : 100;
  });
}

function setupPracticeSession() {
  document.getElementById("practiceKeysDisplay").innerHTML = practiceKeys
    .map(k => '<span class="weak-keys-card-letter">' + k + '</span>')
    .join("");

  practicePassage = buildPracticeParagraph(practiceKeys);
  document.getElementById("practicePassageDisplay").textContent = practicePassage;

  const input = document.getElementById("practiceInput");
  input.value = "";
  input.disabled = false;
  input.focus();
}

// Picks words containing at least one of the weak keys (falling back
// to any word from that key's list if none happens to overlap
// multiple), shuffles lightly, and joins into a short paragraph —
// matching the brief's "select words containing the user's weak
// keys... create a short practice paragraph" instruction directly,
// no AI involved.
function buildPracticeParagraph(keys) {
  const pool = [];
  keys.forEach(key => {
    const words = weakKeyWords[key] || [];
    words.forEach(w => pool.push(w));
  });

  if (pool.length === 0) return "practice makes perfect";

  // Deduplicate, then pick a reasonable-length paragraph (10-14 words)
  const unique = Array.from(new Set(pool));
  const shuffled = unique.slice().sort(() => Math.random() - 0.5);
  const wordCount = Math.min(Math.max(unique.length, 8), 14);
  const chosen = [];
  for (let i = 0; i < wordCount; i++) {
    chosen.push(shuffled[i % shuffled.length]);
  }
  return chosen.join(" ");
}

async function finishPractice() {
  const input = document.getElementById("practiceInput");
  const typed = input.value;
  input.disabled = true;

  const sessionStats = calculatePracticeKeyStats(typed, practicePassage, practiceKeys);
  await savePracticeStats(sessionStats);
  showPracticeResult(sessionStats);

  document.getElementById("practiceSetupCard").style.display = "none";
  document.getElementById("practiceResultCard").style.display = "block";
}

// Same expected-vs-typed comparison rule as calculateKeyAnalysis in
// mock-test-attempt.js (record the EXPECTED character), scoped here
// to only the keys actually being practiced — a stray typo on an
// unrelated letter shouldn't appear in a "weak-key practice" result.
function calculatePracticeKeyStats(typed, passage, keys) {
  const stats = {};
  keys.forEach(k => { stats[k] = { attempts: 0, correct: 0 }; });

  for (let i = 0; i < typed.length && i < passage.length; i++) {
    const expected = passage[i];
    if (!/^[a-zA-Z]$/.test(expected)) continue;
    const key = expected.toUpperCase();
    if (!keys.includes(key)) continue;

    stats[key].attempts++;
    if (typed[i] === expected) stats[key].correct++;
  }
  return stats;
}

async function savePracticeStats(sessionStats) {
  if (!currentUser) return;
  for (const [key, stat] of Object.entries(sessionStats)) {
    if (stat.attempts === 0) continue;
    const errors = stat.attempts - stat.correct;

    const { data: existing } = await supabaseClient
      .from("typing_key_stats")
      .select("attempts, correct_count, error_count")
      .eq("user_id", currentUser.id)
      .eq("key", key)
      .maybeSingle();

    if (existing) {
      await supabaseClient
        .from("typing_key_stats")
        .update({
          attempts: existing.attempts + stat.attempts,
          correct_count: existing.correct_count + stat.correct,
          error_count: existing.error_count + errors,
          last_attempted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("user_id", currentUser.id)
        .eq("key", key);
    } else {
      await supabaseClient.from("typing_key_stats").insert({
        user_id: currentUser.id,
        key,
        attempts: stat.attempts,
        correct_count: stat.correct,
        error_count: errors,
        last_attempted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }
  }
}

function showPracticeResult(sessionStats) {
  const list = document.getElementById("practiceResultList");
  const improvementEl = document.getElementById("practiceImprovement");

  let deltaSum = 0;
  let deltaCount = 0;

  list.innerHTML = practiceKeys.map(key => {
    const stat = sessionStats[key] || { attempts: 0, correct: 0 };
    const sessionAccuracy = stat.attempts > 0 ? (stat.correct / stat.attempts) * 100 : null;
    const baseline = baselineStats[key];

    if (sessionAccuracy !== null && baseline !== undefined) {
      deltaSum += (sessionAccuracy - baseline);
      deltaCount++;
    }

    const displayAccuracy = sessionAccuracy !== null ? Math.round(sessionAccuracy) + "%" : "&mdash;";
    const meta = sessionAccuracy !== null
      ? stat.attempts + " occurrences this session"
      : "This key didn't appear in what you typed";

    return `
      <div class="weak-key-item">
        <div class="weak-key-letter">${key}</div>
        <div class="weak-key-info">
          <div class="weak-key-name">${displayAccuracy}</div>
          <div class="weak-key-meta">${meta}</div>
        </div>
      </div>`;
  }).join("");

  if (deltaCount > 0) {
    const avgDelta = Math.round(deltaSum / deltaCount);
    const sign = avgDelta >= 0 ? "+" : "";
    improvementEl.textContent = "Overall improvement: " + sign + avgDelta + "%";
  } else {
    improvementEl.textContent = "";
  }
}
