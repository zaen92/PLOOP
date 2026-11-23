/* Ploop 테스트용 로컬 서버
 *  - 저장소 루트를 /PLOOP/ 경로로 서빙 (GitHub Pages와 같은 하위 경로)
 *  - /__fb/* : 메모리 안의 가짜 Firestore 백엔드. 여러 브라우저(컨텍스트)가 같은 데이터를 공유해요.
 *    실제 Firebase에는 절대 연결하지 않아요. (브라우저 쪽 SDK는 tests/fbmock.js로 바꿔치기)
 *  사용: node tests/server.js [port]   → http://127.0.0.1:8790/PLOOP/
 *  환경변수 OLD_HTML=파일경로 를 주면 /PLOOP/old.html 로 그 파일을 서빙 (이전 버전 호환 테스트용)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".css": "text/css" };

// ---- fake Firestore store: path -> {data, v} ----
const store = new Map();
let version = 0;
const clients = new Set();
const parentOf = p => p.split("/").slice(0, -1).join("/");
function broadcast(paths) {
  const msg = `data: ${JSON.stringify({ paths })}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch (e) {} }
}
function applyUpdate(data, upd) {
  const out = JSON.parse(JSON.stringify(data));
  for (const [k, v] of Object.entries(upd)) {
    const parts = k.split(".");
    let o = out;
    for (let i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== "object" || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]]; }
    const last = parts[parts.length - 1];
    if (v && typeof v === "object" && v.__del === 1) delete o[last]; else o[last] = v;
  }
  return out;
}
function commit(ops, reads) {
  for (const [p, v] of Object.entries(reads || {})) {
    const cur = store.get(p);
    if ((cur ? cur.v : 0) !== v) return { status: 409, body: { code: "aborted" } };
  }
  for (const op of ops) if (op.op === "update" && !store.has(op.path)) return { status: 404, body: { code: "not-found" } };
  const changed = [];
  for (const op of ops) {
    version++;
    if (op.op === "set") store.set(op.path, { data: op.data, v: version });
    else if (op.op === "update") store.set(op.path, { data: applyUpdate(store.get(op.path).data, op.data), v: version });
    else if (op.op === "delete") store.delete(op.path);
    changed.push(op.path);
  }
  if (changed.length) broadcast(changed);
  return { status: 200, body: { ok: true } };
}
const readBody = req => new Promise(r => { let b = ""; req.on("data", c => (b += c)); req.on("end", () => r(b ? JSON.parse(b) : {})); });
const send = (res, status, obj) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };

async function fb(req, res, u) {
  const op = u.pathname.slice("/__fb/".length);
  const q = u.searchParams;
  if (op === "events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    res.write(": hi\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (op === "get") { const d = store.get(q.get("path")); return send(res, 200, d ? { exists: true, data: d.data, v: d.v } : { exists: false, v: 0 }); }
  if (op === "list") {
    const col = q.get("path"), lim = +q.get("limit") || 0;
    let docs = [...store.entries()].filter(([p]) => parentOf(p) === col).map(([p, d]) => ({ id: p.split("/").pop(), data: d.data }));
    if (lim) docs = docs.slice(0, lim);
    return send(res, 200, { docs });
  }
  if (op === "commit") { const b = await readBody(req); const r = commit(b.ops || [], b.reads); return send(res, r.status, r.body); }
  // test helpers
  if (op === "dump") return send(res, 200, Object.fromEntries([...store.entries()].map(([p, d]) => [p, d.data])));
  if (op === "reset") { store.clear(); return send(res, 200, { ok: true }); }
  if (op === "seed") { const b = await readBody(req); for (const [p, d] of Object.entries(b)) { version++; store.set(p, { data: d, v: version }); } broadcast(Object.keys(b)); return send(res, 200, { ok: true }); }
  send(res, 404, { code: "unknown" });
}

function start(port = 8790) {
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/__fb/")) return fb(req, res, u);
    if (u.pathname === "/" ) { res.writeHead(302, { Location: "/PLOOP/" }); return res.end(); }
    if (!u.pathname.startsWith("/PLOOP/")) { res.writeHead(404); return res.end("not found"); }
    let rel = decodeURIComponent(u.pathname.slice("/PLOOP/".length)) || "index.html";
    if (rel.endsWith("/")) rel += "index.html";   // 폴더 주소(/privacy/)는 GitHub Pages처럼 index.html로
    let file = path.join(ROOT, rel);
    if (rel === "old.html" && process.env.OLD_HTML) file = process.env.OLD_HTML;
    if (rel === "fbmock.js") file = path.join(__dirname, "fbmock.js");
    if (!file.startsWith(ROOT) && file !== process.env.OLD_HTML) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(buf);
    });
  });
  return new Promise(r => server.listen(port, "127.0.0.1", () => r(server)));
}
module.exports = { start, store };
if (require.main === module) start(+process.argv[2] || 8790).then(() => console.log("http://127.0.0.1:" + (+process.argv[2] || 8790) + "/PLOOP/"));
