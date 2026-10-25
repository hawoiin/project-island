// v61.2: ダンジョン敵AI・移動・攻撃対象のサーバー権威化を検証
'use strict';
const assert=require('assert');
const Shared=require('../public/shared.js');
const sim=new Shared.WorldSim({seed:61207});
const sent=[];
sim.out={sendTo(id,msg){sent.push({to:id,msg});},broadcast(msg,except){for(const id of sim.clients.keys())if(id!==except)sent.push({to:id,msg});}};
function enter(id,name){
  sim.addClient(id);sim.handle(id,{t:'join',name,key:`rogue-ai-${id}`});sim.handle(id,{t:'roguePartySelect',mode:'join',code:'PARTY1'});
  const site=Shared.CAVE_SITES[Shared.ROGUE_DUNGEON_INDEX];
  const mouth={x:site.x+site.dirX*Shared.CAVE_MOUTH_OFFSET,z:site.z+site.dirZ*Shared.CAVE_MOUTH_OFFSET};
  sim.handle(id,{t:'state',x:mouth.x,y:Shared.islandHeight(mouth.x,mouth.z),z:mouth.z,ry:0,cave:-1,f:0});
  sim.handle(id,{t:'state',x:Shared.CAVE_INTERIOR_ENTRY.x,y:0,z:Shared.CAVE_INTERIOR_ENTRY.z,ry:0,cave:Shared.ROGUE_DUNGEON_INDEX,f:0});
}
function check(name,fn){try{fn();console.log('PASS '+name);}catch(err){console.error('FAIL '+name+': '+err.message);process.exitCode=1;}}
enter(61,'Player A');enter(62,'Player B');
const room=sim.getRogueRoomForClient(61),layout=Shared.getRogueDungeonLayout(room.seed),mob=room.enemyStates.get('e0'),cA=sim.clients.get(61),cB=sim.clients.get(62);
check('サーバーは全敵に独立した現在位置・向き・攻撃クールダウンを持つ',()=>{assert.ok(mob&&Number.isFinite(mob.x)&&Number.isFinite(mob.z)&&Number.isFinite(mob.yaw)&&Number.isFinite(mob.cooldown));assert.ok(room.enemyStates.has('boss'));});
check('新規参加時のスナップショットに敵のサーバー位置が含まれる',()=>{const m=sent.find(x=>x.to===62&&x.msg.t==='rogueRoomJoined')?.msg;assert.ok(Array.isArray(m.enemyPositions));assert.ok(m.enemyPositions.some(e=>e.id==='e0'&&Number.isFinite(e.x)));});
check('経路探索は開いた封印門を通り、閉じた門を越えない',()=>{assert.ok(Shared.findRogueDungeonPath(0,-35,0,-76,1).length>0);assert.equal(Shared.findRogueDungeonPath(0,-45,0,-70,0).length,0);});
const entryX=cA.x,entryZ=cA.z;
sim.handle(61,{t:'state',x:8,y:0,z:-83,ry:0,cave:Shared.ROGUE_DUNGEON_INDEX,f:0});
check('サーバーは裂け目など床のない位置へのプレイヤー移動を拒否する',()=>{assert.equal(cA.x,entryX);assert.equal(cA.z,entryZ);assert.equal(Shared.isRogueDungeonWalkable(8,-83,3),false);});
// Enemy e0 tracks A on a valid floor in the starting chamber. B remains far away.
const startX=mob.x,startZ=mob.z;
cA.x=startX+8;cA.z=startZ;cA.cave=Shared.ROGUE_DUNGEON_INDEX;cA.dead=false;cA.hasState=true;cA.lastStateAt=Date.now();
cB.x=0;cB.z=14;cB.cave=Shared.ROGUE_DUNGEON_INDEX;cB.dead=false;cB.hasState=true;cB.lastStateAt=Date.now();
for(const [id,state] of room.enemyStates){state.cooldown=10;state.repath=0;state.path=[];state.pathIndex=0;}
room.enemyStates.get('e0').cooldown=10;
for(let i=0;i<10;i++)sim.tick(.1);
const moved=room.enemyStates.get('e0');
check('敵の移動位置はサーバーのtickでプレイヤーへ近づく',()=>{assert.ok(Math.hypot(moved.x-cA.x,moved.z-cA.z)<Math.hypot(startX-cA.x,startZ-cA.z)-.3);});
check('サーバー管理の敵位置スナップショットが部屋の全員へ配信される',()=>{const events=sent.filter(x=>x.msg.t==='rogueEnemyMotion'&&x.msg.instanceId===room.id);assert.ok(events.some(x=>x.to===61));assert.ok(events.some(x=>x.to===62));assert.ok(events.at(-1).msg.enemies.some(e=>e.id==='e0'&&Number.isFinite(e.x)));});
// Server attacks only the selected alive party member. Other enemy cooldowns are held to avoid unrelated hits.
cA.x=moved.x;cA.z=moved.z;cA.lastStateAt=Date.now();
for(const [id,state] of room.enemyStates)state.cooldown=20;
room.enemyStates.get('e0').cooldown=0;room.enemyStates.get('e0').repath=0;room.enemyStates.get('e0').path=[];room.enemyStates.get('e0').pathIndex=0;
const hurtStart=sent.length;
const shadeWindup=Shared.getRogueEnemyProfile('shade',0).windup;
for(let i=0;i<Math.ceil(shadeWindup/.05)+2;i++)sim.tick(.05);
const hurtEvents=sent.slice(hurtStart).filter(x=>x.msg.t==='roguePlayerHurt');
check('敵の攻撃はサーバーで発生し、標的プレイヤーにだけ送信される',()=>{assert.ok(hurtEvents.some(x=>x.to===61&&x.msg.sourceId==='e0'));assert.equal(hurtEvents.some(x=>x.to===62),false);});
// Dynamic server coordinates, not seed/layout coordinates, are authoritative for player hits.
const s=room.enemyStates.get('e0');s.x=7;s.z=-31;s.yaw=0;
cB.x=7.5;cB.z=-31;cB.cave=Shared.ROGUE_DUNGEON_INDEX;cB.dead=false;cB.hasState=true;cB.lastStateAt=Date.now();
const hpBefore=room.enemyHp.get('e0');sim.rogueHitCooldowns.delete('62:e0');
sim.handle(62,{t:'rogueHit',targetId:'e0',damage:1,x:s.x,z:s.z});
check('敵の現在位置に届いた攻撃をサーバーが受け入れる',()=>assert.equal(room.enemyHp.get('e0'),hpBefore-1));
const hpAfter=room.enemyHp.get('e0');sim.rogueHitCooldowns.delete('62:e0');
sim.handle(62,{t:'rogueHit',targetId:'e0',damage:8,x:layout.enemies.find(e=>e.id==='e0').x,z:layout.enemies.find(e=>e.id==='e0').z});
check('古い初期位置を指定した遠隔ヒット偽装は拒否される',()=>assert.equal(room.enemyHp.get('e0'),hpAfter));
if(!process.exitCode)console.log('Rogue enemy authority checks passed.');
