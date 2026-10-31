'use strict';
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
let failures=0,passes=0;
function check(name,ok){console.log((ok?'PASS ':'FAIL ')+name);if(ok)passes++;else failures++;}
check('rogue player floor has no invented fallback when no connected surface exists',/return surface\?surface\.y:null;/.test(html));
check('rogue floor lookup exposes a finite-floor flag',/const y=roguePlayerFloorHeight\(x,z\);\s*return \{ y, inCave:true, hasFloor:Number\.isFinite\(y\) \};/.test(html));
check('no connected floor forces airborne physics instead of snapping to a guessed surface',/if \(isRogueDungeonFloor && !hasRogueDungeonFloor\) grounded=false;[\s\S]{0,900}else if\(isRogueDungeonFloor&&!hasRogueDungeonFloor\)[\s\S]{0,180}grounded=false;/.test(html));
check('void threshold is below deepest intended walkable floor',/const ROGUE_VOID_RECOVERY_Y = -9\.0;/.test(html)&&/player\.position\.y < ROGUE_VOID_RECOVERY_Y/.test(html));
check('safe position is initialized at the dungeon entry',/lastSafePos:\{x:player\.position\.x,y:INTERIOR_FLOOR_Y,z:player\.position\.z,surfaceId:null\}/.test(html));
check('safe position updates only while grounded on a valid walkable floor',/else if\(hasRogueDungeonFloor && grounded && Number\.isFinite\(groundY\)[\s\S]{0,520}rogueRun\.lastSafePos=\{x:player\.position\.x,y:landedSurface\.y,z:player\.position\.z,surfaceId:landedSurface\.id\}/.test(html));
check('void recovery restores a valid safe position and resets falling velocity',/player\.position\.set\(safe\.x,safe\.y,safe\.z\);[\s\S]{0,400}vy=0;grounded=true;wasGrounded=true;camSnap=true;/.test(html));
check('void recovery explicitly preserves carried equipment and does not call death handling',/直前の安全な床へ戻りました。携行品は失っていません。/.test(html)&&!/player\.position\.y < ROGUE_VOID_RECOVERY_Y[\s\S]{0,900}killPlayer\(\)/.test(html));
check('build preview fallback is separate from player physics',/const floorInfo = getPlayerFloor\(px, pz\);[\s\S]{0,350}const py = Number\.isFinite\(floorInfo\.y\) \? floorInfo\.y : \(inCaveIndex===ROGUE_DUNGEON_INDEX \? rogueFloorHeight\(px,pz\)/.test(html));
check('v70.13 title label is active',/<div id="versionLabel"[^>]*>v70\.13<\/div>/.test(html));
console.log(`奈落落下の保護テスト: ${passes}件合格、${failures}件失敗`);
if(failures)process.exitCode=1;
