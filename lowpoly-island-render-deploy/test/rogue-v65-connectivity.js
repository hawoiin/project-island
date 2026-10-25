// v65 acceptance smoke test: rooms, combat phases and rewards are reachable on connected ground.
'use strict';
const assert=require('assert');
const Shared=require('../public/shared.js');
const l=Shared.getRogueDungeonLayout(12345);
assert.equal(Shared.ROGUE_WALK_AREAS.filter(a=>a.type==='segment'&&Math.abs((a.yB||0)-(a.yA||0))>1e-5).length,1);
assert.equal(l.chests.length,5,'keep all five dungeon chests');
for(const e of [...l.enemies,l.boss]){
  assert(Shared.isRogueDungeonWalkable(e.x,e.z,3),`enemy ${e.id} must spawn on floor at ${e.x},${e.z}`);
  assert(Shared.getRogueDungeonFloorCandidates(e.x,e.z,3).length,`enemy ${e.id} must have a real floor candidate`);
}
for(let i=0;i<l.chests.length;i++){
  const c=l.chests[i];
  assert(Shared.isRogueDungeonWalkable(c.x,c.z,3),`chest ${i} must be on floor at ${c.x},${c.z}`);
  assert(Shared.getRogueDungeonFloorCandidates(c.x,c.z,3).length,`chest ${i} must have a real floor candidate`);
}
const stages=[{x:0,z:-37},{x:0,z:-83},{x:0,z:-137},{x:0,z:-184}];
for(const p of stages)assert(Shared.isRogueDungeonWalkable(p.x,p.z,3),`stage anchor ${p.z} must be walkable`);
assert(Shared.findRogueDungeonPath(0,-37,0,-83,0).length===0,'closed gate 1 must stop the stage 0 route');
assert(Shared.findRogueDungeonPath(0,-37,0,-83,1).length>0,'stage 0 to stage 1 route opens after gate 1');
assert(Shared.findRogueDungeonPath(0,-83,0,-137,1).length===0,'closed gate 2 must stop the central-to-rear route');
assert(Shared.findRogueDungeonPath(0,-83,0,-137,2).length>0,'central room over single ramp to rear room after gate 2');
assert(Shared.findRogueDungeonPath(0,-137,0,-184,2).length===0,'closed gate 3 must stop the rear-to-boss route');
assert(Shared.findRogueDungeonPath(0,-137,0,-184,3).length>0,'rear room to boss room after gate 3');
console.log('PASS v65 main path, enemy positions, and all individual chest positions');
