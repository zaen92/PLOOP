// Unit tests for the settlement core, extracted verbatim from index.html (block between the settle-core markers)
const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const m=html.match(/\/\* ==== settle-core[\s\S]*?\/\* ==== \/settle-core ==== \*\//);
if(!m){console.log('FAIL | core block not found');process.exit(1);}
const {splitItem,settle,settleId,toWon}=new Function(m[0]+';return {splitItem,settle,settleId,toWon};')();
const res=[];const check=(name,ok,info='')=>res.push([name,!!ok,info]);
const P=(...n)=>n.map(x=>({id:x,name:x}));
const item=(id,amount,payer,shares={})=>({id,amount,payer,shares});
const tx=(from,to,amount,memo='')=>({id:'t'+Math.random(),from,to,amount,memo});
const mv=c=>c.moves.map(x=>`${x.from}>${x.to}:${x.amount}`).join(' ');
const zeroAfter=(people,items,transfers,c)=>{const t2=transfers.concat(c.moves.map(x=>tx(x.from,x.to,x.amount)));const c2=settle(people,items,t2);return Object.values(c2.bal).every(v=>v===0)&&c2.moves.length===0;};

// 1. 2명 균등
{const p=P('A','B'),it=[item('i1',10000,'A')];const c=settle(p,it,[]);
 check('2명 균등 정산',mv(c)==='B>A:5000'&&c.share.A===5000&&c.share.B===5000&&c.consistent,mv(c));}
// 2. 3명 나머지
{const p=P('A','B','C');const c=settle(p,[item('i1',10000,'A')],[]);const c2=settle(p,[item('i1',10001,'B')],[]);
 check('3명 나머지 금액 (10,000원 ÷ 3)',c.share.A===3334&&c.share.B===3333&&c.share.C===3333&&mv(c)==='B>A:3333 C>A:3333'&&c.splits.i1.extra.join()==='A',`몫 ${c.share.A}/${c.share.B}/${c.share.C} · ${mv(c)}`);
 check('3명 나머지 2원 (10,001원 ÷ 3)',c2.share.A===3334&&c2.share.B===3334&&c2.share.C===3333&&c2.consistent,`몫 ${c2.share.A}/${c2.share.B}/${c2.share.C} · ${mv(c2)}`);}
// 3. 일부 참여자만
{const p=P('A','B','C');const c=settle(p,[item('i1',9000,'A',{B:'x'})],[]);
 check('일부 참여자만 지출 (B 빠짐)',c.share.B===0&&c.share.A===4500&&c.share.C===4500&&mv(c)==='C>A:4500',mv(c));}
// 4. 한 사람이 여러 번 결제
{const p=P('A','B','C');const it=[item('i1',30000,'A'),item('i2',12000,'A',{C:'x'}),item('i3',9000,'B')];const c=settle(p,it,[]);
 // A paid 42000, shares: A 10000+6000+3000=19000, B 10000+6000+3000=19000, C 10000+3000=13000; B paid 9000
 check('한 사람이 여러 번 결제',c.paid.A===42000&&c.share.A===19000&&c.share.B===19000&&c.share.C===13000&&mv(c)==='C>A:13000 B>A:10000'&&c.consistent,`A 결제 ${c.paid.A} · ${mv(c)}`);}
// 5. 중간 송금 완료
{const p=P('A','B');const it=[item('i1',10000,'A')];const c=settle(p,it,[tx('B','A',2000,'선금')]);
 check('중간 송금(선금 2,000원) 반영',mv(c)==='B>A:3000'&&c.bal.B===-3000&&c.bal.A===3000,mv(c));
 const c3=settle(p,it,[tx('B','A',2000),tx('B','A',3000,'정산 송금')]);
 check('남은 3,000원 송금 체크 후 완료 (중복 반영 없음)',c3.moves.length===0&&c3.bal.A===0&&c3.bal.B===0,mv(c3)||'송금 없음');}
// 6. 지출 삭제 후 재계산
{const p=P('A','B','C');let it=[item('i1',30000,'A'),item('i2',6000,'B')];const c1=settle(p,it,[]);
 it=it.filter(x=>x.id!=='i2');const c2=settle(p,it,[]);
 check('지출 삭제 후 재계산',mv(c1)==='C>A:12000 B>A:6000'&&mv(c2)==='B>A:10000 C>A:10000',`${mv(c1)} → ${mv(c2)}`);
 // 이미 송금 체크한 뒤 지출이 삭제되면 → 돌려받을 돈이 생김
 const done=[tx('B','A',10000,'정산 송금'),tx('C','A',10000,'정산 송금')];const c3=settle(p,[item('i1',30000,'A'),item('i9',3000,'A')],done);
 const c4=settle(p,[item('i1',30000,'A')].concat([]),done.concat([]));const c5=settle(p,[item('i1',24000,'A')],done);
 check('송금 완료 뒤 지출 금액이 줄면 돌려받을 돈 계산',mv(c4)===''&&mv(c5)==='A>B:2000 A>C:2000',`${mv(c5)}`);}
// 7. 정산 완료 후 추가 지출
{const p=P('A','B','C');const done=[tx('B','A',10000,'정산 송금'),tx('C','A',10000,'정산 송금')];
 const c=settle(p,[item('i1',30000,'A'),item('i2',9000,'C')],done);
 check('정산 완료 후 추가 지출 → 새 지출만 정산',mv(c)==='A>C:3000 B>C:3000'&&zeroAfter(p,[item('i1',30000,'A'),item('i2',9000,'C')],done,c),mv(c));}
// 8. 직접 입력·검증
{const p=P('A','B','C');
 const ok=settle(p,[item('i1',10000,'A',{A:5000})],[]);
 check('개별 금액 + 나머지 균등 (A 5,000 직접)',ok.share.A===5000&&ok.share.B===2500&&ok.share.C===2500,`${ok.share.A}/${ok.share.B}/${ok.share.C}`);
 const allFixed=settle(p,[item('i1',10000,'A',{A:2000,B:3000,C:5000})],[]);
 check('모두 직접 입력 · 합계 일치',allFixed.excluded.length===0&&allFixed.share.C===5000&&allFixed.consistent);
 const over=settle(p,[item('i1',10000,'A',{A:12000}),item('i2',6000,'B')],[]);
 check('직접 입력이 결제금액보다 크면 그 지출은 정산 제외 · 나머지는 정상',over.excluded.join()==='i1'&&mv(over)==='A>B:2000 C>B:2000'&&over.consistent,mv(over));
 const short=settle(p,[item('i1',10000,'A',{A:2000,B:3000,C:4000})],[]);
 check('모두 직접 입력했는데 합계가 모자라면 정산 제외',short.excluded.join()==='i1'&&short.splits.i1.diff===1000&&short.consistent);
 const nopayer=settle(p,[item('i1',9000,''),item('i2',3000,'B')],[]);
 check('결제자 없는 지출은 결제·부담 모두에서 제외 (합계 일치)',nopayer.noPayer.length===1&&nopayer.counted===3000&&nopayer.total===12000&&nopayer.consistent&&mv(nopayer)==='A>B:1000 C>B:1000',mv(nopayer));
 const allx=settle(p,[item('i1',9000,'A',{A:'x',B:'x',C:'x'})],[]);
 check('참여자가 아무도 없으면 정산 제외',allx.excluded.join()==='i1'&&allx.consistent);
 const neg=settle(p,[item('i1',-5000,'A')],[]);
 check('음수 금액은 정산 제외',neg.excluded.join()==='i1'&&neg.total===0&&neg.consistent);
 const dec=settle(p,[item('i1',10000.6,'A',{B:3333.4})],[]);
 check('소수점 금액은 원 단위로 반올림',dec.paid.A===10001&&dec.share.B===3333&&dec.consistent,`결제 ${dec.paid.A} · B ${dec.share.B}`);
 const ghost=settle(P('A','B'),[item('i1',10000,'A')],[tx('Z','A',5000),tx('B','B',100)]);
 check('삭제된 멤버·자기 자신에게 보낸 기록은 무시',mv(ghost)==='B>A:5000');}
// 9. 같은 송금은 같은 기록 ID (두 번 눌러도 한 번만)
{const p=P('A','B');const c=settle(p,[item('i1',10000,'A')],[]);const a=settleId(c,c.moves[0]),b=settleId(settle(p,[item('i1',10000,'A')],[]),c.moves[0]);
 const c2=settle(p,[item('i1',12000,'A')],[]);
 check('송금 체크 ID: 같은 상태면 같고, 상태가 바뀌면 다름',a===b&&a!==settleId(c2,c2.moves[0])&&/^s[0-9a-z]+$/.test(a),a);}
// 10. 무작위 3,000건: 합계 불변식
{let fail=null,n=0;const rnd=k=>Math.floor(Math.random()*k);
 for(let r=0;r<3000&&!fail;r++){
  const people=P(...'ABCDEFG'.slice(0,2+rnd(6)).split(''));const ids=people.map(p=>p.id);const items=[],trs=[];
  for(let k=0;k<1+rnd(8);k++){const sh={};ids.forEach(id=>{const q=rnd(10);if(q<2)sh[id]='x';else if(q<3)sh[id]=rnd(20000);});
   items.push(item('i'+k,[0,rnd(200000),rnd(99999)+1,-rnd(5000)][rnd(4)]||rnd(50000),rnd(10)?ids[rnd(ids.length)]:'',sh));}
  for(let k=0;k<rnd(4);k++)trs.push(tx(ids[rnd(ids.length)],ids[rnd(ids.length)],rnd(30000)));
  const c=settle(people,items,trs);n++;
  const sum=o=>Object.values(o).reduce((a,b)=>a+b,0);
  const ints=[...Object.values(c.share),...Object.values(c.paid),...Object.values(c.bal),...c.moves.map(x=>x.amount)].every(Number.isInteger);
  const itemsOk=items.every(it=>{const s=c.splits[it.id];if(c.excluded.includes(it.id)||!toWon(it.amount))return true;
    const v=Object.values(s.shares).filter(x=>x!=null);const autos=s.autos.map(id=>s.shares[id]);
    return v.reduce((a,b)=>a+b,0)===toWon(it.amount)&&(!autos.length||Math.max(...autos)-Math.min(...autos)<=1);});
  const ok=c.consistent&&sum(c.paid)===sum(c.share)&&sum(c.bal)===0&&ints&&itemsOk&&c.moves.every(x=>x.amount>0&&x.from!==x.to)&&c.moves.length<=Math.max(0,people.length-1)&&zeroAfter(people,items,trs,c);
  if(!ok)fail=JSON.stringify({people:ids,items,trs,moves:c.moves});
 }
 check(`무작위 ${n}건: 결제 합계=부담 합계, 잔액 합 0, 정수, 송금 후 전원 0원`,!fail,fail?fail.slice(0,300):'모두 통과');}
for(const [n,ok,i] of res)console.log((ok?'PASS':'FAIL')+' | '+n+(i?' | '+i:''));
