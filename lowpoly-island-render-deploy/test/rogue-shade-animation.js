'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const shared=fs.readFileSync(path.join(__dirname,'../public/shared.js'),'utf8');
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}
check('シェイドは装甲や棘ではなく強い生物シルエットで構成される',()=>{
  assert.match(html,/else if\(kind==='shade'&&!boss\)/);
  assert.match(html,/shadeTorso:new THREE\.BoxGeometry\(\.62,\.70,\.46\)/);
  assert.match(html,/shadeShoulders:new THREE\.BoxGeometry/);
  assert.match(html,/shadeHead:new THREE\.BoxGeometry/);
  assert.match(html,/shadeJaw:new THREE\.BoxGeometry/);
  assert.match(html,/shadeForearm:new THREE\.BoxGeometry/);
  assert.match(html,/const jaw=new THREE\.Group\(\)/);
  assert.match(html,/shadeClaw:new THREE\.BoxGeometry/);
  assert.match(html,/片側の前腕と手をわずかに大きく/);
  assert.doesNotMatch(html,/shadeSpine|shadeSpike|shadeArmorPlate|shadeEyeGlow/);
});
check('歩行・予備動作・打撃・回復が人型の部位に反映される',()=>{
  assert.match(html,/visualRig=\{body,torso,head,jaw,arms,legs,gaitPhase/);
  assert.match(html,/rig\.gaitPhase\+\=dt\*/);
  assert.match(html,/leg\.hip\.rotation\.x=swing/);
  assert.match(html,/arm\.shoulder\.rotation\.x=idleSwing-windup/);
  assert.match(html,/rig\.jaw\.rotation\.x=/);
  for(const phase of ['windup','charge','recover']) assert.ok(html.includes(`e.phase==='${phase}'`),`missing ${phase} visual pose`);
  assert.match(html,/updateRogueEnemyVisual\(e,dt\);/);
});
check('敵AIと攻撃タイミングを管理する共有サーバーコードは変更していない',()=>{
  assert.match(shared,/const ROGUE_ENEMY_PROFILES/);
  assert.match(shared,/state\.phase='windup'/);
  assert.match(shared,/roguePlayerHurt/);
});
if(!process.exitCode)console.log('Rogue shade humanoid checks passed.');
