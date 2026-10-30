# Personal website and security notes rebuild

Status: foundation, lesson system, search, diagrams, and all five courses
(25 modules, 104 lessons, five glossaries) implemented locally; browser review pending.
Keep changes uncommitted until the user reviews a polished version.
Planning date: 2026-10-28. Baseline: `ff937e6` on `main`.

## Intent and agreed workflow

Build a personal website with a recognizable voice and a substantial, carefully
edited security learning library. Establish our own brand through consistent
colors, lesson structure, diagrams, navigation, reading progress, and small
interaction details. Keep the personal landing page restrained and make the
notes pleasant to study.

The five subjects are **AI security engineering, application security,
infrastructure security, cryptography, and systems design**.

Work in bounded bursts, each producing one coherent, independently reviewable
change. Test locally and present each result. The current instruction is to keep
all changes uncommitted while polishing; commit and push only after explicit
approval of a later version. Production publication is an explicit release step.

## Current evidence

- The live homepage matches this checkout's `index.html` byte for byte.
- There are 13 HTML pages, two listed posts, seven CSS files, and nine JS files.
- Most pages use a different stylesheet arrangement from the homepage.
- The checkout contains published HTML, not an editable Hugo content/template
  project. Its README describes direct static serving.
- The existing GitHub Actions workflow uploads the repository root and deploys
  on pushes to `main`; it does not build a site from Markdown.
- The working tree was clean before this planning document was added.
- At baseline Hugo was not installed. P1 installed the pinned Hugo 0.169.0 tool
  in this checkout's ignored `.tools/` directory; system tools were not changed.
- The current address is `https://hritesh-sonawane.github.io/`. There is no
  `CNAME` file or supplied custom domain.

The research pass assessed reading patterns, visual details, and diagram tools.
All new site templates, styles, and copy belong to this site's own identity.

## Brand and profile

- The user permits reusing content from the inspiration course
  (`infra.riteshsonawane.com`) directly, adapted, corrected, and enhanced
  (decision 2026-10-29). Keep inspiration-site names, design credits, links, and
  third-party branding out of generated pages, metadata, and visual assets. Development documentation
  and necessary software notices are not the site's public brand.
- Keep primary technical citations in lessons where they substantiate a claim.
- Lead the profile with the strongest verified achievements, outcomes, and
  contributions. Use confident, ambitious language and concrete evidence.
- Preserve the distinction between ambition, completed accomplishments, and
  professional experience. Do not invent awards, employment, metrics, or impact.

## URLs and hosting

Start with the existing GitHub Pages site:

| Address | Purpose |
| --- | --- |
| `/` | Personal introduction, selected work, selected writing |
| `/about/` | Verified experience, interests, and contact links |
| `/projects/` | Selected project case studies |
| `/notes/` | Library overview and starting paths |
| `/notes/<subject>/` | Subject overview and ordered material |
| `/notes/<subject>/<lesson>/` | Stable lesson address |

The desired later address is `notes.<domain-the-user-controls>`. GitHub controls
the `github.io` DNS namespace; this repository cannot create
`notes.hritesh-sonawane.github.io`. No custom domain has been selected or purchased.

Use `/notes/` for the first release and keep canonical URLs and internal links
generated from configuration. When a domain is available, add a notes-only build
profile using the same content and templates. Select its hosting target then;
GitHub Pages in a separate repository and a second Cloudflare Pages project are
supported options. Do not add a second repository or provider during the initial
rebuild. Preserve redirects from the old notes addresses when moving hosts.

## Source and build design

Use **Hugo + Markdown + custom HTML/CSS + small JavaScript modules + Mermaid**.
Keep the current repository as the source of truth. Build static output suitable
for GitHub Pages. A backend or account system is unnecessary for this scope.

Add the new source under `site/` while the existing published files continue to
serve the current site. Build into an ignored `build/public/` directory. Switch
deployment to that directory only at the release step, then remove obsolete
generated files in a separate cleanup change.

```text
site/
  hugo.toml
  content/
    _index.md
    about.md
    projects/
    notes/
      _index.md
      ai-security-engineering/
      application-security/
      infrastructure-security/
      cryptography/
      systems-design/
  layouts/             shared page, lesson, navigation, and metadata templates
  assets/              readable CSS, JavaScript, and diagram sources
  static/              icons and other assets copied without transformation
  archetypes/          a small lesson starter
scripts/               build, preview, and proportional checks
docs/                  this plan and the content migration record
```

Pin Hugo and third-party assets when the foundation is implemented. Provide one
documented preview command and one build/check command. Keep generated output
and downloaded tools out of version control. No framework migration is needed
to add interactive details.

## Visual and reading system

Implement this reading system in our own maintainable source.

| Element | Direction for this site |
| --- | --- |
| Base palette | Warm cream `#faf9f5`, ink `#141413`, gray `#65645b`, fine warm-gray rules |
| Primary accent | Slate blue `#8faec1`, used for large surfaces, the brand mark, and reading progress; deep blue `#31546b` for text accents |
| Subject colors | AI security: slate blue; application security: dusty rose; infrastructure security: sage; cryptography: lilac; systems design: ochre |
| Typography | Expressive serif display headings, system sans-serif prose, monospace labels and code; no external font dependency |
| Composition | Generous whitespace, a bounded prose column, clear hierarchy, selective colored blocks and offset shadows |
| Library navigation | Collapsible subject/series tree, breadcrumbs, current lesson, previous/next links |
| Lesson navigation | Desktop contents panel, compact mobile contents control, section links and current-section indication |
| Reading progress | Thin fixed bar in the subject color; bounded at 0–100%; measures scroll position only |
| Code | Highlighted blocks, language label, copy button with feedback, horizontal scrolling where needed |
| Diagrams | Shared semantic colors, Mermaid sequences/flows, optional hand-drawn style, expanded view with pan/zoom |
| Search | Keyboard shortcut, useful result context, arrow navigation, Escape to close, focus returned on close |
| Small details | Stable heading anchors, prerequisite links, computed reading estimates, useful related notes, restrained hover feedback |
| Added value | Explicit assumptions, failure cases, evidence links, verification dates, limitations, and recall questions |

Use colors with sufficient contrast and include labels so color is not the only
signal. Test keyboard access, mobile overflow, focus, reduced motion, and diagram
legibility. Keep core content and navigation usable without JavaScript. Load
diagram/search code only when needed. Check asset licenses when selecting fonts
and libraries. Cite technical content sources without adding inspiration credits
to the site's branding.

Dark mode and saved reading position are follow-up slices after the initial
reading experience works. A reading marker must never imply demonstrated
understanding or mastery. Additional features need a specific reader benefit.

## Editorial structure

| Subject | Initial scope |
| --- | --- |
| AI security engineering | Threat models, model/tool trust boundaries, agent identity and authorization, evaluation and containment |
| Application security | Authentication, authorization, validation, API boundaries, adversarial testing |
| Infrastructure security | Workload identity, secrets, container/Kubernetes boundaries, deployment controls, observability |
| Cryptography | Threat assumptions, key lifecycle, signatures, authenticated encryption, envelope encryption |
| Systems design | Invariants, failure modes, concurrency, reliability, capacity, and explicit tradeoffs |

These are organizational scopes, not promises to publish a complete curriculum
at launch. Cross-link overlapping concepts rather than repeating explanations.
Introduce series/module numbering only where an actual sequence exists.

Each substantive lesson should have:

1. A precise question and a concise explanation of the idea.
2. Prerequisites and assumptions that affect the conclusion.
3. A diagram showing the mechanism or trust boundary.
4. One worked example or reproducible experiment where useful.
5. A failure case, negative test, or counterexample.
6. The engineering decision, its limits, and what remains unverified.
7. A short recall exercise and primary sources with relevant versions/dates.

Write original explanations grounded in primary sources and our own inspected work.
Distinguish a reading summary, a tested lab, and personal professional experience.
Treat appealing presentation as a separate concern from technical verification.

Markdown metadata should cover title, summary, subject, optional series/order,
prerequisites, draft/publication state, publication/update dates, and sources.
Compute reading time from content. Add a verification date only after the
relevant check actually runs. Keep unfinished or unverified material in drafts.

An original AI security course outline now has six modules and 24 planned
lessons: system modeling, hostile input, agent authority, data/artifact trust,
runtime containment, and verification/operations. Preserve the concise pacing
while writing original explanations and experiments. The outline is explicitly
labeled; it is not a claim that the lessons are complete.

Start the verified content with an infrastructure-security lesson about the
workload-identity boundary and one Secure Workload Platform case study. Inspect the implementation
and run the relevant tests before making claims. Describe the platform as a
learning simulator and retain its documented attestation/replay limitations.
The active integrated project remains Secure Workload Platform.

## Small-change sequence

The rows are review units, not one large implementation request. Split a row
further if it grows beyond one understandable diff. Later rows depend on accepted
earlier work. Every row ends with local verification and user review.

| ID | Proposed change | Acceptance evidence |
| --- | --- | --- |
| P0 | Record this plan | Requirements, hosting constraint, sequence, and approval gate are explicit |
| P1 | Add Hugo source, pinned tool setup, and local build/preview commands | Fresh local build works; old deployment remains operational |
| P2 | Add visual tokens and shared responsive page shell | Local desktop/mobile views establish colors, type, spacing, and navigation |
| P3 | Build the personal homepage | Clear factual introduction, selected-work area, notes entry, working links |
| P4 | Build the notes hub and five subject overviews | Useful hierarchy and honest empty/draft states; no dead lesson links |
| P5 | Add the lesson template and navigation | Prerequisites, contents, anchors, callouts, sources, previous/next navigation |
| P6 | Add reading progress, current-section indication, and code copying | Short/long pages, keyboard use, copy success/failure, and mobile behavior checked |
| P7 | Add diagrams and their expanded viewer | Diagram source renders; labels remain readable; open/close, focus, pan/zoom, and reduced motion checked |
| P8 | Add local search and keyboard controls | Generated index reflects published pages; matches, empty results, navigation, and focus checked |
| P9 | Write one verified lesson | Primary sources checked; runnable example and negative case verified; limitations stated |
| P10 | Add one project case study and factual about content | Claims map to inspected evidence or user-supplied facts; current biography confirmed |
| P11 | Resolve legacy content and addresses | Explicit keep/rewrite/redirect/archive decisions; old article URLs accounted for |
| P12 | Build the release workflow and review the complete local site | Build/link/metadata checks pass; desktop/mobile and keyboard walkthrough complete |
| P13 | Publish the approved release, then clean up old output separately | Explicit approval to push the release to `main`; deployment and public URLs verified |

Custom-domain setup is a later change after a domain and DNS access exist. It
includes domain verification, exact DNS records, HTTPS, canonical URLs, feeds,
redirects, and a public routing check. A directory alone is not a subdomain.

Initial legacy decisions: remove the Markdoc demonstration from featured writing;
review/rewrite the LLM attack summary; curate the projects list into explained
case studies; repair placeholder metadata. Record final URL decisions in P11.
Do not silently rewrite article dates or assert an unverified employment history.

## Burst and account-usage discipline

- Execute one review unit per burst. A build-foundation change, an interaction,
  and a researched article are separate bursts.
- Use the existing analysis and this plan. Read changed/relevant files instead
  of rediscovering the whole repository or reference site each time.
- Parallel agents are allowed (user decision, 2026-10-29) when each owns a
  disjoint set of files, builds to a private destination, and reports back for
  review. The shared foundation (templates, front matter, style guide in
  `docs/lesson-style.md`) is written first, by one agent.
- Check remaining account allowance at burst boundaries, not continuously.
  Treat 30% remaining in either applicable window as a conservative checkpoint
  to avoid starting another substantial burst. This is a soft pacing rule, not
  a guarantee: account usage is shared and task consumption varies.
- If a burst grows beyond one review unit, check allowance before adding another
  feature. The color/library burst was too broad; subsequent bursts should own
  one behavior or one lesson, with smaller diffs and fewer preview iterations.
- If the scope expands or an investigation becomes open-ended, checkpoint the
  findings and remaining work before starting another change.
- Run relevant checks once after stable edits. Repeat or broaden them when a
  failure, further edit, or unresolved concern warrants it.
- End with a compact handoff: changed files, verification, preview address,
  remaining issue, exact proposed commit, and next review unit.
- Do not generate the five curricula in bulk. Expand one verified note at a time.

## Git and release discipline

Create `codex/site-rebuild` before the first approved commit or when implementation
begins, whichever comes first. Keep work on that branch.
After a slice is locally tested, show its result and diff summary. Await explicit
approval before creating its commit and pushing it. Stage only the approved
files. Use one descriptive commit for each approved change; do not amend or
rewrite approved history unless requested.

The current workflow deploys only `main`. Keep that production boundary during
the rebuild. A feature-branch push is a source checkpoint; it is not a production
release. If later infrastructure enables branch previews, record that separately.
Approval to push a feature branch does not authorize publication to `main`.

At release, publish the generated output rather than the source repository root.
Account for existing paths, canonical URLs, sitemap, feed, metadata, assets, 404,
and draft exclusion. Retain a known working revision for rollback.

## Next checkpoint

- P0: plan written; sequence, subject paths, approval/hosting/pacing constraints,
  whitespace, and referenced existing files validated locally.
- P1: complete locally; uncommitted.
- P2: color system and responsive shell complete locally.
- P3: initial homepage composition present; achievement-led profile still pending.
- P4: five subject overviews and AI course outline present.
- P5–P6: lesson template, course tree, prerequisites, difficulty, reading time,
  previous/next, heading anchors, callouts, tables, and code copy complete.
- P7: Mermaid (vendored 11.17.2, provisional integrity) and the expanded viewer
  complete; browser check pending.
- P8: local search (`/index.json`, ⌘K/Ctrl-K, `/`) complete; browser check pending.
- P9: the AI security course is adapted from the inspiration course, corrected
  and extended: 22 lessons, 19 Python programs re-run with matching output, and
  a glossary. External links could not be fetched from the sandbox; see the
  2026-10-29 content handoff.
- P10–P13 pending.
- Branch: `codex/site-rebuild`. No commit, push, or deployment has been performed.
- Next: browser review of diagrams/search/course tree; external link and
  regulatory-date check; Mermaid re-verification against npm; then P10.
- Proposed foundation commit after approval:
  `build: add pinned Hugo foundation and local preview`.
- Needed before P10: current biography and professional claims the user wants
  published. This does not block P1–P9.

### P1 handoff

- Added the own-brand Hugo source under `site/`, a checksum-pinned local tool,
  and dependency-free Python build/check/preview commands. Updated the README
  and ignored local tools, caches, generated output, and screenshots.
- Production output: `build/public/`. Local preview: `http://localhost:1313/`.
- The homepage and notes entry use temporary foundation copy; the visual system
  and achievement-led profile are later review units.
- Verified on this Apple Silicon Mac: installation and repeat setup; production
  build; local links, fragments, assets, canonicals, and source exclusion; draft
  inclusion with the preview build flag and exclusion from production; custom
  draft slug handling; stale-file cleanup; stale-draft rejection; execution from
  another directory; HTTP 200 for home/notes and 404 for a missing route.
- Inspected the homepage and notes navigation in the local browser, including
  the narrow viewport. Saved `build/qa/foundation-home.png` for review.
- Checked generated output for unwanted inspiration-site names and design
  credits. Only this site's branding is present.
- Linux installation paths are configured from official release checksums but
  have not been executed on a Linux host.
- Existing published HTML and the deployment workflow are unchanged. There is
  no custom-domain configuration. No commit, push, or deployment occurred.

### Color and library handoff — 2026-10-29

- Applied cream, ink, and an accent (coral at the time, since replaced by slate
  blue; see the palette follow-up), with a full-accent library hero, original brand
  mark/favicon, serif display typography, and complementary subject colors.
- Added the homepage composition, original boundary illustration, subject
  overviews, and an original six-module AI security outline with 24 planned lessons.
- Added course breadcrumbs, subject navigation, desktop contents, mobile
  expandable contents, reading progress, and active-section tracking.
- Verified production build and all eight HTML pages' internal references,
  unique IDs, source exclusion, JavaScript syntax, own-brand output, and outline
  counts. Tested text/background pairs exceed 4.5:1 contrast.
- Inspected desktop and narrow layouts. Observed reading position change from
  0% to 100%; selecting a mobile contents entry closes the control and focuses
  the chosen heading.
- Keep this work uncommitted for the later polished review, as requested.
- Browser review found that the running preview had not picked up the newly
  created static directory. Restarted it and confirmed all seven content routes
  plus both SVG assets return HTTP 200. The SVG responses parse successfully.
- Saved desktop screenshots under `build/qa/`. Production checks pass after
  the preview fix. Stop at this checkpoint to preserve account allowance;
  resume with one bounded lesson/template task after capacity is available.

### Course content handoff — 2026-10-29

- Foundation first (templates, render hooks, `docs/lesson-style.md`,
  `site/archetypes/lesson.md`, lesson 1.a), then six parallel agents with disjoint
  files: four content agents (modules 1–2, 3, 4, 5 + glossary), diagrams, search.
- Code examples are Python 3.10+, standard library, offline (user decision).
  `/tmp/lesson-tools/run_examples.py` re-ran all 19 programs: all outputs match.
- Production build passes all checks (36 HTML pages). No Go, icon syntax, or
  inspiration-site branding remains in content.
- The sandbox blocked outbound fetches, so external links are canonical but
  unverified. Items flagged for a human check: EU AI Act Digital Omnibus status,
  Article 73 deadlines, GPAI one-third compute threshold, COSAiS status, OWASP
  page slugs, several arXiv IDs, MCP 2025-11-25 details, CaMeL figures.
- Mermaid was taken from the inspiration site's `/vendor/` copy (npm blocked);
  see `scripts/vendor-assets.json` for the re-verification step.
- Local servers and the browser tool are blocked in the agent sandbox, so no
  in-browser check has been done yet.

### Four-course handoff — 2026-10-29

- User decision (2026-10-29): write all four remaining courses now, in parallel,
  auto-approved. Overrides "do not generate the five curricula in bulk".
- Course pages written first with fixed outlines (module/lesson slugs) so 20
  module agents could cross-link before files existed; brief kept at
  `/tmp/course-build/BRIEF.md` (not in the repo).
- Result: application security 21, infrastructure security 19, cryptography 20,
  systems design 22 lessons, plus a glossary for each. 113 Python programs
  re-run with `run_examples.py`: all match. `scripts/site.py build` passes.
- Three lessons hit a safety stop and were rewritten with a defensive scope
  (crypto 1.b randomness; appsec 4.c SSRF, 4.d parsers, 4.e files): no PRNG
  prediction code, no filter-bypass payload lists, no pickle payloads.
- Homepage: "On the bench" strip removed; a short profile section ("What I work on")
  added, then trimmed to one sentence; principle grid, taglines, and footer quote removed.
- Lesson `date`/`lastmod`/`verified` were spread from 2026-04-01 to 2026-10-28
  at the user's request (display dates, not the actual run date).
- External links in the new courses were not fetched; per-module lists of
  unverified claims are in `docs/content-verification.md`.

### Course dates and diagram consistency — 2026-10-29

- Replaced the irregular display dates with a two-day cadence across all 104
  lessons, ordered by subject, module, and lesson weight: 1 April–24 October
  2026. Publication, update, and existing code-run display dates agree. This
  follows the earlier user decision to use editorial display dates; the actual
  example runs remain documented in the content handoffs above.
- Lesson headers now show Published; Updated appears only for a later revision.
  The shared lesson-order partial rejects missing or regressing publication
  dates and revisions before publication.
- Centralized diagram colors in `site/data/diagrams.json`. Ordinary nodes,
  sequence notes, state headings, and ER attributes follow the course tint.
  Warning and success styles remain consistent across courses; warnings also
  have dashed outlines. Shared classes cover flowcharts, blocks, and states.
- Removed local node-color overrides and standardized 38 sequence highlight
  colors. Kept the existing diagram types and course colors. Flowchart edges
  are straight, SVGs have descriptive accessible labels, and overflowing
  canvases receive keyboard focus. Updated `docs/lesson-style.md`.
- Verification: production build and all 142 HTML-page checks pass; all 808
  generated Mermaid diagrams parse with the production palette and strict
  sanitization. Checked the 104-date sequence, generated headers, palette
  serialization in all five subjects, and negative builds for date regressions.
  Simulated-DOM integration checks cover the five course palettes, SVG labels,
  inline rendering, and expanded-view open/close. No lesson prose or programs
  changed. The local preview returns HTTP 200 with the new dates and palette.
- Visual browser review remains pending: Chrome computer access was not
  approved by the tool, and the in-app browser is unavailable in this session.
  Preview: `http://localhost:1313/notes/`. No commit, push, or deployment.
- Proposed commit after review: `style: align course dates and diagram themes`.
  Next review unit: desktop/mobile visual inspection of the lesson diagrams.

### Minimal homepage introduction — 2026-10-29

- Replaced the oversized slogan, eyebrow, illustrated card, and hero buttons
  with a small sans-serif greeting, two short paragraphs, and a plain notes
  link. Removed the retired hero styles and their responsive overrides.
- Simplified the introduction and homepage description in
  `site/content/_index.md`. The introduction uses a single readable column,
  ordinary body text, and smaller spacing on mobile.
- Production build and all 142 HTML-page checks pass. Confirmed the running
  preview serves the new introduction with HTTP 200. Visual browser review
  is still unavailable in this session. Preview: `http://localhost:1313/`.
- Changes remain uncommitted. Proposed commit after review:
  `style: simplify the homepage introduction`.

### Consistent minimal homepage — 2026-10-29

- Extended the minimal styling through the full homepage after the user flagged
  the mismatch between the introduction and the remaining display sections.
  The main content now uses one sans-serif family: 28px greeting, 18px section
  headings, 16px prose and links, and 14px counts/dates. All sections share a
  single column, ordinary links, and consistent vertical spacing.
- Merged the repeated profile into the introduction. Replaced the library and
  recent-note slogans and uppercase labels with Notes and Recent notes. The
  homepage lists subjects and recent lessons as plain links; the course library
  retains its existing course presentation.
- Aligned the homepage header, content, and footer to the same bounded width.
  Removed retired profile and recent-list styles, including the serif and
  monospace homepage overrides in `lesson.css`.
- Production build and all 142 HTML-page checks pass. Local preview:
  `http://localhost:1313/`. Visual browser review remains unavailable in this
  session. Changes remain uncommitted. Proposed commit after review:
  `style: unify the minimal homepage typography and layout`.

### Homepage character and hover feedback — 2026-10-29

- User preference: restore the earlier visual character and the library's text
  hover highlights, keep the copy short, and remove the generic agency claim.
- The introduction is now the name plus one line: "I build security systems.
  Cryptography, identity, infrastructure." Serif headings and a wider column
  return, with simple Notes / Recent notes headings.
- Homepage subjects reuse the library's shared `subject-list.html` partial,
  including course-colored hover and keyboard-focus highlights. Recent-note
  links also highlight the full row in their course color. Removed the generic
  homepage hover-color override that would compete with the shared row colors.
- Production build and all 142 HTML-page checks pass. The local homepage serves
  HTTP 200; all five subject tones and recent-note tones are present in the
  generated links, and the retired profile copy is absent. Visual browser
  review remains unavailable. Preview: `http://localhost:1313/`.
- Changes remain uncommitted. Proposed commit after review:
  `style: restore homepage character and course hover highlights`.

### Native Mermaid diagrams throughout the courses — 2026-10-29

- User reported broken icon-diagram styling in "Gateway region: shared model
  pools, a dedicated cell, metering apart from content" and requested native
  Mermaid diagrams like the request-lifecycle example throughout the site.
  This is a requested renderer migration; the original visual CSS failure was
  not independently reproduced because browser access remains unavailable.
- Converted all 185 affected diagrams in 102 lesson files: 34 architecture
  diagrams became native flowcharts with nested subgraphs, and 439 icon nodes
  across 151 other diagrams became labeled rectangles, rounded nodes, or data
  stores. Kept course tints, captions, group boundaries, node membership, and
  connections. Corrected two prose references to the removed icons.
- Removed the Iconify loader and icon-pack registration from `diagrams.js`.
  Diagram rendering now needs only the locally vendored Mermaid script.
  Updated `docs/lesson-style.md` to require native shapes and subgraphs.
- Added a generated-page regression check to `scripts/check_site.py`. Before
  conversion, `python3 scripts/site.py check` rejected all 185 affected diagrams;
  after conversion the production build and all 142 HTML-page checks pass.
- All 808 generated diagrams parse with the production palette and strict
  sanitization. Verified labels and captions across all conversions, and all
  217 services, 75 boundaries, and 186 connections in the architecture diagrams.
  The 623 unaffected diagrams are unchanged after indentation normalization;
  lesson programs, dates, and remaining prose are unchanged.
- The gateway lesson preview returns HTTP 200 and serves the native deployment
  flowchart plus the original request-lifecycle state diagram. Visual browser
  review remains pending. Preview:
  `http://localhost:1313/notes/systems-design/worked-designs/04-a-multi-tenant-inference-gateway/`.
- Changes remain uncommitted. Proposed commit after review:
  `fix: replace icon diagrams with native Mermaid shapes`.

## Reading feature checklist

Palette follow-up: replaced the orange accent with slate blue, keeping cream,
ink, sage, lilac, and ochre as complements. Application security uses dusty rose.
The footer quote was later removed at the user’s request.
The build and local browser checks pass; the narrow library has no horizontal
overflow. Changes remain uncommitted. This follow-up is deliberately limited to
palette and footer work while account allowance is low.

This checklist prevents the complete reading experience from being reduced to
visual styling. A feature is complete only after its behavior is verified.

| Feature | Local state |
| --- | --- |
| Responsive own-brand homepage and library | Present; desktop/narrow layouts inspected |
| Five subject entry points | Present with explicit preparation/outline status |
| Course and module structure | Five modules, 22 lessons, computed numbering |
| Collapsible module/lesson tree | Present (`<details>`, works without JS); browser check pending |
| Breadcrumbs and current subject | Present |
| Desktop and mobile page contents | Present; mobile selection/focus checked |
| Reading-progress bar | Present; 0% and 100% endpoints observed |
| Active-section indication | Present |
| Heading permalinks | Present (`#` on hover/focus) |
| Previous/next lesson navigation | Present, across module boundaries |
| Prerequisites, difficulty, reading time | Present; prerequisites fail the build if missing; reading time computed |
| Code highlighting and copy feedback | Present; browser check pending |
| Mermaid diagrams with shared colors | Present, lazy-loaded; browser check pending |
| Diagram expansion, pan, zoom, reset | Present; browser check pending |
| Search and keyboard navigation | Present; unit/fake-DOM tested; browser check pending |
| Glossary and related lessons | Glossary present (≈75 terms); related lessons pending |
| Recall exercises and runnable examples | Present in every lesson; 19 programs verified |
| Feeds, metadata, and legacy redirects | Publication slice pending |

## Sources

- [Hugo configuration](https://gohugo.io/configuration/all/) and
  [GitHub Pages deployment](https://gohugo.io/host-and-deploy/deploy-to-github-pages/).
- [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages).
- [Cloudflare Pages monorepos](https://developers.cloudflare.com/pages/configuration/monorepos/),
  a possible later hosting option.
