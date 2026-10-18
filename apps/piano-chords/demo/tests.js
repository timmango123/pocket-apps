// Music-theory tests for 虛擬鋼琴與和弦表: chord spelling for every quality and root (enharmonics included),
// inversions, chord identification from note sets, scale spelling, keyboard geometry and multi-touch in Chromium.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const PC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return PC;')();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const names = notes => notes.map(n => n.name).join(' ');
const L = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const root = s => ({ l: L[s[0]], a: s.length > 1 ? (s[1] === '#' ? 1 : -1) : 0 });
const chord = (r, q) => names(PC.chordNotes(root(r).l, root(r).a, q));
const scale = (r, s) => names(PC.scaleNotes(root(r).l, root(r).a, s));

// ---- chord spelling: specific enharmonic cases ----
eq(chord('C', 'maj'), 'C E G', 'C major');
eq(chord('F#', 'maj7'), 'F♯ A♯ C♯ E♯', 'F♯maj7 uses E♯, not F');
eq(chord('Gb', 'maj7'), 'G♭ B♭ D♭ F', 'G♭maj7 uses F, not E♯');
eq(chord('Cb', 'maj'), 'C♭ E♭ G♭', 'C♭ major');
eq(chord('B#', 'maj'), 'B♯ D♯♯ F♯♯', 'B♯ major needs double sharps');
eq(chord('Ab', 'm7b5'), 'A♭ C♭ E♭♭ G♭', 'A♭m7♭5 needs E♭♭');
eq(chord('Db', 'm'), 'D♭ F♭ A♭', 'D♭ minor uses F♭');
eq(chord('E', '7'), 'E G♯ B D', 'E7');
eq(chord('Bb', 'dim7'), 'B♭ D♭ F♭ A♭♭', 'B♭dim7 is spelled with F♭ and A♭♭');
eq(chord('C', 'aug'), 'C E G♯', 'Caug');
eq(chord('D', 'sus2'), 'D E A', 'Dsus2');
eq(chord('A', 'sus4'), 'A D E', 'Asus4');
eq(chord('G', '6'), 'G B D E', 'G6');
eq(chord('E', 'm6'), 'E G B C♯', 'Em6');
eq(chord('C', '9'), 'C E G B♭ D', 'C9');
eq(chord('F', 'add9'), 'F A C G', 'Fadd9');
eq(chord('G', '11'), 'G B D F A C', 'G11');
eq(chord('C', '13'), 'C E G B♭ D A', 'C13');
eq(chord('D', '7b9'), 'D F♯ A C E♭', 'D7♭9');
eq(chord('C', 'aug7'), 'C E G♯ B♭', 'C7♯5');
eq(chord('A', 'mMaj7'), 'A C E G♯', 'AmM7');
eq(chord('C', '69'), 'C E G A D', 'C6/9');
eq(chord('E', '7sus4'), 'E A B D', 'E7sus4');
eq(chord('F#', 'dim'), 'F♯ A C', 'F♯dim');
eq(chord('B', 'm9'), 'B D F♯ A C♯', 'Bm9');
eq(chord('Eb', 'maj9'), 'E♭ G B♭ D F', 'E♭maj9');

// ---- every quality × every root: letters follow the degrees, pitch classes follow the formula ----
const ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B', 'Cb', 'B#', 'E#', 'Fb'];
let combos = 0, bad = 0;
for (const q of PC.QUAL) for (const r of ROOTS) {
  const { l, a } = root(r), notes = PC.chordNotes(l, a, q[0]);
  const rootPc = PC.pcOf(l, a);
  for (const [i, n] of notes.entries()) {
    const iv = q[3][i];
    if (n.l !== (l + iv[0] - 1) % 7) bad++;
    if (PC.pcOf(n.l, n.a) !== (rootPc + iv[1]) % 12) bad++;
    if (Math.abs(n.a) > 3) bad++;   // C♭dim7 needs B♭♭♭, a theoretical chord but still spelled by degree
  }
  const mid = PC.chordMidi(l, a, q[0], 0);
  if (mid.some((m, i) => i && m <= mid[i - 1]) || mid[0] < PC.LO || mid[mid.length - 1] > PC.HI) bad++;
  if (mid.some((m, i) => m % 12 !== (rootPc + q[3][i][1]) % 12)) bad++;
  combos++;
}
ok(combos === PC.QUAL.length * ROOTS.length && bad === 0, `all ${combos} quality×root combinations spelled by degree with correct pitch classes (${bad} bad)`);
ok(PC.QUAL.length >= 20, `${PC.QUAL.length} chord qualities`);

// ---- interval labels ----
eq(PC.chordNotes(0, 0, 'm7b5').map(n => n.label), ['R', '♭3', '♭5', '♭7'], 'm7♭5 interval labels');
eq(PC.chordNotes(0, 0, '13').map(n => n.label), ['R', '3', '5', '♭7', '9', '13'], '13 interval labels');
eq(PC.chordNotes(0, 0, 'dim7').map(n => n.label), ['R', '♭3', '♭5', '♭♭7'], 'dim7 labels ♭♭7');
eq(PC.chordNotes(0, 0, 'aug').map(n => n.label), ['R', '3', '♯5'], 'aug labels ♯5');

// ---- inversions ----
eq(PC.chordMidi(0, 0, 'maj', 0), [60, 64, 67], 'C major root position C4 E4 G4');
eq(PC.chordMidi(0, 0, 'maj', 1), [64, 67, 72], 'first inversion E4 G4 C5');
eq(PC.chordMidi(0, 0, 'maj', 2), [67, 72, 76], 'second inversion G4 C5 E5');
eq(PC.chordMidi(0, 0, 'maj7', 3), [71, 72, 76, 79], 'maj7 third inversion');
eq(PC.chordMidi(0, 0, 'maj', 3), [60, 64, 67], 'inversion wraps modulo chord size');
eq(PC.chordMidi(6, 0, '13', 0), [71, 75, 78, 81, 85, 92], 'B13 from B4 stays inside C2–C7');
eq(PC.chordMidi(6, 0, '13', 1), [75, 78, 81, 85, 92, 83].sort((a, b) => a - b), 'B13 first inversion ascending');
ok(PC.chordMidi(0, 0, '13', 2).every(m => m >= PC.LO && m <= PC.HI), 'high inversion of C13 dropped an octave to fit the keyboard');
eq(PC.chordName(0, 0, 'maj', { l: 2, a: 0 }), 'C/E', 'slash name for inversion');
eq(PC.chordName(0, 0, 'maj', { l: 0, a: 0 }), 'C', 'no slash when bass is the root');
eq(PC.chordName(3, 1, 'm7b5'), 'F♯m7♭5', 'symbol formatting');
eq(PC.midiOf(0, 0, 4), 60, 'C4 = 60'); eq(PC.midiOf(6, 1, 3), 60, 'B♯3 = 60'); eq(PC.midiOf(0, -1, 4), 59, 'C♭4 = 59');

// ---- identification ----
const id = ms => PC.identify(ms);
eq(id([60, 64, 67]).name, 'C', 'C E G → C');
eq(id([64, 67, 72]).name, 'C/E', 'E G C → C/E (first inversion)');
eq(id([55, 60, 64]).name, 'C/G', 'G3 C4 E4 → C/G');
eq(id([64, 67, 72]).matches[0].zh, '大三和弦（轉位）', 'inversion is marked');
eq(id([57, 60, 64]).name, 'Am', 'A C E → Am');
eq(id([60, 64, 67, 70]).name, 'C7', 'C E G B♭ → C7');
eq(id([60, 64, 67, 71]).name, 'Cmaj7', 'Cmaj7');
eq(id([62, 65, 69, 72]).name, 'Dm7', 'Dm7');
eq(id([60, 64, 67, 69]).name, 'C6', 'C E G A with C in the bass → C6, not Am7');
eq(id([57, 60, 64, 67]).name, 'Am7', 'A C E G with A in the bass → Am7, not C6');
ok(id([60, 64, 67, 69]).matches.some(m => m.name === 'Am7/C'), 'Am7/C listed as an alternative');
eq(id([66, 70, 73, 77]).name, 'F♯maj7', 'F♯ A♯ C♯ E♯ pitch classes → F♯maj7 (G♭maj7 saves only one accidental, preferred spelling kept)');
eq(id([61, 65, 68, 72]).name, 'D♭maj7', 'C♯ E♯ G♯ B♯ pitch classes → D♭maj7');
eq(id([66, 70, 73]).name, 'F♯', 'F♯ A♯ C♯ → F♯ (tie keeps preferred spelling)');
eq(id([61, 65, 68]).name, 'D♭', 'C♯/D♭ major → D♭');
eq(id([60, 63, 66, 69]).name, 'Cdim7', 'symmetric dim7 named from the bass');
eq(id([63, 66, 69, 72]).name, 'D♯dim7', 'same pitch classes, E♭/D♯ in the bass → D♯dim7 (E♭dim7 would need B♭♭ and D♭♭)');
ok(!id([60, 63, 66, 69]).matches.some(m => /B♯/.test(m.name)), 'B♯ never used as a root');
eq(id([60, 64, 68]).name, 'Caug', 'augmented named from the bass');
eq(id([60, 62, 67]).name, 'Csus2', 'Csus2');
eq(id([60, 65, 67]).name, 'Csus4', 'Csus4');
eq(id([60, 63, 66, 70]).name, 'Cm7♭5', 'Cm7♭5');
eq(id([60, 64, 67, 70, 74]).name, 'C9', 'C9');
eq(id([60, 64, 67, 74]).name, 'Cadd9', 'Cadd9');
eq(id([60, 64, 67, 70, 74, 77]).name, 'C11', 'C11');
eq(id([60, 64, 67, 70, 74, 81]).name, 'C13', 'C13');
eq(id([60, 64, 67, 72, 76]).name, 'C', 'doubled octaves still C');
eq(id([60]).kind, 'single', 'one note');
eq(id([60, 72]).zh, '八度', 'octave');
eq(id([60, 67]).zh, '完全五度', 'perfect fifth');
eq(id([60, 64]).zh, '大三度', 'major third');
eq(id([60, 61, 62]).kind, 'unknown', 'cluster has no name');
eq(id([]).kind, 'none', 'empty set');
ok(id([60, 64, 67]).matches[0].notes.map(n => n.name).join(' ') === 'C E G', 'identified chord carries spelled notes');

// ---- scales ----
eq(scale('C', 'major'), 'C D E F G A B', 'C major');
eq(scale('A', 'minor'), 'A B C D E F G', 'A natural minor');
eq(scale('A', 'harm'), 'A B C D E F G♯', 'A harmonic minor');
eq(scale('A', 'melo'), 'A B C D E F♯ G♯', 'A melodic minor ascending');
eq(scale('F#', 'major'), 'F♯ G♯ A♯ B C♯ D♯ E♯', 'F♯ major has E♯');
eq(scale('Gb', 'major'), 'G♭ A♭ B♭ C♭ D♭ E♭ F', 'G♭ major has C♭');
eq(scale('D', 'dorian'), 'D E F G A B C', 'D dorian');
eq(scale('E', 'phrygian'), 'E F G A B C D', 'E phrygian');
eq(scale('F', 'lydian'), 'F G A B C D E', 'F lydian');
eq(scale('G', 'mixo'), 'G A B C D E F', 'G mixolydian');
eq(scale('B', 'locrian'), 'B C D E F G A', 'B locrian');
eq(scale('C', 'pentM'), 'C D E G A', 'C major pentatonic');
eq(scale('A', 'pentm'), 'A C D E G', 'A minor pentatonic');
eq(scale('A', 'blues'), 'A C D E♭ E G', 'A blues');
eq(scale('Eb', 'blues'), 'E♭ G♭ A♭ B♭♭ B♭ D♭', 'E♭ blues with B♭♭');
eq(PC.scaleMidi(0, 0, 'major', 4), [60, 62, 64, 65, 67, 69, 71, 72], 'C major midi up to the octave');
eq(PC.scaleMidi(5, 0, 'harm', 3), [57, 59, 60, 62, 64, 65, 68, 69], 'A harmonic minor from A3');
let sbad = 0;
for (const s of PC.SCALES) for (const r of ROOTS) {
  const { l, a } = root(r), notes = PC.scaleNotes(l, a, s[0]), rp = PC.pcOf(l, a);
  notes.forEach((n, i) => { if (n.l !== (l + s[3][i][0] - 1) % 7 || PC.pcOf(n.l, n.a) !== (rp + s[3][i][1]) % 12) sbad++; });
}
ok(sbad === 0, `all scales × roots spelled by degree (${sbad} bad)`);

// ---- note labels ----
eq(PC.label(0, 1, 'letter'), 'C♯', 'letter label'); eq(PC.label(4, 0, 'solfege'), 'Sol', 'solfège'); eq(PC.label(3, 1, 'num'), '♯4', '簡譜'); eq(PC.label(0, 0, 'none'), '', 'none');
eq(PC.defaultSpell(61), { l: 0, a: 1 }, 'black keys default to sharps'); eq(PC.defaultSpell(63), { l: 1, a: 1 }, 'D♯');

// ---- keyboard geometry ----
ok(PC.NW === 36 && PC.WHITE_MIDI[0] === 36 && PC.WHITE_MIDI[35] === 96, '36 white keys C2…C7');
eq(PC.WIDX[60], 14, 'C4 is white key 14');
eq(PC.keyLeft(60, 30), 420, 'C4 left edge'); eq(PC.keyLeft(61, 30), 450 - 9.3, 'C♯4 straddles the C4/D4 boundary');
eq(PC.keyAt(5, 100, 30, 140), 36, 'bottom-left is C2');
eq(PC.keyAt(425, 120, 30, 140), 60, 'lower part of C4 → C4');
eq(PC.keyAt(449, 40, 30, 140), 61, 'upper part near the boundary → C♯4');
eq(PC.keyAt(449, 120, 30, 140), 60, 'lower part near the boundary → white key');
eq(PC.keyAt(510, 40, 30, 140), 65, 'E/F boundary has no black key → F4');
eq(PC.keyAt(-1, 40, 30, 140), -1, 'left of the keyboard');
eq(PC.keyAt(36 * 30 + 1, 40, 30, 140), -1, 'right of the keyboard');
eq(PC.keyAt(100, 150, 30, 140), -1, 'below the keys');
eq(PC.keyAt(35 * 30 + 15, 40, 30, 140), 96, 'last key C7 has no black key after it');
ok(Math.abs(PC.freqOf(69) - 440) < 1e-9 && Math.abs(PC.freqOf(60) - 261.63) < 0.01, 'frequencies');

// ---- browser: multi-touch and sound in Chromium ----
(async () => {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + html + '</body></html>');
    await page.waitForTimeout(300);
    const cdp = await ctx.newCDPSession(page);
    const box = async m => page.evaluate(m => { const r = __pc.keysWrap.querySelector(`[data-m="${m}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * (r.height > 100 ? 0.85 : 0.4) }; }, m);
    const pts = await Promise.all([60, 64, 67].map(box));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
    await page.waitForTimeout(80);
    const st = await page.evaluate(() => ({ fingers: [...__pc.fingers.values()].sort(), pressed: [...__pc.PRESSED.keys()].sort(), voices: __pc.Piano.voices.filter(v => !v.released).map(v => v.m).sort(), ctx: __pc.Piano.ctx && __pc.Piano.ctx.state }));
    eq(st.fingers, [60, 64, 67], 'three fingers hold three notes');
    eq(st.voices, [60, 64, 67], 'three voices sounding');
    ok(st.ctx === 'running', 'AudioContext running after first touch (' + st.ctx + ')');
    // slide the first finger from C4 to D4: glissando
    const d4 = await box(62);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: d4.x, y: d4.y, id: 0 }, { x: pts[1].x, y: pts[1].y, id: 1 }, { x: pts[2].x, y: pts[2].y, id: 2 }] });
    await page.waitForTimeout(60);
    eq(await page.evaluate(() => [...__pc.fingers.values()].sort()), [62, 64, 67], 'glissando: finger 0 now on D4');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(60);
    eq(await page.evaluate(() => [__pc.fingers.size, __pc.PRESSED.size, __pc.Piano.voices.filter(v => !v.released).length]), [0, 0, 0], 'all released on touch end');
    // polyphony limit with voice stealing
    const n = await page.evaluate(() => { for (let m = 48; m < 72; m++) __pc.Piano.noteOn(m); return __pc.Piano.voices.length; });
    ok(n <= 10, `voice count capped at 10 (${n})`);
    // sustain pedal holds released notes
    await page.evaluate(() => { __pc.Piano.allOff(); __pc.Piano.setPedal(true); __pc.Piano.noteOn(60); __pc.Piano.noteOff(60); });
    ok(await page.evaluate(() => __pc.Piano.voices.some(v => v.m === 60 && !v.released)), 'pedal keeps the note ringing after key up');
    await page.evaluate(() => __pc.Piano.setPedal(false));
    ok(await page.evaluate(() => !__pc.Piano.voices.some(v => v.m === 60 && !v.released)), 'pedal up releases it');
    ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
    await ctx.close();
  } finally { await browser.close(); }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.message); console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1); });
