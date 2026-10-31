/* Theme toggle. The stored choice is applied before first paint by an inline script in <head>;
   without a stored choice (or without JavaScript) the page follows prefers-color-scheme. */
(() => {
  const button = document.querySelector("[data-theme-toggle]");
  if (!button) return;
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const current = () => root.getAttribute("data-theme") || (system.matches ? "dark" : "light");
  // The browser UI colour: two <meta name="theme-color"> tags keyed to prefers-color-scheme.
  // With a chosen theme, both carry that theme's colour; otherwise they keep their own.
  const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
  const colors = {};
  metas.forEach((meta) => {
    meta.dataset.color = meta.content;
    const scheme = /dark/.test(meta.media) ? "dark" : "light";
    colors[scheme] = meta.content;
  });
  const sync = () => {
    button.setAttribute("aria-pressed", String(current() === "dark"));
    const chosen = root.getAttribute("data-theme");
    metas.forEach((meta) => {
      meta.content = (chosen && colors[chosen]) || meta.dataset.color;
    });
  };
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
