#!/usr/bin/env python3
"""Install the pinned Hugo tool, build, check, or preview this checkout."""

import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from urllib.parse import urlsplit

from check_site import check_site


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "site"
TOOLCHAIN = json.loads((ROOT / "scripts/hugo-toolchain.json").read_text())
VERSION = TOOLCHAIN["version"]
TOOL_DIR = ROOT / ".tools" / f"hugo-{VERSION}"
HUGO = TOOL_DIR / "hugo"
BASE_URL = "https://hritesh-sonawane.github.io/"


def installed_tool():
    if not HUGO.is_file():
        raise ValueError("Run `python3 scripts/site.py setup` first.")
    result = subprocess.run([str(HUGO), "version"], check=True, capture_output=True, text=True)
    if not re.search(rf"\bhugo v{re.escape(VERSION)}(?:\s|[-+])", result.stdout):
        raise ValueError(f"Expected Hugo {VERSION}; found {result.stdout.strip()}")
    return str(HUGO)


def setup():
    if HUGO.is_file():
        installed_tool()
        print(f"Hugo {VERSION} is ready in {TOOL_DIR.relative_to(ROOT)}")
        return
    system = platform.system().lower()
    machine = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine(), platform.machine())
    if machine not in ("amd64", "arm64"):
        raise ValueError(f"Unsupported architecture: {machine}")
    key = "darwin" if system == "darwin" else f"{system}-{machine}"
    release = TOOLCHAIN["releases"].get(key)
    if release is None:
        raise ValueError(f"Unsupported platform: {key}; use macOS or Linux.")
    url = f"https://github.com/gohugoio/hugo/releases/download/v{VERSION}/{release['file']}"
    TOOL_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=TOOL_DIR) as tmp:
        staging = Path(tmp)
        archive = staging / release["file"]
        print(f"Downloading Hugo {VERSION} for {key}…", flush=True)
        with urllib.request.urlopen(url, timeout=60) as response, archive.open("wb") as output:
            shutil.copyfileobj(response, output)
        actual = hashlib.sha256(archive.read_bytes()).hexdigest()
        if actual != release["sha256"]:
            raise ValueError("Hugo download checksum does not match; nothing was installed.")
        binary = staging / "hugo"
        if system == "darwin":
            expanded = staging / "expanded"
            subprocess.run(["/usr/sbin/pkgutil", "--expand-full", str(archive), str(expanded)], check=True)
            candidates = [path for path in expanded.rglob("hugo") if path.is_file()]
            if len(candidates) != 1:
                raise ValueError("Expected one Hugo binary in the verified macOS package.")
            shutil.copyfile(candidates[0], binary)
        else:
            with tarfile.open(archive) as package:
                member = package.getmember("hugo")
                if not member.isfile():
                    raise ValueError("Expected a regular Hugo binary in the verified archive.")
                with package.extractfile(member) as source, binary.open("wb") as output:
                    shutil.copyfileobj(source, output)
        binary.chmod(0o755)
        os.replace(binary, HUGO)
    installed_tool()
    print(f"Hugo {VERSION} installed locally. No system installation was changed.")


def hugo_command():
    return [installed_tool(), "--source", str(SOURCE), "--cacheDir", str(ROOT / ".tools/cache")]


def draft_routes():
    result = subprocess.run([installed_tool(), "list", "all", "--source", str(SOURCE),
                             "--environment", "production"],
                            cwd=ROOT, check=True, capture_output=True, text=True)
    return [urlsplit(page["permalink"]).path for page in csv.DictReader(io.StringIO(result.stdout))
            if page["draft"] == "true"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("setup", "build", "check", "preview"))
    parser.add_argument("--port", type=int, default=1313, help="preview port (default: 1313)")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if args.command == "setup":
        setup()
    elif args.command == "check":
        check_site(ROOT / "build/public", BASE_URL, draft_routes())
    elif args.command == "build":
        command = hugo_command()
        destination = ROOT / "build/public"
        # Rebuild only this owned directory so stale/draft files cannot survive.
        if destination.is_symlink():
            raise ValueError("The build destination must not be a symlink.")
        if destination.exists():
            shutil.rmtree(destination)
        subprocess.run(command + ["--environment", "production", "--destination", str(destination),
                                  "--baseURL", BASE_URL, "--minify", "--panicOnWarning"],
                       cwd=ROOT, check=True)
        check_site(destination, BASE_URL, draft_routes())
    else:
        command = hugo_command()
        print(f"Local preview: http://localhost:{args.port}/ (Ctrl-C to stop)", flush=True)
        os.execv(command[0], command + ["server", "--bind", "127.0.0.1", "--port", str(args.port),
                                     "--baseURL", f"http://localhost:{args.port}/", "--buildDrafts",
                                     "--disableFastRender", "--destination", str(ROOT / "build/preview")])


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
