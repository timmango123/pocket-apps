# pocket-apps

Static mobile-first web apps (Traditional Chinese UI). Source of truth for the site at https://timmango123.github.io/pocket-apps/.

- Each app is one self-contained file: `apps/<id>/index.html` (no build step per app, no external runtime deps). Keep that.
- Lobbies: `apps/game-hub/build.py` and `apps/tool-hub/build.py` list every app (id, name, category, blurb) and need a 300×400 cover in `covers/<id>.jpg`. Adding an app means adding it there.
- Site build: `python3 scripts/build_site.py` → `_site/` (lobbies + `scripts/build_pages.py` shim + landing page, manifests, `apps/pages/sw.js`, `apps/pages/icons/` from `scripts/make_icons.js`).
- Tests: `node qa/smoke/run.js [ids...] [--hubs]` (page errors, horizontal overflow at 390×844, every `apps/*/demo/tests.js`); `node qa/layout/run.js [ids...] [--shots]` (controls cut off, overlapping or covered at three in-lobby phone sizes; intended exceptions go in `qa/layout/allow.json` with a reason); `node qa/netplay/run.js` for the four online games. `node qa/pages/run.js _site` for the built site (#<id> links, share button, manifest/icons, offline service worker). CI runs both on every PR and on main, and deploys main to Pages.
- Online play uses `apps/shared/netplay.js`; after editing it run `python3 apps/shared/inline-netplay.py`.
- Demo videos and screenshots (`apps/*/demo/*.mp4|png`) are not committed.
- Work on a branch and open a PR; don't push to main directly.
