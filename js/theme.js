/* ============================================================
   theme.js
   ------------------------------------------------------------
   Wires the Light / System / Dark toggle on the Settings page.
   Persists the selected preference and updates both page theme
   and the browser status-bar color immediately.
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
  } catch (e) { /* Theme still applies for the current page. */ }

  const resolved = choice === "system"
    ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : choice;
  document.documentElement.setAttribute("data-theme", resolved);

  if (typeof window.TypeShalaSyncThemeColor === "function") {
    window.TypeShalaSyncThemeColor(resolved);
  } else {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "dark" ? "#131A28" : "#0B1C3F");
  }

  buttons.forEach(btn => btn.classList.toggle("active", btn.dataset.themeChoice === choice));
}
