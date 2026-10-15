// Human-like auto-player for 飛刀神射 (knife-target).
// It only "sees" the game through snapshots that are REACTION seconds old,
// and predicts forward using only what a human perceives: the angle and the
// current angular velocity (never the scripted future speed changes).
// Like a person, it learns the target's rhythm from what it has already seen
// (how long the shortest steady phase lasted) and keeps that across retries.
// Used by both sim.js (fast Node tuning) and verify.js (real browser, real taps).
'use strict';
function createBot(K, opts) {
  opts = opts || {};
  var REACTION = opts.reaction != null ? opts.reaction : 0.150; // perception delay (s)
  var HITSTOP = opts.hitstop != null ? opts.hitstop : 0.05;
  var M0 = opts.m0 != null ? opts.m0 : 0.03;          // base safety margin (rad)
  var JIT = opts.jit != null ? opts.jit : 0.02;       // timing jitter (s) -> margin |w|*JIT
  var ACC_BLOCK = opts.accBlock != null ? opts.accBlock : 1.2; // rad/s^2: clearly changing speed -> wait
  var ACC_STABLE = 0.35;                              // below this the spin looks steady
  var ACC_K = opts.accK != null ? opts.accK : 0.05;
  var hist = [];
  var lastSend = -1e9, pendingSend = null;
  var latEst = opts.latInit != null ? opts.latInit : 0.03;
  var lats = [], latJit = 0; // own input latency (learned, like a player getting used to a device)
  // learned rhythm (persists across retries of the same level)
  var holds = { move: [], stop: [] };
  var run = null; // current steady run as perceived: {start, cls}
  function snapAt(t) {
    for (var i = hist.length - 1; i >= 0; i--) if (hist[i].t <= t) return hist[i];
    return null;
  }
  function minHold(cls) {
    var a = holds[cls];
    if (!a.length) return null;
    var m = Infinity; for (var i = 0; i < a.length; i++) if (a[i] < m) m = a[i];
    return m;
  }
  function track(s) {
    // classify steadiness using the perceived snapshot stream (runs on the delayed stream)
    var P = snapAt(s.t - 0.06);
    if (!P || s.t - P.t < 0.03) return;
    var acc = Math.abs((s.omega - P.omega) / (s.t - P.t));
    var cls = Math.abs(s.omega) < 0.05 ? 'stop' : 'move';
    if (acc < ACC_STABLE) {
      if (!run || run.cls !== cls) run = { start: s.t, cls: cls, complete: !!run || s.t > 0.3 };
    } else if (run) {
      var dur = s.t - run.start;
      if (run.complete && dur > 0.1) holds[run.cls].push(dur + 0.05);
      run = null;
    }
  }
  var seen = 0; // index of hist already passed to track (as perceived with delay)
  return {
    observe: function (s) {
      hist.push(s);
      if (hist.length > 600) { var cut = hist.length - 400; hist.splice(0, cut); seen = Math.max(0, seen - cut); }
      if (pendingSend != null && s.throwT != null && s.throwT >= pendingSend - 0.001) {
        var lat = s.throwT - pendingSend;
        if (lat >= 0 && lat < 0.4) {
          lats.push(lat); if (lats.length > 11) lats.shift();
          var srt = lats.slice().sort(function (a, b) { return a - b; });
          latEst = srt[srt.length >> 1];
          var dev = 0; for (var q = 0; q < lats.length; q++) dev += Math.abs(lats[q] - latEst);
          latJit = Math.min(0.06, dev / lats.length);
        }
        pendingSend = null;
      }
    },
    newAttempt: function () { hist = []; seen = 0; run = null; lastSend = -1e9; pendingSend = null; },
    latency: function () { return latEst; },
    latencyJitter: function () { return latJit; },
    learned: function () { return { move: minHold('move'), stop: minHold('stop') }; },
    decide: function (now) {
      // feed the perception tracker only with what is at least REACTION old
      while (seen < hist.length && hist[seen].t <= now - REACTION) track(hist[seen++]);
      var S = snapAt(now - REACTION);
      if (!S || S.state !== 'play' || !S.canThrow) return false;
      if (S.t < lastSend + latEst + K.FLIGHT + HITSTOP + 0.02) return false; // my last knife must be seen landing
      var P = snapAt(S.t - 0.1);
      if (!P || S.t - P.t < 0.05) return false;
      var acc = (S.omega - P.omega) / (S.t - P.t);
      if (Math.abs(acc) > ACC_BLOCK) return false;
      if (Math.abs(acc) >= ACC_STABLE || !run) {
        // it is changing speed: only throw while the change is clearly settling down
        var Q = snapAt(P.t - 0.06);
        if (!Q || P.t - Q.t < 0.03) return false;
        var accPrev = (P.omega - Q.omega) / (P.t - Q.t);
        if (Math.abs(acc) >= Math.abs(accPrev) * 0.8) return false;
      }
      var h = (now - S.t) + latEst + K.FLIGHT;
      var margin = M0 + Math.abs(S.omega) * (JIT + latJit) + Math.abs(acc) * ACC_K;
      if (run && Math.abs(acc) < ACC_STABLE) {
        var mh = minHold(run.cls);
        var age0 = S.t - run.start;
        if (mh == null && age0 < 2.0) mh = run.cls === 'stop' ? 0.35 : 0.75; // prior guess before anything was seen
        if (mh != null) {
          var ageAtLanding = (S.t - run.start) + h;
          if (ageAtLanding > mh * 0.92) return false; // a change is probably coming, wait for the next steady phase
        }
      }
      var pred = S.theta + S.omega * h;
      var local = K.norm(K.LAUNCH - pred);
      var clear = 9;
      for (var i = 0; i < S.knives.length; i++) {
        var d = Math.abs(K.angDiff(local, S.knives[i]));
        if (d < clear) clear = d;
      }
      if (clear >= K.COLLIDE + margin) { if (typeof process !== 'undefined' && process.env.BOTDBG) console.log('throw now', now.toFixed(3), 'S.t', S.t.toFixed(3), 'acc', acc.toFixed(2), 'run', run && JSON.stringify(run), 'mh', JSON.stringify(holds)); lastSend = now; pendingSend = now; return true; }
      return false;
    }
  };
}
if (typeof module !== 'undefined') module.exports = { createBot: createBot };
