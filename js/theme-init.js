/* ============================================================
   theme-init.js
   ------------------------------------------------------------
   Runs in <head> before first paint to resolve the saved theme,
   and keeps the Android/browser status-bar color matched to the
   shared TypeShala header in both light and dark themes.
   ============================================================ */
(function () {
  var LIGHT_HEADER_COLOR = "#FFFFFF";
  var DARK_HEADER_COLOR = "#131A28";

  function syncThemeColor(theme) {
    var color = theme === "dark" ? DARK_HEADER_COLOR : LIGHT_HEADER_COLOR;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", color);
  }

  // Expose the same updater so the Settings toggle can update the
  // browser status bar immediately without waiting for navigation.
  window.TypeShalaSyncThemeColor = syncThemeColor;

  function applyResolvedTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    syncThemeColor(theme);
  }

  try {
    var saved = localStorage.getItem("typeshala-theme") || "system";
    var resolved = saved === "system"
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : saved;
    applyResolvedTheme(resolved);

    // Follow OS theme changes while System is selected.
    if (saved === "system" && window.matchMedia) {
      var media = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function (e) { applyResolvedTheme(e.matches ? "dark" : "light"); };
      if (media.addEventListener) media.addEventListener("change", onChange);
      else if (media.addListener) media.addListener(onChange);
    }
  } catch (e) {
    // Keep the default light header/status-bar colors if storage is unavailable.
    syncThemeColor("light");
  }
})();
