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
ok(/^八度/.test(id([60, 72]).zh), 'octave');
ok(/^完全五度/.test(id([60, 67]).zh), 'perfect fifth');
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


// ---- independent spelling check: build every chord/scale from the major key signature (circle of fifths), no semitone math ----
{
  const LETS = 'CDEFGAB', FIFTH = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, F: -1 }, SH = 'FCGDAEB', FL = 'BEADGCF';
  const majorScale = (Lt, acc) => { const pos = FIFTH[Lt] + 7 * acc, li = LETS.indexOf(Lt); return Array.from({ length: 7 }, (_, d) => { const lt = LETS[(li + d) % 7]; let a = 0; if (pos > 0) a = Math.floor(pos / 7) + (SH.indexOf(lt) < pos % 7 ? 1 : 0); if (pos < 0) a = -(Math.floor(-pos / 7) + (FL.indexOf(lt) < (-pos) % 7 ? 1 : 0)); return [lt, a]; }); };
  const accS = a => a > 0 ? '♯'.repeat(a) : '♭'.repeat(-a);
  const build = (Lt, a, f) => { const sc = majorScale(Lt, a); return f.split(' ').map(t => { const m = t.match(/^([b#]*)(\d+)$/), d = (+m[2] - 1) % 7, alt = [...m[1]].reduce((x, c) => x + (c === '#' ? 1 : -1), 0); return sc[d][0] + accS(sc[d][1] + alt); }).join(' '); };
  const F = { maj: '1 3 5', m: '1 b3 5', 7: '1 3 5 b7', maj7: '1 3 5 7', m7: '1 b3 5 b7', dim: '1 b3 b5', dim7: '1 b3 b5 bb7', m7b5: '1 b3 b5 b7', aug: '1 3 #5', sus2: '1 2 5', sus4: '1 4 5', 6: '1 3 5 6', m6: '1 b3 5 6', 9: '1 3 5 b7 9', maj9: '1 3 5 7 9', m9: '1 b3 5 b7 9', add9: '1 3 5 9', 69: '1 3 5 6 9', 11: '1 3 5 b7 9 11', 13: '1 3 5 b7 9 13', '7sus4': '1 4 5 b7', '7b9': '1 3 5 b7 b9', aug7: '1 3 #5 b7', mMaj7: '1 b3 5 7' };
  const SF = { major: '1 2 3 4 5 6 7', minor: '1 2 b3 4 5 b6 b7', harm: '1 2 b3 4 5 b6 7', melo: '1 2 b3 4 5 6 7', pentM: '1 2 3 5 6', pentm: '1 b3 4 5 b7', blues: '1 b3 4 b5 5 b7', dorian: '1 2 b3 4 5 6 b7', phrygian: '1 b2 b3 4 5 b6 b7', lydian: '1 2 3 #4 5 6 7', mixo: '1 2 3 4 5 6 b7', locrian: '1 b2 b3 4 b5 b6 b7' };
  ok(Object.keys(F).length === PC.QUAL.length && Object.keys(SF).length === PC.SCALES.length, 'independent formulas cover every quality and scale');
  let n = 0, badS = 0, badInv = 0;
  for (const Lt of LETS) for (const a of [-1, 0, 1]) {
    const l = LETS.indexOf(Lt);
    for (const q in F) {
      n++; if (names(PC.chordNotes(l, a, q)) !== build(Lt, a, F[q])) { badS++; console.log('  spell', Lt, a, q); }
      const tones = PC.chordNotes(l, a, q).map(x => PC.pcOf(x.l, x.a));
      for (let inv = 0; inv < tones.length; inv++) {
        const mid = PC.chordMidi(l, a, q, inv);
        if (mid[0] % 12 !== tones[inv] || !tones.every(p => mid.some(m => m % 12 === p)) || mid.some((m, i) => i && m <= mid[i - 1]) || mid[0] < PC.LO || mid[mid.length - 1] > PC.HI) { badInv++; console.log('  inv', Lt, a, q, inv, mid); }
        const r = PC.identify(mid);
        if (!r.matches.some(x => x.q === q && PC.pcOf(x.root.l, x.root.a) === tones[0])) { badInv++; console.log('  ident', Lt, a, q, inv, r.name); }
      }
    }
    for (const sc in SF) { n++; if (names(PC.scaleNotes(l, a, sc)) !== build(Lt, a, SF[sc])) { badS++; console.log('  scale', Lt, a, sc); } }
  }
  ok(badS === 0, `${n} chord/scale spellings on 21 roots match the key-signature method (${badS} bad)`);
  ok(badInv === 0, `every inversion of every chord has the right bass, all tones, and is found again by identification (${badInv} bad)`);
}
// extended-chord inversions: the requested tone really is the bass
eq(PC.chordMidi(0, 0, '9', 3), [70, 72, 74, 76, 79], 'C9 third inversion has B♭ in the bass (not C)');
eq(PC.chordMidi(0, 0, 'add9', 3), [74, 76, 79, 84], 'Cadd9 with D in the bass');

// ---- identification: readable root spelling, omitted fifths, dyads ----
const rootRow = ivs => Array.from({ length: 12 }, (_, r) => id(ivs.map(x => 60 + r + x)).name).join(' ');
eq(rootRow([0, 4, 7]), 'C D♭ D E♭ E F F♯ G A♭ A B♭ B', 'major triads on all 12 roots');
eq(rootRow([0, 3, 7]), 'Cm C♯m Dm E♭m Em Fm F♯m Gm G♯m Am B♭m Bm', 'minor triads: C♯m and G♯m, not D♭m / A♭m');
eq(rootRow([0, 3, 6, 9]), 'Cdim7 C♯dim7 Ddim7 D♯dim7 Edim7 Fdim7 F♯dim7 Gdim7 G♯dim7 Adim7 A♯dim7 Bdim7', 'dim7 named as leading-tone chords (A♯dim7, not B♭dim7)');
eq(rootRow([0, 4, 10]), 'C7 D♭7 D7 E♭7 E7 F7 F♯7 G7 A♭7 A7 B♭7 B7', 'shell voicing R–3–♭7 found as a 7th chord with the fifth left out');
ok(/省略五音/.test(id([60, 64, 70]).zh), 'omitted fifth is said');
eq(id([60, 64, 70, 74]).name, 'C9', 'C E B♭ D → C9 (no 5th)');
eq(id([68, 71]).name, 'G♯ – B', 'G♯–B is spelled as a minor third, not A♭–B');
eq(id([63, 69]).name + ' ' + id([63, 69]).zh, 'E♭ – A 三全音（增四度）', 'tritone spelled as an augmented fourth');
eq(id([60, 67]).zh, '完全五度・強力和弦 C5', 'fifth is also named as a power chord');
eq(id([61]).zh, '單音 C♯4 = D♭4', 'single black key shows both names and the octave');
eq(id([60, 61, 62]).kind, 'unknown', 'cluster has no name');

// ---- typed chord names ----
const P = s => { const r = PC.parseChord(s); return r.ok ? PC.chordName(r.l, r.a, r.q, PC.chordNotes(r.l, r.a, r.q)[r.inv]) : 'ERR'; };
const typed = { 'C': 'C', 'cm7': 'Cm7', 'F#m7b5': 'F♯m7♭5', 'F♯m7♭5': 'F♯m7♭5', 'Bb/D': 'B♭/D', 'C/E': 'C/E', 'C7(b9)': 'C7♭9', 'Cm(maj7)': 'CmM7', 'C△7': 'Cmaj7', 'CΔ': 'Cmaj7', 'CM7': 'Cmaj7', 'C°7': 'Cdim7', 'Co': 'Cdim', 'Cø': 'Cm7♭5', 'C+': 'Caug',
  'Ｆ＃ｍ７': 'F♯m7', '  g7  ': 'G7', 'C6/9': 'C6/9', 'Cmaj7/B': 'Cmaj7/B', 'Am7/G': 'Am7/G', 'Ebsus': 'E♭sus4', 'CMAJ7': 'Cmaj7', 'Cmin7': 'Cm7', 'C-7': 'Cm7', 'E#m': 'E♯m', 'B#dim7': 'B♯dim7', 'Cb7': 'C♭7', 'Am/C': 'Am/C', 'Gadd9': 'Gadd9', 'D7sus4': 'D7sus4', 'G7#5': 'G7♯5', 'C/Fb': 'C/E',
  '': 'ERR', 'H7': 'ERR', '🎹': 'ERR', 'Bbb': 'ERR', 'Cx': 'ERR', 'C5': 'ERR', 'C/F': 'ERR', 'C/Bb': 'ERR', 'C/': 'ERR', 'C//E': 'ERR', '<script>': 'ERR', 'Cmaj13#11': 'ERR', '123': 'ERR', ['C'.repeat(200)]: 'ERR' };
let tbad = 0; for (const k in typed) { const got = P(k); if (got !== typed[k]) { tbad++; console.log('  typed', JSON.stringify(k), got, '≠', typed[k]); } }
ok(tbad === 0, `${Object.keys(typed).length} typed chord names parsed or rejected correctly (${tbad} bad)`);
ok(PC.parseChord('C/Bb').err.includes('不是') && PC.parseChord('H7').err.includes('A–G') && PC.parseChord('Cfoo').err.includes('看不懂'), 'errors say what is wrong in plain words');
ok(PC.parseChord(null).ok === false && PC.parseChord(undefined).ok === false && PC.parseChord(42).ok === false, 'non-strings do not throw');

// ---- progressions: transposition and voice leading ----
const prog = (chords, minor, pc) => PC.progChords({ minor, chords }, pc).map(c => PC.chordName(c.l, c.a, c.q)).join(' ');
const CANON = [[1, 0, 'maj'], [5, 7, 'maj'], [6, 9, 'm'], [3, 4, 'm'], [4, 5, 'maj'], [1, 0, 'maj'], [4, 5, 'maj'], [5, 7, 'maj']];
eq(prog(CANON, false, 2), 'D A Bm F♯m G D G A', 'Canon in D');
eq(prog(CANON, false, 6), 'F♯ C♯ D♯m A♯m B F♯ B C♯', 'Canon transposed to F♯');
eq(prog(CANON, false, 3), 'E♭ B♭ Cm Gm A♭ E♭ A♭ B♭', 'Canon transposed to E♭');
eq(prog(CANON, false, 1), 'D♭ A♭ B♭m Fm G♭ D♭ G♭ A♭', 'Canon transposed to D♭');
const MINOR = [[1, 0, 'm'], [6, 8, 'maj'], [3, 3, 'maj'], [7, 10, 'maj']];
eq(prog(MINOR, true, 9), 'Am F C G', 'minor i–VI–III–VII in A');
eq(prog(MINOR, true, 3), 'D♯m B F♯ C♯', 'in D♯ minor (not E♭m with C♭)');
eq(prog(MINOR, true, 10), 'B♭m G♭ D♭ A♭', 'in B♭ minor');
eq(prog([[2, 2, 'm7'], [5, 7, '7'], [1, 0, 'maj7']], false, 8), 'B♭m7 E♭7 A♭maj7', 'ii–V–I in A♭');
let vbad = 0;
for (let k = 0; k < 12; k++) {
  let prev = null;
  for (const c of PC.progChords({ minor: false, chords: CANON }, k)) {
    const v = PC.voiceLead(prev, c.l, c.a, c.q), tones = PC.chordNotes(c.l, c.a, c.q).map(x => PC.pcOf(x.l, x.a));
    if (v.upper.length !== tones.length || !tones.every(p => v.upper.some(m => m % 12 === p)) || v.bass % 12 !== tones[0] || v.bass < 40 || v.bass > 51 || v.upper[0] < 53 || v.upper[v.upper.length - 1] > 86) vbad++;
    if (prev && Math.abs(v.upper[0] - prev[0]) > 7) vbad++;
    prev = v.upper;
  }
}
ok(vbad === 0, `voice-led playback in all 12 keys: every tone present, root in the bass, small hand movement (${vbad} bad)`);

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
    ok(n <= 14, `voice count capped at 14 (${n})`);
    // sustain pedal holds released notes
    await page.evaluate(() => { __pc.Piano.allOff(); __pc.Piano.setPedal(true); __pc.Piano.noteOn(60); __pc.Piano.noteOff(60); });
    ok(await page.evaluate(() => __pc.Piano.voices.some(v => v.m === 60 && !v.released)), 'pedal keeps the note ringing after key up');
    await page.evaluate(() => __pc.Piano.setPedal(false));
    ok(await page.evaluate(() => !__pc.Piano.voices.some(v => v.m === 60 && !v.released)), 'pedal up releases it');
    // click-free release: the gain a release starts from equals the envelope at that instant (no jump), and it decays to silence
    const env = await page.evaluate(() => { const P = __pc.Piano, v = { t: 0, peak: 0.2, tau: 2 }; const pts = []; for (let t = 0; t < 3; t += 0.0005) pts.push(P.envAt(v, t)); let jump = 0; for (let i = 1; i < pts.length; i++) jump = Math.max(jump, Math.abs(pts[i] - pts[i - 1])); const r = { ...v, rel: 1, relV: P.envAt(v, 1), relTc: 0.075 }; return { jump, cont: Math.abs(P.envAt(r, 1) - P.envAt(v, 1)), tail: P.envAt(r, 1 + 0.075 * 9) / 0.2 }; });
    ok(env.jump < 0.03 && env.cont < 1e-9 && env.tail < 2e-4, `envelope is continuous (max step ${env.jump.toFixed(4)}), release starts where it is, ends ${(20 * Math.log10(env.tail)).toFixed(0)} dB down before the oscillator stops`);
    // pitch: every key's oscillator frequency is 440·2^((m−69)/12)
    const fr = await page.evaluate(() => { __pc.Piano.allOff(); const out = []; for (const m of [36, 57, 60, 69, 81, 96]) { __pc.Piano.noteOn(m); const v = __pc.Piano.voices[__pc.Piano.voices.length - 1]; out.push([m, v.oscs[0].frequency.value]); } __pc.Piano.allOff(); return out; });
    ok(fr.every(([m, f]) => Math.abs(f - 440 * Math.pow(2, (m - 69) / 12)) < 0.01), 'oscillators sound the right pitches ' + fr.map(x => x[1].toFixed(2)).join(' '));
    // rapid taps: 40 taps at ~8 per second alternating between far-apart keys, every one strikes exactly one note
    await page.evaluate(() => { __pc.Piano.allOff(); window.__ons = 0; const o = __pc.Piano.noteOn; __pc.Piano.noteOn = (...a) => { window.__ons++; return o(...a); }; });
    const ka = await box(60), kb2 = await box(71);
    for (let i = 0; i < 40; i++) { const p = i % 2 ? kb2 : ka; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 9 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(125); }
    const taps = await page.evaluate(() => [window.__ons, __pc.fingers.size, __pc.PRESSED.size]);
    eq(taps, [40, 0, 0], '40 rapid alternating taps → 40 notes, nothing stuck');
    ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
    await ctx.close();
  } finally { await browser.close(); }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.message); console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1); });
