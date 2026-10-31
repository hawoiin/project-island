// v70.18: コード入力なしで、ワールドの全員が同じ探索ランに入れること(標準の入り方)を検証
'use strict';
const assert=require('assert');
const fs=require('fs');
const Shared=require('../public/shared.js');
const html=fs.readFileSync('public/index.html','utf8');
const sim=new Shared.WorldSim({seed:70180});
const sent=[];
sim.out={sendTo(id,msg){sent.push({to:id,msg});},broadcast(msg,except){for(const id of sim.clients.keys())if(id!==except)sent.push({to:id,msg});}};
function check(name,fn){try{fn();console.log('PASS '+name);}catch(err){console.error('FAIL '+name+': '+err.message);process.exitCode=1;}}
function enter(id,name,select){
  sim.addClient(id);sim.handle(id,{t:'join',name,key:`world-party-${id}`});
  sim.handle(id,select);
  const site=Shared.CAVE_SITES[Shared.ROGUE_DUNGEON_INDEX];
  const mouth={x:site.x+site.dirX*Shared.CAVE_MOUTH_OFFSET,z:site.z+site.dirZ*Shared.CAVE_MOUTH_OFFSET};
  sim.handle(id,{t:'state',x:mouth.x,y:Shared.islandHeight(mouth.x,mouth.z),z:mouth.z,ry:0,cave:-1,f:0});
  sim.handle(id,{t:'state',x:Shared.CAVE_INTERIOR_ENTRY.x,y:0,z:Shared.CAVE_INTERIOR_ENTRY.z,ry:0,cave:Shared.ROGUE_DUNGEON_INDEX,f:0});
}
enter(201,'A',{t:'roguePartySelect',mode:'world'});
enter(202,'B',{t:'roguePartySelect',mode:'world'});
enter(203,'C(ソロ)',{t:'roguePartySelect',mode:'solo'});
enter(204,'D(コード)',{t:'roguePartySelect',mode:'join',code:'ALPHA1'});
const rA=sim.getRogueRoomForClient(201),rB=sim.getRogueRoomForClient(202),rC=sim.getRogueRoomForClient(203),rD=sim.getRogueRoomForClient(204);
check('コード不要の「みんなと入る」は承認され、コードは空で返る',()=>{
  const ok=sent.find(x=>x.to===201&&x.msg.t==='roguePartySelected');
  assert.ok(ok&&ok.msg.ok===true&&ok.msg.mode==='world'&&ok.msg.code==='');
});
check('みんなと入る同士(コードなし)は同じ探索ランに入る',()=>{assert.ok(rA&&rB);assert.equal(rA.id,rB.id);assert.equal(rA.members.size,2);});
check('ソロは別の探索ランのまま',()=>{assert.notEqual(rC.id,rA.id);assert.equal(rC.members.size,1);});
check('コード付きの仲間部屋も別の探索ランのまま',()=>{assert.notEqual(rD.id,rA.id);assert.notEqual(rD.id,rC.id);assert.equal(rD.partyCode,'ALPHA1');});
check('みんなの部屋にはパーティーコードが付かない',()=>assert.equal(rA.partyCode,''));
check('あとから入った人も、同じ部屋に合流できる',()=>{enter(205,'E',{t:'roguePartySelect',mode:'world'});assert.equal(sim.getRogueRoomForClient(205).id,rA.id);assert.equal(rA.members.size,3);});
check('不明なモードは今までどおり拒否される',()=>{
  const before=sent.filter(x=>x.to===206&&x.msg.t==='roguePartySelected'&&x.msg.ok===false).length;
  sim.addClient(206);sim.handle(206,{t:'join',name:'F',key:'world-party-206'});
  sim.handle(206,{t:'roguePartySelect',mode:'everyone'});
  assert.equal(sent.filter(x=>x.to===206&&x.msg.t==='roguePartySelected'&&x.msg.ok===false).length,before+1);
});
check('ブラウザ側: 入口の第一候補はコード入力なしのボタン',()=>{
  assert.ok(html.includes('id="roguePartyWorld"'));
  assert.ok(/roguePartyWorld\.addEventListener\('click',\(\)=>enterRogueWithParty\('world'\)\)/.test(html));
  assert.ok(html.includes("selection.mode==='world'?'world'"));
});
check('ブラウザ側: コード入力欄は任意の折りたたみの中にある',()=>{
  const box=html.indexOf('id="roguePartyCodeBox"');
  const input=html.indexOf('id="roguePartyCodeInput"');
  const close=html.indexOf('</details>',box);
  assert.ok(box>0&&input>box&&input<close);
});
if(!process.exitCode)console.log('Rogue world party checks passed.');
