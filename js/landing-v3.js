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

  // Subtle reveal for sections. It remains disabled when the user prefers reduced motion.
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });

    document.querySelectorAll([
      ".lp-hero-demo",
      ".intro-inner > *",
      ".section-heading",
      ".audience-card",
      ".feature-card",
      ".split-copy",
      ".mock-shell",
      ".smart-copy > *",
      ".smart-flow > div",
      ".ts-mobile-support-copy > *",
      ".ts-mobile-features article",
      ".ts-mobile-note",
      ".ts-mobile-visual",
      ".price-card",
      ".credits-box",
      ".credit-options > div",
      ".free-credit-note",
      ".final-inner > *",
      ".footer-main > *",
      ".footer-bottom"
    ].join(", ")).forEach(el => {
      el.classList.add("reveal-on-scroll");
      observer.observe(el);
    });
  }
});