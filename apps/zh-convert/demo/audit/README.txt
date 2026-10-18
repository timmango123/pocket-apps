Audit tooling for the s2t phrase table (run from this folder; not loaded by the app).
- extract-jieba.py: reads jieba 0.42.1's dict.txt (MIT licence, ~349k simplified words with frequencies) and writes
  simp.txt ("word<TAB>freq", Han-only words of 1-6 characters). python3 -I extract-jieba.py path/to/jieba/dict.txt
  simp.txt (~4 MB) is not committed; regenerate it before running gen.js or cross.js.
- manual_add.txt / manual_del.txt / manual_white.txt: hand-checked phrase additions, deletions, and weak-list exceptions
- manual_notcommon.txt: phrase-table entries never counted as common words in tie-breaks (二胡|同比, not 二|胡同|比)
- gen.js: rewrites the GEN block in ../../index.html (SPX, SPD, WEAK, CW, SPV, SPH). Defaults MAXW=2 MINF=5 are the shipped build:
  every jieba word marks a phrase-table entry as a real word (entries that are not become WEAK); boundary words (CW)
  are 2-character jieba words with frequency >= 5 that overlap a phrase-table entry and would change its reading.
  CW is stored grouped by first character with three frequency classes (jieba freq >= 5000, >= 500, the rest), and
  SPV / SPH list phrase-table entries with jieba freq >= 5000 / >= 200. The engine uses these only to break exact cost
  ties: the split with the lower total rarity wins (这|方面|条件 over 这方|面条|件, 白|头发 over 白头|发, 干|系统 over 干系|统).
- cross.js: builds the rows of ../cross-boundary.tsv (two ordinary words side by side across every non-default
  2-char entry; corpus = ../samples.tsv and ../tests.js, plus a family pool of the most frequent common words around
  every entry with jieba freq >= 200, e.g. 方面+条件, 回头+发给) into cross_ok.tsv and prints pairs that convert
  differently; after checking those by hand, the header line of cross-boundary.tsv plus cross_ok.tsv is the new file.
eng.js (a 3-line loader of the CORE block) must sit next to the scripts.

cross-tw.js: after editing TW_CTX in index.html, regenerate simp.txt (extract-jieba.py) and run `node cross-tw.js` to rebuild TW_CROSS
(jieba words that cut a phrase's changed part and reach outside it, e.g. 推导|出 for 导出PDF); delete simp.txt afterwards.
