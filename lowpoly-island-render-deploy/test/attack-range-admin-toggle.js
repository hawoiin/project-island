// 管理者だけが敵の攻撃予告範囲の表示を切り替えられ、既定はOFFであることを確認する。
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let failures = 0;
function check(name, ok) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) failures++;
}
check('サーバー起動時の既定値はOFF', /let enemyAttackRangeDisplayEnabled = false/.test(server));
check('接続した参加者は現在の表示設定を受け取る', /sendJson\(ws, \{ t:'attackRangeDisplayState', enabled:enemyAttackRangeDisplayEnabled \}\)/.test(server));
check('切り替え操作はサーバー側で管理者認証を必須にする', /if \(!ws\.isAdmin\) \{\s*sendJson\(ws, \{ t:'adminAttackRangeDisplayResult', ok:false/.test(server));
check('切り替え値の型をbooleanに限定する', /if \(typeof m\.enabled !== 'boolean'\)/.test(server));
check('有効な設定変更を全参加者へブロードキャストする', /sim\.out\.broadcast\(\{ t:'attackRangeDisplayState', enabled:enemyAttackRangeDisplayEnabled \}\)/.test(server));
check('管理パネルに未チェックの攻撃範囲設定がある', /<input id="adminEnemyRangeToggle" type="checkbox">/.test(client) && !/<input id="adminEnemyRangeToggle"[^>]*checked/.test(client));
check('敵の赤い攻撃予告は設定がOFFなら非表示になる', /if \(!enemyAttackRangeDisplayEnabled\)\{ if \(en\.warn\) en\.warn\.visible = false; return; \}/.test(client));
check('ボスの赤い範囲リングも管理者設定に従う', /fill\.visible = edge\.visible = enemyAttackRangeDisplayEnabled/.test(client) && /if \(mark\.fill\) mark\.fill\.visible = enemyAttackRangeDisplayEnabled/.test(client));
check('UI操作は管理者認証確認後にサーバーへ送る', /adminEnemyRangeToggle\.addEventListener\('change'[\s\S]*?if \(!adminAuthenticated \|\| !NETINIT\.online\)[\s\S]*?Net\.send\(\{ t:'adminSetAttackRangeDisplay', enabled:adminEnemyRangeToggle\.checked \}\)/.test(client));
check('npm test に攻撃範囲設定の回帰テストが含まれる', pkg.scripts.test.includes('test/attack-range-admin-toggle.js'));
check('タイトル画面にv70.21が表示される', /<div id="versionLabel"[^>]*>v70\.21<\/div>/.test(client));
check('野営地の新デザイン人型番人の配置は維持されている', /(?:raider:\s*\{|ENEMY_CAMP_KINDS\s*=\s*\['campGuard')/.test(fs.readFileSync(path.join(root, 'public/shared.js'), 'utf8')));
{
  // v70.10: 旧仕様の単体変数 boss を参照すると接続直後に ReferenceError で起動できなくなる。
  const m = client.match(/function setEnemyAttackRangeDisplayEnabled\(enabled\)\{[\s\S]*?\n  \}\n/);
  const body = m ? m[0] : '';
  check('攻撃範囲設定の切替関数が見つかる', body.length > 0);
  check('切替関数は bosses(Map) を回し、単体の boss を直接参照しない', /for \(const boss of bosses\.values\(\)\)/.test(body) && !/if \(boss &&/.test(body));
}
if (failures) process.exit(1);
console.log('Attack range admin toggle checks passed.');
