'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
// シェイドの輪郭: 肩の高い胴体、くさび形の頭、開閉する顎、太く先細りの四肢、折れた後脚、琥珀色に光る目。
assert.match(html,/shadeBody:rogueRingLoftGeometry/);
assert.match(html,/shadeSkull:rogueRingLoftGeometry/);
assert.match(html,/shadeJaw:rogueRingLoftGeometry/);
assert.match(html,/shadeUpperLeg:new THREE\.CylinderGeometry/);
assert.match(html,/shadeLowerLeg:new THREE\.CylinderGeometry/);
assert.match(html,/shadeThigh:new THREE\.CylinderGeometry/);
assert.match(html,/shadeShin:new THREE\.CylinderGeometry/);
assert.match(html,/const jaw=new THREE\.Group\(\)/);
assert.match(html,/hip:\.80,knee:-1\.50/);
assert.match(html,/shadeEye:new THREE\.MeshStandardMaterial\(\{color:0xffc15a,emissive:0xff8a1c/);
assert.match(html,/shadePupil:new THREE\.MeshBasicMaterial/);
assert.doesNotMatch(html,/shadeArmor|shadeFacePlate|shadeEyeGlow|visualRig=\{body,torso,head,jaw,arms,legs/);
console.log('Rogue shade silhouette checks passed.');
