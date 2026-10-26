'use strict';
// シェイドのリグを three.js の代用スタブ上で実際に組み立て、形状の向き・接地・アニメーションを数値で確認する。
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const slice=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i);assert.ok(i>=0&&j>i,'marker not found: '+a);return html.slice(i,j);};
class V{constructor(){this.x=0;this.y=0;this.z=0;}set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}setScalar(s){this.x=this.y=this.z=s;return this;}}
class Color{constructor(hex){this.r=((hex>>16)&255)/255;this.g=((hex>>8)&255)/255;this.b=(hex&255)/255;}clone(){const c=new Color(0);c.r=this.r;c.g=this.g;c.b=this.b;return c;}lerp(c,t){this.r+=(c.r-this.r)*t;this.g+=(c.g-this.g)*t;this.b+=(c.b-this.b)*t;return this;}}
class Obj{constructor(){this.position=new V();this.rotation=new V();this.scale=new V().set(1,1,1);this.children=[];}add(c){c.parent=this;this.children.push(c);}}
class Group extends Obj{}
class Mesh extends Obj{constructor(g,m){super();this.geometry=g;this.material=m;}}
class BufferGeometry{setAttribute(n,a){(this.attrs=this.attrs||{})[n]=a;}computeVertexNormals(){}}
class F32{constructor(a,n){this.array=a;this.itemSize=n;}}
const geo=()=>class{constructor(...a){this.args=a;}};
const Mat=class{constructor(o){Object.assign(this,o);}};
global.THREE={Color,Group,Mesh,BufferGeometry,Float32BufferAttribute:F32,CylinderGeometry:geo(),IcosahedronGeometry:geo(),BoxGeometry:geo(),ConeGeometry:geo(),MeshStandardMaterial:Mat,MeshBasicMaterial:Mat};
global.performance={now:()=>0};
const code=`${slice('  function rogueRingLoftGeometry(','  const ROGUE_GEOMETRIES={')}
const ROGUE_GEOMETRIES={${slice('    shadeBody:rogueRingLoftGeometry','  };\n  const ROGUE_ATTACK_WARNING_GEO')}};
const ROGUE_ENEMY_MATS={${slice('    shade:new THREE.MeshStandardMaterial({color:0x514139','    crawler:new THREE.MeshStandardMaterial').replace(/,\s*$/,'')}};
function build(){const g=new THREE.Group();let visualRig=null;{${slice('      const M=ROGUE_ENEMY_MATS,G=ROGUE_GEOMETRIES;',"    }else{\n      const body=new THREE.Mesh(boss?")}}return visualRig;}
${slice('  function updateRogueEnemyVisual(e,dt){','  function makeRogueChest')}
return {ROGUE_GEOMETRIES,build,updateRogueEnemyVisual};`;
const api=new Function(code)();
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}

check('体・頭・顎の面はすべて外向き（符号付き体積が正）',()=>{
  for(const name of ['shadeBody','shadeSkull','shadeJaw']){
    const P=api.ROGUE_GEOMETRIES[name].attrs.position.array;let vol=0;
    for(let i=0;i<P.length;i+=9){const a=P.slice(i,i+3),b=P.slice(i+3,i+6),c=P.slice(i+6,i+9);
      vol+=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);}
    assert.ok(vol>0,name+' の面が内向き');
    assert.ok(api.ROGUE_GEOMETRIES[name].attrs.color,name+' に頂点色がない');
  }
});
const rig=api.build();
const rot=(y,z,a)=>[y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];
// 関節の連鎖を (y,z) 平面で辿り、各関節と足裏の位置を返す（torso 座標）。
function trace(leg){
  let y=rig.torso.position.y,z=0,ang=0;const pts=[];
  for(const j of [...leg.joints,leg.foot]){const [dy,dz]=rot(j.position.y,j.position.z,ang);y+=dy;z+=dz;pts.push({y,z});ang+=j.rotation.x;}
  const [by]=rot(-.07,0,ang);
  return {pts,bottom:(y+by+rig.body.position.y)*rig.body.scale.x};
}
const footBottom=leg=>trace(leg).bottom;
check('四肢4本・メッシュ数が予算内',()=>{
  assert.strictEqual(rig.legs.length,4);
  let n=0;(function c(o){if(o instanceof Mesh)n++;o.children.forEach(c);})(rig.body);
  assert.ok(n<=60,'メッシュ数が多すぎる: '+n);
});
check('後脚は4区間で、膝は前・かかと(飛節)は後ろへ突き出る。前脚は肘が後ろへ出る',()=>{
  const hind=rig.legs.find(l=>!l.front),front=rig.legs.find(l=>l.front);
  assert.strictEqual(hind.joints.length,3,'後脚は 股関節・膝・飛節 の3関節');
  const hp=trace(hind).pts.slice(1);   // [膝, 飛節, 足首]
  assert.ok(hp[0].z<hind.hip.position.z-.1,'膝が腰より前に出ていない');
  assert.ok(hp[1].z>hp[0].z+.15,'かかとが膝より後ろにない');
  assert.ok(hp[1].z>hp[2].z,'かかとが足先より後ろへ突き出ていない');
  const fp=trace(front).pts.slice(1);  // [肘, 足首]
  assert.ok(fp[0].z>front.hip.position.z+.08,'肘が肩より後ろへ出ていない');
});
check('静止時に4本の足裏が床に付く',()=>{
  for(const l of rig.legs)assert.ok(Math.abs(footBottom(l))<.02,`足裏の高さ ${footBottom(l).toFixed(3)}`);
});
const e={phase:'idle',targetX:0,targetZ:0,mesh:{position:{x:0,z:0}},rogueId:'abc',flash:0,visualRig:rig};
check('歩行中も足が床に潜らず、有限値のまま動く',()=>{
  e.targetX=.5;let min=9,max=-9;
  for(let i=0;i<240;i++){global.performance.now=()=>i*40;api.updateRogueEnemyVisual(e,.04);
    for(const l of rig.legs){const y=footBottom(l);min=Math.min(min,y);max=Math.max(max,y);
      for(const o of [l.hip,l.knee,l.foot])for(const k of ['x','y','z'])assert.ok(Number.isFinite(o.rotation[k]));}}
  assert.ok(min>-.03,'足が床に潜る: '+min.toFixed(3));
  assert.ok(max>.1,'歩行で足が持ち上がっていない');
});
check('予備動作で顎が開き、噛みつきで頭が前へ突き出る',()=>{
  e.targetX=0;e.phase='windup';
  for(let i=0;i<12;i++){global.performance.now=()=>i*40;api.updateRogueEnemyVisual(e,.04);}
  assert.ok(rig.jaw.rotation.x<-.4,'顎が開いていない（開くのは負の回転）');
  e.phase='recover';api.updateRogueEnemyVisual(e,.0);
  assert.ok(rig.head.position.z<rig.headBase[2]-.1,'頭が前へ突き出ていない');
  assert.ok(rig.head.rotation.x<rig.baseHeadX,'噛みつきで鼻先が下がっていない');
});
if(!process.exitCode)console.log('Rogue shade rig checks passed.');
