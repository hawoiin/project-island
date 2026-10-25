'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) process.exitCode = 1;
};
const start = html.match(/<div id="startOverlay">([\s\S]*?)<\/div>\s*<div id="performanceHud"/);
check('ブラウザーのタブ名が Lowpoly Island — 探索の島', /<title>Lowpoly Island — 探索の島<\/title>/.test(html));
check('タイトル画面にキー操作一覧を表示しない', !!start && !/WASD移動|マウスで視点|クリックで攻撃|Spaceジャンプ/.test(start[1]));
check('ゲーム画面に常時表示の左下操作ヒントを配置しない', !/id="help"/.test(html) && !/#help\s*\{/.test(html));
check('操作ヒント更新用の定期タイマーを除去', !/function updateHelp\s*\(/.test(html) && !/setInterval\(updateHelp/.test(html));
check('削除済み操作ヒント関数を起動時に呼び出さない', !/\bupdateHelp\s*\(/.test(html));
check('ゲーム内バージョン表示はv69.2', /<div id="versionLabel"[^>]*>v69\.2<\/div>/.test(html));
if (!process.exitCode) console.log('UI title and controls checks passed.');
