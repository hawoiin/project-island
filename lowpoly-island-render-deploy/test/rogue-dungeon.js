// v65: 新しい一本道ダンジョンの設計契約を確認する
'use strict';
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
const shared=fs.readFileSync(path.join(root,'public/shared.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
function check(name,condition){console.log((condition?'PASS ':'FAIL ')+name);if(!condition)process.exitCode=1;}
check('中央広間から後方まで広い床面がつながる',shared.includes("{type:'ellipse', x:0, z:-83, rx:36, rz:16, floorY:0, floorHoles:["));
check('高さが変わる坂は中央から後方への1本だけ', (shared.match(/yA:0, yB:-1\.2/g)||[]).length===1 && !shared.includes('floorY:3.8') && !shared.includes('floorY:-2.6'));
check('幅12mの緩い坂が一つの共有定義で描画と移動に使われる',shared.includes("{type:'segment', ax:0, az:-103, bx:0, bz:-121, width:12, yA:0, yB:-1.2}"));
check('旧裂け目の橋専用判定が残っていない',!shared.includes("id:'bridge:main'")&&!shared.includes("id:'bridge:east'")&&!html.includes('中央裂け目:'));
check('戦闘門は広間・坂の境目でなく本道上に置かれる',shared.includes('const ROGUE_GATE_Z = [-56, -100, -158]'));
check('敵の出現位置と個別報酬宝箱は新しい本道上へ配置される',shared.includes("const baseChests=[[-8,-39,0],[-23,-78,1],[23,-91,1],[-14,-137,2],[7,-145,2]]"));
check('表示用の床メッシュは共有された歩行区画をループして生成される',html.includes('for(const a of ROGUE_WALK_AREAS)')&&html.includes('addCorridorFloor(a.ax,a.az,a.bx,a.bz,a.width,a.yA||0,a.yB||0)'));
