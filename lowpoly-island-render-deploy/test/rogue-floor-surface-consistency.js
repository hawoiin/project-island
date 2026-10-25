// v67.0: one shared floor/cutout definition drives rendering and movement surfaces.
'use strict';
const Shared=require('../public/shared.js');
let fails=0;function check(n,ok){console.log((ok?'PASS ':'FAIL ')+n);if(!ok)fails++;}
const areas=Shared.ROGUE_WALK_AREAS;
const central=areas.find(a=>a.type==='ellipse'&&a.x===0&&a.z===-83);
const lower=areas.find(a=>a.type==='ellipse'&&a.x===0&&a.z===-137);
check('central ravine and two ramp cutouts are stored with the room floor',!!central&&central.floorHoles?.length===3);
check('deep ramp cutout is stored with its room floor',!!lower&&lower.floorHoles?.some(h=>h.type==='corridor'&&h.az===-152));
check('visible central bridge resolves to a real bridge surface',Shared.getRogueDungeonFloorCandidates(0,-83,3).some(s=>s.id==='bridge:main'&&s.y===0));
check('visible eastern bridge resolves to a real bridge surface',Shared.getRogueDungeonFloorCandidates(15,-83,3).some(s=>s.id==='bridge:east'&&s.y===0));
check('unbridged part of the ravine has no floor candidate',Shared.getRogueDungeonFloorCandidates(8,-83,3).length===0&&!Shared.isRogueDungeonWalkable(8,-83,3));
check('side branch cutout does not invent an upper-room floor',!Shared.getRogueDungeonFloorCandidates(18,-92,3).some(s=>s.id==='ellipse:4'));
check('ramp itself remains a physical floor surface',Shared.getRogueDungeonFloorCandidates(22.5,-92.5,3).some(s=>s.kind==='ramp'));
check('deep ramp cutout does not retain the floor above it',!Shared.getRogueDungeonFloorCandidates(0,-160,3).some(s=>s.id==='ellipse:10'));
check('deep ramp itself remains a physical floor surface',Shared.getRogueDungeonFloorCandidates(0,-160,3).some(s=>s.kind==='ramp'));
check('segment candidates are constrained to the actual rectangle length',Shared.getRogueDungeonFloorCandidates(0,-120.8,3).some(s=>s.kind==='ramp')===true && Shared.getRogueDungeonFloorCandidates(0,-124.5,3).some(s=>s.kind==='ramp')===false);
check('closed gate still blocks floor access',!Shared.isRogueDungeonWalkable(0,-52,0)&&Shared.isRogueDungeonWalkable(0,-52,1));
if(fails){console.error(`${fails} floor-surface checks failed`);process.exit(1);}console.log('ALL PASSED');
