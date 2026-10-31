// v70.11: 坂(傾斜通路)の描画形状を、実際のコードと共有地形定義で数値確認する。
// 旧実装では縁の石が坂と逆向き・別の軸に傾き、端で最大3.7mずれていた。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const Shared=require('../public/shared.js');
const a=html.indexOf('  const ROGUE_RAMP_VIS = ');
const b=html.indexOf('  function makeRogueRampMaterials(',a);
if(a<0||b<a)throw new Error('ramp shape helpers are missing');
const source=html.slice(a,b)+'\nglobalThis.__ramp={ROGUE_RAMP_VIS,rogueRampBuildShape,rogueRampBuildAll,rogueRampCleanPolygon};';
const context={Math,Number,Object,Infinity,Shared};
vm.runInNewContext(source,context,{timeout:2000});
const R=context.__ramp,V=R.ROGUE_RAMP_VIS;
let failed=0;
function check(name,ok,details=''){console.log((ok?'PASS ':'FAIL ')+name+(ok?'':' '+details));if(!ok)failed++;}

function verts(arr){const out=[];for(let i=0;i<arr.length;i+=3)out.push([arr[i],arr[i+1],arr[i+2]]);return out;}
for(const variant of ['classic','linear']){
  const areas=Shared.getRogueDungeonDefinition(variant).areas;
  const built=R.rogueRampBuildAll(areas);
  const ramps=areas.map((s,i)=>({s,i})).filter(o=>o.s.type==='segment'&&Math.abs((o.s.yB||0)-(o.s.yA||0))>1e-5);
  check(`${variant}: 坂ごとに形状が作られる`,ramps.length>0&&ramps.every(o=>built.shapes.has(o.i)),`ramps=${ramps.length}`);
  for(const {s:seg,i} of ramps){
    const shape=built.shapes.get(i);
    const tag=`${variant} (${seg.ax},${seg.az})→(${seg.bx},${seg.bz})`;
    const all=[...verts(shape.top),...verts(shape.side),...verts(shape.groove)];
    check(`${tag}: 頂点がすべて有限値`,all.every(v=>v.every(Number.isFinite)));
    // 面の高さが歩行用の床高(共有定義の補間)と一致する。これが旧実装では縁の石で崩れていた。
    let worst=0;
    for(let k=0;k<=40;k++){
      const t=k/40,x=seg.ax+(seg.bx-seg.ax)*t,z=seg.az+(seg.bz-seg.az)*t;
      const cand=Shared.getRogueDungeonFloorCandidates(x,z,3,variant).find(c=>c.kind==='ramp'&&c.area===seg);
      if(!cand)continue;
      // 面の上の同じ位置(最寄りの2頂点を結ぶ線上)の高さを、頂点列から補間して比べる。
      const st=shape.stations,f=t*shape.N,i0=Math.min(shape.N-1,Math.floor(f)),u=f-i0;
      const yVis=st[i0].top+(st[i0+1].top-st[i0].top)*u;
      worst=Math.max(worst,Math.abs((yVis+V.drop)-cand.y));
    }
    check(`${tag}: 描画面の高さが歩行の床高と一致する`,worst<.02,`worst=${worst.toFixed(3)}`);
    check(`${tag}: 縁・溝の壁は面より高く(溝の壁は床の面まで)、厚みが${V.thick}m以上ある`,shape.stations.every(q=>q.sides.every(sd=>(sd.wallTop>=q.top+V.curbH-1e-9||sd.wallTop-.02>=q.top-.005)&&sd.wallTop>q.top&&sd.base<=q.top-V.thick+1e-9)));
    check(`${tag}: 坂の幅は歩ける幅より広い`,shape.hw>=seg.width*.45-1e-9);
    // 軸方向に隣り合う駅の面の勾配が、定義の勾配と同じ(縁が逆向きに傾かない)。
    const slope=(seg.yB-seg.yA)/shape.L;
    let slopeOk=true;
    for(let k=0;k<shape.N;k++){const q0=shape.stations[k],q1=shape.stations[k+1];if(Math.abs((q1.top-q0.top)/(q1.s-q0.s)-slope)>1e-6)slopeOk=false;}
    check(`${tag}: 面の勾配が定義と同じ向き・大きさ`,slopeOk);
  }
  if(variant==='classic'){
    const west=areas.findIndex(s=>s.type==='segment'&&s.ax===-12&&s.az===-74);
    const platform=areas.findIndex(s=>s.type==='ellipse'&&s.floorY===3.8);
    // 西の高台の床との差は最大0.14mだけ。床の縁が坂の面を隠しても段差にならないので、切り欠きは足さない。
    check('西の坂は高台の床へ浅く潜るだけなので、描画用の切り欠きを足さない',west>=0&&platform>=0&&!(built.cutsByArea.get(platform)||[]).length);
    // その代わり、縁石の高さは高台の床の面で止まり、床から飛び出さない。
    const ws=built.shapes.get(west),lastInside=ws.stations.filter(q=>q.sides.some(sd=>Math.abs(sd.wallTop-(3.8-V.drop+.02))<1e-6));
    check('西の坂の上端では、側面が高台の床の面と同じ高さで止まる',lastInside.length>=1);
    // 溝を持つ広間(共有定義の切り欠きがある坂)には、追加の切り欠きを重ねない。
    const slotted=areas.map((s,i)=>({s,i})).filter(o=>o.s.type==='ellipse'&&(o.s.floorHoles||[]).some(h=>h.type==='corridor'));
    check('共有定義の切り欠きがある広間へ二重に切り欠きを足さない',slotted.every(o=>!(built.cutsByArea.get(o.i)||[]).length));
    // 溝の壁: 広間の床へ潜る所では、側面の上端が広間の床の面まで届く。
    const east=areas.findIndex(s=>s.type==='segment'&&s.ax===14&&s.az===-93);
    const es=built.shapes.get(east),deep=es.stations[Math.floor(es.N*.6)];
    check('下り坂が広間の床の切り欠きへ潜る所では、側面が床の面まで立ち上がる',deep.sides.every(sd=>Math.abs(sd.wallTop-(0-V.drop+.02))<1e-6),`wallTop=${deep.sides.map(x=>x.wallTop.toFixed(2))}`);
    // 支え: 深層への坂は、下の広間の床の上へ入る所で側面がその床まで届く。
    const deepRamp=areas.findIndex(s=>s.type==='segment'&&s.ax===0&&s.az===-152);
    const ds=built.shapes.get(deepRamp),last=ds.stations[ds.N-2];
    check('深層への坂は下の広間の床の上で、側面が床まで届いて宙に浮かない',last.sides.every(sd=>sd.base<=-5.2-V.drop+1e-6),`base=${last.sides.map(x=>x.base.toFixed(2))}`);
  }
}
{
  // 共有定義の切り欠きがない広間の床の下へ深く潜る坂では、描画用の切り欠きが追加される。
  const areas=[
    {type:'ellipse',x:0,z:0,rx:30,rz:30,floorY:2},
    {type:'segment',ax:-10,az:0,bx:10,bz:0,width:6,yA:-3,yB:-1}
  ];
  const built=R.rogueRampBuildAll(areas),cuts=built.cutsByArea.get(0)||[];
  check('深く潜る坂は、広間の床へ坂の幅の切り欠きを1つ追加する',cuts.length===1&&cuts[0].length===4);
  if(cuts.length===1){
    const zs=cuts[0].map(p=>p.z);
    check('切り欠きの幅は坂の幅と同じ',Math.abs(Math.max(...zs)-Math.min(...zs)-6)<1e-6);
  }
  const shape=built.shapes.get(1),mid=shape.stations[Math.floor(shape.N/2)];
  check('潜る所の側面は広間の床の面まで立ち上がる',mid.sides.every(sd=>Math.abs(sd.wallTop-(2-V.drop+.02))<1e-6));
  // 重なった点や極端に小さい面は取り除かれる。
  const clean=context.__ramp.rogueRampCleanPolygon;
  check('重複した点は除かれ、小さすぎる面は捨てられる',
    clean([{x:0,z:0},{x:2,z:0},{x:2,z:0},{x:2,z:2},{x:0,z:2}]).length===4&&clean([{x:0,z:0},{x:.1,z:0},{x:.1,z:.1}]).length===0);
}
// 旧実装の「縁の石を Euler で回す」処理が坂に使われていない。
check('両方のダンジョンの坂が専用形状で描画される',(html.match(/addRogueRampMeshes\(s,rampBuild\.shapes\.get\(ai\),rampMats\)/g)||[]).length===2);
check('坂の床の切り欠きを広間の床へ渡している',(html.match(/rampBuild\.cutsByArea\.get\(ai\)/g)||[]).length===2);
if(failed)process.exit(1);console.log('Rogue ramp visual checks passed.');
