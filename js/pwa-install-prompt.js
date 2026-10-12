/* TypeShala PWA installation prompt — shared by landing page and dashboard. */
(() => {
  "use strict";
  const STORAGE_INSTALLED = "typeshala-pwa-installed";
  let deferredInstallPrompt = null;
  let promptVisible = false;

  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    window.navigator.standalone === true;

  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  const isMobile = () => window.matchMedia("(max-width: 767px)").matches ||
    /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

  const isInstalled = () => {
    try {
      return localStorage.getItem(STORAGE_INSTALLED) === "1" || isStandalone();
    } catch (_) {
      return isStandalone();
    }
  };

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    try {
      localStorage.setItem(STORAGE_INSTALLED, "1");
    } catch (_) {}
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
    const description = document.getElementById("ts-install-description");
    const button = document.getElementById("ts-install-action");
    if (title) title.textContent = copy.title;
    if (description) description.textContent = copy.text;
    if (button) {
      button.textContent = "Back";
      button.onclick = () => {
        if (title) title.textContent = "Install TypeShala";
        if (description) description.textContent = "Practice typing anytime, right from your home screen.";
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
      <div class="ts-install-mark" aria-hidden="true">⌨</div>
      <div class="ts-install-copy">
        <p class="ts-install-eyebrow">TYPE SHALA APP</p>
        <p id="ts-install-title" class="ts-install-title">Install TypeShala</p>
        <p id="ts-install-description">Practice typing anytime, right from your home screen.</p>
      </div>
      <button id="ts-install-action" class="ts-install-action" type="button">Install</button>`;

    const style = document.createElement("style");
    style.id = "ts-install-styles";
    style.textContent = `
      .ts-install-banner{position:fixed;right:24px;bottom:24px;z-index:9999;display:flex;align-items:center;gap:13px;box-sizing:border-box;width:min(390px,calc(100vw - 32px));padding:11px 13px;border:1px solid rgba(148,163,184,.24);border-radius:16px;background:#fff;color:#172033;box-shadow:0 10px 34px rgba(15,23,42,.14);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;animation:tsInstallSlide .22s ease-out}
      html[data-theme="dark"] .ts-install-banner,html.dark .ts-install-banner,body.dark .ts-install-banner{background:#171f2e;color:#edf2fb;border-color:rgba(148,163,184,.2);box-shadow:0 10px 34px rgba(0,0,0,.32)}
      .ts-install-mark{display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px;border-radius:12px;background:#f4ead1;color:#7a5a16;font-size:22px}
      html[data-theme="dark"] .ts-install-mark,html.dark .ts-install-mark,body.dark .ts-install-mark{background:#3a3223;color:#f0cc75}
      .ts-install-copy{flex:1;min-width:0;text-align:left}
      .ts-install-eyebrow{margin:0 0 3px;font-size:9px;letter-spacing:.13em;font-weight:700;opacity:.6}
      .ts-install-title{margin:0 0 3px;font-size:14px;line-height:1.3;font-weight:650}
      .ts-install-copy #ts-install-description{margin:0;font-size:11.5px;line-height:1.4;opacity:.72}
      .ts-install-action{flex:0 0 auto;padding:9px 13px;border:0;border-radius:10px;background:#d9b45b;color:#231d10;font-size:12px;font-weight:650;cursor:pointer;white-space:nowrap}
      .ts-install-action:hover{filter:brightness(.97)}
      .ts-install-close{align-self:flex-start;flex:0 0 22px;width:22px;height:22px;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;font-size:19px;line-height:1;cursor:pointer;opacity:.6}
      .ts-install-close:hover{background:rgba(148,163,184,.14);opacity:1}
      @keyframes tsInstallSlide{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      @media(max-width:767px){.ts-install-banner{right:10px;bottom:calc(10px + env(safe-area-inset-bottom));left:10px;width:auto;gap:9px;padding:10px;border-radius:14px}.ts-install-mark{flex-basis:36px;width:36px;height:36px;font-size:19px}.ts-install-title{font-size:13px}.ts-install-copy #ts-install-description{font-size:11px}.ts-install-action{padding:8px 11px;font-size:11.5px}}
      @media(prefers-reduced-motion:reduce){.ts-install-banner{animation:none}}
    `
    document.head.appendChild(style);
    document.body.appendChild(overlay);

    const installButton = overlay.querySelector("#ts-install-action");
    const handleInstall = async () => {
      if (deferredInstallPrompt) {
        try {
          deferredInstallPrompt.prompt();
          const choice = await deferredInstallPrompt.userChoice;
          if (choice && choice.outcome === "accepted") {
            try { localStorage.setItem(STORAGE_INSTALLED, "1"); } catch (_) {}
          }
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
    installButton.addEventListener("click", handleInstall);
  }

  function init() {
    if (isInstalled()) return;
    createPrompt();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
