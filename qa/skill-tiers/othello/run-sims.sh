#!/bin/bash
# Node match series: each tier bot (bots.js) against the game's own AI levels 1-4 (L5 is the expert, see the
# release review for L5 runs). Appends to sim-tiers.jsonl. Usage: bash run-sims.sh
cd "$(dirname "$0")"
for t in clumsy casual skilled; do for lv in 1 2 3; do node sim-tiers.js $t $lv 30 $lv; done; node sim-tiers.js $t 4 12 4; done
for lv in 1 2 3 4; do node sim-tiers.js world $lv 12 $((lv+10)); done
