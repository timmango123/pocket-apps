# 模擬玩家技能分級測試規格

Every game is played by five simulated players in real headless Chromium (Playwright at
/opt/node22/lib/node_modules/playwright), mobile context: viewport 390x844, deviceScaleFactor 2,
hasTouch true, isMobile true. Input goes through real touch / pointer events on the page
(page.touchscreen.tap, CDP Input.dispatchTouchEvent for drags/swipes, or page.mouse when the game only
listens to mouse). Bots may READ state through the game's test hooks (window.__game etc.) to model what a
human sees on screen, but must ACT only through input events. Never call a hook that changes game state
except to start/select a level or reset between runs.

## Tiers

| id | 名稱 | reaction (ms, mean±sd) | motor error (position σ / timing σ) | mistake rate | decisions |
|---|---|---|---|---|---|
| clumsy | 手殘 | 650±200 | 40px / 120ms | 15% | half random legal moves, else 1-step greedy; gives up a level after 5 failures |
| casual | 普通 | 400±100 | 20px / 60ms | 6% | 1-step greedy, 15% random |
| skilled | 熟練 | 260±50 | 10px / 30ms | 2% | heuristic or 2-step lookahead |
| world | 世界級 | 180±25 | 4px / 12ms | 0.3% | near-optimal search, still sees only delayed screen state |
| superhuman | 非人 | 16 (one frame) | 0 / 0 | 0% | perfect information, full solver / exact prediction, frame-perfect |

Position σ for clumsy is 40px. "Mistake" = a wrong move, mis-swipe direction, tap on the wrong target, or
an early/late tap well outside the window, depending on the game. Puzzle bots also spend human-like
thinking time per move (clumsy slow, superhuman zero). Seed randomness so runs are reproducible.

## What to run

- Level-based games: test levels 1, 10, 25, 50, 75, 99, 100 (or the game's spread if it has fewer), each
  with up to 3 attempts per tier (clumsy up to 5), plus a time cap per attempt. Record cleared?, attempts,
  time, stars/score if any.
- Endless / score games: 5 runs per tier (fewer if a run is long), record score distribution and
  how/when each run ended.
- Sandbox / no-fail games (calm, world): define the tier as how efficiently they reach the game's goals
  (e.g. % cleaned per minute, words recognised, orders shipped) and look hardest for bugs.
- Cap total wall time per game at roughly 30-40 minutes; use one browser at a time (the machine has 4 cores
  shared with other workers). Prefer the game's own level-select / seed hooks over replaying from level 1.

## What to report (results.json + a short notes.md in qa/skill-tiers/<game>/)

results.json: { game, tiers: { <tierId>: { runs:[...], summary:{...} } }, findings:[{severity, title, detail, repro}] }

Findings to look for:
- crashes, page errors, console errors, softlocks, input that is dropped or double-counted on touch
- content no tier can clear even superhuman (impossible level) or where superhuman barely clears
- difficulty curve problems: clumsy clears nearly everything (too easy), skill barely changes outcome,
  a sudden wall between consecutive levels
- exploits only the superhuman (or a degenerate strategy) can use that break scoring
Severity: high (broken / impossible / crash), medium (unfair or clearly off curve), low (polish).
