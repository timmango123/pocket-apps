Audit tooling for the s2t phrase table (run from this folder; not loaded by the app).
- extract-jieba.py: reads jieba 0.42.1's dict.txt (MIT licence, ~349k simplified words with frequencies) and writes
  simp.txt ("word<TAB>freq", Han-only words of 1-6 characters; the single characters are only used for STRONG). python3 -I extract-jieba.py path/to/jieba/dict.txt
  simp.txt (~4 MB) is not committed; regenerate it before running gen.js or cross.js.
- manual_add.txt / manual_del.txt / manual_white.txt: hand-checked phrase additions, deletions, and weak-list exceptions
- manual_nostrong.txt: phrases never marked STRONG (a boundary word before them is usually the right reading)
- gen.js: rewrites the GEN block in ../../index.html (SPX, SPD, WEAK, CW, STRONG). Defaults MAXW=2 MINF=5 are the shipped build:
  every jieba word marks a phrase-table entry as a real word (entries that are not become WEAK); boundary words (CW)
  are 2-character jieba words with frequency >= 5 that overlap a phrase-table entry and would change its reading.
  STRONG phrases (头发, 面条, …) win a cost tie against a boundary word ending on their first character (白|头发, not
  白头|发): a 2-character phrase with a non-default reading and jieba frequency >= 50 is STRONG when, over every word XB
  that the engine reads as XB|C, jieba's unigram model (freq(X)*freq(BC) vs freq(XB)*freq(C)) prefers X|BC at least 75%
  of the time.
- cross.js: builds the rows of ../cross-boundary.tsv (two ordinary words side by side across every non-default
  2-char entry; corpus = ../samples.tsv and ../tests.js) into cross_ok.tsv and prints pairs that convert differently.
eng.js (a 3-line loader of the CORE block) must sit next to the scripts.
