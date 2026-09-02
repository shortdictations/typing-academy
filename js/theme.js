/* ============================================================
   theme.js
   ------------------------------------------------------------
   Wires the Light / System / Dark toggle on the Settings page.
   Persists the CHOICE ("light" | "system" | "dark") to
   localStorage under "typeshala-theme" — the same key
   js/theme-init.js reads on every app-shell page's next load, so a
   theme picked here applies immediately elsewhere in the app too.
   No account/database involvement — this is a local display
   preference, not account data.
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  const buttons = document.querySelectorAll(".theme-toggle-btn");
  if (buttons.length === 0) return;

  const current = localStorage.getItem("typeshala-theme") || "system";
  buttons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.themeChoice === current);
    btn.addEventListener("click", () => applyThemeChoice(btn.dataset.themeChoice, buttons));
  });
});

function applyThemeChoice(choice, buttons) {
  try {
    localStorage.setItem("typeshala-theme", choice);
  } catch (e) { /* localStorage unavailable — theme just won't persist across reloads */ }

  const resolved = choice === "system"
    ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : choice;
  document.documentElement.setAttribute("data-theme", resolved);

  buttons.forEach(btn => btn.classList.toggle("active", btn.dataset.themeChoice === choice));
}
