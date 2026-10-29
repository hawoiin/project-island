'use strict';
// 島のボスが複数いる仕組みと、大熊(bear)の確認。石の守護者(guardian)は別のテスト(smoke.js)で確認する。
const Shared = require('../public/shared.js');

let fails = 0;
const check = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fails++; };
const gy = (x, z) => Shared.islandHeight(x, z);
const B = Shared.BOSS_DEFS.bear, G = Shared.BOSS_DEFS.guardian;

// ---- 定義表 ----
check('ボスの種類は守護者と大熊', Shared.BOSS_TYPES.join() === 'guardian,bear');
check('大熊は叩きつけと突進を持つ', !!B.attacks.slam && !!B.attacks.charge && B.attacks.charge.shape === 'lane');
check('大熊の攻撃の名前が状態コードにある', Object.keys(B.attacks).every(k => k in Shared.BOSS_STATE_CODE));
check('大熊は守護者より速く、体力は少ない', B.speed > G.speed && B.maxHp < G.maxHp);

// ---- 持ち場: seed から決まり、陸地で、他の目印から離れている(既存ワールドの配置は変えない) ----
let homesOk = true, why = '';
for (let seed = 1; seed <= 60 && homesOk; seed++) {
  const h = Shared.getBossHome(seed, 'bear'), again = Shared.getBossHome(seed, 'bear'), g = Shared.getBossHome(seed);
  const ruins = Shared.getRuinLocations(seed, 6);
  if (h.x !== again.x || h.z !== again.z) { homesOk = false; why = seed + ' 再現できない'; }
  else if (Shared.getBossHome(seed, 'guardian').x !== g.x) { homesOk = false; why = seed + ' 守護者の持ち場が変わった'; }
  else if (Shared.islandHeight(h.x, h.z) < 1.5 || Shared.isInsideCaveArea(h.x, h.z, 8)) { homesOk = false; why = seed + ' 陸地でない/洞窟の中'; }
  else if (Math.hypot(h.x - g.x, h.z - g.z) < 20) { homesOk = false; why = seed + ' 守護者に近い'; }
  else if (ruins.some(r => Math.hypot(h.x - r.x, h.z - r.z) < 10)) { homesOk = false; why = seed + ' 遺跡に近い'; }
  else if (Shared.getFeatureClearZones(seed).some(z => Math.hypot(h.x - z.x, h.z - z.z) < z.r + 5)) { homesOk = false; why = seed + ' 灯台・泉・野営地に近い'; }
}
check('大熊の持ち場は60個のseedすべてで条件を満たす', homesOk, why);

// ---- ワールドの組み立て ----
const seed = 4242;
const home = Shared.getBossHome(seed, 'bear');
const mkWorld = () => {
  const w = new Shared.WorldSim({ seed }), sent = [], bc = [];
  w.out = { sendTo(id, m) { sent.push([id, m]); }, broadcast(m) { bc.push(m); } };
  const join = (id, x, z) => {
    w.addClient(id); w.handle(id, { t: 'join', name: 'p' + id, key: 'k' + id });
    const c = w.clients.get(id); c.x = x; c.z = z; c.y = gy(x, z); c.hasState = true; return c;
  };
  const until = (pred, max) => { let n = 0; while (!pred() && n++ < (max || 400)) w.tick(0.05); return pred(); };
  return { w, sent, bc, join, until };
};
// 持ち場から島の中心の方へ d メートルの地点(陸地の上に確実に立てる向き)
const towardCenter = d => {
  const len = Math.hypot(home.x, home.z) || 1, ux = -home.x / len, uz = -home.z / len;
  return { x: home.x + ux * d, z: home.z + uz * d, ux, uz };
};

{ // welcome / スナップショット
  const { w, join, bc } = mkWorld();
  const wel = w.welcomeFor(99);
  check('welcome に2体のボスが入る', wel.bosses.length === 2 && wel.bosses.some(b => b.id === 'bear' && b.hp === B.maxHp && b.x === home.x));
  join(1, home.x + 60, home.z);
  w.broadcastSnap();
  const sn = bc.find(m => m.t === 'snap');
  const row = sn && sn.b && sn.b.find(r => r[0] === 'bear');
  check('スナップショットに大熊の位置・状態・体力が入る', !!row && row.length === 6 && row[5] === B.maxHp);
}

{ // 眠り・起床・独立した体力
  const { w, join, bc, sent, until } = mkWorld();
  const bear = w.bosses.get('bear'), guardian = w.bosses.get('guardian');
  const p = join(1, home.x + 60, home.z);
  for (let i = 0; i < 40; i++) w.tick(0.05);
  check('遠くにいる間は大熊は動かない(idle)', bear.state === 'idle' && bear.x === home.x);

  const near = towardCenter(B.hitRange - 2); // 攻撃が届く距離
  p.x = near.x; p.z = near.z; p.y = gy(p.x, p.z);
  w.handle(1, { t: 'hitboss', dmg: 2 }); // id なし = 守護者宛て。遠いので無効
  check('idなしの攻撃は守護者宛てで、遠ければ無効', guardian.hp === G.maxHp && bear.hp === B.maxHp);
  w.handle(1, { t: 'hitboss', id: 'bear', dmg: 2 });
  const hit = bc.find(m => m.t === 'bhit');
  check('大熊への攻撃は大熊の体力だけを減らす', bear.hp === B.maxHp - 2 && guardian.hp === G.maxHp && hit && hit.id === 'bear' && hit.maxHp === B.maxHp);
  check('攻撃されると大熊は起きる', bear.state !== 'idle');
  w.handle(1, { t: 'hitboss', id: 'unknown', dmg: 2 });
  check('存在しないidの攻撃は無視される', bear.hp === B.maxHp - 2);
  p.x = home.x + 60; p.z = home.z; p.y = gy(p.x, p.z);
  w.handle(1, { t: 'hitboss', id: 'bear', dmg: 2 });
  check('離れすぎた攻撃は無効', bear.hp === B.maxHp - 2);

  // 撃破と復活(守護者には影響しない)
  const q = w.clients.get(1); q.x = home.x + 3; q.z = home.z; q.y = gy(q.x, q.z); q.lastHitAt.clear();
  bear.hp = 1; bear.x = home.x; bear.z = home.z; bc.length = 0;
  w.handle(1, { t: 'hitboss', id: 'bear', dmg: 1 });
  const dead = bc.find(m => m.t === 'bdead');
  check('体力が尽きると大熊だけ撃破される(bdead にid)', !bear.alive && guardian.alive && dead && dead.id === 'bear');
  check('撃破後の welcome には守護者だけが入る', w.welcomeFor(5).bosses.length === 1 && w.welcomeFor(5).bosses[0].id === 'guardian');
  w.tick(0.05);
  check('復活時間より前は復活しない', !w.bosses.get('bear').alive);
  w.bosses.get('bear').respawnAt = 0; bc.length = 0; w.tick(0.05);
  const re = bc.find(m => m.t === 'bspawn');
  check('時間が来ると大熊が復活(bspawn にid)して体力が全快', w.bosses.get('bear').alive && w.bosses.get('bear').hp === B.maxHp && re && re.id === 'bear');
}

{ // 近距離: 叩きつけ。範囲に残った人だけ被弾する
  const { w, join, bc, sent, until } = mkWorld();
  const stay = join(1, home.x + 2.5, home.z), dodge = join(2, home.x + 3, home.z);
  check('近づくと叩きつけを予告する', until(() => bc.some(m => m.t === 'batk')) && bc.find(m => m.t === 'batk').kind === 'slam');
  const a = bc.find(m => m.t === 'batk');
  check('予告は大熊の足元の円で、id が付く', a.id === 'bear' && a.zones.length === 1 && Math.abs(a.zones[0][0] - w.bosses.get('bear').x) < 0.1 && a.zones[0][2] === B.attacks.slam.r[0]);
  dodge.x = home.x + 40; dodge.z = home.z;
  check('溜めが終わると着弾(bimpact)する', until(() => bc.some(m => m.t === 'bimpact')));
  const hurts = sent.filter(([, m]) => m.t === 'hurt');
  check('範囲内の人だけが仕様どおりのダメージを受ける', hurts.length === 1 && hurts[0][0] === 1 && hurts[0][1].amount === B.attacks.slam.dmg);
  void stay;
}

{ // 遠距離: 突進。向きを固定した通り道に残った人だけが被弾し、大熊は通り道の終点に着く
  const { w, join, bc, sent, until } = mkWorld();
  const bear = w.bosses.get('bear');
  const p = towardCenter(10);
  const stay = join(1, p.x, p.z), side = join(2, p.x - p.uz * 8, p.z + p.ux * 8); // 通り道の横8m
  check('離れた相手には突進を予告する', until(() => bc.some(m => m.t === 'batk')) && bc.find(m => m.t === 'batk').kind === 'charge');
  const a = bc.find(m => m.t === 'batk');
  const ok = a.zones.every(z => z[2] === B.attacks.charge.r[0]);
  check('予告は大熊の前方へ並んだ複数の円', a.zones.length >= 3 && ok && Math.hypot(a.zones[0][0] - bear.x, a.zones[0][1] - bear.z) < 4);
  const last = a.zones[a.zones.length - 1];
  const along = (last[0] - bear.x) * Math.sin(bear.ry) + (last[1] - bear.z) * Math.cos(bear.ry);
  check('通り道は大熊が向いた方向で、長さは仕様の範囲内', along > 5 && along <= B.attacks.charge.len[0] + 0.5);
  const inLane = a.zones.some(z => Math.hypot(stay.x - z[0], stay.z - z[1]) <= z[2]);
  check('立っている人は通り道の中、横にいる人は外', inLane && !a.zones.some(z => Math.hypot(side.x - z[0], side.z - z[1]) <= z[2] + 0.3));
  check('溜めが終わると着弾する', until(() => bc.some(m => m.t === 'bimpact')));
  const hurts = sent.filter(([, m]) => m.t === 'hurt');
  check('通り道の人だけが突進のダメージを受ける', hurts.length === 1 && hurts[0][0] === 1 && hurts[0][1].amount === B.attacks.charge.dmg);
  check('突進のあと大熊は通り道の終点付近に着地する', Math.hypot(bear.x - last[0], bear.z - last[1]) < 2.5);
  check('突進のあとは硬直(recover)に入る', bear.state === 'recover' || bear.state === 'chase');
}

{ // 突進の通り道が海で途切れる場合でも、水へは入らない
  const { w, join, bc, until } = mkWorld();
  // 持ち場から島の外(海)の方向へ相手を置く
  const len = Math.hypot(home.x, home.z) || 1, ox = home.x / len, oz = home.z / len;
  join(1, home.x + ox * 12, home.z + oz * 12);
  until(() => bc.some(m => m.t === 'batk'));
  const a = bc.find(m => m.t === 'batk');
  check('通り道の円はすべて陸地の上', !a || a.zones.every(z => Shared.islandHeight(z[0], z[1]) >= 0.8));
}

if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('ALL PASS boss-bear (server)');
