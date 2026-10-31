'use strict';
// シェイド(v70.17: ぼろの外套をまとった影の住人)のリグを three.js の代用スタブ上で実際に組み立て、
// 形状の向き・接地・裾の高さ・アニメーションを数値で確認する。
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
const ROGUE_ENEMY_MATS={${slice('    shade:new THREE.MeshStandardMaterial({color:0x2a2442','    crawler:new THREE.MeshStandardMaterial').replace(/,\s*$/,'')}};
function build(){const g=new THREE.Group();let visualRig=null;{${slice('      const M=ROGUE_ENEMY_MATS,G=ROGUE_GEOMETRIES;',"    }else{\n      const body=new THREE.Mesh(boss?")}}return visualRig;}
${slice('  function updateRogueEnemyVisual(e,dt){','  function makeRogueChest')}
return {ROGUE_GEOMETRIES,ROGUE_ENEMY_MATS,build,updateRogueEnemyVisual,updateRogueShadeDeath,ROGUE_SHADE_DEATH_HOLD};`;
const api=new Function(code)();
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}

const rig=api.build();
const rot=(y,z,a)=>[y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];
// (y,z) 平面で関節の連鎖を辿る。nodes は親から順の関節群、tip は最後の関節の局所座標の点。
function trace(nodes,tip){
  let y=rig.pelvis.position.y,z=0,ang=0;
  for(const n of nodes){const [dy,dz]=rot(n.position.y,n.position.z,ang);y+=dy;z+=dz;ang+=n.rotation.x;}
  const [ty,tz]=rot(tip[0],tip[1],ang);
  // body の位置は親(敵の原点)側の単位、骨盤より下の部品は body の縮尺(1.18)の中にある。
  return {y:(y+ty)*rig.body.scale.x+rig.body.position.y,z:(z+tz)*rig.body.scale.x+rig.body.position.z};
}
const footBottom=l=>trace([l.hip,l.knee,l.foot],[-.07,0]).y;
const clawTip=a=>trace([rig.torso,a.shoulder,a.elbow,a.wrist],[-.51,0]);   // 手首から爪の先まで(掌 .14 + 爪 .40 - 埋め込み)
const meshCount=()=>{let n=0;(function c(o){if(o instanceof Mesh)n++;o.children.forEach(c);})(rig.body);return n;};
check('胴・外套・裾・フードの面はすべて外向き（符号付き体積が正）で、頂点色を持つ',()=>{
  for(const name of ['shadeTorso','shadeMantle','shadeRobe','shadeHood']){
    const P=api.ROGUE_GEOMETRIES[name].attrs.position.array;let vol=0;
    for(let i=0;i<P.length;i+=9){const a=P.slice(i,i+3),b=P.slice(i+3,i+6),c=P.slice(i+6,i+9);
      vol+=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);}
    assert.ok(vol>0,name+' の面が内向き');
    assert.ok(api.ROGUE_GEOMETRIES[name].attrs.color,name+' に頂点色がない');
  }
});
check('二足・二腕で、メッシュ数が予算内（旧35 → 49。1体あたり52以下）',()=>{
  assert.strictEqual(rig.legs.length,2);assert.strictEqual(rig.arms.length,2);
  const n=meshCount();
  assert.ok(n<=52,'メッシュ数が多すぎる: '+n);
});
check('静止時に両足の足裏が床に付く',()=>{
  for(const l of rig.legs)assert.ok(Math.abs(footBottom(l))<.02,`足裏の高さ ${footBottom(l).toFixed(3)}`);
});
check('胸を張って少し前へ屈む: 胴が前傾し、頭は高い位置で骨盤より前へ出て、爪は裾より外側で膝あたりまで垂れる',()=>{
  assert.ok(rig.baseLean<-.3&&rig.baseLean>-.6,'前傾が範囲外: '+rig.baseLean);
  const head=trace([rig.torso,rig.head],[0,0]);
  assert.ok(head.z<-.15,'頭が前へ出ていない: '+head.z.toFixed(2));
  assert.ok(head.y>1.7,'頭が低い(洞窟で遠くから読めない): '+head.y.toFixed(2));
  for(const a of rig.arms){
    const h=clawTip(a);
    assert.ok(h.y>.1&&h.y<1.0,'爪先の高さが不自然: '+h.y.toFixed(2));
    assert.ok(Math.abs(a.shoulder.rotation.z)>.08,'腕が裾から離れていない(爪が裾に埋もれる)');
  }
});
check('裾は地面すれすれまで垂れ、縁のぼろ布は床を突き抜けない',()=>{
  const robeBottom=(rig.pelvis.position.y+rig.robe.position.y-.86)*rig.body.scale.x+rig.body.position.y;
  assert.ok(robeBottom>.05&&robeBottom<.3,'裾の高さが不自然: '+robeBottom.toFixed(3));
  const hem=rig.cloth.filter(c=>c.kind==='hem');
  assert.strictEqual(hem.length,7);
  for(const c of hem){
    const len=-c.pivot.children[0].position.y*2;
    const tip=(rig.pelvis.position.y+rig.robe.position.y+c.pivot.position.y-len)*rig.body.scale.x+rig.body.position.y;
    assert.ok(tip>=-.01,'ぼろ布が床を突き抜ける: '+tip.toFixed(3));
  }
  assert.strictEqual(rig.cloth.filter(c=>c.kind==='cape').length,3,'背中のマントは3枚');
});
check('暗い洞窟で読めるよう、目・口の奥・胸の核が発光し、体は発光しない',()=>{
  const M=api.ROGUE_ENEMY_MATS;
  assert.ok(M.shadeEye.emissiveIntensity>=1,'目の発光が弱い');
  assert.ok(M.shadeCrystal.emissiveIntensity>=1,'結晶の発光が弱い');
  for(const k of ['shadeHide','shadeLimb','shadeMantle'])assert.ok(!(M[k].emissiveIntensity>0),k+' が発光している');
  assert.strictEqual(rig.core.material,M.shadeEye,'胸の核は目と同じ発光材');
  assert.strictEqual(rig.eyes.length,2);
});
const e={phase:'idle',targetX:0,targetZ:0,mesh:{position:{x:0,z:0}},rogueId:'abc',flash:0,visualRig:rig};
check('歩行中も足と爪先が床に潜らず、すべての関節・布が有限値のまま動く',()=>{
  e.targetX=.5;let minF=9,minH=9,maxF=-9;
  for(let i=0;i<240;i++){global.performance.now=()=>i*40;api.updateRogueEnemyVisual(e,.04);
    for(const l of rig.legs){const y=footBottom(l);minF=Math.min(minF,y);maxF=Math.max(maxF,y);
      for(const o of [l.hip,l.knee,l.foot])for(const k of ['x','y','z'])assert.ok(Number.isFinite(o.rotation[k]));}
    for(const a of rig.arms){minH=Math.min(minH,clawTip(a).y);
      for(const o of [a.shoulder,a.elbow,a.wrist])for(const k of ['x','y','z'])assert.ok(Number.isFinite(o.rotation[k]));}
    for(const c of rig.cloth)for(const k of ['x','y','z'])assert.ok(Number.isFinite(c.pivot.rotation[k]),'布の回転が非有限');
    for(const o of [rig.robe])for(const k of ['x','y','z'])assert.ok(Number.isFinite(o.rotation[k]));}
  assert.ok(minF>-.03,'足が床に潜る: '+minF.toFixed(3));
  assert.ok(maxF>.1,'歩行で足が持ち上がっていない');
  assert.ok(minH>-.02,'爪先が床に潜る: '+minH.toFixed(3));
});
check('歩くと裾とマントが後ろへ傾いてたなびく',()=>{
  e.targetX=.5;
  for(let i=0;i<30;i++){global.performance.now=()=>i*40;api.updateRogueEnemyVisual(e,.04);}
  assert.ok(rig.robe.rotation.x<-.08,'裾が後ろへ傾かない: '+rig.robe.rotation.x);
  const cape=rig.cloth.find(c=>c.kind==='cape');
  assert.ok(cape.pivot.rotation.x<cape.baseX-.2,'マントが後ろへたなびかない');
});
check('予備動作で腕を引き、顎を開き、口の奥・目・胸の核が強く光り、噛みつきで腕を振り抜いて頭を突き出す',()=>{
  e.targetX=0;e.phase='idle';
  for(let i=0;i<6;i++){global.performance.now=()=>i*40;api.updateRogueEnemyVisual(e,.04);}
  const idleCore=rig.core.scale.x,idleEye=rig.eyes[0].scale.y;
  assert.ok(rig.mouth.scale.y<.2,'待機中に口の奥が光っている');
  e.phase='windup';
  for(let i=0;i<12;i++){global.performance.now=()=>i*40;api.updateRogueEnemyVisual(e,.04);}
  const sa=rig.arms[rig.swipe],back=sa.shoulder.rotation.x;
  assert.ok(back<sa.baseS-.8,'腕が後ろへ引かれていない');
  assert.ok(rig.jaw.rotation.x<-.5,'顎が開いていない（開くのは負の回転）');
  assert.ok(rig.mouth.scale.y>.5,'顎が開いても口の奥が光らない');
  assert.ok(rig.core.scale.x>idleCore*1.3,'胸の核が強く光らない');
  assert.ok(rig.eyes[0].scale.y>idleEye*1.5,'目が太くならない');
  assert.ok(rig.torso.rotation.x>rig.baseLean+.2,'胴が反っていない');
  e.phase='recover';api.updateRogueEnemyVisual(e,0);
  assert.ok(sa.shoulder.rotation.x>sa.baseS+.8,'腕が前へ振り抜かれていない');
  assert.ok(rig.torso.rotation.x<rig.baseLean-.2,'胴が前へ倒れていない');
  assert.ok(rig.head.rotation.x<rig.baseHeadX,'噛みつきで頭が下がっていない');
});

const tick=(ph,n,flash)=>{e.phase=ph;e.flash=flash||0;for(let i=0;i<n;i++){global.performance.now=()=>i*40;api.updateRogueEnemyVisual(e,.04);}};
check('攻撃のたびに振る腕が左右交代し、振る腕は引きも薙ぎも大きく、胴を逆向きにひねる',()=>{
  e.targetX=0;tick('idle',6);
  tick('windup',12);const first=rig.swipe,a=rig.arms[first],b=rig.arms[1-first];
  assert.ok(a.shoulder.rotation.x<b.shoulder.rotation.x-.4,'振る腕のほうが大きく引かれていない');
  const twistWind=rig.torso.rotation.y;
  assert.ok(Math.abs(twistWind)>.2,'胴がひねられていない');
  e.phase='recover';rig.phaseTime=0;api.updateRogueEnemyVisual(e,0);
  assert.ok(rig.torso.rotation.y*twistWind<0,'薙ぐとき胴が逆へ戻らない');
  tick('idle',4);tick('windup',12);
  assert.notStrictEqual(rig.swipe,first,'次の攻撃で腕が交代しない');
});
check('振り抜いたあとに揺り戻しがあり、やがて収まる',()=>{
  e.phase='recover';rig.phaseTime=0;api.updateRogueEnemyVisual(e,0);
  e.phase='idle';api.updateRogueEnemyVisual(e,.04);
  assert.strictEqual(rig.settleT<1,true,'揺り戻しが始まらない');
  for(let i=0;i<40;i++){global.performance.now=()=>i*40;api.updateRogueEnemyVisual(e,.04);}
  assert.ok(rig.settleT>1,'揺り戻しが収まらない');
});
check('被弾でのけぞり、裾が煽られ、収まると元へ戻る',()=>{
  e.targetX=0;tick('idle',20);const z0=rig.body.position.z,t0=rig.torso.rotation.x;
  tick('idle',1,.18);
  assert.ok(rig.body.position.z>z0+.05,'後ろへ押されない');
  assert.ok(rig.torso.rotation.x>t0+.15,'胴がのけぞらない');
  tick('idle',20,0);
  assert.ok(Math.abs(rig.body.position.z-z0)<.03,'被弾の姿勢が戻らない');
});
check('死亡: のけぞり→膝をつく→突っ伏す。足は床に付いたまま、裾は床にたまり、光が消える',()=>{
  const H=api.ROGUE_SHADE_DEATH_HOLD;let prevY=9;
  const at=p=>{e.dieT=p*H;api.updateRogueShadeDeath(e);};
  at(.15);assert.ok(rig.arms[0].shoulder.rotation.x<rig.arms[0].baseS-.8,'のけぞりで腕が跳ね上がらない');
  assert.ok(rig.torso.rotation.x>rig.baseLean+.3,'のけぞらない');
  for(let p=0;p<=1.0001;p+=.05){
    at(p);
    for(const l of rig.legs){const y=footBottom(l);assert.ok(Math.abs(y)<.08,`p=${p.toFixed(2)} 足が床から離れる/潜る: ${y.toFixed(3)}`);}
    const hem=(rig.pelvis.position.y+rig.robe.position.y-.86*rig.robe.scale.y)*rig.body.scale.x+rig.body.position.y;
    assert.ok(hem>-.03&&hem<.35,`p=${p.toFixed(2)} 裾の高さが不自然: ${hem.toFixed(3)}`);
    assert.ok(rig.body.position.y<=prevY+1e-9,'腰が上がっている');prevY=rig.body.position.y;
    for(const o of [rig.torso,rig.head,rig.robe,rig.jaw])for(const k of ['x','y','z'])assert.ok(Number.isFinite(o.rotation[k]));
  }
  assert.ok(rig.body.position.y<-.4,'膝をついていない');
  assert.ok(rig.torso.rotation.x<rig.baseLean-.5,'突っ伏していない');
  assert.ok(rig.core.scale.x<.3&&rig.eyes[0].scale.x<.1,'光が消えていない');
  assert.ok(rig.robe.scale.y<.6,'裾が縮まない');
});
check('死亡の姿勢から復活すると、通常の姿勢へ完全に戻る',()=>{
  e.dieT=.8;api.updateRogueShadeDeath(e);
  e.targetX=0;tick('idle',20);
  assert.strictEqual(rig.robe.scale.y,1);
  assert.ok(Math.abs(rig.body.position.y)<.05,'腰が戻らない');
  for(const l of rig.legs)assert.ok(Math.abs(footBottom(l))<.03,'足が戻らない');
  assert.ok(rig.core.scale.x>.8&&rig.eyes[0].scale.x>.8,'光が戻らない');
});
if(!process.exitCode)console.log('Rogue shade rig checks passed.');
