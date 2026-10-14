#!/usr/bin/env python3
"""Copy apps/shared/netplay.js into every app that carries the <!--NETPLAY-START-->...<!--NETPLAY-END--> marker.
Run after editing netplay.js, then rebuild the game hub."""
import pathlib, re, sys
APPS = pathlib.Path(__file__).resolve().parent.parent
src = (APPS / 'shared' / 'netplay.js').read_text()
block = '<!--NETPLAY-START--><script id="netplay">\n' + src + '</script><!--NETPLAY-END-->'
pat = re.compile(r'<!--NETPLAY-START-->.*?<!--NETPLAY-END-->', re.S)
for f in sorted(APPS.glob('*/index.html')):
    if len(sys.argv) > 1 and f.parent.name not in sys.argv[1:]: continue
    t = f.read_text()
    if '<!--NETPLAY-START-->' not in t: continue
    n = pat.sub(lambda m: block, t)
    if n != t: f.write_text(n); print('updated', f.parent.name)
    else: print('unchanged', f.parent.name)
