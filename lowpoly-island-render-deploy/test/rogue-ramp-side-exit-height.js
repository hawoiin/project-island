// v70.13: 坂の側面は壁(歩けない領域)で、入口は両端だけ。
// v64.1: 坂専用の例外を減らし、上下階の重なりも含めて床面の連続性を検証する。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(path.join(__dirname,'..','public/index.html'),'utf8');
const Shared=require('../public/shared.js');
const helperStart=html.indexOf('  const CLASSIC_ROGUE_DUNGEON_INDEX = Shared.ROGUE_DUNGEON_INDEX;');
const helperEnd=html.indexOf('  // 岩の中心線だけでなく',helperStart);
const moveStart=html.indexOf('  function rogueDungeonMovePathAllowed(',helperEnd);
const moveEnd=html.indexOf('  function constrainRogueDungeonPosition(',moveStart);
if(helperStart<0||helperEnd<=helperStart||moveStart<0||moveEnd<=moveStart)throw new Error('unified floor movement helpers not found');
const context={Shared,Math,Number,rogueRun:{openGates:3},grounded:true,player:{position:{y:0}},THREE:{MathUtils:{clamp:(v,min,max)=>Math.min(max,Math.max(min,v))}}};
const source=html.slice(helperStart,helperEnd)+html.slice(moveStart,moveEnd)+'\nglobalThis.__test={ROGUE_WALK_AREAS,rogueFloorHeight,rogueFloorCandidatesAt,rogueChooseConnectedFloor,rogueDungeonMovePathAllowed};';
vm.runInNewContext(source,context,{timeout:1000});
const T=context.__test;let failures=0;
function check(name,ok,details=''){console.log((ok?'PASS ':'FAIL ')+name+(ok?'':' '+details));if(!ok)failures++;}
const ramps=T.ROGUE_WALK_AREAS.filter(a=>a.type==='segment'&&Math.abs((a.yB||0)-(a.yA||0))>1e-5);
const lowOverlap={x:-33.75,z:-76.5},highOverlap={x:-33.75,z:-76.25};
const lowCandidates=T.rogueFloorCandidatesAt(lowOverlap.x,lowOverlap.z,3);
const highCandidates=T.rogueFloorCandidatesAt(highOverlap.x,highOverlap.z,3);
check('低い床と上段床が重なる場所を複数の床候補として保持する',lowCandidates.some(c=>Math.abs(c.y)<.05)&&lowCandidates.some(c=>Math.abs(c.y-3.8)<.05),`ys=${lowCandidates.map(c=>c.y)}`);
check('上下階が重なる場所でも低い床にいる時は低い面を選ぶ',Math.abs(T.rogueChooseConnectedFloor(lowCandidates,0,0,false)?.y||0)<.05);
check('同じ場所でも上段にいる時は上段床を選ぶ',Math.abs((T.rogueChooseConnectedFloor(lowCandidates,3.8,3.8,false)?.y||0)-3.8)<.05);
check('重なった床の境界で低い床を歩いても上段へ瞬間移動しない',T.rogueDungeonMovePathAllowed(lowOverlap.x,lowOverlap.z,highOverlap.x,highOverlap.z,3,0,false));
const ascendingRamp=ramps.find(a=>a.ax===-12&&a.az===-74&&a.bx===-29&&a.bz===-69);
if(ascendingRamp){
  const rampMid={x:ascendingRamp.ax+(ascendingRamp.bx-ascendingRamp.ax)*.55,z:ascendingRamp.az+(ascendingRamp.bz-ascendingRamp.az)*.55};
  const underRamp=T.rogueFloorCandidatesAt(rampMid.x,rampMid.z,3);
  const rampFloor=underRamp.find(c=>c.kind==='ramp');
  const lowerFloor=underRamp.find(c=>Math.abs(c.y)<.05);
  // v70.12: 坂は石の躯体(面から下の広間の床まで石で埋まる)なので、坂の面より低い床は「石の中」で立てない。
  // 以前(v64.1〜v70.11)は両方の床候補を保持していたため、広間の床の高さのまま坂の下へ歩き込めた。
  check('坂の投影範囲では、坂より低い床(石の躯体の中)を床候補に含めない',!!rampFloor&&!lowerFloor,`ys=${underRamp.map(c=>c.y)}`);
  check('低い床にいるプレイヤーは頭上の坂の下(石の中)へ入れる床を選べない',T.rogueChooseConnectedFloor(underRamp,0,0,false)===null,`ys=${underRamp.map(c=>c.y)}`);
  check('すでに坂の高さにいる場合は同じ坂面を選び続ける',!!rampFloor&&T.rogueChooseConnectedFloor(underRamp,rampFloor.y,rampFloor.y,false,rampFloor.id)?.id===rampFloor.id);
  const entry={x:ascendingRamp.ax+(ascendingRamp.bx-ascendingRamp.ax)*.02,z:ascendingRamp.az+(ascendingRamp.bz-ascendingRamp.az)*.02};
  const climb={x:ascendingRamp.ax+(ascendingRamp.bx-ascendingRamp.ax)*.20,z:ascendingRamp.az+(ascendingRamp.bz-ascendingRamp.az)*.20};
  const entryFloor=T.rogueFloorCandidatesAt(entry.x,entry.z,3).find(c=>c.kind==='ramp');
  const entryY=entryFloor?entryFloor.y:T.rogueFloorHeight(entry.x,entry.z);
  check('坂の低い接続端から軸方向へ歩くと傾斜面へ接続する',T.rogueDungeonMovePathAllowed(entry.x,entry.z,climb.x,climb.z,3,entryY,false),`floor=${entryY}`);
  check('傾斜面へ接続した後は床IDを連続して保持する',String(context.rogueRun.playerFloorSurfaceId||'').startsWith('classic:segment:'));
  const dx=ascendingRamp.bx-ascendingRamp.ax,dz=ascendingRamp.bz-ascendingRamp.az,len=Math.hypot(dx,dz),nx=dz/len,nz=-dx/len;
  const center={x:ascendingRamp.ax+dx*.55,z:ascendingRamp.az+dz*.55},limit=Shared.getRogueRamps(Shared.ROGUE_WALK_AREAS).find(g=>g.area===ascendingRamp).hwalk;
  const outer={x:center.x+nx*(limit+.3),z:center.z+nz*(limit+.3)},inner={x:center.x+nx*(limit-.3),z:center.z+nz*(limit-.3)};
  context.rogueRun.playerFloorSurfaceId=null;
  const canMoveOnLowerFloor=T.rogueDungeonMovePathAllowed(outer.x,outer.z,inner.x,inner.z,3,0,false);
  check('低い床から坂の側面を横切って、床の高さのまま坂の中へは入れない',canMoveOnLowerFloor===false,`allowed=${canMoveOnLowerFloor} surface=${context.rogueRun.playerFloorSurfaceId}`);
}else check('低層床と重なる傾斜路がある',false);
// A location that only has an upper surface cannot be entered from below while grounded.
let foundHighOnly=null;
for(let x=-58;x<=-28&&!foundHighOnly;x+=.25){for(let z=-82;z<=-55;z+=.25){
  const c=T.rogueFloorCandidatesAt(x,z,3);
  if(c.length&&c.every(s=>s.y>.6)){foundHighOnly={x,z,c};break;}
}}
if(foundHighOnly){
  check('低い床から上段しかない場所へはその高さのままでは移れない',T.rogueChooseConnectedFloor(foundHighOnly.c,0,0,false)===null);
  const top=foundHighOnly.c.reduce((best,c)=>c.y>best.y?c:best,foundHighOnly.c[0]);
  check('ジャンプで上段の高さまで達したら上段床を選べる',Math.abs((T.rogueChooseConnectedFloor(foundHighOnly.c,0,top.y-.05,true)?.y||0)-top.y)<.05);
}else check('上段床だけが存在する位置を検出できる',false);
check('傾斜路の複数サンプルを通る連続移動は許可する',ramps.length>=3);
for(const a of ramps){
  const dx=a.bx-a.ax,dz=a.bz-a.az;
  const start={x:a.ax+dx*.12,z:a.az+dz*.12},end={x:a.ax+dx*.88,z:a.az+dz*.88};
  const foot=T.rogueFloorHeight(start.x,start.z);
  check(`坂${a.ax},${a.az}から${a.bx},${a.bz}へ軸方向に進める`,T.rogueDungeonMovePathAllowed(start.x,start.z,end.x,end.z,3,foot,false));
}
const descending=ramps.find(a=>a.ax===14&&a.az===-93&&a.bx===30&&a.bz===-95);
if(descending){
  const dx=descending.bx-descending.ax,dz=descending.bz-descending.az;
  const start={x:descending.ax+dx*.94,z:descending.az+dz*.94},end={x:descending.ax+dx*1.18,z:descending.az+dz*1.18};
  check('坂の端から軸方向に退出できる',T.rogueDungeonMovePathAllowed(start.x,start.z,end.x,end.z,3,T.rogueFloorHeight(start.x,start.z),false));
}
if(failures){console.error(`${failures} test(s) failed`);process.exit(1);}console.log('ALL PASSED');
