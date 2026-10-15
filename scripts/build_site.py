#!/usr/bin/env python3
"""Build the whole GitHub Pages site into one folder (default: _site/).

    python3 scripts/build_site.py [out]

1. builds both lobbies (apps/game-hub/dist, apps/tool-hub/dist) from apps/<name>/index.html
2. copies them to <out>/games and <out>/tools with the browser stand-in for window.claude (scripts/build_pages.py)
3. adds the landing page, home-screen icons and offline service worker (apps/pages/)
The same apps/*-hub/dist folders are what gets published to the claude.ai Artifact links.
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "_site").resolve()

for hub in ("game-hub", "tool-hub"):
    subprocess.run([sys.executable, str(ROOT / "apps" / hub / "build.py")], check=True)
OUT.mkdir(parents=True, exist_ok=True)
subprocess.run([sys.executable, str(ROOT / "scripts" / "build_pages.py"), str(ROOT / "apps"), str(OUT)], check=True)
print("site ->", OUT)
