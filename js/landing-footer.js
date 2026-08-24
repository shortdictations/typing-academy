/* ============================================================
   landing-footer.js
   ------------------------------------------------------------
   Powers the three footer info modals (Privacy Policy, Terms &
   Conditions, About Us) on index.html only. One reusable modal
   container in the DOM; each button just swaps in that modal's
   title + content from a <template>, so there's a single modal
   component rather than three separate ones. No page navigation
   involved — matches "do not create separate HTML pages".
   ============================================================ */

(function () {
  const overlay = document.getElementById("infoModalOverlay");
  const modal = document.getElementById("infoModal");
  const titleEl = document.getElementById("infoModalTitle");
  const bodyEl = document.getElementById("infoModalBody");
  const closeBtn = document.getElementById("infoModalCloseBtn");
  if (!overlay || !modal) return;

  const MODAL_SOURCES = {
    privacyModal: { title: "Privacy Policy", templateId: "privacyModalContent" },
    termsModal: { title: "Terms and Conditions", templateId: "termsModalContent" },
    aboutModal: { title: "About Us", templateId: "aboutModalContent" }
  };

  let lastFocusedTrigger = null;
  let hideTimeoutId = null;
  // Explicit state, checked instead of the DOM's own [hidden]/class
  // state for the open/close guards below — more robust than
  // inferring "is it open" from DOM properties that a delayed
  // animation can leave in a transitional state for a short window.
  let modalOpen = false;

  function openModal(key, triggerEl) {
    const source = MODAL_SOURCES[key];
    const template = source && document.getElementById(source.templateId);
    if (!source || !template) return;

    // Clear any pending close-hide from a previous close — required
    // both for the normal "close then reopen quickly" case and so a
    // stray leftover timeout can never fire and touch an overlay/
    // modal that a new open() call is currently in control of.
    clearTimeout(hideTimeoutId);
    modalOpen = true;
    lastFocusedTrigger = triggerEl || null;

    titleEl.textContent = source.title;
    bodyEl.innerHTML = "";
    bodyEl.appendChild(template.content.cloneNode(true));
    bodyEl.scrollTop = 0;

    overlay.hidden = false;
    modal.hidden = false;
    // Two rAFs so the hidden->visible change and the transition-start
    // class land in separate paint frames — otherwise the browser can
    // collapse them and the open animation never plays.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.classList.add("open");
      modal.classList.add("open");
    }));

    // Same dual-element scroll lock used elsewhere in this project —
    // locking body alone isn't reliable on every engine unless html
    // is also constrained. On THIS page specifically, confirmed by
    // direct testing that overflow:hidden on both html and body was
    // still not enough on its own (measured window.scrollY actually
    // changing after a wheel event despite both computing to
    // "hidden") — likely an interaction with body.landing-v2's own
    // display:flex layout. Backed up with a direct wheel/touchmove
    // listener that blocks the scroll outright regardless of any
    // CSS-level quirk; re-verified after adding this that scrollY
    // stays at 0 while the modal is open.
    document.documentElement.classList.add("info-modal-open");
    document.body.classList.add("info-modal-open");
    document.addEventListener("wheel", preventBackgroundScroll, { passive: false });
    document.addEventListener("touchmove", preventBackgroundScroll, { passive: false });

    document.addEventListener("keydown", onKeydown);
    // preventScroll is the actual fix here — confirmed by testing that
    // window.scrollY was jumping the instant the modal opened, before
    // any wheel event at all. That's the browser's own "scroll the
    // newly-focused element into view" behavior, which a CSS
    // overflow:hidden lock (or even preventDefault on wheel/touchmove)
    // has no effect on, since it isn't a scroll gesture at all — it's
    // triggered directly by .focus() itself.
    closeBtn.focus({ preventScroll: true });
  }

  function preventBackgroundScroll(e) {
    if (modal.contains(e.target)) return; // let the modal's own body scroll normally
    e.preventDefault();
  }

  function closeModal() {
    if (!modalOpen) return;
    modalOpen = false;
    // Clear any timeout from a previous close that might still be
    // pending (e.g. ESC and an overlay click both firing in quick
    // succession) — without this, a second scheduled hide could
    // outlive this one and fire later with nothing left to clean up,
    // which is harmless here but is exactly the kind of leftover
    // timer requirement 7 asks to guard against on every open AND
    // close, not just open.
    clearTimeout(hideTimeoutId);

    overlay.classList.remove("open");
    modal.classList.remove("open");
    // pointer-events:none / visibility:hidden apply the instant the
    // "open" class above is removed (see landing.css) — synchronous,
    // not tied to the delayed [hidden]=true below. That's what
    // actually fixes the unresponsive-page bug: the overlay can no
    // longer capture any click from this point on, even during the
    // few hundred ms the fade-out is still visually playing.
    document.documentElement.classList.remove("info-modal-open");
    document.body.classList.remove("info-modal-open");
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("wheel", preventBackgroundScroll);
    document.removeEventListener("touchmove", preventBackgroundScroll);

    const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    hideTimeoutId = setTimeout(() => {
      overlay.hidden = true;
      modal.hidden = true;
    }, prefersReducedMotion ? 0 : 220);

    if (lastFocusedTrigger && typeof lastFocusedTrigger.focus === "function") {
      lastFocusedTrigger.focus({ preventScroll: true });
    }
  }

  function onKeydown(e) {
    if (e.key === "Escape") closeModal();
  }

  document.querySelectorAll("[data-modal-open]").forEach(btn => {
    btn.addEventListener("click", () => openModal(btn.dataset.modalOpen, btn));
  });
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", closeModal);
})();
