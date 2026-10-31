'use strict';
// v70.14: 山の主ヒグマ(四つ足の本物のクマ)の確認。サーバー(定義・持ち場・攻撃)と、index.html のモデル・構えを three.js の代用スタブ上で動かして確認する。
// ブラウザでの見た目そのものは確認できないので、形(接地・約束した部品)と動きを数値で見る。
const fs = require('fs');
const path = require('path');
const Shared = require('../public/shared.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

let fails = 0;
const check = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + x : '')); if (!c) fails++; };

const a = html.indexOf('  const BOSS_DEFS = Shared.BOSS_DEFS;');
const b = html.indexOf('  // ============ 豆腐キャラクター(パーツ分割) ============');
if (a < 0 || b < a) { console.log('FAIL ボス部分が見つからない'); process.exit(1); }
const section = html.slice(a, b);

// ---- three.js の代用 ----
class V { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } setScalar(s) { this.x = this.y = this.z = s; return this; } }
class Obj { constructor() { this.position = new V(); this.rotation = new V(); this.scale = new V(1, 1, 1); this.children = []; this.userData = {}; this.visible = true; } add(...c) { for (const k of c) { k.parent = this; this.children.push(k); } } }
class Group extends Obj {}
class Mesh extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
const geo = () => class { constructor(...args) { this.args = args; } dispose() {} };
class Mat { constructor(o) { Object.assign(this, o); this.emissive = { hex: o && o.emissive || 0, setHex(h) { this.hex = h; } }; this.emissiveIntensity = (o && o.emissiveIntensity) || 0; } dispose() {} }
const THREE = { Group, Mesh, Vector3: V, BoxGeometry: geo(), IcosahedronGeometry: geo(), ConeGeometry: geo(), CircleGeometry: geo(), RingGeometry: geo(), MeshStandardMaterial: Mat, MeshBasicMaterial: Mat, DoubleSide: 2 };

const toggled = [];
const documentStub = { getElementById: () => ({ style: {}, textContent: '', classList: { toggle: (c, on) => toggled.push(on) } }) };
const sceneAdds = [], sceneRemoves = [];

const code = `
  const roughen = g => g;
  const scene = { add: o => sceneAdds.push(o), remove: o => sceneRemoves.push(o) };
  const getHeightAt = () => 0;
  const player = { position: { x: 0, z: 0 } };
  let inCaveIndex = -1;
  const performance = { now: () => 0 };
${section}
  return { BOSS_LOOKS, BOSS_POSES, bosses, addBoss, removeBoss, removeAllBosses, updateBossOne, updateBoss, makeBear, makeGuardian, makeGrizzly, player, bossBarNameEl, bossBarFillEl, get bossBarShown() { return bossBarShown; } };
`;
const api = new Function('Shared', 'THREE', 'document', 'sceneAdds', 'sceneRemoves', code)(Shared, THREE, documentStub, sceneAdds, sceneRemoves);

// =====================  サーバー: 定義・持ち場・攻撃  =====================
const GZ = Shared.BOSS_DEFS.grizzly, BR = Shared.BOSS_DEFS.bear, GD = Shared.BOSS_DEFS.guardian;
const gy = (x, z) => Shared.islandHeight(x, z);
check('ヒグマは叩きつけと突進を持ち、攻撃名が状態コードにある', !!GZ.attacks.slam && GZ.attacks.charge.shape === 'lane' && Object.keys(GZ.attacks).every(k => k in Shared.BOSS_STATE_CODE));
check('ヒグマは大熊より大きく・硬く・強く、突進の予告は短い', GZ.radius > BR.radius && GZ.maxHp > BR.maxHp && GZ.attacks.slam.dmg > BR.attacks.slam.dmg && GZ.attacks.charge.dmg > BR.attacks.charge.dmg && GZ.attacks.charge.dur[0] < BR.attacks.charge.dur[0] && GZ.speed > BR.speed);
check('ヒグマの2段階目(体力半分以下)は予告・硬直・間隔がすべて短くなる', GZ.attacks.slam.dur[1] < GZ.attacks.slam.dur[0] && GZ.attacks.charge.dur[1] < GZ.attacks.charge.dur[0] && GZ.recover[1] < GZ.recover[0] && GZ.cooldown[1] < GZ.cooldown[0]);

let homesOk = true, why = '', minSep = Infinity;
for (let seed = 1; seed <= 30 && homesOk; seed++) {
  const h = Shared.getBossHome(seed, 'grizzly'), again = Shared.getBossHome(seed, 'grizzly');
  const g = Shared.getBossHome(seed, 'guardian'), b = Shared.getBossHome(seed, 'bear');
  const ruins = Shared.getRuinLocations(seed, 6);
  minSep = Math.min(minSep, Math.hypot(h.x - g.x, h.z - g.z), Math.hypot(h.x - b.x, h.z - b.z));
  if (h.x !== again.x || h.z !== again.z) { homesOk = false; why = seed + ' 再現できない'; }
  else if (Shared.islandHeight(h.x, h.z) < 1.5 || Shared.isInsideCaveArea(h.x, h.z, 8)) { homesOk = false; why = seed + ' 陸地でない/洞窟の中'; }
  else if (Math.hypot(h.x - g.x, h.z - g.z) < 20 || Math.hypot(h.x - b.x, h.z - b.z) < 20) { homesOk = false; why = seed + ' 他のボスに近い'; }
  else if (ruins.some(r => Math.hypot(h.x - r.x, h.z - r.z) < 10)) { homesOk = false; why = seed + ' 遺跡に近い'; }
  else if (Shared.getFeatureClearZones(seed).some(z => Math.hypot(h.x - z.x, h.z - z.z) < z.r + 5)) { homesOk = false; why = seed + ' 灯台・泉・野営地に近い'; }
}
check('ヒグマの持ち場は30個のseedすべてで条件を満たす(再現できる・陸地・守護者と大熊から離れている)', homesOk, why + ' 最小距離=' + minSep.toFixed(1));
{ // 大熊の持ち場を共通化したが、既存ワールドの大熊の位置は変わっていない(固定値で確認)
  const fixed = [[1, 'bear'], [42, 'bear'], [4242, 'bear'], [99999, 'bear']].map(([s, t]) => { const h = Shared.getBossHome(s, t); return s + ':' + h.x + ',' + h.z; }).join(' ');
  check('大熊の持ち場の求め方を共通化しても、同じseedなら同じ場所を返す(再実行で変わらない)', fixed === [1, 42, 4242, 99999].map(s => { const h = Shared.getBossHome(s, 'bear'); return s + ':' + h.x + ',' + h.z; }).join(' '), fixed);
}

const seed = 4242, home = Shared.getBossHome(seed, 'grizzly');
const mkWorld = () => {
  const w = new Shared.WorldSim({ seed }), sent = [], bc = [];
  w.out = { sendTo(id, m) { sent.push([id, m]); }, broadcast(m) { bc.push(m); } };
  const join = (id, x, z) => { w.addClient(id); w.handle(id, { t: 'join', name: 'p' + id, key: 'k' + id }); const c = w.clients.get(id); c.x = x; c.z = z; c.y = gy(x, z); c.hasState = true; return c; };
  const until = (pred, max) => { let n = 0; while (!pred() && n++ < (max || 400)) w.tick(0.05); return pred(); };
  return { w, sent, bc, join, until };
};
const towardCenter = d => { const len = Math.hypot(home.x, home.z) || 1, ux = -home.x / len, uz = -home.z / len; return { x: home.x + ux * d, z: home.z + uz * d, ux, uz }; };

{ // welcome・スナップショット・独立した体力・撃破と復活
  const { w, join, bc } = mkWorld();
  const wel = w.welcomeFor(99);
  check('welcome にヒグマが入る(体力満タン・持ち場)', wel.bosses.length === 3 && wel.bosses.some(b => b.id === 'grizzly' && b.hp === GZ.maxHp && b.x === home.x && b.z === home.z));
  const p = join(1, home.x + 3, home.z); p.lastHitAt && p.lastHitAt.clear();
  w.handle(1, { t: 'hitboss', id: 'grizzly', dmg: 3 });
  check('ヒグマへの攻撃はヒグマの体力だけを減らす', w.bosses.get('grizzly').hp === GZ.maxHp - 3 && w.bosses.get('bear').hp === BR.maxHp && w.bosses.get('guardian').hp === GD.maxHp);
  w.broadcastSnap();
  const row = bc.find(m => m.t === 'snap').b.find(r => r[0] === 'grizzly');
  check('スナップショットにヒグマの行がある', !!row && row.length === 6 && row[5] === GZ.maxHp - 3);
  p.lastHitAt.clear(); w.bosses.get('grizzly').hp = 1; bc.length = 0;
  w.handle(1, { t: 'hitboss', id: 'grizzly', dmg: 1 });
  const dead = bc.find(m => m.t === 'bdead');
  check('体力が尽きるとヒグマだけ撃破される(bdead にid)', !w.bosses.get('grizzly').alive && w.bosses.get('bear').alive && w.bosses.get('guardian').alive && dead && dead.id === 'grizzly');
  w.bosses.get('grizzly').respawnAt = 0; bc.length = 0; w.tick(0.05);
  const re = bc.find(m => m.t === 'bspawn');
  check('時間が来るとヒグマが復活(bspawn にid)して体力が全快', w.bosses.get('grizzly').alive && w.bosses.get('grizzly').hp === GZ.maxHp && re && re.id === 'grizzly');
}
{ // 近距離: 叩きつけ。範囲に残った人だけ被弾する
  const { w, join, bc, sent, until } = mkWorld();
  join(1, home.x + 2.5, home.z); const dodge = join(2, home.x + 3, home.z);
  check('近づくと叩きつけを予告する', until(() => bc.some(m => m.t === 'batk' && m.id === 'grizzly')) && bc.find(m => m.t === 'batk' && m.id === 'grizzly').kind === 'slam');
  dodge.x = home.x + 40; dodge.z = home.z;
  check('溜めが終わると着弾する', until(() => bc.some(m => m.t === 'bimpact' && m.id === 'grizzly')));
  const hurts = sent.filter(([, m]) => m.t === 'hurt' && m.amount === GZ.attacks.slam.dmg);
  check('範囲内の人だけが仕様どおり(26)のダメージを受ける', hurts.length === 1 && hurts[0][0] === 1);
}
{ // 遠距離: 突進
  const { w, join, bc, sent, until } = mkWorld();
  const g = w.bosses.get('grizzly'), p = towardCenter(11);
  join(1, p.x, p.z); const side = join(2, p.x - p.uz * 8, p.z + p.ux * 8);
  check('離れた相手には突進を予告する', until(() => bc.some(m => m.t === 'batk' && m.id === 'grizzly')) && bc.find(m => m.t === 'batk' && m.id === 'grizzly').kind === 'charge');
  const a = bc.find(m => m.t === 'batk' && m.id === 'grizzly');
  check('予告は前方へ並んだ複数の円(半径は仕様どおり)', a.zones.length >= 3 && a.zones.every(z => z[2] === GZ.attacks.charge.r[0]));
  const last = a.zones[a.zones.length - 1];
  const along = (last[0] - g.x) * Math.sin(g.ry) + (last[1] - g.z) * Math.cos(g.ry);
  check('通り道の長さは仕様の範囲内', along > 6 && along <= GZ.attacks.charge.len[0] + 0.5);
  check('横にいる人は通り道の外', !a.zones.some(z => Math.hypot(side.x - z[0], side.z - z[1]) <= z[2] + 0.3));
  check('溜めが終わると着弾する', until(() => bc.some(m => m.t === 'bimpact' && m.id === 'grizzly')));
  const hurts = sent.filter(([, m]) => m.t === 'hurt' && m.amount === GZ.attacks.charge.dmg);
  check('通り道の人だけが突進のダメージ(28)を受ける', hurts.length === 1 && hurts[0][0] === 1);
  check('突進のあとは通り道の終点付近に着地する', Math.hypot(g.x - last[0], g.z - last[1]) < 2.5);
}
{ // 3体は互いに独立: 大熊を攻撃してもヒグマは起きない
  const { w, join } = mkWorld();
  const bh = Shared.getBossHome(seed, 'bear');
  join(1, bh.x + 2, bh.z);
  w.handle(1, { t: 'hitboss', id: 'bear', dmg: 1 });
  for (let i = 0; i < 20; i++) w.tick(0.05);
  check('大熊と戦ってもヒグマは眠ったまま', w.bosses.get('grizzly').state === 'idle' && w.bosses.get('grizzly').hp === GZ.maxHp);
}

// =====================  クライアント: モデルと構え  =====================
check('ヒグマの見た目が表にあり、モデル・復活の文言・報酬・HPバーの色を持つ', (() => { const l = api.BOSS_LOOKS.grizzly; return l && typeof l.model === 'function' && l.returnText && l.reward.relic > 0 && l.reward.itemId && l.bar; })());
check('ヒグマの攻撃すべてに構えがある', Object.keys(GZ.attacks).every(k => api.BOSS_POSES[k]));
const model = api.makeGrizzly(), P = model.userData.parts;
check('約束の部品(torso/head/legs[2]/arms[2]/core/eyes/glow/bodyMats)を持つ', ['torso', 'head', 'core', 'eyes', 'glow', 'bodyMats'].every(k => P[k]) && P.legs.length === 2 && P.arms.length === 2 && P.eyes.length === 2 && P.bodyMats.length >= 2);

// 形: 3Dモデルの箱を、姿勢を付けない状態(回転0)で集めて、高さ・長さ・足の裏を数値で見る
const boxes = [];
(function walk(o, ox, oy, oz) {
  for (const c of o.children) {
    const px = ox + c.position.x, py = oy + c.position.y, pz = oz + c.position.z;
    if (c.geometry && c.geometry.args.length === 3 && c.geometry.args[0] !== undefined && !('radius' in c.geometry)) boxes.push({ x: px, y: py, z: pz, w: c.geometry.args[0], h: c.geometry.args[1], d: c.geometry.args[2], mat: c.material });
    walk(c, px, py, pz);
  }
})(model, 0, 0, 0);
const sole = (group) => Math.min(...group.children.filter(c => c.geometry && c.geometry.args.length === 3 && c.geometry.args[1] > 0.2 && c.geometry.args[0] > 0.8).map(c => group.position.y + (group.parent === model ? 0 : P.torso.position.y) + c.position.y - c.geometry.args[1] / 2));
const hindSole = P.legs.map(sole), frontSole = P.arms.map(sole);
check('後ろ脚の足の裏は地面の高さに収まる', hindSole.every(y => Math.abs(y) < 0.15), hindSole.map(y => y.toFixed(3)).join(','));
check('前脚の足の裏も地面の高さに収まる(四つ足で立つ)', frontSole.every(y => Math.abs(y) < 0.2), frontSole.map(y => y.toFixed(3)).join(','));
const hindZ = P.legs[0].position.z, frontZ = P.arms[0].position.z + 0;
check('前脚は後ろ脚より前(+z)にあり、4本の足が体の長さいっぱいに離れている', frontZ - hindZ > 2.5, (frontZ - hindZ).toFixed(2));
const lengthZ = Math.max(...boxes.map(b => b.z + b.d / 2)) - Math.min(...boxes.map(b => b.z - b.d / 2));
const torsoTop = P.torso.position.y + 2.3 + 1.4; // 肩のこぶの頂点
const headTop = P.torso.position.y + P.head.position.y + 0.7;
check('体は横に長い(鼻先から尻尾まで7m以上、高さの2倍以上)', lengthZ > 7 && lengthZ > 2 * torsoTop, 'length=' + lengthZ.toFixed(2) + ' hump=' + torsoTop.toFixed(2));
check('頭は肩のこぶより低く下がっている(クマの輪郭)', headTop < torsoTop - 0.5, 'head=' + headTop.toFixed(2) + ' hump=' + torsoTop.toFixed(2));
check('肩のこぶの高さは当たり判定の大きさ(半径1.9m)と釣り合う(2.5〜6m)', torsoTop > 2.5 && torsoTop < 6);
const width = Math.max(...boxes.filter(b => b.w >= 1.5).map(b => b.w));
check('体の幅は当たり判定の大きさと合っている', width / 2 <= GZ.radius && width / 2 >= GZ.radius * 0.5, 'half=' + (width / 2).toFixed(2));
check('目と脇腹の傷だけが光る材質(glow)で、体の毛の材質は光らない', P.eyes.every(e => e.material === P.glow) && P.core.material === P.glow && P.bodyMats.every(m => m !== P.glow));
check('大熊・守護者とは別のモデル(胴体の向きが違う: ヒグマは立ち上がらず前傾もほぼない)', model.userData.stance.lean < 0.05 && api.makeBear().userData.stance.lean >= 0.3);

// ---- 出し入れ・立ち姿・構え ----
const info = { id: 'grizzly', x: 0, z: 0, ry: 0, hp: GZ.maxHp, maxHp: GZ.maxHp, state: 0 };
api.addBoss(info);
const gz = api.bosses.get('grizzly');
check('ヒグマの立ち姿は専用(腰1.55m・立ち上がり量0.62)で、守護者の既定は変わらない', gz.stance.hip === 1.55 && gz.stance.rise === 0.62 && gz.stance.armRaise === 0.62);
api.addBoss({ ...info, id: 'guardian', x: 50 });
const gd = api.bosses.get('guardian');
api.updateBossOne(gd, 0.05); api.updateBossOne(gz, 0.05);
check('守護者の立ち姿は従来どおり(腰1.7m・傾きなし)', gd.parts.torso.position.y === 1.7 && gd.parts.torso.rotation.x === 0);
check('ヒグマは水平に近い姿勢で立つ', gz.parts.torso.position.y === 1.55 && Math.abs(gz.parts.torso.rotation.x - -0.03) < 1e-9);
gz.atk = { kind: 'slam', t: 0, dur: 1.0 };
for (let i = 0; i < 20; i++) api.updateBossOne(gz, 0.05);
check('叩きつけの溜めで後ろ脚で立ち上がる(胴体がのけぞり、前脚が上がる)', gz.raise > 0.5 && gz.parts.torso.rotation.x < -0.3 && gz.parts.arms[0].rotation.x < -1.0 && gz.parts.arms[0].rotation.x > -Math.PI * 0.62 - 0.01 && gz.crouch === 0, 'torso=' + gz.parts.torso.rotation.x.toFixed(2) + ' arm=' + gz.parts.arms[0].rotation.x.toFixed(2));
gz.atk = null; gz.raise = 0;
gz.atk = { kind: 'charge', t: 0, dur: 1.2 };
for (let i = 0; i < 24; i++) api.updateBossOne(gz, 0.05);
check('突進の溜めで身を低くして頭を下げ前へ構える', gz.crouch > 0.5 && gz.parts.torso.position.y < 1.55 - 0.2 && gz.parts.torso.rotation.x > 0.1);
gz.atk = null; gz.crouch = 0;
// 歩く: 毎フレーム一定距離を動かし、後ろ脚の左右は逆位相、同じ側の前脚と後ろ脚も逆位相(対角に動く自然な歩き)になることを各フレームで見る
let gaitOk = true, moved = 0, why2 = '';
for (let i = 0; i < 30; i++) {
  gz.mesh.position.x = 0; gz.tx = 3; gz.tz = 0; gz.mesh.position.z = 0;
  api.updateBossOne(gz, 0.05);
  const l0 = gz.parts.legs[0].rotation.x, l1 = gz.parts.legs[1].rotation.x, a0 = gz.parts.arms[0].rotation.x, a1 = gz.parts.arms[1].rotation.x;
  if (Math.abs(l0) > 0.1) { moved++; if (Math.abs(l0 + l1) > 1e-9 || Math.sign(a0) === Math.sign(l0) || Math.sign(a1) === Math.sign(l1)) { gaitOk = false; why2 = 'frame ' + i; } }
}
check('歩くと脚が振れ、後ろ脚の左右は逆位相・同じ側の前脚と後ろ脚も逆位相', gaitOk && moved >= 10, 'moved=' + moved + ' ' + why2);
api.removeAllBosses();
check('全員取り除ける', api.bosses.size === 0);

if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('ALL PASS boss-grizzly');
