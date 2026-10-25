// v65: 本道にある1本の坂で、高さ補間と端部の接続を検査する。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(path.join(__dirname,'..','public/index.html'),'utf8');
const Shared=require('../public/shared.js');
const helperStart=html.indexOf('  const ROGUE_DUNGEON_INDEX = Shared.ROGUE_DUNGEON_INDEX;');
const helperEnd=html.indexOf('  // 岩の中心線だけでなく',helperStart);
const moveStart=html.indexOf('  function rogueDungeonMovePathAllowed(',helperEnd);
const moveEnd=html.indexOf('  function constrainRogueDungeonPosition(',moveStart);
if(helperStart<0||helperEnd<=helperStart||moveStart<0||moveEnd<=moveStart)throw new Error('unified floor movement helpers not found');
const context={Shared,Math,Number,rogueRun:{openGates:3},grounded:true,player:{position:{y:0}},THREE:{MathUtils:{clamp:(v,min,max)=>Math.min(max,Math.max(min,v))}}};
vm.runInNewContext(html.slice(helperStart,helperEnd)+html.slice(moveStart,moveEnd)+'\nglobalThis.__test={ROGUE_WALK_AREAS,rogueFloorHeight,rogueFloorCandidatesAt,rogueDungeonMovePathAllowed};',context,{timeout:1000});
const T=context.__test;let failures=0;
function check(name,ok,details=''){console.log((ok?'PASS ':'FAIL ')+name+(ok?'':' '+details));if(!ok)failures++;}
const ramps=T.ROGUE_WALK_AREAS.filter(a=>a.type==='segment'&&Math.abs((a.yB||0)-(a.yA||0))>1e-5);
check('本道に高さが変わる坂は1本だけ',ramps.length===1,`ramps=${ramps.length}`);
if(ramps.length===1){
 const r=ramps[0],entry={x:0,z:-103.5},mid={x:0,z:-112},exit={x:0,z:-120.5};
 check('坂の入口は中央広間の0m床と接続する',Math.abs(T.rogueFloorHeight(entry.x,entry.z))<.1);
 check('坂の中間は連続的に低くなる',Math.abs(T.rogueFloorHeight(mid.x,mid.z)+.6)<.1);
 check('坂の出口は後方部屋の-1.2m床に接続する',Math.abs(T.rogueFloorHeight(exit.x,exit.z)+1.2)<.1);
 check('坂の中間区間を軸方向に移動できる',T.rogueDungeonMovePathAllowed(0,-107,0,-116,3,-.25,false));
 check('旧横方向の段差ルートや細い分岐坂が残っていない',ramps.every(a=>a.ax===0&&a.bx===0&&a.az===-103&&a.bz===-121&&a.width===12));
}
if(failures){console.error(`${failures} test(s) failed`);process.exit(1);}console.log('ALL PASSED');
