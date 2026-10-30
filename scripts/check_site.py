"""Check generated HTML without network access or third-party Python packages."""

import re
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.ids = set()
        self.canonical = []
        self.diagrams = []
        self.diagram_source = None
        self.feed(text)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if "id" in attrs:
            self.ids.add(attrs["id"])
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
    print(f"PASS: {len(pages)} HTML pages; local links, fragments, assets, canonicals, source exclusion, draft routes, and native diagram shapes.")
