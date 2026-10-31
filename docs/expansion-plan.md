# Expansion plan: AI systems library, fixes, sketch diagrams

Planned 2026-10-30. Branch `codex/site-rebuild`. Hugo, the toolchain, and the
deploy workflow stay as they are; this plan changes only templates, styles,
scripts that run in the browser, and content.

Audience note for agents: write for engineers who build and run large AI
systems. Never state who the site is for.

## Goals

1. Fix verified bugs in templates and browser scripts.
2. Diagrams: one consistent pencil-sketch look, better diagrams where a
   mechanism is explained only in prose.
3. Depth over breadth: expand existing courses only where a gap matters, and
   add AI-systems courses focused on system design, scale, performance, and
   frontier security.

## Dating new lessons

- Existing 104 lessons keep their dates. A revised lesson gets `lastmod` set to
  the revision day; the header then shows Updated.
- New lessons are dated on the day they are published, with a time offset per
  lesson in reading order (`2026-11-02T00:10:00Z`, `…T00:20:00Z`, …) so the
  existing strict-ordering rule holds. Headers show the day only.
- Existing courses grow only by appending modules after their last module, never
  by inserting lessons between existing ones. No template change needed.
- No future dates: Hugo does not publish them.

## Workstream A — bugs (effort: medium)

Source: the read-only review (templates, JS, CSS, scripts). Fix high and medium
findings, each with a reproduction in a generated page or a node test. Low
findings batched. No behavior changes beyond the fixes.

Findings (2026-10-30), in fix order:

1. Module prev/next reversed on all 25 module pages (`list.html:68-69`; Hugo's
   `Prev`/`Next` run against reading order). Arrow keys follow them too.
2. Copy button likely double-spaces code (`code.js:22` uses `innerText` over
   flex line spans); use `textContent`.
3. More than 26 lessons in a module renders `1.%!s(<nil>)` silently; fail the
   build instead (relevant once courses grow).
4. Course sidebar clips the current-lesson bar and focus rings
   (`lesson.css` overflow with negative margins).
5. Diagram viewer focus ring invisible in dark mode (`diagrams.css:42`).
6. Double-click on Expand can open the viewer twice (`diagrams.js`).
7. Same-page search result leaves focus on the Search button (`search.js`).
8. Course-page contents panel renders when empty; active-section tracking
   includes generated module headings.
9. "Reading position 0%" shown without JavaScript.
10. `check_site.py` misses duplicate IDs, broken ARIA references, `%!` template
    leaks, and `index.json` anchors; add those checks.

Batched polish: remove the slogans left in the notes hub (`list.html`), theme
color meta follows the toggle, print stylesheet, labeled contents navs,
`<nav>` breadcrumbs, mark-as-read only after real reading, `partialCached`
for the lesson-order partial, reading time excluding diagram/code source.

## Workstream B — diagrams (effort: low for restyling, medium for new diagrams)

Audit facts (2026-10-30): all 808 diagrams parse. Mermaid's hand-drawn look
covers only flowchart, state, ER, and mindmap (451 of 808); sequence (147),
xychart (81), quadrant, block, timeline, packet, gantt, gitGraph, and sankey
stay classic, so 103 of 104 lessons would mix looks. Rough.js draws fills as
hatching (pale tints wash out) and, with seed 0, re-randomizes every render.

1. Sketch look, consistent across every type:
   - `look: "handDrawn"` with a fixed non-zero `handDrawnSeed` (inline and
     expanded views match, no change between loads) for the supported types.
   - A vendored handwriting font (Excalifont, SIL OFL 1.1, licence alongside;
     sans-serif fallback) for every diagram type.
   - A subtle shared SVG "pencil" filter on strokes of the classic-only types so
     sequence, chart, and block diagrams match the sketch.
   - Stronger fills/strokes so tints survive hatching; visual check in a browser
     before rollout. Update `docs/lesson-style.md`.
2. Role semantics before the switch: deny/reject outcomes use `good` (the
   control holding), `warn` only for attacker-controlled or dangerous nodes;
   give `compute`/`memory`/`queue`/`io` distinguishable treatments or document
   them as label-only; state diagrams use `warn`/`good`.
3. Audit fixes: ~33 recolored refusals, ~9 misused `warn`, 3 flowcharts that
   should be state diagrams, the 25-node block-cipher diagram split, list-like
   block diagrams replaced, 2 off-palette sequence rects, `autonumber` on 21
   sequences, 7 vague and 10 overlong titles. One direction default and one
   edge-label syntax.
4. New diagrams where a mechanism is prose-only (audit list: circuit-breaker
   guards, token bucket/GCRA, entropy pool, fuzzing loop, read repair,
   credential issuance, SVID validation), then in every new lesson by default.

## Workstream C — content

### Expansions to existing courses (effort: medium)

| Course | New module (appended) | Lessons |
| --- | --- | --- |
| Systems design | Scale and performance: queueing and Little's law, caching, partitioning and sharding, load balancing and tail latency, profiling a slow service | 5 |
| Systems design | Distributed data: consensus (Raft), storage engines (B-tree vs LSM), logs and stream processing, distributed transactions | 4 |
| AI security engineering | Frontier model security: securing model weights, research and training infrastructure, insider risk and model access, extraction and distillation, capability evaluations and release gates, confidential inference | 6 |
| Infrastructure security | Securing GPU clusters: multi-tenant GPU isolation, scheduler and fabric security, storage and checkpoint security | 3 |

Application security and cryptography: no new modules now; cross-links only.

### New courses (effort: medium)

User decision 2026-10-30: combine courses where possible. Three new courses;
observability becomes a systems-design module. Slugs: `docs/course-outlines.md`.

| # | Course | Combines | Lessons |
| --- | --- | --- | --- |
| 6 | Machine learning systems | ML foundations, transformers, GPU architecture and performance, training at scale, clusters, post-training | 30 |
| 7 | Inference engineering | inference mechanics, batching, cost, serving systems, vLLM internals, distributed and production inference | 24 |
| 8 | AI system design | AI engineering (interfaces, retrieval, agents, evals) with AI infrastructure and worked designs | 30 |

Appended modules: systems design (scale and performance, distributed data,
observability), AI security (frontier model security), infrastructure security
(securing GPU clusters): 22 lessons. Source material: the inspiration course
pages, adapted, corrected, and extended per `docs/lesson-style.md`; code ported
to Python.

### Library presentation (effort: low)

- Group the notes hub and homepage list into "Security" and "Systems and AI".
- Add three tones for the new courses (palette in `site/data/diagrams.json` and
  CSS), contrast-checked, reused where needed.
- Copy stays short and plain.

## Execution order

1. Wave 0 (effort medium): bug fixes · sketch-diagram renderer · fixed course
   outlines (`docs/course-outlines.md`).
2. Wave 1 (medium): inference engineering, AI system design, and the appended
   modules. One agent per one or two modules, disjoint files, private builds.
3. Wave 2 (medium): machine learning systems, glossaries.
4. Wave 3 (low): diagram audit fixes across old lessons, library grouping and
   tones, cross-links from old lessons to new ones (`lastmod` set).
5. Each wave ends with: production build and checks, every program re-run
   (`run_examples.py`), consistency sweep (spelling, branding, icons), and a
   list of unverified external claims appended to `docs/content-verification.md`.

Nothing is committed or pushed without approval.

## Risks

- External links and version facts cannot be fetched from the sandbox; they are
  flagged, not guessed. vLLM internals change quickly: pin the version and say
  "as of".
- GPU and ML programs are standard-library simulations (no NumPy, no GPU):
  they illustrate mechanisms and arithmetic, not real kernels.
- Library size roughly doubles; search index and build time grow but stay small.

## Status — 2026-10-30

- Wave 0 done: bug fixes (8 of 10 + polish; 5–6 in diagrams), pencil-sketch diagrams (handDrawn seed 7, Excalifont, pencil filter).
- Wave 1 done: inference engineering (24), AI system design (30), systems design modules 6–8 (13), AI security module 6 (6), infrastructure security module 6 (3) = 76 lessons.
- Verification: production build passes all checks (238 pages); 187 of 188 programs reproduce exactly (the profiling demo varies in timing by design).
- Pending: browser review; deferred cross-links between new modules; Wave 2 (machine learning systems, held at user request for budget); Wave 3 (diagram audit fixes, library grouping/tones).
