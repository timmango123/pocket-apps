# Reads jieba 0.42.1's dict.txt (MIT licence; lines "word freq pos") and writes simp.txt: one "word<TAB>freq" line per
# Han-only word of 2-6 characters. Used only offline by gen.js / cross.js to choose boundary words; the app ships a
# pruned subset (the CW list in index.html). Usage: python3 -I extract-jieba.py path/to/jieba/dict.txt
import sys, re, os
src = sys.argv[1] if len(sys.argv) > 1 else 'dict.txt'
han = re.compile(r'^[㐀-鿿]{2,6}$')
best = {}
with open(src, encoding='utf-8') as f:
    for line in f:
        p = line.split()
        if len(p) < 2 or not han.match(p[0]): continue
        try: n = int(p[1])
        except ValueError: continue
        best[p[0]] = max(n, best.get(p[0], 0))
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'simp.txt')
with open(out, 'w', encoding='utf-8') as f:
    f.write('\n'.join(w + '\t' + str(n) for w, n in sorted(best.items())) + '\n')
print(len(best), 'words ->', out)
