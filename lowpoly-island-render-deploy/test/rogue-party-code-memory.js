// v62.3: 死亡後に同じ協力探索へ戻れるよう、直近のパーティーコードを安全に記憶する。
'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const html=fs.readFileSync('public/index.html','utf8');
const start=html.indexOf("  const ROGUE_LAST_PARTY_CODE_KEY = 'lowpoly-island-last-rogue-party-code-v1';");
const end=html.indexOf('  let rogueRecoveryStatusBag = null;',start);
assert.ok(start>=0&&end>start,'party-code persistence helpers must exist');
const helperSource=html.slice(start,end)+'\nglobalThis.__partyCodeHelpers={ROGUE_LAST_PARTY_CODE_KEY,loadLastRoguePartyCode,rememberLastRoguePartyCode};';
function makeStorage(initial={},throwOnWrite=false){
  const values=new Map(Object.entries(initial));
  return {values,getItem(k){return values.has(k)?values.get(k):null;},setItem(k,v){if(throwOnWrite)throw new Error('storage disabled');values.set(k,String(v));}};
}
function setup(storage){const ctx={localStorage:storage};vm.runInNewContext(helperSource,ctx,{timeout:1000});return ctx.__partyCodeHelpers;}
function check(name,fn){try{fn();console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.message);process.exitCode=1;}}
const key='lowpoly-island-last-rogue-party-code-v1';
check('前回の有効な6文字コードを読み戻す',()=>{const h=setup(makeStorage({[key]:'ABC234'}));assert.equal(h.loadLastRoguePartyCode(),'ABC234');});
check('壊れた・旧形式の値は自動参加コードとして採用しない',()=>{const h=setup(makeStorage({[key]:'abc-23'}));assert.equal(h.loadLastRoguePartyCode(),'');});
check('新規作成・コード参加の有効コードだけを保存できる',()=>{const s=makeStorage(),h=setup(s);h.rememberLastRoguePartyCode('K7Q4RD');assert.equal(s.getItem(key),'K7Q4RD');h.rememberLastRoguePartyCode('bad');assert.equal(s.getItem(key),'K7Q4RD');});
check('localStorageが利用不可でもパーティー選択を止めない',()=>{const h=setup(makeStorage({},true));assert.equal(h.loadLastRoguePartyCode(),'');assert.doesNotThrow(()=>h.rememberLastRoguePartyCode('ABC234'));});
check('入口パネルは前回コードを入力欄に表示するが自動参加しない',()=>{assert.ok(html.includes('roguePartyCodeInput.value=loadLastRoguePartyCode();'));assert.ok(html.includes("if(mode==='party'||mode==='create') rememberLastRoguePartyCode(code);"));assert.ok(html.includes('前回のコードは入力欄に再表示され'));const openStart=html.indexOf('  function openRoguePartyPanel(caveIndex=CLASSIC_ROGUE_DUNGEON_INDEX){');const openEnd=html.indexOf('  function closeRoguePartyPanel()',openStart);assert.ok(openStart>=0&&openEnd>openStart&&!html.slice(openStart,openEnd).includes('enterRogueWithParty'));});
if(!process.exitCode)console.log('Rogue party code memory checks passed.');
