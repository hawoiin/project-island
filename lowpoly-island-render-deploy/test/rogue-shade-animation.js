'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const shared=fs.readFileSync(path.join(__dirname,'../public/shared.js'),'utf8');
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}
check('シェイドは連続した断面形状で体型を構成する',()=>{
  assert.match(html,/else if\(kind==='shade'&&!boss\)/);
  assert.match(html,/shadeTorso:rogueLoftGeometry/);
  assert.match(html,/shadeHead:rogueLoftGeometry/);
  assert.match(html,/shadeForearm:rogueLoftGeometry/);
  assert.match(html,/const torsoMesh=new THREE\.Mesh\(ROGUE_GEOMETRIES\.shadeTorso,mat\)/);
  assert.match(html,/const jaw=new THREE\.Group\(\)/);
  assert.match(html,/baseTorsoX:-\.15,baseTorsoZ:\.018,baseHeadX:-\.15/);
  assert.doesNotMatch(html,/shadeSpine|shadeSpike|shadeArmorPlate|shadeEyeGlow/);
});
check('歩行・予備動作・打撃・回復が基準姿勢を保って動く',()=>{
  assert.match(html,/visualRig=\{body,torso,head,jaw,arms,legs,gaitPhase/);
  assert.match(html,/rig\.gaitPhase\+\=dt\*/);
  assert.match(html,/leg\.hip\.rotation\.x=\(rig\.baseHipX\|\|0\)/);
  assert.match(html,/arm\.shoulder\.rotation\.x=idleSwing-windup/);
  assert.match(html,/rig\.jaw\.rotation\.x=/);
  assert.match(html,/rig\.torso\.rotation\.x=\(rig\.baseTorsoX\|\|0\)/);
  assert.match(html,/rig\.head\.rotation\.x=\(rig\.baseHeadX\|\|0\)/);
  for(const phase of ['windup','charge','recover']) assert.ok(html.includes(`e.phase==='${phase}'`),`missing ${phase} visual pose`);
  assert.match(html,/updateRogueEnemyVisual\(e,dt\);/);
});
check('敵AIと攻撃タイミングの共有サーバー処理を変更していない',()=>{
  assert.match(shared,/const ROGUE_ENEMY_PROFILES/);
  assert.match(shared,/state\.phase='windup'/);
  assert.match(shared,/roguePlayerHurt/);
});
if(!process.exitCode)console.log('Rogue shade animation checks passed.');
