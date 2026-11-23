/* 테스트 공용 도구: 서버 시작, 브라우저 컨텍스트(가짜 Firebase 주입 + 실제 DB 차단), 가짜 DB 조회 */
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");
const { start } = require("./server");

const PORT = +process.env.PORT || 8790;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/PLOOP/`;
const MOCK = fs.readFileSync(path.join(__dirname, "fbmock.js"), "utf8");
const blocked = [];   // 실제 Firebase/Google API로 나가려던 요청 (0건이어야 함)

async function newCtx(browser, { mobile = true } = {}) {
  const opts = mobile ? { ...devices["iPhone 13"] } : { viewport: { width: 1280, height: 900 } };
  delete opts.defaultBrowserType;
  const ctx = await browser.newContext({ ...opts, serviceWorkers: "block", locale: "ko-KR", timezoneId: "Asia/Seoul" });
  await ctx.route(/^https:\/\/www\.gstatic\.com\/firebasejs\//, route => {
    const u = route.request().url();
    route.fulfill({ status: 200, contentType: "text/javascript", body: /firebase-app-compat/.test(u) ? MOCK : "/* firestore compat: mocked */" });
  });
  await ctx.route(/googleapis\.com|firebaseio\.com|firebaseapp\.com|firebase\.google\.com/, route => { blocked.push(route.request().url()); route.abort(); });
  await ctx.route(/kakao\.com|kakaocdn\.net/, route => route.abort());
  ctx.on("page", p => p.on("dialog", d => d.accept()));
  return ctx;
}
const api = async (op, body) => {
  const r = await fetch(ORIGIN + "/__fb/" + op, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  return r.json();
};
const dump = () => api("dump");
const reset = () => api("reset", {});
const seed = docs => api("seed", docs);
const roomOf = url => new URL(url).searchParams.get("s");
// 모임 화면이 서버 데이터를 다 받을 때까지(로딩 카드가 사라지고 제목이 보일 때까지)
async function waitRoom(page) {
  await page.waitForFunction(() => !document.body.classList.contains("booting") && !document.body.classList.contains("cached") && !document.body.classList.contains("ro") && !document.querySelector("#tripTitleBtn").hidden, null, { timeout: 15000 });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`);
}
module.exports = { chromium, start, PORT, ORIGIN, BASE, newCtx, dump, reset, seed, roomOf, waitRoom, sleep, check, results, blocked };
