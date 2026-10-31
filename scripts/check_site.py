"""Check generated HTML without network access or third-party Python packages."""

import json
import re
from collections import Counter
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit


# Attributes whose value names one or more element IDs on the same page.
ID_REFERENCES = ("aria-labelledby", "aria-describedby", "aria-controls", "for")
# Go's fmt marks a bad verb or argument as %!verb(...) or %!(EXTRA ...); it leaks out of templates silently.
TEMPLATE_LEAK = re.compile(r"%!\w?\(")


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.ids = set()
        self.id_counts = Counter()
        self.references = []
        self.canonical = []
        self.diagrams = []
        self.diagram_source = None
        self.feed(text)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if "id" in attrs:
            self.ids.add(attrs["id"])
            self.id_counts[attrs["id"]] += 1
        for name in ID_REFERENCES:
            if name == "for" and tag != "label":
                continue
            for target in (attrs.get(name) or "").split():
                self.references.append((tag, name, target))
        for name in ("href", "src"):
            if attrs.get(name):
                self.links.append(attrs[name])
        if tag == "link" and "canonical" in attrs.get("rel", "").split():
            self.canonical.append(attrs.get("href"))
        if tag == "pre" and "mermaid" in attrs.get("class", "").split():
            self.diagram_source = ""

    def handle_data(self, data):
        if self.diagram_source is not None:
            self.diagram_source += data

    def handle_endtag(self, tag):
        if tag == "pre" and self.diagram_source is not None:
            self.diagrams.append(self.diagram_source)
            self.diagram_source = None


def check_site(destination, base_url, draft_routes):
    destination = destination.resolve()
    if not (destination / "index.html").is_file():
        raise ValueError("No generated homepage. Run `python3 scripts/site.py build` first.")
    pages = {path: Page(path.read_text()) for path in destination.rglob("*.html")}
    errors = []
    origin = urlsplit(base_url)
    for path, page in pages.items():
        relative = path.relative_to(destination).as_posix()
        route = relative.removesuffix("index.html") if relative.endswith("/index.html") else relative
        if relative == "index.html":
            route = ""
        if relative != "404.html" and page.canonical != [base_url + route]:
            errors.append(f"{relative}: incorrect or missing canonical URL")
        for name, count in sorted(page.id_counts.items()):
            if count > 1:
                errors.append(f"{relative}: duplicate id {name!r} ({count} elements)")
        for tag, name, target in page.references:
            if target not in page.ids:
                errors.append(f"{relative}: <{tag} {name}> names a missing id: {target!r}")
        for number, source in enumerate(page.diagrams, 1):
            if re.search(r"(?m)^\s*architecture-beta\b|@\{[^}]*\bicon\s*:", source):
                errors.append(f"{relative}: diagram {number} uses icons or architecture-beta; use native Mermaid shapes")
        for value in page.links:
            url = urlsplit(value)
            if url.scheme and url.scheme not in ("http", "https"):
                continue
            if url.netloc and url.netloc != origin.netloc:
                continue
            target = destination / unquote(url.path).lstrip("/") if url.path.startswith("/") else path.parent / unquote(url.path)
            if not url.path:
                target = path
            target = target.resolve()
            if not target.is_relative_to(destination):
                errors.append(f"{relative}: link escapes the output directory: {value}")
                continue
            if target.is_dir():
                target /= "index.html"
            if not target.is_file():
                errors.append(f"{relative}: missing local target: {value}")
            elif url.fragment and target in pages and unquote(url.fragment) not in pages[target].ids:
                errors.append(f"{relative}: missing fragment: {value}")
    for path in sorted(destination.rglob("*")):
        if path.is_file() and path.suffix.lower() in (".html", ".json"):
            text = path.read_text()
            for match in TEMPLATE_LEAK.finditer(text):
                errors.append(f"{path.relative_to(destination)}: template formatting error leaked into output: "
                              f"{text[match.start():match.start() + 40]!r}")
    index = destination / "index.json"
    if index.is_file():
        try:
            entries = json.loads(index.read_text()).get("pages", [])
        except (ValueError, AttributeError) as error:
            errors.append(f"index.json: not a search index: {error}")
            entries = []
        for entry in entries:
            url = urlsplit(entry.get("u", ""))
            target = (destination / unquote(url.path).lstrip("/")).resolve()
            if target.is_dir():
                target /= "index.html"
            if not url.path.startswith("/") or not target.is_relative_to(destination) or target not in pages:
                errors.append(f"index.json: page URL does not resolve to a generated page: {entry.get('u')!r}")
                continue
            for heading in entry.get("h", []):
                if heading.get("a") not in pages[target].ids:
                    errors.append(f"index.json: {entry['u']} heading anchor is not on the page: {heading.get('a')!r}")
    for path in destination.rglob("*"):
        if path.is_file() and path.suffix.lower() in (".md", ".py", ".toml", ".pkg", ".gz"):
            errors.append(f"Source or tool file included in output: {path.relative_to(destination)}")
    # Use Hugo's resolved routes, including custom slugs and inherited drafts.
    # This also catches stale draft output in check-only runs.
    for route in draft_routes:
        target = destination / unquote(route).lstrip("/")
        if target.suffix == "":
            target /= "index.html"
        if target.exists():
            errors.append(f"Draft page was published: {route}")
    if errors:
        raise ValueError("Site checks failed:\n" + "\n".join(errors))
    print(f"PASS: {len(pages)} HTML pages; local links, fragments, assets, canonicals, unique ids, ARIA and label references, template leaks, search index URLs and anchors, source exclusion, draft routes, and native diagram shapes.")
