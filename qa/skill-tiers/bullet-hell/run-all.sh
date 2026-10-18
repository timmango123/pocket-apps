#!/bin/sh
# full before-fix sweep, one browser at a time (~30 min)
cd "$(dirname "$0")"
node bot.js clumsy,casual 0 1 540 && node bot.js clumsy,casual,skilled 1,2 2 540 && node bot.js world,superhuman 1,2,3 1 540
