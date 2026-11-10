# othello skill tiers (node match series)

Bots: `bots.js` (from the 2026-11 release review; clumsy..world use their own negamax/eval, superhuman the game's engine).
Run: `bash run-sims.sh` (results append to `sim-tiers.jsonl`); `LV='{"depth":2,"err":0.3}' NOSAVE=1 node sim-tiers.js skilled 3 40 7` tries other level parameters.

Release-review finding: L2→L3 was a wall (skilled 90% → 5%), L3→L4 too (world 80% → 0%).
Retuned: L3 中級 depth 2 / exact 6 / err 0.35 (was 4 / 8 / 0.06); L4 高級 depth 5 / exact 10 / err 0.08 (was 6 / 12 / 0.02).

| tier | L1 | L2 | L3 | L4 |
|---|---|---|---|---|
| clumsy | 53% | 27% | 0% | 0% |
| casual | 87% | 27% | 0% | 0% |
| skilled | 100% | 93% | 50% | 8% |
| world | 100% | 100% | 100% | 50% |

Casual bot vs L3 stays under 10% for every L3 tried that keeps skilled at or below 50% (e.g. depth 4 + naive weights:
casual 10%, skilled 70%; depth 3 + naive weights: casual 23%, skilled 93%). The casual bot is barely stronger than L2.
