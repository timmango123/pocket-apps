#!/bin/sh
# before-fix sweep, one browser at a time: node bot.js <tiers> <difficulties> <runs per cell> <cap seconds>
cd "$(dirname "$0")"
node bot.js clumsy,casual 0 1 420
node bot.js clumsy,skilled 1,2 1 420
node bot.js casual 1,2 2 420
node bot.js world,superhuman 1,2,3 1 420
