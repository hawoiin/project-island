'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const shared=fs.readFileSync(path.join(__dirname,'../public/shared.js'),'utf8');
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}
check('シェイド専用の人型リグがあり、腕・肘・脚を独立して動かせる',()=>{
  assert.match(html,/else if\(kind==='shade'&&!boss\)/);
  assert.match(html,/visualRig=\{body,torso,head,arms,legs/);
  assert.match(html,/shadeUpperArm/);assert.match(html,/shadeForearm/);assert.match(html,/shadeThigh/);assert.match(html,/shadeShin/);
  assert.match(html,/shadeChestPlate/);assert.match(html,/shadeFacePlate/);assert.match(html,/shadeShoulder/);
  assert.match(html,/shadeUpperArm:new THREE\.CylinderGeometry/);assert.match(html,/shadeThigh:new THREE\.CylinderGeometry/);
  assert.doesNotMatch(html,/shadeCrest/,'人型の輪郭を崩す突起形状は使わない');
  assert.match(html,/爪は手の先に小さく付け/);
});
check('歩行・予備動作・攻撃後硬直に応じて見た目だけをアニメーションする',()=>{
  assert.match(html,/function updateRogueEnemyVisual\(e,dt\)/);
  for(const phase of ['windup','charge','recover']) assert.ok(html.includes(`e.phase==='${phase}'`),`missing ${phase} visual pose`);
  assert.match(html,/updateRogueEnemyVisual\(e,dt\);/);
});
check('敵AI・ダメージ・攻撃タイミングを管理する共有サーバーコードは変更対象外',()=>{
  assert.match(shared,/const ROGUE_ENEMY_PROFILES/);
  assert.match(shared,/state\.phase='windup'/);
  assert.match(shared,/this\.out\.sendTo\(victim\.id,\{t:'roguePlayerHurt'/);
});
if(!process.exitCode)console.log('Rogue shade visual checks passed.');
