# Lesson style guide

How lessons in `site/content/notes/` are written and structured. Read this before
adding or editing a lesson. The reference lesson is
`site/content/notes/ai-security-engineering/threat-landscape/01-why-ai-security-is-different.md`.
The starter file is `site/archetypes/lesson.md`
(`.tools/hugo-0.169.0/hugo new --source site --kind lesson notes/<subject>/<module>/NN-slug.md`).

## Structure

```text
notes/<subject>/_index.md                 course page (course = true)
notes/<subject>/<module-slug>/_index.md   module overview (weight = module number)
notes/<subject>/<module-slug>/NN-slug.md  lesson (weight = NN)
notes/<subject>/glossary.md               optional course glossary
```

Lesson numbers (`2.c`), module lists, reading time, the course tree, and
previous/next links are computed. Never hard-code them in content.

Module front matter: `title`, `description` (one or two sentences), `weight`.
The body is a short intro: what the module covers and what the reader can do
afterwards. Do not add a lesson table; the template generates it from each
lesson's `question`.

Lesson front matter: `title`, `description`, `question`, `weight`, `difficulty`
(1–5), `prerequisites` (site paths without trailing slash, e.g.
`/notes/ai-security-engineering/threat-landscape/01-why-ai-security-is-different`;
a missing path fails the build), `date`, `lastmod`, and `verified` only after the
lesson's Python code has actually been run and its shown output matches.

The current 104-lesson library uses display dates at a two-day cadence, starting
1 April 2026, in subject weight → module weight → lesson weight order. The last
lesson is dated 24 October 2026. These are the user-requested editorial dates;
the actual example runs are recorded in the content handoffs. Keep publication
dates increasing in reading order, including module boundaries. The build
rejects missing or out-of-order dates and updates that precede publication.
The header shows Published, with Updated only when it is later.

## Lesson sections, in order

1. `## The idea in one minute`
2. `## A picture` — a Mermaid diagram (` ```mermaid {title="…"} `).
3. `## How it really works` — `###` subsections.
4. `## Code` — optional. Python 3.10+, standard library only, offline,
   simulated targets; idiomatic (type hints, dataclasses where natural,
   `if __name__ == "__main__":`). Use ` ```python {title="file.py"} `, then the
   run command (`python3 file.py`) and a ` ```text ` block
   with the real output.
5. `## Where it breaks` — the limits of the control, the failure case, and what
   the example does not prove.
6. `## Remember this` — four to six one-line bullets.
7. `## Try it` — numbered hands-on tasks.
8. `## Check yourself` — numbered questions, each followed by an indented
   `{{< details summary="Show answer" >}} … {{< /details >}}` answer.
9. `## Sources` — primary sources first, with titles and dates.

## Voice and conventions

- US English spelling (authorize, behavior, defense, organize, summarize, program).
- Sentence-case titles and headings ("Threat modeling an AI system").
- Plain, precise, confident. Short paragraphs. Bold only the key phrase.
- Prefer real Markdown tables over ASCII grids.
- Callouts: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]` (shown as "Key idea"),
  `> [!WARNING]`, `> [!CAUTION]`. Optional custom title after the marker. Use
  sparingly, at most two or three per lesson.
- Internal links use full site paths: `/notes/ai-security-engineering/<module>/<lesson>/`.
  Link only to pages that exist. Mention topics in other subjects in prose
  without a link until those pages exist.
- No branding or names of other learning sites. Cite primary sources (papers,
  specifications, standards, vendor documentation), not other course sites.
- Do not invent statistics, incidents, versions, or dates. If a claim cannot be
  supported by a source you can name, soften it or remove it. Write "as of
  <month year>" for anything time-sensitive.

## Diagrams

- Prefer Mermaid `flowchart`, `sequenceDiagram`, or `stateDiagram-v2` for mechanisms.
  Other native types (block, ER, charts) are useful when they fit the concept.
  Keep labels short; `<b>` and `<br/><small>…</small>` are allowed in flowchart
  node labels. Give every diagram a descriptive `title` attribute.
- Use labeled native Mermaid shapes. Draw deployments with flowcharts and
  nested `subgraph` boundaries. Do not use `architecture-beta`, icon nodes, or
  icon packs. The production checks reject those patterns, and the renderer
  has no external icon dependency.
- Flowcharts, block diagrams, and state diagrams get shared node classes; assign them with
  `class A,B warn`: `neutral`, `compute`, `memory`, `queue`, `io`, `warn`
  (attacker-controlled or dangerous), `good` (the control that holds).
- The palette lives in `site/data/diagrams.json`, shared by the render hook and
  JavaScript renderer. Ordinary nodes follow the course tint; `neutral` is cream,
  `warn` is rose with a dashed outline, and `good` is sage with a solid outline.
  Use labels as well as color to explain the difference. Do not add local
  `classDef` colors or hard-coded node/edge colors. Sequence highlight colors
  use the same soft tints: rose `rgb(249, 226, 233)` for danger, sage
  `rgb(226, 239, 216)` for a control, and neutral `rgb(243, 241, 234)` for context.
- Flowchart connectors are straight, typography is 15px system sans-serif, and
  every diagram stays on a light canvas in both site themes. The inline and
  expanded views share one configuration. Charts with multiple categories use
  the course color first, followed by the other subject colors.

## Verification before handing over

- Build to a private directory and check for errors and warnings:
  `.tools/hugo-0.169.0/hugo --source site --destination /tmp/<name>-build --cacheDir "$PWD/.tools/cache" --noBuildLock --panicOnWarning`
- Run every Python program with `python3 -I` in a scratch directory outside the repository and paste
  its real output.
- Check every external link you add resolves to the cited work (title and
  author match). The local network sandbox blocks many domains; when a link
  cannot be fetched, keep it only if it is a canonical address you are
  confident of (arXiv abstract, standard body, official docs) and list it as
  unverified in the hand-over.
