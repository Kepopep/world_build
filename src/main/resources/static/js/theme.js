// Light/dark theme toggle. Fully self-contained -- no app.js `state`
// dependency at all (unlike every other feature module here, it doesn't
// need a render(container, config) entry point; there's nothing per-entry
// or per-world about a theme), so it just wires its own button and applies
// itself on load.
//
// Persists the choice to localStorage and reads it back on load, defaulting
// to dark (the palette css/base.css's :root already ships) so existing
// users don't see a flash of an unfamiliar light theme the first time this
// ships.

(function () {
  const STORAGE_KEY = "mythos-theme";

  function getStoredTheme() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === "light" || stored === "dark" ? stored : null;
    } catch {
      // localStorage unavailable (e.g. privacy mode) -- fall back to default.
      return null;
    }
  }

  function storeTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Non-fatal -- the toggle still works for the rest of this session.
    }
  }

  function applyTheme(theme) {
    if (theme === "light") {
      document.documentElement.dataset.theme = "light";
    } else {
      delete document.documentElement.dataset.theme;
    }
    const darkIcon = document.getElementById("theme-icon-dark");
    const lightIcon = document.getElementById("theme-icon-light");
    if (darkIcon && lightIcon) {
      // Icon shows the theme a click would switch TO, matching the usual
      // sun/moon toggle convention (a moon while light, a sun while dark).
      darkIcon.hidden = theme === "light";
      lightIcon.hidden = theme !== "light";
    }
    const btn = document.getElementById("theme-toggle-btn");
    if (btn) {
      const label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
      btn.title = label;
      btn.setAttribute("aria-label", label);
    }
  }

  function init() {
    const theme = getStoredTheme() || "dark";
    applyTheme(theme);
    const btn = document.getElementById("theme-toggle-btn");
    if (btn) {
      btn.addEventListener("click", () => {
        const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
        const next = current === "light" ? "dark" : "light";
        applyTheme(next);
        storeTheme(next);
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  window.theme = { init };
})();
