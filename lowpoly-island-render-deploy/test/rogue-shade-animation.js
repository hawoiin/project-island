'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const shared=fs.readFileSync(path.join(__dirname,'../public/shared.js'),'utf8');
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}
check('シェイドはぼろの外套をまとった人型として、連続した胴と3関節の腕・2脚で作られる',()=>{
  assert.match(html,/else if\(kind==='shade'&&!boss\)/);
  assert.match(html,/shadeTorso:rogueRingLoftGeometry/);
  assert.match(html,/shadeHood:rogueRingLoftGeometry/);
  assert.match(html,/shadeRobe:rogueRingLoftGeometry/);
  assert.match(html,/const baseLean=-\.45/);
  assert.match(html,/visualRig=\{humanoid:true,body,pelvis,torso,head,jaw,arms,legs/);
  assert.doesNotMatch(html,/visualRig=\{creature:true|visualRig=\{body,torso,head,jaw,arms,legs/);
});
check('歩行・腕の振り・攻撃予備動作・顎の開閉がクライアント側で動く',()=>{
  assert.match(html,/!rig\.humanoid\)return/);
  assert.match(html,/rig\.gaitPhase\+=\(dt\|\|0\)\*/);
  assert.match(html,/a\.shoulder\.rotation\.x=a\.baseS\+/);
  assert.match(html,/a\.elbow\.rotation\.x=a\.baseE-/);
  assert.match(html,/leg\.hip\.rotation\.x=leg\.baseHip\+swing\+/);
  assert.match(html,/leg\.knee\.rotation\.x=leg\.baseKnee-lift/);
  assert.match(html,/rig\.jaw\.rotation\.x=-\(/);
  for(const phase of ['windup','charge','recover']) assert.ok(html.includes(`e.phase==='${phase}'`),`missing ${phase} visual pose`);
});
check('裾・マント・発光(目・口の奥・胸の核)も予備動作と歩行に連動して動く',()=>{
  assert.match(html,/rig\.robe\.rotation\.x=-moving\*/);
  assert.match(html,/for\(const c of rig\.cloth\)\{/);
  assert.match(html,/rig\.mouth\.scale\.y=Math\.max\(\.001,open\)/);
  assert.match(html,/rig\.core\.scale\.set\(pulse,/);
  assert.match(html,/for\(const eye of rig\.eyes\)eye\.scale\.set\(/);
});
check('敵AI・攻撃タイミング・ダメージはサーバー処理を維持',()=>{
  assert.match(shared,/const ROGUE_ENEMY_PROFILES/);
  assert.match(shared,/state\.phase='windup'/);
  assert.match(shared,/roguePlayerHurt/);
});
if(!process.exitCode)console.log('Rogue shade animation checks passed.');
