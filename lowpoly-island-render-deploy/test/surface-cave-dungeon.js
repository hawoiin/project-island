// 地上洞窟のダンジョン装飾が存在し、既存の入退室フローを維持することを確認する。
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const shared = fs.readFileSync(path.join(root, 'public/shared.js'), 'utf8');
let failures = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failures++; }
const start = html.indexOf('  function buildCaveInterior(){');
const end = html.indexOf('// ============ 洞窟の外観', start);
const cave = start >= 0 && end > start ? html.slice(start, end) : '';
check('地上洞窟の内部に中央祭壇・石柱・奥壁の刻印・石畳がある', cave.includes('const altar = new THREE.Group()') && cave.includes('for (const [px,pz,rot] of [[') && cave.includes('const backPanel = new THREE.Mesh') && cave.includes('const runeGlow =') && cave.includes('const tile = new THREE.Mesh(roughen(new THREE.BoxGeometry(2.8'));
check('装飾の追加後も既存のenterCave/exitCave処理が存在する', /function enterCave\(idx(?:,\s*roguePartySelection=null)?\)\{/.test(html) && /function exitCave\(\)\{/.test(html) && html.includes('sfx.enterCave();'));
check('洞窟内の移動範囲は従来の半径13.5mを維持', /const CAVE_ROOM_R = 13\.5/.test(html) && /const CAVE_ROOM_RADIUS = 13\.5/.test(shared));
check('v70.11のバージョン表示とキャッシュ更新が反映される', /<div id="versionLabel"[^>]*>v70\.11<\/div>/.test(html) && html.includes('shared.js?v=70.11-dungeon-ramp'));
check('通常洞窟と独立した広域ローグライクダンジョンが追加されている', html.includes('function buildRogueDungeonInterior()') && html.includes('ROGUE_WALK_AREAS') && html.includes('守護者を倒して脱出門を開く') && html.includes('function updateRogueDungeon(dt)'));
console.log('Dungeon checks passed.');
