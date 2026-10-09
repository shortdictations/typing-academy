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
  var VALID_THEMES = { light: true, dark: true };

  function syncThemeColor(theme) {
    theme = VALID_THEMES[theme] ? theme : "light";
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
  // browser/PWA title bar immediately without waiting for navigation.
  window.TypeShalaSyncThemeColor = syncThemeColor;

  // Keep the browser title/status bar aligned with the actual landing
  // header theme, including theme changes made by other page controls.
  function syncFromDocumentTheme() {
    var theme = document.documentElement.getAttribute("data-theme");
    if (!VALID_THEMES[theme]) {
      try {
        theme = localStorage.getItem("typeshala-theme") || "light";
        if (theme === "system") {
          theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        }
      } catch (e) { theme = "light"; }
    }
    syncThemeColor(theme);
  }

  if (window.MutationObserver) {
    var themeObserver = new MutationObserver(function () { syncFromDocumentTheme(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  function applyResolvedTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    syncThemeColor(theme);
  }

  try {
    var saved = localStorage.getItem("typeshala-theme") || "system";
    var systemPrefersDark = !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    var resolved = saved === "system"
      ? (systemPrefersDark ? "dark" : "light")
      : (VALID_THEMES[saved] ? saved : "light");
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
