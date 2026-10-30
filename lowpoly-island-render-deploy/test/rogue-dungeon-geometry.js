// 実際のダンジョン座標関数をVM内で実行し、高低差と裂け目の通行判定を確認する。
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
const Shared=require('../public/shared.js');
const a=html.indexOf('  const CLASSIC_ROGUE_DUNGEON_INDEX = Shared.ROGUE_DUNGEON_INDEX;');
const b=html.indexOf('  function buildRogueDungeonInterior(){',a);
if(a<0||b<a) throw new Error('Rogue terrain coordinate functions are missing');
const source=html.slice(a,b)+'\n globalThis.__rogueTest={ROGUE_WALK_AREAS,ROGUE_GATE_Z,rogueFloorHeight,isRogueWalkable,rogueCameraFloorHeight,rogueRockOverlapsPassage,rogueClipPolygonToEllipse,rogueCorridorFloorSlot,rogueInterpolatedFloor};';
const context={Math,Number,console,Shared,rogueRun:null,THREE:{MathUtils:{clamp:(v,min,max)=>Math.min(max,Math.max(min,v))}}};
vm.runInNewContext(source,context,{timeout:1000});
const g=context.__rogueTest;
let failed=0;function check(name,condition){console.log((condition?'PASS ':'FAIL ')+name);if(!condition)failed++;}
const near=(a,b,t=.08)=>Math.abs(a-b)<=t;
check('入口広間は通常床の高さ0にある',near(g.rogueFloorHeight(0,12),0));
check('西の分岐は3.8m高い高台になる',near(g.rogueFloorHeight(-42,-66),3.8));
check('西側の斜路は床高を連続補間する',near(g.rogueFloorHeight(-21.5,-73.5),1.9));
check('東の水晶窪地は2.6m低い',near(g.rogueFloorHeight(44,-97),-2.6));
check('深層は5.2m低く、下降路は中間高になる',near(g.rogueFloorHeight(0,-184),-5.2)&&near(g.rogueFloorHeight(0,-159),-3.3));
check('裂け目は中央橋から渡れる',g.isRogueWalkable(0,-83,3)===true);
check('裂け目の橋以外の中央部分は横断できない',g.isRogueWalkable(8,-83,3)===false);
check('裂け目の東側の細い橋は渡れる',g.isRogueWalkable(15,-83,3)===true);
check('橋の見た目の幅から外れた位置は安全な足場として扱わない',g.isRogueWalkable(1.7,-83,3)===false&&g.isRogueWalkable(16.2,-83,3)===false);
check('床の輪郭の外側は歩行可能にせず、橋や坂の端から落ちにくくする',g.isRogueWalkable(-35,-90,3)===false&&g.isRogueWalkable(-33.5,-90,3)===true&&g.isRogueWalkable(0,-160,3)===true&&g.isRogueWalkable(4.8,-160,3)===false&&g.isRogueWalkable(4.4,-160,3)===true);
check('裂け目の端を回り込んで通り抜けられない',g.isRogueWalkable(30,-83,3)===false);
check('閉じた最初の封印門は通れない',g.isRogueWalkable(0,-52,0)===false);
check('敵を倒して門を開けば前進できる',g.isRogueWalkable(0,-52,1)===true);
check('入口から西の高台・東の窪地・深層坂の接続地点が歩行範囲でつながる',[[0,1,0],[0,-24,0],[0,-49,0],[0,-63,0],[0,-103,0],[0,-121,0],[0,-152,0],[0,-166,0],[-14,-78,0],[-29,-69,0],[15,-90,3],[30,-95,3]].every(([x,z,gates])=>g.isRogueWalkable(x,z,gates)));
check('後半の封印門も開閉状態と同じ歩行判定になる',g.isRogueWalkable(0,-110,1)===false&&g.isRogueWalkable(0,-110,2)===true&&g.isRogueWalkable(0,-158,2)===false&&g.isRogueWalkable(0,-158,3)===true);
check('奥の深層カメラは床高-5.2mに合わせてクリップする',Math.abs(g.rogueCameraFloorHeight(0,-184)-(-4.4))<.08);
check('中央の裂け目では仮想の0m床をカメラに適用しない',g.rogueCameraFloorHeight(8,-83)===null);
check('カメラ床判定は室内の端で少し余裕を持ちつつ、重なった低地と裂け目を正しく判定する',Math.abs(g.rogueCameraFloorHeight(35,-90)-(-1.8))<.1&&g.rogueCameraFloorHeight(8,-83)===null);
check('カメラ床判定は傾斜路の高さを使う',Math.abs(g.rogueCameraFloorHeight(0,-159)-(-2.5))<.12);
check('岩の見た目サイズを含めると通路上の岩を検出できる',g.rogueRockOverlapsPassage(0,-32,2,2,.55)===true);
check('通路から十分離れた岩は岩縁装飾として残せる',g.rogueRockOverlapsPassage(48,-180,2,2,.55)===false);
const clippedSlots=[
  {p:g.rogueCorridorFloorSlot(15,-90,30,-95,9.2,0,5.2,{cx:0,cz:-83,rx:36,rz:25}),cx:0,cz:-83,rx:36,rz:25},
  {p:g.rogueCorridorFloorSlot(0,-103,0,-121,10.8,0,6.8,{cx:0,cz:-83,rx:36,rz:25}),cx:0,cz:-83,rx:36,rz:25},
  {p:g.rogueCorridorFloorSlot(0,-152,0,-166,10.8,0,4.0,{cx:0,cz:-137,rx:27,rz:18}),cx:0,cz:-137,rx:27,rz:18}
];
check('傾斜路の床切り欠きは広間の外周を横切らない',clippedSlots.every(slot=>slot.p.points.length>=3&&slot.p.points.every(pt=>(((pt.x-slot.cx)/(slot.rx*.986))**2+((pt.z-slot.cz)/(slot.rz*.986))**2)<=1.002)));
check('深層の通路脇の岩も仮の0mでなく傾斜路の高さへ追従する',Math.abs(g.rogueInterpolatedFloor(-152,-166,-1.4,-5.2,-160)-(-3.5714285714))<.02&&Math.abs(g.rogueInterpolatedFloor(-152,-166,-1.4,-5.2,-166)-(-5.2))<.02);
{
  // v70.10: 通路入口に床のない隙間(見えない壁)ができないこと。実際の歩行判定と床候補を細かく走査する。
  let gaps=0;
  for(const v of ['classic','linear']){
    const G=Shared.getRogueDungeonDefinition(v).gates.length;
    for(let x=-100;x<=100;x+=.25)for(let z=-220;z<=40;z+=.25){
      if(Shared.isRogueDungeonWalkable(x,z,G,v)&&!Shared.getRogueDungeonFloorCandidates(x,z,G,v).length)gaps++;
    }
  }
  check('歩行可能なのに床候補がない点が両ダンジョンに存在しない',gaps===0);
  check('床高が0mでない平らな通路(新ダンジョン深層への通路)も描画床高の補間対象になる',/Math\.abs\(a\.yA\|\|0\)<1e-5\) continue;/.test(html));
}
if(failed)process.exit(1);console.log('Rogue geometry runtime checks passed.');
