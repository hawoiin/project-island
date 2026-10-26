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
global.THREE={Color,Group,Mesh,BufferGeometry,Float32BufferAttribute:F32,CylinderGeometry:geo(),IcosahedronGeometry:geo(),OctahedronGeometry:geo(),BoxGeometry:geo(),ConeGeometry:geo(),MeshStandardMaterial:Mat,MeshBasicMaterial:Mat};
global.performance={now:()=>0};
const code=`${slice('  function rogueRingLoftGeometry(','  const ROGUE_GEOMETRIES={')}
const ROGUE_GEOMETRIES={${slice('    shadeTorso:rogueRingLoftGeometry','  };\n  const ROGUE_ATTACK_WARNING_GEO')}};
const ROGUE_ENEMY_MATS={${slice('    shade:new THREE.MeshStandardMaterial({color:0x293044','    crawler:new THREE.MeshStandardMaterial').replace(/,\s*$/,'')}};
function build(){const g=new THREE.Group();let visualRig=null;{${slice('      const M=ROGUE_ENEMY_MATS,G=ROGUE_GEOMETRIES;',"    }else{\n      const body=new THREE.Mesh(boss?")}}return visualRig;}
${slice('  function updateRogueEnemyVisual(e,dt){','  function makeRogueChest')}
return {ROGUE_GEOMETRIES,build,updateRogueEnemyVisual};`;
const api=new Function(code)();
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}

const rig=api.build();
const rot=(y,z,a)=>[y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];
// (y,z) 平面で関節の連鎖を辿る。nodes は親から順の関節群、tip は最後の関節の局所座標の点。
function trace(nodes,tip){
  let y=rig.pelvis.position.y,z=0,ang=0;
  for(const n of nodes){const [dy,dz]=rot(n.position.y,n.position.z,ang);y+=dy;z+=dz;ang+=n.rotation.x;}
  const [ty,tz]=rot(tip[0],tip[1],ang);
  return {y:(y+ty+rig.body.position.y)*rig.body.scale.x,z:(z+tz)*rig.body.scale.x};
}
const footBottom=l=>trace([l.hip,l.knee,l.foot],[-.07,0]).y;
const handTip=a=>trace([rig.torso,a.shoulder,a.elbow,a.wrist],[-.36,0]);
check('胴・頭・顎の面はすべて外向き（符号付き体積が正）',()=>{
  for(const name of ['shadeTorso','shadeSkull','shadeJaw']){
    const P=api.ROGUE_GEOMETRIES[name].attrs.position.array;let vol=0;
    for(let i=0;i<P.length;i+=9){const a=P.slice(i,i+3),b=P.slice(i+3,i+6),c=P.slice(i+6,i+9);
      vol+=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);}
    assert.ok(vol>0,name+' の面が内向き');
    assert.ok(api.ROGUE_GEOMETRIES[name].attrs.color,name+' に頂点色がない');
  }
});
check('二足・二腕で、メッシュ数が予算内',()=>{
  assert.strictEqual(rig.legs.length,2);assert.strictEqual(rig.arms.length,2);
  let n=0;(function c(o){if(o instanceof Mesh)n++;o.children.forEach(c);})(rig.body);
  assert.ok(n<=60,'メッシュ数が多すぎる: '+n);
});
check('静止時に両足の足裏が床に付く',()=>{
  for(const l of rig.legs)assert.ok(Math.abs(footBottom(l))<.02,`足裏の高さ ${footBottom(l).toFixed(3)}`);
});
check('背を丸めた人型: 胴が前傾し、頭が骨盤より前へ出て、腕が長く膝の近くまで届く',()=>{
  assert.ok(rig.baseLean<-.4,'胴が前傾していない');
  const headZ=trace([rig.torso,rig.head],[0,0]).z;
  assert.ok(headZ<-.35,'頭が前へ突き出ていない: '+headZ.toFixed(2));
  for(const a of rig.arms){
    const h=handTip(a);
    assert.ok(h.y>.1&&h.y<.8,'指先の高さが不自然: '+h.y.toFixed(2));
  }
  const kneeY=trace([rig.legs[0].hip,rig.legs[0].knee],[0,0]).y;
  assert.ok(handTip(rig.arms[0]).y<kneeY+.2,'腕が膝の高さまで届いていない');
});
const e={phase:'idle',targetX:0,targetZ:0,mesh:{position:{x:0,z:0}},rogueId:'abc',flash:0,visualRig:rig};
check('歩行中も足と指先が床に潜らず、有限値のまま動く',()=>{
  e.targetX=.5;let minF=9,minH=9,maxF=-9;
  for(let i=0;i<240;i++){global.performance.now=()=>i*40;api.updateRogueEnemyVisual(e,.04);
    for(const l of rig.legs){const y=footBottom(l);minF=Math.min(minF,y);maxF=Math.max(maxF,y);
      for(const o of [l.hip,l.knee,l.foot])for(const k of ['x','y','z'])assert.ok(Number.isFinite(o.rotation[k]));}
    for(const a of rig.arms){minH=Math.min(minH,handTip(a).y);
      for(const o of [a.shoulder,a.elbow,a.wrist])for(const k of ['x','y','z'])assert.ok(Number.isFinite(o.rotation[k]));}}
  assert.ok(minF>-.03,'足が床に潜る: '+minF.toFixed(3));
  assert.ok(maxF>.1,'歩行で足が持ち上がっていない');
  assert.ok(minH>-.02,'指先が床に潜る: '+minH.toFixed(3));
});
check('予備動作で腕を引いて顎を開き、噛みつきで腕を振り抜いて頭を突き出す',()=>{
  e.targetX=0;e.phase='windup';
  for(let i=0;i<12;i++){global.performance.now=()=>i*40;api.updateRogueEnemyVisual(e,.04);}
  const back=rig.arms[0].shoulder.rotation.x;
  assert.ok(back<rig.arms[0].baseS-.8,'腕が後ろへ引かれていない');
  assert.ok(rig.jaw.rotation.x<-.5,'顎が開いていない（開くのは負の回転）');
  assert.ok(rig.torso.rotation.x>rig.baseLean+.2,'胴が反っていない');
  e.phase='recover';api.updateRogueEnemyVisual(e,0);
  assert.ok(rig.arms[0].shoulder.rotation.x>rig.arms[0].baseS+.8,'腕が前へ振り抜かれていない');
  assert.ok(rig.torso.rotation.x<rig.baseLean-.2,'胴が前へ倒れていない');
  assert.ok(rig.head.rotation.x<rig.baseHeadX,'噛みつきで頭が下がっていない');
});
if(!process.exitCode)console.log('Rogue shade rig checks passed.');
