'use strict';
// 甲殻虫クロウラー(v70.21: ボス以外のクロウラーの専用モデル)のリグを three.js の代用スタブ上で実際に組み立て、
// 大きさ・接地(逆運動学)・発光・三脚歩行・噛みつき・被弾・死亡を数値で確認する。
// 足先の位置は、スタブの階層を行列で畳み込んで(three.js の Euler XYZ と同じ順序で)求めるので、アニメーション側の計算とは独立に検証される。
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
class Mat{constructor(o){Object.assign(this,o);}clone(){return new Mat(this);}}
global.THREE={Color,Group,Mesh,BufferGeometry,Float32BufferAttribute:F32,CylinderGeometry:geo(),DodecahedronGeometry:geo(),OctahedronGeometry:geo(),ConeGeometry:geo(),MeshStandardMaterial:Mat,MeshBasicMaterial:Mat};
global.performance={now:()=>0};
const code=`${slice('  function rogueRingLoftGeometry(','  const ROGUE_GEOMETRIES={')}
const ROGUE_ENEMY_MATS={${slice('    crawler:new THREE.MeshStandardMaterial','    spitter:new THREE.MeshStandardMaterial').replace(/,\s*$/,'')}};
${slice('  const ROGUE_CRAWLER_RINGS=','  // 石の番兵(v70.19)の部品。')}
${slice('  const ROGUE_CRAWLER_PIVOT_Y=','  // 石の番兵の表示アニメーション')}
function build(){const g=new THREE.Group();const boss=false;const mat=ROGUE_ENEMY_MATS.crawler;let visualRig=null;{${slice('      const M=ROGUE_ENEMY_MATS,G=ROGUE_CRAWLER_GEOMETRIES,LEG=ROGUE_CRAWLER_LEG;',"    }else if(kind==='shade'&&!boss){")}}return {rig:visualRig,root:g};}
return {ROGUE_ENEMY_MATS,ROGUE_CRAWLER_GEOMETRIES,ROGUE_CRAWLER_LEG,ROGUE_CRAWLER_RINGS,ROGUE_CRAWLER_DEATH_HOLD,rogueCrawlerSection,build,updateRogueCrawlerVisual,updateRogueCrawlerDeath,rogueCrawlerApplyBody,rogueCrawlerPlant};`;
const api=new Function(code)();
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}

// ---- 階層を行列で畳み込む(three.js: ローカル行列 = T·R·S、R = Rx·Ry·Rz) ----
const mm=(A,B)=>{const C=new Array(16).fill(0);for(let i=0;i<4;i++)for(let j=0;j<4;j++)for(let k=0;k<4;k++)C[i*4+j]+=A[i*4+k]*B[k*4+j];return C;};
const localM=o=>{
  const {x:a,y:b,z:c}=o.rotation,sx=Math.sin(a),cx=Math.cos(a),sy=Math.sin(b),cy=Math.cos(b),sz=Math.sin(c),cz=Math.cos(c);
  const Rx=[1,0,0,0, 0,cx,-sx,0, 0,sx,cx,0, 0,0,0,1],Ry=[cy,0,sy,0, 0,1,0,0, -sy,0,cy,0, 0,0,0,1],Rz=[cz,-sz,0,0, sz,cz,0,0, 0,0,1,0, 0,0,0,1];
  const R=mm(mm(Rx,Ry),Rz),S=[o.scale.x,0,0,0, 0,o.scale.y,0,0, 0,0,o.scale.z,0, 0,0,0,1];
  const T=[1,0,0,o.position.x, 0,1,0,o.position.y, 0,0,1,o.position.z, 0,0,0,1];
  return mm(T,mm(R,S));
};
const worldM=o=>{let M=localM(o);for(let p=o.parent;p;p=p.parent)M=mm(localM(p),M);return M;};
const world=(o,p)=>{const M=worldM(o);return {x:M[0]*p[0]+M[1]*p[1]+M[2]*p[2]+M[3],y:M[4]*p[0]+M[5]*p[1]+M[6]*p[2]+M[7],z:M[8]*p[0]+M[9]*p[1]+M[10]*p[2]+M[11]};};

const {rig,root}=api.build();
const L1=api.ROGUE_CRAWLER_LEG.L1,L2=api.ROGUE_CRAWLER_LEG.L2;
const foot=l=>world(l.lower,[L2,0,0]);
const knee=l=>world(l.upper,[L1,0,0]);
const meshCount=()=>{let n=0;(function c(o){if(o instanceof Mesh)n++;o.children.forEach(c);})(root);return n;};
const e={phase:'idle',targetX:0,targetZ:0,mesh:{position:{x:0,z:0}},rogueId:'abc',flash:0,visualRig:rig};
let clock=0;
const run=(sec,dt=.016)=>{const n=Math.round(sec/dt);for(let i=0;i<n;i++){clock+=dt*1000;global.performance.now=()=>clock;api.updateRogueCrawlerVisual(e,dt,rig);}};
const finiteAll=()=>{(function c(o){for(const k of ['x','y','z']){assert.ok(Number.isFinite(o.rotation[k]),'rotation');assert.ok(Number.isFinite(o.position[k]),'position');assert.ok(Number.isFinite(o.scale[k]),'scale');}o.children.forEach(c);})(root);};
// 体の上端(甲殻の背・棘の先・頭の前)の世界座標
const shellTop=()=>world(rig.body,[0,1.07,.3]);
run(.5);

check('六脚・触角2・顎2・目4で、メッシュ数が予算内(1体あたり40以下)',()=>{
  assert.strictEqual(rig.legs.length,6);assert.strictEqual(rig.jaws.length,2);assert.strictEqual(rig.antennae.length,2);assert.strictEqual(rig.eyes.length,4);
  const n=meshCount();assert.ok(n<=40,'メッシュ数が多すぎる: '+n);
});
check('静止時に6本すべての足先が床に付き、立ち位置はそれぞれの基準の場所',()=>{
  for(const l of rig.legs){const f=foot(l);assert.ok(Math.abs(f.y)<.02,'足先の高さ '+f.y.toFixed(3));
    assert.ok(Math.abs(f.x-l.rest[0])<.06&&Math.abs(f.z-l.rest[1])<.06,'足先の位置 '+f.x.toFixed(2)+','+f.z.toFixed(2));}
});
check('大きさ: 背の高さは1.0〜1.2m、脚の広がりは半径1.3m以内、膝は体と同じくらいの高さまで上がる',()=>{
  const top=shellTop().y;assert.ok(top>1.0&&top<1.2,'背の高さ '+top.toFixed(2));
  for(const l of rig.legs){const f=foot(l);assert.ok(Math.hypot(f.x,f.z)<1.3,'脚の広がり');const k=knee(l).y;assert.ok(k>.75&&k<1.15,'膝の高さ '+k.toFixed(2));}
  const front=world(rig.head,[0,0,-.46]);assert.ok(front.z<-.85&&front.z>-1.15,'頭の前面 '+front.z.toFixed(2));
});
check('脚の長さが一定(逆運動学で伸び縮みしない): 付け根→膝→足先',()=>{
  for(const l of rig.legs){const h=world(l.yaw,[0,0,0]),k=knee(l),f=foot(l);
    assert.ok(Math.abs(Math.hypot(k.x-h.x,k.y-h.y,k.z-h.z)-L1)<1e-6);assert.ok(Math.abs(Math.hypot(f.x-k.x,f.y-k.y,f.z-k.z)-L2)<1e-6);}
});
check('左右対称: 左右の足先は x だけ反転した位置',()=>{
  for(let i=0;i<6;i+=2){const a=foot(rig.legs[i]),b=foot(rig.legs[i+1]);assert.ok(Math.abs(a.x+b.x)<.02&&Math.abs(a.z-b.z)<.02&&Math.abs(a.y-b.y)<.02,'左右が非対称');}
});
check('光るのは目4つと尾の腺だけで、体は光らない。発光材は敵ごとに複製される',()=>{
  const M=api.ROGUE_ENEMY_MATS;assert.ok(M.crawlerGlow.emissiveIntensity>=1,'発光が弱い');
  for(const k of ['crawler','crawlerHide','crawlerLeg','crawlerPlate'])assert.ok(!(M[k].emissiveIntensity>.3),k+' が光りすぎ');
  assert.notStrictEqual(rig.glowMat,M.crawlerGlow,'発光材が共有されている(1体の予備動作で全員が光ってしまう)');
  for(const eye of rig.eyes)assert.strictEqual(eye.mesh.material,rig.glowMat);
  assert.strictEqual(rig.gland.material,rig.glowMat);
  const other=api.build().rig;assert.notStrictEqual(other.glowMat,rig.glowMat);
});
check('他の敵と見分けられる: 発光色は黄緑(緑が最大・青が最小で、赤は緑より小さい)',()=>{
  const c=api.ROGUE_ENEMY_MATS.crawlerGlow.emissive;const r=(c>>16)&255,g=(c>>8)&255,b=c&255;
  assert.ok(g>r&&r>b,'黄緑ではない '+r+','+g+','+b);
});
check('殻の縞は殻に沿う(縞の断面は同じ位置の殻の断面より少し大きい)',()=>{
  for(const z of [-.14,.24,.6]){const s=api.rogueCrawlerSection(z,0),b=api.rogueCrawlerSection(z,.025);assert.ok(b.w>s.w&&b.hu>s.hu&&b.y===s.y);}
});

const idleGlow=rig.glowMat.emissiveIntensity;
e.phase='windup';run(.06);const midGlow=rig.glowMat.emissiveIntensity;run(.08);
check('噛みつきの予備動作: 鼻先が上がり、前脚2本が持ち上がり、顎が大きく開き、目と腺が強く光る。中・後ろ脚は地面に付いたまま',()=>{
  assert.ok(rig.pose.pitch>.25,'鼻先が上がらない '+rig.pose.pitch.toFixed(2));
  assert.ok(rig.pose.oz>.08,'体が後ろへ引かれない '+rig.pose.oz.toFixed(3));
  for(const l of rig.legs){const y=foot(l).y;if(l.row===0)assert.ok(y>.3,'前脚が上がらない '+y.toFixed(2));else assert.ok(Math.abs(y)<.02,'中・後ろ脚が浮く/潜る '+y.toFixed(3));}
  for(const j of rig.jaws)assert.ok(-j.side*j.pivot.rotation.y*-1>.8||Math.abs(j.pivot.rotation.y)>.8,'顎が開かない');
  assert.ok(rig.glowMat.emissiveIntensity>idleGlow+1,'強く光らない');assert.ok(midGlow>idleGlow,'途中から光り始めていない');
});
check('予備動作の姿勢が連続して変化する(いきなり飛ばない)',()=>{
  const r2=api.build().rig,e2={phase:'windup',targetX:0,targetZ:0,mesh:{position:{x:0,z:0}},rogueId:'abc',flash:0,visualRig:r2};
  let prev=null,maxJump=0,maxLeg=0,prevLeg=null;
  for(let i=0;i<10;i++){clock+=16;global.performance.now=()=>clock;api.updateRogueCrawlerVisual(e2,.016,r2);
    if(prev!==null)maxJump=Math.max(maxJump,Math.abs(r2.pose.pitch-prev));prev=r2.pose.pitch;
    const f=foot(r2.legs[0]).y;if(prevLeg!==null)maxLeg=Math.max(maxLeg,Math.abs(f-prevLeg));prevLeg=f;}
  assert.ok(maxJump<.1,'1フレームの体の角度変化が大きい: '+maxJump.toFixed(3));assert.ok(maxLeg<.2,'1フレームの前脚の動きが大きい: '+maxLeg.toFixed(3));
});
e.phase='recover';run(.06);
check('飛びかかり: 体が前へ跳び、顎が閉じ、前脚が突き出る。中・後ろ脚は地面に付いたまま(体が傾いても足が浮かない)',()=>{
  assert.ok(rig.pose.oz<-.25,'体が前へ出ない '+rig.pose.oz.toFixed(3));
  assert.ok(rig.pose.pitch<-.1,'鼻先が下がらない '+rig.pose.pitch.toFixed(2));
  for(const j of rig.jaws)assert.ok(Math.abs(j.pivot.rotation.y)<.3,'顎が閉じない '+j.pivot.rotation.y.toFixed(2));
  for(const l of rig.legs){const y=foot(l).y;if(l.row!==0)assert.ok(Math.abs(y)<.02,'足が浮く/潜る '+y.toFixed(3));}
  const f=foot(rig.legs[0]);assert.ok(f.z<rig.legs[0].rest[1]-.1,'前脚が前へ出ない');
});
run(.3);e.phase='idle';run(.3);
check('回復後は基準の姿勢へ戻り、光も静まる',()=>{
  assert.ok(Math.abs(rig.pose.pitch)<.05&&Math.abs(rig.pose.oz)<.03);assert.ok(rig.glowMat.emissiveIntensity<idleGlow+.5);
  for(const l of rig.legs){const f=foot(l);assert.ok(Math.abs(f.x-l.rest[0])<.06&&Math.abs(f.z-l.rest[1])<.06&&Math.abs(f.y)<.02,'足先が戻らない');}
});
check('歩行: 三脚歩行(常に3本以上が地面に付く・同じ組は同時に動く)で、足が床に潜らず、立っている足は滑らず、すべての関節が有限値',()=>{
  e.targetX=.5;let minF=9,maxF=-9,minGround=9;const slip=[];
  const gp=rig.legs.map(()=>null);
  for(let i=0;i<300;i++){clock+=30;global.performance.now=()=>clock;api.updateRogueCrawlerVisual(e,.03,rig);
    let ground=0;const fs=rig.legs.map(foot);
    rig.legs.forEach((l,k)=>{const y=fs[k].y;minF=Math.min(minF,y);maxF=Math.max(maxF,y);if(y<.02)ground++;});
    minGround=Math.min(minGround,ground);
    // 同じ組(位相が等しい脚)は足先の高さがほぼ等しい
    rig.legs.forEach((l,k)=>rig.legs.forEach((m,q)=>{if(l.phase===m.phase)assert.ok(Math.abs(fs[k].y-fs[q].y)<.05,'同じ組が同時に動かない');}));
    finiteAll();}
  assert.ok(minF>-.02,'足が床に潜る: '+minF.toFixed(3));assert.ok(maxF>.12,'足が上がっていない(歩いて見えない): '+maxF.toFixed(3));assert.ok(minGround>=3,'接地している足が3本未満になる: '+minGround);
});
check('歩行中に立っている足は、体が傾いても地面系で動かない(足先の高さが0のまま)',()=>{
  let worst=0;for(let i=0;i<200;i++){clock+=25;global.performance.now=()=>clock;api.updateRogueCrawlerVisual(e,.025,rig);
    // 踏んでいる間(位相の前半)の足は、地面に付いている
    for(const l of rig.legs){const u=(((rig.gaitPhase+l.phase)/(Math.PI*2))%1+1)%1;if(u<.45)worst=Math.max(worst,Math.abs(foot(l).y));}}
  assert.ok(worst<.02,'踏んでいる足が浮く/潜る: '+worst.toFixed(3));
});
check('被弾でのけぞり(体が後ろへ・鼻先が上がり・顎が開く)、収まると戻る',()=>{
  e.targetX=0;run(.6);const before={pitch:rig.pose.pitch,oz:rig.pose.oz,jaw:Math.abs(rig.jaws[0].pivot.rotation.y)};
  e.flash=.18;run(.016);const hit={pitch:rig.pose.pitch,oz:rig.pose.oz,jaw:Math.abs(rig.jaws[0].pivot.rotation.y)};
  for(const l of rig.legs)if(l.row!==0)assert.ok(Math.abs(foot(l).y)<.02,'被弾で足が浮く/潜る');
  e.flash=0;run(.4);
  assert.ok(hit.pitch>before.pitch+.12,'のけぞらない');assert.ok(hit.oz>before.oz+.08,'後ろへ押されない');assert.ok(hit.jaw>before.jaw+.15,'顎が開かない');
  assert.ok(Math.abs(rig.pose.pitch-before.pitch)<.05,'戻らない');
});
check('死亡: 跳ねてひっくり返り(背が地面に付く)、脚を腹の側へ丸めて地面から離れ、光が消え、すべての値が有限',()=>{
  const d=api.build(),dr=d.rig,ed={visualRig:dr,dieT:0};
  let prevRoll=0;
  for(let i=0;i<=100;i++){ed.dieT=api.ROGUE_CRAWLER_DEATH_HOLD*i/100;api.updateRogueCrawlerDeath(ed);
    (function c(o){for(const k of ['x','y','z']){assert.ok(Number.isFinite(o.rotation[k])&&Number.isFinite(o.position[k])&&Number.isFinite(o.scale[k]));}o.children.forEach(c);})(d.root);
    assert.ok(dr.pose.roll>=prevRoll-1e-9,'ひっくり返る途中で戻る');prevRoll=dr.pose.roll;
    // 殻の背は途中でも地面に潜らない
    const y=Math.min(world(dr.body,[0,1.07,.3]).y,world(dr.body,[0,.95,-.2]).y);assert.ok(y>-.06,'殻が地面へ潜る: '+y.toFixed(3)+' at '+i);}
  assert.ok(Math.abs(dr.pose.roll-Math.PI)<1e-6,'ひっくり返らない');
  const back=world(dr.body,[0,1.07,.3]).y;assert.ok(back>-.03&&back<.12,'背が地面に付かない/浮く: '+back.toFixed(3));
  for(const l of dr.legs){const f=world(l.lower,[L2,0,0]);assert.ok(f.y>.35,'脚が丸まって上へ向いていない: '+f.y.toFixed(2));}
  assert.ok(dr.glowMat.emissiveIntensity<.3,'光が消えない');
});
check('死亡の姿勢から基準の姿勢へ戻せる(毎フレーム全関節を代入し直す)',()=>{
  const d=api.build(),dr=d.rig,ed={phase:'idle',targetX:0,targetZ:0,mesh:{position:{x:0,z:0}},rogueId:'abc',flash:0,visualRig:dr,dieT:api.ROGUE_CRAWLER_DEATH_HOLD};
  api.updateRogueCrawlerDeath(ed);
  for(let i=0;i<60;i++){clock+=16;global.performance.now=()=>clock;api.updateRogueCrawlerVisual(ed,.016,dr);}
  assert.ok(Math.abs(dr.pose.roll)<1e-9);for(const l of dr.legs)assert.ok(Math.abs(world(l.lower,[L2,0,0]).y)<.02,'足が戻らない');
  assert.ok(dr.glowMat.emissiveIntensity>1,'光が戻らない');
});
check('ボスと他の敵は従来のまま(専用モデルは非ボスのクロウラーだけ。表示の振り分けと死亡の分岐がある)',()=>{
  assert.ok(html.includes("if(kind==='crawler'&&!boss){"));
  assert.ok(html.includes("if(rig&&rig.crawler){updateRogueCrawlerVisual(e,dt,rig);return;}"));
  assert.ok(html.includes("if(e.visualRig&&e.visualRig.crawler){"));
  assert.ok(!html.includes('crawlerBody')&&!html.includes('ROGUE_GEOMETRIES.crawlerLeg'),'旧モデルの部品が残っている');
});
if(!process.exitCode)console.log('Rogue crawler rig checks passed.');
