(() => {
  const article = document.querySelector("[data-reading-article]");
  const bar = document.querySelector("[data-reading-progress]");
  if (!article || !bar) return;
  const label = document.querySelector("[data-reading-label]");
  // The label is hidden in the markup so a page without JavaScript never shows a stale 0%.
  const labelRow = label && label.closest(".reading-label");
  if (labelRow) labelRow.hidden = false;
  const links = [...document.querySelectorAll(".page-contents a, .mobile-contents a")];
  // Track only headings the contents link to, not generated ones (module cards, "Lessons").
  const linked = new Set(links.map((link) => decodeURIComponent(link.hash.slice(1))).filter(Boolean));
  const headings = [...article.querySelectorAll("h2[id], h3[id]")].filter((heading) => linked.has(heading.id));
  let scheduled = false;
  const update = () => {
    scheduled = false;
    const bounds = article.getBoundingClientRect();
    const start = window.scrollY + bounds.top - 112;
    const end = window.scrollY + bounds.bottom - window.innerHeight;
    const progress = end > start ? Math.max(0, Math.min(1, (window.scrollY - start) / (end - start))) : 0;
    bar.style.transform = "scaleX(" + progress + ")";
    if (label) label.textContent = Math.round(progress * 100) + "%";
    let active = "";
    headings.forEach((heading) => {
      if (heading.getBoundingClientRect().top <= 144) active = heading.id;
    });
    links.forEach((link) => {
      if (decodeURIComponent(link.hash.slice(1)) === active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };
  const schedule = () => {
    if (!scheduled) { scheduled = true; window.requestAnimationFrame(update); }
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  const mobileContents = document.querySelector(".mobile-contents");
  if (mobileContents) {
    mobileContents.addEventListener("click", (event) => {
      const link = event.target.closest("a");
      if (!link) return;
      mobileContents.open = false;
      const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    });
    mobileContents.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        mobileContents.open = false;
        mobileContents.querySelector("summary").focus();
      }
    });
  }
  update();

  // ← / → follow the pager. Ignored while typing, with modifiers, inside a scrollable
  // region (where arrows scroll), or while any dialog (search, diagram viewer) is open.
  const prev = document.querySelector("[data-key-nav='prev']");
  const next = document.querySelector("[data-key-nav='next']");
  if (prev || next) {
    const hint = document.querySelector("[data-key-hint]");
    if (hint) hint.hidden = false;
    document.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target.closest && target.closest("input, textarea, select, [contenteditable], dialog, .table-wrap, .diagram-canvas, pre, details.mobile-contents[open]")) return;
      if (document.querySelector("dialog[open]")) return;
      const link = event.key === "ArrowLeft" ? prev : next;
      if (!link) return;
      event.preventDefault();
      link.click();
    });
  }
})();
