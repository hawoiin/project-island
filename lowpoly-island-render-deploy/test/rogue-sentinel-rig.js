'use strict';
// 石の番兵(v70.19: ボス以外のセンチネルの専用モデル)のリグを three.js の代用スタブ上で実際に組み立て、
// 大きさ・接地・発光・予備動作と振り下ろし・歩行を数値で確認する。
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const slice=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i);assert.ok(i>=0&&j>i,'marker not found: '+a);return html.slice(i,j);};
class V{constructor(){this.x=0;this.y=0;this.z=0;}set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}setScalar(s){this.x=this.y=this.z=s;return this;}}
class Obj{constructor(){this.position=new V();this.rotation=new V();this.scale=new V().set(1,1,1);this.children=[];}add(c){c.parent=this;this.children.push(c);}}
class Group extends Obj{}
class Mesh extends Obj{constructor(g,m){super();this.geometry=g;this.material=m;}}
const geo=()=>class{constructor(...a){this.args=a;}};
class Mat{constructor(o){Object.assign(this,o);}clone(){return new Mat(this);}}
global.THREE={Group,Mesh,CylinderGeometry:geo(),DodecahedronGeometry:geo(),BoxGeometry:geo(),ConeGeometry:geo(),MeshStandardMaterial:Mat,MeshBasicMaterial:Mat};
global.performance={now:()=>0};
const code=`
const ROGUE_ENEMY_MATS={${slice('    sentinel:new THREE.MeshStandardMaterial','    eye:new THREE.MeshBasicMaterial').replace(/,\s*$/,'')}};
${slice('  const ROGUE_SENTINEL_GEOMETRIES={','  function makeRogueEnemy(')}
function build(){const g=new THREE.Group();const mat=ROGUE_ENEMY_MATS.sentinel;let visualRig=null;{${slice('      const M=ROGUE_ENEMY_MATS,G=ROGUE_SENTINEL_GEOMETRIES;','    }else{\n      const body=new THREE.Mesh(boss?')}}return visualRig;}
${slice('  const ROGUE_GOLEM_RAISE=','  // シェイド(影の住人)の表示アニメーション')}
return {ROGUE_ENEMY_MATS,build,updateRogueGolemVisual,ROGUE_GOLEM_RAISE,ROGUE_GOLEM_SLAM};`;
const api=new Function(code)();
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}

const rig=api.build();
const rot=(y,z,a)=>[y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];
// (y,z) 平面で関節の連鎖を辿る。tip は最後の関節の局所座標の点。
function trace(nodes,tip){
  let y=rig.body.position.y+rig.pelvis.position.y,z=rig.body.position.z,ang=0;
  for(const n of nodes){const [dy,dz]=rot(n.position.y,n.position.z,ang);y+=dy;z+=dz;ang+=n.rotation.x;}
  const [ty,tz]=rot(tip[0],tip[1],ang);
  return {y:y+ty,z:z+tz,ang};
}
const fist=a=>trace([rig.torso,a.shoulder,a.elbow],[-.58,0]);          // 拳の中心(半径 .36)
const footBottom=l=>{const p=trace([l.hip,l.ankle],[.02,-.07]);return p.y-.11;};
const headTop=()=>trace([rig.torso,rig.head],[.22,0]).y;
const meshCount=()=>{let n=0;(function c(o){if(o instanceof Mesh)n++;o.children.forEach(c);})(rig.body);return n;};
const e={phase:'idle',targetX:0,targetZ:0,mesh:{position:{x:0,z:0}},rogueId:'abc',flash:0,visualRig:rig};
let clock=0;
const run=(sec,dt=.016)=>{const n=Math.round(sec/dt);for(let i=0;i<n;i++){clock+=dt*1000;global.performance.now=()=>clock;api.updateRogueGolemVisual(e,dt,rig);}};
run(.5);

check('二本脚・二本腕で、メッシュ数が予算内(1体あたり32以下)',()=>{
  assert.strictEqual(rig.legs.length,2);assert.strictEqual(rig.arms.length,2);
  const n=meshCount();assert.ok(n<=32,'メッシュ数が多すぎる: '+n);
});
check('静止時に両足の足裏が床に付く',()=>{for(const l of rig.legs)assert.ok(Math.abs(footBottom(l))<.03,'足裏の高さ '+footBottom(l).toFixed(3));});
check('頭の高さは2.0〜2.6m、拳は床から0.15〜1.0mに垂れる(汎用モデルの約2.2mと並ぶ大きさ)',()=>{
  const h=headTop();assert.ok(h>2.0&&h<2.6,'頭の高さ '+h.toFixed(2));
  for(const a of rig.arms){const y=fist(a).y-.36;assert.ok(y>.15&&y<1.0,'拳の高さ '+y.toFixed(2));}
});
check('光るのは目の裂け目・胸のルーン・ひびだけで、石の体は光らない。発光材は敵ごとに複製される',()=>{
  const M=api.ROGUE_ENEMY_MATS;
  assert.ok(M.sentinelRune.emissiveIntensity>=1,'ルーンの発光が弱い');
  for(const k of ['sentinel','sentinelDark','sentinelWorn','sentinelMoss'])assert.ok(!(M[k].emissiveIntensity>.3),k+' が光りすぎ');
  assert.notStrictEqual(rig.runeMat,M.sentinelRune,'発光材が共有されている(1体の予備動作で全員が光ってしまう)');
  assert.strictEqual(rig.rune.material,rig.runeMat);assert.strictEqual(rig.eye.material,rig.runeMat);
  assert.strictEqual(rig.cracks.length,2);
  const other=api.build();assert.notStrictEqual(other.runeMat,rig.runeMat);
});
check('他の敵と見分けられる: 発光色は琥珀色(赤が最大・青が最小)',()=>{
  const c=api.ROGUE_ENEMY_MATS.sentinelRune.emissive;const r=(c>>16)&255,g=(c>>8)&255,b=c&255;
  assert.ok(r>g&&g>b,'琥珀色ではない');
});
const idleGlow=rig.runeMat.emissiveIntensity;
e.phase='windup';run(.3);
const midGlow=rig.runeMat.emissiveIntensity;
run(.5);
check('叩きつけの予備動作: 両拳が頭より高く前へ上がり、胴が反り、ルーンが強く光る',()=>{
  for(const a of rig.arms){const f=fist(a);assert.ok(f.y-.36>headTop()-.2,'拳が頭の上へ上がっていない: '+f.y.toFixed(2));assert.ok(f.z<-.2,'拳が前へ出ていない: '+f.z.toFixed(2));}
  assert.ok(rig.torso.rotation.x>.15,'胴が反っていない: '+rig.torso.rotation.x.toFixed(2));
  assert.ok(rig.runeMat.emissiveIntensity>idleGlow+1,'ルーンが強く光らない');
  assert.ok(midGlow>idleGlow,'予備動作の途中から光り始めていない');
});
check('予備動作の途中の姿勢が連続して変化する(いきなり飛ばない)',()=>{
  const e2={phase:'windup',targetX:0,targetZ:0,mesh:{position:{x:0,z:0}},rogueId:'abc',flash:0,visualRig:rig};
  const r2=api.build();let prev=null,maxJump=0;e2.visualRig=r2;
  for(let i=0;i<50;i++){clock+=16;global.performance.now=()=>clock;api.updateRogueGolemVisual(e2,.016,r2);const v=r2.arms[0].shoulder.rotation.x;if(prev!==null)maxJump=Math.max(maxJump,Math.abs(v-prev));prev=v;}
  assert.ok(maxJump<.2,'1フレームの腕の角度変化が大きい: '+maxJump.toFixed(3));
});
e.phase='recover';run(.15);
check('振り下ろし: 拳が地面近くまで下り(床を突き抜けない)、胴が前へ倒れて沈み、足は床に付いたまま',()=>{
  for(const a of rig.arms){const y=fist(a).y-.36;assert.ok(y>-.05&&y<.5,'拳の底の高さ '+y.toFixed(2));}
  assert.ok(rig.torso.rotation.x<-.3,'胴が前へ倒れない: '+rig.torso.rotation.x.toFixed(2));
  assert.ok(rig.torso.position.y<.12,'胴が沈まない: '+rig.torso.position.y.toFixed(3));
  for(const l of rig.legs)assert.ok(Math.abs(footBottom(l))<.03,'足が床から離れる/潜る: '+footBottom(l).toFixed(3));
});
run(.65);e.phase='idle';run(.3);
check('回復後は基準の姿勢へ戻り、光も静まる',()=>{
  for(const a of rig.arms)assert.ok(Math.abs(a.shoulder.rotation.x-a.baseS)<.08,'腕が戻らない: '+a.shoulder.rotation.x.toFixed(2));
  assert.ok(Math.abs(rig.torso.rotation.x)<.08);assert.ok(rig.runeMat.emissiveIntensity<idleGlow+.7);
});
check('歩行中も足が床に潜らず、足裏は水平のまま、すべての関節が有限値のまま動く',()=>{
  e.targetX=.5;let minF=9,maxF=-9;
  for(let i=0;i<240;i++){clock+=40;global.performance.now=()=>clock;api.updateRogueGolemVisual(e,.04,rig);
    for(const l of rig.legs){const y=footBottom(l);minF=Math.min(minF,y);maxF=Math.max(maxF,y);
      assert.ok(Math.abs(l.hip.rotation.x+l.ankle.rotation.x)<1e-9,'足裏が水平でない');
      for(const o of [l.hip,l.ankle])for(const k of ['x','y','z'])assert.ok(Number.isFinite(o.rotation[k]));}
    for(const a of rig.arms)for(const o of [a.shoulder,a.elbow])for(const k of ['x','y','z'])assert.ok(Number.isFinite(o.rotation[k]));}
  assert.ok(minF>-.02,'足が床に潜る: '+minF.toFixed(3));assert.ok(maxF>.04,'足が上がっていない(歩いて見えない): '+maxF.toFixed(3));
});
check('被弾でのけぞり、収まると戻る',()=>{
  e.targetX=0;run(.6);const before=rig.torso.rotation.x;
  e.flash=.22;run(.016);const hit=rig.torso.rotation.x;
  e.flash=0;run(.3);
  assert.ok(hit>before+.08,'のけぞらない');assert.ok(Math.abs(rig.torso.rotation.x-before)<.06,'戻らない');
});
check('ボスは従来の汎用モデルのまま(専用モデルは非ボスのセンチネルだけ)',()=>{
  assert.ok(html.includes("}else if(kind==='sentinel'&&!boss){"));
  assert.ok(html.includes("if(rig&&rig.golem){updateRogueGolemVisual(e,dt,rig);return;}"));
});
if(!process.exitCode)console.log('Rogue sentinel rig checks passed.');
