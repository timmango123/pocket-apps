#!/usr/bin/env python3
"""Copy the two lobby builds (apps/game-hub/dist, apps/tool-hub/dist) into a static site for GitHub Pages.

Each lobby (and the landing page) becomes an installable web app: a manifest, home-screen icons (apps/pages/icons)
and the site-wide service worker (apps/pages/sw.js) that keeps opened games and tools working offline.

Adds a tiny window.claude stand-in so tools that save files via the Artifact 'downloads'
capability download normally; every other capability resolves to null, so features that
need claude.ai (online rooms) simply stay hidden, as they already do outside an Artifact.
"""
import json, pathlib, re, shutil, sys

APPS = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])

SHIM = ('<script>(function(){if(window.claude)return;var dl={save:function(o){var b=o.data instanceof Blob?o.data:'
        'new Blob([o.data],{type:"application/octet-stream"}),u=URL.createObjectURL(b),a=document.createElement("a");'
        'a.href=u;a.download=o.filename||"download";document.body.appendChild(a);a.click();a.remove();'
        'setTimeout(function(){URL.revokeObjectURL(u)},60000);return Promise.resolve()}};'
        'window.claude={use:function(n){return Promise.resolve(n==="downloads"?dl:null)}}})()</script>')

HEAD = '<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'

def inject(html):
    # The lobby pages are Artifact fragments (claude.ai adds the document skeleton), so give them one here.
    if not re.match(r'\s*<!doctype', html, re.I):
        return HEAD + SHIM + '\n' + html
    # After any existing <head> content's first script (the hub bridge) so a bridged parent claude wins.
    m = re.search(r'<head[^>]*>', html, re.I)
    if not m:
        return SHIM + html
    i = m.end()
    if html.startswith('<script>try{if(!window.claude', i):
        i = html.index('</script>', i) + len('</script>')
    return html[:i] + SHIM + html[i:]

# name, short name (under the home-screen icon), colours (lobby background in dark mode), icon
APPS_META = {
    "": ("口袋應用", "口袋應用", "#16140f", "home"),
    "games": ("口袋遊樂場", "遊樂場", "#13151d", "games"),
    "tools": ("口袋工具箱", "工具箱", "#121816", "tools"),
}


def pwa_tags(sub):
    name, short, colour, icon = APPS_META[sub]
    up = "../" if sub else ""
    return (f'<link rel="manifest" href="manifest.webmanifest">\n'
            f'<meta name="theme-color" content="{colour}">\n'
            f'<link rel="icon" type="image/png" sizes="192x192" href="{up}icons/{icon}-192.png">\n'
            f'<link rel="apple-touch-icon" href="{up}icons/{icon}-180.png">\n'
            f'<meta name="apple-mobile-web-app-capable" content="yes">\n'
            f'<meta name="apple-mobile-web-app-title" content="{short}">\n'
            f'<script>if("serviceWorker"in navigator)addEventListener("load",function(){{navigator.serviceWorker.register("{up}sw.js").catch(function(){{}})}})</script>\n')


def manifest(sub):
    name, short, colour, icon = APPS_META[sub]
    up = "../" if sub else ""
    icons = [{"src": f"{up}icons/{icon}-{n}.png", "sizes": f"{n}x{n}", "type": "image/png", "purpose": "any maskable"} for n in (192, 512)]
    return json.dumps({"name": name, "short_name": short, "lang": "zh-Hant", "start_url": "./", "scope": "./", "display": "standalone",
                       "background_color": colour, "theme_color": colour, "icons": icons}, ensure_ascii=False, indent=1)


def add_pwa(page, sub):
    html = page.read_text(encoding="utf-8")
    m = re.search(r'<meta name="viewport"[^>]*>\n?', html)
    i = m.end() if m else html.index(">", html.lower().index("<head")) + 1
    page.write_text(html[:i] + pwa_tags(sub) + html[i:], encoding="utf-8")
    (page.parent / "manifest.webmanifest").write_text(manifest(sub), encoding="utf-8")


for sub, src in (("games", "game-hub"), ("tools", "tool-hub")):
    d = OUT / sub
    if d.exists():
        shutil.rmtree(d)
    shutil.copytree(APPS / src / "dist", d)
    n = 0
    for f in d.rglob("*.html"):
        f.write_text(inject(f.read_text(encoding="utf-8")), encoding="utf-8")
        n += 1
    add_pwa(d / "index.html", sub)
    print(sub, n, "html files")
(OUT / ".nojekyll").touch()
shutil.copyfile(APPS / "pages" / "index.html", OUT / "index.html")
add_pwa(OUT / "index.html", "")
shutil.copyfile(APPS / "pages" / "sw.js", OUT / "sw.js")
if (OUT / "icons").exists():
    shutil.rmtree(OUT / "icons")
shutil.copytree(APPS / "pages" / "icons", OUT / "icons")
