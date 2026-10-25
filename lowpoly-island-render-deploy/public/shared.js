// 探索の島 — サーバー/クライアント共通コード
// ・島の高さ関数(クライアントの地形とサーバーの敵AIが同じ地形を見るため)
// ・WorldSim: 敵・採集物の取得/再生・建築物・宝箱を管理する「ワールドの正」
//   サーバー(Node)ではWebSocket越し、ソロ時はブラウザ内のループバックで同じものを動かす
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORLD_SIZE = 640;

  function noise2(x, z, seed) {
    let v = 0;
    v += Math.sin(x * 0.010 + seed) * Math.cos(z * 0.013 - seed) * 14;
    v += Math.sin(x * 0.031 - seed * 1.7) * Math.cos(z * 0.027 + seed) * 6;
    v += Math.sin(x * 0.07 + seed * 3.1) * Math.cos(z * 0.065 - seed) * 2.2;
    return v;
  }

  function islandHeight(x, z) {
    const d = Math.sqrt(x * x + z * z) / (WORLD_SIZE * 0.5);
    const falloff = Math.max(0, 1 - Math.pow(d, 2.2));
    return noise2(x, z, 4.2) * falloff + 3 * falloff;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 採集物の再生時間(秒)
  const RESPAWN_SEC = { wood: 180, stone: 180, herb: 120, crystal: 240, relic: 420, item: 600 };
  const BUILD_IDS = ['campfire', 'hut', 'cabin', 'fence', 'gate', 'floor'];
  const MAX_STRUCTURES = 400;
  const MAX_BULK_PICKUP_IDS = 100; // まとめて回収する要求がWebSocketの上限を超えないようにする
  // クライアントの world builder は宝箱を最大3個配置する。番号の範囲も一致させる。
  const LAND_CHEST_COUNT = 3; // 既存の陸上宝箱は位置・番号を維持する
  const MAX_CHESTS = 9; // 既存7個(陸3・沈没船・灯台・野営地1・海底洞窟)を維持し、追加野営地2個を末尾へ追加
  const MAX_UNDERWATER_RESOURCES = 100; // 基本の採集ポイント48 + 追加の海藻・サンゴ・大岩32 に余裕を持たせた上限(キー検証は u0〜u99)
  const UNDERWATER_INTERACT_RADIUS = 3.8;
  const WORLD_LAYOUT_VERSION = 3; // 遺跡・宝箱の配置生成方式と遺跡選択方式
  const CHEST_INTERACT_RADIUS = 4; // クライアントの操作距離(3m)に通信遅延ぶんを加える
  // 現行の配置で生成できる採集キーの理論上限(屋外420 + 洞窟2か所×(鉱石5 + アイテム4)=438)。
  // キー形式と添字もこの上限で検証し、偽キーで容量上限に達して通常採集が止まるのを防ぐ。
  const MAX_OUTDOOR_COLLECTIBLE_KEYS = 420;
  const MAX_CAVE_ORE_KEYS = 5;
  const MAX_CAVE_ITEM_KEYS = 4;
  const MAX_TRACKED_TAKEN = 640; // 全キーの理論上限(地上420 + 洞窟18 + 海底100)より大きく
  const MAX_PLAYER_SPEED = 32; // ダッシュ+速度強化+被弾ノックバックを許容した上限(m/s)
  const MAX_CLIENT_TIME_AHEAD_SEC = 0.75; // クライアント時刻の水増しを抑える許容幅
  const MOVE_SLOP = 0.9;
  const CAVE_MOUTH_OFFSET = 5.1;
  const CAVE_EXIT_RECESS = 3.8; // 入口の外へ出す距離(クライアントの出口位置と共通)
  const CAVE_EXIT_OFFSET = CAVE_MOUTH_OFFSET - CAVE_EXIT_RECESS;
  const CAVE_ROOM_RADIUS = 13.5; // index.html の CAVE_ROOM_R と一致させる
  const CAVE_POSITION_TOLERANCE = 0.5;
  const CAVE_TRANSITION_RADIUS = 5.5;
  const CAVE_ENTRY_SPAWN_RADIUS = 3.5;
  const CAVE_EXIT_SPAWN_RADIUS = 3.5;
  const CAVE_INTERIOR_ENTRY = { x: 0, z: 5.5 };
  const CAVE_INTERIOR_EXIT = { x: 0, z: 12.5 };
  const HIT_COOLDOWN_MS = 260;
  const ENEMY_RESPAWN_MS = 60000;
  const ENEMY_WOLF_COUNT = 10, ENEMY_BOAR_COUNT = 8; // 島の敵の数(狼が先、猪が後。id は 0 から連番)
  const ENEMY_LIZARD_COUNT = 6, ENEMY_CRAB_COUNT = 8, ENEMY_JELLY_COUNT = 8; // その後ろに 岩トカゲ・カニ・クラゲ の順
  const ENEMY_CLASSIC_WOLF_COUNT = 5, ENEMY_CLASSIC_BOAR_COUNT = 4; // さらに後ろに、初期版の見た目の狼・猪(強さと動きは狼・猪と同じ)
  // 野営地は3か所、各4体。既存の通常敵と最初の野営地4体のIDは維持する。
  const CAMP_SITE_COUNT = 3;
  const CAMP_GUARDS_PER_SITE = 4;
  // 敵の種類ごとの設定。aggroR>0 の敵は近くのプレイヤーを襲う(hurt=1回の被ダメージ、reach=噛みつく距離、cd=攻撃間隔[秒])
  //  fleeBelow: HPがこの割合以下で殴られると逃げる / dormant: 近づくまで動かない(岩に擬態) / water: 水中の敵(水の上にいるプレイヤーだけを狙う)
  //  guard: 正面からの攻撃のダメージをこの値だけ減らす(カニ) / orbit: 追うとき相手の周りを回る(狼) / hold: この距離まで近づいたら止まる(クラゲ。触手の範囲より少し内側まで寄って来る) / turn: 向きを変える速さ
  const ENEMY_KINDS = {
    // moves: 予備動作(windup)→本攻撃(dur)→のけぞり(recover)の技。trigger=技を出す距離、hitR=当たる範囲、dash=本攻撃の間に前へ突っ込む(speed m/s)
    wolf:   { hp: 6, speed: 2.6, body: 0.5,  aggroR: 9, hurt: 8,  reach: 1.3, cd: 1.1, fleeBelow: 1 / 3, orbit: true,
              moves: { lunge: { trigger: 3.6, windup: 0.5, dur: 0.32, speed: 10, hitR: 1.35, hurt: 8, recover: 0.7, cd: 1.2, dash: true } } },
    boar:   { hp: 8, speed: 1.7, body: 0.6,  aggroR: 0,
              moves: { charge: { windup: 0.6, dur: 0.7, speed: 9, hitR: 1.4, hurt: 12, recover: 1.2, cd: 2.5, dash: true } } },
    lizard: { hp: 12, speed: 1.5, body: 0.6, aggroR: 8, hurt: 10, reach: 1.5, cd: 1.6, dormant: true, wakeR: 4.5,
              moves: { bite: { trigger: 1.7, windup: 0.35, dur: 0.1, hitR: 1.9, hurt: 10, recover: 0.5, cd: 0.9 },
                       whip: { trigger: 2.5, windup: 0.85, dur: 0.15, hitR: 3.0, hurt: 12, recover: 0.9, cd: 1.2 } } },
    crab:   { hp: 6, speed: 1.6, body: 0.4,  aggroR: 5, hurt: 6,  reach: 1.2, cd: 1.4, guard: 1, turn: 2.2,
              moves: { pinch: { trigger: 1.5, windup: 0.4, dur: 0.1, hitR: 1.7, hurt: 6, recover: 0.5, cd: 1.0 } } },
    jelly:  { hp: 5, speed: 0.9, body: 0.4,  aggroR: 6, hurt: 8,  reach: 1.5, cd: 2.0, water: true, hold: 2.0,
              moves: { pulse: { trigger: 2.6, windup: 0.9, dur: 0.2, hitR: 2.8, hurt: 8, recover: 1.2, cd: 1.5 } } },
    // 野営地の人型番人。既存の近接攻撃ステート(lunge)を再利用し、攻撃時は棍棒を振る。
    // dash:false のため突進せず、その場で予備動作→一撃→隙を作る。
    raider: { hp: 10, speed: 1.9, body: 0.48, aggroR: 9, hurt: 9, reach: 1.6, cd: 1.4, turn: 8,
              moves: { lunge: { trigger: 2.65, windup: 0.62, dur: 0.16, speed: 0, hitR: 1.65, hurt: 9, recover: 0.8, cd: 1.4, dash: false } } },
  };
  // 技の番号(スナップショットで送る。 状態コード = (段階+1)*10 + 技番号。段階: 0=予備動作 1=本攻撃 2=のけぞり。 0 は技なし)
  const MOVE_ID = { lunge: 1, bite: 2, whip: 3, pulse: 4, charge: 5, pinch: 6 };
  // 初期版の見た目の狼・猪は、強さと動きを狼・猪と同じにして、見た目だけ別の種類にする
  ENEMY_KINDS.campGuard = ENEMY_KINDS.raider; // 新デザインの番人。戦闘バランスは既存の人型番人と共通。
  ENEMY_KINDS.wolfClassic = ENEMY_KINDS.wolf;
  ENEMY_KINDS.boarClassic = ENEMY_KINDS.boar;
  // 敵のリスト(id順)。この並びが id になる。
  const ENEMY_ORDER = [].concat(
    Array(ENEMY_WOLF_COUNT).fill('wolf'), Array(ENEMY_BOAR_COUNT).fill('boar'),
    Array(ENEMY_LIZARD_COUNT).fill('lizard'), Array(ENEMY_CRAB_COUNT).fill('crab'), Array(ENEMY_JELLY_COUNT).fill('jelly'),
    Array(ENEMY_CLASSIC_WOLF_COUNT).fill('wolfClassic'), Array(ENEMY_CLASSIC_BOAR_COUNT).fill('boarClassic'));
  // 野営地の見張り(さらに後ろに追加。既存の敵の id は変えない)。野営地のまわりだけを持ち場にする
  const ENEMY_CAMP_KINDS = Array(CAMP_SITE_COUNT * CAMP_GUARDS_PER_SITE).fill('campGuard');
  const ENEMY_CAMP_START = ENEMY_ORDER.length;
  for (const k of ENEMY_CAMP_KINDS) ENEMY_ORDER.push(k);
  const ENEMY_GROTTO_START = ENEMY_ORDER.length;
  // 海底洞窟の番人(さらに後ろ): 洞窟の中を漂うクラゲ
  const ENEMY_GROTTO_KINDS = ['jelly', 'jelly', 'jelly'];
  for (const k of ENEMY_GROTTO_KINDS) ENEMY_ORDER.push(k);
  const isCampEnemyId = id => Number.isInteger(id) && id >= ENEMY_CAMP_START && id < ENEMY_GROTTO_START;
  const getCampIndexForEnemyId = id => isCampEnemyId(id) ? Math.floor((id - ENEMY_CAMP_START) / CAMP_GUARDS_PER_SITE) : -1;
  const isGrottoEnemyId = id => Number.isInteger(id) && id >= ENEMY_GROTTO_START && id < ENEMY_ORDER.length;
  const JELLY_WATER_MIN = -9.5, JELLY_WATER_MAX = -1.0; // クラゲが泳ぐ海底の高さ(地面の高さがこの範囲の場所)
  const WADE_MIN = -0.6;              // 陸の敵が入れる水の浅さ(地面の高さ)。ひざ下くらいまでは水辺へ入って追ってくる
  const CRAB_WADE_MIN = -0.3;         // カニが入れる水の浅さ
  const JELLY_SHALLOW_LIMIT = -1.0;   // クラゲが入れる最も浅い場所(傘と触手が水中に収まる水深を確保)
  // その種類の敵が、地面の高さがこの場所に立てるか(生息域の中か)
  function enemyCanStand(kind, x, z) {
    const h = islandHeight(x, z);
    if (kind === 'jelly') return h <= JELLY_SHALLOW_LIMIT && h >= JELLY_WATER_MIN;
    if (kind === 'crab') return h >= CRAB_WADE_MIN && h <= 1.8;
    return h >= WADE_MIN;
  }
  // プレイヤーが、その種類の敵の「届く範囲」にいるか。届かない場所(深い水の中・陸の上など)のプレイヤーは狙わない。
  // 届かない場所から殴られた敵は、その場で一方的に殴られ続けないよう距離を取る
  const ENEMY_REACH_HEIGHT = 3.5; // 地面からこの高さ以内(ジャンプ・建てた床の上)なら届く
  function enemyCanReach(kind, c) {
    const h = islandHeight(c.x, c.z);
    if (kind === 'jelly') return h <= JELLY_SHALLOW_LIMIT + 0.1 && Math.abs(c.y - jellyHeight(c.x, c.z)) <= 3;
    // 地面を歩く敵は、足元の地面から大きく離れた高さ(灯台の坂の上など)のプレイヤーには届かない。下から噛まれない
    if (Number.isFinite(c.y) && Math.abs(c.y - h) > ENEMY_REACH_HEIGHT) return false;
    if (kind === 'crab') return h >= CRAB_WADE_MIN - 0.25;
    return h >= WADE_MIN - 0.25;
  }
  // クラゲのモデル基準位置。縦方向を縮めたモデルが水面を越えない高さに抑える。
  // 浅瀬は水深を確保できる場所(-1.0m以下)に限定し、深場では海底から約1.5m上を保つ。
  function jellyHeight(x, z) { return Math.min(-0.8, islandHeight(x, z) + 1.5); }

  // ---- ボス「遺跡の石の守護者」(島に1体。倒すと一定時間後に復活) ----
  const BOSS_MAX_HP = 60;
  const BOSS_RADIUS = 1.7;          // 体の当たり判定(m)
  const BOSS_RESPAWN_MS = 180000;
  const BOSS_AGGRO = 17;            // 眠っている間にこの距離へ入ると目覚める
  const BOSS_CHASE_RANGE = 28;      // 戦闘中に追い続ける距離
  const BOSS_LEASH = 34;            // 持ち場(home)からこれ以上は離れない
  const BOSS_SPEED = 2.3;
  const BOSS_HIT_RANGE = 9;         // プレイヤーの攻撃が届く距離(体の中心まで)
  const BOSS_SLAM_RANGE = 5.5;      // これより近ければ叩きつけ、遠ければ落石
  // 攻撃の仕様: r=範囲 dur=予告の長さ(秒) dmg=プレイヤーへのダメージ。phase2 は体力が半分以下のとき
  const BOSS_ATTACKS = {
    slam: { r: [4.8, 5.8], dur: [1.1, 0.9], dmg: 24 },
    rock: { r: [2.4, 2.4], dur: [1.5, 1.2], dmg: 16, maxZones: [3, 5] },
  };
  const BOSS_STATE_CODE = { idle: 0, chase: 1, slam: 2, rock: 3, recover: 4 }; // スナップショットで送る数字

  // ---- 洞窟の位置(外観・入口判定はクライアント、立入禁止の判定はここを共有する) ----
  // 旧(-190,55)は標高-6で海中だったため、平坦で草地の色になる北西(-150,-195)へ移動した
  const CAVE_SITES = [
    { x: 160,  z: -70,  dirX: 0,  dirZ: 1 },
    { x: -150, z: -195, dirX: -1, dirZ: 0 },
    // v60: 洞窟とは別系統の、上下層と分岐を備えた深層ローグライク遺跡入口。
    { x: -68, z: 145, dirX: 0, dirZ: 1, rogue: true },
  ];
  const ROGUE_DUNGEON_INDEX = CAVE_SITES.findIndex(site => site.rogue === true);
  // ダンジョン地形の唯一の定義。サーバーAIとクライアント描画/歩行判定で共用する。
  const ROGUE_WALK_AREAS = [
    {type:'ellipse', x:0, z:12, rx:19, rz:16, floorY:0},
    {type:'segment', ax:0, az:1, bx:0, bz:-24, width:11, yA:0, yB:0},
    {type:'ellipse', x:0, z:-37, rx:23, rz:16, floorY:0},
    {type:'segment', ax:0, az:-49, bx:0, bz:-63, width:10, yA:0, yB:0},
    {type:'ellipse', x:0, z:-83, rx:36, rz:25, floorY:0, floorHoles:[
      {type:'ellipse',x:0,z:-83,rx:35.5,rz:4.55},
      {type:'corridor',ax:15,az:-90,bx:30,bz:-95,width:9.2,extendStart:.6,extendEnd:5.2},
      {type:'corridor',ax:0,az:-103,bx:0,bz:-121,width:10.8,extendStart:.5,extendEnd:6.8}
    ]},
    {type:'segment', ax:-14, az:-78, bx:-29, bz:-69, width:8.5, yA:0, yB:3.8},
    {type:'ellipse', x:-42, z:-66, rx:15, rz:13, floorY:3.8},
    {type:'segment', ax:15, az:-90, bx:30, bz:-95, width:8.5, yA:0, yB:-2.6},
    {type:'ellipse', x:44, z:-97, rx:16, rz:14, floorY:-2.6},
    {type:'segment', ax:0, az:-103, bx:0, bz:-121, width:10, yA:0, yB:-1.4},
    {type:'ellipse', x:0, z:-137, rx:27, rz:18, floorY:-1.4, floorHoles:[
      {type:'corridor',ax:0,az:-152,bx:0,bz:-166,width:10.8,extendStart:.5,extendEnd:4.0}
    ]},
    {type:'segment', ax:0, az:-152, bx:0, bz:-166, width:10, yA:-1.4, yB:-5.2},
    {type:'ellipse', x:0, z:-184, rx:35, rz:24, floorY:-5.2},
  ];
  const ROGUE_GATE_Z = [-52, -110, -158];
  function roguePointSegmentDistance2D(x,z,ax,az,bx,bz){
    const dx=bx-ax,dz=bz-az,len2=dx*dx+dz*dz;
    const t=len2>1e-8?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/len2)):0;
    return Math.hypot(x-(ax+dx*t),z-(az+dz*t));
  }
  // Floor cutouts are part of the same layout data as the room that owns them.
  // The renderer and collision queries use this helper so a visible hole cannot be
  // treated as a room floor merely because another part of that room overlaps in XZ.
  function rogueFloorHoleContainsPoint(area,x,z){
    for(const h of (area.floorHoles||[])){
      if(h.type==='ellipse'){
        const rx=Math.max(1e-6,Number(h.rx)||0),rz=Math.max(1e-6,Number(h.rz)||0);
        if(((x-h.x)/rx)**2+((z-h.z)/rz)**2<=1)return true;
      }else if(h.type==='corridor'){
        const dx=h.bx-h.ax,dz=h.bz-h.az,len=Math.hypot(dx,dz);
        if(len<1e-6)continue;
        const along=((x-h.ax)*dx+(z-h.az)*dz)/len;
        const lateral=((x-h.ax)*dz-(z-h.az)*dx)/len;
        if(along>=-(Number(h.extendStart)||0)-1e-6&&along<=len+(Number(h.extendEnd)||0)+1e-6&&Math.abs(lateral)<=h.width*.5+1e-6)return true;
      }
    }
    return false;
  }
  function rogueAreaWalkableContains(a,x,z){
    if(a.type==='ellipse'){
      const rx=a.rx*.99-.45,rz=a.rz*.99-.45;
      return rx>0&&rz>0&&((x-a.x)/rx)**2+((z-a.z)/rz)**2<=1&&!rogueFloorHoleContainsPoint(a,x,z);
    }
    if(a.type==='segment'){
      const dx=a.bx-a.ax,dz=a.bz-a.az,len=Math.hypot(dx,dz);
      if(len<1e-6)return false;
      const along=((x-a.ax)*dx+(z-a.az)*dz)/len;
      const lateral=((x-a.ax)*dz-(z-a.az)*dx)/len;
      // The rendered corridor is a rectangle, not a capsule. Its endpoints are
      // connected to room floors, so do not extend a fake walkable floor past them.
      return along>=-1e-6&&along<=len+1e-6&&Math.abs(lateral)<=a.width*.45+1e-6;
    }
    return false;
  }
  function getRogueDungeonFloorCandidates(x,z,openGates=0){
    if(!Number.isFinite(x)||!Number.isFinite(z))return [];
    const gates=Math.max(0,Math.min(ROGUE_GATE_Z.length,Math.floor(Number(openGates)||0)));
    for(let i=gates;i<ROGUE_GATE_Z.length;i++)if(Math.abs(z-ROGUE_GATE_Z[i])<1.05&&Math.abs(x)<5.5)return [];
    // The gorge has actual box-geometry bridge decks; the room mesh is cut away here.
    if(Math.abs(z+83)<4.55&&Math.abs(x)<38){
      if(Math.abs(x)<1.48)return [{id:'bridge:main',kind:'bridge',y:0,t:null,d:0,area:null}];
      if(Math.abs(x-15)<1.10)return [{id:'bridge:east',kind:'bridge',y:0,t:null,d:0,area:null}];
      return [];
    }
    const result=[];
    for(let i=0;i<ROGUE_WALK_AREAS.length;i++){
      const a=ROGUE_WALK_AREAS[i];
      if(a.type==='segment'){
        const dx=a.bx-a.ax,dz=a.bz-a.az,len=Math.hypot(dx,dz);
        if(len<1e-6)continue;
        const along=((x-a.ax)*dx+(z-a.az)*dz)/len;
        const lateral=((x-a.ax)*dz-(z-a.az)*dx)/len;
        if(along< -1e-6||along>len+1e-6||Math.abs(lateral)>a.width*.45+1e-6)continue;
        const t=Math.max(0,Math.min(1,along/len));
        const y=(a.yA||0)+((a.yB||0)-(a.yA||0))*t;
        result.push({id:`segment:${i}`,kind:Math.abs((a.yB||0)-(a.yA||0))>1e-5?'ramp':'segment',y,t,d:Math.abs(lateral),area:a});
      }else if(a.type==='ellipse'){
        // Match the rendered floor polygon (max radial jag is about 1%); keep
        // all real overlapping floors, but never include an area cut out of its mesh.
        const metric=((x-a.x)/a.rx)**2+((z-a.z)/a.rz)**2;
        if(metric<=1.021&&!rogueFloorHoleContainsPoint(a,x,z))result.push({id:`ellipse:${i}`,kind:'ellipse',y:Number.isFinite(a.floorY)?a.floorY:0,metric,area:a});
      }
    }
    return result;
  }
  function isRogueDungeonWalkable(x,z,openGates=0){
    if(!Number.isFinite(x)||!Number.isFinite(z))return false;
    const gates=Math.max(0,Math.min(ROGUE_GATE_Z.length,Math.floor(Number(openGates)||0)));
    for(let i=gates;i<ROGUE_GATE_Z.length;i++)if(Math.abs(z-ROGUE_GATE_Z[i])<1.05&&Math.abs(x)<5.5)return false;
    // The visible floor is removed across the gorge; only the two rendered bridges remain walkable.
    if(Math.abs(z+83)<4.55&&Math.abs(x)<38)return Math.abs(x)<1.48||Math.abs(x-15)<1.10;
    return ROGUE_WALK_AREAS.some(a=>{
      if(a.type==='ellipse')return rogueAreaWalkableContains(a,x,z);
      // Keep a small capsule-like nav tolerance at corridor endpoints for route finding.
      // Player collision still requires an actual floor candidate, so this does not create fake ground.
      return a.type==='segment'&&roguePointSegmentDistance2D(x,z,a.ax,a.az,a.bx,a.bz)<=a.width*.45;
    });
  }

  // 斜面通路の側壁は見た目だけのメッシュなので、側面から坂へ乗り上げる侵入だけを止める。
  // 坂の内側から外側の歩行可能な地面へ降りる移動は妨げない。
  // 端から通路方向へ入る通常の移動や、通路内を進む動きも維持する。
  function isRogueRampSideEntryBlocked(fromX,fromZ,toX,toZ){
    if(![fromX,fromZ,toX,toZ].every(Number.isFinite))return false;
    for(const a of ROGUE_WALK_AREAS){
      if(a.type!=='segment'||Math.abs((a.yB||0)-(a.yA||0))<1e-5)continue;
      const dx=a.bx-a.ax,dz=a.bz-a.az,len2=dx*dx+dz*dz;
      const len=Math.sqrt(len2);
      if(len<1e-5)continue;
      const point=(x,z)=>{
        const t=((x-a.ax)*dx+(z-a.az)*dz)/len2;
        const qx=a.ax+t*dx,qz=a.az+t*dz;
        return {t,d:Math.hypot(x-qx,z-qz)};
      };
      const from=point(fromX,fromZ),to=point(toX,toZ);
      // 端からの通常の出入りは許可する。ただし、端の近くでも横方向に側面を
      // 横切る動きは別扱いにする。以前は to.t だけを見ていたため、端の横から
      // 坂へ乗り上げる動きまで見逃していた。
      const endT=Math.min(0.14,1.25/len);
      const alongDistance=Math.abs(to.t-from.t)*len;
      const sideDistance=Math.abs(to.d-from.d);
      const towardStart=to.t<from.t&&(from.t<=endT||to.t<=endT);
      const towardFinish=to.t>from.t&&(from.t>=1-endT||to.t>=1-endT);
      const traversesEndpoint=(towardStart||towardFinish)&&alongDistance>Math.max(0.55,sideDistance*1.25);
      if(traversesEndpoint)continue;
      // 坂の歩行可能判定・床高補間と同じ境界にそろえる。
      // 見た目の側壁より外側を境界にすると、地面へ降りた後で見えない壁に引っ掛かる。
      const walkLimit=a.width*0.45;
      // 外側から坂の歩行領域へ入る動きだけ遮断。坂から隣の歩行可能な地面へ出る動きは通す。
      if(from.d>walkLimit&&to.d<=walkLimit)return true;
    }
    return false;
  }

  // 粗いグリッド経路探索。細い主橋も通れるように2.5m間隔で、地形定義と同じ歩行判定を使う。
  const ROGUE_NAV = (()=>{
    const minX=-100,minZ=-220,step=2.5,nx=81,nz=97,walkable=new Uint8Array(nx*nz);
    const id=(ix,iz)=>ix*nz+iz;
    for(let ix=0;ix<nx;ix++)for(let iz=0;iz<nz;iz++){
      const x=minX+ix*step,z=minZ+iz*step;
      if(isRogueDungeonWalkable(x,z,ROGUE_GATE_Z.length))walkable[id(ix,iz)]=1;
    }
    return {minX,minZ,step,nx,nz,count:nx*nz,walkable,id};
  })();
  function rogueNearestNavNode(x,z,openGates){
    const g=ROGUE_NAV,ix0=Math.max(0,Math.min(g.nx-1,Math.round((x-g.minX)/g.step))),iz0=Math.max(0,Math.min(g.nz-1,Math.round((z-g.minZ)/g.step)));
    let best=-1,bestD=Infinity;
    for(let r=0;r<=7&&best<0;r++){
      for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
        if(r>0&&Math.abs(dx)!==r&&Math.abs(dz)!==r)continue;
        const ix=ix0+dx,iz=iz0+dz;if(ix<0||ix>=g.nx||iz<0||iz>=g.nz)continue;
        const nid=g.id(ix,iz);if(!g.walkable[nid])continue;
        const nx=g.minX+ix*g.step,nz=g.minZ+iz*g.step;
        if(!isRogueDungeonWalkable(nx,nz,openGates))continue;
        const d=(nx-x)**2+(nz-z)**2;if(d<bestD){bestD=d;best=nid;}
      }
      if(best>=0)return best;
    }
    return -1;
  }
  function findRogueDungeonPath(fromX,fromZ,toX,toZ,openGates){
    const g=ROGUE_NAV,start=rogueNearestNavNode(fromX,fromZ,openGates),goal=rogueNearestNavNode(toX,toZ,openGates);
    if(start<0||goal<0)return [];
    if(start===goal){
      // 同じ粗いグリッドセル内にいる敵とプレイヤーは、障害物を横切らない短い直線で接近する。
      return isRogueDungeonWalkable((fromX+toX)*.5,(fromZ+toZ)*.5,openGates)?[{x:toX,z:toZ}]:[];
    }
    const parent=new Int32Array(g.count);parent.fill(-2);parent[start]=-1;
    const queue=new Int32Array(g.count);let head=0,tail=0;queue[tail++]=start;
    const dirs=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    while(head<tail&&parent[goal]===-2){
      const cur=queue[head++],ix=Math.floor(cur/g.nz),iz=cur%g.nz,cx=g.minX+ix*g.step,cz=g.minZ+iz*g.step;
      for(const [dx,dz] of dirs){
        const nxI=ix+dx,nzI=iz+dz;if(nxI<0||nxI>=g.nx||nzI<0||nzI>=g.nz)continue;
        const next=g.id(nxI,nzI);if(parent[next]!==-2||!g.walkable[next])continue;
        const nx=g.minX+nxI*g.step,nz=g.minZ+nzI*g.step;
        if(!isRogueDungeonWalkable(nx,nz,openGates)||!isRogueDungeonWalkable((cx+nx)*.5,(cz+nz)*.5,openGates))continue;
        if(dx&&dz&&(!isRogueDungeonWalkable(cx+dx*g.step,cz,openGates)||!isRogueDungeonWalkable(cx,cz+dz*g.step,openGates)))continue;
        parent[next]=cur;queue[tail++]=next;
      }
    }
    if(parent[goal]===-2)return [];
    const path=[];for(let at=goal;at!==start&&at>=0;at=parent[at])path.push(at);path.reverse();
    return path.map(nid=>({x:g.minX+Math.floor(nid/g.nz)*g.step,z:g.minZ+(nid%g.nz)*g.step}));
  }

  // ダンジョン専用の敵プロファイル。通常フィールド敵のAI/バランスには影響しない。
  const ROGUE_ENEMY_PROFILES = Object.freeze({
    shade:    Object.freeze({role:'melee',hp:7,speed:2.15,damage:3,cooldown:1.15,attackRange:1.7,attackRadius:1.35,windup:.18,recovery:.22,aggroRange:45,patrolSpeed:.7}),
    crawler:  Object.freeze({role:'skirmisher',hp:8,speed:3.0,damage:3,cooldown:1.05,attackRange:1.5,attackRadius:1.25,windup:.12,recovery:.2,aggroRange:42,patrolSpeed:.86}),
    spitter:  Object.freeze({role:'ranged',hp:8,speed:1.4,damage:4,cooldown:2.75,attackRange:12,minRange:6,preferredRange:9,attackRadius:2.1,windup:.85,recovery:.5,aggroRange:36,patrolSpeed:.5}),
    sentinel: Object.freeze({role:'tank',hp:14,speed:1.2,damage:7,cooldown:2.8,attackRange:2.5,attackRadius:2.0,windup:.8,recovery:.75,aggroRange:36,patrolSpeed:.42}),
    charger:  Object.freeze({role:'charger',hp:12,speed:1.4,chargeSpeed:5.0,damage:7,cooldown:3.0,attackRange:2.0,triggerRange:8.8,attackRadius:1.8,windup:.72,recovery:.85,aggroRange:40,patrolSpeed:.6})
  });
  function getRogueEnemyProfile(kind, stage=0, boss=false) {
    const fallback=ROGUE_ENEMY_PROFILES.shade;
    const base=boss
      ? {role:'boss',hp:88,speed:1.5,damage:9,cooldown:2.7,attackRange:3.25,attackRadius:2.65,windup:.95,recovery:.9,aggroRange:42,patrolSpeed:0}
      : (ROGUE_ENEMY_PROFILES[kind]||fallback);
    const lv=Math.max(0,Math.min(3,Math.floor(Number(stage)||0)));
    return {...base,hp:boss?base.hp:Math.round(base.hp*(1+lv*.14)),damage:boss?base.damage:Math.min(10,base.damage+Math.floor(lv/2)),speed:base.speed*(1+lv*.035),cooldown:Math.max(.82,base.cooldown-lv*.05)};
  }

  // 出現地点が床のない裂け目や縮小した歩行境界へ入らないようにする。
  // 通常の指定点はそのまま使い、無効な点だけ近傍の有効床へ移す。
  // 位置はseedから決定した後に探索するため、サーバーと全クライアントで一致する。
  function resolveRogueDungeonSpawn(x,z,stage=0) {
    if (isRogueDungeonWalkable(x,z,ROGUE_GATE_Z.length)) return {x,z};
    const anchors=stage<=0?[[0,-37]]:stage===1?[[0,-83]]:stage===2?[[0,-137]]:[[0,-184]];
    for(let radius=.5;radius<=18;radius+=.5){
      const steps=Math.max(24,Math.ceil(Math.PI*2*radius/.65));
      for(let i=0;i<steps;i++){
        const a=(i/steps)*Math.PI*2;
        const sx=Math.round((x+Math.cos(a)*radius)*4)/4;
        const sz=Math.round((z+Math.sin(a)*radius)*4)/4;
        if(!isRogueDungeonWalkable(sx,sz,ROGUE_GATE_Z.length))continue;
        // スポーン地点は床上であるだけでなく、開門後に本線から到達できる場所に限定する。
        if(!anchors.some(([ax,az])=>Math.hypot(sx-ax,sz-az)<1.1||findRogueDungeonPath(ax,az,sx,sz,ROGUE_GATE_Z.length).length>0))continue;
        return {x:sx,z:sz};
      }
    }
    // 最終フォールバックも、定義済みの安全な広間中心へ戻す。
    const [fx,fz]=anchors[0];
    return {x:fx,z:fz};
  }

  // ローグライク遺跡の区画配置。全クライアントとサーバーが同じseedから同じ配置を再現する。
  // 近接・高速接近・遠距離・重装・突進の役割を段階ごとに導入する。
  function getRogueDungeonLayout(seed) {
    seed = (Number.isInteger(seed) ? seed : 1) >>> 0;
    const random = mulberry32((seed ^ 0x6d2b79f5) >>> 0);
    const enemies = [];
    const packs = [
      { stage:0, kind:'shade', spots:[[-8,-31],[8,-33],[-3,-42],[5,-43]] },
      { stage:1, kind:'crawler', spots:[[-9,-75],[8,-74],[0,-93]], optionalSpots:[[-42,-65],[43,-95]] },
      { stage:1, kind:'spitter', spots:[[-22,-74],[24,-92]], optionalSpots:[[40,-100]] },
      { stage:2, kind:'sentinel', spots:[[-10,-132],[10,-132],[-6,-141],[7,-143]], optionalSpots:[[16,-149]] },
      { stage:2, kind:'charger', spots:[[-16,-139],[16,-141]] }
    ];
    for (const pack of packs) {
      const hp=getRogueEnemyProfile(pack.kind,pack.stage).hp;
      for (const [x,z] of pack.spots) {
        const spot=resolveRogueDungeonSpawn(x+(random()-.5)*3.4,z+(random()-.5)*3.4,pack.stage);
        enemies.push({id:`e${enemies.length}`,kind:pack.kind,...spot,hp,stage:pack.stage,boss:false,optional:false});
      }
      for (const [x,z] of (pack.optionalSpots||[])) {
        const spot=resolveRogueDungeonSpawn(x+(random()-.5)*2.2,z+(random()-.5)*2.2,pack.stage);
        enemies.push({id:`e${enemies.length}`,kind:pack.kind,...spot,hp,stage:pack.stage,boss:false,optional:true});
      }
    }
    const baseChests=[[-8,-39,0],[-45,-68,1],[48,-98,1],[-14,-137,2],[7,-145,2]];
    const chests=baseChests.map(([x,z,stage])=>resolveRogueDungeonSpawn(
      x+(random()-.5)*(stage===1?4.5:3.2),
      z+(random()-.5)*(stage===1?4.0:3.0),stage
    )).map((spot,i)=>({ ...spot,stage:baseChests[i][2] }));
    const bossProfile=getRogueEnemyProfile('sentinel',3,true);
    const bossSpot=resolveRogueDungeonSpawn(0,-184,3);
    const boss={id:'boss',kind:'sentinel',...bossSpot,hp:bossProfile.hp,stage:3,boss:true,optional:false};
    return {seed,enemies,chests,boss};
  }

  function getRogueChestReward(seed, index) {
    const rewardSeed = ((seed >>> 0) ^ Math.imul((index + 1) >>> 0, 0x9e3779b9) ^ 0xa511e9b3) >>> 0;
    const random = mulberry32(rewardSeed);
    if (random() < 0.56) return {slot:'weapon', bonus:1+Math.floor(random()*3), shards:2};
    return {slot:'armor', bonus:1+Math.floor(random()*2), shards:2};
  }
  // 洞窟の外観が占める範囲(ローカル座標: 左右±halfW、奥行き z0〜z1。+z が山の奥行き方向)
  const CAVE_AREA = { halfW: 13, z0: -7, z1: 26 };

  function isInsideCaveArea(x, z, margin) {
    margin = margin || 0;
    for (const e of CAVE_SITES) {
      const dx = x - e.x, dz = z - e.z;
      const lz = dx * e.dirX + dz * e.dirZ;
      const lx = dx * e.dirZ - dz * e.dirX;
      if (Math.abs(lx) <= CAVE_AREA.halfW + margin && lz >= CAVE_AREA.z0 - margin && lz <= CAVE_AREA.z1 + margin) return true;
    }
    return false;
  }

  // 遺跡と宝箱の位置は描画用の乱数消費に依存させず、seedから独立して再現する。
  // これによりサーバーが宝箱の正規座標を持ち、開封距離を検証できる。
  function getRuinLocations(seed, count) {
    count = Number.isInteger(count) ? Math.max(0, Math.min(32, count)) : 6;
    const random = mulberry32(((seed >>> 0) ^ 0x71ab3cc7) >>> 0);
    const baseAngle = random() * Math.PI * 2;
    const locations = [];
    for (let i = 0; i < count; i++) {
      let placed = false;
      for (let attempt = 0; attempt < 12 && !placed; attempt++) {
        const ang = baseAngle + (i / count) * Math.PI * 2 + (random() - 0.5) * 0.7;
        const r = WORLD_SIZE * 0.14 + random() * (WORLD_SIZE * 0.28);
        const x = Math.cos(ang) * r;
        const z = Math.sin(ang) * r;
        const y = islandHeight(x, z);
        if (y < 1.1) continue;
        locations.push({ x, y, z });
        placed = true;
      }
    }
    return locations;
  }

  // 海底の配置は描画用の Math.random と分離し、seed から完全に再現できる。
  // 資源は u0..u39 の専用キーを持ち、サーバーも正規座標・種類・取得先を検証する。
  function getUnderwaterLayout(seed) {
    const random = mulberry32(((seed >>> 0) ^ 0x4b1d8e73) >>> 0);
    const occupied = [];
    function sampleSite(minDepth, maxDepth, minRadius, maxRadius, minGap, avoid) {
      const blockers = avoid || occupied;
      for (let attempt = 0; attempt < 5000; attempt++) {
        // 面積が均等になるよう、半径ではなく半径の二乗を一様に抽選する。
        const radius = Math.sqrt(minRadius * minRadius + random() * (maxRadius * maxRadius - minRadius * minRadius));
        const angle = random() * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const y = islandHeight(x, z);
        const depth = -y;
        if (depth < minDepth || depth > maxDepth || isInsideCaveArea(x, z, 3)) continue;
        if (blockers.some(o => Math.hypot(o.x - x, o.z - z) < minGap)) continue;
        return { x:Math.round(x * 100) / 100, y:Math.round(y * 100) / 100, z:Math.round(z * 100) / 100 };
      }
      return null;
    }

    // 船体が水面から出ない深さを選ぶ。オブジェクトは歩行可能な海底地形に接地させる。
    const shipSite = sampleSite(3.0, 7.2, 85, WORLD_SIZE * 0.44, 0, []);
    const shipwreck = shipSite || { x:95, y:islandHeight(95, 95), z:95 };
    shipwreck.ry = random() * Math.PI * 2;
    occupied.push(shipwreck);

    // 宝箱は船の横に置き、地面の高さを地点ごとに再計算。水中配置は既存3宝箱の後ろに追加する。
    let treasure = null;
    for (let attempt = 0; attempt < 48 && !treasure; attempt++) {
      const angle = random() * Math.PI * 2;
      const radius = 3.0 + random() * 1.4;
      const x = shipwreck.x + Math.cos(angle) * radius;
      const z = shipwreck.z + Math.sin(angle) * radius;
      const y = islandHeight(x, z);
      const depth = -y;
      if (depth < 1.2 || depth > 9.0 || isInsideCaveArea(x, z, 2)) continue;
      treasure = { x:Math.round(x * 100) / 100, y:Math.round(y * 100) / 100, z:Math.round(z * 100) / 100, ry:random() * Math.PI * 2, underwater:true };
    }
    if (!treasure) {
      const x = shipwreck.x + Math.cos(shipwreck.ry + Math.PI / 2) * 3.5;
      const z = shipwreck.z - Math.sin(shipwreck.ry + Math.PI / 2) * 3.5;
      treasure = { x:Math.round(x * 100) / 100, y:Math.round(islandHeight(x, z) * 100) / 100, z:Math.round(z * 100) / 100, ry:shipwreck.ry, underwater:true };
    }
    occupied.push(treasure);

    // 既存の海藻8・真珠貝6は先頭に保ち、後ろへサンゴ・普通の貝殻・小石を追加する。
    // 海底の小石は既存の stone 所持数へ加算し、図鑑アイテムを不必要に増やさない。
    const resourceTypes = [
      ...Array(8).fill('item_seaweed'),
      ...Array(6).fill('item_pearl_shell'),
      ...Array(8).fill('item_coral'),
      ...Array(8).fill('item_seashell'),
      ...Array(10).fill('stone'),
      ...Array(8).fill('item_seashell'), // 貝殻は後ろに追加(既存のキー u0〜u39 を動かさない)
    ];
    const resources = [];
    for (let i = 0; i < resourceTypes.length; i++) {
      const site = sampleSite(1.35, 9.0, 45, WORLD_SIZE * 0.45, 7.2, occupied);
      if (!site) continue;
      const type = resourceTypes[i];
      const resourceIndex = resources.length; // 採取失敗があってもキーと配列インデックスを必ず一致させる
      const resource = { ...site, key:'u' + resourceIndex, index:resourceIndex, type, kind:type === 'stone' ? 'stone' : 'item', ry:random() * Math.PI * 2, variant:Math.floor(random() * 4) };
      resources.push(resource);
      occupied.push(resource);
    }

    // 追加の海藻・サンゴ・大岩。見た目だけの飾りは置かず、置いたものは全部拾える(地上の岩・草と同じ扱い)。
    // レア度の順(海藻 > サンゴ)になるよう、サンゴは少なめにする。
    const extraPattern = [
      ['item_seaweed', 'item_seaweed'], ['stone', 'rock'], ['item_seaweed', 'item_seaweed'], ['item_coral', 'item_coral'],
      ['stone', 'rock'], ['item_seaweed', 'item_seaweed'], ['stone', 'rock'], ['item_seaweed', 'item_seaweed'],
    ];
    for (let i = 0; i < 32; i++) {
      const site = sampleSite(1.25, 10.0, 42, WORLD_SIZE * 0.46, 2.9, occupied);
      if (!site) continue;
      const [type, shape] = extraPattern[i % extraPattern.length];
      const resourceIndex = resources.length;
      const resource = { ...site, key:'u' + resourceIndex, index:resourceIndex, type, kind:type === 'stone' ? 'stone' : 'item', ry:random() * Math.PI * 2, scale:0.68 + random() * 0.55, variant:Math.floor(random() * 4) };
      if (shape === 'rock') resource.big = true;
      resources.push(resource);
      occupied.push(resource);
    }
    return { shipwreck, treasure, resources, decorations:[] };
  }

  // ---- 灯台: 岬に立つ塔。外側のらせん状の坂道を歩いて頂上まで登れる(seed から再現できる) ----
  // towerR=塔の太さ(固体)、rampIn〜rampOut=坂道の幅、height=頂上の高さ、turns=一周あたりの高さ=height/turns、step=1フレームで登れる段差
  // 頂上デッキの切り欠きは出口(角度0°)から坂の進入側へ105°だけ戻す。
  // キャラクターの頭(約1.5m)とデッキ厚(0.3m)が最後の坂の上で重ならないための空間。
  const LIGHTHOUSE = { towerR: 2.4, rampIn: 2.9, rampOut: 5.0, height: 21, turns: 3, step: 0.9, footR: 6, deckExitAngle: 0, deckApproachAngle: -7 * Math.PI / 12 };

  function lighthouseSiteOk(x, z, ruins) {
    const h = islandHeight(x, z);
    if (h < 0.9 || h > 5 || isInsideCaveArea(x, z, 10)) return false;
    if (Math.hypot(x, z - 6) < 40) return false;            // 初期位置のそばは避ける
    for (const r of ruins) if (Math.hypot(r.x - x, r.z - z) < 18) return false;
    for (let k = 0; k < 12; k++) { // 足元(坂道の外周まで)が陸で、ほぼ平ら
      const a = k / 12 * Math.PI * 2, hh = islandHeight(x + Math.cos(a) * LIGHTHOUSE.footR, z + Math.sin(a) * LIGHTHOUSE.footR);
      if (hh < 0.3 || Math.abs(hh - h) > 2.5) return false;
    }
    let coast = false; // 岬: すぐ外側に海がある
    for (let k = 0; k < 12 && !coast; k++) {
      const a = k / 12 * Math.PI * 2;
      if (islandHeight(x + Math.cos(a) * (LIGHTHOUSE.footR + 6), z + Math.sin(a) * (LIGHTHOUSE.footR + 6)) < 0.1) coast = true;
    }
    return coast;
  }

  // 島の外周に近い、平らな岬を探す。置けなければ null
  function getLighthouseLocation(seed) {
    const random = mulberry32(((seed >>> 0) ^ 0x1f9b27d1) >>> 0);
    const ruins = getRuinLocations(seed, 6);
    const base = random() * Math.PI * 2;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 72; i++) {
      const a = base + i / 72 * Math.PI * 2;
      for (let r = WORLD_SIZE * 0.46; r >= 40; r -= 2) { // 外側から内側へ、最初に置ける所
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (!lighthouseSiteOk(x, z, ruins)) continue;
        const score = r + random() * 20;
        if (score > bestScore) { bestScore = score; best = { x, z, a }; }
        break;
      }
    }
    if (!best) return null;
    const x = Math.round(best.x * 100) / 100, z = Math.round(best.z * 100) / 100;
    return { x, z, baseY: Math.round(islandHeight(x, z) * 100) / 100, ry: best.a };
  }

  // 灯台の坂道・頂上の床の高さ。py(いまの足元)より step より高い面には乗れない。構造の外なら undefined
  function lighthouseFloorY(L, x, z, py) {
    if (!L) return undefined;
    const dx = x - L.x, dz = z - L.z, r = Math.hypot(dx, dz);
    if (r > LIGHTHOUSE.rampOut) return undefined;
    const top = L.baseY + LIGHTHOUSE.height;
    // 塔の頂上には、らせん坂の内側まで円形の石製キャップが描画されている。
    // 以前は rampIn より内側を無条件に床判定の対象外にしていたため、
    // 見えている中央の床に乗れず落下していた。頂上の高さに届く場合だけ床として扱う。
    if (r < LIGHTHOUSE.rampIn) {
      return top <= py + LIGHTHOUSE.step ? top : undefined;
    }
    let th = Math.atan2(dz, dx); if (th < 0) th += Math.PI * 2;
    const pitch = LIGHTHOUSE.height / LIGHTHOUSE.turns;
    let best;
    for (let k = 0; k < LIGHTHOUSE.turns; k++) { // 坂道は反時計回り(角度が増える向き)に上がる
      const y = L.baseY + (k + th / (Math.PI * 2)) * pitch;
      if (y <= py + LIGHTHOUSE.step && (best === undefined || y > best)) best = y;
    }
    // デッキ面が実際に切り欠かれている坂の進入区間では、頂上の床を候補にしない。
    // ここで top を候補にすると、最後の坂がまだ頂上より最大0.9m低い位置なのに、足元だけ頂上へ吸い上げられ、
    // キャラクターの胴体がデッキにめり込んで見える。角度0°を越えたら通常どおり頂上床へ乗れる。
    let deckAngle = Math.atan2(dz, dx) - LIGHTHOUSE.deckExitAngle;
    deckAngle = Math.atan2(Math.sin(deckAngle), Math.cos(deckAngle));
    const inDeckApproachOpening = deckAngle >= LIGHTHOUSE.deckApproachAngle - 1e-6 && deckAngle < -1e-6;
    if (!inDeckApproachOpening && top <= py + LIGHTHOUSE.step && (best === undefined || top > best)) best = top;
    return best;
  }

  // 手すりの当たり判定: 坂の上・頂上にいる人が、外側の縁(手すりの位置)より外へ出ないように押し戻す。
  // 外へ出る(x,z)を返す。押し戻す必要がなければ null。
  //  - 坂の上にいる=足元の高さが、その角度の坂の面(または頂上の床)の近く(面の0.5m下〜2.5m上)にいる人だけ。
  //    坂の下の地面を歩く人や、坂のそばの地面から登り口へ向かう人は対象外。
  //  - 登り口(地面から1m以内の低い部分)には手すりがなく、外から歩いて乗れる。手すりの高さまでは跳び越えられない(2.5mまで)。
  function lighthouseRailClamp(L, x, z, py, radius) {
    if (!L) return null;
    const dx = x - L.x, dz = z - L.z, r = Math.hypot(dx, dz);
    const lim = LIGHTHOUSE.rampOut - 0.1 - (radius || 0.35); // 手すりは rampOut-0.1 の位置に立っている
    if (r <= lim || r > LIGHTHOUSE.rampOut + 2.5) return null;
    let th = Math.atan2(dz, dx); if (th < 0) th += Math.PI * 2;
    const pitch = LIGHTHOUSE.height / LIGHTHOUSE.turns;
    let onRamp = false;
    for (let k = 0; k < LIGHTHOUSE.turns && !onRamp; k++) {
      const y = L.baseY + (k + th / (Math.PI * 2)) * pitch;
      if (y > L.baseY + 1.0 && py >= y - 0.5 && py <= y + 2.5) onRamp = true;
    }
    const top = L.baseY + LIGHTHOUSE.height;
    if (!onRamp && py >= top - 0.5 && py <= top + 2.5) onRamp = true;
    if (!onRamp) return null;
    const k = lim / (r || 1);
    return { x: L.x + dx * k, z: L.z + dz * k };
  }

  // 頂上の宝箱の位置(坂道の反対側)
  function lighthouseChestSpot(L) {
    const a = Math.atan2(0, 1) + Math.PI, rr = (LIGHTHOUSE.rampIn + LIGHTHOUSE.rampOut) / 2;
    return { x: Math.round((L.x + Math.cos(a) * rr) * 100) / 100, y: L.baseY + LIGHTHOUSE.height, z: Math.round((L.z + Math.sin(a) * rr) * 100) / 100, ry: L.ry, lighthouse: true };
  }

  // ---- 湧き水の泉: 歩いて入ると HP がゆっくり回復する場所(焚き火と違い設置不要・場所は固定) ----
  // 位置は seed から再現できる。回復の判定はクライアント側(HP がクライアント権威のため)。
  const SPRING = { radius: 3.2, healRate: 4, footR: 3.6 };

  // 泉の縁の装飾を、その地点の地形高さに合わせるためのローカルY差分。
  // centerY は泉の基準高さ、x/z は装飾パーツのワールド座標。
  // 地形生成・当たり判定・泉の配置位置そのものは変更しない。
  function springTerrainOffset(centerY, x, z) {
    return islandHeight(x, z) - centerY;
  }

  function springSiteOk(x, z, ruins, avoid, flatOnly) {
    const h = islandHeight(x, z);
    if (h < 1.6 || h > 6 || isInsideCaveArea(x, z, 12)) return false;
    if (Math.hypot(x, z - 6) < 30) return false; // 初期位置のそばは避ける(遠出して見つける場所にする)
    for (const r of ruins) if (Math.hypot(r.x - x, r.z - z) < 14) return false;
    for (const a of avoid) if (Math.hypot(a.x - x, a.z - z) < a.gap) return false;

    if (!flatOnly) {
      // 旧泉候補ルール。既存の野営地位置を同じseedで維持する互換計算だけに使用する。
      for (let k = 0; k < 12; k++) {
        const ang = k / 12 * Math.PI * 2;
        const hh = islandHeight(x + Math.cos(ang) * SPRING.footR, z + Math.sin(ang) * SPRING.footR);
        if (hh < 0.9 || Math.abs(hh - h) > 0.7) return false;
      }
      return true;
    }

    // 水面と池底は水平のままにするため、泉の footprint 全体が平坦な場所だけを採用。
    // 中間リングと外周を複数点サンプリングし、中心を含む高低差を38cm以内に制限する。
    // 外周だけで判定する旧方式では、池の内側に斜面が入り込む場所を見逃すことがあった。
    const terrainHeights = [h];
    for (const [radius, samples] of [[SPRING.footR * 0.5, 8], [SPRING.footR, 16]]) {
      for (let k = 0; k < samples; k++) {
        const ang = k / samples * Math.PI * 2;
        const hh = islandHeight(x + Math.cos(ang) * radius, z + Math.sin(ang) * radius);
        if (hh < 0.9) return false; // 池の縁まで陸であること
        terrainHeights.push(hh);
      }
    }
    if (Math.max(...terrainHeights) - Math.min(...terrainHeights) > 0.38) return false;
    return true;
  }

  // flatOnly=true は実際の泉配置。false は野営地の旧座標を維持するためだけの互換計算。
  function generateSpringLocations(seed, count, flatOnly) {
    count = Number.isInteger(count) ? Math.max(0, Math.min(4, count)) : 2;
    const random = mulberry32(((seed >>> 0) ^ 0x5d3f91b7) >>> 0);
    const ruins = getRuinLocations(seed, 6);
    const avoid = [];
    const boss = getBossHome(seed);
    if (boss) avoid.push({ x: boss.x, z: boss.z, gap: 24 });
    const lighthouse = getLighthouseLocation(seed);
    if (lighthouse) avoid.push({ x: lighthouse.x, z: lighthouse.z, gap: 22 });
    if (flatOnly) {
      // 野営地の既存座標は変えず、新しい泉側が野営地から30m以上離れるようにする。
      // getCampLocation は旧泉候補ルールで計算するため、ここから呼んでも再帰しない。
      const camp = getCampLocation(seed);
      if (camp) avoid.push({ x: camp.x, z: camp.z, gap: 30 });
    }
    const springs = [];
    const maxAttempts = flatOnly ? 3000 : 400;
    for (let i = 0; i < count; i++) {
      let placed = null;
      for (let attempt = 0; attempt < maxAttempts && !placed; attempt++) {
        const ang = random() * Math.PI * 2;
        const r = 35 + random() * (WORLD_SIZE * 0.36 - 35);
        const x = Math.round(Math.cos(ang) * r * 100) / 100, z = Math.round(Math.sin(ang) * r * 100) / 100;
        if (!springSiteOk(x, z, ruins, avoid, flatOnly)) continue;
        placed = { x, y: Math.round(islandHeight(x, z) * 100) / 100, z };
      }
      if (!placed) continue;
      springs.push(placed);
      avoid.push({ x: placed.x, z: placed.z, gap: 60 }); // 泉どうしは離す
    }
    return springs;
  }

  function getSpringLocations(seed, count) {
    return generateSpringLocations(seed, count, true);
  }

  // 野営地配置の互換用。画面に表示・実際に回復に使う泉の位置ではない。
  function getLegacySpringLocations(seed, count) {
    return generateSpringLocations(seed, count, false);
  }

  // ---- 敵の野営地: 見張りの狼たちが守る小さな陣地。見張りを倒すと戦利品の箱が開けられる(seed から再現できる) ----
  const CAMP = { footR: 7, guardR: 4.5, siteCount: CAMP_SITE_COUNT, guardsPerSite: CAMP_GUARDS_PER_SITE };

  function campSiteOk(x, z, ruins, avoid) {
    const h = islandHeight(x, z);
    if (h < 1.5 || h > 6 || isInsideCaveArea(x, z, 12)) return false;
    if (Math.hypot(x, z - 6) < 60) return false; // 最初の探索で見つからない、少し遠い所
    for (const r of ruins) if (Math.hypot(r.x - x, r.z - z) < 16) return false;
    for (const a of avoid) if (Math.hypot(a.x - x, a.z - z) < a.gap) return false;
    for (let k = 0; k < 12; k++) { // 陣地の外周まで陸で、ゆるやか
      const ang = k / 12 * Math.PI * 2, hh = islandHeight(x + Math.cos(ang) * CAMP.footR, z + Math.sin(ang) * CAMP.footR);
      if (hh < 0.9 || Math.abs(hh - h) > 1.3) return false;
    }
    return true;
  }

  // 旧バージョンの泉候補計算。野営地の既存座標が泉の再配置だけで動いてしまわないよう、
  // getCampLocation の配置判定に限って使用する。新しい泉の見た目・実際の配置には使わない。
  function getLegacySpringLocations(seed, count) {
    count = Number.isInteger(count) ? Math.max(0, Math.min(4, count)) : 2;
    const random = mulberry32(((seed >>> 0) ^ 0x5d3f91b7) >>> 0);
    const ruins = getRuinLocations(seed, 6);
    const avoid = [];
    const boss = getBossHome(seed);
    if (boss) avoid.push({ x: boss.x, z: boss.z, gap: 24 });
    const lighthouse = getLighthouseLocation(seed);
    if (lighthouse) avoid.push({ x: lighthouse.x, z: lighthouse.z, gap: 22 });
    const springs = [];
    for (let i = 0; i < count; i++) {
      let placed = null;
      for (let attempt = 0; attempt < 400 && !placed; attempt++) {
        const ang = random() * Math.PI * 2;
        const r = 35 + random() * (WORLD_SIZE * 0.36 - 35);
        const x = Math.round(Math.cos(ang) * r * 100) / 100, z = Math.round(Math.sin(ang) * r * 100) / 100;
        const h = islandHeight(x, z);
        if (h < 1.6 || h > 6 || isInsideCaveArea(x, z, 12) || Math.hypot(x, z - 6) < 30) continue;
        if (ruins.some(q => Math.hypot(q.x - x, q.z - z) < 14)) continue;
        if (avoid.some(q => Math.hypot(q.x - x, q.z - z) < q.gap)) continue;
        let okay = true;
        for (let k = 0; k < 12; k++) {
          const a = k / 12 * Math.PI * 2;
          const hh = islandHeight(x + Math.cos(a) * SPRING.footR, z + Math.sin(a) * SPRING.footR);
          if (hh < 0.9 || Math.abs(hh - h) > 0.7) { okay = false; break; }
        }
        if (!okay) continue;
        placed = { x, y: Math.round(h * 100) / 100, z };
      }
      if (!placed) continue;
      springs.push(placed);
      avoid.push({ x: placed.x, z: placed.z, gap: 60 });
    }
    return springs;
  }

  function getCampLocation(seed) {
    const random = mulberry32(((seed >>> 0) ^ 0x3e7a52c1) >>> 0);
    const ruins = getRuinLocations(seed, 6);
    const avoid = [];
    const boss = getBossHome(seed);
    if (boss) avoid.push({ x: boss.x, z: boss.z, gap: 26 });
    const lighthouse = getLighthouseLocation(seed);
    if (lighthouse) avoid.push({ x: lighthouse.x, z: lighthouse.z, gap: 24 });
    for (const sp of getLegacySpringLocations(seed, 2)) avoid.push({ x: sp.x, z: sp.z, gap: 30 });
    for (let attempt = 0; attempt < 600; attempt++) {
      const ang = random() * Math.PI * 2;
      const r = 60 + random() * (WORLD_SIZE * 0.4 - 60);
      const x = Math.round(Math.cos(ang) * r * 100) / 100, z = Math.round(Math.sin(ang) * r * 100) / 100;
      if (!campSiteOk(x, z, ruins, avoid)) continue;
      return { x, z, y: Math.round(islandHeight(x, z) * 100) / 100, ry: random() * Math.PI * 2 };
    }
    return null;
  }

  // 最初の野営地は旧 getCampLocation と同じ場所を維持し、追加分だけをseedから決定する。
  // 既存セーブの宝箱番号と最初の野営地・敵IDを保ち、追加拠点は離れた平坦な陸地を優先する。
  function getCampLocations(seed, count) {
    count = Number.isInteger(count) ? Math.max(1, Math.min(CAMP_SITE_COUNT, count)) : CAMP_SITE_COUNT;
    const first = getCampLocation(seed);
    if (!first) return [];
    const camps = [first];
    if (count === 1) return camps;
    const random = mulberry32(((seed >>> 0) ^ 0x7ab491e3) >>> 0);
    const ruins = getRuinLocations(seed, 6);
    const avoidBase = [];
    const boss = getBossHome(seed);
    if (boss) avoidBase.push({ x:boss.x, z:boss.z, gap:26 });
    const lighthouse = getLighthouseLocation(seed);
    if (lighthouse) avoidBase.push({ x:lighthouse.x, z:lighthouse.z, gap:24 });
    for (const sp of getLegacySpringLocations(seed, 2)) avoidBase.push({ x:sp.x, z:sp.z, gap:30 });
    for (let index = 1; index < count; index++) {
      let placed = null;
      // 一度の配置失敗で拠点をなくさないよう複数回試す。候補はすべてseed依存で再現できる。
      for (let attempt = 0; attempt < 2200 && !placed; attempt++) {
        const ang = random() * Math.PI * 2;
        const r = 72 + random() * (WORLD_SIZE * 0.43 - 72);
        const x = Math.round(Math.cos(ang) * r * 100) / 100;
        const z = Math.round(Math.sin(ang) * r * 100) / 100;
        const avoid = avoidBase.concat(camps.map(c => ({ x:c.x, z:c.z, gap:64 })));
        if (!campSiteOk(x, z, ruins, avoid)) continue;
        if (camps.some(c => Math.hypot(c.x - x, c.z - z) < 64)) continue;
        placed = { x, z, y:Math.round(islandHeight(x, z) * 100) / 100, ry:random() * Math.PI * 2 };
      }
      if (placed) camps.push(placed);
    }
    return camps;
  }

  // 戦利品の箱は陣地の中央の少し奥
  function campChestSpot(C, campIndex) {
    campIndex = Number.isInteger(campIndex) ? Math.max(0, campIndex) : 0;
    const x = Math.round((C.x + Math.cos(C.ry) * 1.6) * 100) / 100, z = Math.round((C.z + Math.sin(C.ry) * 1.6) * 100) / 100;
    return { x, y: Math.round(islandHeight(x, z) * 100) / 100, z, ry: C.ry + Math.PI, camp: true, campIndex };
  }

  // ---- 海底洞窟: 海底の岩でできた丸い小部屋(入口は1か所)。中にクラゲが漂い、奥に宝箱がある(seed から再現できる) ----
  // R=壁の輪の半径、gap=入口の半角(rad)、wallR=壁の岩1個の当たり判定、ceil/top=天井の下面/上面(海底からの高さ)
  const GROTTO = { R: 5.2, gap: 0.4, wallR: 1.25, ceil: 4.2, top: 5.0, footR: 7.5 };

  function getGrottoLocation(seed) {
    const random = mulberry32(((seed >>> 0) ^ 0x6c0d3b95) >>> 0);
    const layout = getUnderwaterLayout(seed);
    const keep = [layout.shipwreck, layout.treasure].concat(layout.resources);
    for (let pass = 0; pass < 2; pass++) { // 1周目: 沈没船の近く。置けなければ2周目で島のまわりのどこでも
      for (let attempt = 0; attempt < 1500; attempt++) {
        const ang = random() * Math.PI * 2, r = 70 + random() * (WORLD_SIZE * 0.42 - 70);
        const x = Math.round(Math.cos(ang) * r * 100) / 100, z = Math.round(Math.sin(ang) * r * 100) / 100;
        const y = islandHeight(x, z);
        if (y > -6.0 || y < -9.0 || isInsideCaveArea(x, z, 12)) continue; // 天井の上面まで水中に収まる深さ
        if (pass === 0) { const d = Math.hypot(x - layout.shipwreck.x, z - layout.shipwreck.z); if (d < 16 || d > 75) continue; }
        if (keep.some(o => Math.hypot(o.x - x, o.z - z) < GROTTO.footR + 1.5)) continue;
        let flat = true; // 足元(輪の外側まで)がほぼ平らな海底
        for (let k = 0; k < 12 && flat; k++) {
          const a = k / 12 * Math.PI * 2, hh = islandHeight(x + Math.cos(a) * GROTTO.footR, z + Math.sin(a) * GROTTO.footR);
          if (Math.abs(hh - y) > 0.9 || hh > -4.5) flat = false;
        }
        if (!flat) continue;
        return { x, z, y: Math.round(y * 100) / 100, ry: Math.round(random() * Math.PI * 2 * 1000) / 1000 };
      }
    }
    return null;
  }

  // 入口の向きは ry(XZ平面で (cos, sin) の向き)。奥は反対側
  function grottoChestSpot(G) {
    const x = Math.round((G.x - Math.cos(G.ry) * 2.8) * 100) / 100, z = Math.round((G.z - Math.sin(G.ry) * 2.8) * 100) / 100;
    return { x, y: Math.round(islandHeight(x, z) * 100) / 100, z, ry: G.ry, underwater: true, grotto: true };
  }

  // 壁の当たり判定(円の並び。入口の隙間は空ける)。クライアントが使う
  function grottoWallSolids(G) {
    const out = [], n = 18, span = Math.PI * 2 - GROTTO.gap * 2;
    for (let i = 0; i < n; i++) {
      const a = G.ry + GROTTO.gap + (i + 0.5) / n * span;
      out.push({ x: G.x + Math.cos(a) * GROTTO.R, z: G.z + Math.sin(a) * GROTTO.R, r: GROTTO.wallR });
    }
    return out;
  }

  // 木・岩・草を置かない円(灯台・泉・野営地のまわり)。クライアントの散布が使う。
  function getFeatureClearZones(seed) {
    const zones = [];
    const lh = getLighthouseLocation(seed);
    if (lh) zones.push({ x: lh.x, z: lh.z, r: LIGHTHOUSE.rampOut + 2 });
    for (const sp of getSpringLocations(seed, 2)) zones.push({ x: sp.x, z: sp.z, r: SPRING.footR + 1.8 });
    for (const camp of getCampLocations(seed)) zones.push({ x: camp.x, z: camp.z, r: CAMP.footR + 1 });
    return zones;
  }

  function getChestLocations(seed, ruins, count) {
    count = Number.isInteger(count) ? Math.max(0, Math.min(MAX_CHESTS, count)) : MAX_CHESTS;
    if (!Array.isArray(ruins)) return [];
    // 元の陸上宝箱3個は位置・番号を変えず、4個目として沈没船の宝箱のみを追加する。
    const landCount = Math.min(LAND_CHEST_COUNT, count);
    const selectionRandom = mulberry32(((seed >>> 0) ^ 0x61f3a2c9) >>> 0);
    const selectedRuins = ruins.slice();
    for (let i = selectedRuins.length - 1; i > 0; i--) {
      const j = Math.floor(selectionRandom() * (i + 1));
      [selectedRuins[i], selectedRuins[j]] = [selectedRuins[j], selectedRuins[i]];
    }
    const random = mulberry32(((seed >>> 0) ^ 0x2c91e5a7) >>> 0);
    const locations = [];
    for (let i = 0; i < landCount && i < selectedRuins.length; i++) {
      const ruin = selectedRuins[i];
      if (!ruin || !Number.isFinite(ruin.x) || !Number.isFinite(ruin.z)) continue;
      const ang = random() * Math.PI * 2;
      const r = 3 + random() * 1.5;
      const x = ruin.x + Math.cos(ang) * r;
      const z = ruin.z + Math.sin(ang) * r;
      const y = islandHeight(x, z);
      if (y < 0.9 || isInsideCaveArea(x, z, 0)) continue;
      locations.push({ x, y, z, ry: random() * Math.PI * 2 });
    }
    if (count > LAND_CHEST_COUNT) {
      const underwater = getUnderwaterLayout(seed).treasure;
      if (underwater) locations.push({ ...underwater, underwater:true });
    }
    if (count > LAND_CHEST_COUNT + 1) { // 末尾: 灯台の頂上の宝箱
      const lighthouse = getLighthouseLocation(seed);
      if (lighthouse) locations.push(lighthouseChestSpot(lighthouse));
    }
    if (count > LAND_CHEST_COUNT + 2) { // 既存index 5: 最初の野営地の戦利品箱
      const camp = getCampLocation(seed);
      if (camp) locations.push(campChestSpot(camp, 0));
    }
    if (count > LAND_CHEST_COUNT + 3) { // 既存index 6: 海底洞窟の奥の宝箱。古いセーブとの互換性のため位置を維持
      const grotto = getGrottoLocation(seed);
      if (grotto) locations.push(grottoChestSpot(grotto));
    }
    if (count > LAND_CHEST_COUNT + 4) { // 追加分は既存7個の後ろへ追加し、従来の宝箱indexをずらさない
      const camps = getCampLocations(seed);
      for (let i = 1; i < camps.length && locations.length < count; i++) locations.push(campChestSpot(camps[i], i));
    }
    return locations;
  }

  // ボスの持ち場: 洞窟から離れた遺跡のうち、スタート地点から最も遠い所(seedから再現できる)
  function getBossHome(seed) {
    let best = null, bd = -1;
    for (const r of getRuinLocations(seed, 6)) {
      if (isInsideCaveArea(r.x, r.z, 8)) continue;
      const d = Math.hypot(r.x, r.z - 6);
      if (d > bd) { bd = d; best = r; }
    }
    if (best) return { x: best.x, z: best.z };
    for (let a = 0; a < 64; a++) { // 遺跡が1つも置けなかった場合の保険
      const x = Math.cos(a) * WORLD_SIZE * 0.25, z = Math.sin(a) * WORLD_SIZE * 0.25;
      if (islandHeight(x, z) > 1.5 && !isInsideCaveArea(x, z, 8)) return { x, z };
    }
    return { x: 0, z: -40 };
  }

  // ---- 建築の設置ルール ----
  const BUILD_RADIUS = { campfire: 0.9, hut: 2.2, cabin: 2.2, fence: 1.0, gate: 1.0, floor: 1.15 }; // 当たりの大きさ(m)
  const PLACE_MIN_GROUND = 1.0; // これより低い(浜辺・海)場所には置かない

  // 柵は長さ2m。端どうしが合う配置だけは、円形の設置半径が重なっても許可する。
  // THREE.js の Y 回転に合わせ、ローカルX軸の端点をワールド座標へ変換する。
  const FENCE_HALF_LENGTH = 1.0;
  const FENCE_MIN_LENGTH = 0.65; // 囲いを閉じる最後の一枚は、短くなりすぎない範囲で伸縮できる
  const FENCE_MAX_LENGTH = 2.6;
  const FENCE_JOIN_TOLERANCE = 0.14;
  const FLOOR_SNAP_SPACING = BUILD_RADIUS.floor * 1.9; // 床の外枠半径(0.95R)に合わせて縁を接近させる
  const FENCE_SNAP_DISTANCE = 1.25;
  const FLOOR_SNAP_DISTANCE = 1.35;

  function isFenceLike(buildId) { return buildId === 'fence' || buildId === 'gate'; }

  // 通常の柵と門は2m。囲いの最後を閉じるために伸縮した柵だけ、保存された長さを使う。
  function fenceLength(s) {
    return s && s.buildId === 'fence' && Number.isFinite(s.length)
      ? clamp(s.length, FENCE_MIN_LENGTH, FENCE_MAX_LENGTH) : FENCE_HALF_LENGTH * 2;
  }

  function fenceEndpoints(s) {
    const ry = Number.isFinite(s.ry) ? s.ry : 0;
    const halfLength = fenceLength(s) * 0.5;
    const dx = Math.cos(ry) * halfLength;
    const dz = -Math.sin(ry) * halfLength;
    return [
      { x: s.x - dx, z: s.z - dz },
      { x: s.x + dx, z: s.z + dz },
    ];
  }

  // 接続している端点の組を返す。設置後の連結経路を追跡するときにも使う。
  function fenceEndpointJoin(a, b) {
    const ae = fenceEndpoints(a), be = fenceEndpoints(b);
    let best = null;
    for (let ai = 0; ai < ae.length; ai++) for (let bi = 0; bi < be.length; bi++) {
      const distance = Math.hypot(ae[ai].x - be[bi].x, ae[ai].z - be[bi].z);
      if (distance <= FENCE_JOIN_TOLERANCE && (!best || distance < best.distance)) best = { aIndex:ai, bIndex:bi, distance };
    }
    return best;
  }

  function fenceEndsMeet(a, b) { return !!fenceEndpointJoin(a, b); }

  function fenceEndpointIsOpen(point, ignoreSid, structures) {
    for (const s of structures) {
      if (!isFenceLike(s.buildId) || (ignoreSid != null && s.sid === ignoreSid)) continue;
      for (const endpoint of fenceEndpoints(s)) {
        if (Math.hypot(point.x - endpoint.x, point.z - endpoint.z) <= FENCE_JOIN_TOLERANCE) return false;
      }
    }
    return true;
  }

  // 最後の柵が始点の開いた端へ届く範囲なら、その区間だけ長さと角度を自動計算する。
  // プレビュー中心が通常の「最後の端点に次の2m柵を接続する位置」に近い場合だけ発動する。
  function snapFenceLoopClosure(x, y, z, ry, structures, chain) {
    if (!chain || !chain.startEndpoint || !chain.lastEndpoint) return null;
    const start = chain.startEndpoint, last = chain.lastEndpoint;
    const firstSegment = structures.find(s => s.sid === chain.firstSid);
    const lastSegment = structures.find(s => s.sid === chain.lastSid);
    if (!firstSegment || !lastSegment ||
        !fenceEndpoints(firstSegment).some(p => Math.hypot(p.x - start.x, p.z - start.z) <= FENCE_JOIN_TOLERANCE) ||
        !fenceEndpoints(lastSegment).some(p => Math.hypot(p.x - last.x, p.z - last.z) <= FENCE_JOIN_TOLERANCE)) return null;
    if (!fenceEndpointIsOpen(start, chain.firstSid, structures) ||
        !fenceEndpointIsOpen(last, chain.lastSid, structures)) return null;
    if (!Number.isFinite(start.y) || !Number.isFinite(last.y) || Math.abs(start.y - last.y) > 0.35) return null;
    const dx = last.x - start.x, dz = last.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length < FENCE_MIN_LENGTH || length > FENCE_MAX_LENGTH) return null;

    const safeRy = Number.isFinite(ry) ? ry : 0;
    const axisX = Math.cos(safeRy), axisZ = -Math.sin(safeRy);
    let cursorDistance = Infinity;
    // 「通常の2m柵が最後の端点へ接続する中心位置」からの距離を判定する。
    for (const sign of [-1, 1]) {
      const cx = last.x - sign * axisX * FENCE_HALF_LENGTH;
      const cz = last.z - sign * axisZ * FENCE_HALF_LENGTH;
      cursorDistance = Math.min(cursorDistance, Math.hypot(cx - x, cz - z));
    }
    if (cursorDistance > FENCE_SNAP_DISTANCE) return null;

    // ローカルXの両端がstart/lastに合うように、Three.jsのY回転と一致する角度で配置する。
    return {
      x:(start.x + last.x) * 0.5,
      y:(start.y + last.y) * 0.5,
      z:(start.z + last.z) * 0.5,
      ry:Math.atan2(-dz, dx),
      length,
      snapped:true,
      closingLoop:true,
      closureTarget:{ x:start.x, y:start.y, z:start.z },
    };
  }

  // 連続設置の記憶が切れていても、既存柵の「開いた端」同士が1本で届くなら閉じられる。
  // プレイヤーが隙間の中ほどを指している場合だけ働かせ、無関係な柵を勝手につながない。
  function snapAnyFenceLoopClosure(x, y, z, structures) {
    const list = Array.from(structures || []).filter(s => s && isFenceLike(s.buildId) &&
      [s.x, s.y, s.z, s.ry].every(Number.isFinite));
    if (!list.length || !Number.isFinite(x) || !Number.isFinite(z)) return null;

    // 最大長の半分 + スナップ距離より遠い端点は、今回のカーソル位置で閉じられない。
    // 先に遠方を除外し、建築物が上限近くあっても毎フレーム全組合せを調べない。
    const endpointSearchR = FENCE_SNAP_DISTANCE + FENCE_MAX_LENGTH * 0.5 + FENCE_JOIN_TOLERANCE + 0.02;
    const allEndpoints = [];
    for (const s of list) {
      for (const p of fenceEndpoints(s)) {
        if (Math.hypot(p.x - x, p.z - z) > endpointSearchR) continue;
        allEndpoints.push({ x:p.x, y:s.y, z:p.z, sid:s.sid });
      }
    }
    if (allEndpoints.length < 2) return null;

    // 端点が接続済みかどうかは、許容誤差サイズの空間ハッシュで調べる。
    // 従来の「各端点から全柵を走査」を避け、柵が増えても O(n²) にならないようにする。
    const cell = FENCE_JOIN_TOLERANCE;
    const cellKey = (ix, iz) => ix + ':' + iz;
    const buckets = new Map();
    for (const p of allEndpoints) {
      p.ix = Math.floor(p.x / cell); p.iz = Math.floor(p.z / cell);
      const key = cellKey(p.ix, p.iz);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(p);
    }
    const openEndpoints = [];
    for (const p of allEndpoints) {
      let closed = false;
      for (let ox = -1; ox <= 1 && !closed; ox++) for (let oz = -1; oz <= 1 && !closed; oz++) {
        const neighbors = buckets.get(cellKey(p.ix + ox, p.iz + oz)) || [];
        for (const q of neighbors) {
          if (q.sid === p.sid) continue;
          if (Math.hypot(q.x - p.x, q.z - p.z) <= FENCE_JOIN_TOLERANCE) { closed = true; break; }
        }
      }
      if (!closed) openEndpoints.push(p);
    }
    if (openEndpoints.length < 2) return null;

    const candidates = [];
    for (let i = 0; i < openEndpoints.length; i++) for (let j = i + 1; j < openEndpoints.length; j++) {
      const a = openEndpoints[i], b = openEndpoints[j];
      if (a.sid === b.sid || Math.abs(a.y - b.y) > 0.35) continue;
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      if (length < FENCE_MIN_LENGTH || length > FENCE_MAX_LENGTH) continue;
      const cx = (a.x + b.x) * 0.5, cz = (a.z + b.z) * 0.5;
      const cursorDistance = Math.hypot(cx - x, cz - z);
      if (cursorDistance > FENCE_SNAP_DISTANCE) continue;
      candidates.push({ x:cx, y:(a.y + b.y) * 0.5, z:cz, ry:Math.atan2(-dz, dx), length,
        snapped:true, closingLoop:true, closureTarget:{ x:a.x, y:a.y, z:a.z }, cursorDistance });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.cursorDistance - b.cursorDistance);

    // 端点近くの候補しかないため、衝突判定もカーソル周辺に絞る。
    // 5.75m はスナップ範囲(1.25m) + 衝突確認余裕(4.5m)。地形・水域等の検査は共通関数内で引き続き行う。
    const nearbyStructures = list.filter(s => Math.hypot(s.x - x, s.z - z) <= FENCE_SNAP_DISTANCE + 4.5);
    for (const candidate of candidates) {
      if (checkPlacement('fence', candidate.x, candidate.y, candidate.z, nearbyStructures, candidate.ry, candidate.length)) continue;
      delete candidate.cursorDistance;
      return candidate;
    }
    return null;
  }

  // 柵の見た目は Three.js の Y 回転(ワールドXZ上では +X軸が (cosθ, -sinθ) へ回る)に従う。
  // その同じ変換でワールド座標をローカルへ戻し、カプセル状の線分からプレイヤーを押し出す。
  // client/server 共通化により、建築プレビュー・プレイヤー・敵で回転角の判定が食い違わないようにする。
  const FENCE_COLLISION_HALF_LENGTH = 0.95;
  const FENCE_COLLISION_THICKNESS = 0.18;
  function resolveFencePoint(x, z, radius, fences, maxPasses) {
    let px = Number.isFinite(x) ? x : 0;
    let pz = Number.isFinite(z) ? z : 0;
    const bodyRadius = Math.max(0, Number.isFinite(radius) ? radius : 0);
    const list = Array.from(fences || []).filter(s => s &&
      (s.buildId === 'fence' || (s.buildId === 'gate' && s.open !== true)) &&
      Number.isFinite(s.x) && Number.isFinite(s.z));
    const minDist = bodyRadius + FENCE_COLLISION_THICKNESS;
    const passes = Number.isInteger(maxPasses) ? Math.max(1, Math.min(8, maxPasses)) : 4;
    for (let pass = 0; pass < passes; pass++) {
      let moved = false;
      for (const s of list) {
        const theta = Number.isFinite(s.ry) ? s.ry : 0;
        const c = Math.cos(theta), sn = Math.sin(theta);
        const dx = px - s.x, dz = pz - s.z;
        // inverse Three.js Y rotation: localX = cos*dx - sin*dz; localZ = sin*dx + cos*dz
        const lx = c * dx - sn * dz;
        const lz = sn * dx + c * dz;
        const halfLength = Math.max(0.2, fenceLength(s) * 0.5 - 0.05);
        const clampedX = Math.max(-halfLength, Math.min(halfLength, lx));
        const ddx = lx - clampedX, ddz = lz;
        const dist = Math.hypot(ddx, ddz);
        if (dist >= minDist) continue;

        let nx, nz;
        if (dist > 1e-8) {
          nx = ddx / dist;
          nz = ddz / dist;
        } else {
          // 中心線と完全に重なったときもゼロ方向へ押し出さず、必ず片側へ出す。
          nx = 0;
          nz = lz < 0 ? -1 : 1;
        }
        const pushLx = clampedX + nx * minDist;
        const pushLz = nz * minDist;
        // forward Three.js Y rotation: worldX = cos*localX + sin*localZ; worldZ = -sin*localX + cos*localZ
        px = s.x + pushLx * c + pushLz * sn;
        pz = s.z - pushLx * sn + pushLz * c;
        moved = true;
      }
      if (!moved) break;
    }
    return { x:px, z:pz };
  }

  // 移動を短い区間に分け、速度が高いフレームでも柵を一気に飛び越えないようにする。
  function moveFencePoint(x, z, dx, dz, radius, fences, maxStep) {
    const list = Array.from(fences || []);
    const safeDx = Number.isFinite(dx) ? dx : 0;
    const safeDz = Number.isFinite(dz) ? dz : 0;
    const distance = Math.hypot(safeDx, safeDz);
    const stepLimit = Number.isFinite(maxStep) ? Math.max(0.05, Math.min(0.3, maxStep)) : 0.18;
    const steps = Math.max(1, Math.min(1000, Math.ceil(distance / stepLimit)));
    let px = Number.isFinite(x) ? x : 0, pz = Number.isFinite(z) ? z : 0;
    const sx = safeDx / steps;
    const sz = safeDz / steps;
    for (let i = 0; i < steps; i++) {
      px += sx; pz += sz;
      const resolved = resolveFencePoint(px, pz, radius, list);
      px = resolved.x; pz = resolved.z;
    }
    return { x:px, z:pz };
  }

  function crossXZ(a, b, c) { return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x); }
  function segmentsIntersectXZ(a, b, c, d) {
    const abC = crossXZ(a, b, c), abD = crossXZ(a, b, d);
    const cdA = crossXZ(c, d, a), cdB = crossXZ(c, d, b);
    const eps = 1e-8;
    if (((abC > eps && abD < -eps) || (abC < -eps && abD > eps)) &&
        ((cdA > eps && cdB < -eps) || (cdA < -eps && cdB > eps))) return true;
    const onSegment = (p, q, r) => Math.abs(crossXZ(p, q, r)) <= eps &&
      r.x >= Math.min(p.x, q.x) - eps && r.x <= Math.max(p.x, q.x) + eps &&
      r.z >= Math.min(p.z, q.z) - eps && r.z <= Math.max(p.z, q.z) + eps;
    return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
  }
  function fenceSegmentDistance(a, b) {
    const ae = fenceEndpoints(a), be = fenceEndpoints(b);
    if (segmentsIntersectXZ(ae[0], ae[1], be[0], be[1])) return 0;
    return Math.min(
      pointSegmentDistanceXZ(ae[0].x, ae[0].z, be[0], be[1]),
      pointSegmentDistanceXZ(ae[1].x, ae[1].z, be[0], be[1]),
      pointSegmentDistanceXZ(be[0].x, be[0].z, ae[0], ae[1]),
      pointSegmentDistanceXZ(be[1].x, be[1].z, ae[0], ae[1])
    );
  }

  // 置けない理由のコードを返す(置けるなら null)。structures は {buildId,x,y,z,ry} を持つものの列
  //   far=島の外 / height=地面から離れすぎ / sea=海辺・水上 / cave=洞窟の外観エリア / overlap=他の建物と重なる
  function checkPlacement(buildId, x, y, z, structures, ry, length) {
    const r = BUILD_RADIUS[buildId];
    if (!r) return 'bad';
    if (Math.hypot(x, z) > WORLD_SIZE * 0.5) return 'far';
    const ground = islandHeight(x, z);
    if (y < ground - 1 || y > ground + 8) return 'height';
    if (ground < PLACE_MIN_GROUND) return 'sea';
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      if (islandHeight(x + Math.cos(a) * r, z + Math.sin(a) * r) < PLACE_MIN_GROUND) return 'sea';
    }
    if (isInsideCaveArea(x, z, r)) return 'cave';
    for (const s of structures) {
      // 柵の端どうしを接続する角は許可する。
      const fenceCandidate = { buildId, x, z, ry:Number.isFinite(ry) ? ry : 0,
        ...(buildId === 'fence' && Number.isFinite(length) ? { length } : {}) };
      if (isFenceLike(buildId) && isFenceLike(s.buildId)) {
        if (fenceEndsMeet(fenceCandidate, s)) continue;
        // 長さ調整する最後の柵だけは中心同士の円形判定だと角の近くで誤って拒否しやすい。
        // 伸縮柵は実際の線分同士が交差・接触した場合だけ重なりと判断する。
        if (buildId === 'fence' && Number.isFinite(length)) {
          if (fenceSegmentDistance(fenceCandidate, s) < 0.12) return 'overlap';
          continue;
        }
      }
      const bothFloors = buildId === 'floor' && s.buildId === 'floor';
      if (!bothFloors && (buildId === 'floor' || s.buildId === 'floor')) continue; // 床の上には他の建物を置ける
      const minDist = (r + (BUILD_RADIUS[s.buildId] || 1)) * 0.9;
      const dy = Math.abs(y - s.y);
      if (Math.hypot(x - s.x, z - s.z) < minDist && dy < (bothFloors ? 1.2 : 2.5)) return 'overlap';
    }
    return null;
  }

  // 建築ゴーストを既存パーツの接続位置へ吸着する純粋関数。
  // 柵は向きを保ったまま端点どうしを接続し、床は既存床の向きと高さを引き継いで縁へ並べる。
  // 遠いときは入力座標をそのまま返すため、自由配置の操作感は変わらない。
  function snapBuildPlacement(buildId, x, y, z, ry, structures, fenceChain) {
    const list = Array.from(structures || []);
    const original = { x, y, z, ry, snapped: false };
    const snapDistance = isFenceLike(buildId) ? FENCE_SNAP_DISTANCE :
      (buildId === 'floor' ? FLOOR_SNAP_DISTANCE : 0);
    if (!snapDistance) return original;

    if (buildId === 'fence') {
      const closure = snapFenceLoopClosure(x, y, z, ry, list, fenceChain);
      if (closure) return closure;
      const anyClosure = snapAnyFenceLoopClosure(x, y, z, list);
      if (anyClosure) return anyClosure;
    }

    let best = null;
    let bestDist = snapDistance;
    const consider = candidate => {
      const d = Math.hypot(candidate.x - x, candidate.z - z);
      if (d > bestDist) return;
      // 競合する床や交差する柵など、設置できない吸着先は候補にしない。
      if (checkPlacement(buildId, candidate.x, candidate.y, candidate.z, list, candidate.ry, candidate.length)) return;
      best = candidate;
      bestDist = d;
    };

    if (isFenceLike(buildId)) {
      const rySafe = Number.isFinite(ry) ? ry : 0;
      const dx = Math.cos(rySafe) * FENCE_HALF_LENGTH;
      const dz = -Math.sin(rySafe) * FENCE_HALF_LENGTH;
      for (const s of list) {
        if (!isFenceLike(s.buildId)) continue;
        for (const endpoint of fenceEndpoints(s)) {
          // 新しい柵のどちらの端でも、既存の柵の端へ接続できるようにする(直角コーナーも可)。
          for (const sign of [-1, 1]) {
            consider({ x: endpoint.x - sign * dx, y: s.y, z: endpoint.z - sign * dz, ry: rySafe, snapped: true });
          }
        }
      }
    } else if (buildId === 'floor') {
      for (const s of list) {
        if (s.buildId !== 'floor') continue;
        const a = Number.isFinite(s.ry) ? s.ry : 0;
        const ca = Math.cos(a), sa = Math.sin(a);
        // 既存床のローカルX/Z軸に沿う4方向。向き・高さも継承して床面を揃える。
        const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [lx, lz] of sides) {
          const ox = (lx * ca + lz * sa) * FLOOR_SNAP_SPACING;
          const oz = (-lx * sa + lz * ca) * FLOOR_SNAP_SPACING;
          consider({ x: s.x + ox, y: s.y, z: s.z + oz, ry: a, snapped: true });
        }
      }
    }
    return best || original;
  }

  // 接続をまたいで同じ人だと分かるキー(ブラウザが持つ秘密)から、公開してよい短い識別子を作る。
  // 暗号強度は不要(友達同士の所有者判定用)なので、依存の無い軽量なハッシュにしている
  function hashKey(key) {
    key = String(key == null ? '' : key).slice(0, 64);
    if (!key) return '';
    let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
    for (let i = 0; i < key.length; i++) {
      const c = key.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 + c, 2246822519) >>> 0;
      h2 ^= h2 >>> 13;
    }
    return h1.toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }

  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : (d || 0);
  const r2 = v => Math.round(v * 100) / 100;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function cleanName(s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
  }

  // 閉じた柵・閉じた門で囲われた領域を検出する。
  // 接続端点をクラスタ化し、すべての頂点の次数が2である閉路だけを安全地点検索の対象にする。
  function getClosedFenceLoops(structures) {
    const barriers = Array.from(structures || []).filter(s => s &&
      (s.buildId === 'fence' || (s.buildId === 'gate' && s.open !== true)) &&
      [s.x, s.z, s.ry].every(Number.isFinite));
    const nodes = [];
    function nodeFor(point) {
      let best = -1, bestD = 0.22;
      for (let i = 0; i < nodes.length; i++) {
        const d = distanceXZ(nodes[i].x, nodes[i].z, point.x, point.z);
        if (d <= bestD) { best = i; bestD = d; }
      }
      if (best >= 0) return best;
      nodes.push({ x:point.x, z:point.z, links:new Set() });
      return nodes.length - 1;
    }
    for (const s of barriers) {
      const ep = fenceEndpoints(s);
      const a = nodeFor(ep[0]), b = nodeFor(ep[1]);
      if (a === b) continue;
      nodes[a].links.add(b); nodes[b].links.add(a);
    }
    const visited = new Set(), loops = [];
    for (let start = 0; start < nodes.length; start++) {
      if (visited.has(start)) continue;
      const stack = [start], component = [];
      visited.add(start);
      while (stack.length) {
        const i = stack.pop(); component.push(i);
        for (const j of nodes[i].links) if (!visited.has(j)) { visited.add(j); stack.push(j); }
      }
      if (component.length < 3 || component.some(i => nodes[i].links.size !== 2)) continue;
      const polygon = [];
      let prev = -1, cur = component[0];
      for (let guard = 0; guard <= component.length; guard++) {
        polygon.push({ x:nodes[cur].x, z:nodes[cur].z });
        const nexts = [...nodes[cur].links];
        const next = nexts[0] === prev ? nexts[1] : nexts[0];
        prev = cur; cur = next;
        if (cur === component[0]) break;
      }
      if (cur === component[0] && polygon.length === component.length) loops.push(polygon);
    }
    return loops;
  }

  function pointInPolygonXZ(x, z, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      const crosses = ((a.z > z) !== (b.z > z)) &&
        (x < (b.x - a.x) * (z - a.z) / ((b.z - a.z) || 1e-12) + a.x);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function isInsideFenceEnclosure(x, z, structures) {
    return getClosedFenceLoops(structures).some(loop => pointInPolygonXZ(x, z, loop));
  }

  function pointSegmentDistanceXZ(x, z, a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const length2 = dx * dx + dz * dz;
    const t = length2 > 1e-10 ? clamp(((x-a.x)*dx + (z-a.z)*dz) / length2, 0, 1) : 0;
    return Math.hypot(x - (a.x + dx*t), z - (a.z + dz*t));
  }

  // 緊急脱出の到着地点をサーバー/ソロ共通で選ぶ。建築物や閉じた柵の内側、海、洞窟、敵の近くを避ける。
  function findSafeEscapePoint(originX, originZ, structures, enemies, boss, seed) {
    const list = Array.from(structures || []);
    const loops = getClosedFenceLoops(list);
    const avoidStructures = list.map(s => ({
      s, radius:(BUILD_RADIUS[s.buildId] || 1) + 2.4,
      barrier:(s.buildId === 'fence' || (s.buildId === 'gate' && s.open !== true)) ? fenceEndpoints(s) : null
    }));
    const aliveEnemies = Array.from(enemies || []).filter(e => e && e.alive && Number.isFinite(e.x) && Number.isFinite(e.z));
    const bossAlive = boss && boss.alive && Number.isFinite(boss.x) && Number.isFinite(boss.z);
    const maxRadius = WORLD_SIZE * 0.45;
    const ox = Number.isFinite(originX) ? originX : 0;
    const oz = Number.isFinite(originZ) ? originZ : 6;
    const phase = (((Number.isInteger(seed) ? seed : 0) >>> 0) % 100000) / 100000 * Math.PI * 2;
    function safe(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) > maxRadius) return false;
      if (islandHeight(x, z) < 1.1 || isInsideCaveArea(x, z, 7)) return false;
      for (const loop of loops) if (pointInPolygonXZ(x, z, loop)) return false;
      for (const item of avoidStructures) {
        const s = item.s;
        if (item.barrier) {
          if (pointSegmentDistanceXZ(x, z, item.barrier[0], item.barrier[1]) < 2.8) return false;
        } else if (distanceXZ(x, z, s.x, s.z) < item.radius) return false;
      }
      if (bossAlive && distanceXZ(x, z, boss.x, boss.z) < 12) return false;
      for (const e of aliveEnemies) if (distanceXZ(x, z, e.x, e.z) < 7) return false;
      return true;
    }
    // 近場から順に探す。閉じた区画なら、周囲の輪を広げて囲いの外へ抜けた位置を見つける。
    for (let radius = 8; radius <= WORLD_SIZE * 0.9; radius += 4) {
      const n = Math.max(20, Math.ceil(Math.PI * 2 * radius / 4.5));
      const offset = phase + radius * 0.017;
      for (let i = 0; i < n; i++) {
        const a = offset + i / n * Math.PI * 2;
        const x = ox + Math.cos(a) * radius, z = oz + Math.sin(a) * radius;
        if (safe(x, z)) return { x:r2(x), y:r2(islandHeight(x, z)), z:r2(z) };
      }
    }
    // 現在地が島の端や洞窟のローカル座標だった場合の最後の候補探索。
    for (let radius = 12; radius < WORLD_SIZE * 0.42; radius += 8) {
      const n = Math.max(24, Math.ceil(Math.PI * 2 * radius / 7));
      for (let i = 0; i < n; i++) {
        const a = phase + i / n * Math.PI * 2;
        const x = Math.cos(a) * radius, z = 6 + Math.sin(a) * radius;
        if (safe(x, z)) return { x:r2(x), y:r2(islandHeight(x, z)), z:r2(z) };
      }
    }
    return null;
  }

  // ---- 体の当たり判定(プレイヤー・敵が重ならないための半径と押し出し) ----
  const BODY_RADIUS = { player: 0.45, wolf: 0.5, boar: 0.6, lizard: 0.6, crab: 0.4, jelly: 0.4, wolfClassic: 0.5, boarClassic: 0.6, raider: 0.48, campGuard: 0.45, boss: BOSS_RADIUS };
  // 点 (x,z) を、中心 (ox,oz) から minDist 以上離れるように押し出す移動量。離れていれば null
  function bodyPush(x, z, ox, oz, minDist) {
    const dx = x - ox, dz = z - oz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minDist * minDist) return null;
    if (d2 < 1e-8) return { x: minDist, z: 0 };  // 完全に重なっているときは適当な向きへ
    const d = Math.sqrt(d2), k = (minDist - d) / d;
    return { x: dx * k, z: dz * k };
  }

  // ---- チャット・エモート ----
  const CHAT_MAX_CHARS = 60;        // 1回の発言の長さ(文字数)
  const CHAT_INTERVAL_MS = 500;     // 連投の最短間隔(チャットとエモートで共有)
  const EMOTE_COUNT = 4;            // エモートの種類数(表示はクライアント側)
  function cleanChat(s) {
    return Array.from(String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim()).slice(0, CHAT_MAX_CHARS).join('');
  }

  function distanceXZ(x1, z1, x2, z2) {
    return Math.hypot(x1 - x2, z1 - z2);
  }

  function isValidCavePosition(cave, x, z) {
    if (cave < 0) return true;
    if (cave === ROGUE_DUNGEON_INDEX) {
      // 広域境界に加え、サーバーでも共有地形の床・橋の上にいることを検証する。
      // 門の開閉はrun進行側で管理するため、ここでは全門開放状態で床形状だけを検証。
      return Math.abs(x) <= 105 + CAVE_POSITION_TOLERANCE && z >= -226 - CAVE_POSITION_TOLERANCE && z <= 27 + CAVE_POSITION_TOLERANCE && isRogueDungeonWalkable(x,z,ROGUE_GATE_Z.length);
    }
    return Math.hypot(x, z) <= CAVE_ROOM_RADIUS + CAVE_POSITION_TOLERANCE;
  }

  // 洞窟の出入りはワールド座標と室内ローカル座標が切り替わるため、速度判定とは別に入口位置を検証する。
  function isValidCaveTransition(fromCave, toCave, fromX, fromZ, toX, toZ, allowDeadExit = false) {
    if (fromCave === toCave) return true;
    if (fromCave < 0 && toCave >= 0) {
      const site = CAVE_SITES[toCave];
      if (!site || !isValidCavePosition(toCave, toX, toZ) ||
          distanceXZ(toX, toZ, CAVE_INTERIOR_ENTRY.x, CAVE_INTERIOR_ENTRY.z) > CAVE_ENTRY_SPAWN_RADIUS) return false;
      const mx = site.x + site.dirX * CAVE_MOUTH_OFFSET;
      const mz = site.z + site.dirZ * CAVE_MOUTH_OFFSET;
      return distanceXZ(fromX, fromZ, mx, mz) <= CAVE_TRANSITION_RADIUS;
    }
    if (fromCave >= 0 && toCave < 0) {
      const site = CAVE_SITES[fromCave];
      if (!site) return false;
      const ex = site.x + site.dirX * CAVE_EXIT_OFFSET;
      const ez = site.z + site.dirZ * CAVE_EXIT_OFFSET;
      // 通常洞窟は従来どおり出口付近からのみ退室可能。
      // ローグライク遺跡では深層の生還門と死亡後の帰還も同じ島側出口へ戻すため、
      // 内部の有効範囲内なら出口座標を検証して退室を許可する。
      // 退室先は指定された入口外の座標に固定し、任意地点へのワープは許可しない。
      if (fromCave === ROGUE_DUNGEON_INDEX) {
        if (!isValidCavePosition(fromCave, fromX, fromZ)) return false;
        const atMainExit = distanceXZ(fromX, fromZ, CAVE_INTERIOR_EXIT.x, CAVE_INTERIOR_EXIT.z) <= CAVE_TRANSITION_RADIUS;
        const atExtractionPortal = distanceXZ(fromX, fromZ, 0, -201) <= CAVE_TRANSITION_RADIUS;
        // 生還門・通常出口以外からのワープは拒否。死亡後だけは任意の有効な内部位置から帰還可能。
        if (!atMainExit && !atExtractionPortal && !allowDeadExit) return false;
        return distanceXZ(toX, toZ, ex, ez) <= CAVE_EXIT_SPAWN_RADIUS;
      }
      if (distanceXZ(fromX, fromZ, CAVE_INTERIOR_EXIT.x, CAVE_INTERIOR_EXIT.z) > CAVE_TRANSITION_RADIUS) return false;
      return distanceXZ(toX, toZ, ex, ez) <= CAVE_EXIT_SPAWN_RADIUS;
    }
    // 洞窟0→洞窟1のような直接ワープは禁止。
    return false;
  }

  class WorldSim {
    constructor(opts) {
      opts = opts || {};
      const saved = opts.saved || null;
      const savedSeed = saved && Number.isInteger(saved.seed) && saved.seed >= 0 && saved.seed <= 0xffffffff ? saved.seed : null;
      const optionSeed = Number.isInteger(opts.seed) && opts.seed >= 0 && opts.seed <= 0xffffffff ? opts.seed : null;
      this.seed = (savedSeed !== null ? savedSeed : (optionSeed !== null ? optionSeed : Math.floor(Math.random() * 4294967296))) >>> 0;
      this.clients = new Map();      // id -> プレイヤー状態
      this.taken = new Map();        // 採集済みキー -> { at: 再生時刻(ms) }
      this.structures = new Map();   // sid -> 建築物
      this.chests = new Set();       // 開封済みの宝箱index
      this.nextSid = 1;
      this.enemies = [];
      this.boss = this.newBoss();
      this.underwaterLayout = getUnderwaterLayout(this.seed);
      this.underwaterResources = this.underwaterLayout.resources;
      this.chestLocations = getChestLocations(this.seed, getRuinLocations(this.seed, 6), MAX_CHESTS);
      this.campLocations = getCampLocations(this.seed);
      this.campLocation = this.campLocations[0] || getCampLocation(this.seed); // 旧コード/API互換
      this.grottoLocation = getGrottoLocation(this.seed);
      this.tickCount = 0;
      this.pickupOthers = !!opts.pickupOthers; // true なら他人の建築物も回収できる
      this.emergencyEscapeCooldowns = new Map(); // player identity -> cooldown expiry(ms)
      // ダンジョンはパーティーコードごとに独立した探索ランを持つ。
      this.rogueRooms = new Map();       // partyKey -> room state
      this.rogueRoomsById = new Map();   // instanceId -> room state
      this.rogueRoomSeq = 1;
      this.rogueHitCooldowns = new Map();
      // 遺品袋だけはサーバー保存ファイルへ別枠で保存し、公開ワールドバックアップには含めない。
      this.rogueRecoveryStore = new Map(); // partyKey -> inactive recovery record
      this.out = { sendTo() {}, broadcast() {} };

      if (saved && typeof saved === 'object') {
        // 保存ファイルは古いバージョンや手編集で壊れている可能性があるため、
        // データ全体を信用せず、各レコードを検証してからワールドへ戻す。
        const sourceStructures = Array.isArray(saved.structures) ? saved.structures : [];
        const seenSids = new Set();
        let maxSid = 0;
        for (const s of sourceStructures) {
          if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
          if (!Number.isSafeInteger(s.sid) || s.sid < 1 || s.sid > 1000000000 || seenSids.has(s.sid)) continue;
          if (!BUILD_IDS.includes(s.buildId)) continue;
          if (![s.x, s.y, s.z, s.ry].every(v => typeof v === 'number' && Number.isFinite(v))) continue;
          if (s.length !== undefined && (s.buildId !== 'fence' || typeof s.length !== 'number' || !Number.isFinite(s.length) || s.length < FENCE_MIN_LENGTH || s.length > FENCE_MAX_LENGTH)) continue;
          // 通常の建築判定と同じ円形の島境界で検証する(四角い境界だと海上の角に復元される)。
          if (Math.hypot(s.x, s.z) > WORLD_SIZE * 0.5 || s.y < -100 || s.y > 200 || Math.abs(s.ry) > 1000) continue;
          if (this.structures.size >= MAX_STRUCTURES) break;
          const clean = {
            sid: s.sid, buildId: s.buildId, x: s.x, y: s.y, z: s.z, ry: s.ry,
            owner: typeof s.owner === 'string' ? s.owner.slice(0, 64) : ''
          };
          if (s.buildId === 'fence' && Number.isFinite(s.length)) clean.length = s.length;
          if (s.buildId === 'gate') clean.open = s.open === true;
          this.structures.set(clean.sid, clean);
          seenSids.add(clean.sid);
          maxSid = Math.max(maxSid, clean.sid);
        }
        const sourceChests = Array.isArray(saved.chests) ? saved.chests : [];
        // 配置ルールが変わった旧セーブの開封番号を新しい宝箱に誤適用しない。
        if (saved.layoutVersion === WORLD_LAYOUT_VERSION) {
          for (const i of sourceChests) {
            if (Number.isInteger(i) && i >= 0 && i < this.chestLocations.length) this.chests.add(i);
          }
        }
        const requestedNextSid = saved.nextSid;
        this.nextSid = Number.isSafeInteger(requestedNextSid) && requestedNextSid > maxSid && requestedNextSid <= 1000000000
          ? requestedNextSid : maxSid + 1;
      }

      for (let i = 0; i < ENEMY_ORDER.length; i++) {
        const kind = ENEMY_ORDER[i], cfg = ENEMY_KINDS[kind];
        const en = {
          id: i, kind, alive: false, hp: 0, maxHp: cfg.hp,
          x: 0, z: 0, ry: 0, homeX: 0, homeZ: 0, tx: 0, tz: 0, retarget: 0,
          speed: cfg.speed, fleeTimer: 0, knockX: 0, knockZ: 0, attackTimer: 0, respawnAt: 0, awake: !cfg.dormant, blockedT: 0, returnT: 0,
          mv: null, mvPh: 0, mvT: 0, mvTarget: 0, mvHit: null, dirX: 0, dirZ: 0, combo: 0, circDir: 1, circT: 0, look: null,
          camp: i >= ENEMY_CAMP_START && i < ENEMY_GROTTO_START, campIndex:getCampIndexForEnemyId(i), grotto: i >= ENEMY_GROTTO_START,
        };
        this.enemies.push(en);
        this.placeEnemy(en);
      }
      if (opts.rogueRecoveryState) this.restoreRogueRecoveryState(opts.rogueRecoveryState);
    }

    // 保存ファイルから遺品袋を復元する。全データを検証し、クライアントへ公開するワールド保存とは分離する。
    restoreRogueRecoveryState(raw) {
      this.rogueRecoveryStore.clear();
      if (!raw || typeof raw !== 'object' || raw.version !== 1 || !Array.isArray(raw.rooms)) return 0;
      const validPartyKey = key => typeof key === 'string' && (/^solo:[a-f0-9]{16}$/.test(key) || /^party:[A-Z0-9]{6}$/.test(key));
      let restored = 0;
      for (const source of raw.rooms.slice(0,128)) {
        if (!source || typeof source !== 'object' || !validPartyKey(source.key) || this.rogueRecoveryStore.has(source.key)) continue;
        if (!Number.isInteger(source.seed) || source.seed < 0 || source.seed > 0xffffffff) continue;
        if (!Number.isInteger(source.stage) || source.stage < 0 || source.stage > 4 || !Number.isInteger(source.openGates) || source.openGates < source.stage || source.openGates > 4) continue;
        if (!Array.isArray(source.bags) || source.bags.length < 1 || source.bags.length > 16) continue;
        const layout = getRogueDungeonLayout(source.seed >>> 0);
        const enemyMax = new Map(layout.enemies.map(e => [e.id, e.hp]));
        enemyMax.set('boss', layout.boss.hp);
        const enemyHp = new Map(enemyMax);
        if (source.enemyHp && typeof source.enemyHp === 'object' && !Array.isArray(source.enemyHp)) {
          for (const [id, hp] of Object.entries(source.enemyHp)) {
            if (!enemyMax.has(id) || !Number.isInteger(hp) || hp < 0 || hp > enemyMax.get(id)) continue;
            enemyHp.set(id, hp);
          }
        }
        const openedChests = new Set(Array.isArray(source.openedChests) ? source.openedChests.filter(i => Number.isInteger(i) && i >= 0 && i < layout.chests.length) : []);
        const bags = new Map();
        for (const item of source.bags) {
          if (!item || typeof item !== 'object' || typeof item.ownerPid !== 'string' || !/^[a-f0-9]{16}$/.test(item.ownerPid) || bags.has(item.ownerPid)) continue;
          if (typeof item.bagId !== 'string' || !/^[A-Za-z0-9:_-]{1,80}$/.test(item.bagId)) continue;
          const x = Number(item.x), z = Number(item.z), remainingMs = Number(item.remainingMs);
          if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 110 || z < -235 || z > 15 || !isRogueDungeonWalkable(x,z,source.openGates)) continue;
          if (!Number.isFinite(remainingMs) || remainingMs <= 0 || remainingMs > 7*60*1000) continue;
          const payload = this.rogueCarryPayload(item.payload);
          if (!this.hasRogueCarry(payload)) continue;
          bags.set(item.ownerPid, {
            bagId:item.bagId, ownerPid:item.ownerPid,
            ownerName:typeof item.ownerName === 'string' && item.ownerName.trim() ? item.ownerName.trim().slice(0,24) : '旅人',
            x, z, remainingMs:Math.floor(remainingMs), payload
          });
        }
        if (!bags.size) continue;
        const seq = Number.isSafeInteger(source.recoverySeq) && source.recoverySeq >= 1 && source.recoverySeq <= 1000000 ? source.recoverySeq : 1;
        this.rogueRecoveryStore.set(source.key, {
          key:source.key, seed:source.seed >>> 0, stage:source.stage, openGates:source.openGates,
          extractReady:source.extractReady === true && source.stage >= 4,
          openedChests:[...openedChests], enemyHp:Object.fromEntries(enemyHp), recoverySeq:seq,
          bags:[...bags.values()]
        });
        restored++;
      }
      return restored;
    }

    // ディスク用の非公開保存形式。クライアントのsaveExport / worldImportには渡さない。
    serializeRogueRecoveryState() {
      const records = new Map(this.rogueRecoveryStore);
      for (const room of this.rogueRooms.values()) {
        if (!room || room.recoveryBags.size === 0) { if (room) records.delete(room.key); continue; }
        records.set(room.key, {
          key:room.key, seed:room.seed, stage:room.stage, openGates:room.openGates,
          extractReady:room.extractReady === true, openedChests:[...room.openedChests],
          enemyHp:Object.fromEntries(room.enemyHp), recoverySeq:room.recoverySeq,
          bags:[...room.recoveryBags.values()].map(bag=>({
            bagId:bag.bagId, ownerPid:bag.ownerPid, ownerName:bag.ownerName,
            x:bag.x, z:bag.z, remainingMs:bag.remainingMs, payload:bag.payload
          }))
        });
      }
      return { version:1, rooms:[...records.values()].slice(0,128) };
    }

    // 種類ごとの生息場所を1か所選ぶ。置けなければ null
    pickEnemySpot(kind, en) {
      if (en && en.grotto) { // 海底洞窟のクラゲ: 洞窟の中(奥寄りの水中)
        const G = this.grottoLocation;
        if (!G) return null;
        for (let tries = 0; tries < 60; tries++) {
          const ang = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 2.2;
          const x = G.x + Math.cos(ang) * r, z = G.z + Math.sin(ang) * r;
          if (enemyCanStand('jelly', x, z)) return { x, z };
        }
        return null;
      }
      if (en && en.camp) { // 野営地の見張り: 自分の野営地のまわり(中央の箱から少し離れた所)
        const C = this.campLocations[en.campIndex] || this.campLocation;
        if (!C) return null;
        for (let tries = 0; tries < 60; tries++) {
          const ang = Math.random() * Math.PI * 2, r = 2.6 + Math.random() * 2.2;
          const x = C.x + Math.cos(ang) * r, z = C.z + Math.sin(ang) * r;
          if (islandHeight(x, z) >= 1.1) return { x, z };
        }
        return null;
      }
      const maxTries = kind === 'crab' ? 600 : 120; // 浜は細い帯なので、カニは多めに試す
      for (let tries = 0; tries < maxTries; tries++) {
        let x, z;
        if (kind === 'lizard') { // 遺跡のまわり
          const ruins = getRuinLocations(this.seed, 6);
          if (!ruins.length) return null;
          const ruin = ruins[Math.floor(Math.random() * ruins.length)];
          const ang = Math.random() * Math.PI * 2, r = 6 + Math.random() * 8;
          x = ruin.x + Math.cos(ang) * r; z = ruin.z + Math.sin(ang) * r;
        } else {
          const ang = Math.random() * Math.PI * 2;
          const r = (kind === 'jelly' ? 40 : 10) + Math.random() * (WORLD_SIZE * 0.42);
          x = Math.cos(ang) * r; z = Math.sin(ang) * r;
        }
        const h = islandHeight(x, z);
        if (isInsideCaveArea(x, z, 3)) continue;
        if (kind === 'crab' ? (h < 0.35 || h > 1.2) : kind === 'jelly' ? (h < JELLY_WATER_MIN || h > JELLY_WATER_MAX) : h < 1.1) continue;
        return { x, z };
      }
      return null;
    }

    placeEnemy(en) {
      const spot = this.pickEnemySpot(en.kind, en);
      if (spot) {
        en.x = spot.x; en.z = spot.z; en.homeX = spot.x; en.homeZ = spot.z; en.tx = spot.x; en.tz = spot.z;
        en.ry = Math.random() * Math.PI * 2;
        en.hp = en.maxHp; en.alive = true; en.awake = !ENEMY_KINDS[en.kind].dormant;
        en.fleeTimer = 0; en.knockX = 0; en.knockZ = 0; en.attackTimer = 0; en.blockedT = 0; en.returnT = 0;
        en.mv = null; en.mvPh = 0; en.mvT = 0; en.mvHit = null; en.combo = 0; en.circT = 0; en.look = null;
        en.retarget = Math.random() * 2;
        return true;
      }
      en.alive = false;
      return false;
    }

    enemyInfo(en) {
      return { id: en.id, kind: en.kind, x: r2(en.x), z: r2(en.z), ry: r2(en.ry), hp: en.hp, maxHp: en.maxHp, awake: en.awake ? 1 : 0 };
    }

    // ---- 接続管理 ----
    addClient(id) {
      this.clients.set(id, {
        id, name: '', pid: '', joined: false, joinedAt: 0, lastChatAt: 0,
        x: 0, y: 0, z: 6, ry: 0, cave: -1, flags: 0, dead: false,
        hasState: false, lastStateAt: 0, clientTime: null, clientTimeOrigin: null, serverTimeOrigin: null, lastHitAt: new Map(),
        roguePartyKey: null, rogueRoomKey: null,
        lastGateToggleAt: 0,
        stuckSince: 0, lastBlockedAt: 0, stuckAnchorX: 0, stuckAnchorZ: 0,
      });
      return this.welcomeFor(id);
    }

    welcomeFor(id) {
      return {
        t: 'welcome', id, seed: this.seed, pickupOthers: this.pickupOthers,
        taken: [...this.taken.keys()],
        structures: [...this.structures.values()],
        chests: [...this.chests],
        enemies: this.enemies.filter(e => e.alive).map(e => this.enemyInfo(e)),
        boss: this.boss.alive ? this.bossInfo() : null,
        players: [...this.clients.values()].filter(c => c.joined && c.id !== id).map(c => ({ id: c.id, name: c.name })),
      };
    }

    rogueRecoveryBagSnapshot(room, clientId) {
      const client=this.clients.get(clientId);
      const ownerPid=client && client.pid ? client.pid : `session:${clientId}`;
      return [...room.recoveryBags.values()].map(bag=>({
        bagId:bag.bagId, x:r2(bag.x), z:r2(bag.z), remainingMs:Math.max(0,Math.floor(bag.remainingMs)),
        ownerName:bag.ownerName, mine:bag.ownerPid===ownerPid, running:!!room.recoveryTimerActive
      }));
    }

    rogueRoomSnapshot(room, clientId) {
      return {
        t:'rogueRoomJoined', instanceId:room.id, seed:room.seed, partyCode:room.partyCode || '',
        stage:room.stage, openGates:room.openGates, extractReady:room.extractReady,
        openedChests:[...room.openedChests], enemyHp:Object.fromEntries(room.enemyHp),
        enemyPositions:[...room.enemyStates].map(([id,e])=>({id,x:r2(e.x),z:r2(e.z),yaw:r2(e.yaw)})),
        recoveryBags:this.rogueRecoveryBagSnapshot(room,clientId)
      };
    }

    broadcastRogueRecoveryState(room) {
      if(!room)return;
      const sent=new Set();
      for(const memberId of room.members){
        this.out.sendTo(memberId,{t:'rogueRecoveryBagState',instanceId:room.id,bags:this.rogueRecoveryBagSnapshot(room,memberId)});
        sent.add(memberId);
      }
      // 遺品の持ち主が島側へ戻っていても、制限時間をHUDへ反映する。
      for(const bag of room.recoveryBags.values()){
        for(const c of this.clients.values()){
          if(c.joined&&c.pid===bag.ownerPid&&!sent.has(c.id)){
            this.out.sendTo(c.id,{t:'rogueRecoveryBagState',instanceId:room.id,bags:this.rogueRecoveryBagSnapshot(room,c.id)});
            sent.add(c.id);
          }
        }
      }
    }

    rogueCarryPayload(raw) {
      const boundedInt=(v,max)=>Number.isFinite(Number(v))?Math.max(0,Math.min(max,Math.floor(Number(v)))):0;
      return {
        weaponBonus:boundedInt(raw && raw.weaponBonus,3),
        armorBonus:boundedInt(raw && raw.armorBonus,2),
        shards:boundedInt(raw && raw.shards,999999),
        attackBuffMs:boundedInt(raw && raw.attackBuffMs,120000),
        speedBuffMs:boundedInt(raw && raw.speedBuffMs,120000)
      };
    }

    hasRogueCarry(payload) {
      return !!payload && (payload.weaponBonus>0 || payload.armorBonus>0 || payload.shards>0 || payload.attackBuffMs>0 || payload.speedBuffMs>0);
    }

    createRogueRecoveryBag(room, owner, rawPayload, position) {
      if(!room || !owner || !owner.pid || room.recoveryBags.has(owner.pid))return null;
      const payload=this.rogueCarryPayload(rawPayload);
      if(!this.hasRogueCarry(payload))return null;
      const x=Number(position && position.x), z=Number(position && position.z);
      if(!Number.isFinite(x)||!Number.isFinite(z)||!isRogueDungeonWalkable(x,z,room.openGates))return null;
      const bag={
        bagId:`${room.id}-bag-${room.recoverySeq++}`, ownerPid:owner.pid,
        ownerName:typeof owner.name==='string'&&owner.name?owner.name.slice(0,24):'旅人',
        x,z,remainingMs:7*60*1000,payload
      };
      room.recoveryBags.set(owner.pid,bag);
      room.lastEmptyAt=0;
      return bag;
    }

    deleteRogueRoomIfUnused(room, now=Date.now()) {
      if(!room || room.members.size!==0)return false;
      if(room.recoveryBags.size===0 || (room.lastEmptyAt && now-room.lastEmptyAt>24*60*60*1000)){
        this.rogueRooms.delete(room.key);this.rogueRoomsById.delete(room.id);return true;
      }
      return false;
    }

    getRogueRoomForClient(id) {
      const c=this.clients.get(id);
      if(!c || !c.rogueRoomKey) return null;
      const room=this.rogueRooms.get(c.rogueRoomKey);
      return room && room.members.has(id) ? room : null;
    }

    joinRogueRoom(id) {
      const c=this.clients.get(id);
      if(!c || c.cave!==ROGUE_DUNGEON_INDEX) return;
      // 新クライアントはソロまたは6文字のパーティーコードを先に送信する。
      // 古いクライアントは個別ランへ入れ、意図しない全員共有を防ぐ。
      const partyKey=typeof c.roguePartyKey==='string' && c.roguePartyKey ? c.roguePartyKey : `solo:${c.pid || id}`;
      let room=this.rogueRooms.get(partyKey);
      if(!room) {
        const savedRecovery=this.rogueRecoveryStore.get(partyKey)||null;
        const seed=savedRecovery?savedRecovery.seed:(Math.floor(Math.random()*4294967296)>>>0);
        const layout=getRogueDungeonLayout(seed);
        const enemyHp=new Map(layout.enemies.map(e=>[e.id,e.hp]));
        enemyHp.set(layout.boss.id,layout.boss.hp);
        if(savedRecovery && savedRecovery.enemyHp && typeof savedRecovery.enemyHp==='object'){
          for(const [enemyId,hp] of Object.entries(savedRecovery.enemyHp))if(enemyHp.has(enemyId)&&Number.isInteger(hp)&&hp>=0)enemyHp.set(enemyId,hp);
        }
        const initEnemyState=(e,cooldown)=>({x:e.x,z:e.z,homeX:e.x,homeZ:e.z,yaw:0,cooldown,repath:0,path:[],pathIndex:0,targetId:null,attackPulse:0,patrolGoal:null,patrolTimer:0,phase:'idle',windupTimer:0,recoverTimer:0,aimX:e.x,aimZ:e.z,attackRadius:1.5,attackMode:'',chargeDx:0,chargeDz:0,chargeTimer:0,chargeHit:false});
        const enemyStates=new Map(layout.enemies.map(e=>[e.id,initEnemyState(e,0.8+Math.random()*0.9)]));
        enemyStates.set(layout.boss.id,initEnemyState(layout.boss,1.2));
        room={key:partyKey,id:this.rogueRoomSeq++,seed,partyCode:partyKey.startsWith('party:')?partyKey.slice(6):'',members:new Set(),stage:savedRecovery?savedRecovery.stage:0,openGates:savedRecovery?savedRecovery.openGates:0,extractReady:savedRecovery?savedRecovery.extractReady===true:false,openedChests:new Set(savedRecovery?savedRecovery.openedChests:[]),enemyHp,enemyStates,hitTimes:new Map(),motionTimer:0,recoveryBags:new Map((savedRecovery?savedRecovery.bags:[]).map(bag=>[bag.ownerPid,bag])),memberCarry:new Map(),recoverySeq:savedRecovery?savedRecovery.recoverySeq:1,recoveryStateTimer:0,recoveryTimerActive:false,lastEmptyAt:0};
        // once activated, the active room becomes the single source of truth for saved recovery data.
        this.rogueRecoveryStore.delete(partyKey);
        this.rogueRooms.set(partyKey,room);
        this.rogueRoomsById.set(room.id,room);
      }
      c.rogueRoomKey=partyKey;
      room.members.add(id);room.lastEmptyAt=0;
      this.out.sendTo(id,this.rogueRoomSnapshot(room,id));
      this.broadcastRogueRoom(room,{t:'rogueRoomMembers',instanceId:room.id,count:room.members.size,joined:id},id);
    }

    leaveRogueRoom(id) {
      const c=this.clients.get(id);
      const room=this.getRogueRoomForClient(id);
      if(!room) { if(c)c.rogueRoomKey=null; return; }
      room.members.delete(id);
      if(c){c.rogueRoomKey=null;if(c.pid)room.memberCarry.delete(c.pid);}
      for(const key of this.rogueHitCooldowns.keys()) if(key.startsWith(`${id}:`)) this.rogueHitCooldowns.delete(key);
      if(room.members.size===0) {
        room.lastEmptyAt=Date.now();
        this.deleteRogueRoomIfUnused(room,room.lastEmptyAt);
        return;
      }
      this.broadcastRogueRoom(room,{t:'rogueRoomMembers',instanceId:room.id,count:room.members.size,left:id});
    }

    broadcastRogueRoom(room, message, except) {
      if(!room) return;
      for(const memberId of room.members) if(memberId!==except) this.out.sendTo(memberId,message);
    }

    updateRogueRoomProgress(room) {
      while(room.stage<3) {
        const layout=getRogueDungeonLayout(room.seed);
        const mandatory=layout.enemies.filter(e=>e.stage===room.stage&&!e.optional);
        if(!mandatory.length || mandatory.some(e=>(room.enemyHp.get(e.id)||0)>0)) break;
        room.stage++; room.openGates=Math.max(room.openGates,room.stage);
      }
      if(room.stage===3 && (room.enemyHp.get('boss')||0)<=0) { room.stage=4; room.openGates=4; room.extractReady=true; }
    }

    updateRogueRoom(room, dt, now) {
      if(!room)return;
      const layout=getRogueDungeonLayout(room.seed);
      const members=[...room.members].map(id=>this.clients.get(id)).filter(c=>c&&c.joined&&!c.dead&&c.hasState&&c.cave===ROGUE_DUNGEON_INDEX&&now-(c.lastStateAt||0)<5000);
      // 回収タイマーは誰かがゲーム内で生存・接続中の間だけ進む。ログアウト中は止める。
      const ownerOnline=[...room.recoveryBags.values()].some(bag=>[...this.clients.values()].some(c=>c.joined&&!c.dead&&c.hasState&&c.pid===bag.ownerPid&&now-(c.lastStateAt||0)<5000));
      room.recoveryTimerActive=members.length>0||ownerOnline;
      if(room.recoveryTimerActive){
        let changed=false;
        for(const [ownerPid,bag] of room.recoveryBags){
          const before=Math.ceil(bag.remainingMs/1000);
          bag.remainingMs=Math.max(0,bag.remainingMs-Math.max(0,dt)*1000);
          if(Math.ceil(bag.remainingMs/1000)!==before)changed=true;
          if(bag.remainingMs<=0){
            room.recoveryBags.delete(ownerPid);changed=true;
            for(const c of this.clients.values())if(c.pid===ownerPid&&c.joined)this.out.sendTo(c.id,{t:'rogueRecoveryExpired',instanceId:room.id,bagId:bag.bagId});
          }
        }
        room.recoveryStateTimer-=dt;
        if(changed||room.recoveryStateTimer<=0){room.recoveryStateTimer=1;this.broadcastRogueRecoveryState(room);}
      }
      if(room.members.size===0){
        this.deleteRogueRoomIfUnused(room,now);
        return;
      }

      // 共通の経路追従。敵の移動はサーバーだけで計算し、クライアントは位置を描画する。
      const moveAlongPath=(state,speed)=>{
        if(!state.path||!state.path.length||state.pathIndex>=state.path.length)return false;
        const waypoint=state.path[state.pathIndex],wx=waypoint.x-state.x,wz=waypoint.z-state.z,wd=Math.hypot(wx,wz);
        if(wd<0.2){
          state.pathIndex++;
          if(state.pathIndex>=state.path.length){state.path=[];state.pathIndex=0;state.repath=0;}
          return true;
        }
        const step=Math.min(wd,speed*dt),nx=state.x+wx/(wd||1)*step,nz=state.z+wz/(wd||1)*step;
        if(!isRogueDungeonWalkable(nx,nz,room.openGates)){
          state.path=[];state.pathIndex=0;state.repath=0;return false;
        }
        state.x=nx;state.z=nz;state.yaw=Math.atan2(-wx,-wz);return true;
      };

      // 敵は担当区画の周囲を巡回する。未解放区画の敵は攻撃・追跡をせず、遠景でも置物に見えない程度に動く。
      const patrol=(state,target)=>{
        state.patrolTimer=Math.max(0,(state.patrolTimer||0)-dt);
        const goal=state.patrolGoal;
        const arrived=goal&&Math.hypot(goal.x-state.x,goal.z-state.z)<0.6;
        if(!goal||state.patrolTimer<=0||arrived||!state.path||!state.path.length){
          state.patrolGoal=null;state.path=[];state.pathIndex=0;
          state.patrolTimer=2.5+Math.random()*2.0;
          const hx=Number.isFinite(state.homeX)?state.homeX:target.x;
          const hz=Number.isFinite(state.homeZ)?state.homeZ:target.z;
          for(let attempt=0;attempt<14;attempt++){
            const a=Math.random()*Math.PI*2,r=1.0+Math.random()*2.4;
            const gx=hx+Math.cos(a)*r,gz=hz+Math.sin(a)*r;
            if(!isRogueDungeonWalkable(gx,gz,room.openGates))continue;
            const route=findRogueDungeonPath(state.x,state.z,gx,gz,room.openGates);
            if(!route.length)continue;
            state.patrolGoal={x:route[route.length-1].x,z:route[route.length-1].z};
            state.path=route;state.pathIndex=0;
            break;
          }
        }
        if(state.patrolGoal&&state.path.length){
          const profile=getRogueEnemyProfile(target.kind,target.stage,target.boss);
          moveAlongPath(state,profile.patrolSpeed||0.6);
        }
      };

      if(members.length){
        const targets=[...layout.enemies,layout.boss];
        const hurt=(victim,target,state,profile)=>{
          if(!victim||victim.dead)return false;
          const dx=victim.x-state.x,dz=victim.z-state.z,d=Math.hypot(dx,dz);
          this.out.sendTo(victim.id,{t:'roguePlayerHurt',instanceId:room.id,sourceId:target.id,amount:profile.damage,dx:dx/(d||1),dz:dz/(d||1)});
          state.attackPulse=0.28;
          return true;
        };
        const beginWindup=(state,target,selected,profile,mode)=>{
          state.phase='windup';state.windupTimer=profile.windup;state.targetId=selected.id;
          state.aimX=selected.x;state.aimZ=selected.z;state.attackMode=mode;
          state.attackRadius=profile.attackRadius;state.path=[];state.pathIndex=0;
          const dx=selected.x-state.x,dz=selected.z-state.z;
          if(Math.hypot(dx,dz)>1e-4)state.yaw=Math.atan2(-dx,-dz);
        };
        for(const target of targets){
          const hp=room.enemyHp.get(target.id)||0,state=room.enemyStates.get(target.id);
          if(!state||hp<=0)continue;
          const profile=getRogueEnemyProfile(target.kind,target.stage,target.boss);
          const encounterActive=target.boss?room.stage===3:(target.optional?target.stage<=room.stage:target.stage===room.stage);
          if(!encounterActive){
            if(state.phase==='windup'||state.phase==='charge'){state.phase='idle';state.windupTimer=0;state.chargeTimer=0;}
            state.targetId=null;state.attackPulse=0;state.attackMode='';
            if(!target.boss)patrol(state,target);
            continue;
          }
          state.cooldown=Math.max(0,state.cooldown-dt);
          state.repath=Math.max(0,state.repath-dt);
          state.attackPulse=Math.max(0,state.attackPulse-dt);

          // Wind-up attacks lock a visible danger area at the target's previous position;
          // moving clear before the timer expires avoids the hit.
          if(state.phase==='windup'){
            state.windupTimer=Math.max(0,state.windupTimer-dt);
            const ax=state.aimX-state.x,az=state.aimZ-state.z;
            if(Math.hypot(ax,az)>1e-4)state.yaw=Math.atan2(-ax,-az);
            if(state.windupTimer<=0){
              if(profile.role==='charger'){
                const d=Math.hypot(ax,az)||1;state.chargeDx=ax/d;state.chargeDz=az/d;
                state.chargeTimer=0.82;state.chargeHit=false;state.phase='charge';state.attackMode='charge';
              }else{
                const victim=members.find(c=>c.id===state.targetId)||null;
                if(victim&&Math.hypot(victim.x-state.aimX,victim.z-state.aimZ)<=profile.attackRadius){hurt(victim,target,state,profile);}
                state.phase='recover';state.recoverTimer=profile.recovery;state.cooldown=profile.cooldown;state.attackMode='';
              }
            }
            continue;
          }
          if(state.phase==='charge'){
            const step=profile.chargeSpeed*dt;
            const nx=state.x+state.chargeDx*step,nz=state.z+state.chargeDz*step;
            if(isRogueDungeonWalkable(nx,nz,room.openGates)){
              state.x=nx;state.z=nz;state.yaw=Math.atan2(-state.chargeDx,-state.chargeDz);
            }else{
              state.chargeTimer=0;
            }
            const victim=members.find(c=>c.id===state.targetId)||null;
            if(victim&&!state.chargeHit&&Math.hypot(victim.x-state.x,victim.z-state.z)<=profile.attackRadius+0.55){
              hurt(victim,target,state,profile);state.chargeHit=true;
            }
            state.chargeTimer-=dt;
            if(state.chargeTimer<=0){state.phase='recover';state.recoverTimer=profile.recovery;state.cooldown=profile.cooldown;state.path=[];state.pathIndex=0;state.attackMode='';}
            continue;
          }
          if(state.phase==='recover'){
            state.recoverTimer=Math.max(0,state.recoverTimer-dt);
            if(state.recoverTimer<=0)state.phase='idle';
            continue;
          }

          let selected=null,selectedPath=null,selectedD=Infinity;
          const chaseRange=profile.aggroRange;
          if(state.repath<=0||(state.targetId!==null&&state.path.length>0&&state.pathIndex>=state.path.length)){
            const ordered=members.map(c=>({c,d:Math.hypot(c.x-state.x,c.z-state.z)})).filter(v=>v.d<=chaseRange).sort((a,b)=>a.d-b.d);
            for(const candidate of ordered){
              const route=findRogueDungeonPath(state.x,state.z,candidate.c.x,candidate.c.z,room.openGates);
              if(route.length){selected=candidate.c;selectedPath=route;selectedD=candidate.d;break;}
            }
            if(selected){
              state.targetId=selected.id;state.path=selectedPath||[];state.pathIndex=0;
              state.patrolGoal=null;state.patrolTimer=0;
              if(profile.role==='ranged'){
                const dx=selected.x-state.x,dz=selected.z-state.z,d=Math.hypot(dx,dz)||1;
                if(selectedD>=profile.minRange&&selectedD<=profile.attackRange){state.path=[];state.pathIndex=0;}
                else{
                  const goalX=selected.x-(dx/d)*profile.preferredRange,goalZ=selected.z-(dz/d)*profile.preferredRange;
                  const rangedPath=isRogueDungeonWalkable(goalX,goalZ,room.openGates)?findRogueDungeonPath(state.x,state.z,goalX,goalZ,room.openGates):[];
                  if(rangedPath.length){state.path=rangedPath;state.pathIndex=0;}else if(selectedD<profile.minRange){state.path=[];state.pathIndex=0;}
                }
              }
            }else{
              state.targetId=null;
            }
            state.repath=0.35;
          }else{
            selected=members.find(c=>c.id===state.targetId)||null;
            if(selected)selectedD=Math.hypot(selected.x-state.x,selected.z-state.z);
          }
          if(!selected){state.targetId=null;patrol(state,target);continue;}
          state.patrolGoal=null;state.patrolTimer=0;
          const dx=selected.x-state.x,dz=selected.z-state.z,d=Math.hypot(dx,dz);
          if(d>1e-4)state.yaw=Math.atan2(-dx,-dz);

          if(profile.role==='ranged'){
            if(d>=profile.minRange&&d<=profile.attackRange&&state.cooldown<=0){
              beginWindup(state,target,selected,profile,'projectile');
            }else if(d>profile.attackRange||d<profile.minRange){
              if(!state.path.length||state.pathIndex>=state.path.length){state.repath=0;continue;}
              moveAlongPath(state,profile.speed);
            }else{state.path=[];state.pathIndex=0;}
          }else if(profile.role==='charger'){
            if(d<=profile.triggerRange&&state.cooldown<=0){beginWindup(state,target,selected,profile,'charge');}
            else if(d>profile.attackRange&&d<chaseRange&&state.path.length&&state.pathIndex<state.path.length){moveAlongPath(state,profile.speed);}
          }else if(d<=profile.attackRange){
            state.path=[];state.pathIndex=0;
            if(state.cooldown<=0)beginWindup(state,target,selected,profile,profile.role==='tank'||profile.role==='boss'?'slam':'melee');
          }else if(d<chaseRange){
            if(!state.path.length||state.pathIndex>=state.path.length){state.repath=0;continue;}
            moveAlongPath(state,profile.speed);
          }
        }
      }
      room.motionTimer-=dt;
      if(room.motionTimer<=0){
        room.motionTimer=0.1;
        const enemies=[...room.enemyStates].map(([id,e])=>({id,x:r2(e.x),z:r2(e.z),yaw:r2(e.yaw),attack:e.attackPulse>0?1:0,phase:e.phase||'idle',attackMode:e.attackMode||'',aimX:r2(e.aimX??e.x),aimZ:r2(e.aimZ??e.z),attackRadius:r2(e.attackRadius||1.5)}));
        this.broadcastRogueRoom(room,{t:'rogueEnemyMotion',instanceId:room.id,enemies});
      }
    }

    rogueRoomStateMessage(room) {
      return {t:'rogueRoomState',instanceId:room.id,stage:room.stage,openGates:room.openGates,extractReady:room.extractReady,openedChests:[...room.openedChests],enemyHp:Object.fromEntries(room.enemyHp)};
    }

    removeClient(id) {
      const c = this.clients.get(id);
      // 生存中に切断した場合も、最後に同期された携行データがあれば死亡時と同じ遺品袋を残す。
      if(c && c.cave===ROGUE_DUNGEON_INDEX && !c.dead && c.rogueRoomKey && c.pid){
        const room=this.rogueRooms.get(c.rogueRoomKey),payload=room&&room.memberCarry.get(c.pid);
        if(room && payload && !room.recoveryBags.has(c.pid)){
          const bag=this.createRogueRecoveryBag(room,c,payload,{x:c.x,z:c.z});
          if(bag){room.memberCarry.delete(c.pid);this.broadcastRogueRecoveryState(room);}
        }
      }
      if(c && c.rogueRoomKey) this.leaveRogueRoom(id);
      this.clients.delete(id);
      if (c && c.joined) this.out.broadcast({ t: 'leave', id }, id);
    }

    // ---- クライアントからのメッセージ ----
    handle(id, msg) {
      const c = this.clients.get(id);
      if (!c || !msg) return;
      switch (msg.t) {
        case 'join': {
          const cleanPlayerName = cleanName(msg.name);
          // クライアント側の入力制御だけに頼らず、空白・制御文字だけの名前もサーバーで拒否する。
          if (!cleanPlayerName) {
            this.out.sendTo(id, { t:'joinRejected', reason:'name-required' });
            return;
          }
          c.name = cleanPlayerName;
          c.pid = hashKey(msg.key);
          if (!c.joined) {
            c.joinedAt = Date.now();
            c.joined = true;
            this.out.broadcast({ t: 'join', id, name: c.name }, id);
          }
          this.out.sendTo(id, { t: 'joined', pid: c.pid, pickupOthers: this.pickupOthers });
          break;
        }
        case 'roguePartySelect': {
          if(!c.joined || c.cave===ROGUE_DUNGEON_INDEX) return;
          const mode=msg.mode==='solo'?'solo':(msg.mode==='create'||msg.mode==='join'?'party':'');
          if(!mode) { c.roguePartyKey=null; this.out.sendTo(id,{t:'roguePartySelected',ok:false,reason:'invalid-mode'}); return; }
          if(mode==='solo') {
            c.roguePartyKey=`solo:${c.pid || id}`;
            this.out.sendTo(id,{t:'roguePartySelected',ok:true,mode:'solo',code:''});
          } else {
            const code=typeof msg.code==='string'?msg.code.trim().toUpperCase():'';
            if(!/^[A-Z0-9]{6}$/.test(code)) { c.roguePartyKey=null; this.out.sendTo(id,{t:'roguePartySelected',ok:false,reason:'invalid-code'}); return; }
            c.roguePartyKey=`party:${code}`;
            this.out.sendTo(id,{t:'roguePartySelected',ok:true,mode,code});
          }
          break;
        }
        case 'attack': {
          // 攻撃モーションは位置スナップショットのフラグ変化だけに頼らず、攻撃ごとに独立して通知する。
          // 連打で「攻撃中→攻撃中」のままになると、低頻度のsnapでは立ち上がりを取り逃がすため。
          if (!c.joined || c.dead) return;
          const now = Date.now();
          if (now - (c.lastAttackAt || 0) < 100) return;
          c.lastAttackAt = now;
          if(c.cave===ROGUE_DUNGEON_INDEX){
            const room=this.getRogueRoomForClient(id);
            if(!room)return;
            this.broadcastRogueRoom(room,{t:'patk',id,cave:c.cave,instanceId:room.id},id);
          } else {
            this.out.broadcast({ t: 'patk', id, cave:c.cave, instanceId:0 }, id);
          }
          break;
        }
        case 'state': {
          if (!c.joined) return;
          const previousCave=c.cave;
          // 位置同期は他の参加者や敵AIも参照するため、壊れた値を状態に保存しない。
          // num() で不正値を 0 に変換すると、壊れたパケットでプレイヤーが原点へ飛ぶため、ここは拒否する。
          const values = [msg.x, msg.y, msg.z, msg.ry];
          if (!values.every(v => typeof v === 'number' && Number.isFinite(v))) return;
          if (Math.abs(msg.x) > WORLD_SIZE || Math.abs(msg.z) > WORLD_SIZE ||
              msg.y < -100 || msg.y > 200 || Math.abs(msg.ry) > 1000) return;
          if (!Number.isInteger(msg.cave) || msg.cave < -1 || msg.cave >= CAVE_SITES.length) return;
          if (typeof msg.f !== 'number' || !Number.isFinite(msg.f)) return;
          if (!isValidCavePosition(msg.cave, msg.x, msg.z)) return;
          const hasClientTime = Object.prototype.hasOwnProperty.call(msg, 'ts');
          const clientTime = hasClientTime ? msg.ts : null;
          if (hasClientTime && (typeof clientTime !== 'number' || !Number.isFinite(clientTime) || clientTime < 0)) return;

          const now = Date.now();
          if (c.hasState) {
            if (clientTime !== null && c.clientTime !== null && clientTime < c.clientTime) return;
            // クライアント時計がサーバー経過時間より大きく先行する値へ飛んだら拒否する。
            // これで通常のパケット遅延には対応しつつ、巨大な ts を送って移動許容量を水増しするのを抑える。
            if (clientTime !== null && c.clientTimeOrigin !== null && c.serverTimeOrigin !== null) {
              const clientElapsedFromOrigin = (clientTime - c.clientTimeOrigin) / 1000;
              const serverElapsedFromOrigin = Math.max(0, (now - c.serverTimeOrigin) / 1000);
              if (clientElapsedFromOrigin > serverElapsedFromOrigin + MAX_CLIENT_TIME_AHEAD_SEC) return;
            }
            if (!isValidCaveTransition(c.cave, msg.cave, c.x, c.z, msg.x, msg.z, c.dead)) return;
            if (c.cave === msg.cave) {
              // 現行クライアントは送信時刻(ts)を付けるため、WebSocketの受信が固まっても
              // バッファされた位置更新を順番に正しく検証できる。旧クライアントは受信時刻にフォールバック。
              const elapsed = clientTime !== null && c.clientTime !== null
                ? Math.max(0, (clientTime - c.clientTime) / 1000)
                : Math.max(0, (now - c.lastStateAt) / 1000);
              const allowed = MAX_PLAYER_SPEED * elapsed + MOVE_SLOP;
              if (distanceXZ(c.x, c.z, msg.x, msg.z) > allowed) return;
            }
          }
          const movedXZ = c.hasState ? distanceXZ(c.x, c.z, msg.x, msg.z) : Infinity;
          const moveInput = (msg.f & 16) !== 0;
          if (c.hasState && moveInput && movedXZ < 0.035) {
            if (!c.stuckSince || distanceXZ(msg.x, msg.z, c.stuckAnchorX, c.stuckAnchorZ) > 0.5) {
              c.stuckSince = now; c.stuckAnchorX = msg.x; c.stuckAnchorZ = msg.z;
            }
            c.lastBlockedAt = now;
          } else if ((moveInput && movedXZ >= 0.035) || movedXZ > 0.35 ||
              (c.lastBlockedAt && now - c.lastBlockedAt > 20000)) {
            c.stuckSince = 0; c.lastBlockedAt = 0;
            c.stuckAnchorX = msg.x; c.stuckAnchorZ = msg.z;
          }
          c.x = msg.x; c.y = msg.y; c.z = msg.z; c.ry = msg.ry;
          c.cave = msg.cave;
          c.lastStateAt = now;
          c.clientTime = clientTime;
          if (clientTime !== null && c.clientTimeOrigin === null) {
            c.clientTimeOrigin = clientTime;
            c.serverTimeOrigin = now;
          }
          c.hasState = true;
          // クライアントが送れる状態フラグを定義済みの5ビットに限定する。
          c.flags = (msg.f | 0) & 31;
          c.dead = !!(c.flags & 8);
          if(previousCave!==ROGUE_DUNGEON_INDEX && c.cave===ROGUE_DUNGEON_INDEX) this.joinRogueRoom(id);
          else if(previousCave===ROGUE_DUNGEON_INDEX && c.cave!==ROGUE_DUNGEON_INDEX) this.leaveRogueRoom(id);
          break;
        }
        case 'rogueCarryState': {
          if(!c.joined || c.dead || c.cave!==ROGUE_DUNGEON_INDEX || !c.pid) return;
          const room=this.getRogueRoomForClient(id);if(!room)return;
          const payload=this.rogueCarryPayload(msg);
          if(this.hasRogueCarry(payload))room.memberCarry.set(c.pid,payload);
          else room.memberCarry.delete(c.pid);
          break;
        }
        case 'rogueRecoveryDrop': {
          if(!c.joined || !c.dead || c.cave!==ROGUE_DUNGEON_INDEX || !c.hasState || !c.pid) {
            this.out.sendTo(id,{t:'rogueRecoveryDropResult',ok:false,reason:'invalid-state'});return;
          }
          const room=this.getRogueRoomForClient(id);if(!room){this.out.sendTo(id,{t:'rogueRecoveryDropResult',ok:false,reason:'no-room'});return;}
          if(room.recoveryBags.has(c.pid)){this.out.sendTo(id,{t:'rogueRecoveryDropResult',ok:false,reason:'already-dropped'});return;}
          // 死亡時の要求に含まれる装備値は信用せず、直前に同期したサーバー側の携行状態だけを使う。
          // 最後の同期がまだなければ何も落とさず、クライアントからの値で装備を増殖させない。
          const cachedPayload=room.memberCarry.get(c.pid);
          const payload=cachedPayload?this.rogueCarryPayload(cachedPayload):this.rogueCarryPayload({});
          const bag=this.createRogueRecoveryBag(room,c,payload,{x:c.x,z:c.z});
          room.memberCarry.delete(c.pid);
          if(!bag){this.out.sendTo(id,{t:'rogueRecoveryDropResult',ok:false,reason:'no-items'});return;}
          this.out.sendTo(id,{t:'rogueRecoveryDropResult',ok:true,bagId:bag.bagId,remainingMs:bag.remainingMs});
          this.broadcastRogueRecoveryState(room);
          break;
        }
        case 'rogueRecoveryClaim': {
          const reply=result=>this.out.sendTo(id,Object.assign({t:'rogueRecoveryClaimResult',instanceId:(c&&c.rogueRoomKey&&this.rogueRooms.get(c.rogueRoomKey)?.id)||0},result));
          if(!c.joined || c.dead || c.cave!==ROGUE_DUNGEON_INDEX || !c.hasState || !c.pid){reply({ok:false,reason:'invalid-state'});return;}
          const room=this.getRogueRoomForClient(id);if(!room){reply({ok:false,reason:'no-room'});return;}
          const bag=room.recoveryBags.get(c.pid);
          if(!bag || (typeof msg.bagId==='string'&&msg.bagId!==bag.bagId)){reply({ok:false,reason:'not-found'});return;}
          if(bag.remainingMs<=0){room.recoveryBags.delete(c.pid);this.broadcastRogueRecoveryState(room);reply({ok:false,reason:'expired'});return;}
          if(distanceXZ(c.x,c.z,bag.x,bag.z)>3.6){reply({ok:false,reason:'too-far'});return;}
          room.recoveryBags.delete(c.pid);room.memberCarry.delete(c.pid);
          reply({ok:true,bagId:bag.bagId,payload:bag.payload,restoredBuffRatio:0.5});
          this.broadcastRogueRecoveryState(room);
          break;
        }
        case 'rogueChestOpen': {
          if(!c.joined || c.dead || c.cave!==ROGUE_DUNGEON_INDEX) return;
          const room=this.getRogueRoomForClient(id);
          if(!room) return;
          const idx=Number.isInteger(msg.index)?msg.index:-1;
          if(idx<0 || idx>=5 || room.openedChests.has(idx) || !c.hasState) return;
          const chest=getRogueDungeonLayout(room.seed).chests[idx];
          if(!chest || distanceXZ(c.x,c.z,chest.x,chest.z)>5.2) return;
          room.openedChests.add(idx);
          const reward=getRogueChestReward(room.seed,idx);
          const event={t:'rogueChestOpened',instanceId:room.id,index:idx,reward,by:id};
          this.broadcastRogueRoom(room,event);
          this.broadcastRogueRoom(room,this.rogueRoomStateMessage(room));
          break;
        }
        case 'rogueHit': {
          if(!c.joined || c.dead || c.cave!==ROGUE_DUNGEON_INDEX || !c.hasState) return;
          const room=this.getRogueRoomForClient(id);
          if(!room) return;
          const targetId=typeof msg.targetId==='string' && /^(?:e(?:[0-9]|1[0-9])|boss)$/.test(msg.targetId)?msg.targetId:'';
          if(!targetId) return;
          const layout=getRogueDungeonLayout(room.seed);
          const target=targetId==='boss'?layout.boss:layout.enemies.find(e=>e.id===targetId);
          if(!target || (target.boss && room.stage!==3) || (!target.boss && !target.optional && target.stage!==room.stage)) return;
          const tx=msg.x,tz=msg.z,enemyState=room.enemyStates.get(targetId);
          if(!enemyState||![tx,tz].every(v=>typeof v==='number'&&Number.isFinite(v)) || Math.abs(tx)>105 || tz>27 || tz< -226) return;
          // 現在のサーバー管理位置へ届く攻撃だけを受理。クライアント指定座標で命中を偽装できないようにする。
          if(distanceXZ(c.x,c.z,enemyState.x,enemyState.z)>(target.boss?5.8:5.2) || distanceXZ(enemyState.x,enemyState.z,tx,tz)>5.0) return;
          const cooldownKey=`${id}:${targetId}`,now=Date.now(),last=this.rogueHitCooldowns.get(cooldownKey)||0;
          if(now-last<110) return;
          this.rogueHitCooldowns.set(cooldownKey,now);
          const before=room.enemyHp.get(targetId)||0; if(before<=0) return;
          const damage=clamp(Math.round(num(msg.damage,1)),1,8);
          const hp=Math.max(0,before-damage); room.enemyHp.set(targetId,hp);
          let shardReward=0;
          if(hp===0 && !target.boss) { const r=mulberry32((room.seed ^ (targetId.charCodeAt(0)*2654435761) ^ (Number(targetId.slice(1))||0))>>>0); shardReward=1+Math.floor(r()*3); }
          this.updateRogueRoomProgress(room);
          this.broadcastRogueRoom(room,{t:'rogueEnemyHitState',instanceId:room.id,targetId,hp,maxHp:target.hp,damage,by:id,killed:hp===0,shardReward,x:enemyState.x,z:enemyState.z,stage:room.stage,openGates:room.openGates,extractReady:room.extractReady});
          this.broadcastRogueRoom(room,this.rogueRoomStateMessage(room));
          break;
        }
        case 'emergencyEscape': {
          const requestId = Number.isSafeInteger(msg.requestId) && msg.requestId >= 0 ? msg.requestId : null;
          const reply = result => this.out.sendTo(id, Object.assign({ t:'emergencyEscapeResult', requestId }, result));
          if (!c.joined || !c.hasState || c.dead) { reply({ ok:false, reason:'unavailable' }); return; }
          const now = Date.now();
          const identity = c.pid || `session:${id}`;
          const cooldownUntil = this.emergencyEscapeCooldowns.get(identity) || 0;
          if (cooldownUntil > now) { reply({ ok:false, reason:'cooldown', remainingMs:Math.max(0, cooldownUntil - now) }); return; }
          if (!c.stuckSince || now - c.stuckSince < 8000 || !c.lastBlockedAt || now - c.lastBlockedAt > 20000) {
            reply({ ok:false, reason:'notStuck' }); return;
          }
          const originX = c.cave >= 0 ? 0 : c.x;
          const originZ = c.cave >= 0 ? 6 : c.z;
          const point = findSafeEscapePoint(originX, originZ, this.structures.values(), this.enemies, this.boss, this.seed);
          if (!point) { reply({ ok:false, reason:'noSafePoint' }); return; }
          const until = now + 180000;
          this.emergencyEscapeCooldowns.set(identity, until);
          if (this.emergencyEscapeCooldowns.size > 2000) {
            for (const [key, expiry] of this.emergencyEscapeCooldowns) if (expiry <= now) this.emergencyEscapeCooldowns.delete(key);
          }
          // サーバー側の座標も先に更新し、通常の移動速度検証でこの救済移動を拒否しないよう時計基準を再設定する。
          c.x = point.x; c.y = point.y; c.z = point.z; c.cave = -1;
          c.flags &= ~16; c.dead = false; c.lastStateAt = now;
          c.clientTime = null; c.clientTimeOrigin = null; c.serverTimeOrigin = null;
          c.stuckSince = 0; c.lastBlockedAt = 0;
          reply({ ok:true, x:point.x, y:point.y, z:point.z, cooldownMs:180000 });
          break;
        }
        case 'saveExport': {
          if (!c.joined) return;
          const requestId = Number.isSafeInteger(msg.requestId) && msg.requestId >= 0 ? msg.requestId : null;
          this.out.sendTo(id, { t:'saveExportResult', requestId, world:this.serialize() });
          break;
        }
        case 'worldImport': {
          if (!c.joined || c.dead) {
            this.out.sendTo(id, { t:'worldImportResult', requestId:msg.requestId, ok:false, reason:'unavailable' });
            return;
          }
          const requestId = Number.isSafeInteger(msg.requestId) && msg.requestId >= 0 ? msg.requestId : null;
          const result = this.restoreWorld(msg.world);
          this.out.sendTo(id, Object.assign({ t:'worldImportResult', requestId }, result));
          break;
        }
        case 'chat':
        case 'emote': {
          if (!c.joined) return;
          const now = Date.now();
          if (now - c.lastChatAt < CHAT_INTERVAL_MS) return; // 連投は無視
          if (msg.t === 'chat') {
            const text = cleanChat(msg.text);
            if (!text) return;
            c.lastChatAt = now;
            this.out.broadcast({ t: 'chat', id, name: c.name, text });
          } else {
            const e = msg.e | 0;
            if (e < 0 || e >= EMOTE_COUNT) return;
            c.lastChatAt = now;
            this.out.broadcast({ t: 'emote', id, e });
          }
          break;
        }
        case 'take': {
          if (!c.joined || c.dead) return;
          const key = typeof msg.key === 'string' ? msg.key : '';
          // 採集キーの形式だけでなく、現在のゲームが生成し得る添字の範囲も検証する。
          // 実際の個別座標照合は未実装なので、範囲外の架空キーだけでも先に拒否する。
          const outdoorMatch = /^o(0|[1-9]\d{0,2})$/.exec(key);
          const caveMatch = /^c([01])([oi])(0|[1-9]\d?)$/.exec(key);
          const underwaterMatch = /^u(0|[1-9]\d?)$/.exec(key);
          const outdoorIndex = outdoorMatch ? Number(outdoorMatch[1]) : -1;
          const caveResourceIndex = caveMatch ? Number(caveMatch[3]) : -1;
          const underwaterIndex = underwaterMatch ? Number(underwaterMatch[1]) : -1;
          const outdoorKey = !!outdoorMatch && outdoorIndex < MAX_OUTDOOR_COLLECTIBLE_KEYS;
          const validCaveKey = !!caveMatch && (
            (caveMatch[2] === 'o' && caveResourceIndex < MAX_CAVE_ORE_KEYS) ||
            (caveMatch[2] === 'i' && caveResourceIndex < MAX_CAVE_ITEM_KEYS)
          );
          const underwaterResource = underwaterIndex >= 0 ? this.underwaterResources[underwaterIndex] : null;
          const validUnderwaterKey = !!underwaterMatch && !!underwaterResource && underwaterResource.key === key;
          if ((!outdoorKey && !validCaveKey && !validUnderwaterKey) || key.length > 24) {
            this.out.sendTo(id, { t: 'takeDenied', key: key.slice(0, 24) });
            return;
          }
          const knownKind = Object.prototype.hasOwnProperty.call(RESPAWN_SEC, msg.kind);
          const kindMatchesKey = underwaterMatch ? (!!underwaterResource && msg.kind === underwaterResource.kind) : (!caveMatch ||
            (caveMatch[2] === 'o' && msg.kind === 'crystal') ||
            (caveMatch[2] === 'i' && msg.kind === 'item'));
          // 海底資源は seed から再現した正規位置・種類・素材/図鑑アイテムの区分を照合する。
          if (underwaterMatch) {
            if (!validUnderwaterKey || c.cave >= 0 || !c.hasState || !knownKind || !kindMatchesKey ||
                msg.itemId !== underwaterResource.type ||
                distanceXZ(c.x, c.z, underwaterResource.x, underwaterResource.z) > UNDERWATER_INTERACT_RADIUS ||
                Math.abs(c.y - underwaterResource.y) > 4.0) {
              this.out.sendTo(id, { t: 'takeDenied', key });
              return;
            }
          } else if ((c.cave < 0 && !outdoorKey) ||
              (c.cave >= 0 && (!validCaveKey || Number(caveMatch[1]) !== c.cave)) ||
              !knownKind || !kindMatchesKey) {
            this.out.sendTo(id, { t: 'takeDenied', key });
            return;
          }
          if (this.taken.has(key) || this.taken.size >= MAX_TRACKED_TAKEN) {
            this.out.sendTo(id, { t: 'takeDenied', key });
            return;
          }
          const kind = msg.kind;
          this.taken.set(key, { at: Date.now() + RESPAWN_SEC[kind] * 1000 });
          this.out.broadcast({ t: 'taken', key, by: id });
          break;
        }
        case 'place': {
          if (!c.joined || c.dead) return;
          const buildId = msg.buildId;
          const raw = [msg.x, msg.y, msg.z, msg.ry];
          if (!raw.every(v => typeof v === 'number' && Number.isFinite(v))) {
            this.out.sendTo(id, { t: 'placeDenied', buildId, reason: 'bad' });
            return;
          }
          const x = msg.x, y = msg.y, z = msg.z, ry = msg.ry;
          const hasCustomLength = Object.prototype.hasOwnProperty.call(msg, 'length');
          const customLengthValid = buildId === 'fence' && typeof msg.length === 'number' && Number.isFinite(msg.length) && msg.length >= FENCE_MIN_LENGTH && msg.length <= FENCE_MAX_LENGTH;
          let reason = null;
          if (c.cave >= 0) reason = 'cave';
          else if (!BUILD_IDS.includes(buildId) || (hasCustomLength && !customLengthValid)) reason = 'bad';
          else if (this.structures.size >= MAX_STRUCTURES) reason = 'limit';
          else if (Math.hypot(x - c.x, z - c.z) > 14) reason = 'distance';
          else reason = checkPlacement(buildId, x, y, z, this.structures.values(), ry, customLengthValid ? msg.length : undefined);
          if (reason) { this.out.sendTo(id, { t: 'placeDenied', buildId, reason }); return; }
          const s = { sid: this.nextSid++, buildId, x: r2(x), y: r2(y), z: r2(z), ry: r2(ry), owner: c.pid };
          if (customLengthValid) s.length = r2(msg.length);
          if (buildId === 'gate') s.open = false;
          this.structures.set(s.sid, s);
          this.out.broadcast(Object.assign({ t: 'placed', by: id }, s));
          break;
        }
        case 'gateToggle': {
          if (!c.joined || c.dead || c.cave >= 0 || !c.hasState || !Number.isSafeInteger(msg.sid) || msg.sid < 1) return;
          const gate = this.structures.get(msg.sid);
          if (!gate || gate.buildId !== 'gate') return;
          if (distanceXZ(gate.x, gate.z, c.x, c.z) > 3.5) {
            this.out.sendTo(id, { t:'gateToggleDenied', sid:msg.sid, reason:'distance' });
            return;
          }
          const now = Date.now();
          if (now - (c.lastGateToggleAt || 0) < 300) return;
          c.lastGateToggleAt = now;
          gate.open = gate.open !== true;
          this.out.broadcast({ t:'gateState', sid:gate.sid, open:gate.open, by:id });
          break;
        }
        case 'pickup': {
          if (!c.joined || c.dead || c.cave >= 0 || !Number.isInteger(msg.sid)) return;
          const s = this.structures.get(msg.sid);
          if (!s || distanceXZ(s.x, s.z, c.x, c.z) > 10) return;
          if (s.owner && s.owner !== c.pid && !this.pickupOthers) {
            this.out.sendTo(id, { t: 'pickupDenied', sid: s.sid });
            return;
          }
          this.structures.delete(s.sid);
          this.out.broadcast({ t: 'removed', sid: s.sid, buildId: s.buildId, by: id });
          break;
        }
        case 'pickupMany': {
          const requestId = Number.isSafeInteger(msg.requestId) && msg.requestId >= 0 ? msg.requestId : null;
          const reply = (recovered, skipped, reason) => this.out.sendTo(id, {
            t: 'pickupManyResult', requestId, recovered, skipped, ...(reason ? { reason } : {})
          });
          if (!c.joined || c.dead || c.cave >= 0 || !c.hasState) {
            reply(0, Array.isArray(msg.sids) ? msg.sids.length : 0, 'unavailable');
            return;
          }
          if (!Array.isArray(msg.sids) || msg.sids.length < 1 || msg.sids.length > MAX_BULK_PICKUP_IDS ||
              !msg.sids.every(sid => Number.isSafeInteger(sid) && sid > 0)) {
            reply(0, Array.isArray(msg.sids) ? msg.sids.length : 0, 'bad');
            return;
          }
          const uniqueSids = [...new Set(msg.sids)];
          let recovered = 0;
          for (const sid of uniqueSids) {
            const s = this.structures.get(sid);
            if (!s || distanceXZ(s.x, s.z, c.x, c.z) > 10 ||
                (s.owner && s.owner !== c.pid && !this.pickupOthers)) continue;
            this.structures.delete(s.sid);
            this.out.broadcast({ t: 'removed', sid: s.sid, buildId: s.buildId, by: id });
            recovered++;
          }
          reply(recovered, uniqueSids.length - recovered);
          break;
        }
        case 'chest': {
          if (!c.joined || c.dead || c.cave >= 0) return;
          // ビット演算による小数/文字列の暗黙変換を避け、整数のindexだけを受け付ける。
          const idx = msg.idx;
          if (!Number.isInteger(idx) || idx < 0 || idx >= this.chestLocations.length || this.chests.has(idx)) return;
          // indexだけでは開けられない。サーバーが生成した宝箱の座標との距離も確認する。
          const chest = this.chestLocations[idx];
          if ((chest.lighthouse || chest.grotto) && Math.abs(c.y - chest.y) > 4) return; // 灯台の宝箱は頂上まで登らないと、洞窟の宝箱は水面の上からは開けられない
          if (chest.camp && this.enemies.some(e => e.camp && e.campIndex === (Number.isInteger(chest.campIndex) ? chest.campIndex : 0) && e.alive)) return; // その野営地の見張りだけを倒せば開く
          if (!c.hasState || distanceXZ(c.x, c.z, chest.x, chest.z) > CHEST_INTERACT_RADIUS) return;
          this.chests.add(idx);
          this.out.broadcast({ t: 'chestOpened', idx, by: id });
          break;
        }
        case 'hitboss': this.hitBoss(c, msg); break;
        case 'hit': {
          if (!c.joined || c.dead || c.cave >= 0) return;
          const en = this.enemies[msg.id | 0];
          if (!en || !en.alive) return;
          const dx = en.x - c.x, dz = en.z - c.z;
          const d = Math.hypot(dx, dz);
          if (d > 8) return; // 離れすぎ(ラグ許容つきの範囲チェック)
          const now = Date.now();
          const lastHitAt = c.lastHitAt.get(en.id) || 0;
          if (now - lastHitAt < HIT_COOLDOWN_MS) return; // 同じ敵への攻撃連打を制限
          c.lastHitAt.set(en.id, now);
          for (const [enemyId, at] of c.lastHitAt) if (now - at > 5000) c.lastHitAt.delete(enemyId);
          const dmg = clamp(Math.round(num(msg.dmg, 1)), 1, 4);
          const kp = clamp(num(msg.kp, 5.5), 0, 9);
          const nx = dx / (d || 1), nz = dz / (d || 1);
          const hcfg = ENEMY_KINDS[en.kind];
          let dmgDealt = dmg, guard = false;
          // カニは正面からの攻撃をハサミで防ぐ(のけぞり中は無防備)。側面・背後なら通る
          if (hcfg.guard && en.mvPh !== 2 && -nx * Math.sin(en.ry) - nz * Math.cos(en.ry) > 0.35) { dmgDealt = Math.max(0, dmg - hcfg.guard); guard = true; }
          en.hp -= dmgDealt;
          en.awake = true; // 擬態している敵も殴られれば動き出す
          const reachable = enemyCanReach(en.kind, c);
          if (en.mv && en.mvPh === 0 && dmgDealt > 0) { // 予備動作中に殴られると技が中断され、のけぞる
            en.mvPh = 2; en.mvT = 0.6; en.mvHit = null;
          } else if (!en.mv && en.hp > 0 && reachable && hcfg.moves && hcfg.moves.charge && en.attackTimer <= 0) { // 猪は殴られると突進で反撃する
            this.startMove(en, 'charge', c);
          }
          const lowHp = hcfg.fleeBelow && en.hp <= en.maxHp * hcfg.fleeBelow;
          if (hcfg.flee || lowHp || !reachable) { // 弱った敵、または届かない場所から殴られた敵は距離を取る
            en.fleeTimer = 1.2;
            en.tx = en.x + nx * 6; en.tz = en.z + nz * 6;
            en.retarget = 1.2;
          }
          en.knockX = nx * kp * (guard ? 0.4 : 1); en.knockZ = nz * kp * (guard ? 0.4 : 1);
          this.out.broadcast({ t: 'ehit', id: en.id, hp: Math.max(0, en.hp), maxHp: en.maxHp, dmg: dmgDealt, by: id, dx: r2(nx), dz: r2(nz), g: guard ? 1 : 0 });
          if (en.hp <= 0) {
            en.alive = false;
            en.respawnAt = Date.now() + ENEMY_RESPAWN_MS;
            this.out.broadcast({ t: 'edead', id: en.id, by: id });
          }
          break;
        }
      }
    }

    // ---- 毎tick(サーバーは20Hz) ----
    tick(dt) {
      const now = Date.now();
      for (const [key, v] of this.taken) {
        if (now >= v.at) { this.taken.delete(key); this.out.broadcast({ t: 'respawn', key }); }
      }
      this.updateEnemies(dt, now);
      this.updateBoss(dt, now);
      for(const room of this.rogueRooms.values()) this.updateRogueRoom(room, dt, now);
      this.tickCount++;
      if (this.tickCount % 2 === 0) this.broadcastSnap();
    }

    fenceCollide(en, radius) {
      const pos = resolveFencePoint(en.x, en.z, radius, this.structures.values());
      en.x = pos.x;
      en.z = pos.z;
    }

    updateEnemies(dt, now) {
      for (const en of this.enemies) {
        if (!en.alive) {
          if (now >= en.respawnAt) {
            if (this.placeEnemy(en)) this.out.broadcast(Object.assign({ t: 'espawn' }, this.enemyInfo(en)));
            else en.respawnAt = now + 5000;
          }
          continue;
        }
        en.attackTimer = Math.max(0, en.attackTimer - dt);
        en.circT -= dt; en.look = null;
        const px = en.x, pz = en.z; // この tick の移動前の位置(生息域の外へ出そうなときに戻す)

        // 襲ってくる敵(狼・岩トカゲ・カニ・クラゲ): 近くの(洞窟の外にいる生存)プレイヤーのうち最も近い者を追う
        const cfg = ENEMY_KINDS[en.kind];
        let aggro = false;
        if (cfg.aggroR > 0 && en.fleeTimer <= 0 && en.returnT <= 0 && !en.mv) {
          let best = null, bd = en.awake ? cfg.aggroR : (cfg.wakeR || cfg.aggroR);
          for (const c of this.clients.values()) {
            if (!c.joined || c.dead || c.cave >= 0) continue;
            if (!enemyCanReach(en.kind, c)) continue; // 届かない場所(深い水の中・陸の上など)のプレイヤーは狙わない
            const d = Math.hypot(c.x - en.x, c.z - en.z);
            if (d < bd) { bd = d; best = c; }
          }
          if (cfg.dormant) en.awake = !!best; // 擬態する敵は、近くに誰もいなければまた動かなくなる
          if (best) {
            aggro = true;
            en.tx = best.x; en.tz = best.z; en.retarget = 0.15;
            const mvName = en.attackTimer <= 0 ? this.chooseMove(en, cfg, bd) : null;
            if (mvName) this.startMove(en, mvName, best);
            else this.positionAround(en, cfg, best, bd);
          }
        }
        if (cfg.dormant && !en.awake) { // 岩に擬態中: 動かない(吹き飛ばしだけは受ける)
          if (Math.abs(en.knockX) > 0.01 || Math.abs(en.knockZ) > 0.01) {
            en.x += en.knockX * dt; en.z += en.knockZ * dt;
            const decay = Math.max(0, 1 - dt * 7.5);
            en.knockX *= decay; en.knockZ *= decay;
          }
          this.pushEnemyOutOfPlayers(en);
          continue;
        }
        if (en.mv) {
          // 技の最中: 予備動作→本攻撃→のけぞり(自分では歩き回らない)
        } else if (en.returnT > 0) { // 追えなくなったので、あきらめて初期位置へ歩いて戻る(戻る間は襲ってこない)
          en.returnT -= dt;
          en.tx = en.homeX; en.tz = en.homeZ; en.retarget = 0.5;
          if (Math.hypot(en.homeX - en.x, en.homeZ - en.z) < 1.5) en.returnT = 0;
        } else if (!aggro) {
          en.retarget -= dt;
          if (en.retarget <= 0) {
            const ang = Math.random() * Math.PI * 2;
            const r = en.grotto ? 0.4 + Math.random() * 1.4 : en.camp ? 0.5 + Math.random() * 1.5 : 3 + Math.random() * 10; // 見張りは野営地から離れない
            en.tx = en.homeX + Math.cos(ang) * r;
            en.tz = en.homeZ + Math.sin(ang) * r;
            en.retarget = 3 + Math.random() * 4;
          }
        }
        if (en.fleeTimer > 0) en.fleeTimer -= dt;

        const dx = en.tx - en.x, dz = en.tz - en.z;
        const d = Math.hypot(dx, dz);
        if (en.mv) {
          this.stepMove(en, cfg, dt);
        } else if (d > 0.3) {
          const spd = aggro ? en.speed * 1.3 : (en.fleeTimer > 0 ? en.speed * 1.8 : en.speed);
          en.x += (dx / d) * spd * dt;
          en.z += (dz / d) * spd * dt;
          // 向き: 相手の周りを回っている間は相手の方を向く。それ以外は進む方向
          const lx = en.look ? en.look.x - en.x : dx, lz = en.look ? en.look.z - en.z : dz;
          this.turnTo(en, Math.atan2(lx, lz), cfg.turn || 6, dt);
        } else if (en.look) {
          this.turnTo(en, Math.atan2(en.look.x - en.x, en.look.z - en.z), cfg.turn || 6, dt);
        }
        if (Math.abs(en.knockX) > 0.01 || Math.abs(en.knockZ) > 0.01) {
          en.x += en.knockX * dt; en.z += en.knockZ * dt;
          const decay = Math.max(0, 1 - dt * 7.5);
          en.knockX *= decay; en.knockZ *= decay;
        }
        this.fenceCollide(en, 0.4);
        this.pushEnemyOutOfPlayers(en);
        // 生息域(陸・浜・海中)の外へは入れない: 外へ出る移動は取りやめて、手前で止める。
        // 追っている最中に止められ続けたら、追うのをあきらめて初期位置へ戻る(止まったまま一方的に殴られないように)
        if (!enemyCanStand(en.kind, en.x, en.z)) {
          if (enemyCanStand(en.kind, px, pz)) {
            en.x = px; en.z = pz; en.knockX = 0; en.knockZ = 0; en.retarget = 0;
            if (aggro) {
              en.blockedT += dt;
              if (en.blockedT > 1.2) { en.returnT = 5; en.blockedT = 0; }
            }
          } else { // 移動前から外にいた(吹き飛ばしなど)場合だけ、初期位置へ戻す保険
            en.x = en.homeX; en.z = en.homeZ; en.tx = en.homeX; en.tz = en.homeZ; en.blockedT = 0;
          }
        } else {
          en.blockedT = Math.max(0, en.blockedT - dt);
        }
      }
      this.separateEnemies();
    }

    // ---- 敵の技(予備動作→本攻撃→のけぞり) ----
    turnTo(en, target, rate, dt) {
      let diff = target - en.ry;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      en.ry += diff * Math.min(1, dt * rate);
    }

    // いま出せる技を選ぶ(出せなければ null)。岩トカゲは3回に1回、尻尾の薙ぎ払い
    chooseMove(en, cfg, d) {
      const m = cfg.moves;
      if (!m) return null;
      if (m.lunge) return d <= m.lunge.trigger ? 'lunge' : null;
      if (m.pinch) return d <= m.pinch.trigger ? 'pinch' : null;
      if (m.pulse) return d <= m.pulse.trigger ? 'pulse' : null;
      if (m.bite) {
        if (en.combo % 3 === 2 && d <= m.whip.trigger) return 'whip';
        if (d <= m.bite.trigger) return 'bite';
      }
      return null;
    }

    startMove(en, name, target) {
      en.mv = name; en.mvPh = 0; en.mvT = ENEMY_KINDS[en.kind].moves[name].windup;
      en.mvHit = null; en.mvTarget = target ? target.id : 0; en.combo++;
    }

    // 技を出さないときの位置取り: 狼は相手の周りを回る、クラゲは近づきすぎず止まる
    positionAround(en, cfg, target, d) {
      if (cfg.orbit && d < 6) {
        if (en.circT <= 0) { en.circDir = Math.random() < 0.5 ? -1 : 1; en.circT = 1.5 + Math.random() * 2; }
        const ux = (en.x - target.x) / (d || 1), uz = (en.z - target.z) / (d || 1);
        const a = 0.7 * en.circDir, ca = Math.cos(a), sa = Math.sin(a), R = Math.max(3.4, Math.min(d, 4.5));
        en.tx = target.x + (ux * ca - uz * sa) * R; en.tz = target.z + (ux * sa + uz * ca) * R;
        en.look = { x: target.x, z: target.z };
      } else if (cfg.hold && d < cfg.hold) {
        en.tx = en.x; en.tz = en.z;
        en.look = { x: target.x, z: target.z };
      }
    }

    stepMove(en, cfg, dt) {
      const def = cfg.moves[en.mv];
      const tgt = this.clients.get(en.mvTarget);
      const alive = tgt && tgt.joined && !tgt.dead && tgt.cave < 0;
      en.mvT -= dt;
      if (en.mvPh === 0) { // 予備動作: その場で止まって相手の方を向く(終わりのわずかな間は向きを固定=かわせる)
        if (alive && en.mvT > 0.15) this.turnTo(en, Math.atan2(tgt.x - en.x, tgt.z - en.z), cfg.turn ? cfg.turn * 2 : 10, dt);
        if (en.mvT <= 0) {
          en.mvPh = 1; en.mvT = def.dur; en.mvHit = new Set();
          en.dirX = Math.sin(en.ry); en.dirZ = Math.cos(en.ry);
          this.out.broadcast({ t: 'eatk', id: en.id, mv: MOVE_ID[en.mv] }); // 全員の画面で本攻撃の動きを出す
          if (!def.dash) this.moveHit(en, def);
        }
      } else if (en.mvPh === 1) { // 本攻撃
        if (def.dash) { en.x += en.dirX * def.speed * dt; en.z += en.dirZ * def.speed * dt; this.moveHit(en, def); }
        if (en.mvT <= 0) { en.mvPh = 2; en.mvT = def.recover; }
      } else if (en.mvT <= 0) { // のけぞり(隙)が終わったら通常に戻る
        en.attackTimer = def.cd; en.mv = null; en.mvPh = 0; en.mvHit = null;
        en.tx = en.x; en.tz = en.z; en.retarget = 0.3;
      }
    }

    // 本攻撃の当たり判定: 範囲内にいる(届く場所の)プレイヤーに1回だけダメージ
    moveHit(en, def) {
      for (const c of this.clients.values()) {
        if (!c.joined || c.dead || c.cave >= 0 || en.mvHit.has(c.id)) continue;
        if (!enemyCanReach(en.kind, c)) continue;
        const hx = c.x - en.x, hz = c.z - en.z, hd = Math.hypot(hx, hz);
        if (hd > def.hitR) continue;
        en.mvHit.add(c.id);
        this.out.sendTo(c.id, { t: 'hurt', amount: def.hurt, dx: r2(hx / (hd || 1)), dz: r2(hz / (hd || 1)) });
      }
    }

    // 敵はプレイヤーの体に入り込まない(プレイヤーの位置はクライアントが決めるので、動くのは敵だけ)
    pushEnemyOutOfPlayers(en) {
      const r = BODY_RADIUS[en.kind] + BODY_RADIUS.player;
      for (const c of this.clients.values()) {
        if (!c.joined || c.dead || c.cave >= 0) continue;
        const p = bodyPush(en.x, en.z, c.x, c.z, r);
        if (p) { en.x += p.x; en.z += p.z; }
      }
    }

    // 敵どうしも重ならない(お互いに半分ずつ押し合う)
    separateEnemies() {
      const list = this.enemies.filter(e => e.alive);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const p = bodyPush(a.x, a.z, b.x, b.z, BODY_RADIUS[a.kind] + BODY_RADIUS[b.kind]);
          if (!p) continue;
          a.x += p.x / 2; a.z += p.z / 2; b.x -= p.x / 2; b.z -= p.z / 2;
        }
      }
    }

    broadcastSnap() {
      const players = [];
      for (const c of this.clients.values()) {
        if (c.joined) {
          const rogueRoom=c.cave===ROGUE_DUNGEON_INDEX?this.getRogueRoomForClient(c.id):null;
          players.push([c.id, r2(c.x), r2(c.y), r2(c.z), r2(c.ry), c.cave, c.flags, rogueRoom?rogueRoom.id:0]);
        }
      }
      if (!players.length) return;
      const e = [];
      for (const en of this.enemies) if (en.alive) e.push([en.id, r2(en.x), r2(en.z), r2(en.ry), en.awake ? 1 : 0, en.mv ? (en.mvPh + 1) * 10 + MOVE_ID[en.mv] : 0]);
      const snap = { t: 'snap', e, p: players };
      const b = this.boss;
      if (b.alive) snap.b = [r2(b.x), r2(b.z), r2(b.ry), BOSS_STATE_CODE[b.state], b.hp];
      this.out.broadcast(snap);
    }

    // ---- ボス ----
    newBoss() {
      const home = getBossHome(this.seed);
      return {
        alive: true, hp: BOSS_MAX_HP, maxHp: BOSS_MAX_HP, x: home.x, z: home.z, ry: 0, homeX: home.x, homeZ: home.z,
        state: 'idle', timer: 0, cooldown: 1.5, lostTarget: 0, zones: [], atk: null, respawnAt: 0,
      };
    }

    bossInfo() {
      const b = this.boss;
      return { x: r2(b.x), z: r2(b.z), ry: r2(b.ry), hp: b.hp, maxHp: b.maxHp, state: BOSS_STATE_CODE[b.state] };
    }

    bossPhase() { return this.boss.hp <= this.boss.maxHp / 2 ? 1 : 0; }

    // ボスに狙われうるプレイヤー(地上にいる生存者)
    bossTargets(maxDist) {
      const b = this.boss, list = [];
      for (const c of this.clients.values()) {
        if (!c.joined || c.dead || c.cave >= 0 || !c.hasState) continue;
        const d = Math.hypot(c.x - b.x, c.z - b.z);
        if (d <= maxDist && Math.hypot(c.x - b.homeX, c.z - b.homeZ) <= BOSS_LEASH + 6) list.push({ c, d });
      }
      return list.sort((p, q) => p.d - q.d);
    }

    hitBoss(c, msg) {
      const b = this.boss;
      if (!b.alive || !c.joined || c.dead || c.cave >= 0 || !c.hasState) return;
      const dx = b.x - c.x, dz = b.z - c.z, d = Math.hypot(dx, dz);
      if (d > BOSS_HIT_RANGE) return;
      const now = Date.now();
      if (now - (c.lastHitAt.get(-1) || 0) < HIT_COOLDOWN_MS) return; // 敵の id は 0 以上なので、ボスは -1 で記録する
      c.lastHitAt.set(-1, now);
      const dmg = clamp(Math.round(num(msg.dmg, 1)), 1, 4);
      b.hp = Math.max(0, b.hp - dmg);
      if (b.state === 'idle' && b.hp > 0) b.state = 'chase'; // 眠っていても攻撃されれば起きる
      this.out.broadcast({ t: 'bhit', hp: b.hp, maxHp: b.maxHp, dmg, by: c.id, dx: r2(dx / (d || 1)), dz: r2(dz / (d || 1)) });
      if (b.hp <= 0) {
        b.alive = false; b.zones = []; b.atk = null;
        b.respawnAt = now + BOSS_RESPAWN_MS;
        this.out.broadcast({ t: 'bdead', by: c.id, x: r2(b.x), z: r2(b.z) });
      }
    }

    updateBoss(dt, now) {
      const b = this.boss;
      if (!b.alive) {
        if (now >= b.respawnAt) {
          this.boss = this.newBoss();
          this.out.broadcast(Object.assign({ t: 'bspawn' }, this.bossInfo()));
        }
        return;
      }
      b.cooldown = Math.max(0, b.cooldown - dt);

      if (b.state === 'slam' || b.state === 'rock') {
        b.timer -= dt;
        if (b.timer <= 0) this.resolveBossAttack();
        this.pushBossOutOfPlayers();
        return;
      }
      if (b.state === 'recover') {
        b.timer -= dt;
        if (b.timer <= 0) b.state = 'chase';
        this.pushBossOutOfPlayers();
        return;
      }

      const targets = this.bossTargets(b.state === 'idle' ? BOSS_AGGRO : BOSS_CHASE_RANGE);
      if (b.state === 'idle') {
        if (targets.length) { b.state = 'chase'; b.lostTarget = 0; }
        else { this.bossWalk(b.homeX, b.homeZ, BOSS_SPEED * 1.5, dt); b.hp = Math.min(b.maxHp, b.hp + dt * 6); }
        return;
      }
      // chase
      if (!targets.length) {
        b.lostTarget += dt;
        if (b.lostTarget > 5) b.state = 'idle';
        this.bossWalk(b.homeX, b.homeZ, BOSS_SPEED, dt);
        return;
      }
      b.lostTarget = 0;
      const t = targets[0];
      if (b.cooldown <= 0) { this.startBossAttack(t.d <= BOSS_SLAM_RANGE ? 'slam' : 'rock', targets); return; }
      if (t.d > BOSS_RADIUS + BODY_RADIUS.player + 0.8) this.bossWalk(t.c.x, t.c.z, BOSS_SPEED * (this.bossPhase() ? 1.35 : 1), dt);
      else this.bossTurn(t.c.x, t.c.z, dt);
      this.pushBossOutOfPlayers();
    }

    bossTurn(tx, tz, dt) {
      const b = this.boss;
      const diff = Math.atan2(Math.sin(Math.atan2(tx - b.x, tz - b.z) - b.ry), Math.cos(Math.atan2(tx - b.x, tz - b.z) - b.ry));
      b.ry += diff * Math.min(1, dt * 4);
    }

    bossWalk(tx, tz, speed, dt) {
      const b = this.boss;
      const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
      this.bossTurn(tx, tz, dt);
      if (d < 0.3) return;
      const px = b.x, pz = b.z, step = Math.min(d, speed * dt);
      b.x += (dx / d) * step; b.z += (dz / d) * step;
      this.fenceCollide(b, BOSS_RADIUS * 0.7);
      if (islandHeight(b.x, b.z) < 0.8 || isInsideCaveArea(b.x, b.z, 2)) { b.x = px; b.z = pz; }
      this.pushBossOutOfPlayers();
    }

    pushBossOutOfPlayers() {
      const b = this.boss, r = BOSS_RADIUS + BODY_RADIUS.player;
      for (const c of this.clients.values()) {
        if (!c.joined || c.dead || c.cave >= 0) continue;
        const p = bodyPush(b.x, b.z, c.x, c.z, r);
        if (p) { b.x += p.x; b.z += p.z; }
      }
    }

    // 予告(赤い範囲)を出して攻撃の溜めに入る。当たり判定は溜め終わりの瞬間に、その時の位置で行う
    startBossAttack(kind, targets) {
      const b = this.boss, spec = BOSS_ATTACKS[kind], ph = this.bossPhase();
      b.state = kind; b.timer = spec.dur[ph];
      b.zones = kind === 'slam'
        ? [[b.x, b.z, spec.r[ph]]]
        : targets.slice(0, spec.maxZones[ph]).map(t => [t.c.x, t.c.z, spec.r[ph]]);
      this.out.broadcast({ t: 'batk', kind, dur: spec.dur[ph], zones: b.zones.map(z => [r2(z[0]), r2(z[1]), z[2]]) });
    }

    resolveBossAttack() {
      const b = this.boss, kind = b.state, spec = BOSS_ATTACKS[kind], ph = this.bossPhase();
      for (const c of this.clients.values()) {
        if (!c.joined || c.dead || c.cave >= 0) continue;
        for (const [zx, zz, zr] of b.zones) {
          const d = Math.hypot(c.x - zx, c.z - zz);
          if (d > zr + 0.3) continue; // 0.3 は通信遅延ぶんの許容
          this.out.sendTo(c.id, { t: 'hurt', amount: spec.dmg, dx: r2((c.x - zx) / (d || 1)), dz: r2((c.z - zz) / (d || 1)) });
          break;
        }
      }
      this.out.broadcast({ t: 'bimpact', kind, zones: b.zones.map(z => [r2(z[0]), r2(z[1]), z[2]]) });
      b.zones = [];
      b.state = 'recover'; b.timer = ph ? 0.7 : 1.0;
      b.cooldown = ph ? 1.2 : 2.0;
    }

    restoreWorld(saved) {
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ok:false, reason:'invalid' };
      if (saved.layoutVersion !== WORLD_LAYOUT_VERSION) return { ok:false, reason:'layout' };
      if (!Number.isInteger(saved.seed) || saved.seed < 0 || saved.seed > 0xffffffff) return { ok:false, reason:'invalid' };
      if (!Array.isArray(saved.structures) || saved.structures.length > MAX_STRUCTURES ||
          !Array.isArray(saved.chests) || saved.chests.length > MAX_CHESTS) return { ok:false, reason:'invalid' };
      const sids = new Set();
      let maxSid = 0;
      for (const s of saved.structures) {
        if (!s || typeof s !== 'object' || !Number.isSafeInteger(s.sid) || s.sid < 1 || s.sid > 1000000000 || sids.has(s.sid) ||
            !BUILD_IDS.includes(s.buildId) || ![s.x, s.y, s.z, s.ry].every(v => typeof v === 'number' && Number.isFinite(v)) ||
            Math.hypot(s.x, s.z) > WORLD_SIZE * 0.5 || s.y < -100 || s.y > 200 || Math.abs(s.ry) > 1000 ||
            (s.owner !== undefined && (typeof s.owner !== 'string' || s.owner.length > 64)) ||
            (s.open !== undefined && typeof s.open !== 'boolean') ||
            (s.length !== undefined && (s.buildId !== 'fence' || typeof s.length !== 'number' || !Number.isFinite(s.length) || s.length < FENCE_MIN_LENGTH || s.length > FENCE_MAX_LENGTH))) return { ok:false, reason:'invalid' };
        sids.add(s.sid); maxSid = Math.max(maxSid, s.sid);
      }
      if (!Number.isSafeInteger(saved.nextSid) || saved.nextSid <= maxSid || saved.nextSid > 1000000000) return { ok:false, reason:'invalid' };
      const chestIds = new Set();
      for (const idx of saved.chests) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_CHESTS || chestIds.has(idx)) return { ok:false, reason:'invalid' };
        chestIds.add(idx);
      }

      // 復元先のシードを含めてワールドを作り直す。全クライアントは seedChanged の通知で再読み込みする。
      const candidate = new WorldSim({ saved, pickupOthers:this.pickupOthers });
      if (candidate.structures.size !== saved.structures.length || candidate.chests.size !== saved.chests.length) return { ok:false, reason:'invalid' };
      const seedChanged = candidate.seed !== this.seed;
      this.seed = candidate.seed;
      this.structures = candidate.structures;
      this.chests = candidate.chests;
      this.nextSid = candidate.nextSid;
      this.chestLocations = candidate.chestLocations;
      this.campLocations = candidate.campLocations;
      this.campLocation = candidate.campLocation;
      this.underwaterLayout = candidate.underwaterLayout;
      this.underwaterResources = candidate.underwaterResources;
      this.enemies = candidate.enemies;
      this.boss = candidate.boss;
      this.taken.clear(); // 採集物の再出現待ちは永続化データに含めない
      const world = this.serialize();
      this.out.broadcast({ t:'worldRestored', world, seedChanged });
      return { ok:true, seedChanged, structures:world.structures.length };
    }

    serialize() {
      return { layoutVersion: WORLD_LAYOUT_VERSION, seed: this.seed, nextSid: this.nextSid, structures: [...this.structures.values()], chests: [...this.chests] };
    }
  }

  return {
    WORLD_SIZE, noise2, islandHeight, mulberry32, WorldSim, MAX_BULK_PICKUP_IDS,
    WORLD_LAYOUT_VERSION, CHEST_INTERACT_RADIUS, LIGHTHOUSE, getLighthouseLocation, lighthouseFloorY, lighthouseRailClamp, lighthouseChestSpot, getFeatureClearZones, SPRING, springTerrainOffset, getSpringLocations, getRuinLocations, getChestLocations, getUnderwaterLayout, resolveFencePoint, moveFencePoint,
    isRogueRampSideEntryBlocked,
    FENCE_MIN_LENGTH, FENCE_MAX_LENGTH, FENCE_JOIN_TOLERANCE, fenceEndpoints, fenceEndpointJoin, fenceEndsMeet,
    ENEMY_WOLF_COUNT, ENEMY_BOAR_COUNT, ENEMY_LIZARD_COUNT, ENEMY_CRAB_COUNT, ENEMY_JELLY_COUNT, ENEMY_CLASSIC_WOLF_COUNT, ENEMY_CLASSIC_BOAR_COUNT, ENEMY_KINDS, ENEMY_ORDER, ENEMY_CAMP_KINDS, ENEMY_CAMP_START, isCampEnemyId, getCampIndexForEnemyId, ENEMY_GROTTO_KINDS, ENEMY_GROTTO_START, isGrottoEnemyId, GROTTO, getGrottoLocation, grottoChestSpot, grottoWallSolids, CAMP, getCampLocation, getCampLocations, campChestSpot, MOVE_ID, JELLY_WATER_MIN, JELLY_WATER_MAX, jellyHeight, enemyCanStand, enemyCanReach, WADE_MIN, CAVE_SITES, CAVE_AREA, isInsideCaveArea, BUILD_RADIUS, checkPlacement, snapBuildPlacement, hashKey, MAX_CHESTS,
    CHAT_MAX_CHARS, CHAT_INTERVAL_MS, EMOTE_COUNT, cleanChat, BODY_RADIUS, bodyPush,
    isValidCavePosition, isValidCaveTransition, MAX_PLAYER_SPEED, HIT_COOLDOWN_MS, MAX_TRACKED_TAKEN,
    getClosedFenceLoops, isInsideFenceEnclosure, findSafeEscapePoint,
    MAX_OUTDOOR_COLLECTIBLE_KEYS, MAX_CAVE_ORE_KEYS, MAX_CAVE_ITEM_KEYS, MAX_UNDERWATER_RESOURCES, UNDERWATER_INTERACT_RADIUS,
    CAVE_MOUTH_OFFSET, CAVE_EXIT_RECESS, CAVE_EXIT_OFFSET,
    CAVE_ROOM_RADIUS, CAVE_INTERIOR_ENTRY, CAVE_INTERIOR_EXIT, ROGUE_DUNGEON_INDEX, ROGUE_WALK_AREAS, ROGUE_GATE_Z, isRogueDungeonWalkable, getRogueDungeonFloorCandidates, rogueFloorHoleContainsPoint, findRogueDungeonPath, getRogueDungeonLayout, resolveRogueDungeonSpawn, getRogueChestReward, ROGUE_ENEMY_PROFILES, getRogueEnemyProfile,
    getBossHome, BOSS_MAX_HP, BOSS_RADIUS, BOSS_RESPAWN_MS, BOSS_HIT_RANGE, BOSS_ATTACKS, BOSS_STATE_CODE,
  };
});
