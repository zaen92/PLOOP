/* ⑤-① 홈 · 새 모임 · 내 모임 관리 — 회귀 테스트
 * 실행: node tests/home.test.js        (스크린샷: SHOTS=폴더 node tests/home.test.js)
 * Chromium(Playwright) + 가짜 Firestore(tests/fbmock.js, 서버 메모리). 실제 Firebase에는 연결하지 않아요.
 * 이전 버전 호환 테스트를 하려면 OLD_HTML=이전 index.html 경로 를 함께 주세요.
 */
const L = require("./lib");
const { check, sleep, BASE } = L;
const SHOTS = process.env.SHOTS || "";
const shot = async (p, name, full) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: !!full }); };

// 모임에 들어가면 잠시 뒤 "나 선택" 시트가 뜰 수 있어요(기존 동작). 떴으면 '나중에 고를게요'로 닫아요.
async function closeJoin(p) { await sleep(500); const s = p.locator("#joinSheet"); if (await s.isVisible()) await p.locator("#joinSheet button[data-joinclose]").last().click(); }
async function createRoom(p, { name, type, desc, pin, addr }) {
  if (!/#create/.test(p.url()) || !(await p.locator("#stepCreate").isVisible())) { await p.click("#goCreate"); }
  await p.fill("#meetName", name);
  if (type) await p.click(`#typeChips [data-type=${type}]`);
  if (desc) await p.fill("#meetDesc", desc);
  if (pin || addr) { await p.click("#advBox summary"); if (addr) await p.fill("#roomInput", addr); if (pin) await p.fill("#pinInput", pin); }
  await Promise.all([p.waitForURL(/\?s=/), p.click("#roomGo")]);
  await L.waitRoom(p);
  return L.roomOf(p.url());
}
async function addMembers(p, names) {
  await p.click("#tabbar [data-nav=more]");
  await p.fill("#newPerson", names);
  await p.press("#newPerson", "Enter");
  await p.locator("#newPerson").blur();
  await sleep(900);
  await closeJoin(p);
}
// 서버(가짜 DB)에 조건이 맞을 때까지 최대 6초 기다린 뒤 dump 반환
async function until(fn) { let db; for (let i = 0; i < 30; i++) { db = await L.dump(); if (fn(db)) break; await sleep(200); } return db; }
const roomDocs = (db, room) => Object.fromEntries(Object.entries(db).filter(([k]) => k.startsWith(`rooms/${room}/`)));
const noHScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const srv = await L.start(L.PORT);
  const browser = await L.chromium.launch();
  const errors = [];
  const watch = p => { p.on("pageerror", e => errors.push(e.message)); };
  try {
    await L.reset();
    const A = await L.newCtx(browser);
    const p = await A.newPage(); watch(p);

    // ── 0. 기본 주소 → 홈 ──
    await p.goto(BASE); await sleep(400);
    check("기본 주소(?s 없음) → 홈 화면", await p.locator("#stepHome").isVisible() && await p.locator("#goCreate").isVisible());
    check("모임 기록이 없으면 '내 모임' 숨김", await p.locator("#recentWrap").isHidden());
    check("홈 가로 스크롤 없음(모바일)", await noHScroll(p));
    await shot(p, "01-home-first");

    // ── 1. 새 모임 만들기: 이름 필수 ──
    await p.click("#goCreate");
    check("만들기: 이름 비어 있으면 버튼 비활성", await p.locator("#roomGo").isDisabled());
    check("만들기: 링크 주소 자동 생성", L.roomOf(BASE + "?s=" + await p.inputValue("#roomInput")) !== null);
    check("만들기 화면 가로 스크롤 없음", await noHScroll(p));
    const jeju = await createRoom(p, { name: "제주 2박 3일", type: "trip", desc: "성산 일출 보러 가요" });
    let db = await until(d => Object.values(roomDocs(d, jeju)).some(v => v.name === "제주 2박 3일"));
    const jTrip = Object.entries(roomDocs(db, jeju)).find(([k]) => k.split("/").length === 4);
    check("제주 생성: 고유 ID + 기존 형식 링크(?s=ID)", /^[a-z0-9-]{2,30}$/.test(jeju) && p.url().startsWith(BASE + "?s=" + jeju), p.url());
    check("제주 생성: trip 문서에 이름 저장", jTrip && jTrip[1].name === "제주 2박 3일");
    const jPlan = roomDocs(db, jeju);
    check("제주 생성: 유형(g_main=trip) 저장", Object.entries(jPlan).some(([k, v]) => k.endsWith("/plan/g_main") && v.type === "trip"));
    check("제주 생성: 설명(d_main) 저장", Object.entries(jPlan).some(([k, v]) => k.endsWith("/plan/d_main") && v.t === "성산 일출 보러 가요"));
    check("상세: 제목·설명 표시", (await p.textContent("#tripTitleText")) === "제주 2박 3일" && (await p.textContent("#tripDesc")) === "성산 일출 보러 가요");
    check("상세 가로 스크롤 없음", await noHScroll(p));
    await addMembers(p, "예나, 재인, 다미");
    await p.click("#tabbar [data-nav=home]");
    await shot(p, "03-room-jeju");
    db = await until(d => Object.values(roomDocs(d, jeju)).some(v => Array.isArray(v.people) && v.people.length === 3));
    const jejuBefore = JSON.stringify(roomDocs(db, jeju));
    check("제주: 멤버 3명 저장", Object.values(roomDocs(db, jeju)).some(v => Array.isArray(v.people) && v.people.length === 3));

    // ── 2. 제주 → 홈(로고) → 강릉 생성 ──
    await Promise.all([p.waitForURL(u => !u.search.includes("s=")), p.click("#goHome")]);
    await sleep(300);
    check("로고 → 홈 이동", await p.locator("#stepHome").isVisible());
    const card = p.locator(".mr-card").first();
    const cardText = (await card.textContent()) || "";
    check("내 모임 카드: 이름·인원·날짜·상태·마지막 접속", /제주 2박 3일/.test(cardText) && /3명/.test(cardText) && /날짜 미정/.test(cardText) && /준비 중/.test(cardText) && /마지막 접속 · 오늘/.test(cardText), cardText.replace(/\s+/g, " "));
    check("다른 기기와 동기화 안 됨 안내 표시", /다른 기기와는 동기화되지 않아요/.test(await p.textContent("#recentWrap")));
    await shot(p, "04-home-list");
    const gang = await createRoom(p, { name: "강릉 1박 2일" });
    check("강릉: 제주와 다른 고유 ID", gang && gang !== jeju, gang);
    db = await L.dump();
    check("강릉: 유형 미선택이면 g_main 없음(모든 메뉴)", !Object.keys(roomDocs(db, gang)).some(k => k.endsWith("/plan/g_main")));
    check("강릉: 유형 미선택이면 투표·일정·정산 메뉴 모두 보임", await p.evaluate(() => ["vote", "sched", "money"].every(k => !document.querySelector(`#tabbar [data-nav=${k}]`).hidden)));

    // ── 3. 강릉에 일정(날짜 선택) 추가 ──
    await addMembers(p, "민수, 지우");
    await p.click("#tabbar [data-nav=vote]");
    await p.locator("#meChips [data-me]").first().click();
    await closeJoin(p);
    const day = p.locator("#cal button.day:not([disabled])").nth(3);
    const dayKey = await day.getAttribute("data-day");
    await day.click(); await sleep(900);
    db = await L.dump();
    check("강릉: 날짜 선택이 서버(a_ 문서)에 저장", Object.entries(roomDocs(db, gang)).some(([k, v]) => /\/plan\/a_/.test(k) && (v.d || []).includes(dayKey)), dayKey);
    check("강릉 작업 후 제주 데이터 그대로", JSON.stringify(roomDocs(db, jeju)) === jejuBefore);

    // ── 4. 제목 드롭다운 → 제주로 전환 ──
    await p.click("#tabbar [data-nav=home]");
    await p.click("#tripTitleBtn");
    check("드롭다운 열림: 현재/다른 모임/새 모임/전체 보기", await p.locator("#roomMenu").isVisible()
      && /강릉 1박 2일/.test(await p.textContent("#roomMenu .rm-row.cur"))
      && /제주 2박 3일/.test(await p.textContent(`#roomMenu [data-room="${jeju}"]`))
      && await p.locator("#roomMenu [data-rm=new]").isVisible() && await p.locator("#roomMenu [data-rm=all]").isVisible());
    await shot(p, "05-dropdown");
    await Promise.all([p.waitForURL(u => u.search.includes("s=" + jeju)), p.click(`#roomMenu [data-room="${jeju}"]`)]);
    await L.waitRoom(p); await closeJoin(p);
    check("드롭다운 → 제주 전환: 이름·설명 그대로", (await p.textContent("#tripTitleText")) === "제주 2박 3일" && (await p.textContent("#tripDesc")) === "성산 일출 보러 가요");
    await p.click("#tabbar [data-nav=more]");
    const names = await p.$$eval("#people input", els => els.map(e => e.value));
    check("제주 전환 후 멤버 그대로(예나·재인·다미)", ["예나", "재인", "다미"].every(n => names.includes(n)), names.join(","));
    db = await L.dump();
    check("전환 후에도 제주 서버 데이터 변화 없음", JSON.stringify(roomDocs(db, jeju)) === jejuBefore);
    await p.click("#tabbar [data-nav=home]");

    // ── 5. 이름 수정 직후 바로 이동해도 저장됨 ──
    await p.click("#editTitle");
    check("✎ 버튼 → 이름 입력칸", await p.locator("#tripName").isVisible());
    await p.fill("#tripName", "제주 2박 3일 (확정)");
    await Promise.all([p.waitForURL(u => !u.search.includes("s=")), p.click("#goHome")]);
    await sleep(300);
    db = await L.dump();
    check("이름 고친 직후 홈으로 가도 서버에 저장", Object.values(roomDocs(db, jeju)).some(v => v.name === "제주 2박 3일 (확정)"));

    // ── 6. 드롭다운의 '+ 새 모임', '전체 모임 보기' ──
    await p.goto(BASE + "?s=" + gang); await L.waitRoom(p); await closeJoin(p);
    await p.click("#tripTitleBtn");
    await Promise.all([p.waitForURL(/#create$/), p.click("#roomMenu [data-rm=new]")]);
    await sleep(300);
    check("드롭다운 '+ 새 모임 만들기' → 만들기 화면", await p.locator("#stepCreate").isVisible());
    await p.goto(BASE + "?s=" + gang); await L.waitRoom(p); await closeJoin(p);
    await p.click("#tripTitleBtn");
    await Promise.all([p.waitForURL(/#list$/), p.click("#roomMenu [data-rm=all]")]);
    await sleep(500);
    check("드롭다운 '전체 모임 보기' → 홈의 내 모임 목록", await p.locator("#recentWrap").isVisible() && (await p.locator(".mr-card").count()) === 2);
    const order = await p.$$eval(".mr-card .mr-name", els => els.map(e => e.textContent));
    check("내 모임: 최근 접속 순 정렬", order[0] === "강릉 1박 2일", order.join(" / "));
    const gCard = (await p.locator(".mr-card").first().textContent()) || "";
    check("강릉 카드 상태 = 날짜 투표 중", /날짜 투표 중/.test(gCard) && /2명/.test(gCard), gCard.replace(/\s+/g, " "));
    await shot(p, "06-home-two");

    // ── 7. 다른 브라우저에서 새 모임 링크 열기 ──
    const B = await L.newCtx(browser);
    const q = await B.newPage(); watch(q);
    await q.goto(BASE + "?s=" + gang); await L.waitRoom(q); await closeJoin(q);
    check("다른 브라우저: 강릉 링크로 바로 진입", (await q.textContent("#tripTitleText")) === "강릉 1박 2일");
    await q.click("#tabbar [data-nav=more]");
    const qn = await q.$$eval("#people input", els => els.map(e => e.value));
    check("다른 브라우저: 강릉 멤버 보임", qn.includes("민수") && qn.includes("지우"), qn.join(","));
    await q.goto(BASE); await sleep(300);
    check("다른 브라우저의 내 모임 = 이 기기에서 들어간 강릉만", (await q.locator(".mr-card").count()) === 1);

    // ── 8. 설명 수정(설정) → 다른 브라우저에 실시간 반영 ──
    await q.goto(BASE + "?s=" + gang); await L.waitRoom(q); await closeJoin(q);
    await p.goto(BASE + "?s=" + gang); await L.waitRoom(p); await closeJoin(p);
    await p.click("#openSettings");
    await p.fill("#setDesc", "경포대 산책");
    await p.locator("#setDesc").blur();
    await p.click("#setSheet button[data-setclose]");
    await q.waitForFunction(() => document.querySelector("#tripDesc").textContent === "경포대 산책", null, { timeout: 8000 }).catch(() => {});
    check("설정에서 설명 수정 → 다른 브라우저에 실시간 반영", (await q.textContent("#tripDesc")) === "경포대 산책");

    // ── 9. 기존(이전 형식) 링크 접속 ──
    const legacy = "old-room-7k2";
    const t = "trip01";
    await L.seed({
      [`rooms/${legacy}/trips/${t}`]: { name: "부산 정산", people: [{ id: "p1", name: "가영" }, { id: "p2", name: "나래" }], c: 1 },
      [`rooms/${legacy}/trips/${t}/items/i1`]: { name: "회", amount: 60000, payer: "p1", shares: {}, memo: "", c: 1 },
      [`rooms/${legacy}/trips/${t}/plan/a_p1`]: { d: ["2026-12-05"] },
      [`rooms/${legacy}/trips/${t}/plan/x_p2`]: { n: ["2026-12-06"], m: [] },
      [`rooms/${legacy}/trips/${t}/plan/z_future`]: { keep: 1 }
    });
    const C = await L.newCtx(browser);
    const r = await C.newPage(); watch(r);
    await r.addInitScript(() => { try { if (!localStorage.getItem("settle-rooms")) localStorage.setItem("settle-rooms", JSON.stringify([{ id: "old-room-7k2", names: "부산 정산", at: Date.now() - 3 * 864e5 }])); } catch (e) {} });
    await r.goto(BASE); await sleep(300);
    const oc = (await r.locator(".mr-card").first().textContent()) || "";
    check("예전 형식의 최근 목록({id,names,at})도 카드로 표시", /부산 정산/.test(oc) && /3일 전/.test(oc), oc.replace(/\s+/g, " "));
    await r.goto(BASE + "?s=" + legacy); await L.waitRoom(r); await closeJoin(r);
    check("기존 링크: 이름·지출 정상", (await r.textContent("#tripTitleText")) === "부산 정산" && /60,000/.test(await r.textContent("#heroTotal")));
    await r.click("#tripTitleBtn"); await r.click("#roomMenu [data-rm=close]");
    await r.click("#editTitle"); await r.fill("#tripName", "부산 정산!"); await r.locator("#tripName").blur(); await sleep(1200);
    db = await L.dump();
    const ld = roomDocs(db, legacy);
    check("기존 링크: 수정 후에도 x_(예전 미정·불가)·모르는 접두사 문서 보존", ld[`rooms/${legacy}/trips/${t}/plan/x_p2`] && ld[`rooms/${legacy}/trips/${t}/plan/z_future`] && ld[`rooms/${legacy}/trips/${t}`].name === "부산 정산!");
    check("기존 링크: d_main이 없던 모임에 설명 문서가 생기지 않음", !ld[`rooms/${legacy}/trips/${t}/plan/d_main`]);

    // ── 10. 비밀번호 모임 (고급 설정) ──
    await p.goto(BASE + "#create"); await sleep(300);
    const sec = await createRoom(p, { name: "비밀 모임", pin: "4321" });
    check("비밀번호 모임: 링크 형식 ?s=ID#k=PIN", new URL(p.url()).hash === "#k=4321", p.url());
    db = await until(d => Object.keys(d).some(k => k.startsWith(`rooms/${sec}--`)));   // 저장은 0.5초 대기 후 나가요
    check("비밀번호 모임: 데이터는 room--해시 경로, locks 표시", Object.keys(db).some(k => k.startsWith(`rooms/${sec}--`)) && !!db[`locks/${sec}`]);
    const D = await L.newCtx(browser); const s2 = await D.newPage(); watch(s2);
    await s2.goto(BASE + "?s=" + sec + "#k=4321"); await L.waitRoom(s2); await closeJoin(s2);
    check("비밀번호 모임: 공유 링크로 다른 브라우저 진입", (await s2.textContent("#tripTitleText")) === "비밀 모임");
    const E = await L.newCtx(browser); const s3 = await E.newPage(); watch(s3);
    await s3.goto(BASE + "?s=" + sec); await sleep(1500);
    check("비밀번호 모임: 비밀번호 없는 링크 → 비밀번호 화면", await s3.locator("#pinGate").isVisible());

    // ── 11. 목록에서 빼기 (이 기기 목록만) ──
    await p.goto(BASE); await sleep(300);
    const before = await p.locator(".mr-card").count();
    await p.locator(`.mr-card [data-forget="${jeju}"]`).click(); await sleep(200);
    db = await L.dump();
    check("목록에서 빼기: 카드만 사라지고 서버 데이터 유지", (await p.locator(".mr-card").count()) === before - 1 && Object.keys(roomDocs(db, jeju)).length > 0);

    // ── 12. 이전 버전 앱이 d_main을 지우지 않는지 ──
    if (process.env.OLD_HTML) {
      const F = await L.newCtx(browser); const o = await F.newPage(); watch(o);
      await o.goto(`${L.ORIGIN}/PLOOP/old.html?s=${gang}`);
      await o.waitForFunction(() => !document.body.classList.contains("booting") && !document.body.classList.contains("ro"), null, { timeout: 15000 });
      await o.locator("#joinSheet button[data-joinclose]").last().click().catch(() => {});
      await o.fill("#tripName", "강릉 1박 2일 (구버전 수정)"); await sleep(400);
      await o.evaluate(() => { document.querySelector("#tabbar [data-nav=more]").click(); });
      await o.fill("#newPerson", "구버전멤버"); await o.press("#newPerson", "Enter"); await o.locator("#newPerson").blur(); await sleep(1500);
      db = await L.dump();
      const gd = roomDocs(db, gang);
      const dm = Object.entries(gd).find(([k]) => k.endsWith("/plan/d_main"));
      check("이전 버전 앱(2026-10-29-5)이 편집해도 설명(d_main) 보존", dm && dm[1].t === "경포대 산책" && Object.values(gd).some(v => v.name === "강릉 1박 2일 (구버전 수정)"));
    } else check("이전 버전 호환 테스트 (OLD_HTML 미지정으로 건너뜀)", true, "skipped");

    // ── 12-2. 한 링크에 약속이 여러 개: 최근에 만든 약속이 먼저 ──
    const mr = "multi-room-9q";
    const trip = (id, name, c) => ({ [`rooms/${mr}/trips/${id}`]: { name, c, people: [{ id: "m1", name: "가람" }] } });
    await L.seed({ ...trip("tOld", "1월 모임", 1000), ...trip("tMid", "2월 모임", 2000), ...trip("tNew", "3월 모임", 3000) });
    const M = await L.newCtx(browser);
    const m1 = await M.newPage(); watch(m1);
    const titleIs = (pg, t) => pg.waitForFunction(x => document.querySelector("#tripTitleText").textContent === x, t, { timeout: 8000 }).then(() => true, () => false);
    await m1.goto(BASE + "?s=" + mr); await L.waitRoom(m1); await closeJoin(m1);
    check("여러 약속: 링크로 들어오면 가장 최근 약속(3월)이 열림", await titleIs(m1, "3월 모임"), await m1.textContent("#tripTitleText"));
    const tabs = await m1.$$eval("#tabs .trip", els => els.map(e => e.textContent));
    check("여러 약속: 탭 순서 = 최근 만든 순", tabs.join(",") === "3월 모임,2월 모임,1월 모임", tabs.join(","));
    await m1.click('#tabs [data-trip="tOld"]');
    const picked = await titleIs(m1, "1월 모임");
    await m1.reload(); await L.waitRoom(m1); await closeJoin(m1);
    check("여러 약속: 직접 고른 약속은 새로고침해도 유지", picked && await titleIs(m1, "1월 모임"), await m1.textContent("#tripTitleText"));
    const m2 = await M.newPage(); watch(m2);
    await m2.goto(BASE + "?s=" + mr); await L.waitRoom(m2); await closeJoin(m2);
    check("여러 약속: 새 탭으로 다시 들어오면 다시 최근 약속(3월)", await titleIs(m2, "3월 모임"), await m2.textContent("#tripTitleText"));
    await sleep(1200);   // 마지막으로 본 일정(캐시) 저장 대기
    await L.seed(trip("tNewer", "4월 모임", 4000));   // 그사이 친구가 새 약속을 만듦 (이 기기 캐시에는 없음)
    const m3 = await M.newPage(); watch(m3);
    await m3.goto(BASE + "?s=" + mr); await L.waitRoom(m3); await closeJoin(m3);
    check("여러 약속: 캐시에 없던 새 약속도 들어오면 맨 먼저 열림(4월)", await titleIs(m3, "4월 모임"), await m3.textContent("#tripTitleText"));
    await m3.click("#addTrip"); await m3.locator("#tripName").blur(); await sleep(600);
    const first = await m3.$eval("#tabs .trip-wrap:first-child", el => el.classList.contains("on"));
    check("여러 약속: ＋로 추가한 약속이 맨 앞 탭에 선택됨", first);
    await M.close();

    // ── 13. 데스크톱 폭 ──
    const W = await L.newCtx(browser, { mobile: false }); const w = await W.newPage(); watch(w);
    await w.goto(BASE + "?s=" + gang); await L.waitRoom(w); await closeJoin(w);
    await w.goto(BASE); await sleep(300);
    check("데스크톱: 홈 정상, 가로 스크롤 없음", await w.locator(".mr-card").count() === 1 && await noHScroll(w));

    check("페이지 JS 오류 없음", errors.length === 0, errors.slice(0, 3).join(" | "));
    check("실제 Firebase/Google API 요청 0건 (모두 차단)", L.blocked.length === 0, L.blocked.slice(0, 2).join(" "));
  } catch (e) {
    check("테스트 실행 중 예외", false, e.stack || String(e));
  } finally {
    await browser.close(); srv.close();
    const fail = L.results.filter(r => !r.ok).length;
    console.log(`\n총 ${L.results.length}건 · 통과 ${L.results.length - fail} · 실패 ${fail}`);
    process.exit(fail ? 1 : 0);
  }
})();
