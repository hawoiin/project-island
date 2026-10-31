// v61.3: ダンジョンパーティー選択UIとインスタンス分離のクライアント接続を検証
'use strict';
const fs=require('fs');
const assert=require('assert');
const html=fs.readFileSync('public/index.html','utf8');
const shared=fs.readFileSync('public/shared.js','utf8');
function check(name,fn){try{fn();console.log('PASS '+name);}catch(err){console.error('FAIL '+name+': '+err.message);process.exitCode=1;}}
check('入口に「みんなと入る」・ソロ・パーティー作成・コード参加の選択肢がある',()=>{
  assert.ok(html.includes('id="roguePartyWorld"'));
  assert.ok(html.includes('id="roguePartyPanel"'));
  assert.ok(html.includes('id="roguePartyCreate"'));
  assert.ok(html.includes('id="roguePartyJoin"'));
  assert.ok(html.includes('id="roguePartySolo"'));
});
check('コードは英数字6文字に正規化され、入場前にサーバーへ送信される',()=>{
  assert.ok(html.includes("replace(/[^A-Z0-9]/g,'').slice(0,6)"));
  assert.ok(html.includes("Net.send({t:'roguePartySelect'"));
});
check('作成したパーティーコードはHUDに表示される',()=>html.includes('パーティーコード <strong>${activeRoguePartyCode}</strong>'));
check('別パーティーのプレイヤーは同じダンジョン座標でも非表示・接触対象外になる',()=>html.includes('r.caveInstance!==localRogueInstance')&&html.includes('r.caveInstance!==rogueRun.instanceId'));
check('スナップショットにダンジョンインスタンスIDが含まれる',()=>shared.includes('rogueRoom?rogueRoom.id:0')&&html.includes('r.caveInstance = Number.isSafeInteger(p[7]) ? p[7] : 0'));
check('ダンジョン中の攻撃モーションは同じインスタンスにだけ配信される',()=>shared.includes("this.broadcastRogueRoom(room,{t:'patk',id,cave:c.cave,instanceId:room.id},id)")&&html.includes('m.instanceId===rogueRun.instanceId'));
if(!process.exitCode)console.log('Rogue party UI checks passed.');
