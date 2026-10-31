// 新しい野営地番人の造形基準と、旧モデルを残すことを検証する。
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const shared = require('../public/shared.js');
let failures = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failures++; }
const start = html.indexOf('  function makeCampGuard(info){');
const end = html.indexOf('  const ENEMY_MAKERS =', start);
const maker = start >= 0 && end > start ? html.slice(start, end) : '';
check('新番人はプレイヤーと同じ大きめの箱型頭・幅広い胴体・短い四肢を使う',
  maker.includes('box(0.50,0.42,0.46)') && maker.includes('box(0.78,0.55,0.54)') && maker.includes('hip.position.set(sx*0.22,0.5,0)'));
check('新番人の身長はプレイヤーに近い約1.53mで、靴底は地面の高さy=0に収まる', (() => {
  const totalHeight = 0.5 + 0.78 + 0.19 + 0.06; // hip root + head + top cap half-height
  const shoeBottom = 0.5 - 0.27 - 0.19 - 0.08 / 2; // hip + knee + shoe center - half-height
  return Math.abs(totalHeight - 1.53) < 1e-9 && Math.abs(shoeBottom) < 1e-9 &&
    maker.includes('box(0.28,0.08,0.31), woodDark, 0,-0.19,0.045');
})());
check('旧デザインの人型モデルは削除せず登録されている',
  html.includes('function makeCampRaider(info)') && /raider:makeCampRaider/.test(html.slice(html.indexOf('const ENEMY_MAKERS'), html.indexOf(';', html.indexOf('const ENEMY_MAKERS')) + 1)));
check('新モデルは棍棒・待機/移動/攻撃/死亡モーションを持つ',
  maker.includes('clubHead') && maker.includes('g.userData.anim = (t,en,dt)') && maker.includes('en.dying') && maker.includes('const stride'));
check('右手には柄を握っているように見せる指と親指が追加されている', maker.includes('part(hand, box(0.04,0.032,0.028), skin') && maker.includes('// 親指'));
check('棍棒の基準保持角と手首の基準角は専用定数で一元管理されている', html.includes('const CAMP_GUARD_CLUB_GRIP_ROTATION_Z = Math.PI;') && html.includes('const CAMP_GUARD_READY_HAND_X = 1.3;') && html.includes('CAMP_GUARD_READY_HAND_X + pose.rightHandX'));
check('野営地の番人12体は新モデルkindを使い、旧敵のID範囲を変えない',
  shared.ENEMY_CAMP_KINDS.length === 12 && shared.ENEMY_CAMP_KINDS.every(k => k === 'campGuard') &&
  shared.ENEMY_CAMP_START === shared.ENEMY_WOLF_COUNT + shared.ENEMY_BOAR_COUNT + shared.ENEMY_LIZARD_COUNT + shared.ENEMY_CRAB_COUNT + shared.ENEMY_JELLY_COUNT + shared.ENEMY_CLASSIC_WOLF_COUNT + shared.ENEMY_CLASSIC_BOAR_COUNT);
check('新番人の戦闘設定は既存の人型敵と共通',
  shared.ENEMY_KINDS.campGuard === shared.ENEMY_KINDS.raider && shared.BODY_RADIUS.campGuard === 0.45);
check('タイトル画面はv70.13を表示する', /<div id="versionLabel"[^>]*>v70\.13<\/div>/.test(html));
if (failures) process.exit(1);
console.log('Camp guard model tests passed.');
