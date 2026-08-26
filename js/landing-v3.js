document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();

  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  const menuButton = document.querySelector(".mobile-menu-btn");
  const menu = document.querySelector(".mobile-menu");

  if (menuButton && menu) {
    menuButton.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.innerHTML = open
        ? '<i data-lucide="x"></i>'
        : '<i data-lucide="menu"></i>';
      if (window.lucide) lucide.createIcons();
    });

    menu.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", () => {
        menu.classList.remove("open");
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.innerHTML = '<i data-lucide="menu"></i>';
        if (window.lucide) lucide.createIcons();
      });
    });
  }

  // Subtle reveal for sections as they scroll into view. Disabled
  // when the user prefers reduced motion.
  //
  // Root-cause fix: this used to hide every one of these elements at
  // opacity:0 until individually observed as intersecting, with
  // nothing else ever making them visible. That's fine for normal
  // scrolling, but it meant ANY interruption — a very fast scroll
  // that skips past the observer's threshold, a browser blocking
  // IntersectionObserver, an unrelated script error running before
  // this point, or any tool that renders/captures the page without
  // actually scrolling it — left large sections of real content
  // permanently invisible, which reads as a broken/misaligned page
  // even though every element is still correctly positioned underneath.
  // A short timeout safety net below guarantees every section becomes
  // visible regardless, so the animation is purely cosmetic and can
  // never hide content indefinitely.
  try {
    const revealTargets = document.querySelectorAll(".section-heading, .audience-card, .feature-card, .mock-shell, .result-card, .analysis-points article, .progress-card, .smart-flow > div, .dashboard-preview, .price-card, .credits-box");

    const revealNow = (el) => el.classList.add("is-visible");
    const revealAll = () => revealTargets.forEach(revealNow);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      revealAll();
    } else {
      const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            revealNow(entry.target);
            obs.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08 });

      revealTargets.forEach(el => {
        el.classList.add("reveal-on-scroll");
        observer.observe(el);
      });

      // Safety net: whatever hasn't naturally scrolled into view within
      // 2.5s (a very generous margin past any normal page load) is
      // revealed anyway, so a slow/failed/skipped observer can never
      // leave content permanently hidden.
      setTimeout(() => {
        revealAll();
        observer.disconnect();
      }, 2500);
    }
  } catch (err) {
    // If anything above throws for any reason, fall back to simply
    // showing everything rather than leaving the page half-blank.
    console.error("Section reveal animation failed, showing content directly:", err);
    document.querySelectorAll(".section-heading, .audience-card, .feature-card, .mock-shell, .result-card, .analysis-points article, .progress-card, .smart-flow > div, .dashboard-preview, .price-card, .credits-box").forEach(el => {
      el.classList.add("is-visible");
    });
  }
});
