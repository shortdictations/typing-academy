/* ============================================================
   theme-init.js
   ------------------------------------------------------------
   Loaded as a blocking <script> (no defer/async) in <head>, before
   the stylesheets and before <body>, so the theme is set on
   <html data-theme="..."> before first paint — no flash of the
   wrong theme. Shared by every app-shell page (dashboard.html,
   settings.html, help-support.html) so a theme chosen on one page
   applies immediately on the next. The actual choosing UI and
   persistence lives in js/theme.js, loaded normally later in the
   page alongside the rest of that page's scripts.
   ============================================================ */
(function () {
  try {
    var saved = localStorage.getItem("typeshala-theme") || "system";
    var resolved = saved === "system"
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : saved;
    document.documentElement.setAttribute("data-theme", resolved);

    // Live-update if the OS theme changes while "System" is selected
    // and this page stays open — only meaningful in that mode.
    if (saved === "system" && window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
        document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      });
    }
  } catch (e) { /* localStorage unavailable — default (light) styling applies */ }
})();
