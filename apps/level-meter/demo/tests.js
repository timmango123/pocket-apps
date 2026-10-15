// Math unit tests for 水平儀 (level-meter), run against the tool's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {norm180,norm360,screenAngle,toScreen,gravityFromOrientation,tilt,edgeDeviation,calibOffset,calibOffsetAngle,lowpass,lowpassAngle,stdev,angleBetween,signVote,bubbleOffset,tubeOffset,levelState,beepInterval,slopePct};')();
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const G = 9.81, rad = d => d * Math.PI / 180;

// --- angle helpers ---
t('norm180 wraps 190 -> -170', near(C.norm180(190), -170));
t('norm180 keeps 180', C.norm180(180) === 180 && C.norm180(-180) === 180);
t('norm360 wraps -10 -> 350', near(C.norm360(-10), 350));
t('screenAngle prefers screen.orientation.angle', C.screenAngle(90, 0) === 90);
t('screenAngle falls back to window.orientation (-90 -> 270)', C.screenAngle(undefined, -90) === 270);
t('screenAngle defaults to 0', C.screenAngle(undefined, undefined) === 0);

// --- tilt from gravity (W3C up-vector: flat face-up = (0,0,+g)) ---
{ const r = C.tilt(0, 0, G, 0); t('flat on table reads 0/0', near(r.x, 0) && near(r.y, 0) && near(r.total, 0)); }
{ const th = 2; const r = C.tilt(G * Math.sin(rad(th)), 0, G * Math.cos(rad(th)), 0);
  t('right side raised 2° -> x = +2.0', near(r.x, 2, 1e-9) && near(r.y, 0)); }
{ const r = C.tilt(-G * Math.sin(rad(5)), 0, G * Math.cos(rad(5)), 0); t('left side raised 5° -> x = -5', near(r.x, -5, 1e-9)); }
{ const r = C.tilt(0, G * Math.sin(rad(3)), G * Math.cos(rad(3)), 0); t('top raised 3° -> y = +3', near(r.y, 3, 1e-9) && near(r.x, 0)); }
{ const r = C.tilt(0, G, 0, 0); t('upright portrait -> edge 0, total 90', near(r.edge, 0) && near(r.total, 90)); }
{ const th = 7; const r = C.tilt(G * Math.sin(rad(th)), G * Math.cos(rad(th)), 0, 0);
  t('upright, turned 7° counter-clockwise -> edge +7', near(r.edge, 7, 1e-9)); }
{ const r = C.tilt(-G * Math.sin(rad(4)), G * Math.cos(rad(4)), 0, 0); t('upright, turned clockwise 4° -> edge -4', near(r.edge, -4, 1e-9)); }

// --- tilt from deviceorientation beta/gamma (fallback source) ---
{ const g = C.gravityFromOrientation(0, 0); t('beta=gamma=0 -> up = +z', near(g[0], 0) && near(g[1], 0) && near(g[2], 1)); }
{ const g = C.gravityFromOrientation(90, 0); t('beta=90 (upright) -> up = +y', near(g[1], 1) && near(g[2], 0)); }
{ const g = C.gravityFromOrientation(0, 30); const r = C.tilt(g[0], g[1], g[2], 0);
  t('gamma +30 (right side down) -> x = -30', near(r.x, -30, 1e-9)); }
{ const g = C.gravityFromOrientation(12, 0); const r = C.tilt(g[0], g[1], g[2], 0); t('beta +12 (top up) -> y = +12', near(r.y, 12, 1e-9)); }
{ const g = C.gravityFromOrientation(20, -15); t('orientation gravity is a unit vector', near(Math.hypot(...g), 1)); }

// --- screen-rotation compensation ---
{ const s = C.toScreen(1, 0, 90); t('landscape 90: device +x is screen up', near(s[0], 0) && near(s[1], 1)); }
{ const s = C.toScreen(0, 1, 90); t('landscape 90: device +y is screen left', near(s[0], -1) && near(s[1], 0)); }
{ const s = C.toScreen(0, 1, 270); t('landscape 270: device +y is screen right', near(s[0], 1) && near(s[1], 0)); }
{ const s = C.toScreen(0.3, -0.7, 180); t('upside-down 180 negates both axes', near(s[0], -0.3) && near(s[1], 0.7)); }
// phone rotated a quarter turn counter-clockwise (screen.orientation.angle = 90) and held upright on an edge
{ const r = C.tilt(G, 0, 0, 90); t('landscape upright: long edge level reads 0', near(r.edge, 0)); }
{ const th = 1.5; // in landscape, tip the right end (= device bottom) up 1.5°
  const r = C.tilt(G * Math.cos(rad(th)), -G * Math.sin(rad(th)), 0, 90);
  t('landscape upright: right end raised 1.5° -> edge +1.5 (not reversed)', near(r.edge, 1.5, 1e-9)); }
{ const th = 1.5; const r = C.tilt(-G * Math.cos(rad(th)), G * Math.sin(rad(th)), 0, 270);
  t('landscape 270: right end raised 1.5° -> edge +1.5', near(r.edge, 1.5, 1e-9)); }
{ const th = 2; // flat in landscape 90: screen-right is device -y; raising it gives device y < 0 component of up
  const r = C.tilt(0, -G * Math.sin(rad(th)), G * Math.cos(rad(th)), 90);
  t('flat landscape: screen-right side raised 2° -> x = +2', near(r.x, 2, 1e-9) && near(r.y, 0)); }

// --- edge reference: level or plumb ---
t('edge 0.4 -> level dev 0.4', near(C.edgeDeviation(0.4).dev, 0.4) && C.edgeDeviation(0.4).ref === 'level');
t('edge 89.2 -> plumb dev -0.8', near(C.edgeDeviation(89.2).dev, -0.8, 1e-9) && C.edgeDeviation(89.2).ref === 'plumb');
t('edge -91 -> plumb dev -1', near(C.edgeDeviation(-91).dev, -1) && C.edgeDeviation(-91).ref === 'plumb');
t('edge 179.5 -> level dev -0.5', near(C.edgeDeviation(179.5).dev, -0.5, 1e-9) && C.edgeDeviation(179.5).ref === 'level');

// --- two-step calibration ---
{ const bias = 0.7, slope = 1.3; // surface tilted 1.3°, phone+case bias 0.7°
  const r1 = slope + bias, r2 = -slope + bias; // turned 180° about the vertical
  const off = C.calibOffset(r1, r2);
  t('calibration recovers the bias, not the surface slope', near(off, bias));
  t('after calibration both placements read ±slope', near(r1 - off, slope) && near(r2 - off, -slope)); }
t('angular calibration across ±180', near(C.calibOffsetAngle(179, -177), -179, 1e-9));
t('angular calibration near 0', near(C.calibOffsetAngle(0.9, 0.3), 0.6, 1e-9));
{ // full pipeline: a phone whose sensor reads 0.5° right-high when truly level
  const biasX = 0.5, g1 = [G * Math.sin(rad(biasX)), 0, G * Math.cos(rad(biasX))];
  const a = C.tilt(...g1, 0).x, b = C.tilt(...g1, 0).x; // on a level table both placements read the bias
  const off = C.calibOffset(a, b); t('level table: calibrated reading < 0.3°', Math.abs(C.tilt(...g1, 0).x - off) < 0.3); }

// --- filtering / stability ---
{ let v = 0; for (let i = 0; i < 40; i++) v = C.lowpass(v, 10); t('low-pass (0.15) converges toward 10', v > 9.8 && v < 10); }
t('low-pass first step is 15%', near(C.lowpass(0, 10), 1.5));
{ let v = 179; for (let i = 0; i < 60; i++) v = C.lowpassAngle(v, -179); t('angle low-pass crosses ±180 the short way', Math.abs(C.norm180(v - -179)) < 0.1 && Math.abs(v) > 178); }
t('stdev of steady readings is 0', C.stdev([1, 1, 1, 1]) === 0);
t('stdev of shaky readings > 0.5', C.stdev([0, 1.5, -1, 2, -0.5, 1, 0, 2, -1, 1]) > 0.5);
t('stdev of fine jitter < 0.5', C.stdev([0.1, 0.12, 0.08, 0.11, 0.09]) < 0.5);

// --- protractor ---
t('protractor: same pose = 0', near(C.angleBetween([0, 0, 9.8], [0, 0, 9.8]), 0));
t('protractor: flat to upright = 90', near(C.angleBetween([0, 9.8, 0], [0, 0, 1]), 90));
{ const g = [0, G * Math.sin(rad(35)), G * Math.cos(rad(35))]; t('protractor: 35° slope vs zero on flat', near(C.angleBetween(g, [0, 0, 9.8]), 35, 1e-9)); }
{ const ref = [G * Math.sin(rad(10)), 0, G * Math.cos(rad(10))], g = [G * Math.sin(rad(40)), 0, G * Math.cos(rad(40))];
  t('protractor: zeroed at 10°, now 40° -> 30', near(C.angleBetween(g, ref), 30, 1e-9)); }

// --- iOS accelerationIncludingGravity sign detection ---
t('Android-style vector agrees with orientation -> +1', C.signVote([0, 0, 9.8], 0, 0) === 1);
t('iOS-style inverted vector -> -1', C.signVote([0, 0, -9.8], 0, 0) === -1);
t('upright iOS-style -> -1', C.signVote([0, -9.8, 0], 90, 0) === -1);
t('free fall / tiny vector -> no vote', C.signVote([0, 0, 0.5], 0, 0) === 0);

// --- bubble placement ---
{ const o = C.bubbleOffset(2, 0, 10, 100); t('2° right-high -> bubble 20px right', near(o[0], 20) && near(o[1], 0)); }
{ const o = C.bubbleOffset(0, 5, 10, 100); t('top-high -> bubble moves up (negative y)', near(o[1], -50)); }
{ const o = C.bubbleOffset(30, 30, 10, 100); t('bubble clamped inside the circle', near(Math.hypot(o[0], o[1]), 100)); }
t('tube offset clamps at the ends', C.tubeOffset(9, 5, 120) === 120 && C.tubeOffset(-9, 5, 120) === -120 && near(C.tubeOffset(1, 5, 120), 24));

// --- level feedback ---
t('enters level below 0.3°', C.levelState(false, 0.25) === true && C.levelState(false, -0.29) === true);
t('not level at 0.35° from outside', C.levelState(false, 0.35) === false);
t('stays level at 0.35° (hysteresis)', C.levelState(true, 0.35) === true);
t('leaves level above 0.4°', C.levelState(true, 0.45) === false);
t('sound: continuous tone when level', C.beepInterval(0.1) === 0);
t('sound: faster beeps closer to level', C.beepInterval(1) < C.beepInterval(5) && C.beepInterval(5) < C.beepInterval(9.5));
t('sound: silent beyond 10°', C.beepInterval(12) === null);
t('slope: 45° = 100%', near(C.slopePct(45), 100, 1e-9));
t('slope: 1° ≈ 1.75%', near(C.slopePct(1), 1.7455, 1e-3));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
