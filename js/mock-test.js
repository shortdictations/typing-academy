/* ============================================================
   mock-test.js
   ------------------------------------------------------------
   Runs the Mock Test HUB page (mock-test.html) — just the two
   category cards. All actual test-taking logic now lives in
   js/mock-test-attempt.js; the exam/duration picker that used
   to live here has been replaced by the mock_tests catalog.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return; // requireLogin already redirected to login.html
});
