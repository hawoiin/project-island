// Free-hosting policy tests: no pretend server disk persistence, deterministic base seed, explicit session-reset UX.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isFreePlanMode, resolveFreeWorldSeed, isAllowedRestoreSeed, DEFAULT_FREE_WORLD_SEED, loadRuntimeSave, writeRuntimeSave, writeServerSave, sidecarPath } = require('../server-save.js');
const RogueProgression = require('../public/rogue-progression.js');
const projectRoot = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const topRenderYaml = fs.readFileSync(path.join(projectRoot, 'render.yaml'), 'utf8');
const innerRenderYaml = fs.readFileSync(path.join(__dirname, '..', 'render.yaml'), 'utf8');
function check(name, fn) { try { fn(); console.log('PASS ' + name); } catch (e) { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } }

check('Freeモード設定を厳密に読み、通常開発では既定OFF', () => {
  assert.strictEqual(isFreePlanMode({}), false);
  assert.strictEqual(isFreePlanMode({ FREE_PLAN_MODE: '0' }), false);
  assert.strictEqual(isFreePlanMode({ FREE_PLAN_MODE: '1' }), true);
  assert.strictEqual(isFreePlanMode({ FREE_PLAN_MODE: 'true' }), true);
});
check('Freeモードの地形シードは同一で、無効な値は安全な既定値に戻る', () => {
  assert.strictEqual(resolveFreeWorldSeed({ FREE_WORLD_SEED: '24101986' }), 24101986);
  assert.strictEqual(resolveFreeWorldSeed({ FREE_WORLD_SEED: '4294967296' }), DEFAULT_FREE_WORLD_SEED);
  assert.strictEqual(resolveFreeWorldSeed({ FREE_WORLD_SEED: '-5' }), DEFAULT_FREE_WORLD_SEED);
  assert.strictEqual(resolveFreeWorldSeed({}), DEFAULT_FREE_WORLD_SEED);
});
check('Freeモードでは固定シードと違う共有ワールドの復元を拒否し、通常モードは従来どおり', () => {
  assert.strictEqual(isAllowedRestoreSeed({ seed: 24101986 }, true, 24101986), true);
  assert.strictEqual(isAllowedRestoreSeed({ seed: 7 }, true, 24101986), false);
  assert.strictEqual(isAllowedRestoreSeed({ seed: '24101986' }, true, 24101986), false);
  assert.strictEqual(isAllowedRestoreSeed(null, true, 24101986), false);
  assert.strictEqual(isAllowedRestoreSeed({ seed: 7 }, false, 24101986), true);
  assert.match(serverSource, /isAllowedRestoreSeed\(m\.world, FREE_PLAN_MODE, FREE_WORLD_SEED\)/g);
  assert.match(serverSource, /reason:'seedMismatch'/);
});
check('Freeモードでは既存の保存ファイルや遺品sidecarを起動時に読み込まない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'island-free-mode-'));
  const file = path.join(dir, 'world.json');
  try {
    const oldWorld = { seed: 7, structures: [{ sid: 1 }], chests: [2] };
    const oldRecovery = { version: 1, rooms: [{ key: 'party:ABC234', seed: 5, bags: [] }] };
    writeServerSave(file, oldWorld, oldRecovery);
    assert.deepStrictEqual(loadRuntimeSave(file, true), { world: null, rogueRecovery: null });
    assert.deepStrictEqual(loadRuntimeSave(file, false), { world: oldWorld, rogueRecovery: oldRecovery });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
check('Freeモードではセッション内の保存呼び出しがファイルを書き出さない', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'island-free-write-'));
  const file = path.join(dir, 'world.json');
  try {
    assert.strictEqual(writeRuntimeSave(file, { seed: 24101986, structures: [], chests: [] }, { version: 1, rooms: [] }, true), false);
    assert.strictEqual(fs.existsSync(file), false);
    assert.strictEqual(fs.existsSync(sidecarPath(file)), false);
    assert.strictEqual(writeRuntimeSave(file, { seed: 24101986, structures: [], chests: [] }, { version: 1, rooms: [] }, false), true);
    assert.strictEqual(fs.existsSync(file), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
check('RenderがFreeモードを有効化し、固定シードを使う', () => {
  for (const yaml of [topRenderYaml, innerRenderYaml]) {
    assert.match(yaml, /plan:\s*free/);
    assert.match(yaml, /key:\s*FREE_PLAN_MODE\s*\n\s*value:\s*["']?1/);
    assert.match(yaml, /key:\s*FREE_WORLD_SEED\s*\n\s*value:\s*["']?24101986/);
  }
  assert.match(serverSource, /loadRuntimeSave\(SAVE_FILE, FREE_PLAN_MODE\)/);
  assert.match(serverSource, /seed:\s*FREE_PLAN_MODE\s*&&\s*!saved\s*\?\s*FREE_WORLD_SEED\s*:\s*undefined/);
  assert.match(serverSource, /writeRuntimeSave\(SAVE_FILE,[\s\S]*?FREE_PLAN_MODE\)/);
});
check('接続時にセッションIDが送られ、再起動後のセッション変更を検知する', () => {
  assert.match(serverSource, /welcome\.serverSessionId\s*=\s*SERVER_SESSION_ID/);
  assert.match(serverSource, /welcome\.freePlanMode\s*=\s*FREE_PLAN_MODE/);
  assert.match(html, /const serverSessionChanged = FREE_PLAN_SESSION_MODE[\s\S]*?nextSessionId !== currentServerSessionId/);
  assert.match(html, /handleFreePlanServerSessionReset\(\)/);
  assert.match(html, /携行装備・未精算の欠片・遺品袋は失われました/);
});
check('ページを閉じてから開き直した場合も保存済みsession IDを照合し、古い探索を中断扱いにする', () => {
  assert.match(html, /const SERVER_SESSION_STORAGE_KEY = 'lowpoly-island-server-session-id-v1'/);
  assert.match(html, /previousServerSessionId = localStorage\.getItem\(SERVER_SESSION_STORAGE_KEY\)/);
  assert.match(html, /const initialRunWasInProgress = FREE_PLAN_SESSION_MODE && rogueRunWasInProgressAtPageLoad/);
  assert.match(html, /initialServerSessionChanged = FREE_PLAN_SESSION_MODE[\s\S]*?previousServerSessionId !== currentServerSessionId/);
  assert.match(html, /if \(initialServerSessionChanged\) handleFreePlanServerSessionReset\(\)/);
  assert.match(html, /if \(initialRunWasInProgress\) \{[\s\S]*?携行装備と未精算の欠片は失われました/);
  assert.match(html, /localStorage\.setItem\(SERVER_SESSION_STORAGE_KEY, nextSessionId\)/);
});
check('再読込前の探索状態をRogueProgression.load()より先に取得し、通知用フラグを失わない', () => {
  const snapshotAt = html.indexOf('const rogueRunWasInProgressAtPageLoad = (() =>');
  const initialFlagAt = html.indexOf('const initialRunWasInProgress = FREE_PLAN_SESSION_MODE && rogueRunWasInProgressAtPageLoad');
  const progressionLoadAt = html.indexOf('const rogueProgress = RogueProgression.load(localStorage)');
  assert.ok(snapshotAt >= 0 && initialFlagAt > snapshotAt && progressionLoadAt > initialFlagAt,
    'snapshot and derived notification flag must be initialized in order before load()');
  assert.match(html, /const initialRunWasInProgress = FREE_PLAN_SESSION_MODE && rogueRunWasInProgressAtPageLoad/);
  assert.doesNotMatch(html, /storedProgress = JSON\.parse\(localStorage\.getItem\(RogueProgression\.KEY/);

  const values = new Map();
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
  storage.setItem(RogueProgression.KEY, JSON.stringify({
    shards: 31,
    equipped: { weaponBonus: 2, armorBonus: 1 },
    stash: { weaponBonus: 1, armorBonus: 2 },
    runInProgress: true
  }));
  const persistedBeforeLoad = JSON.parse(storage.getItem(RogueProgression.KEY));
  const runWasInProgressAtPageLoad = persistedBeforeLoad.runInProgress === true;
  const loaded = RogueProgression.load(storage);
  assert.strictEqual(runWasInProgressAtPageLoad, true, 'pre-load snapshot preserves the notice condition');
  assert.strictEqual(loaded.runInProgress, false, 'load keeps the established death-on-reload rule');
  assert.deepStrictEqual(loaded.equipped, { weaponBonus: 0, armorBonus: 0 });
  assert.deepStrictEqual(loaded.stash, { weaponBonus: 1, armorBonus: 2 });
  assert.strictEqual(loaded.shards, 31);
});
check('Freeモードの保存制約はタイトル画面・設定・ダンジョン入場で説明される', () => {
  assert.match(html, /id="freePlanNotice" hidden/);
  assert.match(html, /id="freePlanSaveNotice" hidden/);
  assert.match(html, /id="freePlanRogueNotice" hidden/);
  assert.match(html, /大切な建築は設定からJSONを書き出して保管してください/);
  assert.match(html, /共有ワールドの復元には管理者認証が必要です/);
});
if (!process.exitCode) console.log('Free plan mode checks passed.');
