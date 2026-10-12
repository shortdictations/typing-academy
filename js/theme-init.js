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

  // Use the actual rendered header colour per page: the public landing
  // page is white in light mode, while authenticated pages use navy.
  function syncFromRenderedHeader() {
    var theme = document.documentElement.getAttribute("data-theme") || "light";

    // The public landing page intentionally uses a transparent/glass header.
    // Its computed background may be rgba(..., 0), which is not a reliable
    // browser/status-bar colour. Use the selected theme as the source of truth.
    if (document.body && document.body.classList.contains("landing-v2")) {
      syncThemeColor(theme);
      return;
    }

    var selectors = [
      "body.app-shell .letterhead",
      "body.auth-page .letterhead",
      "body:not(.landing-v2) .letterhead",
      "body.landing-v2 .site-header"
    ];
    var header = null;
    for (var i = 0; i < selectors.length && !header; i++) {
      header = document.querySelector(selectors[i]);
    }
    if (!header) { syncThemeColor(theme); return; }
    var bg = window.getComputedStyle(header).backgroundColor;
    // Never turn a transparent background into an opaque hex colour.
    var rgba = bg && bg.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/i);
    if (!rgba) { syncThemeColor(theme); return; }
    if (rgba[4] !== undefined && parseFloat(rgba[4]) < 1) {
      syncThemeColor(theme);
      return;
    }
    var match = rgba;
    var color = "#" + [match[1], match[2], match[3]].map(function (v) {
      return Number(v).toString(16).padStart(2, "0");
    }).join("").toUpperCase();
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", color);
  }

  function scheduleHeaderColorSync() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", syncFromRenderedHeader, { once: true });
    } else {
      syncFromRenderedHeader();
    }
  }
  scheduleHeaderColorSync();

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
    var themeObserver = new MutationObserver(function () {
      syncFromDocumentTheme();
      scheduleHeaderColorSync();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("DOMContentLoaded", function () {
      var header = document.querySelector("header");
      if (header) {
        var headerObserver = new MutationObserver(scheduleHeaderColorSync);
        headerObserver.observe(header, { attributes: true, attributeFilter: ["class", "style"] });
      }
      scheduleHeaderColorSync();
    }, { once: true });
  }


  // Installed desktop PWA: reveal a small close control only when the
  // pointer reaches the top edge. Never show it during a live mock test:
  // the existing mock-test fullscreen/termination handlers remain authoritative.
  function initDesktopAppCloseControl() {
    var standalone = false;
    try {
      standalone = window.matchMedia("(display-mode: fullscreen)").matches ||
        window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;
    } catch (e) {}
    var ua = navigator.userAgent || "";
    var isDesktop = !/Android|iPhone|iPad|iPod/i.test(ua) &&
      (/(Windows NT|Macintosh|X11|Linux x86_64)/i.test(ua)) &&
      !(navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua));
    if (!standalone || !isDesktop || document.getElementById("ts-app-close-control")) return;

    var style = document.createElement("style");
    style.id = "ts-app-close-style";
    style.textContent = `
      #ts-app-close-control{position:fixed;z-index:2147483000;top:8px;right:10px;width:34px;height:34px;display:grid;place-items:center;border:1px solid rgba(148,163,184,.26);border-radius:50%;background:rgba(255,255,255,.94);color:#263247;box-shadow:0 5px 20px rgba(15,23,42,.18);font:400 22px/1 system-ui,sans-serif;opacity:0;visibility:hidden;transform:translateY(-5px);transition:opacity .16s ease,transform .16s ease,visibility .16s;cursor:pointer;backdrop-filter:blur(10px)}
      html[data-theme="dark"] #ts-app-close-control{background:rgba(23,31,46,.96);color:#f1f5f9;border-color:rgba(148,163,184,.28);box-shadow:0 5px 20px rgba(0,0,0,.3)}
      #ts-app-close-control.ts-visible{opacity:1;visibility:visible;transform:translateY(0)}
      #ts-app-close-control:focus-visible{opacity:1;visibility:visible;outline:2px solid #d9b45b;outline-offset:3px}
      body.mock-test-active #ts-app-close-control{display:none!important}
      #ts-app-close-hint{position:fixed;z-index:2147483001;top:48px;right:10px;max-width:250px;padding:8px 11px;border:1px solid rgba(148,163,184,.24);border-radius:10px;background:#fff;color:#263247;font:12px/1.45 system-ui,sans-serif;box-shadow:0 8px 25px rgba(15,23,42,.15)}
      html[data-theme="dark"] #ts-app-close-hint{background:#171f2e;color:#f1f5f9}
      @media(prefers-reduced-motion:reduce){#ts-app-close-control{transition:none}}
    `;
    document.head.appendChild(style);

    var button = document.createElement("button");
    button.id = "ts-app-close-control";
    button.type = "button";
    button.setAttribute("aria-label", "Close TypeShala");
    button.title = "Close TypeShala";
    button.textContent = "×";
    document.body.appendChild(button);

    var hint;
    var hintTimer;
    function showHint() {
      if (!hint) {
        hint = document.createElement("div");
        hint.id = "ts-app-close-hint";
        hint.setAttribute("role", "status");
        hint.textContent = "Use your system window controls or Alt+F4 to close TypeShala.";
        document.body.appendChild(hint);
      }
      hint.hidden = false;
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function () { if (hint) hint.hidden = true; }, 4500);
    }
    function showControl() {
      if (!document.body.classList.contains("mock-test-active")) button.classList.add("ts-visible");
    }
    function hideControl() { button.classList.remove("ts-visible"); }

    document.addEventListener("mousemove", function (event) {
      if (event.clientY <= 8) showControl();
      else if (event.clientY > 58 && !button.matches(":hover") && !(hint && hint.matches(":hover"))) hideControl();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !document.body.classList.contains("mock-test-active")) hideControl();
    });
    button.addEventListener("click", function () {
      if (document.body.classList.contains("mock-test-active")) return;
      // A web page cannot reliably close an OS-launched PWA window.
      // Attempt the close request, then explain the native shortcut if blocked.
      try { window.close(); } catch (e) {}
      showHint();
    });
    document.addEventListener("fullscreenchange", function () {
      if (document.body.classList.contains("mock-test-active")) hideControl();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDesktopAppCloseControl, { once: true });
  } else {
    initDesktopAppCloseControl();
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
