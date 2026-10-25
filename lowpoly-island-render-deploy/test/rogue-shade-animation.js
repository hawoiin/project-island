'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const shared=fs.readFileSync(path.join(__dirname,'../public/shared.js'),'utf8');
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}
check('シェイドはプレイヤーと同じ箱形ローポリを基礎にした人型',()=>{
  assert.match(html,/else if\(kind==='shade'&&!boss\)/);
  assert.match(html,/shadeTorso:new THREE\.BoxGeometry/);
  assert.match(html,/shadeHead:new THREE\.BoxGeometry/);
  assert.match(html,/shadeUpperArm:new THREE\.BoxGeometry/);
  assert.match(html,/shadeFoot:new THREE\.BoxGeometry/);
  assert.match(html,/プレイヤーの完成した箱形シルエットを基準にした人型シェイド/);
  assert.doesNotMatch(html,/shadeCreatureBody|shadeCreaturePlate|shadeCreatureLegUpper/);
});
check('歩行・予備動作・打撃・回復が人型の部位に反映される',()=>{
  assert.match(html,/visualRig=\{body,torso,head,arms,legs,gaitPhase/);
  assert.match(html,/rig\.gaitPhase\+\=dt\*/);
  assert.match(html,/leg\.hip\.rotation\.x=swing/);
  assert.match(html,/arm\.shoulder\.rotation\.x=idleSwing-windup/);
  for(const phase of ['windup','charge','recover']) assert.ok(html.includes(`e.phase==='${phase}'`),`missing ${phase} visual pose`);
  assert.match(html,/updateRogueEnemyVisual\(e,dt\);/);
});
check('敵AIと攻撃タイミングを管理する共有サーバーコードは変更していない',()=>{
  assert.match(shared,/const ROGUE_ENEMY_PROFILES/);
  assert.match(shared,/state\.phase='windup'/);
  assert.match(shared,/roguePlayerHurt/);
});
if(!process.exitCode)console.log('Rogue shade humanoid checks passed.');
