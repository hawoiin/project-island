// v70.11: 両方のダンジョン描画関数を three.js の代用品の上で最後まで実行し、坂の形状が組み込まれることを確認する。
// (ブラウザーでの見た目の確認ではなく、実行時エラー・頂点の異常・坂メッシュの数の確認)
'use strict';
const fs=require('fs'),vm=require('vm');
let failed=0;function check(name,ok,details=''){console.log((ok?'PASS ':'FAIL ')+name+(ok?'':' '+details));if(!ok)failed++;}
const html=fs.readFileSync(require('path').join(__dirname,'..','public','index.html'),'utf8');
const Shared=require('../public/shared.js');
const a=html.indexOf('  const CLASSIC_ROGUE_DUNGEON_INDEX = Shared.ROGUE_DUNGEON_INDEX;');
const bStart=html.indexOf('  function buildLinearRogueDungeonInterior(){');
// end of linear builder: next top-level function after it
const rest=html.slice(bStart+10);
const m=rest.search(/\n  [^ \n}]/);
const end=bStart+10+m;
const src=html.slice(a,end)+'\nglobalThis.__b={setActiveRogueDungeon,buildRogueDungeonInterior,buildLinearRogueDungeonInterior};';
function mk(){const t=function(){};return new Proxy(t,{
  get(o,k){if(k==='holes')return o.__h||(o.__h=[]);if(k===Symbol.toPrimitive)return()=>0;if(k==='then')return undefined;return o[k]||(o[k]=mk());},
  set(o,k,v){o[k]=v;return true;},apply(){return mk();},construct(){return mk();}});}
class Scene{constructor(){this.children=[];this.userData={};}add(c){this.children.push(c);}}
class Mesh{constructor(g,mat){this.geometry=g;this.material=mat;this.userData={};this.position=mk();this.rotation=mk();this.scale=mk();}}
class BufferGeometry{constructor(){this.attrs={};}setAttribute(n,v){this.attrs[n]=v;}setIndex(){}computeVertexNormals(){}rotateX(){}rotateZ(){}translate(){}}
class F32{constructor(arr,n){this.array=arr;this.itemSize=n;}}
const T=new Proxy({Scene,Mesh,BufferGeometry,Float32BufferAttribute:F32,MathUtils:{clamp:(v,a,b)=>Math.min(b,Math.max(a,v))},
  MeshStandardMaterial:class{constructor(o){Object.assign(this,o);}},DoubleSide:2,BackSide:1},{get(t,k){return k in t?t[k]:mk();}});
const ctx={Math,Number,Object,Infinity,console,Shared,THREE:T,NETINIT:{welcome:{seed:12345}},rogueRun:null,roughen:g=>g,Array,Map,Set,Float32Array};
vm.runInNewContext(src,ctx,{timeout:20000});
const B=ctx.__b;
for(const [name,idx,fn] of [['classic',Shared.ROGUE_DUNGEON_INDEX,'buildRogueDungeonInterior'],['linear',Shared.ROGUE_LINEAR_DUNGEON_INDEX,'buildLinearRogueDungeonInterior']]){
  B.setActiveRogueDungeon(idx);
  const res=B[fn]();
  const ramps=res.scene.children.filter(c=>c&&c.userData&&c.userData.rogueRamp===true);
  let tris=0,bad=0;
  for(const m of ramps){const arr=m.geometry.attrs.position.array;tris+=arr.length/9;if(arr.length%9)bad++;for(const v of arr)if(!Number.isFinite(v))bad++;}
  const expected=name==='classic'?4*3:1*3;
  check(`${name}: 坂の専用メッシュが ${expected} 個(坂ごとに面・側面・溝)組み込まれる`,ramps.length===expected,`meshes=${ramps.length}`);
  check(`${name}: 坂の頂点はすべて有限値で、三角形として完結している`,bad===0&&tris>0,`bad=${bad} tris=${tris}`);
  check(`${name}: 坂の三角形数が描画予算に収まる`,tris<4000,`tris=${tris}`);
}
if(failed)process.exit(1);console.log('Rogue ramp build smoke checks passed.');
