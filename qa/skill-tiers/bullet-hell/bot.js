// 彈幕射擊 skill-tier bot. Usage: node bot.js [tiers] [difficulties] [runsPerCell] [capSeconds] [--out=results.json] [--tag=afterFix]
//   tiers: comma list of clumsy,casual,skilled,world,superhuman (default: all)
//   difficulties: comma list of 0..3 (簡單/普通/困難/地獄); default: 普通+困難 for every tier, 簡單 for clumsy/casual, 地獄 for world/superhuman
// One run = one credit from the title screen until game over or the ending (no continues). Everything is real touch:
// finger 1 drags (relative movement), finger 2 is held for focus during boss fights (skilled and up), 炸彈 is tapped.
const fs = require('fs'), path = require('path');
const H = require('./harness');
const { TIERS, DIFFS, makeRng } = H;
const OUT = __dirname;

// ---------- planner (logical field units; 360 wide, FH tall) ----------
const DIRS16 = []; for (let i = 0; i < 16; i++) DIRS16.push([Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);
const DIRS8 = DIRS16.filter((_, i) => i % 2 === 0);
const HIT = 2.6;
function danger(o, px, py, t, T, ext) {
  let pen = 0; const tt = t + ext;
  for (const b of o.near) {
    let bx = b[0] + b[2] * tt, by = b[1] + b[3] * tt;
    if (T.exact && b[5] === 1) by += 0.5 * b[6] * tt * tt;           // superhuman knows the lantern bullets accelerate
    const rr = b[4] * 0.82 + HIT + T.margin, dx = bx - px, dy = by - py, d2 = dx * dx + dy * dy;
    if (d2 < rr * rr) pen += 1; else if (d2 < (rr + 12) * (rr + 12)) pen += 0.04;
  }
  return pen;
}
function attract(o, px, py) {
  let tx = 180, ty = o.FH - 72;
  if (o.boss && o.boss.name) tx = Math.max(30, Math.min(330, o.boss.x));
  else if (o.enemies.length) { let best = null, bd = 1e9; for (const e of o.enemies) { if (e[1] > py - 60) continue; const d = Math.abs(e[0] - px); if (d < bd) { bd = d; best = e; } } if (best) tx = best[0]; }
  let s = -Math.abs(px - tx) * 0.006 - Math.abs(py - ty) * 0.003;
  for (const it of o.items) { if (it[1] > o.FH - 20) continue; const d = Math.hypot(it[0] - px, it[1] - py); s += (it[2] === 0 && o.power < 3 ? 1.2 : it[2] === 2 ? 1.0 : 0.5) / (1 + d / 40); }
  return s;
}
function clampXY(o, x, y) { return [Math.max(8, Math.min(352, x)), Math.max(o.FH * 0.3, Math.min(o.FH - 12, y))]; }
function evalPath(o, legs, T, ext) {
  let x = o.pl.x, y = o.pl.y, t = 0, pen = 0, li = 0, lt = 0, first = 9; const dt = T.fine ? 1 / 60 : 1 / 30;
  while (t < T.H) {
    const L = legs[Math.min(li, legs.length - 1)];
    [x, y] = clampXY(o, x + L[0] * dt, y + L[1] * dt);
    t += dt; lt += dt; if (lt >= L[2] && li < legs.length - 1) { li++; lt = 0; }
    const d = danger(o, x, y, t, T, ext);
    if (d >= 1 && first > t) first = t;
    pen += d * (o.pl.invul > t ? 0.05 : 1) / (1 + t * 2);
  }
  return { score: -pen * 10 + attract(o, x, y), pen, first };
}
// returns {vx, vy (units/s), kind, pen, first}
function decide(T, o, rnd, age, vmax) {
  const ext = age * T.pred;
  o.near = o.bullets.filter(b => Math.abs(b[0] - o.pl.x) < 230 && Math.abs(b[1] - o.pl.y) < 280);
  const opts = [[0, 0]].concat((T.policy === 'search' || T.policy === 'perfect') ? DIRS16 : DIRS8);
  const v = vmax * 0.6;
  if (T.policy === 'clumsy' && rnd() < 0.5) { const d = opts[Math.floor(rnd() * opts.length)]; return { vx: d[0] * v, vy: d[1] * v, kind: 'random', pen: 0, first: 9 }; }
  if (T.policy === 'greedy' && rnd() < 0.15) { const d = opts[Math.floor(rnd() * opts.length)]; return { vx: d[0] * v, vy: d[1] * v, kind: 'random', pen: 0, first: 9 }; }
  let best = null, bs = -1e9;
  const speeds = (T.policy === 'perfect' || T.policy === 'search') ? [0.35, 1] : [1];
  const seg = Math.max(0.1, T.every / 60 * 2);
  for (const s1 of speeds) for (const d1 of opts) {
    if (T.policy === 'greedy' || T.policy === 'clumsy') {
      const r = evalPath(o, [[d1[0] * v * s1, d1[1] * v * s1, 9]], T, ext);
      if (r.score > bs) { bs = r.score; best = { vx: d1[0] * v * s1, vy: d1[1] * v * s1, kind: 'plan', pen: r.pen, first: r.first }; }
    } else for (const d2 of opts) {
      const r = evalPath(o, [[d1[0] * v * s1, d1[1] * v * s1, seg], [d2[0] * v, d2[1] * v, 9]], T, ext);
      if (r.score > bs) { bs = r.score; best = { vx: d1[0] * v * s1, vy: d1[1] * v * s1, kind: 'plan', pen: r.pen, first: r.first }; }
    }
  }
  // what the player sees closing in on the crane right now (in the delayed, extrapolated picture): bullets about to touch
  let close = 0, crowd = 0;
  for (const bl of o.near) {
    const bx = bl[0] + bl[2] * ext, by = bl[1] + bl[3] * ext, d2 = (bx - o.pl.x) ** 2 + (by - o.pl.y) ** 2, rr = bl[4] + HIT + 12;
    if (d2 < rr * rr) close++;
    if (d2 < 40 * 40) crowd++;       // "the crane is boxed in": what makes a human reach for the bomb
  }
  best.close = close; best.crowd = crowd;
  return best;
}

// ---------- one run ----------
async function runOnce(browser, URL, tierId, diff, seed, capSec, log) {
  const T = TIERS[tierId], rnd = makeRng(seed);
  const sess = await H.newSession(browser, URL, seed);
  const { page, cdp, errors } = sess;
  const hands = new H.Hands(cdp);
  // title: pick difficulty, start (the only state-changing actions, done through real taps)
  const db = await page.locator('.diff').nth(diff).boundingBox();
  await hands.tap(db.x + db.width / 2, db.y + db.height / 2); await page.evaluate(() => window.__step(2));
  const sb = await page.locator('#bStart').boundingBox();
  await hands.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);
  let o = await page.evaluate(() => window.__step(2, true));
  if (o.st !== 'stage') throw new Error('start failed: ' + o.st);
  const bb = await page.locator('#bBomb').boundingBox(); const bombXY = [bb.x + bb.width / 2, bb.y + bb.height / 2];
  const S = o.S, k = 1.15 / S, vmax = T.speed * k;                // finger px/s -> field units/s
  let fx = 195, fy = 500; await hands.down1(fx, fy);
  const buf = [o]; let frame = 0, nextDecision = 0, tgt = null, bombAt = -1, focusHeld = false;
  let decisions = 0, randomMoves = 0, mistakes = 0, reGrips = 0, bombsUsed = 0, deaths = 0, lastLives = o.lives, lastBombs = o.bombs, bombTaps = 0;
  const deathAt = [], patternLog = []; let lastPat = '', maxStage = 0; let end = null;
  const cap = capSec * 60, stepN = T.every === 1 ? 1 : 2;
  while (frame < cap) {
    o = await page.evaluate(n => window.__step(n, true), stepN); frame += stepN;
    buf.push(o); if (buf.length > 90) buf.shift();
    maxStage = Math.max(maxStage, o.stage);
    const pat = o.boss && o.boss.name ? o.stage + ':' + o.boss.name : '';
    if (pat && pat !== lastPat) { lastPat = pat; patternLog.push({ t: +(frame / 60).toFixed(1), pattern: pat }); }
    if (o.lives < lastLives) { deaths += lastLives - o.lives; deathAt.push({ t: +(frame / 60).toFixed(1), stage: o.stage + 1, where: pat ? pat.slice(2) : (o.st === 'stage' ? '道中' : o.st) }); }
    if (o.bombs < lastBombs && o.lives === lastLives) bombsUsed += lastBombs - o.bombs;   // a death refills (or trims) bombs: not a bomb
    if (T.exact && o.pl.hitT > 0 && o.bombs > 0 && bombAt < 0) bombAt = frame;            // superhuman: frame-perfect deathbomb
    lastLives = o.lives; lastBombs = o.bombs;
    if (o.st === 'over') { end = 'over'; break; }
    const playing = o.st === 'stage' || o.st === 'boss' || o.st === 'bossdown';
    if (!playing) { tgt = null; continue; }
    // focus: skilled+ hold a second finger while a boss pattern is up (tighter shots); released otherwise
    const wantFocus = T.focusBoss && !!(o.boss && o.boss.name) && o.pl.dead <= 0;
    if (wantFocus !== focusHeld) { focusHeld = wantFocus; if (wantFocus) await hands.down2(300, 300); else await hands.up2(); }
    if (frame >= nextDecision && o.pl.dead <= 0) {
      nextDecision = frame + T.every;
      const rt = Math.max(16, T.react[0] + rnd.gauss() * T.react[1]);
      const d = Math.max(1, Math.round(rt / H.FRAME / stepN));
      const ob = buf[Math.max(0, buf.length - d)];
      const age = (buf.length - 1 - Math.max(0, buf.length - d)) * stepN / 60;
      const plan = decide(T, { ...ob, pl: o.pl, FH: o.FH, power: o.power }, rnd, age, vmax); decisions++;
      if (plan.kind === 'random') randomMoves++;
      if (rnd() < T.mistake) { plan.vx = -plan.vx; plan.vy = -plan.vy; mistakes++; }
      const dur = T.every / 60 + 0.05;
      const delay = Math.round(Math.abs(rnd.gauss() * T.timing) / H.FRAME);
      tgt = { at: frame + delay, x: fx + plan.vx * dur / k + rnd.gauss() * T.pos * 0.25, y: fy + plan.vy * dur / k + rnd.gauss() * T.pos * 0.25 };
      // bomb when the planner sees an unavoidable hit soon (tier threshold); the tap lands after a reaction delay
      // panic bomb: even the best path the player can see runs into a bullet very soon. The observation is already
      // reaction-delayed, so the tap only adds motor timing noise; lower tiers often forget to bomb (bombP).
      if (bombAt < 0 && o.bombs > 0 && o.pl.invul <= 0.1 && (plan.kind === 'plan' && plan.first < 0.3 && plan.pen >= 1 || plan.close >= 2 || plan.crowd >= T.crowd) && rnd() < T.bombP)
        bombAt = frame + Math.round(Math.abs(rnd.gauss() * T.timing) / H.FRAME);
    }
    if (bombAt >= 0 && frame >= bombAt) { bombAt = -1; bombTaps++; await hands.tap(bombXY[0], bombXY[1]); }
    if (tgt && frame >= tgt.at) {
      const maxStep = T.speed * stepN / 60;
      let dx = tgt.x - fx, dy = tgt.y - fy; const dd = Math.hypot(dx, dy);
      if (dd > 0.3) {
        if (dd > maxStep) { dx *= maxStep / dd; dy *= maxStep / dd; }
        const nx = fx + dx, ny = fy + dy;
        if (nx < 10 || nx > 380 || ny < 70 || ny > 760) {   // finger at the screen edge: lift and re-grip mid-screen (relative drag)
          // the game moves the crane with the earliest finger still down, so a re-grip while the focus finger is held
          // lifts both and puts them back in order (as a player would), keeping the new drag finger in control
          const hadFocus = !!hands.f2; if (hadFocus) await hands.up2();
          await hands.up1(); const ox = fx, oy = fy; fx = 195 + (rnd() - 0.5) * 30; fy = 480 + (rnd() - 0.5) * 30;
          tgt.x += fx - ox; tgt.y += fy - oy; reGrips++;
          await hands.down1(fx, fy); if (hadFocus) await hands.down2(300, 300);
        } else { fx = nx; fy = ny; await hands.move1(fx, fy); }
      }
    }
  }
  await hands.release();
  let won = false, overText = '';
  if (end === 'over') { await page.evaluate(() => window.__step(5)); overText = await page.evaluate(() => document.getElementById('oTitle').textContent); won = overText.indexOf('通關') >= 0; }
  const pageErr = await page.evaluate(() => window.__errs);
  const run = { tier: tierId, difficulty: DIFFS[diff], seed, result: won ? 'clear' : end === 'over' ? 'dead' : 'timeout', time: +(frame / 60).toFixed(1),
    score: o.score, stageReached: maxStage + 1, endAt: won ? '通關' : (o.boss && o.boss.name ? `第${maxStage + 1}面 ${o.boss.name}` : `第${maxStage + 1}面 道中`),
    deaths, bombsUsed, bombTaps, graze: o.graze, spells: `${o.spellsGot}/${o.spells}`, power: o.power, kills: o.kills, deathAt, patterns: patternLog,
    decisions, randomMoves, mistakes, reGrips, errors: errors.concat(pageErr) };
  if (log) console.log(tierId, DIFFS[diff], JSON.stringify({ result: run.result, endAt: run.endAt, score: run.score, deaths, bombsUsed, time: run.time, spells: run.spells, errors: run.errors.length }));
  await sess.ctx.close();
  return run;
}

function defaultPlan(tierIds) {
  const plan = [];
  for (const t of tierIds) {
    const diffs = [1, 2]; if (t === 'clumsy' || t === 'casual') diffs.unshift(0); if (t === 'world' || t === 'superhuman') diffs.push(3);
    for (const d of diffs) plan.push([t, d]);
  }
  return plan;
}

async function main() {
  const args = process.argv.slice(2), opt = {}; const pos = [];
  for (const a of args) { const m = a.match(/^--(\w+)=(.*)$/); if (m) opt[m[1]] = m[2]; else pos.push(a); }
  const tierIds = (pos[0] && pos[0] !== 'all') ? pos[0].split(',') : H.TIER_IDS;
  const diffs = pos[1] ? pos[1].split(',').map(Number) : null;
  const runsPer = +(pos[2] || 2), capSec = +(pos[3] || 600);
  const resFile = path.join(OUT, opt.out || 'results.json');
  const results = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : { game: 'bullet-hell', tiers: {}, findings: [] };
  const target = opt.tag ? (results[opt.tag] = results[opt.tag] || { tiers: {} }) : results;
  const plan = diffs ? tierIds.flatMap(t => diffs.map(d => [t, d])) : defaultPlan(tierIds);
  const srv = await H.serve(); const URL = `http://127.0.0.1:${srv.address().port}/`;
  let browser = await H.launch();
  const t0 = Date.now();
  for (const [tierId, diff] of plan) {
    const tier = target.tiers[tierId] = target.tiers[tierId] || { runs: [] };
    tier.runs = tier.runs.filter(r => r.difficulty !== DIFFS[diff]);
    for (let i = 1; i <= runsPer; i++) {
      const seed = 1000 * (H.TIER_IDS.indexOf(tierId) + 1) + diff * 100 + i;
      let run = null;
      for (let tries = 0; tries < 2 && !run; tries++) {
        try { run = await runOnce(browser, URL, tierId, diff, seed, capSec, true); }
        catch (e) { console.log('HARNESS ERROR', tierId, diff, String(e).slice(0, 200)); try { await browser.close(); } catch (e2) {} browser = await H.launch(); }
      }
      if (run) tier.runs.push(run);
      // summary per difficulty
      const by = {}; for (const r of tier.runs) { const b = by[r.difficulty] = by[r.difficulty] || { runs: 0, clears: 0, scores: [], deaths: [], bombs: [], endAt: [] }; b.runs++; if (r.result === 'clear') b.clears++; b.scores.push(r.score); b.deaths.push(r.deaths); b.bombs.push(r.bombsUsed); b.endAt.push(r.endAt); }
      tier.summary = {}; for (const d in by) tier.summary[d] = { runs: by[d].runs, clears: by[d].clears, score: H.summarize(by[d].scores), deaths: H.summarize(by[d].deaths), bombsUsed: H.summarize(by[d].bombs), endAt: by[d].endAt };
      results.wallSeconds = Math.round((Date.now() - t0) / 1000);
      fs.writeFileSync(resFile, JSON.stringify(results, null, 1));
    }
  }
  await browser.close(); srv.close();
  console.log('done in', Math.round((Date.now() - t0) / 1000), 's');
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { decide, runOnce };
