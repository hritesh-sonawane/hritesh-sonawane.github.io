/* Reading marks, stored only in this browser (localStorage, one key per course; no network).
   A lesson counts as read when the reader presses "Mark as read", or when its pager is in view
   after the page has been visible for a quarter of its reading time (at least 20 seconds), so
   jumping to the end or skimming past does not count.
   A mark records that a page was reached; it says nothing about understanding. */
(() => {
  const course = document.body.dataset.course;
  if (!course) return;
  const KEY = `hs-read:${course}`;
  let storage;
  try {
    storage = window.localStorage;
    storage.setItem("hs-probe", "1");
    storage.removeItem("hs-probe");
  } catch {
    return; // Storage unavailable: the controls stay hidden.
  }

  const load = () => {
    try {
      const value = JSON.parse(storage.getItem(KEY) || "[]");
      return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
    } catch {
      return new Set();
    }
  };
  const save = () => {
    try {
      if (read.size) storage.setItem(KEY, JSON.stringify(Array.from(read)));
      else storage.removeItem(KEY);
    } catch {
      /* Quota or privacy mode: keep the in-page state only. */
    }
  };
  let read = load();

  /* ---- Check marks in the course tree and lesson lists ---- */
  const links = Array.from(document.querySelectorAll("a[data-lesson]"));
  function paintMarks() {
    links.forEach((link) => {
      const isRead = read.has(link.dataset.lesson);
      const mark = link.querySelector(".read-mark");
      if (isRead && !mark) {
        const span = document.createElement("span");
        span.className = "read-mark";
        span.innerHTML = '<span aria-hidden="true">✓</span><span class="visually-hidden">, read</span>';
        link.append(span);
        link.dataset.read = "";
      } else if (!isRead && mark) {
        mark.remove();
        delete link.dataset.read;
      }
    });
  }

  /* ---- Course page: n of N, a bar, continue, reset ---- */
  const summary = document.querySelector("[data-course-progress]");
  const paintSummary = (() => {
    if (!summary) return () => {};
    const lessons = Array.from(document.querySelectorAll(".module-index a[data-lesson]"));
    const count = summary.querySelector("[data-progress-count]");
    const bar = summary.querySelector("[data-progress-bar]");
    const reset = summary.querySelector("[data-progress-reset]");
    const next = document.querySelector("[data-progress-continue]");
    const original = next && { href: next.getAttribute("href"), html: next.innerHTML };
    if (reset) {
      reset.addEventListener("click", () => {
        if (!window.confirm("Clear the read marks for this course? They are stored only in this browser.")) return;
        read = new Set();
        save();
        paint();
        (next || summary).focus();
      });
    }
    summary.hidden = false;
    return () => {
      const done = lessons.filter((link) => read.has(link.dataset.lesson)).length;
      count.textContent = String(done);
      bar.style.width = `${lessons.length ? (done / lessons.length) * 100 : 0}%`;
      if (reset) reset.hidden = done === 0;
      if (!next) return;
      const upcoming = lessons.find((link) => !read.has(link.dataset.lesson));
      if (done && upcoming) {
        next.setAttribute("href", upcoming.getAttribute("href"));
        next.innerHTML = `Continue with ${upcoming.dataset.number} <span aria-hidden="true">→</span>`;
      } else {
        next.setAttribute("href", original.href);
        next.innerHTML = original.html;
      }
    };
  })();

  /* ---- Lesson page: the toggle and the end-of-page mark ---- */
  const article = document.querySelector("[data-lesson-page]");
  const control = document.querySelector("[data-read-control]");
  const toggle = control && control.querySelector("[data-read-toggle]");
  const status = control && control.querySelector("[data-read-status]");
  const path = article && article.dataset.lessonPage;
  let undone = false; // after an explicit "undo", do not re-mark on this visit

  function setRead(value, announce) {
    read = load();
    if (value) read.add(path);
    else read.delete(path);
    save();
    paint();
    if (announce && status) status.textContent = value ? "Marked as read" : "Read mark removed";
  }
  function paintToggle() {
    if (!toggle) return;
    const isRead = read.has(path);
    toggle.textContent = isRead ? "✓ Read · Undo" : "Mark as read";
    toggle.toggleAttribute("data-read", isRead);
  }
  if (path && toggle) {
    toggle.addEventListener("click", () => {
      if (read.has(path)) {
        undone = true;
        setRead(false, true);
      } else setRead(true, true);
    });
    control.hidden = false;
    const pager = document.querySelector(".lesson-pager");
    if (pager && "IntersectionObserver" in window) {
      const minutes = Number(article.dataset.readingMinutes) || 1;
      const needed = Math.max(20, minutes * 15) * 1000; // a quarter of the reading time, in ms
      let visibleFor = 0;
      let since = document.visibilityState === "visible" ? performance.now() : null;
      let atEnd = false;
      let timer;
      const elapsed = () => visibleFor + (since === null ? 0 : performance.now() - since);
      const check = () => {
        clearTimeout(timer);
        if (!atEnd || undone || read.has(path)) return;
        const left = needed - elapsed();
        if (left <= 0) setRead(true, false);
        else if (since !== null) timer = setTimeout(check, left + 50);
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          if (since === null) since = performance.now();
        } else if (since !== null) {
          visibleFor += performance.now() - since;
          since = null;
        }
        check();
      });
      new IntersectionObserver((entries) => {
        atEnd = entries[entries.length - 1].isIntersecting;
        check();
      }).observe(pager);
    }
  }

  function paint() {
    paintMarks();
    paintSummary();
    paintToggle();
  }
  // Another tab changed the marks.
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY && event.key !== null) return;
    read = load();
    paint();
  });
  paint();
})();

