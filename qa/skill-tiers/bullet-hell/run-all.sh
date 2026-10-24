#!/bin/sh
# One browser at a time: node bot.js <tiers> <difficulties 0..3> <runs per cell> <cap seconds> [--tag=afterFix]
# BH_SRC=<file> plays a frozen copy of the game (used for the before sweep while the real file was being edited).
cd "$(dirname "$0")"
node bot.js clumsy 0,1 1 420 --tag=afterFix
node bot.js casual 0,1,2 2 420 --tag=afterFix
node bot.js skilled 1,2,3 1 420 --tag=afterFix
node bot.js world 2,3 1 420 --tag=afterFix
node bot.js superhuman 3 1 420 --tag=afterFix
node table.js afterFix
