/* ============================================================
   mock-test.js
   ------------------------------------------------------------
   Runs the Mock Test HUB page (mock-test.html) — the SSC/Legal
   category cards.

   This page is being migrated away from as the primary entry point
   (the dashboard's own Step 1/Step 2 flow is now preferred), but is
   kept working rather than deleted outright until every remaining
   link to it has been moved. It has no duration picker of its own,
   so it always requests the 10-minute ("Full Practice") duration —
   the student can still change this on mock-test-attempt.html's own
   setup screen afterward, which keeps the session's stored duration
   in sync via update_session_duration() when they do.

   category buttons call start_or_resume_mock_test(category, duration)
   directly, a single SECURITY DEFINER RPC that atomically checks for
   an unfinished session first (never creates a second one), then
   checks access (pass, then credit), selects ONE eligible mock
   server-side (preferring one never attempted, unlimited repeats
   allowed after that), and creates the session — all before this
   page ever redirects anywhere. Nothing about access/credit/re-
   attempt-limit logic lives in this file; it only calls the RPC and
   reacts to its result.
   ============================================================ */

let currentUser = null;

// This page offers no duration choice of its own — see the file
// comment above for why 10 was chosen as the default.
const DEFAULT_DURATION_MINUTES = 10;

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireLogin();
  if (!currentUser) return; // requireLogin already redirected to login.html

  await checkForUnfinishedSession();

  document.getElementById("startSscBtn").addEventListener("click", () => handleStartClick("ssc"));
  document.getElementById("startLegalBtn").addEventListener("click", () => handleStartClick("legal"));
});

// Read-only check so the page can show "Continue Test" immediately on
// load, before the student even clicks a category. The RLS policy on
// mock_test_sessions already scopes this to the caller's own rows;
// nothing here can see another student's session.
//
// Shows the banner for ANY in_progress session, full stop — status
// alone is the authoritative signal for "does an active session
// exist" (a previous version additionally required test_started_at
// to be set, to avoid the banner appearing for a session the student
// had technically created but never actually pressed Start on; that
// extra condition has been removed, since the server-side start
// flow itself never used it for the equivalent access-blocking
// decision either — status = 'in_progress' was always the sole
// authoritative signal there, and the two are now consistent).
async function checkForUnfinishedSession() {
  const { data, error } = await supabaseClient
    .from("mock_test_sessions")
    .select("id")
    .eq("user_id", currentUser.id)
    .eq("status", "in_progress")
    .maybeSingle();

  if (error) {
    console.error("Could not check for an unfinished session:", error);
    return;
  }

  if (data) {
    document.getElementById("unfinishedTestCard").style.display = "block";
    document.getElementById("categoryCardsGrid").style.display = "none";
    document.getElementById("continueTestBtn").href = "mock-test-attempt.html?session=" + encodeURIComponent(data.id);
  }
}

async function handleStartClick(category) {
  const btn = document.getElementById(category === "ssc" ? "startSscBtn" : "startLegalBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Please wait...";

  try {
    const { data, error } = await supabaseClient.rpc("start_or_resume_mock_test", { p_category: category, p_duration: DEFAULT_DURATION_MINUTES });

    if (error) {
      console.error("start_or_resume_mock_test RPC error:", error);
      showStartError("Something went wrong starting the test. Please try again.");
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result || !result.session_id) {
      if (result && result.access_reason === "NO_CREDITS") {
        showStartError('You need an active eligible Pass or at least 1 Credit to take this test. <a href="subscriptions.html">View Passes &amp; Credits</a>.');
      } else if (result && result.access_reason === "NO_ELIGIBLE_MOCK") {
        showStartError("No mock tests are available in this category right now. Please check back later.");
      } else {
        showStartError("Could not start the test. Please try again.");
      }
      return;
    }

    // A resumed session may belong to a DIFFERENT category than the
    // one just clicked — one active session per user is GLOBAL across
    // SSC and Legal, not per-category, so clicking Legal while an
    // unfinished SSC session still exists correctly resumes the SSC
    // one rather than starting a new Legal one. Silently redirecting
    // in that case looks exactly like "the wrong category got
    // assigned" from the student's point of view — this makes clear
    // what's actually happening before navigating away, without
    // changing which session gets resumed at all. Cancel means the
    // student stays right here, on this page, with nothing navigated.
    if (result.is_resumed) {
      const proceed = await showUnfinishedTestModal({
        mockTitle: result.mock_title,
        category: result.mock_category,
        duration: result.mock_duration,
        startedAt: result.session_started_at
      });
      if (!proceed) return;
    }

    window.location.href = "mock-test-attempt.html?session=" + encodeURIComponent(result.session_id) + "&duration=" + DEFAULT_DURATION_MINUTES;
  } catch (err) {
    console.error("start_or_resume_mock_test failed:", err);
    showStartError("Something went wrong starting the test. Please try again.");
  } finally {
    // Only reached if we did NOT navigate away (i.e. an error/denial
    // path returned above) — safe to always reset here since a
    // successful redirect abandons this page anyway.
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function showStartError(html) {
  let box = document.getElementById("mockStartError");
  if (!box) {
    box = document.createElement("div");
    box.id = "mockStartError";
    box.className = "error-msg";
    box.style.marginBottom = "16px";
    document.getElementById("categoryCardsGrid").insertAdjacentElement("beforebegin", box);
  }
  box.innerHTML = html;
  box.style.display = "block";
}
