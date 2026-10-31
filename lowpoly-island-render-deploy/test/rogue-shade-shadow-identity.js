'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
// シェイドの原案は「暗い遺跡に潜む影の住人」。v70.17 でぼろの外套をまとった亡霊の姿にした。
// この見た目の芯が崩れないこと、狼男・獣・ロボットへ寄る特徴が復活しないことを検査する。
assert.match(html,/>v70\.21<\/div>/);
// 芯: フード・外套・長い裾・淡い仮面と角・肩の結晶・胸の核
for(const name of ['shadeTorso','shadeMantle','shadeRobe','shadeHood'])assert.match(html,new RegExp(name+':rogueRingLoftGeometry'),name+' がない');
assert.match(html,/shadeMask:new THREE\.CylinderGeometry/,'前面が平らな仮面の板');
assert.match(html,/shadeHorn:new THREE\.ConeGeometry/,'後ろへ流れる角');
assert.match(html,/shadeShard:new THREE\.ConeGeometry/,'肩の結晶');
assert.match(html,/shadeCore:new THREE\.OctahedronGeometry/,'胸の核');
assert.match(html,/shadeCloth:new THREE\.MeshStandardMaterial\([^)]*side:THREE\.DoubleSide/,'ぼろ布は両面');
assert.match(html,/shadeEye:new THREE\.MeshStandardMaterial\(\{color:0xa8f0ff,emissive:0x3fd0ff/,'目の発光は青白い');
assert.match(html,/shadeCrystal:new THREE\.MeshStandardMaterial\(\{color:0xb9a6ff,emissive:0x6a42ff/,'結晶の発光は紫');
// 暗い面の上で目だけが光る(淡い縁の板 + 暗い面)
assert.match(html,/part\(head,G\.shadeMask,M\.shadeMantle,/,'仮面の暗い面');
assert.match(html,/const baseLean=-\.45/,'少し前へ屈む基準姿勢');
assert.match(html,/const arms=\[\]/);
assert.match(html,/const legs=\[\]/);
assert.match(html,/const cloth=\[\]/);
// 戻してはいけない特徴
assert.doesNotMatch(html,/shadeEar|shadeFang|shadeBrow|shadePupil|shadeSkull|shadeSocket/,'獣耳・牙・眉・縦瞳・旧頭蓋を追加しない');
assert.doesNotMatch(html,/0x85735f|0x6a574b|0xd6caae/,'淡い獣腹・象牙色の牙／爪の配色を使わない');
assert.doesNotMatch(html,/shadeArmor|shadeFacePlate|shadeTail/,'金属の鎧・尾は使わない');
// 浮いて見える部品を作らない: 円錐は根元を部品へ埋める spike() 経由で置く
assert.match(html,/const spike=\(parent,geo,mat,bx,by,bz,len,rx,rz,sc=1\)=>/);
console.log('Rogue shade shadow identity checks passed.');
