# 象棋暗棋 skill tiers (2026-10-25 release-review fix round)

Scripts copied from the reviewer (`/mnt/project-files/qa/release/banqi/`):

- `sim-tiers.js [--par 3] [--plan tier:LvxN,...] [--out file]` five tiers vs the page AI in node, with the game's own core and the
  exact `BQ.LEVELS` options the page passes. `core.js` reads `apps/banqi/index.html` (or `BANQI_APP=<copy>` to pin a snapshot).
- `sim-tiers.json` the games behind the table below (Lv1–4 and Lv5 measured with the final LEVELS; 4 cores at loadavg 17–26).

LEVELS: Lv1 depth 1 + 45% random + blind to cannons; Lv2 depth 1 + 27% random; Lv3 depth 2 + 24% random; Lv4 depth 3 + 10% random;
Lv5 iterative deepening to 3 s, plays its second-best move 10% of the time (before: Lv5 never; reviewer's skilled tier 0/3, here 0/11/1).

| tier | Lv1 | Lv2 (default) | Lv3 | Lv4 | Lv5 |
|---|---|---|---|---|---|
| clumsy | 20% (n30) | 0% (n30) | | | |
| casual | 73% (n40) | 48% (n40) | 35% (n40) | 10% (n20) | 0% (n4) |
| skilled | | | 88% (n16) | 60% (n20) | 30% (n10) |
| world | | | | 6/0 | 4/2 |
| superhuman | | | | | 3/1 |

Before (reviewer): casual 70% → 23% → 0/12 → 0/4; skilled Lv4 1/3 → Lv5 0/3; world Lv5 2/2.
Round 3 (after review round 2): 悔棋 can no longer take back a flip at all (a revealed piece stays revealed), so it can neither peek nor
re-roll; it is also disabled while the computer thinks. Lv5 softened to `ms: 2000, mistake: 0.16` (was 3000 / 0.10).
`sim-r3.json`: `node sim-tiers.js --par 4 --plan skilled:5x16,world:5x6,lv4:5x6,reroll:5x6,skilled:4x12 --seedBase 50021 --out sim-r3.json`
(4 cores at loadavg 23–31, the page snapshot with the round-3 LEVELS):

| bot vs | win / loss / draw |
|---|---|
| skilled vs Lv4 | 4 / 6 / 2 (33%, n12) |
| skilled vs Lv5 | 4 / 8 / 4 (25%, n16) |
| reroll vs Lv5 (undo after a flip now refused = plain skilled) | 1 / 4 / 1 |
| world vs Lv5 | 5 / 1 / 0 (83%) |
| Lv4 settings vs Lv5 | 2 / 4 / 0 |
