// 앱이 실제로 보내는 요청(허용돼야 함)과 막아야 할 요청을 두 규칙 파일에 각각 시험
const fs=require('fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,updateDoc,deleteDoc,collection,getDocs,query,limit,deleteField,runTransaction}=require('firebase/firestore');
const FILES={current:require('path').join(__dirname,'../../firestore.rules'),proposed:require('path').join(__dirname,'../../firestore.rules.proposed')};
const results=[];
(async()=>{
 for(const [label,file] of Object.entries(FILES)){
  const env=await initializeTestEnvironment({projectId:'demo-moimoi-'+label,firestore:{rules:fs.readFileSync(file,'utf8'),host:'127.0.0.1',port:8085}});
  const db=env.unauthenticatedContext().firestore();
  const R='rooms/jeju-ab3k9';const T=R+'/trips/t1abc';
  const people=[{id:'p1',name:'가람'},{id:'p2',name:'나래',col:'#7c5cff',toss:'x',bank:'국민 123'}];
  const T_=async(name,ok,fn)=>{try{await (ok?assertSucceeds:assertFails)(fn());results.push([label,name,ok,true]);}catch(e){results.push([label,name,ok,false,String(e.message).slice(0,140)]);}};
  // --- 앱이 하는 일 (허용돼야 함) ---
  await T_('잠금 확인 get locks',true,()=>getDoc(doc(db,'locks/jeju-ab3k9')));
  await T_('잠금 만들기 {at}',true,()=>setDoc(doc(db,'locks/sec-room1'),{at:Date.now()}));
  await T_('약속 목록 조회(limit 1, keyExists)',true,()=>getDocs(query(collection(db,R+'/trips'),limit(1))));
  await T_('약속 문서 set {name,people,c}',true,()=>setDoc(doc(db,T),{name:'제주',people,c:1}));
  await T_('약속 문서 트랜잭션(txTrip)',true,()=>runTransaction(db,async tx=>{await tx.get(doc(db,T));tx.set(doc(db,T),{name:'제주 2',people,c:1});}));
  await T_('지출 set',true,()=>setDoc(doc(db,T+'/items/i1x'),{name:'회',amount:50000,payer:'p1',shares:{p2:'x'},memo:'',c:1}));
  await T_('지출 부분 수정(shares.p1 점 표기)',true,()=>updateDoc(doc(db,T+'/items/i1x'),{'shares.p1':10000,amount:60000}));
  await T_('지출 필드 삭제(deleteField)',true,()=>updateDoc(doc(db,T+'/items/i1x'),{'shares.p2':deleteField()}));
  await T_('송금 set',true,()=>setDoc(doc(db,T+'/transfers/x1y'),{from:'p1',to:'p2',amount:1000,memo:'',g:'',c:1}));
  for(const id of ['a_p1','t_p1','x_p1','o_opt1','v_p1','f_main','s_main','g_main','h_main','q_main','d_main'])
    await T_('투표/일정 문서 '+id,true,()=>setDoc(doc(db,T+'/plan/'+id),{d:['2026-12-05']}));
  await T_('하위 문서 목록(onSnapshot 대상)',true,()=>getDocs(collection(db,T+'/plan')));
  await T_('비밀번호 모임 경로(room--hash)',true,()=>setDoc(doc(db,'rooms/sec-room1--0123456789abcdef/trips/t2'),{name:'비밀',people:[],c:1}));
  await T_('지출 삭제',true,()=>deleteDoc(doc(db,T+'/items/i1x')));
  await T_('약속 삭제',true,()=>deleteDoc(doc(db,T)));
  await T_('삭제 되돌리기(같은 ID로 다시 set)',true,()=>setDoc(doc(db,T),{name:'제주',people,c:1}));
  // --- 막아야 할 것 ---
  await T_('잠금 수정 금지',false,()=>setDoc(doc(db,'locks/sec-room1'),{at:1}));
  await T_('잠금 삭제 금지',false,()=>deleteDoc(doc(db,'locks/sec-room1')));
  await T_('잠금에 다른 필드 금지',false,()=>setDoc(doc(db,'locks/other-room'),{at:1,evil:1}));
  await T_('전체 모임 목록 조회 금지',false,()=>getDocs(collection(db,'rooms')));
  await T_('잘못된 방 ID(대문자) 금지',false,()=>setDoc(doc(db,'rooms/BAD_ROOM/trips/t1'),{name:'x',people:[],c:1}));
  await T_('허용 안 된 하위 컬렉션 금지',false,()=>setDoc(doc(db,T+'/evil/e1'),{a:1}));
  await T_('필드 21개 이상 금지',false,()=>setDoc(doc(db,T+'/items/big'),Object.fromEntries([...Array(21)].map((_,i)=>['f'+i,i]))));
  await T_('최상위 아무 컬렉션 쓰기 금지',false,()=>setDoc(doc(db,'hack/x'),{a:1}));
  // --- 제안 규칙에서만 막히는 것 (현재 규칙은 허용) ---
  const strict=label==='proposed';
  await T_('약속 문서에 이상한 필드',!strict,()=>setDoc(doc(db,T),{name:'x',people:[],c:1,evil:'<script>'}));
  await T_('멤버 51명',!strict,()=>setDoc(doc(db,T),{name:'x',people:[...Array(51)].map((_,i)=>({id:'p'+i,name:'n'})),c:1}));
  await T_('people이 목록이 아님',!strict,()=>setDoc(doc(db,T),{name:'x',people:'nope',c:1}));
  await T_('문서 ID에 점(.)',!strict,()=>setDoc(doc(db,T+'/items/bad.id'),{a:1}));
  await env.cleanup();
 }
 let fail=0;
 for(const [label,name,ok,pass,err] of results){if(!pass)fail++;console.log(`${pass?'PASS':'FAIL'} | [${label}] ${ok?'허용':'차단'} 기대 · ${name}${err?' | '+err:''}`);}
 console.log(`\n총 ${results.length}건 · 통과 ${results.length-fail} · 실패 ${fail}`);
 process.exit(fail?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
