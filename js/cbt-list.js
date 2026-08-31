/* ============================================================
   cbt-list.js
   ------------------------------------------------------------
   Credit-Based Tests are no longer a separate browsing category
   (TypeShala access model update: PASS and CREDIT are now two
   access methods for the SAME SSC/Legal test library, not two
   separate libraries). Every test that used to live only here
   now appears inline in the unified per-category list on
   mock-test-list.html, with its access shown as PASS INCLUDED,
   1 CREDIT, or a locked state as appropriate.

   This page is kept only so old bookmarks/links to
   cbt-list.html don't break — it immediately redirects to the
   same category's unified list. No listing/credit-balance logic
   lives here anymore.
   ============================================================ */

(function () {
  const params = new URLSearchParams(window.location.search);
  const category = params.get("category") === "legal" ? "legal" : "ssc";
  window.location.replace("mock-test-list.html?category=" + category);
})();
