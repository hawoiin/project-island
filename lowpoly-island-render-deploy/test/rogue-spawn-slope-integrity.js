// v61.8: 敵・宝箱の床上スポーンと重複床高、坂道の整合性を検証。
'use strict';
const assert=require('assert');
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const Shared=require('../public/shared.js');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
let checkedEnemies=0,checkedChests=0;
for(let seed=1;seed<=250;seed++){
  const layout=Shared.getRogueDungeonLayout(seed);
  for(const e of [...layout.enemies,layout.boss]){
    assert.ok(Shared.isRogueDungeonWalkable(e.x,e.z,Shared.ROGUE_GATE_Z.length),`enemy ${e.id} seed=${seed} must spawn on floor at ${e.x},${e.z}`);
    assert.ok(Shared.findRogueDungeonPath(0,12,e.x,e.z,Shared.ROGUE_GATE_Z.length).length>0,`enemy ${e.id} seed=${seed} must have a walkable route`);
    checkedEnemies++;
  }
  for(const chest of layout.chests){
    assert.ok(Shared.isRogueDungeonWalkable(chest.x,chest.z,Shared.ROGUE_GATE_Z.length),`chest seed=${seed} must spawn on floor at ${chest.x},${chest.z}`);
    checkedChests++;
  }
}
const start=html.indexOf('  const ROGUE_WALK_AREAS = Shared.ROGUE_WALK_AREAS;');
const end=html.indexOf('  function buildRogueDungeonInterior(){',start);
assert.ok(start>=0&&end>start,'dungeon floor helpers must be present');
const source=html.slice(start,end)+'\nglobalThis.__floorTest={rogueFloorHeight,isRogueWalkable};';
const context={Math,Number,Shared,rogueRun:null,THREE:{MathUtils:{clamp:(v,min,max)=>Math.min(max,Math.max(min,v))}}};
vm.runInNewContext(source,context,{timeout:1000});
const floor=context.__floorTest.rogueFloorHeight;
assert.ok(Math.abs(floor(0,-83))<.08,'the central chamber must remain on the continuous 0m floor');
assert.ok(Math.abs(floor(0,-112)-(-.6))<.08,'the single main ramp must interpolate continuously at its midpoint');
assert.ok(Math.abs(floor(0,-120.5)-(-1.1667))<.12,'the ramp must connect smoothly to the rear chamber');
assert.ok(Math.abs(floor(0,-166)-(-1.2))<.08,'the rear corridor and boss chamber must share their floor height');
assert.ok(/rootDir:\s*lowpoly-island-render-deploy/.test(fs.readFileSync(path.join(root,'..','render.yaml'),'utf8')),'repository-root Render config must point at the renamed folder');
console.log(`PASS safe spawns (${checkedEnemies} enemies/bosses, ${checkedChests} chests across 250 deterministic layouts)`);
console.log('PASS overlapping floor heights and ramp interpolation');
console.log('PASS renamed Render root directory config');
