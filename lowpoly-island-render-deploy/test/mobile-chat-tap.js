// 回帰テスト：全画面のタッチ操作レイヤーにチャットボタンが隠れる問題。
'use strict';
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
let failures = 0;
const check = (label, ok) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + label);
  if (!ok) failures++;
};
const rule = selector => {
  // Target a simple CSS rule. The exact selectors here do not contain regex metacharacters.
  const match = html.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]+)\\}'));
  if (!match) throw new Error(`CSS rule missing: ${selector}`);
  return match[1];
};
const touch = rule('#touchLayer');
const chatBtn = rule('#chatBtn');
const chatBox = rule('#chatBox');
const chatLog = rule('#chatLog');
const z = s => Number((s.match(/z-index\s*:\s*(\d+)/) || [])[1]);
check('チャットボタンは全画面タッチレイヤーより前面', z(chatBtn) > z(touch));
check('チャット入力欄は全画面タッチレイヤーより前面', z(chatBox) > z(touch));
check('チャットログがタッチレイヤーの背後に隠れない', z(chatLog) > z(touch));
check('チャットボタンのタッチ領域が48×48px以上', Number((chatBtn.match(/width\s*:\s*(\d+)px/) || [])[1]) >= 48 && Number((chatBtn.match(/height\s*:\s*(\d+)px/) || [])[1]) >= 48);
check('タップ動作を妨げないCSSを指定', /touch-action\s*:\s*manipulation/.test(chatBtn) && /pointer-events\s*:\s*auto/.test(chatBtn) && /pointer-events\s*:\s*none/.test(rule('#chatBtn svg')));
check('チャットボタンは非submitボタンでアクセシブルな名前を持つ', /<button id="chatBtn" type="button" aria-label="チャットを開く"/.test(html));
check('チャットボタンはOS依存絵文字ではなくSVGアイコン', /<button id="chatBtn"[^>]*><svg viewBox="0 0 24 24"/.test(html) && !/id="chatBtn"[^>]*>💬/.test(html));
check('既存のチャット起動処理に接続されている', /getElementById\('chatBtn'\)\.addEventListener\('click', openChat\)/.test(html));
check('スマホのレイアウト幅が端末幅に一致するviewport設定', /<meta name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover">/.test(html));
check('バージョン表示とキャッシュキー更新', /id="versionLabel"[^>]*>v70\.5<\/div>/.test(html) && html.includes('shared.js?v=70.5-shade-beast'));
if (failures) process.exit(1);
console.log('Mobile chat tap regression tests passed.');
