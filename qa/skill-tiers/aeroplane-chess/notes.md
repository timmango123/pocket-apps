# 飛行棋 skill tiers (after the 2026-10-25 release-review fixes)

Scripts copied from the reviewer (`/mnt/project-files/qa/release/aeroplane-chess/`), pointed at `apps/aeroplane-chess/index.html`:

- `tier-sim.js [N]` engine bots per tier vs three opponent sets (easy 3×Lv1, default 3×Lv3, hard 3×Lv5, lv4 3×Lv4) → `tier-sim.json`.
  `superhuman` = dice oracle, `superhuman_fair` = Lv4 policy, `app_lv5` = the app's own Lv5.
- `review.js <phase…>` page review (touch via CDP). Set `OUT=<dir>` so screenshots and `review-results.json` land outside the repo.
  Adapted to the new menu (seats under 進階設定, tutorial on the first start, confirm before replacing a game).
- `decisions.js` how often the human has a real choice, with and without the 5-or-6 take-off rule.
- `undo-check.js`, `double-tap.js` undo availability and double-tap counting in the page.

Results (300 games per cell; superhuman/lv5 150):

| tier | vs 3×Lv1 | vs 3×Lv3 | vs 3×Lv4 | vs 3×Lv5 |
|---|---|---|---|---|
| clumsy | 33.7% | 6.3% | 3.7% | 2.0% |
| casual | 52.7% | 11.3% | 7.7% | 2.0% |
| skilled | 66.0% | 22.7% | 23.0% | 7.3% |
| world (Lv4) | 65.7% | 35.0% | 27.7% | 8.3% |
| app Lv5 | 79.3% | 58.0% | 42.7% | 26.0% |

Lv5 (王牌飛行員) now looks ahead with the real upcoming dice; this is stated in its description and the rules page.
Lv5 vs Lv4 heads-up: 62.3% (1,000 games, verify.js). No stalls, no errors.
Undo re-draws every die after the restored roll (the restored roll keeps its die), and games with undo are not recorded.
