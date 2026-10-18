Audit tooling for the s2t phrase table (run from this folder; not loaded by the app).
- extract-jieba.py: reads jieba 0.42.1's dict.txt (MIT licence, ~349k simplified words with frequencies) and writes
  simp.txt ("word<TAB>freq", Han-only words of 2-6 characters). python3 -I extract-jieba.py path/to/jieba/dict.txt
  simp.txt (~4 MB) is not committed; regenerate it before running gen.js or cross.js.
- manual_add.txt / manual_del.txt / manual_white.txt: hand-checked phrase additions, deletions, and weak-list exceptions
- gen.js: rewrites the GEN block in ../../index.html (SPX, SPD, WEAK, CW). Defaults MAXW=2 MINF=5 are the shipped build:
  every jieba word marks a phrase-table entry as a real word (entries that are not become WEAK); boundary words (CW)
  are 2-character jieba words with frequency >= 5 that overlap a phrase-table entry and would change its reading.
- cross.js: builds the rows of ../cross-boundary.tsv (two ordinary words side by side across every non-default
  2-char entry; corpus = ../samples.tsv and ../tests.js) into cross_ok.tsv and prints pairs that convert differently.
eng.js (a 3-line loader of the CORE block) must sit next to the scripts.
