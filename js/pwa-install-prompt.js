/* TypeShala persistent PWA install banner for the landing page. */
(() => {
  "use strict";
  let deferredInstallPrompt = null;
  let promptVisible = false;
  const INSTALLED_KEY = "ts_pwa_installed_v1";

  const hasInstalledMarker = () => {
    try { return localStorage.getItem(INSTALLED_KEY) === "1"; }
    catch (_) { return false; }
  };

  const rememberInstalled = () => {
    try { localStorage.setItem(INSTALLED_KEY, "1"); }
    catch (_) {}
  };

  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.navigator.standalone === true;

  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const isInstalled = () => {
    // The installed app runs in standalone mode; the website in a browser does not.
    // Do not treat a remembered install marker as permanent: uninstalling the PWA
    // must allow the install banner to appear again on the next browser visit.
    return isStandalone();
  };

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  window.addEventListener("appinstalled", () => {
    // Standalone mode is the live installed-state signal. Do not persist a marker,
    // because browsers do not reliably notify websites when an app is uninstalled.
    deferredInstallPrompt = null;
    closePrompt();
  });

  function closePrompt() {
    const overlay = document.getElementById("ts-install-overlay");
    if (overlay) overlay.remove();
    promptVisible = false;
  }

  function getInstructions() {
    if (isIOS()) {
      return {
        title: "Add TypeShala to your Home Screen",
        text: 'Tap the Share button in Safari, then choose “Add to Home Screen” and tap “Add”.'
      };
    }
    if (/firefox/i.test(navigator.userAgent)) {
      return {
        title: "Install TypeShala",
        text: 'Open your browser menu and look for “Install” or “Add to Home Screen”. If that option is unavailable, use Chrome or Edge for supported app installation.'
      };
    }
    return {
      title: "Install TypeShala",
      text: 'Open your browser menu (⋮ or ⋯) and choose “Install TypeShala” or “Install page as app”. The option appears when your browser supports installation.'
    };
  }

  function showInstructions() {
    const copy = getInstructions();
    const title = document.getElementById("ts-install-title");
    const button = document.getElementById("ts-install-action");
    if (title) title.textContent = copy.title;
    if (button) {
      button.textContent = "Back";
      button.onclick = () => {
        if (title) title.textContent = "Install TypeShala";
        button.textContent = "Install";
        button.onclick = null;
      };
    }
  }

  function createPrompt() {
    if (promptVisible || isInstalled() || document.getElementById("ts-install-overlay")) return;
    promptVisible = true;

    const overlay = document.createElement("aside");
    overlay.id = "ts-install-overlay";
    overlay.className = "ts-install-banner";
    overlay.setAttribute("role", "region");
    overlay.setAttribute("aria-label", "Install TypeShala");
    overlay.innerHTML = `
      <div class="ts-install-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3v11"></path>
          <path d="m7.5 9.5 4.5 4.5 4.5-4.5"></path>
          <path d="M5 16.5v2A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5v-2"></path>
        </svg>
      </div>
      <div class="ts-install-copy">
        <p id="ts-install-title" class="ts-install-title">Install TypeShala</p>
        <p class="ts-install-description">Practice typing anytime.</p>
      </div>
      <button id="ts-install-action" class="ts-install-action" type="button">Install</button>`;

    const style = document.createElement("style");
    style.id = "ts-install-styles";
    style.textContent = ".ts-install-banner{position:fixed!important;top:auto!important;right:24px!important;bottom:24px!important;left:auto!important;z-index:2147483647!important;display:flex!important;visibility:visible!important;opacity:1!important;align-items:center;gap:13px;transition:opacity .24s ease,transform .24s ease,visibility .24s ease;box-sizing:border-box;width:max-content;max-width:calc(100vw - 32px);padding:11px 13px;border:1px solid rgba(148,163,184,.24);border-radius:16px;background:#fff;color:#172033;box-shadow:0 10px 34px rgba(15,23,42,.14);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;animation:tsInstallSlide .22s ease-out}\nhtml[data-theme=\"dark\"] .ts-install-banner,html.dark .ts-install-banner,body.dark .ts-install-banner{background:#171f2e;color:#edf2fb;border-color:rgba(148,163,184,.2);box-shadow:0 10px 34px rgba(0,0,0,.32)}\n.ts-install-mark{display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px;border-radius:12px;background:#f4ead1;color:#7a5a16;font-size:22px}\nhtml[data-theme=\"dark\"] .ts-install-mark,html.dark .ts-install-mark,body.dark .ts-install-mark{background:#3a3223;color:#f0cc75}\n.ts-install-banner.ts-footer-hidden{opacity:0!important;transform:translateY(10px)!important;pointer-events:none!important}.ts-install-copy{flex:1;min-width:0;text-align:left}\n.ts-install-eyebrow{margin:0 0 3px;font-size:9px;letter-spacing:.13em;font-weight:700;opacity:.6}\n.ts-install-title{margin:0 0 3px;font-size:14px;line-height:1.3;font-weight:650}\n.ts-install-description{margin:3px 0 0;font-size:11.5px;line-height:1.4;opacity:.72}\n.ts-install-action{flex:0 0 auto;padding:9px 13px;border:0;border-radius:10px;background:#d9b45b;color:#231d10;font-size:12px;font-weight:650;cursor:pointer;white-space:nowrap}\n.ts-install-action:hover{filter:brightness(.97)}\n@keyframes tsInstallSlide{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}\n@media(max-width:767px){.ts-install-banner{top:auto!important;right:10px!important;bottom:calc(10px + env(safe-area-inset-bottom))!important;left:10px!important;width:max-content!important;max-width:calc(100vw - 20px)!important;gap:9px;padding:10px;border-radius:14px}.ts-install-mark{flex-basis:36px;width:36px;height:36px;font-size:19px}.ts-install-title{font-size:13px}.ts-install-description{font-size:11px}.ts-install-action{padding:8px 11px;font-size:11.5px}}\n@media(prefers-reduced-motion:reduce){.ts-install-banner{animation:none;transition:none!important}.ts-install-banner.ts-footer-hidden{transform:none!important}}"
    if (!document.getElementById("ts-install-styles")) document.head.appendChild(style);

    // Keep the prompt outside navigation and transformed layout containers.
    function pinPromptToViewport() {
      if (!overlay.isConnected || !document.body) return;
      if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      const properties = {
        position: "fixed",
        top: "auto",
        right: mobile ? "10px" : "24px",
        bottom: mobile ? "calc(10px + env(safe-area-inset-bottom))" : "24px",
        left: mobile ? "10px" : "auto",
        "z-index": "2147483647",
        width: "max-content",
        "max-width": mobile ? "calc(100vw - 20px)" : "calc(100vw - 32px)",
        "box-sizing": "border-box"
      };
      Object.entries(properties).forEach(([name, value]) => overlay.style.setProperty(name, value, "important"));
    }
    // Mount the banner before positioning it; otherwise isConnected is false and positioning exits early.
    document.body.appendChild(overlay);
    pinPromptToViewport();
    window.addEventListener("resize", pinPromptToViewport, { passive: true });
    const promptPositionObserver = new MutationObserver(() => {
      if (overlay.isConnected && overlay.parentElement !== document.body) pinPromptToViewport();
    });
    promptPositionObserver.observe(document.body, { childList: true, subtree: true });

    // Keep the install banner visible even when the page footer is in view.

    const installButton = overlay.querySelector("#ts-install-action");
    const handleInstall = async () => {
      if (deferredInstallPrompt) {
        try {
          deferredInstallPrompt.prompt();
          const choice = await deferredInstallPrompt.userChoice;
          deferredInstallPrompt = null;
          closePrompt();
        } catch (error) {
          console.warn("TypeShala install prompt could not be opened:", error);
          showInstructions();
        }
      } else {
        showInstructions();
      }
    };
    installButton.onclick = handleInstall;
  }

  function init() {
    // Browser visits always get the install banner, even if TypeShala is also
    // installed on this device. Hide it only when launched as the installed app.
    if (isInstalled()) return;
    // On mobile, wait until the animated splash has disappeared.
    const delay = window.matchMedia("(max-width: 767px)").matches ? 1750 : 500;
    window.setTimeout(() => {
      if (!isInstalled() && !document.getElementById("ts-install-overlay")) createPrompt();
    }, delay);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  // Restore the banner when returning to the browser tab or using back/forward cache.
  window.addEventListener("pageshow", () => {
    if (isInstalled() || document.getElementById("ts-install-overlay")) return;
    window.setTimeout(() => {
      if (!isInstalled() && !document.getElementById("ts-install-overlay")) createPrompt();
    }, 250);
  });
})();
