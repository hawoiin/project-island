
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
// シェイドの原案は「暗い遺跡に潜む影の住人」。狼男・獣・ロボットへ寄る特徴が復活しないかを検査する。
assert.match(html,/>v70\.15<\/div>/);
assert.match(html,/shadeSkull:rogueRingLoftGeometry/);
assert.match(html,/shadeJaw:rogueRingLoftGeometry/);
assert.match(html,/shadeEye:new THREE\.MeshStandardMaterial\(\{color:0x9bdcff,emissive:0x348fc4/);
assert.match(html,/shadeMouth:new THREE\.BoxGeometry\(\.025,\.065,\.018\)/);
assert.match(html,/z:-\.285,w:\.10,hu:\.06,hl:\.055/,'頭部の前端を短く平たい形にする');
assert.match(html,/shadeLongClaw:new THREE\.ConeGeometry\(\.014,\.14,4\)/);
assert.match(html,/side\*\.078,\.02,-\.294/,'目を短い顔面の前側に配置');
assert.match(html,/side\*\.072,\.02,-\.306/,'シアンの光は横長で小さくする');
assert.doesNotMatch(html,/shadeEar|shadeFang|shadeBrow|shadePupil/,'獣耳・牙・眉の箱・縦瞳を追加しない');
assert.doesNotMatch(html,/0x85735f|0x6a574b|0xd6caae/,'淡い獣腹・象牙色の牙／爪の配色を使わない');
assert.match(html,/const baseLean=-\.55/,'前傾した人型の基準姿勢を維持');
assert.match(html,/const arms=\[\]/);
assert.match(html,/const legs=\[\]/);
console.log('Rogue shade shadow identity checks passed.');
