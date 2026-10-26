'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
// v70.5: 断面リングで作る連続した体・頭・顎、先細りの太い四肢、趾行の後脚、光る目。
assert.match(html,/function rogueRingLoftGeometry\(rings,topHex,bottomHex\)/);
assert.doesNotMatch(html,/rogueLengthwiseLoftGeometry/);
for(const name of ['shadeBody','shadeSkull','shadeJaw'])assert.match(html,new RegExp(name+':rogueRingLoftGeometry'));
assert.match(html,/shadeHide:new THREE\.MeshStandardMaterial\(\{color:0xffffff,vertexColors:true/);
assert.match(html,/shadeUpperLeg:new THREE\.CylinderGeometry/);
assert.match(html,/shadeThigh:new THREE\.CylinderGeometry/);
assert.match(html,/shadeEye:new THREE\.MeshStandardMaterial\(\{color:0xffc15a,emissive:0xff8a1c/);
assert.match(html,/const buildLeg=o=>/);
assert.match(html,/front:true,phase:/);
assert.match(html,/front:false,phase:/);
assert.match(html,/visualRig=\{creature:true,body,torso,head,jaw,tail,legs/);
assert.match(html,/const jaw=new THREE\.Group\(\)/);
assert.match(html,/part\(tail,G\.shadeTailBase/);
// 箱の積み重ね・装甲・背中の棘に戻さない。
assert.doesNotMatch(html,/shadeTorso|shadeArmor|shadeFacePlate|shadeEyeGlow|visualRig=\{body,torso,head,jaw,arms,legs/);
console.log('Rogue shade cave-predator anatomy checks passed.');
