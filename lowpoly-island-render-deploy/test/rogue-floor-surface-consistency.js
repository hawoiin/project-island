// v65: 描画・移動が共用する床定義の一貫性チェック
'use strict';
const assert=require('assert');
const Shared=require('../public/shared.js');
const areas=Shared.ROGUE_WALK_AREAS;
const ramps=areas.filter(a=>a.type==='segment'&&Math.abs((a.yB||0)-(a.yA||0))>1e-5);
assert.equal(ramps.length,1,'the new dungeon should have one and only one height-changing ramp');
const ramp=ramps[0];
assert.equal(ramp.az,-103);assert.equal(ramp.bz,-121);assert.equal(ramp.width,12);
for(let i=0;i<=18;i++){
  const z=-103-i;
  const c=Shared.getRogueDungeonFloorCandidates(0,z,3);
  assert(c.length>0,`main path must have a floor candidate at z=${z}`);
  assert(Shared.isRogueDungeonWalkable(0,z,3),`main path must be walkable at z=${z}`);
}
assert(Shared.getRogueDungeonFloorCandidates(8,-83,3).length>0,'the former ravine must be continuous floor');
assert(Shared.isRogueDungeonWalkable(0,-56,0)===false,'first closed gate blocks path');
assert(Shared.isRogueDungeonWalkable(0,-56,1)===true,'first gate opens after stage 0');
assert(Shared.isRogueDungeonWalkable(0,-100,1)===false,'second closed gate blocks path');
assert(Shared.isRogueDungeonWalkable(0,-100,2)===true,'second gate opens after stage 1');
assert(Shared.isRogueDungeonWalkable(0,-158,2)===false,'third closed gate blocks path');
assert(Shared.isRogueDungeonWalkable(0,-158,3)===true,'third gate opens after stage 2');
console.log('PASS unified floor surfaces and gate connectivity');
