/* Mermaid diagrams: lazy rendering and an expanded pan/zoom viewer.
   Loaded only on pages that contain diagrams (see partials/diagram-scripts.html).
   Without JavaScript, or if Mermaid fails, the escaped source stays visible. */
(() => {
  "use strict";

  /* ---- View math (pure; covered by a node check without a DOM) ---- */

  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  // Scale and centre content of size {w,h} inside a stage of size {w,h}.
  function fitView(content, stage, maxScale) {
    const scale = Math.min((stage.w * 0.94) / content.w, (stage.h * 0.94) / content.h, maxScale);
    return { scale, x: (stage.w - content.w * scale) / 2, y: (stage.h - content.h * scale) / 2 };
  }

  // Zoom by `factor`, keeping the stage point (px, py) fixed under the pointer.
  function zoomAt(view, factor, px, py, limits) {
    const scale = clamp(view.scale * factor, limits.min, limits.max);
    const k = scale / view.scale;
    return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
  }

  // Keep at least `margin` pixels of the content inside the stage.
  function clampPan(view, content, stage, margin) {
    const w = content.w * view.scale;
    const h = content.h * view.scale;
    const mx = Math.min(margin, w);
    const my = Math.min(margin, h);
    return {
      scale: view.scale,
      x: clamp(view.x, mx - w, stage.w - mx),
      y: clamp(view.y, my - h, stage.h - my),
    };
  }

  // Wheel delta to a zoom factor. Pinch on a trackpad arrives as ctrl+wheel with small deltas.
  function wheelFactor(deltaY, deltaMode, ctrlKey) {
    const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
    return Math.exp(clamp(-pixels * (ctrlKey ? 0.01 : 0.002), -0.5, 0.5));
  }

  if (typeof document === "undefined") {
    if (typeof module === "object") module.exports = { clamp, fitView, zoomAt, clampPan, wheelFactor };
    return;
  }

  /* ---- Setup ---- */

  const script = document.currentScript;
  const figures = Array.from(document.querySelectorAll("figure[data-diagram]"));
  if (!script || !figures.length) return;

  const MERMAID_SRC = script.dataset.mermaidSrc;
  const MERMAID_SRI = script.dataset.mermaidIntegrity;
  const MIN_INLINE_SCALE = 0.7; // below this, scroll sideways instead of shrinking text
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const canExpand = typeof HTMLDialogElement === "function";

  const rootStyle = getComputedStyle(document.documentElement);
  const token = (name, fallback) => rootStyle.getPropertyValue(name).trim() || fallback;

  // Diagrams sit on a light card in both themes (see diagrams.css), so they use the light palette
  // directly. The page's subject tone leads; the other subjects follow in site order.
  const PALETTE = JSON.parse(script.dataset.palette);
  const TONES = PALETTE.tones;

  function mermaidConfig() {
    const sans = token("--sans", '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
    const { paper, ink, muted, line, soft, card, signal } = PALETTE;
    const names = ["accent", "rose", "sage", "lilac", "ochre"];
    const lead = TONES[document.documentElement.dataset.tone] ? document.documentElement.dataset.tone : "accent";
    const order = [lead, ...names.filter((name) => name !== lead)].map((name) => TONES[name]);
    const [main, second, third] = order;
    const tones = order.map((t) => t.tone);
    const deeps = order.map((t) => t.deep);
    const softs = order.map((t) => t.soft);
    const vars = {
      darkMode: false,
      fontFamily: sans,
      fontSize: "15px",
      background: paper,
      textColor: ink,
      lineColor: muted,
      primaryColor: main.soft,
      primaryTextColor: ink,
      primaryBorderColor: main.deep,
      secondaryColor: main.soft,
      secondaryTextColor: ink,
      secondaryBorderColor: main.deep,
      tertiaryColor: card,
      tertiaryTextColor: ink,
      tertiaryBorderColor: line,
      mainBkg: main.soft,
      nodeBorder: main.deep,
      nodeTextColor: ink,
      clusterBkg: card,
      clusterBorder: "#878477",
      titleColor: ink,
      edgeLabelBackground: paper,
      // Entity relationship diagrams use the same course tint as flowcharts.
      attributeBackgroundColorOdd: paper,
      attributeBackgroundColorEven: main.soft,
      // Sequence
      noteBkgColor: main.soft,
      noteBorderColor: main.deep,
      noteTextColor: ink,
      actorBkg: main.soft,
      actorBorder: main.deep,
      actorTextColor: ink,
      actorLineColor: muted,
      signalColor: ink,
      signalTextColor: ink,
      labelBoxBkgColor: main.tone,
      labelBoxBorderColor: ink,
      labelTextColor: ink,
      loopTextColor: ink,
      activationBkgColor: main.soft,
      activationBorderColor: main.deep,
      sequenceNumberColor: paper,
      // State
      labelBackgroundColor: paper,
      compositeBackground: card,
      compositeTitleBackground: main.soft,
      altBackground: card,
      specialStateColor: ink,
      innerEndBackground: ink,
      transitionColor: muted,
      transitionLabelColor: ink,
      // Gantt
      sectionBkgColor: main.soft,
      altSectionBkgColor: paper,
      sectionBkgColor2: second.soft,
      taskBkgColor: main.tone,
      taskBorderColor: main.deep,
      taskTextColor: ink,
      taskTextLightColor: ink,
      taskTextDarkColor: ink,
      taskTextOutsideColor: ink,
      taskTextClickableColor: main.deep,
      activeTaskBkgColor: main.soft,
      activeTaskBorderColor: main.deep,
      doneTaskBkgColor: line,
      doneTaskBorderColor: muted,
      critBkgColor: TONES.rose.tone,
      critBorderColor: TONES.rose.deep,
      todayLineColor: signal,
      gridColor: line,
      excludeBkgColor: card,
      // Pie
      pieStrokeColor: ink,
      pieOuterStrokeColor: ink,
      pieTitleTextColor: ink,
      pieSectionTextColor: ink,
      pieLegendTextColor: ink,
      pieStrokeWidth: "1px",
      pieOpacity: "1",
      // Quadrant
      quadrant1Fill: main.soft,
      quadrant2Fill: second.soft,
      quadrant3Fill: card,
      quadrant4Fill: third.soft,
      quadrant1TextFill: ink,
      quadrant2TextFill: ink,
      quadrant3TextFill: ink,
      quadrant4TextFill: ink,
      quadrantPointFill: main.deep,
      quadrantPointTextFill: ink,
      quadrantXAxisTextFill: ink,
      quadrantYAxisTextFill: ink,
      quadrantTitleFill: ink,
      quadrantInternalBorderStrokeFill: line,
      quadrantExternalBorderStrokeFill: ink,
      // XY chart: deep tones read as both bars and lines.
      xyChart: {
        backgroundColor: paper,
        titleColor: ink,
        xAxisLabelColor: ink,
        xAxisTitleColor: ink,
        xAxisTickColor: muted,
        xAxisLineColor: muted,
        yAxisLabelColor: ink,
        yAxisTitleColor: ink,
        yAxisTickColor: muted,
        yAxisLineColor: muted,
        plotColorPalette: deeps.join(","),
      },
      // Packet
      packet: { startByteColor: muted, endByteColor: muted, labelColor: ink, titleColor: ink, blockStrokeColor: main.deep, blockFillColor: main.soft },
      // Git graph
      commitLabelColor: ink,
      commitLabelBackground: soft,
      tagLabelColor: ink,
      tagLabelBackground: main.soft,
      tagLabelBorder: main.deep,
    };
    // Pie, git branches, journey, mindmap/timeline sections (cScale): tones, then soft tints.
    const fills = [...tones, ...softs, card, soft];
    fills.forEach((fill, i) => {
      vars[`pie${i + 1}`] = fill;
      vars[`cScale${i}`] = fill;
      vars[`cScaleLabel${i}`] = ink;
      vars[`cScalePeer${i}`] = i < 5 ? deeps[i] : deeps[i % 5];
    });
    for (let i = 0; i < 8; i++) {
      vars[`git${i}`] = tones[i % 5];
      vars[`gitBranchLabel${i}`] = ink;
      vars[`gitInv${i}`] = deeps[i % 5];
      vars[`fillType${i}`] = i < 5 ? tones[i] : softs[i % 5];
    }
    return {
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: sans,
      htmlLabels: true,
      flowchart: { htmlLabels: true, curve: "linear", padding: 16 },
      suppressErrorRendering: true,
      themeVariables: vars,
    };
  }

  /* ---- Loading and rendering ---- */

  let mermaidReady = null;
  function loadMermaid() {
    if (!mermaidReady) {
      mermaidReady = new Promise((resolve, reject) => {
        if (window.mermaid) {
          resolve(window.mermaid);
          return;
        }
        if (!MERMAID_SRC) {
          reject(new Error("No Mermaid script configured"));
          return;
        }
        const tag = document.createElement("script");
        tag.src = MERMAID_SRC;
        if (MERMAID_SRI) {
          tag.integrity = MERMAID_SRI;
          tag.crossOrigin = "anonymous";
        }
        tag.async = true;
        tag.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error("Mermaid did not initialise")));
        tag.onerror = () => reject(new Error("Mermaid could not be loaded"));
        document.head.appendChild(tag);
      }).then((mermaid) => {
        // Rendering is driven from here; never let Mermaid scan the page on window load.
        mermaid.startOnLoad = false;
        mermaid.initialize(mermaidConfig());
        return mermaid;
      });
    }
    return mermaidReady;
  }

  // Mermaid renders through shared global state, so renders run one at a time.
  let renderCount = 0;
  let renderQueue = Promise.resolve();
  function renderSvg(source) {
    const id = `diagram-svg-${++renderCount}`;
    const job = renderQueue
      .then(loadMermaid)
      .then(async (mermaid) => {
        try {
          const { svg } = await mermaid.render(id, source);
          return svg;
        } finally {
          // Mermaid's temporary measuring nodes, in case an error left them behind.
          document.getElementById(`d${id}`)?.remove();
          document.getElementById(`i${id}`)?.remove();
        }
      });
    renderQueue = job.catch(() => {});
    return job;
  }

  function parseSvg(markup, title) {
    const holder = document.createElement("div");
    holder.innerHTML = markup;
    const svg = holder.querySelector("svg");
    if (!svg) throw new Error("Mermaid returned no SVG");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", title);
    return svg;
  }

  function naturalSize(svg) {
    const box = svg.viewBox && svg.viewBox.baseVal;
    if (box && box.width > 0 && box.height > 0) return { w: box.width, h: box.height };
    const w = parseFloat(svg.getAttribute("width"));
    const h = parseFloat(svg.getAttribute("height"));
    return { w: w > 0 ? w : 800, h: h > 0 ? h : 500 };
  }

  const sources = new WeakMap();

  function showError(figure, pre, error) {
    figure.dataset.state = "error";
    pre.hidden = false;
    if (!figure.querySelector(".diagram-error")) {
      const note = document.createElement("p");
      note.className = "diagram-error";
      note.textContent = "This diagram could not be drawn, so its source is shown instead.";
      figure.append(note);
    }
    console.warn("Diagram could not be rendered:", error);
  }

  function enhance(figure) {
    if (figure.dataset.state !== "pending") return;
    const pre = figure.querySelector("pre.mermaid");
    if (!pre) return;
    const source = pre.textContent;
    sources.set(figure, source);
    figure.dataset.state = "loading";
    renderSvg(source)
      .then((markup) => {
        const svg = parseSvg(markup, figure.dataset.diagramTitle);
        const { w } = naturalSize(svg);
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.style.width = `${w}px`;
        svg.style.maxWidth = "100%";
        svg.style.minWidth = `${Math.round(w * MIN_INLINE_SCALE)}px`;
        svg.style.height = "auto";
        const canvas = document.createElement("div");
        canvas.className = "diagram-canvas";
        canvas.setAttribute("role", "region");
        canvas.setAttribute("aria-label", figure.dataset.diagramTitle);
        canvas.append(svg);
        pre.hidden = true;
        pre.after(canvas);
        if (canvas.scrollWidth > canvas.clientWidth) canvas.tabIndex = 0;
        figure.dataset.state = "ready";
        const expand = figure.querySelector("[data-diagram-expand]");
        if (expand && canExpand) expand.hidden = false;
      })
      .catch((error) => showError(figure, pre, error));
  }

  figures.forEach((figure) => {
    figure.dataset.state = "pending";
  });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          enhance(entry.target);
        });
      },
      { rootMargin: "600px 0px" }
    );
    figures.forEach((figure) => observer.observe(figure));
  } else {
    figures.forEach(enhance);
  }
  window.addEventListener("beforeprint", () => figures.forEach(enhance));

  /* ---- Expanded viewer ---- */

  if (!canExpand) return;

  const expandedCache = new WeakMap();
  let viewer = null;

  function buildViewer() {
    const dialog = document.createElement("dialog");
    dialog.className = "diagram-viewer";
    dialog.setAttribute("aria-labelledby", "diagram-viewer-title");
    dialog.innerHTML = `
      <div class="diagram-viewer-panel">
        <div class="diagram-viewer-bar">
          <h2 class="diagram-viewer-title" id="diagram-viewer-title"></h2>
          <div class="diagram-viewer-tools" role="group" aria-label="Zoom controls">
            <button type="button" data-action="out" aria-label="Zoom out" title="Zoom out (−)"><span aria-hidden="true">−</span></button>
            <span class="diagram-viewer-level" aria-hidden="true">100%</span>
            <button type="button" data-action="in" aria-label="Zoom in" title="Zoom in (+)"><span aria-hidden="true">+</span></button>
            <button type="button" data-action="reset" aria-label="Reset zoom and position" title="Reset (0)">Reset</button>
            <button type="button" data-action="close" class="diagram-viewer-close" aria-label="Close expanded diagram" title="Close (Esc)">Close</button>
          </div>
        </div>
        <div class="diagram-viewer-stage" tabindex="0" role="group" aria-label="Diagram canvas" aria-describedby="diagram-viewer-help">
          <div class="diagram-viewer-content"></div>
        </div>
        <p class="diagram-viewer-help" id="diagram-viewer-help">Drag to pan · scroll or pinch to zoom · <kbd>+</kbd> <kbd>−</kbd> zoom · arrow keys pan · <kbd>0</kbd> resets · <kbd>Esc</kbd> closes</p>
        <span class="visually-hidden" role="status"></span>
      </div>`;
    document.body.append(dialog);

    const v = {
      dialog,
      title: dialog.querySelector(".diagram-viewer-title"),
      stage: dialog.querySelector(".diagram-viewer-stage"),
      content: dialog.querySelector(".diagram-viewer-content"),
      level: dialog.querySelector(".diagram-viewer-level"),
      status: dialog.querySelector("[role='status']"),
      size: { w: 1, h: 1 },
      view: { scale: 1, x: 0, y: 0 },
      limits: { min: 0.1, max: 6 },
      touched: false,
      trigger: null,
    };

    const stageSize = () => ({ w: v.stage.clientWidth, h: v.stage.clientHeight });

    function apply(animate) {
      v.view = clampPan(v.view, v.size, stageSize(), 48);
      v.content.classList.toggle("is-easing", Boolean(animate) && !reducedMotion.matches);
      v.content.style.transform = `translate(${v.view.x}px, ${v.view.y}px) scale(${v.view.scale})`;
      v.level.textContent = `${Math.round(v.view.scale * 100)}%`;
    }

    function announce() {
      v.status.textContent = `Zoom ${Math.round(v.view.scale * 100)} percent`;
    }

    v.reset = (animate) => {
      const stage = stageSize();
      const fit = fitView(v.size, stage, 2);
      v.limits = { min: Math.min(fit.scale, 1) * 0.5, max: Math.max(6, fit.scale * 2) };
      v.view = fit;
      v.touched = false;
      apply(animate);
    };

    function zoomCentre(factor) {
      const stage = stageSize();
      v.view = zoomAt(v.view, factor, stage.w / 2, stage.h / 2, v.limits);
      v.touched = true;
      apply(true);
      announce();
    }

    function pan(dx, dy) {
      v.view = { scale: v.view.scale, x: v.view.x + dx, y: v.view.y + dy };
      v.touched = true;
      apply(true);
    }

    dialog.querySelector(".diagram-viewer-tools").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (action === "in") zoomCentre(1.25);
      else if (action === "out") zoomCentre(0.8);
      else if (action === "reset") {
        v.reset(true);
        announce();
      } else if (action === "close") dialog.close();
    });

    dialog.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const step = event.shiftKey ? 160 : 48;
      switch (event.key) {
        case "+":
        case "=":
          zoomCentre(1.25);
          break;
        case "-":
        case "_":
          zoomCentre(0.8);
          break;
        case "0":
          v.reset(true);
          announce();
          break;
        case "ArrowLeft":
          pan(step, 0);
          break;
        case "ArrowRight":
          pan(-step, 0);
          break;
        case "ArrowUp":
          pan(0, step);
          break;
        case "ArrowDown":
          pan(0, -step);
          break;
        default:
          return;
      }
      event.preventDefault();
    });

    v.stage.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const rect = v.stage.getBoundingClientRect();
        const factor = wheelFactor(event.deltaY, event.deltaMode, event.ctrlKey);
        v.view = zoomAt(v.view, factor, event.clientX - rect.left, event.clientY - rect.top, v.limits);
        v.touched = true;
        apply(false);
      },
      { passive: false }
    );

    v.stage.addEventListener("dblclick", (event) => {
      const rect = v.stage.getBoundingClientRect();
      v.view = zoomAt(v.view, 1.6, event.clientX - rect.left, event.clientY - rect.top, v.limits);
      v.touched = true;
      apply(true);
    });

    // Drag to pan with one pointer; pinch to zoom with two.
    const pointers = new Map();
    const firstTwo = () => Array.from(pointers.values()).slice(0, 2);
    const distance = ([a, b]) => Math.hypot(a.x - b.x, a.y - b.y);
    const middle = ([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    v.stage.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      v.stage.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      v.stage.classList.add("is-dragging");
    });

    v.stage.addEventListener("pointermove", (event) => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      const before = firstTwo().map((p) => ({ x: p.x, y: p.y }));
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        v.view = { scale: v.view.scale, x: v.view.x + event.clientX - last.x, y: v.view.y + event.clientY - last.y };
      } else {
        const after = firstTwo();
        const rect = v.stage.getBoundingClientRect();
        const d0 = distance(before);
        const m0 = middle(before);
        const m1 = middle(after);
        if (d0 > 0) v.view = zoomAt(v.view, distance(after) / d0, m0.x - rect.left, m0.y - rect.top, v.limits);
        v.view = { scale: v.view.scale, x: v.view.x + m1.x - m0.x, y: v.view.y + m1.y - m0.y };
      }
      v.touched = true;
      apply(false);
    });

    const release = (event) => {
      pointers.delete(event.pointerId);
      if (!pointers.size) v.stage.classList.remove("is-dragging");
    };
    v.stage.addEventListener("pointerup", release);
    v.stage.addEventListener("pointercancel", release);
    v.stage.addEventListener("lostpointercapture", release);

    // Clicking the backdrop closes; a drag that merely ends there does not.
    let downOnBackdrop = false;
    dialog.addEventListener("pointerdown", (event) => {
      downOnBackdrop = event.target === dialog;
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog && downOnBackdrop) dialog.close();
    });

    window.addEventListener("resize", () => {
      if (!dialog.open) return;
      if (v.touched) apply(false);
      else v.reset(false);
    });

    dialog.addEventListener("close", () => {
      pointers.clear();
      v.stage.classList.remove("is-dragging");
      document.documentElement.classList.remove("diagram-viewer-open");
      document.documentElement.style.removeProperty("--diagram-scrollbar");
      const trigger = v.trigger;
      v.trigger = null;
      if (trigger && trigger.isConnected) trigger.focus();
    });

    return v;
  }

  async function openViewer(figure, trigger) {
    if (viewer && viewer.dialog.open) return;
    const source = sources.get(figure);
    if (source === undefined) return;
    if (!expandedCache.has(figure)) expandedCache.set(figure, renderSvg(source));

    let svg;
    try {
      svg = parseSvg(await expandedCache.get(figure), figure.dataset.diagramTitle);
    } catch (error) {
      expandedCache.delete(figure);
      console.warn("Expanded diagram could not be rendered:", error);
      return;
    }

    viewer = viewer || buildViewer();
    const v = viewer;
    const size = naturalSize(svg);
    svg.setAttribute("width", String(size.w));
    svg.setAttribute("height", String(size.h));
    svg.style.maxWidth = "none";
    v.size = size;
    v.content.style.width = `${size.w}px`;
    v.content.style.height = `${size.h}px`;
    v.content.replaceChildren(svg);
    v.title.textContent = figure.querySelector(".diagram-header > span")?.textContent.trim() || "Diagram";
    v.status.textContent = "";
    v.trigger = trigger;

    const root = document.documentElement;
    root.style.setProperty("--diagram-scrollbar", `${Math.max(0, window.innerWidth - root.clientWidth)}px`);
    root.classList.add("diagram-viewer-open");
    v.dialog.showModal();
    v.reset(false);
    v.stage.focus({ preventScroll: true });
  }

  figures.forEach((figure) => {
    const button = figure.querySelector("[data-diagram-expand]");
    if (button) button.addEventListener("click", () => openViewer(figure, button));
  });
})();
