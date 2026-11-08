# klondike-solitaire skill tiers (2026-11-08, release-review round 3 fix)

`node tier-sim.js` (rule-core simulation adapted from the reviewer's qa/release/klondike-solitaire/tier-sim.js) → results.json.

| tier | cleared | 1–40 | 41–60 | 61–70 | 61–85 | 86–100 |
|---|---|---|---|---|---|---|
| clumsy | 49/100 (first try 20) | 32 | 12 | 5 | 5 | 0 |
| casual | 48/100 (first try 41) | 30 | 12 | 4 | 5 | 1 |
| skilled | 72/100 (first try 71) | 40 | 19 | 10 | 10 | 3 |
| world | 100/100 (first try 100) | 40 | 20 | 10 | 25 | 15 |
| superhuman | 100/100 (first try 100) | 40 | 20 | 10 | 25 | 15 |

Round 1: deals the world bot could not clear (solver N > 20000) were replaced; every level is within 20k nodes.
Round 2: levels 1–60 mix in deals that greedy play loses but planning (skilled: lookahead + undo) wins; 41–60 ≤ 2.3k nodes.
Round 3: six draw-3 deals in 61–70 that the skilled bot lost were replaced by gentler draw-3 deals (skilled 3/3,
casual 2/3, clumsy 0/5 in the pool run), softening the 60→61 step; 3-star target time ×1.8 (61–85) and ×2 (86–100).
