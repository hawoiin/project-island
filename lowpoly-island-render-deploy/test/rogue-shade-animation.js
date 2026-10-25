'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const shared=fs.readFileSync(path.join(__dirname,'../public/shared.js'),'utf8');
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}
check('シェイドは人型・節足型ではなく四足の生物モデル',()=>{
  assert.match(html,/else if\(kind==='shade'&&!boss\)/);
  assert.match(html,/visualRig=\{creature:true,body,torso,head,tail,legs/);
  for(const part of ['shadeCreatureBody','shadeCreatureBelly','shadeCreatureNeck','shadeCreatureHead','shadeCreatureMuzzle','shadeCreaturePlate','shadeCreatureLegUpper','shadeCreatureLegLower','shadeCreatureFoot']) assert.ok(html.includes(part),`missing ${part}`);
  assert.match(html,/for\(const front of \[true,false\]\)/,'four legs should be generated from front/rear pairs');
  assert.match(html,/重なった外殻/);
  assert.doesNotMatch(html,/shadeChestPlate|shadeUpperArm|shadeForearm|shadeSkirtPanel/,'old humanoid parts must be removed');
});
check('四足歩行・攻撃前の低い構え・攻撃後の踏み込みを表示する',()=>{
  assert.match(html,/if\(rig\.creature\)/);
  assert.match(html,/rig\.gaitPhase\+\=/);
  assert.match(html,/leg\.hip\.rotation\.x=swing/);
  assert.match(html,/rig\.body\.position\.z=-lunge\*\.13/);
  for(const phase of ['windup','charge','recover']) assert.ok(html.includes(`e.phase==='${phase}'`),`missing ${phase} visual pose`);
  assert.match(html,/updateRogueEnemyVisual\(e,dt\);/);
});
check('敵AI・ダメージ・攻撃タイミングを管理する共有サーバーコードは変更対象外',()=>{
  assert.match(shared,/const ROGUE_ENEMY_PROFILES/);
  assert.match(shared,/state\.phase='windup'/);
  assert.match(shared,/this\.out\.sendTo\(victim\.id,\{t:'roguePlayerHurt'/);
});
if(!process.exitCode)console.log('Rogue shade creature checks passed.');
