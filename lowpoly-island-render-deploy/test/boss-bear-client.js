'use strict';
// index.html のボス部分(モデル・構え・HPバー・出し入れ)を three.js の代用スタブ上で実際に動かして確認する。
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
  return { BOSS_LOOKS, BOSS_POSES, bosses, addBoss, removeBoss, removeAllBosses, updateBossOne, updateBoss, makeBear, makeGuardian, player, bossBarNameEl, bossBarFillEl, get bossBarShown() { return bossBarShown; } };
`;
const api = new Function('Shared', 'THREE', 'document', 'sceneAdds', 'sceneRemoves', code)(Shared, THREE, documentStub, sceneAdds, sceneRemoves);

// ---- 表と約束 ----
check('見た目の表はボスの種類と一致する', Object.keys(api.BOSS_LOOKS).join() === Shared.BOSS_TYPES.join());
check('どの見た目も モデル・復活の文言・報酬・HPバーの色 を持つ', Object.values(api.BOSS_LOOKS).every(l => typeof l.model === 'function' && l.returnText && l.reward && l.reward.relic > 0 && l.reward.itemId && l.bar));
const bearAttacks = Object.keys(Shared.BOSS_DEFS.bear.attacks);
check('大熊の攻撃すべてに構え(予告中の姿勢)がある', bearAttacks.every(k => api.BOSS_POSES[k]));

const need = ['torso', 'head', 'core', 'eyes', 'glow', 'bodyMats'];
for (const [name, make] of [['守護者', api.makeGuardian], ['大熊', api.makeBear]]) {
  const P = make().userData.parts;
  check(name + 'のモデルは約束の部品(torso/head/legs[2]/arms[2]/core/eyes/glow/bodyMats)を持つ',
    need.every(k => P[k]) && P.legs.length === 2 && P.arms.length === 2 && P.eyes.length === 2 && P.bodyMats.length >= 2);
}
// 足の裏が地面(y=0)付近に来る(脚の下端 = 腰の高さ + 脚の箱の下端)
const bearModel = api.makeBear();
const legBottom = bearModel.userData.parts.legs.map(l => Math.min(...l.children.filter(c => c.geometry.args.length === 3 && c.geometry.args[1] > 0.3).map(c => l.position.y + c.position.y - c.geometry.args[1] / 2)));
check('大熊の足の裏は地面の高さに収まる', legBottom.every(y => Math.abs(y) < 0.15), legBottom.map(y => y.toFixed(3)).join(','));
check('大熊の体の幅は当たり判定の大きさと合っている', (() => { const t = bearModel.userData.parts.torso.children.filter(c => c.geometry && c.geometry.args.length === 3).map(c => c.geometry.args[0]); return Math.max(...t) / 2 > Shared.BOSS_DEFS.bear.radius * 0.8 && Math.max(...t) / 2 < Shared.BOSS_DEFS.bear.radius * 1.6; })());

// ---- 出し入れ ----
const info = (id, x, z) => { const hp = (Shared.BOSS_DEFS[id] || { maxHp: 1 }).maxHp; return { id, x, z, ry: 0, hp, maxHp: hp, state: 0 }; };
api.addBoss(info('guardian', 100, 0)); api.addBoss(info('bear', -100, 0));
check('2体を同時に出せる', api.bosses.size === 2 && sceneAdds.length === 2);
api.addBoss(info('unknown', 0, 0));
check('知らないボスは無視される', api.bosses.size === 2);
api.addBoss(info('bear', -100, 0));
check('同じボスをもう一度出しても1体のまま(古いのは取り除く)', api.bosses.size === 2 && sceneRemoves.length === 1);
check('守護者の立ち姿の既定は腰1.7m・前傾なし、大熊は専用', api.bosses.get('guardian').stance.hip === 1.7 && api.bosses.get('guardian').stance.lean === 0 && api.bosses.get('bear').stance.hip === 1.5 && api.bosses.get('bear').stance.lean === 0.3);

// ---- 立ち姿と構え ----
const g = api.bosses.get('guardian'), bear = api.bosses.get('bear');
api.updateBossOne(g, 0.05); api.updateBossOne(bear, 0.05);
check('守護者の立ち姿は変わらない(腰1.7m・傾きなし)', g.parts.torso.position.y === 1.7 && g.parts.torso.rotation.x === 0);
check('大熊は前かがみで立つ', bear.parts.torso.position.y === 1.5 && Math.abs(bear.parts.torso.rotation.x - 0.3) < 1e-9);

bear.atk = { kind: 'charge', t: 0, dur: 1.3 };
for (let i = 0; i < 26; i++) api.updateBossOne(bear, 0.05);
check('突進の溜めで身を低くして前へ構える', bear.crouch > 0.5 && bear.parts.torso.position.y < 1.5 - 0.2 && bear.parts.torso.rotation.x > 0.3 + 0.1);
bear.atk = null; bear.crouch = 0; bear.raise = 0;
bear.atk = { kind: 'slam', t: 0, dur: 0.9 };
for (let i = 0; i < 18; i++) api.updateBossOne(bear, 0.05);
check('叩きつけの溜めで腕を振り上げる(身は低くしない)', bear.raise > 0.5 && bear.parts.arms[0].rotation.x < -1.2 && bear.crouch === 0);
check('溜めを終えて着弾すると構えが戻る方向へ動く', (() => { bear.atk = null; const before = bear.raise; for (let i = 0; i < 10; i++) api.updateBossOne(bear, 0.05); return bear.raise < before; })());
g.atk = { kind: 'rock', t: 0, dur: 1.5 };
for (let i = 0; i < 20; i++) api.updateBossOne(g, 0.05);
check('守護者の落石の構えは従来どおり(腕を上げ、身は低くしない)', g.raise > 0.3 && g.crouch === 0 && g.parts.torso.position.y > 1.6);
bear.atk = null; g.atk = null;

// ---- HPバー: いちばん近い1体の名前を出す ----
const setPlayer = (x, z) => { api.player.position.x = x; api.player.position.z = z; };
bear.hp = Shared.BOSS_DEFS.bear.maxHp / 2; bear.state = 0; g.state = 0;
toggled.length = 0;
setPlayer(-100 + 10, 0); api.updateBoss(0.05);
check('大熊の近くでは大熊の名前とHPが出る', api.bossBarNameEl.textContent === Shared.BOSS_DEFS.bear.name && api.bossBarFillEl.style.width === '50%' && api.bossBarShown);
setPlayer(100 - 10, 0); api.updateBoss(0.05);
check('守護者の近くでは守護者の名前に切り替わる', api.bossBarNameEl.textContent === Shared.BOSS_DEFS.guardian.name && api.bossBarFillEl.style.width === '100%');
setPlayer(0, 0); api.updateBoss(0.05);
check('どちらからも遠く眠っていれば隠れる', !api.bossBarShown);
g.state = 1; api.updateBoss(0.05);
check('起きているボスは遠くてもバーが出る', api.bossBarShown && api.bossBarNameEl.textContent === Shared.BOSS_DEFS.guardian.name);
g.state = 0; bear.state = 1; setPlayer(100 - 10, 0); api.updateBoss(0.05);
check('2体とも対象なら近い方を出す', api.bossBarNameEl.textContent === Shared.BOSS_DEFS.guardian.name);
api.removeAllBosses();
check('全員取り除ける', api.bosses.size === 0);

// ---- 配線(ソース上の確認) ----
check('攻撃は届いたボスへ id つきで送る', /Net\.send\(\{ t:'hitboss', id:boss\.id, dmg \}\)/.test(html));
check('通知はすべて id でボスを選ぶ', /case 'bspawn': onBossSpawn\(m\)/.test(html) && /function onBossHit\(m\)\{\s*const boss = bosses\.get\(m\.id\)/.test(html) && /function onBossDead\(m\)\{\s*const boss = bosses\.get\(m\.id\)/.test(html));
check('スナップショットはボスごとの行を読む', /for \(const r of m\.b\)/.test(html) && /bosses\.get\(r\[0\]\)/.test(html));
check('welcome は全ボスを作り直す', /removeAllBosses\(\);\s*for \(const b of W\.bosses \|\| \[\]\) addBoss\(b\)/.test(html));
check('1体前提の名残(BOSS_NAME / Shared.BOSS_RADIUS / 単数のboss変数)がない', !/BOSS_NAME|Shared\.BOSS_RADIUS|Shared\.BODY_RADIUS\.boss|\bW\.boss\b|get boss\(\)/.test(html));

if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('ALL PASS boss-bear (client)');
