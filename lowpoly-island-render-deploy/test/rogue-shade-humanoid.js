'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
// v70.7: 連続胴・頭・顎と人型リグを維持し、狼男の特徴（耳・牙・長い鼻面・獣毛色の腹）を減らす。
assert.match(html,/function rogueRingLoftGeometry\(rings,topHex,bottomHex\)/);
assert.doesNotMatch(html,/rogueLengthwiseLoftGeometry/);
for(const name of ['shadeTorso','shadeSkull','shadeJaw'])assert.match(html,new RegExp(name+':rogueRingLoftGeometry'));
assert.match(html,/shadeHide:new THREE\.MeshStandardMaterial\(\{color:0xffffff,vertexColors:true/);
assert.match(html,/const pelvis=new THREE\.Group\(\)/);
assert.match(html,/const arms=\[\];/);
assert.match(html,/const legs=\[\];/);
assert.match(html,/const wrist=new THREE\.Group\(\)/);
assert.doesNotMatch(html,/shadeBody|shadeUpperLeg|shadeMetatarsus|shadeTorso:new THREE\.BoxGeometry|shadeArmor|shadeFacePlate/);
console.log('Rogue shade humanoid anatomy checks passed.');
