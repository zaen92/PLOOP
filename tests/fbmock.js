/* 가짜 Firebase compat SDK (테스트 전용)
 * 앱이 쓰는 만큼만 흉내 내요: doc/collection/get/set/update/delete/onSnapshot/limit/runTransaction/
 * disableNetwork/enableNetwork, FieldValue.delete.
 * 데이터는 테스트 서버(tests/server.js)의 /__fb/* 메모리 저장소로 가요. 실제 Firebase에는 연결하지 않아요.
 */
(function () {
  "use strict";
  const BASE = "/__fb/";
  const err = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
  const DEL = { __del: 1 };
  const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  async function call(op, params, body) {
    const qs = params ? "?" + new URLSearchParams(params) : "";
    const r = await fetch(BASE + op + qs, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const j = await r.json();
    if (r.status === 404) throw err("not-found");
    if (r.status === 409) throw err("aborted");
    if (!r.ok) throw err("unknown");
    return j;
  }
  const docSnap = (id, data) => ({ id, exists: data !== undefined, data: () => clone(data) });
  const listeners = new Set();
  let es = null;
  function ensureEvents() {
    if (es) return;
    es = new EventSource(BASE + "events");
    es.onmessage = ev => {
      const { paths } = JSON.parse(ev.data);
      const cols = new Set(paths.map(p => p.split("/").slice(0, -1).join("/")));
      for (const l of listeners) if (cols.has(l.path)) l.fire();
    };
  }
  class DocRef {
    constructor(path) { this.path = path; this.id = path.split("/").pop(); }
    async get() { const j = await call("get", { path: this.path }); return docSnap(this.id, j.exists ? j.data : undefined); }
    set(data) { return call("commit", null, { ops: [{ op: "set", path: this.path, data: clone(data) }] }).then(() => {}); }
    update(data) { return call("commit", null, { ops: [{ op: "update", path: this.path, data: clone(data) }] }).then(() => {}); }
    delete() { return call("commit", null, { ops: [{ op: "delete", path: this.path }] }).then(() => {}); }
  }
  class ColRef {
    constructor(path, lim) { this.path = path; this.lim = lim || 0; }
    limit(n) { return new ColRef(this.path, n); }
    doc(id) { return new DocRef(this.path + "/" + id); }
    async get() {
      const j = await call("list", { path: this.path, limit: this.lim });
      const docs = j.docs.map(d => docSnap(d.id, d.data));
      return { docs, empty: !docs.length, size: docs.length, metadata: { fromCache: false, hasPendingWrites: false } };
    }
    onSnapshot(opts, next, onErr) {
      if (typeof opts === "function") { onErr = next; next = opts; }
      ensureEvents();
      const l = { path: this.path, alive: true, seq: 0 };
      l.fire = () => {
        const s = ++l.seq;
        this.get().then(snap => { if (l.alive && s === l.seq) next(snap); }, e => { if (l.alive && onErr) onErr(e); });
      };
      listeners.add(l);
      setTimeout(l.fire, 0);
      return () => { l.alive = false; listeners.delete(l); };
    }
  }
  function makeFirestore() {
    return {
      doc: p => new DocRef(p),
      collection: p => new ColRef(p),
      async runTransaction(fn) {
        for (let i = 0; i < 8; i++) {
          const reads = {}, ops = [];
          const tx = {
            async get(ref) { const j = await call("get", { path: ref.path }); reads[ref.path] = j.v || 0; return docSnap(ref.id, j.exists ? j.data : undefined); },
            set(ref, data) { ops.push({ op: "set", path: ref.path, data: clone(data) }); return tx; },
            update(ref, data) { ops.push({ op: "update", path: ref.path, data: clone(data) }); return tx; },
            delete(ref) { ops.push({ op: "delete", path: ref.path }); return tx; }
          };
          const out = await fn(tx);
          try { await call("commit", null, { ops, reads }); return out; }
          catch (e) { if (e.code !== "aborted") throw e; }
        }
        throw err("aborted");
      },
      disableNetwork: () => Promise.resolve(),
      enableNetwork: () => { setTimeout(() => listeners.forEach(l => l.fire()), 0); return Promise.resolve(); }
    };
  }
  let fsInst = null;
  const app = { name: "[DEFAULT]", firestore: () => (fsInst = fsInst || makeFirestore()) };
  const firebase = {
    apps: [],
    initializeApp() { if (!firebase.apps.length) firebase.apps.push(app); return app; },
    app() { if (!firebase.apps.length) throw err("no-app"); return app; },
    firestore: Object.assign(() => app.firestore(), { FieldValue: { delete: () => DEL } })
  };
  window.firebase = firebase;
  window.__FBMOCK__ = true;
})();
