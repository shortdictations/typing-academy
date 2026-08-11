/* ============================================================
   mock-test.js
   ------------------------------------------------------------
   Runs the Mock Test HUB page (mock-test.html) — the SSC/Legal
   category cards plus the static Credit-Based Tests gateway card.
   Individual CBT tests are no longer listed here; they live on
   cbt.html (category selection) and cbt-list.html (the actual
   per-category list, in js/cbt-list.js). This page needs no
   credit-fetching logic anymore — just the login check.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin();
  if (!user) return; // requireLogin already redirected to login.html
});
