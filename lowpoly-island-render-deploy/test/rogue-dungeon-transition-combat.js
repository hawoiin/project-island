// ダンジョン敵の向きと、ローグライク退室後のフィールド戦闘復帰を検証する。
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const sharedSource = fs.readFileSync(path.join(root, 'public', 'shared.js'), 'utf8');
const Shared = require('../public/shared.js');
let failures = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failures++; }

check('ダンジョン敵と守護者の向きはサーバーが計算し、クライアントが同じ回転へ補間する',
  /state\.yaw=Math\.atan2\(-dx,-dz\)/.test(sharedSource) &&
  html.includes('target.targetYaw') && html.includes('e.mesh.rotation.y+=delta*alpha'));

// Three.jsのローカル -Z 前方をyaw回転した方向がターゲット方向と一致するか数値確認。
const faceYaw = (dx, dz) => Math.atan2(-dx, -dz);
const forwardAfterYaw = yaw => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[2,-3]]) {
  const d = Math.hypot(dx,dz), f = forwardAfterYaw(faceYaw(dx,dz));
  check(`敵の正面ベクトルがターゲット方向へ向く (${dx},${dz})`,
    Math.abs(f.x - dx/d) < 1e-9 && Math.abs(f.z - dz/d) < 1e-9);
}

check('サーバーは生還門・通常出口・死亡後のみローグライク退室を許可する',
  /if \(isRogueDungeonIndex\(fromCave\)\) \{[\s\S]*?const atMainExit = distanceXZ\(fromX, fromZ, CAVE_INTERIOR_EXIT\.x, CAVE_INTERIOR_EXIT\.z\) <= CAVE_TRANSITION_RADIUS;[\s\S]*?const atExtractionPortal = distanceXZ\(fromX, fromZ, 0, getRogueDungeonVariant\(fromCave\)==='linear' \? -201 : -201\) <= CAVE_TRANSITION_RADIUS;[\s\S]*?if \(!atMainExit && !atExtractionPortal && !allowDeadExit\) return false;[\s\S]*?return distanceXZ\(toX, toZ, ex, ez\) <= CAVE_EXIT_SPAWN_RADIUS;/.test(sharedSource));
check('通常洞窟は従来どおり出口付近からしか退室できない',
  /if \(distanceXZ\(fromX, fromZ, CAVE_INTERIOR_EXIT\.x, CAVE_INTERIOR_EXIT\.z\) > CAVE_TRANSITION_RADIUS\) return false;/.test(sharedSource));
check('ローグライク退室直後にクライアントのinsideCave状態も解除される',
  /inCaveIndex=-1; insideCave=false; activeScene=scene; camSnap=true; setCaveAudio\(false\);/.test(html));

const sim = new Shared.WorldSim({ seed: 60031 });
const broadcasts = [], received = [];
sim.out = { sendTo(id,msg) { received.push({id,msg}); }, broadcast(msg) { broadcasts.push(msg); } };
sim.addClient(21);
sim.handle(21, { t: 'join', name: 'rogue exit tester', key: 'rogue-exit-key' });
const rogueIndex = Shared.ROGUE_DUNGEON_INDEX;
const site = Shared.CAVE_SITES[rogueIndex];
const mouth = { x: site.x + site.dirX * Shared.CAVE_MOUTH_OFFSET, z: site.z + site.dirZ * Shared.CAVE_MOUTH_OFFSET };
sim.handle(21, { t: 'state', x: mouth.x, y: Shared.islandHeight(mouth.x, mouth.z), z: mouth.z, ry: 0, cave: -1, f: 0 });
sim.handle(21, { t: 'state', x: Shared.CAVE_INTERIOR_ENTRY.x, y: 0, z: Shared.CAVE_INTERIOR_ENTRY.z, ry: 0, cave: rogueIndex, f: 0 });
const client = sim.clients.get(21);
check('正規の入口からローグライク遺跡へ入れる', client.cave === rogueIndex);
// ボス後の生還門付近へ進んだ状態を再現。移動速度の個別テストではなく、退室遷移を検証する。
client.lastStateAt = Date.now() - 10000;
sim.handle(21, { t: 'state', x: 0, y: -5.2, z: -201, ry: 0, cave: rogueIndex, f: 0 });
check('深層の生還門付近の位置をサーバーが受け付ける', client.cave === rogueIndex && client.z === -201);
const exit = { x: site.x + site.dirX * Shared.CAVE_EXIT_OFFSET, z: site.z + site.dirZ * Shared.CAVE_EXIT_OFFSET };
sim.handle(21, { t: 'state', x: exit.x, y: Shared.islandHeight(exit.x, exit.z), z: exit.z, ry: 0, cave: -1, f: 0 });
check('深層の生還門から島へ戻った時、サーバーのcave状態も屋外(-1)へ戻る', client.cave === -1 && Math.abs(client.x-exit.x)<0.01 && Math.abs(client.z-exit.z)<0.01);

// 帰還後、サーバーの敵AIがプレイヤーを再び攻撃対象にできることも確認。
const wolf = sim.enemies.find(e => e && e.kind === 'wolf' && e.alive);
if (wolf) {
  // ランダム生成された狼が海岸や高度の合わない地形にいるとテスト結果が揺れるため、
  // ダンジョン出口付近の確実な陸地へ移し、敵AIの帰還後ターゲット復帰だけを検証する。
  wolf.x=exit.x+2; wolf.z=exit.z; wolf.homeX=wolf.x; wolf.homeZ=wolf.z; wolf.tx=wolf.x; wolf.tz=wolf.z;
  wolf.awake=true; wolf.mv=null; wolf.mvPh=0; wolf.mvT=0; wolf.mvHit=null;
  wolf.attackTimer=0; wolf.fleeTimer=0; wolf.returnT=0; wolf.retarget=0; wolf.knockX=wolf.knockZ=0;
  client.lastStateAt = Date.now() - 10000;
  sim.handle(21, { t:'state', x:exit.x, y:Shared.islandHeight(exit.x,exit.z), z:exit.z, ry:0, cave:-1, f:0 });
  for(let i=0;i<100&&!received.some(v=>v.id===21&&v.msg.t==='hurt');i++) sim.updateEnemies(.05,Date.now()+i*50);
  check('帰還後にフィールド敵AIがプレイヤーへ再度ダメージを送れる', received.some(v=>v.id===21&&v.msg.t==='hurt'));
} else {
  check('帰還後にフィールド敵AIがプレイヤーへ再度ダメージを送れる', false);
}

// 帰還後の通常攻撃がサーバーで拒否されないことを確認。
const fieldEnemy = sim.enemies.find(e => e && e.alive);
if (fieldEnemy) {
  fieldEnemy.x = exit.x + 1;
  fieldEnemy.z = exit.z;
  fieldEnemy.tx = fieldEnemy.x;
  fieldEnemy.tz = fieldEnemy.z;
  client.lastHitAt.clear();
  sim.handle(21, { t: 'hit', id: fieldEnemy.id, dmg: 1, kp: 5.5 });
  check('帰還後はフィールド敵への攻撃がサーバーで受理される', broadcasts.some(m => m.t === 'ehit' && m.id === fieldEnemy.id && m.by === 21));
} else {
  check('帰還後はフィールド敵への攻撃がサーバーで受理される', false);
}

const deathSim = new Shared.WorldSim({ seed: 60032 });
deathSim.out = { sendTo() {}, broadcast() {} };
deathSim.addClient(22);
deathSim.handle(22, { t: 'join', name: 'rogue death tester', key: 'rogue-death-key' });
const deathMouth = { x: site.x + site.dirX * Shared.CAVE_MOUTH_OFFSET, z: site.z + site.dirZ * Shared.CAVE_MOUTH_OFFSET };
deathSim.handle(22, { t: 'state', x: deathMouth.x, y: Shared.islandHeight(deathMouth.x, deathMouth.z), z: deathMouth.z, ry: 0, cave: -1, f: 0 });
deathSim.handle(22, { t: 'state', x: Shared.CAVE_INTERIOR_ENTRY.x, y: 0, z: Shared.CAVE_INTERIOR_ENTRY.z, ry: 0, cave: rogueIndex, f: 0 });
const deathClient = deathSim.clients.get(22);
deathClient.lastStateAt = Date.now() - 10000;
deathSim.handle(22, { t: 'state', x: 0, y: -3.5, z: -150, ry: 0, cave: rogueIndex, f: 8 });
check('死亡状態はサーバーに同期される', deathClient.cave === rogueIndex && deathClient.dead === true && deathClient.z === -150);
deathSim.handle(22, { t: 'state', x: exit.x, y: Shared.islandHeight(exit.x, exit.z), z: exit.z, ry: 0, cave: -1, f: 0 });
check('深層で死亡した後も島へ帰還し、サーバー戦闘状態が復帰する', deathClient.cave === -1 && deathClient.dead === false);
const arbitraryExitSim = new Shared.WorldSim({ seed: 60033 });
arbitraryExitSim.out = { sendTo() {}, broadcast() {} };
arbitraryExitSim.addClient(23);
arbitraryExitSim.handle(23, { t: 'join', name: 'rogue invalid exit tester', key: 'rogue-invalid-exit-key' });
const invMouth = { x: site.x + site.dirX * Shared.CAVE_MOUTH_OFFSET, z: site.z + site.dirZ * Shared.CAVE_MOUTH_OFFSET };
arbitraryExitSim.handle(23, { t: 'state', x: invMouth.x, y: Shared.islandHeight(invMouth.x, invMouth.z), z: invMouth.z, ry: 0, cave: -1, f: 0 });
arbitraryExitSim.handle(23, { t: 'state', x: 0, y: 0, z: Shared.CAVE_INTERIOR_ENTRY.z, ry: 0, cave: rogueIndex, f: 0 });
const invalidExitClient = arbitraryExitSim.clients.get(23);
invalidExitClient.lastStateAt = Date.now() - 10000;
arbitraryExitSim.handle(23, { t: 'state', x: 30, y: 0, z: -120, ry: 0, cave: rogueIndex, f: 0 });
invalidExitClient.lastStateAt = Date.now() - 10000;
arbitraryExitSim.handle(23, { t: 'state', x: exit.x, y: Shared.islandHeight(exit.x, exit.z), z: exit.z, ry: 0, cave: -1, f: 0 });
check('床のない位置への移動と死亡・出口・生還門以外からの退室ワープを拒否する', invalidExitClient.cave === rogueIndex && invalidExitClient.z === Shared.CAVE_INTERIOR_ENTRY.z);

if (failures) process.exit(1);
console.log('Rogue dungeon transition/combat checks passed.');
