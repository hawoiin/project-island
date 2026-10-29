// プロトコルのテスト: `npm test`(サーバーを自動で起動して、複数のクライアントを繋ぐ)
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const WebSocket = require('ws');
const Shared = require('../public/shared.js');

let fails = 0;
const check = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const gy = (x, z) => Shared.islandHeight(x, z);

// ---- テスト用クライアント ----
function client(port) {
  const ws = new WebSocket('ws://localhost:' + port);
  const c = { ws, msgs: [], welcome: null };
  ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'welcome') c.welcome = m; else c.msgs.push(m); });
  c.send = o => ws.send(JSON.stringify(o));
  c.of = t => c.msgs.filter(m => m.t === t);
  c.ready = new Promise(r => ws.on('open', r));
  return c;
}
// 参加して、指定の位置に立つ
async function enter(c, name, key, x, z) {
  c.send({ t: 'join', name, key });
  if (!c._position) {
    // 初回状態は新規接続と再接続を区別できないため、サーバーが受け取った最初の位置を同期点にする。
    c.send({ t: 'state', x, y: gy(x, z), z, ry: 0, cave: -1, f: 0 });
    c._position = { x, z };
    await sleep(150);
    return;
  }
  const from = c._position;
  const distance = Math.hypot(x - from.x, z - from.z);
  const steps = Math.max(1, Math.ceil(distance / 6));
  for (let i = 1; i <= steps; i++) {
    const nx = from.x + (x - from.x) * i / steps;
    const nz = from.z + (z - from.z) * i / steps;
    c.send({ t: 'state', x: nx, y: gy(nx, nz), z: nz, ry: 0, cave: -1, f: 0 });
    await sleep(200);
  }
  c._position = { x, z };
  await sleep(150);
}

// ---- サーバー起動 ----
async function startServer(port, extraEnv) {
  const saveFile = path.join(os.tmpdir(), `lowpoly-smoke-${port}-${Date.now()}.json`);
  const proc = spawn('node', [path.join(__dirname, '../server.js')], {
    env: Object.assign({}, process.env, { PORT: port, SAVE_FILE: saveFile }, extraEnv || {}),
  });
  let out = '';
  proc.stdout.on('data', d => out += d); proc.stderr.on('data', d => out += d);
  for (let i = 0; i < 50 && !/起動/.test(out); i++) await sleep(100);
  return { proc, saveFile, stop() { proc.kill('SIGTERM'); try { fs.unlinkSync(saveFile); } catch (e) { /* 無ければ良い */ } } };
}

(async () => {
  // ================= WorldSim 単体 =================
  // 保存→復元
  const s1 = new Shared.WorldSim({});
  s1.out = { sendTo() {}, broadcast() {} };
  s1.addClient(1); s1.handle(1, { t: 'join', name: 'x', key: 'k1' });
  s1.handle(1, { t: 'state', x: 30, y: gy(30, 30), z: 30, ry: 0, cave: -1, f: 0 });
  s1.handle(1, { t: 'place', buildId: 'hut', x: 33, y: gy(33, 30), z: 30, ry: 0.5 });
  const chestSpotForSave = s1.chestLocations[1];
  s1.clients.get(1).hasState = false;
  s1.handle(1, { t: 'state', x: chestSpotForSave.x, y: chestSpotForSave.y, z: chestSpotForSave.z, ry: 0, cave: -1, f: 0 });
  s1.handle(1, { t: 'chest', idx: 1 });
  const s2 = new Shared.WorldSim({ saved: JSON.parse(JSON.stringify(s1.serialize())) });
  check('保存→復元: シード・建築物・宝箱・所有者が引き継がれる',
    s2.seed === s1.seed && s2.structures.size === 1 && s2.chests.has(1) && [...s2.structures.values()][0].owner === Shared.hashKey('k1'));

  // 所有者のいない旧データは誰でも回収できる
  const s2b = new Shared.WorldSim({ saved: { seed: 1, structures: [{ sid: 5, buildId: 'fence', x: 40, y: gy(40, 40), z: 40, ry: 0 }], chests: [] } });
  const removed = [];
  s2b.out = { sendTo() {}, broadcast: m => removed.push(m) };
  s2b.addClient(9); s2b.handle(9, { t: 'join', name: 'y', key: 'k9' });
  s2b.handle(9, { t: 'state', x: 40, y: gy(40, 40), z: 40, ry: 0, cave: -1, f: 0 });
  s2b.handle(9, { t: 'pickup', sid: 5 });
  check('所有者のいない旧データの建築物は誰でも回収できる', removed.some(m => m.t === 'removed' && m.sid === 5));

  // オオカミ: 近くのプレイヤーを襲う / 洞窟内のプレイヤーは襲わない
  const s3 = new Shared.WorldSim({});
  const hurts = [];
  s3.out = { sendTo: (id, m) => hurts.push([id, m]), broadcast() {} };
  s3.addClient(7); s3.handle(7, { t: 'join', name: 'w' });
  hurts.length = 0;
  const wolf = s3.enemies[0];
  s3.handle(7, { t: 'state', x: wolf.x + 0.5, y: gy(wolf.x, wolf.z), z: wolf.z, ry: 0, cave: -1, f: 0 });
  for (let i = 0; i < 40; i++) s3.tick(0.05);
  check('オオカミが近くのプレイヤーにダメージを送る', hurts.some(h => h[0] === 7 && h[1].t === 'hurt'));
  // 体の当たり判定: 敵はプレイヤー・他の敵の中に入り込まない
  {
    const w2 = wolf, minP = Shared.BODY_RADIUS.wolf + Shared.BODY_RADIUS.player;
    s3.handle(7, { t: 'state', x: w2.x, y: 0, z: w2.z, ry: 0, cave: -1, f: 0 });
    s3.tick(0.05);
    const dPl = Math.hypot(w2.x - s3.clients.get(7).x, w2.z - s3.clients.get(7).z);
    check('敵はプレイヤーと同じ位置に重ならない(押し出される)', dPl >= minP - 0.2, 'dist=' + dPl.toFixed(2));
    const e1 = s3.enemies[1], e2 = s3.enemies[2];
    e2.x = e1.x; e2.z = e1.z; e2.homeX = e1.x; e2.homeZ = e1.z; e2.tx = e1.x; e2.tz = e1.z;
    s3.handle(7, { t: 'state', x: e1.x + 50, y: 0, z: e1.z, ry: 0, cave: -1, f: 0 });
    for (let i = 0; i < 5; i++) s3.tick(0.05);
    const dEn = Math.hypot(e1.x - e2.x, e1.z - e2.z);
    check('敵どうしも重ならない', dEn >= Shared.BODY_RADIUS[e1.kind] + Shared.BODY_RADIUS[e2.kind] - 0.1, 'dist=' + dEn.toFixed(2));
    const bp = Shared.bodyPush(0, 0, 0.3, 0, 1);
    check('bodyPush: 離れていれば null、重なっていれば押し出し量', Shared.bodyPush(0, 0, 2, 0, 1) === null && Math.abs(bp.x + 0.7) < 1e-9 && bp.z === 0);
  }
  const hm = (hurts.find(h => h[1].t === 'hurt') || [0, {}])[1];
  check('hurt に弾かれる向き(単位ベクトル)が付く', typeof hm.dx === 'number' && typeof hm.dz === 'number' && Math.abs(Math.hypot(hm.dx, hm.dz) - 1) < 0.02, JSON.stringify(hm));
  hurts.length = 0;
  // 実際の状態遷移と同様、洞窟入口にいる状態から室内へ移す。
  const caveClient = s3.clients.get(7);
  const caveSite = Shared.CAVE_SITES[0];
  caveClient.x = caveSite.x; caveClient.z = caveSite.z + Shared.CAVE_MOUTH_OFFSET;
  caveClient.cave = -1; caveClient.lastStateAt = Date.now(); caveClient.hasState = true;
  s3.handle(7, { t: 'state', x: Shared.CAVE_INTERIOR_ENTRY.x, y: 0, z: Shared.CAVE_INTERIOR_ENTRY.z, ry: 0, cave: 0, f: 0 });
  for (let i = 0; i < 40; i++) s3.tick(0.05);
  check('洞窟入口から入室したプレイヤーは襲われない', caveClient.cave === 0 && !hurts.some(h => h[1].t === 'hurt'));

  // 設置ルール(共有コード)
  const none = [];
  const land = { x: 30, z: 30 };
  check('設置ルール: 陸地は置ける', Shared.checkPlacement('campfire', land.x, gy(land.x, land.z), land.z, none) === null);
  check('設置ルール: 海は置けない', Shared.checkPlacement('campfire', -200, gy(-200, 55), 55, none) === 'sea');
  check('設置ルール: 洞窟の外観エリアは置けない',
    Shared.checkPlacement('campfire', 160, gy(160, -62), -62, none) === 'cave');
  const campfire = [{ buildId: 'campfire', x: land.x, y: gy(land.x, land.z), z: land.z }];
  check('設置ルール: 他の建物と重なると置けない', Shared.checkPlacement('campfire', land.x + 0.5, gy(land.x, land.z), land.z, campfire) === 'overlap');
  check('設置ルール: 離せば置ける', Shared.checkPlacement('campfire', land.x + 3, gy(land.x + 3, land.z), land.z, campfire) === null);
  check('敵の数: 狼・猪・岩トカゲ・カニ・クラゲ・初期版の狼/猪が設定どおり出現する', s1.enemies.length === Shared.ENEMY_ORDER.length && s1.enemies.filter(e => e.kind === 'wolf' && !e.camp).length === Shared.ENEMY_WOLF_COUNT && s1.enemies.filter(e => e.kind === 'lizard' && !e.camp).length === Shared.ENEMY_LIZARD_COUNT && s1.enemies.filter(e => e.kind === 'crab').length === Shared.ENEMY_CRAB_COUNT && s1.enemies.filter(e => e.kind === 'jelly' && !e.grotto).length === Shared.ENEMY_JELLY_COUNT && s1.enemies.filter(e => e.kind === 'wolfClassic').length === Shared.ENEMY_CLASSIC_WOLF_COUNT && s1.enemies.filter(e => e.kind === 'boarClassic').length === Shared.ENEMY_CLASSIC_BOAR_COUNT && s1.enemies.every(e => e.alive));
  check('設置ルール: 板張りの家も置ける/重なれない', Shared.checkPlacement('cabin', 60, gy(60, 60), 60, []) === null && Shared.checkPlacement('cabin', 60, gy(60, 60), 60, [{ buildId: 'hut', x: 60.5, y: gy(60, 60), z: 60 }]) === 'overlap');
  check('設置ルール: 床の上には建物を置ける', Shared.checkPlacement('hut', 20, gy(20, 20) + 0.1, 20, [{ buildId: 'floor', x: 20, y: gy(20, 20), z: 20 }]) === null);
  check('設置ルール: 地面から離れすぎは置けない', Shared.checkPlacement('campfire', land.x, gy(land.x, land.z) + 30, land.z, none) === 'height');
  check('ハッシュ: 同じキーは同じ識別子、違うキーは違う識別子',
    Shared.hashKey('abc') === Shared.hashKey('abc') && Shared.hashKey('abc') !== Shared.hashKey('abd') && Shared.hashKey('') === '');

  // ================= 敵・建築の基本仕様 =================
  {
    const w = new Shared.WorldSim({ seed: 7 });
    check('敵の数は定数どおり', w.enemies.length === Shared.ENEMY_ORDER.length);
    check('cabin(長い小屋)の当たり判定が定義されている', Shared.BUILD_RADIUS.cabin > 0);
    let spot = null;
    for (let x = 20; x < 120 && !spot; x += 2) if (gy(x, 20) > 1.5 && Shared.checkPlacement('cabin', x, gy(x, 20), 20, []) === null) spot = x;
    check('cabin を平地に置ける', spot !== null);
    check('cabin は他の建物と重ならない', spot === null || Shared.checkPlacement('cabin', spot + 1, gy(spot + 1, 20), 20, [{ buildId: 'cabin', x: spot, y: gy(spot, 20), z: 20 }]) === 'overlap');
  }

  // ================= ボス(遺跡の石の守護者) =================
  {
    const G = Shared.BOSS_DEFS.guardian;
    const seed = 4242;
    const w = new Shared.WorldSim({ seed });
    const sent = [], bc = [];
    w.out = { sendTo(id, m) { sent.push([id, m]); }, broadcast(m) { bc.push(m); } };
    const home = Shared.getBossHome(seed);
    const again = Shared.getBossHome(seed);
    check('ボスの持ち場は seed から決まる(サーバー/クライアントで一致)', home.x === again.x && home.z === again.z);
    check('ボスの持ち場は陸地で、洞窟の外観エリアの外', Shared.islandHeight(home.x, home.z) >= 1.1 && !Shared.isInsideCaveArea(home.x, home.z, 0));
    check('welcome にボス情報が入る', (w.welcomeFor(99).bosses.find(b => b.id === 'guardian') || {}).hp === G.maxHp);

    const join = (id, x, z) => {
      w.addClient(id); w.handle(id, { t: 'join', name: 'p' + id, key: 'k' + id });
      w.handle(id, { t: 'state', x, y: gy(x, z), z, ry: 0, cave: -1, f: 0, ts: 0 });
      const c = w.clients.get(id); c.x = x; c.z = z; c.y = gy(x, z); c.hasState = true; return c;
    };
    const run = (sec) => { for (let i = 0; i < sec * 20; i++) w.tick(0.05); };

    // 眠っている: 遠くのプレイヤーには反応しない
    const far = join(1, home.x + 60, home.z);
    run(2);
    check('遠くにいる間は動かない(idle)', w.bosses.get('guardian').state === 'idle' && w.bosses.get('guardian').x === home.x);
    // 攻撃: 離れていると届かない
    w.handle(1, { t: 'hitboss', dmg: 3 });
    check('離れすぎた攻撃は無効', w.bosses.get('guardian').hp === G.maxHp);

    // 近づくと起きて、予告つきの攻撃をしてくる
    far.x = home.x + 10; far.z = home.z; far.y = gy(far.x, far.z);
    bc.length = 0; sent.length = 0;
    run(3);
    check('近づくと目を覚ます', w.bosses.get('guardian').state !== 'idle');
    const atk = bc.find(m => m.t === 'batk');
    check('攻撃の前に予告(batk)が届く', !!atk && atk.zones.length >= 1 && atk.dur > 0);

    // 予告された範囲に居続けると被弾、動いて避ければ被弾しない
    // 予告 → 着弾まで待ち、着弾の瞬間の位置で判定されることを確かめる
    const w2 = new Shared.WorldSim({ seed });
    const sent2 = [], bc2 = [];
    w2.out = { sendTo(id, m) { sent2.push([id, m]); }, broadcast(m) { bc2.push(m); } };
    const h2 = Shared.getBossHome(seed);
    const mk = (id, x, z) => { w2.addClient(id); w2.handle(id, { t: 'join', name: 'p', key: 'k' + id }); const c = w2.clients.get(id); c.x = x; c.z = z; c.y = gy(x, z); c.hasState = true; return c; };
    const stay = mk(1, h2.x + 3, h2.z), dodge = mk(2, h2.x + 3.5, h2.z);
    let ticks = 0;
    while (!bc2.some(m => m.t === 'batk') && ticks++ < 400) w2.tick(0.05);
    const a2 = bc2.find(m => m.t === 'batk');
    check('近距離なら叩きつけ(slam)', a2 && a2.kind === 'slam');
    dodge.x = h2.x + 40; dodge.z = h2.z; // 予告を見て範囲の外へ逃げた
    ticks = 0;
    while (!bc2.some(m => m.t === 'bimpact') && ticks++ < 400) w2.tick(0.05);
    check('溜めが終わると着弾(bimpact)が届く', bc2.some(m => m.t === 'bimpact'));
    const hurts = sent2.filter(([, m]) => m.t === 'hurt');
    check('範囲内に残った人だけ被弾する', hurts.some(([id]) => id === 1) && !hurts.some(([id]) => id === 2));
    check('被弾ダメージは攻撃の仕様どおり', hurts.every(([, m]) => m.amount === G.attacks.slam.dmg));

    // 洞窟内・死亡中の人は狙われず、被弾もしない
    const cave = mk(3, h2.x + 2, h2.z); cave.cave = 0;
    const dead = mk(4, h2.x + 2, h2.z); dead.dead = true;
    check('洞窟内・死亡中は狙われない', w2.bossTargets(w2.bosses.get('guardian'), 50).every(t => t.c.id !== 3 && t.c.id !== 4));

    // ダメージ・クールダウン・撃破・復活
    const w3 = new Shared.WorldSim({ seed });
    const bc3 = [];
    w3.out = { sendTo() {}, broadcast(m) { bc3.push(m); } };
    const h3 = Shared.getBossHome(seed);
    w3.addClient(1); w3.handle(1, { t: 'join', name: 'p', key: 'k' });
    const c3 = w3.clients.get(1); c3.x = h3.x + 4; c3.z = h3.z; c3.hasState = true;
    w3.handle(1, { t: 'hitboss', dmg: 3 });
    check('近ければダメージが入る', w3.bosses.get('guardian').hp === G.maxHp - 3 && bc3.some(m => m.t === 'bhit' && m.dmg === 3));
    w3.handle(1, { t: 'hitboss', dmg: 3 });
    check('連打はクールダウンで無視される', w3.bosses.get('guardian').hp === G.maxHp - 3);
    c3.lastHitAt.clear(); w3.handle(1, { t: 'hitboss', dmg: 999 });
    check('ダメージは 1〜4 に丸められる', w3.bosses.get('guardian').hp === G.maxHp - 7);
    check('攻撃されると起きる', w3.bosses.get('guardian').state !== 'idle');
    w3.bosses.get('guardian').hp = 1; c3.lastHitAt.clear(); w3.handle(1, { t: 'hitboss', dmg: 1 });
    check('体力が尽きると撃破(bdead)', !w3.bosses.get('guardian').alive && bc3.some(m => m.t === 'bdead' && m.by === 1));
    check('撃破後はスナップショットにボスが含まれない', (bc3.length = 0, w3.broadcastSnap(), !(bc3.find(m => m.t === 'snap').b || []).some(r => r[0] === 'guardian')));
    check('撃破後は welcome にボスが入らない', !w3.welcomeFor(5).bosses.some(b => b.id === 'guardian'));
    w3.tick(0.05);
    check('復活時間より前は復活しない', !w3.bosses.get('guardian').alive);
    w3.bosses.get('guardian').respawnAt = 0; bc3.length = 0; w3.tick(0.05);
    check('時間が来ると復活(bspawn)して体力が全快', w3.bosses.get('guardian').alive && w3.bosses.get('guardian').hp === G.maxHp && bc3.some(m => m.t === 'bspawn'));

    // 逃げ切られたら持ち場へ戻って全回復
    const w4 = new Shared.WorldSim({ seed });
    w4.out = { sendTo() {}, broadcast() {} };
    const h4 = Shared.getBossHome(seed);
    w4.addClient(1); w4.handle(1, { t: 'join', name: 'p', key: 'k' });
    const c4 = w4.clients.get(1); c4.x = h4.x + 4; c4.z = h4.z; c4.hasState = true;
    w4.handle(1, { t: 'hitboss', dmg: 4 });
    c4.x = h4.x + 200; // 遠くへ逃げる
    for (let i = 0; i < 20 * 60; i++) w4.tick(0.05);
    check('相手を見失うと持ち場に戻って体力が全快する', w4.bosses.get('guardian').state === 'idle' && Math.hypot(w4.bosses.get('guardian').x - h4.x, w4.bosses.get('guardian').z - h4.z) < 1 && w4.bosses.get('guardian').hp === G.maxHp);

    // スナップショット
    const w5 = new Shared.WorldSim({ seed }); const bc5 = [];
    w5.out = { sendTo() {}, broadcast(m) { bc5.push(m); } };
    w5.addClient(1); w5.handle(1, { t: 'join', name: 'p', key: 'k' });
    w5.broadcastSnap();
    const sn = bc5.find(m => m.t === 'snap');
    check('スナップショットにボスの位置・状態・体力が入る', sn && Array.isArray(sn.b) && (sn.b.find(r => r[0] === 'guardian') || []).length === 6 && sn.b.find(r => r[0] === 'guardian')[5] === G.maxHp);
  }

  // ================= 実サーバー(既定: 他人の建築物は回収できない) =================
  const srv = await startServer(3998);
  try {
    const a = client(3998), b = client(3998);
    await Promise.all([a.ready, b.ready]); await sleep(200);
    check('同じシードの welcome を受け取る', a.welcome && b.welcome && a.welcome.seed === b.welcome.seed && a.welcome.id !== b.welcome.id);
    check('welcome に回収ポリシーが含まれる(既定は不可)', a.welcome.pickupOthers === false);

    await enter(a, 'A', 'key-A', 12, 10);
    check('join が他の接続に届く', b.of('join').some(m => m.id === a.welcome.id && m.name === 'A'));
    check('joined で自分の識別子が返る', a.of('joined').some(m => m.pid === Shared.hashKey('key-A')));
    await enter(b, 'B', 'key-B', 12, 10);
    await sleep(250);
    check('スナップショットに他プレイヤーの位置が含まれる', b.of('snap').some(m => m.p.some(p => p[0] === a.welcome.id && p[1] === 12)));

    a.send({ t: 'take', key: 'o5', kind: 'wood' }); b.send({ t: 'take', key: 'o5', kind: 'wood' }); await sleep(150);
    check('同時取得は先着1人だけ(もう一方は denied)', a.of('taken').length === 1 && b.of('taken').length === 1 && (a.of('takeDenied').length + b.of('takeDenied').length) === 1);

    // 建築: 配信・所有者・拒否理由
    a.send({ t: 'place', buildId: 'fence', x: 12, y: gy(12, 10), z: 10, ry: 0 }); await sleep(100);
    const placed = b.of('placed')[0];
    check('建築が全員に配信される(所有者つき)', placed && placed.buildId === 'fence' && placed.owner === Shared.hashKey('key-A'));
    a.send({ t: 'place', buildId: 'fence', x: 12.2, y: gy(12, 10), z: 10, ry: 0 }); await sleep(100);
    check('重なる場所への建築は overlap で拒否', a.of('placeDenied').some(m => m.reason === 'overlap'));
    a.send({ t: 'place', buildId: 'fence', x: 500, y: 2, z: 500, ry: 0 }); await sleep(100);
    check('遠すぎる場所への建築は拒否', a.of('placeDenied').some(m => m.reason === 'distance'));
    await enter(a, 'A', 'key-A', -200, 55);
    a.send({ t: 'place', buildId: 'campfire', x: -200, y: gy(-200, 55), z: 55, ry: 0 }); await sleep(100);
    check('海への建築は sea で拒否', a.of('placeDenied').some(m => m.reason === 'sea'));
    await enter(a, 'A', 'key-A', 160, -62);
    a.send({ t: 'place', buildId: 'campfire', x: 160, y: gy(160, -62), z: -62, ry: 0 }); await sleep(100);
    check('洞窟の外観エリアへの建築は cave で拒否', a.of('placeDenied').some(m => m.reason === 'cave'));
    await enter(a, 'A', 'key-A', 30, 30);
    a.send({ t: 'place', buildId: 'campfire', x: 30, y: 2, z: 30, ry: 0 }); await sleep(100);
    check('地面と合わない高さの建築は拒否(height)', a.of('placeDenied').some(m => m.reason === 'height'));

    // 回収: 他人は拒否、持ち主は成功
    await enter(a, 'A', 'key-A', 12, 10);
    await enter(b, 'B', 'key-B', 12, 10);
    b.send({ t: 'pickup', sid: placed.sid }); await sleep(100);
    check('他人の建築物の回収は pickupDenied', b.of('pickupDenied').some(m => m.sid === placed.sid) && a.of('removed').length === 0);
    a.send({ t: 'pickup', sid: placed.sid }); await sleep(100);
    check('持ち主は回収できる', a.of('removed').some(m => m.sid === placed.sid && m.by === a.welcome.id));

    // 一括回収: 複数の建築物を1要求で回収し、同じ結果が全クライアントへ届く。
    const batchStart = a.of('placed').length;
    for (const x of [12, 15, 18]) {
      a.send({ t: 'place', buildId: 'fence', x, y: gy(x, 10), z: 10, ry: 0 });
      await sleep(120);
    }
    const batchPlaced = a.of('placed').slice(batchStart).filter(m => m.by === a.welcome.id);
    const batchSids = batchPlaced.map(m => m.sid);
    a.send({ t: 'pickupMany', requestId: 123, sids: batchSids }); await sleep(150);
    const batchResult = a.of('pickupManyResult').find(m => m.requestId === 123);
    check('一括回収で選択した3つの建築物がサーバーから回収される', batchSids.length === 3 && batchResult && batchResult.recovered === 3);
    check('一括回収のremoved通知が他の参加者にも届く', batchSids.length === 3 && batchSids.every(sid => b.of('removed').some(m => m.sid === sid && m.by === a.welcome.id)));

    // 再接続しても同じキーなら同じ持ち主として扱われる
    a.send({ t: 'place', buildId: 'fence', x: 12, y: gy(12, 10), z: 10, ry: 0 }); await sleep(100);
    const placed2 = a.of('placed').pop();
    a.ws.close(); await sleep(200);
    const a2 = client(3998); await a2.ready; await sleep(100);
    await enter(a2, 'A', 'key-A', 12, 10);
    check('再接続後の welcome に建築物が含まれる', a2.welcome.structures.some(s => s.sid === placed2.sid));
    a2.send({ t: 'pickup', sid: placed2.sid }); await sleep(100);
    check('再接続後も(同じキーなら)自分の建築物を回収できる', b.of('removed').some(m => m.sid === placed2.sid));

    // 宝箱は近接距離をサーバー側で確認するため、開始地点からの遠隔開封は拒否される。
    a2.send({ t: 'chest', idx: 0 }); b.send({ t: 'chest', idx: 0 }); await sleep(100);
    check('離れた場所から宝箱を遠隔開封できない', a2.of('chestOpened').length === 0);
    const fighter = client(3998); await fighter.ready; await sleep(100);
    const en = fighter.welcome.enemies.filter(e => e.kind === 'boar').sort((u, v) =>
      Math.hypot(u.x - 12, u.z - 10) - Math.hypot(v.x - 12, v.z - 10))[0];
    fighter.send({ t: 'join', name: 'Fighter', key: 'fighter-key' });
    fighter.send({ t: 'state', x: en.x + 1, y: 0, z: en.z, ry: 0, cave: -1, f: 0 }); await sleep(100);
    for (let i = 0; i < 2; i++) { fighter.send({ t: 'hit', id: en.id, dmg: 4, kp: 5 }); await sleep(280); } // 猪のHPは8
    await sleep(200);
    check('敵に当てるとHPが減り、倒すと edead が届く', b.of('ehit').some(m => m.id === en.id) && b.of('edead').some(m => m.id === en.id));
    fighter.ws.close();

    // チャット・エモート
    a2.send({ t: 'chat', text: '  やあ<script>  ' }); await sleep(100);
    check('チャットは全員に届く(<>除去・空白除去・名前つき)', b.of('chat').some(m => m.text === 'やあscript' && m.id === a2.welcome.id && m.name));
    a2.send({ t: 'chat', text: 'また' }); await sleep(100);
    check('連投は間隔制限で無視される', !b.of('chat').some(m => m.text === 'また'));
    await sleep(600);
    a2.send({ t: 'chat', text: '   ' }); await sleep(100);
    check('空のチャットは無視される', b.of('chat').length === 1);
    a2.send({ t: 'chat', text: 'あ'.repeat(200) }); await sleep(100);
    check('長いチャットは切り詰められる', b.of('chat').some(m => m.text.length === Shared.CHAT_MAX_CHARS));
    await sleep(600);
    a2.send({ t: 'emote', e: 99 }); await sleep(100);
    check('範囲外のエモートは無視される', b.of('emote').length === 0);
    a2.send({ t: 'emote', e: 2 }); await sleep(100);
    check('エモートは全員に届く', b.of('emote').some(m => m.e === 2 && m.id === a2.welcome.id));

    a2.ws.close(); await sleep(150);
    check('切断で leave が届く', b.of('leave').some(m => m.id === a2.welcome.id));
    b.ws.close();
  } catch (e) { console.log('ERROR', e); fails++; }
  srv.stop();

  // ================= 実サーバー(PICKUP_OTHERS=1: 他人の建築物も回収できる) =================
  const srv2 = await startServer(3997, { PICKUP_OTHERS: '1' });
  try {
    const a = client(3997), b = client(3997);
    await Promise.all([a.ready, b.ready]); await sleep(200);
    check('PICKUP_OTHERS=1 なら welcome のポリシーが可になる', a.welcome.pickupOthers === true);
    await enter(a, 'A', 'key-A', 12, 10); await enter(b, 'B', 'key-B', 12, 10);
    a.send({ t: 'place', buildId: 'fence', x: 12, y: gy(12, 10), z: 10, ry: 0 }); await sleep(100);
    const p = b.of('placed')[0];
    b.send({ t: 'pickup', sid: p.sid }); await sleep(100);
    check('PICKUP_OTHERS=1 なら他人の建築物も回収できる', a.of('removed').some(m => m.sid === p.sid && m.by === b.welcome.id));
    a.ws.close(); b.ws.close();
  } catch (e) { console.log('ERROR', e); fails++; }
  srv2.stop();

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
