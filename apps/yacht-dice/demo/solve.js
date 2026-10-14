// Offline tool (not needed to play). Exact optimal solitaire DP (official joker rules, +35 upper bonus, +100 extra yachts). Writes V table to vtable.bin.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path'), fs = require('fs');
const YC = new Function(fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return YC;')();
const N = 8192 * 128;
const idx = (m, u, y) => m * 128 + u * 2 + y;
// reachable upper totals per upper mask
const reach = [];
for (let um = 0; um < 64; um++) {
  let s = new Set([0]);
  for (let i = 0; i < 6; i++) if (um >> i & 1) { const n = new Set(); for (const v of s) for (let k = 0; k <= 5; k++) n.add(Math.min(63, v + (i + 1) * k)); s = n; }
  reach.push([...s].sort((a, b) => a - b));
}
function statesOf(masks) { const out = []; for (const m of masks) for (const u of reach[m & 63]) { out.push([m, u, 0]); if (m >> 11 & 1) out.push([m, u, 1]); } return out; }
if (!isMainThread) {
  const V = new Float32Array(workerData.sab);
  const Vf = (m, u, y) => m === 8191 ? 0 : V[idx(m, u, y)];
  parentPort.on('message', job => {
    for (const [m, u, y] of job) V[idx(m, u, y)] = YC.turnValue({ mask: m, u, y }, Vf);
    parentPort.postMessage(job.length);
  });
} else {
  const sab = new SharedArrayBuffer(N * 4), V = new Float32Array(sab);
  const W = 4, workers = [...Array(W)].map(() => new Worker(__filename, { workerData: { sab } }));
  const byPop = [...Array(14)].map(() => []);
  for (let m = 0; m < 8191; m++) { let p = 0; for (let i = 0; i < 13; i++) p += m >> i & 1; byPop[p].push(m); }
  (async () => {
    const t0 = Date.now(); let tot = 0;
    for (let p = 12; p >= 0; p--) {
      const st = statesOf(byPop[p]); tot += st.length;
      const chunks = [...Array(W)].map(() => []); st.forEach((s, i) => chunks[i % W].push(s));
      await Promise.all(workers.map((w, i) => new Promise(r => { w.once('message', r); w.postMessage(chunks[i]); })));
      process.stdout.write(`pop ${p}: ${st.length} states, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    }
    console.log('states', tot, 'optimal expected score', V[idx(0, 0, 0)].toFixed(4));
    fs.writeFileSync(path.join(require('os').tmpdir(), 'yacht-vtable.bin'), Buffer.from(sab));
    workers.forEach(w => w.terminate());
  })();
}
