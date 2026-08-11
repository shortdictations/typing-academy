/* ============================================================
   mock-test.js
   ------------------------------------------------------------
   Runs the Mock Test HUB page (mock-test.html) — the SSC/Legal
   category cards plus the two Credit-Based Tests category cards
   (SSC CBT / Legal CBT). Individual CBT tests are never listed
   here; they live only on cbt-list.html (in js/cbt-list.js),
   reached directly from these cards — no intermediate page. This page needs no
   credit-fetching logic anymore — just the login check.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return; // requireLogin already redirected to login.html
});
