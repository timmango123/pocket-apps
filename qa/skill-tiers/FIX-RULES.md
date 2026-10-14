# Fix round rules (for workers)

- The user asked to fix the issues the skill-tier playtest found. Findings with repro, code locations and suggested
  fixes are in /mnt/project-files/qa/skill-tiers/<id>/results.json and notes.md. The report is
  https://claude.ai/artifact/6qEBS6fzk2C9VGSSrtZ87v.
- Edit only /mnt/project-files/apps/<id>/index.html for your own games (and the generator scripts in that game's demo/
  folder if levels are generated offline and baked in). NEVER touch push-zombie or shot-zombie, game-hub, or any other
  game. Do not publish anything and do not rebuild the hub; the thread owner does that.
- Shared-folder rules: re-read a file just before changing it, keep edits targeted (no reformatting), read it back about
  ten seconds after writing and re-apply if another write replaced it. Back up the original to
  /mnt/project-files/qa/skill-tiers/<id>/orig.html first and delete that backup when you are done and verified.
- Keep each game's look, feel and level count. Fix bugs exactly; for difficulty problems, smooth the curve rather than
  flatten it: clumsy should still fail late levels, world-class should clear nearly everything, superhuman everything,
  and there should be no sudden wall between neighbouring tested levels. Levels must stay deterministic (same seed,
  same level) unless the game already regenerates them.
- The files have no doctype/viewport by design (the publish step and the hub add them). Ignore those findings.
- Mobile touch is the main platform. Any new UI must work at 390x844 with touch and in landscape.
- Verify every fix: rerun the relevant tiers with the existing bot in qa/skill-tiers/<id>/ (adjust the bot only if the
  game's interface changed) and check there are no page/console errors. Run one browser at a time. Kill only your own
  processes by exact PID, never pkill by pattern.
- Write qa/skill-tiers/<id>/fixes.md (Traditional Chinese, short): each finding → what you changed (file:line) → the
  before/after numbers from the re-run. Update results.json only by adding an "afterFix" block.
- Do not call any mcp__hearthbot__ tools.
