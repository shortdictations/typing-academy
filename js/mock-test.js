/* ============================================================
   mock-test.js
   ------------------------------------------------------------
   Runs the Mock Test HUB page (mock-test.html) — the SSC/Legal
   category cards. Each category's own list (mock-test-list.js)
   shows every test in it, with access resolved per test (an
   eligible Pass first, then Credits as a fallback) — there is
   no longer a separate Credit-Based Tests category or page.
   This page needs no credit-fetching logic — just the login
   check.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return; // requireLogin already redirected to login.html
});
