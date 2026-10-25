// v65: 一本道の部屋列と共有床定義の幾何・到達性テスト
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const Shared=require('../public/shared.js');
const a=html.indexOf('  const ROGUE_WALK_AREAS = Shared.ROGUE_WALK_AREAS;');
const b=html.indexOf('  function buildRogueDungeonInterior(){',a);
if(a<0||b<a) throw new Error('Rogue terrain coordinate functions are missing');
const source=html.slice(a,b)+'\n globalThis.__rogueTest={ROGUE_WALK_AREAS,ROGUE_GATE_Z,rogueFloorHeight,isRogueWalkable,rogueFloorCandidatesAt,rogueCameraFloorHeight,rogueRockOverlapsPassage,rogueClipPolygonToEllipse,rogueCorridorFloorSlot,rogueInterpolatedFloor};';
const context={Math,Number,console,Shared,rogueRun:null,THREE:{MathUtils:{clamp:(v,min,max)=>Math.min(max,Math.max(min,v))}}};
vm.runInNewContext(source,context,{timeout:1000});
const g=context.__rogueTest;let failed=0;
function check(name,condition){console.log((condition?'PASS ':'FAIL ')+name);if(!condition)failed++;}
const near=(a,b,t=.08)=>Math.abs(a-b)<=t;
check('入口・前半・中央広間の床は0mで連続する',near(g.rogueFloorHeight(0,12),0)&&near(g.rogueFloorHeight(0,-37),0)&&near(g.rogueFloorHeight(0,-83),0));
check('中央広間から後方へ下る唯一の坂は高さを連続補間する',near(g.rogueFloorHeight(0,-103),0)&&near(g.rogueFloorHeight(0,-112),-.6)&&near(g.rogueFloorHeight(0,-121),-1.2));
check('後方の部屋とボス部屋は-1.2mの同じ床高で接続する',near(g.rogueFloorHeight(0,-137),-1.2)&&near(g.rogueFloorHeight(0,-184),-1.2));
check('旧裂け目の位置は広い連続床になっている',g.isRogueWalkable(0,-83,3)&&g.isRogueWalkable(8,-83,3)&&g.rogueFloorCandidatesAt(8,-83,3).length>0);
check('広間の外側は歩行可能な床として扱わない',!g.isRogueWalkable(42,-83,3)&&g.isRogueWalkable(0,-112,3));
check('本道の各接続区間は歩行可能',[[0,1,0],[0,-24,0],[0,-49,0],[0,-63,0],[0,-103,1],[0,-112,1],[0,-121,2],[0,-137,2],[0,-152,3],[0,-166,3],[0,-184,3]].every(([x,z,gates])=>g.isRogueWalkable(x,z,gates)));
check('門は本道上にあり、閉門時だけ通れない',g.ROGUE_GATE_Z.join(',')==='-56,-100,-158'&& !g.isRogueWalkable(0,-56,0)&&g.isRogueWalkable(0,-56,1)&&!g.isRogueWalkable(0,-100,1)&&g.isRogueWalkable(0,-100,2)&&!g.isRogueWalkable(0,-158,2)&&g.isRogueWalkable(0,-158,3));
check('旧分岐位置は本道外として扱い、敵・宝箱を端へ誤配置しない',!g.isRogueWalkable(-42,-66,3)&&!g.isRogueWalkable(44,-97,3));
check('坂の側面へ直接乗り上げる動きは遮断され、軸方向の進入は許可される',(()=>{const r=g.ROGUE_WALK_AREAS.find(a=>a.type==='segment'&&Math.abs((a.yB||0)-(a.yA||0))>1e-5);const dx=r.bx-r.ax,dz=r.bz-r.az,len=Math.hypot(dx,dz),nx=dz/len,nz=-dx/len,cx=(r.ax+r.bx)/2,cz=(r.az+r.bz)/2,limit=r.width*.45;return Shared.isRogueRampSideEntryBlocked(cx+nx*(limit+.3),cz+nz*(limit+.3),cx+nx*(limit-.3),cz+nz*(limit-.3))&&!Shared.isRogueRampSideEntryBlocked(r.ax,r.az,r.ax+(r.bx-r.ax)*.2,r.az+(r.bz-r.az)*.2);})());
check('安全床のカメラ高さと坂の床高が一致する',near(g.rogueCameraFloorHeight(0,-184),-.4)&&near(g.rogueCameraFloorHeight(0,-112),.2));
if(failed)process.exit(1);console.log('Rogue v65 geometry checks passed.');
