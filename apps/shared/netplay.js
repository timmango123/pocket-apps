/* NETPLAY — two-player online play over the Artifact `room` capability (presence only, no db).
   Each seated player publishes its whole move list as presence in a named room; the other side adopts the
   longer list after checking every move with the game's own rules. Presence is re-sent on reconnect and handed
   to late joiners, so a dropped message or a reload loses nothing. Works for Viewers (presence needs no topic
   rights). The page must work without it: NET stays hidden when `room` is unavailable.

   Adapter passed to NET.init:
     game        id used in room names, e.g. 'gomoku'
     title       shown in the panel
     sides       [label of side 0 (moves first), label of side 1]
     choices     [{key, label, items:[[value, text], ...], def}]  host options (rendered as segmented buttons)
     start(o, side, mv)  reset into online mode with options o; side 0|1, or -1 to spectate; replay mv silently.
                         return the number of moves that replayed legally
     play(m)     apply one opponent move with normal feedback; return false if illegal
     toMove()    0|1 for the side to move, -1 when the game is over
     exit()      leave online mode (back to the game's title screen)
     resigned(side)  optional: side resigned (called for the local player's own resignation too), show the result
     busy()      optional: true while an animation must finish before the next local move
     names(n0, n1)   optional: display names for side 0 and side 1 ('你' for the local player)
     onStatus(text)  optional: where the status line goes (default: a small pill)
     snapshot(), randomMove()  test hooks: board as a string, play one random legal move for the local side
   Game calls: NET.moved(m) after a local move in online mode (never from inside play() or start(): the module appends
   the opponent's move only after play() returns, so a pass owed after it must be sent a tick later); NET.open() from its 連線對戰 button;
   NET.rematch() from its result screen; NET.active(), NET.mySide(), NET.canMove(). */
var NET = (function () {
  'use strict';
  var A = null, room = null, user = null, lobby = null, rm = null, unsub = [], ok = false;
  var S = null;           // session: {code, seat:'h'|'j'|'s', t, g, mv, o, f, want, rs}
  var opp = null, host = null, myId = null, names = {}, lastStatus = '', waiting = false;
  var CH = 'abcdefghjkmnpqrstuvwxyz23456789';
  var LSK = function () { return 'netplay.' + A.game + (myId ? '.' + String(myId).slice(0, 40) : ''); };
  function sget() { try { var v = JSON.parse(localStorage.getItem(LSK()) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } }
  function sset() { try { if (S && S.seat !== 's') localStorage.setItem(LSK(), JSON.stringify(S)); } catch (e) {} }
  function sdel() { try { localStorage.removeItem(LSK()); } catch (e) {} }
  function mkCode() { var s = ''; for (var i = 0; i < 4; i++) s += CH[(Math.random() * CH.length) | 0]; return s; }
  function rname(code) { return (A.game + '-' + code).toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 48); }
  function validMv(mv) {
    if (!Array.isArray(mv) || mv.length > 800) return false;
    for (var i = 0; i < mv.length; i++) { var m = mv[i]; if (!(typeof m === 'number' && isFinite(m)) && !(typeof m === 'string' && m.length <= 16)) return false; }
    return true;
  }
  function validOpts(o) {
    if (!o || typeof o !== 'object') return false;
    for (var i = 0; i < A.choices.length; i++) {
      var c = A.choices[i], v = o[c.key];
      if (!c.items.some(function (it) { return it[0] === v; })) return false;
    }
    return true;
  }
  function sideOf(seat, g) { if (seat === 's') return -1; var hs = (S.f ^ (g & 1)); return seat === 'h' ? hs : 1 - hs; }
  function mySide() { return S ? sideOf(S.seat, S.g) : -1; }
  function same(a, b, n) { for (var i = 0; i < n; i++) if (a[i] !== b[i]) return false; return true; }

  /* ---------- styles + panel ---------- */
  var css = '.np-ov{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,8,20,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font-family:system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif;--np-bg:#161b2e;--np-ink:#eef1fb;--np-ink2:#9aa3c2;--np-line:rgba(255,255,255,.12);--np-chip:rgba(255,255,255,.07);--np-acc:#ffb347;--np-acc2:#ff7a45}' +
    '@media (prefers-color-scheme:light){.np-ov{--np-bg:#fffdf8;--np-ink:#1e2338;--np-ink2:#5f6680;--np-line:rgba(20,30,60,.13);--np-chip:rgba(20,30,60,.06);--np-acc:#d9822b;--np-acc2:#e0562a;background:rgba(40,40,70,.3)}}' +
    '.np-card{width:min(420px,100%);max-height:100%;overflow:auto;background:var(--np-bg);color:var(--np-ink);border:1px solid var(--np-line);border-radius:22px;padding:18px 16px;box-shadow:0 20px 60px rgba(0,0,0,.4);overscroll-behavior:contain}' +
    '.np-card h2{margin:0 0 4px;font-size:21px;text-align:center;letter-spacing:2px}.np-card h3{margin:14px 0 6px;font-size:13px;color:var(--np-ink2);font-weight:600}' +
    '.np-card p{margin:6px 0;font-size:13.5px;line-height:1.55;color:var(--np-ink2)}.np-card p b{color:var(--np-ink)}' +
    '.np-seg{display:flex;gap:4px;background:var(--np-chip);border-radius:12px;padding:4px}.np-seg button{flex:1;min-width:0;min-height:42px;border:0;border-radius:9px;background:none;color:var(--np-ink2);font:inherit;font-size:14px;font-weight:600}' +
    '.np-seg button.on{background:var(--np-bg);color:var(--np-ink);outline:2px solid var(--np-acc);outline-offset:-2px}' +
    '.np-btn{display:block;width:100%;min-height:50px;margin-top:10px;border:0;border-radius:14px;font:inherit;font-size:16px;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--np-acc2),var(--np-acc));cursor:pointer}' +
    '.np-btn.sec{background:var(--np-chip);color:var(--np-ink);font-size:15px}.np-btn[disabled]{opacity:.4}' +
    '.np-row{display:flex;gap:8px}.np-row>*{flex:1;min-width:0}' +
    '.np-code{font:800 40px/1.1 ui-monospace,Menlo,monospace;letter-spacing:10px;text-align:center;margin:8px 0 2px;color:var(--np-acc)}' +
    '.np-in{width:100%;min-height:48px;border-radius:12px;border:1px solid var(--np-line);background:var(--np-chip);color:var(--np-ink);font:700 22px ui-monospace,Menlo,monospace;letter-spacing:6px;text-align:center;text-transform:uppercase}' +
    '.np-list{display:flex;flex-direction:column;gap:6px}.np-item{display:flex;align-items:center;gap:10px;min-height:52px;padding:6px 10px;border-radius:12px;background:var(--np-chip);border:0;color:var(--np-ink);font:inherit;text-align:left;width:100%;cursor:pointer}' +
    '.np-item img{width:30px;height:30px;border-radius:50%;flex:none}.np-item span{flex:1;min-width:0}.np-item b{display:block;font-size:14.5px}.np-item small{display:block;font-size:12px;color:var(--np-ink2)}.np-item i{font-style:normal;font-weight:700;color:var(--np-acc)}' +
    '.np-pl{display:flex;gap:8px;margin-top:6px}.np-pl div{flex:1;min-width:0;padding:8px;border-radius:12px;background:var(--np-chip);font-size:13px;text-align:center}.np-pl b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.np-x{float:right;width:44px;height:44px;margin:-10px -8px 0 0;border:0;background:none;color:var(--np-ink2);font-size:24px;cursor:pointer}' +
    '.np-pill{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 4px);transform:translateX(-50%);z-index:2147482000;max-width:88vw;padding:5px 12px;border-radius:20px;background:rgba(12,16,34,.86);color:#eef3ff;font:600 12.5px system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:auto;cursor:pointer;border:1px solid rgba(255,255,255,.18)}' +
    '.np-pill.warn{background:rgba(120,60,10,.9)}';
  var ov = null, pill = null;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function ensureCss() { if (document.getElementById('np-css')) return; var s = el('style'); s.id = 'np-css'; s.textContent = css; document.head.appendChild(s); }
  function closePanel() { if (ov) { ov.remove(); ov = null; } lobbyFn = null; }
  function panel(build) {
    ensureCss(); closePanel();
    ov = el('div', 'np-ov'); var c = el('div', 'np-card'); ov.appendChild(c);
    ov.addEventListener('click', function (e) { if (e.target === ov) closePanel(); });
    var x = el('button', 'np-x', '×'); x.setAttribute('aria-label', '關閉'); x.onclick = closePanel; c.appendChild(x);
    c.appendChild(el('h2', null, '連線對戰'));
    build(c); document.body.appendChild(ov);
  }
  function btn(parent, text, cls, fn) { var b = el('button', 'np-btn' + (cls ? ' ' + cls : ''), text); b.onclick = fn; parent.appendChild(b); return b; }
  function seg(parent, items, cur, fn) {
    var s = el('div', 'np-seg');
    items.forEach(function (it) { var b = el('button', it[0] === cur ? 'on' : '', it[1]); b.onclick = function () { [].forEach.call(s.children, function (x) { x.className = ''; }); b.className = 'on'; fn(it[0]); }; s.appendChild(b); });
    parent.appendChild(s); return s;
  }
  function optText(o) { return A.choices.map(function (c) { var it = c.items.filter(function (x) { return x[0] === o[c.key]; })[0]; return it ? it[1] : ''; }).filter(Boolean).join('・'); }

  /* ---------- names ---------- */
  function resolveNames(ids) {
    if (!user || !user.profiles) return Promise.resolve();
    ids = ids.filter(Boolean); if (!ids.length) return Promise.resolve();
    return user.profiles(ids).then(function (ps) { ids.forEach(function (id) { if (ps[id]) names[id] = ps[id]; }); }).catch(function () {});
  }
  function nameOf(p, fb) { var id = p && (p.by || (p.presence && p.presence.id)); var n = id && names[id] && names[id].name; return n || fb; }

  /* ---------- lobby: hosts waiting for an opponent ---------- */
  var lobbyFn = null, lobbyUnsub = null;
  function openRooms() {
    if (!lobby) return [];
    return lobby.peers().filter(function (p) {
      var l = p.presence && p.presence.lob; return !p.sameTab && l && l.g === A.game && typeof l.c === 'string' && /^[a-z0-9]{4}$/.test(l.c);
    });
  }
  function setLobby(on) { if (lobby) lobby.presence({ lob: on && S ? { g: A.game, c: S.code, o: optText(S.o).slice(0, 60), t: S.t } : null }).catch(function () {}); }

  /* ---------- room ---------- */
  function me() { return { nv: 1, seat: S.seat, t: S.t, g: S.g, mv: S.mv, o: S.seat === 'h' ? S.o : undefined, f: S.seat === 'h' ? S.f : undefined, want: S.want || 0, rs: S.rs == null ? -1 : S.rs, id: myId || undefined }; }
  function push() { if (rm && S) { rm.presence(me()).catch(function () {}); sset(); } }
  function seated(seat) {
    var best = null;
    rm.peers().forEach(function (p) {
      var q = p.presence; if (!q || q.nv !== 1 || q.seat !== seat || typeof q.t !== 'number') return;
      // equal claim times mean the same seat reopened (a reload leaves its old tab behind for a moment): this tab wins
      if (!best || q.t < best.presence.t || (q.t === best.presence.t && (p.sameTab || (!best.sameTab && p.peer < best.peer)))) best = p;
    });
    return best;
  }
  function join(code, seat, saved) {
    code = String(code || '').toLowerCase();
    if (!/^[a-z0-9]{4}$/.test(code)) return Promise.reject(new Error('房間碼要 4 個字'));
    return leaveRoom().then(function () { return room.join(rname(code)); }).then(function (r) {
      rm = r;
      S = saved || { code: code, seat: seat, t: Date.now(), g: 0, mv: [], o: null, f: 0, want: 0, rs: -1 };
      if (seat === 'h' && !saved) { S.o = A._newOpts; S.f = A._newFirst; }
      unsub.push(rm.onPeers(function () { sync(); }, function () { status('連線中斷，重新整理頁面後可回到房間', 'warn'); }));
      unsub.push(rm.onConnection(function (c) { if (c) push(); sync(); }));
      if (S.o) begin(false);
      push(); setLobby(S.seat === 'h'); sync();
    });
  }
  function leaveRoom() {
    unsub.forEach(function (u) { try { u(); } catch (e) {} }); unsub = [];
    var r = rm; rm = null; opp = host = null;
    return r ? r.leave().catch(function () {}) : Promise.resolve();
  }
  var started = false;
  function begin(fresh) {
    var n = A.start(S.o, mySide(), S.mv.slice());
    if (typeof n === 'number' && n < S.mv.length) S.mv.length = n;
    started = true; if (fresh) push();
    showNames();
  }
  function showNames() {
    if (!A.names || !S) return;
    var hs = sideOf('h', S.g), n = [];
    n[hs] = S.seat === 'h' ? '你' : nameOf(host, '房主');
    n[1 - hs] = S.seat === 'j' ? '你' : nameOf(seated('j'), S.seat === 'h' ? '對手' : '加入者');
    A.names(n[0], n[1]);
  }
  function adopt(list) { // rebuild from a full list (spectators and divergence)
    S.mv = list.slice(); begin(false);
  }
  function sync() {
    if (!rm || !S) return;
    host = seated('h');
    var j = seated('j');
    // seat contention: whoever claimed first keeps the seat
    if (S.seat !== 's') {
      var holder = S.seat === 'h' ? host : j;
      if (holder && !holder.sameTab) { S.seat = 's'; status('座位已有人，改為觀戰'); push(); sdel(); }
    }
    opp = S.seat === 'h' ? j : S.seat === 'j' ? host : null;
    var hp = host && host.presence;
    // options come from the host
    if (!S.o && hp && validOpts(hp.o) && (hp.f === 0 || hp.f === 1)) { S.o = hp.o; S.f = hp.f; begin(true); }
    if (!S.o) { status(S.seat === 'j' ? '等房主連線…' : '連線中…'); return; }
    if (S.seat === 'h') setLobby(!j);
    if (waiting && opp) { waiting = false; closePanel(); resolveNames([opp.by || (opp.presence && opp.presence.id)]).then(function () { toastPill(nameOf(opp, '朋友') + ' 加入了'); }); }
    var ids = rm.peers().map(function (p) { return p.by || (p.presence && p.presence.id); });
    resolveNames(ids).then(showNames);
    if (S.seat === 's') { spectate(host, j); return; }
    var op = opp && opp.presence;
    if (!op || op.nv !== 1 || !validMv(op.mv) || typeof op.g !== 'number') { report(); return; }
    // rematch: both asked for the next game, or the opponent already moved on
    if (op.g > S.g || (S.want > S.g && op.want > S.g)) {
      S.g = op.g > S.g ? op.g : S.g + 1; S.mv = []; S.rs = -1; S.want = Math.max(S.want, S.g);
      begin(true); toastPill('新的一局：你執' + A.sides[mySide()]);
    }
    if (op.g === S.g) {
      if (op.rs === S.g && S.rs !== S.g && !S.oppRs) { S.oppRs = S.g; if (A.resigned) A.resigned(1 - mySide()); }
      var om = op.mv, mm = S.mv;
      if (om.length > mm.length && same(om, mm, mm.length)) {
        var side = 1 - mySide();
        for (var i = mm.length; i < om.length; i++) {
          if (A.toMove() !== side) break;
          if (A.play(om[i]) === false) break;
          S.mv.push(om[i]);
        }
        push();
      } else if (!same(om, mm, Math.min(om.length, mm.length)) && S.seat === 'j' && op.seat === 'h') {
        adopt(om); push();
      }
    }
    report();
  }
  function spectate(h, j) {
    var best = null;
    [h, j].forEach(function (p) { var q = p && p.presence; if (q && q.nv === 1 && validMv(q.mv) && typeof q.g === 'number' && (!best || q.g > best.g || (q.g === best.g && q.mv.length > best.mv.length))) best = q; });
    if (best) {
      if (best.g !== S.g || best.mv.length < S.mv.length || !same(best.mv, S.mv, S.mv.length)) { S.g = best.g; adopt(best.mv); }
      else for (var i = S.mv.length; i < best.mv.length; i++) { if (A.play(best.mv[i]) === false) break; S.mv.push(best.mv[i]); }
    }
    [['h', h], ['j', j]].forEach(function (x) { var q = x[1] && x[1].presence; if (q && q.g === S.g && q.rs === S.g && S.oppRs !== S.g) { S.oppRs = S.g; if (A.resigned) A.resigned(sideOf(x[0], S.g)); } });
    status('觀戰中：' + nameOf(h, '房主') + ' 對 ' + nameOf(j, '對手'));
  }
  function report() {
    if (!S) return;
    if (!opp) {
      if (S.seat === 'h' && !S.mv.length && S.g === 0) status('房間 ' + S.code.toUpperCase() + '：等朋友加入…');
      else status('對手離線，等他回來（房間 ' + S.code.toUpperCase() + '）', 'warn');
      return;
    }
    var t = A.toMove(), side = mySide();
    if (S.rs === S.g || S.oppRs === S.g || t < 0) {
      var op = opp.presence || {};
      if (S.want > S.g) status('等對手同意再來一局…');
      else if (op.want > S.g) status('對手想再來一局', 'warn');
      else status('對局結束');
    } else status(t === side ? '輪到你（' + A.sides[side] + '）' : '等對手下（' + nameOf(opp, '對手') + '）');
  }

  /* ---------- status pill ---------- */
  var pillT = 0;
  function status(text, kind) {
    lastStatus = text;
    if (A.onStatus) { A.onStatus(text, kind || ''); return; }
    ensureCss();
    if (!pill) { pill = el('div', 'np-pill'); pill.onclick = function () { NET.open(); }; document.body.appendChild(pill); }
    pill.textContent = '🌐 ' + text; pill.className = 'np-pill' + (kind ? ' ' + kind : ''); pill.hidden = false;
  }
  function toastPill(t) { status(t); clearTimeout(pillT); pillT = setTimeout(report, 2500); }

  /* ---------- panels ---------- */
  function homePanel() {
    panel(function (c) {
      c.appendChild(el('p', null, A.title + '：和同時開著這個頁面的朋友即時對下。朋友要能開啟這個頁面並登入 claude.ai（從分享選單邀請他）。'));
      var saved = sget();
      if (saved && saved.code && Date.now() - (saved.t || 0) < 864e5) btn(c, '回到房間 ' + String(saved.code).toUpperCase(), '', function () { closePanel(); join(saved.code, saved.seat, saved).catch(fail); });
      var list = el('div', 'np-list'); c.appendChild(el('h3', null, '等人加入的房間')); c.appendChild(list);
      function fill() {
        list.textContent = '';
        var rs = openRooms();
        if (!rs.length) { list.appendChild(el('p', null, '目前沒有。可以自己建立一個，或輸入朋友給你的房間碼。')); return; }
        rs.forEach(function (p) {
          var l = p.presence.lob, it = el('button', 'np-item'), sp = el('span');
          var id = p.by || ''; var pr = names[id];
          if (pr && pr.avatarUrl) { var im = el('img'); im.src = pr.avatarUrl; im.alt = ''; it.appendChild(im); }
          sp.appendChild(el('b', null, (pr && pr.name) || '有人')); sp.appendChild(el('small', null, String(l.o || '').slice(0, 60) + '・' + l.c.toUpperCase()));
          it.appendChild(sp); it.appendChild(el('i', null, '加入'));
          it.onclick = function () { closePanel(); join(l.c, 'j').catch(fail); };
          list.appendChild(it);
        });
      }
      fill();
      if (lobby) { var ids = openRooms().map(function (p) { return p.by; }); resolveNames(ids).then(function () { if (ov) fill(); }); lobbyFn = function () { if (ov && ov.contains(list)) fill(); }; }
      c.appendChild(el('h3', null, '用房間碼加入'));
      var row = el('div', 'np-row'), inp = el('input', 'np-in'); inp.maxLength = 4; inp.autocomplete = 'off'; inp.autocapitalize = 'characters'; inp.placeholder = '房間碼'; inp.setAttribute('aria-label', '房間碼');
      row.appendChild(inp); var jb = el('button', 'np-btn', '加入'); jb.style.marginTop = '0'; jb.style.flex = '0 0 96px'; row.appendChild(jb); c.appendChild(row);
      jb.onclick = function () { var v = inp.value.trim().toLowerCase(); if (!/^[a-z0-9]{4}$/.test(v)) { inp.focus(); return; } closePanel(); join(v, 'j').catch(fail); };
      c.appendChild(el('h3', null, '建立房間'));
      var o = {}, saveO = {};
      try { saveO = JSON.parse(localStorage.getItem('netplay.' + A.game + '.opts') || '{}') || {}; } catch (e) {}
      A.choices.forEach(function (ch) {
        var v = saveO[ch.key]; if (!ch.items.some(function (it) { return it[0] === v; })) v = ch.def;
        o[ch.key] = v; c.appendChild(el('h3', null, ch.label)); seg(c, ch.items, v, function (nv) { o[ch.key] = nv; });
      });
      var first = saveO._f == null ? 0 : saveO._f;
      c.appendChild(el('h3', null, '我執'));
      seg(c, [[0, A.sides[0] + '（先手）'], [1, A.sides[1] + '（後手）'], [2, '隨機']], first, function (v) { first = v; });
      btn(c, '建立房間', '', function () {
        try { saveO = Object.assign({}, o, { _f: first }); localStorage.setItem('netplay.' + A.game + '.opts', JSON.stringify(saveO)); } catch (e) {}
        A._newOpts = o; A._newFirst = first === 2 ? (Math.random() < 0.5 ? 0 : 1) : first;
        closePanel(); join(mkCode(), 'h').then(function () { waitPanel(); }).catch(fail);
      });
    });
  }
  function waitPanel() {
    waiting = true;
    panel(function (c) {
      c.appendChild(el('p', null, '把房間碼告訴朋友。他打開這個遊戲的「連線對戰」，在清單點你的房間或輸入房間碼就能加入。'));
      c.appendChild(el('div', 'np-code', S.code.toUpperCase()));
      c.appendChild(el('p', null, optText(S.o) + '・你執' + A.sides[mySide()])).style.textAlign = 'center';
      btn(c, '取消房間', 'sec', function () { NET.leave(); });
    });
  }
  function gamePanel() {
    panel(function (c) {
      c.appendChild(el('div', 'np-code', S.code.toUpperCase()));
      c.appendChild(el('p', null, lastStatus)).style.textAlign = 'center';
      var pl = el('div', 'np-pl'), a = el('div'), b = el('div');
      a.appendChild(el('b', null, S.seat === 's' ? nameOf(host, '房主') : '你')); a.appendChild(document.createTextNode(S.seat === 's' ? A.sides[sideOf('h', S.g)] : A.sides[mySide()]));
      var other = S.seat === 's' ? seated('j') : opp;
      b.appendChild(el('b', null, nameOf(other, other ? '對手' : '（還沒有人）'))); b.appendChild(document.createTextNode(S.seat === 's' ? A.sides[sideOf('j', S.g)] : A.sides[1 - mySide()]));
      pl.appendChild(a); pl.appendChild(b); c.appendChild(pl);
      c.appendChild(el('p', null, '規則：' + optText(S.o || {})));
      var over = A.toMove() < 0 || S.rs === S.g || S.oppRs === S.g;
      if (S.seat !== 's' && over && !(S.want > S.g)) btn(c, '再來一局（換邊）', '', function () { NET.rematch(); closePanel(); });
      var row = el('div', 'np-row'); c.appendChild(row);
      if (S.seat !== 's' && A.toMove() >= 0 && S.rs !== S.g && S.oppRs !== S.g) btn(row, '認輸', 'sec', function () { NET.resign(); closePanel(); });
      btn(row, '離開房間', 'sec', function () { NET.leave(); });
      btn(c, '回到棋盤', '', closePanel);
    });
  }
  function fail(e) { status((e && e.message) || '連不上房間', 'warn'); }

  /* ---------- public ---------- */
  var NET = {
    init: function (adapter) {
      A = adapter; var btns = [].concat(A.button || []);
      btns.forEach(function (b) { if (b) b.hidden = true; });
      if (!window.claude || typeof window.claude.use !== 'function') return;
      Promise.all([window.claude.use('room'), window.claude.use('user').catch(function () { return null; })]).then(function (r) {
        room = r[0]; user = r[1]; if (!room || typeof room.join !== 'function') return;
        lobby = room;
        // Inside the hub the room belongs to the hub page, so closing the game must leave explicitly (the saved
        // session stays, so 回到房間 brings the player back).
        window.addEventListener('pagehide', function () { setLobby(false); if (lobbyUnsub) lobbyUnsub(); leaveRoom(); });
        lobbyUnsub = lobby.onPeers(function () { if (lobbyFn) lobbyFn(); }, function () {});
        var idp = user && user.id ? user.id().then(function (id) { myId = id; }).catch(function () {}) : Promise.resolve();
        idp.then(function () {
          ok = true; btns.forEach(function (b) { if (b) b.hidden = false; });
          var saved = sget();
          if (saved && saved.code && Date.now() - (saved.t || 0) < 6 * 36e5 && A.resumeHint) A.resumeHint(String(saved.code).toUpperCase());
        });
      }).catch(function () {});
    },
    available: function () { return ok; },
    open: function () { if (!ok) return; if (rm && S) { if (S.seat === 'h' && !opp && !S.mv.length && S.g === 0) waitPanel(); else gamePanel(); } else homePanel(); },
    active: function () { return !!(rm && S && S.o && started); },
    mySide: mySide,
    canMove: function () { return NET.active() && S.seat !== 's' && A.toMove() === mySide() && S.rs !== S.g && S.oppRs !== S.g && !(A.busy && A.busy()); },
    moved: function (m) { if (!NET.active() || S.seat === 's') return; S.mv.push(m); push(); report(); },
    refresh: function () { report(); },
    rematch: function () { if (!NET.active() || S.seat === 's') return; S.want = S.g + 1; push(); sync(); report(); },
    resign: function () { if (!NET.active() || S.seat === 's') return; S.rs = S.g; push(); if (A.resigned) A.resigned(mySide()); report(); },
    leave: function () {
      closePanel(); setLobby(false); sdel(); started = false;
      var wasActive = !!S; S = null; leaveRoom();
      if (pill) pill.hidden = true;
      if (wasActive && A.exit) A.exit();
    },
    state: function () { return S ? { code: S.code, seat: S.seat, side: mySide(), g: S.g, mv: S.mv.slice(), opp: !!opp, status: lastStatus } : null; },
    _join: function (code, seat, opts, first) { A._newOpts = opts; A._newFirst = first || 0; return join(code, seat); },
    _rooms: function () { return openRooms().map(function (p) { return p.presence.lob.c; }); },
    _defaults: function () { var o = {}; A.choices.forEach(function (c) { o[c.key] = c.def; }); return o; },
    _resume: function () { var s = sget(); return s ? join(s.code, s.seat, s) : Promise.reject(new Error('no saved room')); },
    _random: function () { return NET.canMove() ? A.randomMove() : false; },
    _over: function () { return A.toMove() < 0 || (S && (S.rs === S.g || S.oppRs === S.g)); },
    _snap: function () { return A.snapshot(); }
  };
  return NET;
})();
