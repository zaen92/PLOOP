/* Ploop service worker
 * 업데이트 전략 — 오래된 화면이 남지 않게
 *  1) 화면(HTML) 요청은 항상 네트워크에서 새로 받아요. 캐시에 저장하지 않아요.
 *     → 새 index.html을 올리면 다음에 열 때 바로 새 화면이에요.
 *     → 오프라인일 때만 아래의 "연결이 필요해요" 안내 화면을 보여줘요.
 *  2) 주소에 버전이 박힌 외부 라이브러리(Firebase 10.12.2, Pretendard v1.3.9, html2canvas 1.4.1, xlsx 0.18.5)만
 *     캐시해 두고 바로 꺼내 써요. 버전이 바뀌면 주소가 바뀌니 자동으로 새로 받아요.
 *  3) 아이콘·manifest는 네트워크 먼저, 안 되면 캐시.
 *  4) Firestore·카카오 같은 API 요청은 건드리지 않아요(데이터는 항상 서버와 직접).
 *  5) 새로 배포할 때 VERSION을 바꾸면 이전 캐시를 지우고, 열려 있는 앱에 "새 버전이 나왔어요"가 떠요.
 *     (안 바꿔도 1)번 덕분에 다음 실행부터는 새 화면이에요.)
 *  긴급 해제: 주소 뒤에 ?nosw 를 붙여 한 번 열면 이 서비스 워커가 해제돼요.
 */
const VERSION = "2026-10-29-5";
const CACHE = "ploop-" + VERSION;
const PINNED = [
  /^https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+\//,
  /^https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard@v\d+\.\d+\.\d+\//,
  /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/(html2canvas|xlsx)\/\d+\.\d+\.\d+\//
];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("ploop-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const OFFLINE_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#5B5CF6"><title>Ploop</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FBFAFF;color:#191F28;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;padding:24px;box-sizing:border-box;text-align:center}
.b{max-width:340px}.i{width:72px;height:72px;border-radius:20px;margin:0 auto 18px;display:grid;place-items:center;font-size:34px;font-weight:800;color:#fff;background:linear-gradient(135deg,#7C5CFF,#4F7BFF)}
h1{font-size:21px;margin:0 0 8px}p{margin:0 0 22px;color:#4E5968;line-height:1.6;font-size:15px}button{min-height:52px;width:100%;border:0;border-radius:14px;background:linear-gradient(120deg,#7C5CFF,#4F7BFF);color:#fff;font-size:16px;font-weight:700}</style></head>
<body><div class="b"><div class="i">P</div><h1>인터넷 연결이 필요해요</h1><p>Ploop은 친구들과 같은 데이터를 함께 보기 때문에 연결된 상태에서만 열려요. 연결되면 자동으로 다시 열려요.</p><button onclick="location.reload()">다시 시도</button></div>
<script>addEventListener("online",()=>location.reload())</script></body></html>`;
const offline = () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  // no-cache: ask the server every time (a cheap 304 when unchanged), so GitHub Pages' 10-minute browser cache never shows an old page
  if (req.mode === "navigate") { e.respondWith(fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).catch(offline)); return; }
  if (PINNED.some(re => re.test(req.url))) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") c.put(req, res.clone());
      return res;
    }));
    return;
  }
  const u = new URL(req.url);
  if (u.origin === self.location.origin && /\.(png|json)$/.test(u.pathname)) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || Response.error())));
  }
});
