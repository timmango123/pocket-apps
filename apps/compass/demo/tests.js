// Math unit tests for 指南針 (compass), run against the tool's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {norm360,angleDiff,smoothAngle,screenAngle,headingFromAlpha,headingFromEuler,headingFromWebkit,toTrue,DIR16,dirIndex,dirName,turnHint,tiltOf,circStd,needsCalibration,fmtHeading};')();
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const nearH = (a, b, e = 1e-6) => Math.abs(C.angleDiff(a, b)) <= e;

// --- wrap helpers ---
t('norm360(-30) = 330', near(C.norm360(-30), 330));
t('norm360(720) = 0', C.norm360(720) === 0);
t('angleDiff 355 -> 5 is +10', near(C.angleDiff(5, 355), 10));
t('angleDiff 5 -> 355 is -10', near(C.angleDiff(355, 5), -10));
t('angleDiff opposite = -180', near(C.angleDiff(180, 0), -180));
t('angleDiff of equal = 0', C.angleDiff(123, 123) === 0);

// --- smoothing across the 0/360 wrap ---
{ let cur = 355; const seen = [];
  for (let i = 0; i < 40; i++) { cur = C.smoothAngle(cur, 5, 0.2); seen.push(cur); }
  t('355 -> 5 moves up through 360, never down through 180', seen.every(v => v >= 355 && v <= 365));
  t('355 -> 5 converges to 5 (mod 360)', nearH(C.norm360(cur), 5, 0.01)); }
{ let cur = 2; for (let i = 0; i < 40; i++) cur = C.smoothAngle(cur, 350, 0.2);
  t('2 -> 350 goes backward through 0 (unwrapped to about -10)', near(cur, -10, 0.05)); }
t('smoothing first step is 20% of the short way', near(C.smoothAngle(350, 10, 0.2), 354));
t('smoothing seeds from the first reading', C.smoothAngle(null, 42) === 42);

// --- screen orientation ---
t('screenAngle uses screen.orientation.angle', C.screenAngle(270, 0) === 270);
t('screenAngle falls back to window.orientation', C.screenAngle(undefined, 90) === 90 && C.screenAngle(undefined, -90) === 270);

// --- heading from Android absolute alpha (counter-clockwise) ---
t('alpha 0 -> heading 0 (north)', C.headingFromAlpha(0) === 0);
t('alpha 90 -> heading 270 (west)', C.headingFromAlpha(90) === 270);
t('alpha 270 -> heading 90 (east)', C.headingFromAlpha(270) === 90);
t('alpha 233 -> heading 127', near(C.headingFromAlpha(233), 127));
t('landscape (+90) adds the screen angle', near(C.headingFromAlpha(233, 90), 217));

// --- tilt-compensated heading from alpha/beta/gamma ---
for (const a of [0, 45, 127, 233, 300]) t('flat: euler heading = 360 - alpha (' + a + ')', nearH(C.headingFromEuler(a, 0, 0, 0), C.headingFromAlpha(a)));
t('pitching the top up does not change the heading', nearH(C.headingFromEuler(233, 40, 0, 0), 127));
t('rolling sideways does not change the heading', nearH(C.headingFromEuler(233, 0, 35, 0), 127) && nearH(C.headingFromEuler(233, 0, -35, 0), 127));
t('held upright (beta 90) reads where the back camera points', nearH(C.headingFromEuler(233, 90, 0, 0), 127));
t('held at 75° still reads 127', nearH(C.headingFromEuler(233, 75, 0, 0), 127));
t('landscape flat: heading of screen-top = device left edge', nearH(C.headingFromEuler(233, 0, 0, 90), 217));
t('landscape 270', nearH(C.headingFromEuler(233, 0, 0, 270), 37));
t('landscape tilted up still matches flat landscape', nearH(C.headingFromEuler(233, 0, 50, 90), 217));

// --- iOS webkitCompassHeading (clockwise already) ---
t('webkitCompassHeading passes through', C.headingFromWebkit(127, 0) === 127);
t('webkitCompassHeading + landscape angle wraps', C.headingFromWebkit(300, 90) === 30);

// --- true north / declination ---
t('true = magnetic + declination (Taiwan -4.5)', near(C.toTrue(127, -4.5), 122.5));
t('true north wraps below 0', near(C.toTrue(2, -4.5), 357.5));
t('east declination wraps past 360', near(C.toTrue(359, 3), 2));
t('zero declination = magnetic', C.toTrue(90, 0) === 90);

// --- 16-point names ---
t('16 names', C.DIR16.length === 16 && new Set(C.DIR16).size === 16);
t('0 -> 北', C.dirName(0) === '北');
t('359 -> 北', C.dirName(359) === '北');
t('11.2 -> 北, 11.3 -> 東北偏北 (22.5° sectors)', C.dirName(11.2) === '北' && C.dirName(11.3) === '東北偏北');
t('45 -> 東北', C.dirName(45) === '東北');
t('67.5 -> 東北偏東', C.dirName(67.5) === '東北偏東');
t('90 -> 東', C.dirName(90) === '東');
t('127 -> 東南 (spec example)', C.dirName(127) === '東南');
t('157.5 -> 東南偏南', C.dirName(157.5) === '東南偏南');
t('180 -> 南', C.dirName(180) === '南');
t('202.5 -> 西南偏南', C.dirName(202.5) === '西南偏南');
t('247.5 -> 西南偏西', C.dirName(247.5) === '西南偏西');
t('270 -> 西', C.dirName(270) === '西');
t('292.5 -> 西北偏西', C.dirName(292.5) === '西北偏西');
t('315 -> 西北', C.dirName(315) === '西北');
t('337.5 -> 西北偏北', C.dirName(337.5) === '西北偏北');
t('negative input wraps (-90 -> 西)', C.dirName(-90) === '西');
t('index formula round(h/22.5) % 16', C.dirIndex(350) === 0 && C.dirIndex(348) === 15);

// --- target guidance ---
{ const h = C.turnHint(150, 127); t('target 150 from 127: turn right 23°', !h.ok && h.d > 0 && h.text === '向右轉 23°'); }
{ const h = C.turnHint(100, 127); t('target 100 from 127: turn left 27°', !h.ok && h.d < 0 && h.text === '向左轉 27°'); }
{ const h = C.turnHint(5, 355); t('target across north: turn right 10°', h.text === '向右轉 10°'); }
{ const h = C.turnHint(359, 1); t('within 3° (across 0) -> 方向正確', h.ok && h.text === '方向正確'); }
t('exactly 3° off is not yet correct', !C.turnHint(10, 7).ok);

// --- tilt / accuracy ---
t('flat tilt = 0', near(C.tiltOf(0, 0), 0));
t('upright tilt = 90', near(C.tiltOf(90, 0), 90));
t('combined tilt > each axis', C.tiltOf(35, 35) > 45);
t('circular std of steady headings ~ 0', C.circStd([10, 10, 10]) < 1e-3);
t('circular std handles the wrap (359, 1) as small', C.circStd([359, 1, 359, 1]) < 1.5);
t('circular std of scattered headings > 10', C.circStd([0, 30, -30, 20, -20, 40]) > 10);
t('iOS accuracy 25 needs calibration', C.needsCalibration(25, 0) === true);
t('iOS accuracy 10 is fine', C.needsCalibration(10, 50) === false);
t('iOS accuracy -1 (invalid) needs calibration', C.needsCalibration(-1, 0) === true);
t('no accuracy field: jitter 12 needs calibration', C.needsCalibration(null, 12) === true);
t('no accuracy field: jitter 3 is fine', C.needsCalibration(undefined, 3) === false);
t('fmtHeading rounds and wraps 359.6 -> 0°', C.fmtHeading(359.6) === '0°' && C.fmtHeading(127.4) === '127°');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
