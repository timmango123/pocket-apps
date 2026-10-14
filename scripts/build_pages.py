#!/usr/bin/env python3
"""Copy the two lobby builds (apps/game-hub/dist, apps/tool-hub/dist) into a static site for GitHub Pages.

Adds a tiny window.claude stand-in so tools that save files via the Artifact 'downloads'
capability download normally; every other capability resolves to null, so features that
need claude.ai (online rooms) simply stay hidden, as they already do outside an Artifact.
"""
import pathlib, re, shutil, sys

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

for sub, src in (("games", "game-hub"), ("tools", "tool-hub")):
    d = OUT / sub
    if d.exists():
        shutil.rmtree(d)
    shutil.copytree(APPS / src / "dist", d)
    n = 0
    for f in d.rglob("*.html"):
        f.write_text(inject(f.read_text(encoding="utf-8")), encoding="utf-8")
        n += 1
    print(sub, n, "html files")
(OUT / ".nojekyll").touch()
