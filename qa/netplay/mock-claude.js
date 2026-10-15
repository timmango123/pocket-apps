/* Test double for window.claude with `room` and `user`, linking every page of one origin through BroadcastChannel.
   Inject with page.addInitScript after setting window.__mockUser = 'alice'. Mirrors the contract's shape:
   presence/peers/onPeers/onConnection/join/leave; nothing persists. window.__mockNet.drop(true) simulates a cut. */
(function () {
  var uid = window.__mockUser || ('u' + Math.random().toString(36).slice(2, 7));
  var peer = Math.random().toString(36).slice(2, 12);
  var bc = new BroadcastChannel('mock-claude-room'), dropped = false;
  var rooms = {};
  function send(msg) { if (!dropped) bc.postMessage(msg); }
  function mkRoom(name) {
    var R = { name: name, me: {}, others: {}, peerL: [], connL: [], snap: null, joined: true };
    function snapshot() {
      var list = [{ peer: peer, by: uid, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: Object.freeze(Object.assign({}, R.me)), updatedAt: Date.now() }];
      Object.keys(R.others).forEach(function (k) { list.push(R.others[k]); });
      R.snap = Object.freeze(list); return R.snap;
    }
    var pending = false;
    function notify() {
      snapshot(); if (pending) return; pending = true;
      setTimeout(function () { pending = false; R.peerL.forEach(function (f) { f({ peers: R.snap, joined: [], left: [], updated: [] }); }); }, 5);
    }
    R.notify = notify; snapshot();
    R.api = {
      name: name,
      presence: function (patch) {
        Object.keys(patch).forEach(function (k) { if (patch[k] === null || patch[k] === undefined) delete R.me[k]; else R.me[k] = JSON.parse(JSON.stringify(patch[k])); });
        if (JSON.stringify(R.me).length > 4096) return Promise.reject({ code: 'invalid_argument', message: 'presence over 4 KiB' });
        send({ t: 'pres', room: name, peer: peer, by: uid, p: R.me }); notify(); return Promise.resolve();
      },
      peers: function () { return R.snap; },
      onPeers: function (f) { R.peerL.push(f); setTimeout(function () { f({ peers: R.snap, joined: R.snap, left: [], updated: [] }); }, 0); return function () { R.peerL = R.peerL.filter(function (x) { return x !== f; }); }; },
      connected: function () { return !dropped; },
      onConnection: function (f) { R.connL.push(f); setTimeout(function () { f(!dropped); }, 0); return function () { R.connL = R.connL.filter(function (x) { return x !== f; }); }; },
      emit: function () { return Promise.resolve(); }, on: function () { return function () {}; },
      leave: function () { R.joined = false; delete rooms[name]; send({ t: 'bye', room: name, peer: peer }); return Promise.resolve(); }
    };
    rooms[name] = R;
    send({ t: 'hello', room: name, peer: peer, by: uid, p: R.me });
    return R;
  }
  bc.onmessage = function (e) {
    if (dropped) return;
    var m = e.data, R = rooms[m.room]; if (!R || m.peer === peer) return;
    if (m.t === 'bye') { delete R.others[m.peer]; R.notify(); return; }
    R.others[m.peer] = Object.freeze({ peer: m.peer, by: m.by, isMe: m.by === uid, sameTab: false, kind: 'viewer', guest: false, presence: Object.freeze(m.p || {}), updatedAt: Date.now() });
    if (m.t === 'hello') send({ t: 'pres', room: m.room, peer: peer, by: uid, p: R.me });
    R.notify();
  };
  window.addEventListener('pagehide', function () { Object.keys(rooms).forEach(function (n) { send({ t: 'bye', room: n, peer: peer }); }); });
  var lobby = mkRoom('');
  var roomNs = Object.assign({}, lobby.api, { join: function (name) { return Promise.resolve((rooms[name] || mkRoom(name)).api); } });
  var userNs = {
    id: function () { return Promise.resolve(uid); },
    profiles: function (ids) { var o = {}; [].concat(ids).forEach(function (id) { o[id] = { id: id, name: id ? id.charAt(0).toUpperCase() + id.slice(1) : '', avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', color: '#888', email: null, isMe: id === uid, guest: false }; }); return Promise.resolve(o); },
    isOwner: function () { return Promise.resolve(true); }, canEdit: function () { return Promise.resolve(true); }
  };
  window.claude = { use: function (n) { return Promise.resolve(n === 'room' ? roomNs : n === 'user' ? userNs : null); } };
  window.__mockNet = {
    drop: function (v) {
      dropped = v;
      Object.keys(rooms).forEach(function (n) {
        var R = rooms[n];
        if (v) { R.others = {}; R.notify(); }
        else send({ t: 'hello', room: n, peer: peer, by: uid, p: R.me });
        R.connL.forEach(function (f) { f(!v); });
      });
    }
  };
})();
