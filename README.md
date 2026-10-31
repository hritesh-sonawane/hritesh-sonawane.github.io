# hs://

Personal website and security notes for Hritesh Sonawane.

The editable Hugo site lives in `site/`. GitHub Actions builds and publishes it
when changes reach `main`. The existing HTML at the repository root is legacy
output and is not included in the updated deployment.

## Work on the rebuild

Requires Python 3.9 or newer and macOS or Linux. Install the pinned Hugo binary
into this checkout without changing your system installation:

```bash
python3 scripts/site.py setup
```

The setup verifies the official release archive against a pinned SHA-256 checksum.
Build and check the generated website:

```bash
python3 scripts/site.py build
```

Output goes to ignored `build/public/`. Preview with live reload:

```bash
python3 scripts/site.py preview
```

Open `http://localhost:1313/`. Use `--port 1314` if that port is busy. The preview
includes drafts and stays on this computer's loopback interface. Stop with Ctrl-C.
The production build excludes drafts. Both commands work from any directory.
Restart the preview after adding a new top-level source directory so Hugo begins
watching its files.

Run checks on an existing production build with `python3 scripts/site.py check`.
Checks cover local links and fragments, assets, canonical URLs, source-file
exclusion, publication of draft pages, and unsupported diagram icon syntax.

The setup supports Apple Silicon and Intel Macs, and Linux arm64/amd64. The Hugo
version and release checksums live in `scripts/hugo-toolchain.json`. Normal
builds and previews use the installed tool without network access.

## GitHub Pages

The workflow in `.github/workflows/deploy-website.yml` runs on pushes and pull
requests targeting `main`, and can also be run manually. It sets up Python 3.13,
installs the checksum-pinned Hugo version from `scripts/hugo-toolchain.json`,
then runs the same production build and checks used locally.

Only `build/public/` is uploaded. Source files, development documentation, local
tools, previews, and the legacy root HTML stay out of the Pages artifact. A build
or check failure prevents deployment. Pull requests and manual runs on other
branches only build; successful pushes or manual runs on `main` deploy through
the `github-pages` environment. Concurrent production deployments are serialized.

In repository Settings → Pages, the publishing source must be **GitHub Actions**.
The deployment job reports the published site URL in the Actions run. Generated
output remains ignored; commit the source and workflow rather than `build/`.

## Preview the legacy files

Serve the repository root separately:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Local Hugo builds and previews do not modify these
legacy files. The GitHub Pages workflow publishes the generated Hugo site.
