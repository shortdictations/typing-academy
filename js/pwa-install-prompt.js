/* TypeShala PWA installation prompt — shared by landing page and dashboard. */
(() => {
  "use strict";
  const STORAGE_INSTALLED = "typeshala-pwa-installed";
  const SESSION_SHOWN = "typeshala-install-prompt-shown";
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
      button.textContent = "Got it";
      button.onclick = closePrompt;
    }
  }

  function createPrompt() {
    if (promptVisible || isInstalled() || document.getElementById("ts-install-overlay")) return;
    promptVisible = true;

    const overlay = document.createElement("div");
    overlay.id = "ts-install-overlay";
    overlay.className = "ts-install-overlay";
    overlay.setAttribute("role", "presentation");
    overlay.innerHTML = `
      <section class="ts-install-dialog" role="dialog" aria-modal="true" aria-labelledby="ts-install-title" aria-describedby="ts-install-description">
        <button class="ts-install-close" type="button" aria-label="Close installation prompt">×</button>
        <div class="ts-install-mark" aria-hidden="true">⌨</div>
        <p class="ts-install-eyebrow">TYPE SHALA APP</p>
        <h2 id="ts-install-title">Install TypeShala</h2>
        <p id="ts-install-description">Your typing practice, just one click away. Practise SSC and Legal typing tests and track your performance in an app-like experience.</p>
        <button id="ts-install-action" class="ts-install-action" type="button">Install App</button>
        <button class="ts-install-later" type="button">Maybe Later</button>
      </section>`;

    const style = document.createElement("style");
    style.id = "ts-install-styles";
    style.textContent = `
      .ts-install-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.34);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:tsInstallFade .18s ease-out}
      .ts-install-dialog{position:relative;box-sizing:border-box;width:min(100%,410px);padding:30px 28px 24px;border:1px solid rgba(148,163,184,.22);border-radius:22px;background:#fff;color:#172033;box-shadow:0 24px 70px rgba(15,23,42,.20);text-align:center;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      html[data-theme="dark"] .ts-install-dialog,html.dark .ts-install-dialog,body.dark .ts-install-dialog{background:#171f2e;color:#edf2fb;border-color:rgba(148,163,184,.18);box-shadow:0 24px 70px rgba(0,0,0,.42)}
      .ts-install-close{position:absolute;top:12px;right:14px;width:34px;height:34px;border:0;border-radius:50%;background:transparent;color:inherit;font-size:25px;line-height:1;cursor:pointer;opacity:.68}
      .ts-install-close:hover{background:rgba(148,163,184,.14);opacity:1}
      .ts-install-mark{display:grid;place-items:center;width:52px;height:52px;margin:0 auto 14px;border-radius:16px;background:#f4ead1;color:#7a5a16;font-size:27px}
      html[data-theme="dark"] .ts-install-mark,html.dark .ts-install-mark,body.dark .ts-install-mark{background:#3a3223;color:#f0cc75}
      .ts-install-eyebrow{margin:0 0 8px;font-size:10px;letter-spacing:.16em;font-weight:700;opacity:.62}
      .ts-install-dialog h2{margin:0 0 10px;font-size:22px;line-height:1.25;font-weight:650;letter-spacing:-.025em}
      .ts-install-dialog p#ts-install-description{margin:0 auto 22px;max-width:320px;font-size:14px;line-height:1.65;opacity:.78}
      .ts-install-action{display:block;width:100%;min-height:46px;padding:12px 18px;border:0;border-radius:12px;background:#d9b45b;color:#231d10;font-size:14px;font-weight:650;cursor:pointer}
      .ts-install-action:hover{filter:brightness(.97)}
      .ts-install-later{display:block;margin:10px auto 0;padding:9px 16px;border:0;background:transparent;color:inherit;font:500 13px inherit;opacity:.68;cursor:pointer}
      .ts-install-later:hover{opacity:1;text-decoration:underline}
      @keyframes tsInstallFade{from{opacity:0}to{opacity:1}}
      @media(max-width:767px){.ts-install-overlay{align-items:flex-end;padding:12px;background:rgba(15,23,42,.28)}.ts-install-dialog{width:100%;max-width:none;padding:28px 22px 20px;border-radius:22px 22px 18px 18px}.ts-install-dialog h2{font-size:21px}.ts-install-dialog p#ts-install-description{font-size:13.5px}.ts-install-mark{width:46px;height:46px;border-radius:14px;margin-bottom:12px}}
      @media(prefers-reduced-motion:reduce){.ts-install-overlay{animation:none}}
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);

    overlay.querySelector(".ts-install-close").addEventListener("click", closePrompt);
    overlay.querySelector(".ts-install-later").addEventListener("click", closePrompt);
    overlay.addEventListener("click", event => {
      if (event.target === overlay) closePrompt();
    });
    overlay.querySelector("#ts-install-action").addEventListener("click", async () => {
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
    });

    const escapeHandler = event => {
      if (event.key === "Escape" && document.getElementById("ts-install-overlay")) {
        closePrompt();
        document.removeEventListener("keydown", escapeHandler);
      }
    };
    document.addEventListener("keydown", escapeHandler);
  }

  function maybeShowPrompt() {
    if (isInstalled() || promptVisible) return;
    try {
      if (sessionStorage.getItem(SESSION_SHOWN) === "1") return;
      sessionStorage.setItem(SESSION_SHOWN, "1");
    } catch (_) {}
    createPrompt();
  }

  function init() {
    if (isInstalled()) return;
    const delay = isMobile() ? 3000 : 5000;
    window.setTimeout(maybeShowPrompt, delay);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
