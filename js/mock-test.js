/* ============================================================
   mock-test.js
   ------------------------------------------------------------
   Runs the Mock Test HUB page (mock-test.html) — the SSC/Legal
   category cards.

   REWRITTEN as part of the automatic-mock-selection system:
   category buttons no longer link to a list of individual mocks to
   choose from (mock-test-list.html) — they call
   start_or_resume_mock_test(category) directly, a single
   SECURITY DEFINER RPC that atomically checks for an unfinished
   session first (never creates a second one), then checks access
   (pass, then credit), selects ONE eligible mock server-side
   (preferring one never attempted), and creates the session — all
   before this page ever redirects anywhere. Nothing about
   access/credit logic lives in this file; it only calls the RPC and
   reacts to its result.
   ============================================================ */

let currentUser = null;

document.addEventListener("DOMContentLoaded", async () => {
  currentUser = await requireLogin();
  if (!currentUser) return; // requireLogin already redirected to login.html

  await checkForUnfinishedSession();

  document.getElementById("startSscBtn").addEventListener("click", () => handleStartClick("ssc"));
  document.getElementById("startLegalBtn").addEventListener("click", () => handleStartClick("legal"));
});

// Read-only check so the page can show "Continue Test" immediately on
// load, before the student even clicks a category — matches spec
// §27's example UI. The RLS policy on mock_test_sessions already
// scopes this to the caller's own rows; nothing here can see another
// student's session.
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
    const { data, error } = await supabaseClient.rpc("start_or_resume_mock_test", { p_category: category });

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

    // Redirect regardless of is_resumed — the attempt page itself
    // reads the session's own state and shows the right screen
    // (fresh setup vs. resumed-in-progress) rather than this page
    // needing to know the difference.
    window.location.href = "mock-test-attempt.html?session=" + encodeURIComponent(result.session_id);
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
