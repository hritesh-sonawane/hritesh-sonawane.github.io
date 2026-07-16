(() => {
  const resolveTheme = () => {
    const saved = localStorage.getItem("theme") || localStorage.getItem("pref-theme");
    return saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  };

  const applyTheme = (theme) => {
    const dark = theme === "dark";
    document.documentElement.classList.toggle("dark", dark);
    document.body.classList.toggle("dark", dark);
  };

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(resolveTheme());
    document.addEventListener("click", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest("#theme-toggle")) return;
      const next = document.body.classList.contains("dark") ? "light" : "dark";
      localStorage.setItem("theme", next);
      applyTheme(next);
    }, true);
  });
})();
