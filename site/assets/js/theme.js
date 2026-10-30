/* Theme toggle. The stored choice is applied before first paint by an inline script in <head>;
   without a stored choice (or without JavaScript) the page follows prefers-color-scheme. */
(() => {
  const button = document.querySelector("[data-theme-toggle]");
  if (!button) return;
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const current = () => root.getAttribute("data-theme") || (system.matches ? "dark" : "light");
  const sync = () => button.setAttribute("aria-pressed", String(current() === "dark"));
  button.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("hs-theme", next);
    } catch {
      /* Private mode or storage disabled: the choice lasts for this page only. */
    }
    sync();
  });
  system.addEventListener("change", sync);
  sync();
  button.hidden = false;
})();
