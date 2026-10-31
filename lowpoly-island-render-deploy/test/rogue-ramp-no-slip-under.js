// v70.12: ダンジョンの坂を「横から下へ入り込める」「上から面を抜けて落ちる」不具合の再発防止テスト。
//
// 症状の原因は2つあった。
//  1. 坂は石の躯体(面から下の広間の床までが石)なのに、坂の真下に広間の床が「立てる床」として残っていた。
//     坂の始点の脇をかすめると、広間の床の高さのまま坂の中へ歩き込めた。
//  2. 坂へ向かって(上り勾配で)ジャンプすると、1フレームで坂の面が足元より上へ持ち上がる。
//     着地判定が「前フレームの足元が面以上」だったため着地できず、面の下へ抜けて奈落まで落ちた。
//
// index.html の実際の関数(床候補の選択・移動の検証)を取り出して、クライアントの1フレームの物理を再現して歩かせる。
// 再現コード(frame)は updatePlayer の洞窟内の部分と同じ式なので、式が食い違わないよう文字列でも照合する。
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const Shared = require('../public/shared.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');
let failures = 0;
function check(name, ok, detail = '') { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + detail)); if (!ok) failures++; }

// ---------- 1. 共有の床候補: 坂の躯体の中の床は返さない ----------
const classic = Shared.ROGUE_WALK_AREAS;
const westRamp = classic[5];            // -14,-78 → -29,-69 (0 → 3.8) 広間の床の上にかぶさる
const deepRamp = classic[11];           // 0,-152 → 0,-166 (-1.4 → -5.2) 終端が下の広間(-5.2)にかぶさる
const at = (a, t, lat = 0) => {
  const dx = a.bx - a.ax, dz = a.bz - a.az, len = Math.hypot(dx, dz);
  return { x: a.ax + dx * t + dz / len * lat, z: a.az + dz * t - dx / len * lat };
};
const ids = p => Shared.getRogueDungeonFloorCandidates(p.x, p.z, 3, 'classic').map(c => c.kind + '@' + c.y.toFixed(2));
{
  const mid = at(westRamp, 0.55), c = Shared.getRogueDungeonFloorCandidates(mid.x, mid.z, 3, 'classic');
  check('上り坂の途中: 坂の面だけが立てる床で、真下の広間の床(0m)は含まれない',
    c.length === 1 && c[0].kind === 'ramp' && c[0].y > 1, ids(mid).join(','));
  const nearStart = at(westRamp, 0.005), cs = Shared.getRogueDungeonFloorCandidates(nearStart.x, nearStart.z, 3, 'classic');
  check('上り坂の始点のすぐ内側: 面が床と同じ高さの間は、広間の床にも坂にも立てる(段差なく乗り移れる)',
    cs.some(c => c.kind === 'ramp') && cs.some(c => c.kind === 'ellipse' && Math.abs(c.y) < .01), ids(nearStart).join(','));
  const deepEnd = { x: 4.4, z: -160.5 }, cd = Shared.getRogueDungeonFloorCandidates(deepEnd.x, deepEnd.z, 3, 'classic');
  check('深層への坂の終端(下の広間にかぶさる所): 坂の面だけが立てる床で、広間の床(-5.2m)は含まれない',
    cd.length === 1 && cd[0].kind === 'ramp', ids(deepEnd).join(','));
  // 坂ではない上下の床の重なり(高台と広間)は従来どおり両方残す
  const stacked = Shared.getRogueDungeonFloorCandidates(-33.75, -76.5, 3, 'classic');
  check('坂ではない上下の床の重なり(高台と広間)は、従来どおり両方の床を残す',
    stacked.some(c => Math.abs(c.y) < .05) && stacked.some(c => Math.abs(c.y - 3.8) < .05), ids({ x: -33.75, z: -76.5 }).join(','));
}

// ---------- 2. 実際の物理を再現して歩かせる ----------
function extractFn(name) {
  const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(html);
  if (!m) throw new Error('function not found: ' + name);
  let i = html.indexOf('{', m.index), depth = 0, j = i;
  for (; j < html.length; j++) { const c = html[j]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) break; } }
  return html.slice(m.index, j + 1);
}
function extractConst(name) {
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*[^;]+;').exec(html);
  return m ? m[0] : '';
}
const hasLandingReach = /const ROGUE_LANDING_SLOPE_REACH\s*=/.test(html);
const fnNames = ['isRogueWalkable', 'rogueFloorCandidatesAt', 'rogueChooseConnectedFloor',
  'roguePlayerFloorHeight', 'rogueDungeonMovePathAllowed', 'constrainRogueDungeonPosition', 'getPlayerFloor'];
const constNames = ['ROGUE_MAX_STEP_UP', 'ROGUE_AIRBORNE_FLOOR_TOLERANCE', 'ROGUE_LANDING_SLOPE_REACH', 'ROGUE_MOVE_SAMPLE_SPACING', 'GRAV', 'JUMP'];
function makeWorld(variant) {
  const code = `
    const THREE={MathUtils:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v))}};
    const INTERIOR_FLOOR_Y=0;
    let ROGUE_DUNGEON_VARIANT=${JSON.stringify(variant)};
    let inCaveIndex=0, ROGUE_DUNGEON_INDEX=0;
    const player={position:{x:0,y:0,z:0}};
    const rogueRun={openGates:3,lastPos:{x:0,z:0},playerFloorSurfaceId:null,lastSafePos:null};
    let grounded=true, vy=0;
    ${constNames.map(extractConst).join('\n')}
    ${fnNames.map(extractFn).join('\n')}
    // 着地の許容: 修正前の式は「前フレームの足元 >= 面 - 1e-4」だった。
    const LAND_REACH=${hasLandingReach ? 'ROGUE_LANDING_SLOPE_REACH' : '1e-4'};
    function frame(dx,dz,dt,jump){
      player.position.x+=dx; player.position.z+=dz;
      constrainRogueDungeonPosition(player.position);
      const floor=getPlayerFloor(player.position.x,player.position.z);
      const groundY=floor.y, hasFloor=floor.hasFloor!==false;
      if(!hasFloor) grounded=false;
      if(jump&&grounded){vy=JUMP;grounded=false;}
      if(hasFloor&&grounded){
        if(Math.abs(groundY-player.position.y)<=ROGUE_MAX_STEP_UP+1e-6){player.position.y=groundY;vy=0;}else grounded=false;
      }else if(!hasFloor){grounded=false;}
      const yb=player.position.y;
      vy+=GRAV*dt; player.position.y+=vy*dt;
      if(hasFloor&&grounded&&player.position.y<=groundY){player.position.y=groundY;vy=0;grounded=true;}
      else if(hasFloor&&!grounded&&vy<=0&&yb>=groundY-LAND_REACH&&player.position.y<=groundY){player.position.y=groundY;vy=0;grounded=true;}
      else grounded=false;
      if(hasFloor&&grounded&&Number.isFinite(groundY)&&isRogueWalkable(player.position.x,player.position.z,rogueRun.openGates)&&Math.abs(player.position.y-groundY)<=0.12){
        const c=rogueFloorCandidatesAt(player.position.x,player.position.z,rogueRun.openGates);
        const s=rogueChooseConnectedFloor(c,groundY,player.position.y,false,rogueRun.playerFloorSurfaceId||null);
        if(s){rogueRun.lastSafePos={x:player.position.x,y:s.y,z:player.position.z,surfaceId:s.id};rogueRun.lastPos={x:player.position.x,z:player.position.z};rogueRun.playerFloorSurfaceId=s.id;}
      }
      constrainRogueDungeonPosition(player.position);
    }
    return {player,rogueRun,frame,setState:(g,v)=>{grounded=g;vy=v;}};
  `;
  return vm.runInNewContext('(function(Shared){' + code + '})', { Math, Number }, { timeout: 5000 })(Shared);
}

// 坂の面の高さ(坂の幅の内側のときだけ)。None なら坂の外。
function rampSurface(a, x, z) {
  const dx = a.bx - a.ax, dz = a.bz - a.az, len = Math.hypot(dx, dz);
  const along = ((x - a.ax) * dx + (z - a.az) * dz) / len, lat = ((x - a.ax) * dz - (z - a.az) * dx) / len;
  if (along < 0.3 || along > len - 0.3 || Math.abs(lat) > a.width * 0.45) return null;
  return a.yA + (a.yB - a.yA) * along / len;
}

// 坂のまわりの床の上から、全方向へ(歩き・ダッシュ、60fps・20fps、ジャンプあり・なし)歩かせ、
// 「坂の面より0.6m以上下へ入り込む」「奈落(-8.5m)まで落ちる」が1回も起きないことを確認する。
let totalRuns = 0, underRamp = 0, fell = 0; const firstBad = [];
for (const variant of ['classic', 'linear']) {
  const areas = Shared.getRogueDungeonDefinition(variant).areas;
  areas.forEach((a, idx) => {
    if (a.type !== 'segment' || Math.abs((a.yB || 0) - (a.yA || 0)) < 1e-5) return;
    const dx = a.bx - a.ax, dz = a.bz - a.az, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, nx = uz, nz = -ux;
    const w = makeWorld(variant);
    for (let s = -6; s <= len + 6; s += 3) for (let l = -a.width * 0.9; l <= a.width * 0.9; l += 2.7) {
      const sx = a.ax + ux * s + nx * l, sz = a.az + uz * s + nz * l;
      if (!Shared.isRogueDungeonWalkable(sx, sz, 3, variant)) continue;
      for (const c of Shared.getRogueDungeonFloorCandidates(sx, sz, 3, variant)) {
        for (let deg = 0; deg < 360; deg += 30) for (const [sp, fps] of [[11.5, 60], [18.4, 20]]) for (const jumpy of [false, true]) {
          totalRuns++;
          w.player.position.x = sx; w.player.position.y = c.y; w.player.position.z = sz;
          w.rogueRun.lastPos = { x: sx, z: sz }; w.rogueRun.playerFloorSurfaceId = c.id; w.rogueRun.lastSafePos = null; w.setState(true, 0);
          const dt = 1 / fps, hx = Math.cos(deg * Math.PI / 180), hz = Math.sin(deg * Math.PI / 180);
          let bad = null;
          for (let f = 0, n = Math.round(2.5 / dt); f < n; f++) {
            w.frame(hx * sp * dt, hz * sp * dt, dt, jumpy && f % 40 === 5);
            const p = w.player.position, surf = rampSurface(a, p.x, p.z);
            if (surf !== null && p.y < surf - 0.6) { bad = 'under'; break; }
            if (p.y < -8.5) { bad = 'fell'; break; }
          }
          if (bad) {
            if (bad === 'under') underRamp++; else fell++;
            if (firstBad.length < 3) firstBad.push(`${variant} ramp${idx} start(${sx.toFixed(1)},${c.y.toFixed(1)},${sz.toFixed(1)}) ${c.kind} deg${deg} ${sp}m/s ${fps}fps jump=${jumpy} -> ${bad}`);
          }
        }
      }
    }
  });
}
check(`坂の周囲を歩いても、坂の面より下(石の中)へ入り込まない (${totalRuns}通り)`, underRamp === 0, `${underRamp}件 例: ${firstBad.join(' | ')}`);
check(`坂へジャンプして着地しても、面を抜けて奈落まで落ちない (${totalRuns}通り)`, fell === 0, `${fell}件 例: ${firstBad.join(' | ')}`);

// 通常の歩行を邪魔しない: 坂を軸に沿って上り下りして、反対側の床まで通り抜けられる。
let walkRuns = 0, walkFail = 0; const walkBad = [];
for (const variant of ['classic', 'linear']) {
  Shared.getRogueDungeonDefinition(variant).areas.forEach((a, idx) => {
    if (a.type !== 'segment' || Math.abs((a.yB || 0) - (a.yA || 0)) < 1e-5) return;
    const dx = a.bx - a.ax, dz = a.bz - a.az, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, nx = uz, nz = -ux;
    for (const dir of [1, -1]) for (const latFrac of [-0.35, 0, 0.35]) for (const [sp, fps] of [[11.5, 60], [18.4, 20]]) {
      walkRuns++;
      const lat = latFrac * a.width, s0 = dir > 0 ? -2.5 : len + 2.5, s1 = dir > 0 ? len + 2.5 : -2.5;
      const sx = a.ax + ux * s0 + nx * lat, sz = a.az + uz * s0 + nz * lat, ex = a.ax + ux * s1 + nx * lat, ez = a.az + uz * s1 + nz * lat;
      const startY = dir > 0 ? a.yA : a.yB, endY = dir > 0 ? a.yB : a.yA;
      const pick = (x, z, y) => Shared.getRogueDungeonFloorCandidates(x, z, 3, variant).sort((p, q) => Math.abs(p.y - y) - Math.abs(q.y - y))[0];
      const c0 = pick(sx, sz, startY), c1 = pick(ex, ez, endY);
      if (!c0 || !c1) continue;
      const w = makeWorld(variant);
      w.player.position.x = sx; w.player.position.y = c0.y; w.player.position.z = sz;
      w.rogueRun.lastPos = { x: sx, z: sz }; w.rogueRun.playerFloorSurfaceId = c0.id; w.setState(true, 0);
      const dt = 1 / fps, total = Math.hypot(ex - sx, ez - sz), mx = (ex - sx) / total, mz = (ez - sz) / total;
      let dropped = false;
      for (let f = 0, n = Math.round((total / sp + 3) / dt); f < n; f++) {
        const prog = (w.player.position.x - sx) * mx + (w.player.position.z - sz) * mz;
        if (prog >= total - 0.05) break;
        w.frame(mx * Math.min(sp * dt, total - prog), mz * Math.min(sp * dt, total - prog), dt, false);
        if (w.player.position.y < -8.5) { dropped = true; break; }
      }
      const p = w.player.position;
      if (dropped || Math.hypot(p.x - ex, p.z - ez) > 0.8 || Math.abs(p.y - c1.y) > 0.35) {
        walkFail++; if (walkBad.length < 3) walkBad.push(`${variant} ramp${idx} dir${dir} lat${lat.toFixed(1)} -> (${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`);
      }
    }
  });
}
check(`坂を軸に沿って上り下りすれば、反対側の床まで通り抜けられる (${walkRuns}通り)`, walkFail === 0, `${walkFail}件 例: ${walkBad.join(' | ')}`);

// ---------- 3. 再現コードと本体の式が食い違っていないこと ----------
check('着地判定は面への食い込みの許容(ROGUE_LANDING_SLOPE_REACH)を使う',
  /!grounded && vy<=0 && yBeforeGravity>=groundY-ROGUE_LANDING_SLOPE_REACH && player\.position\.y<=groundY/.test(html));
check('空中の床選択も同じ許容を使う', /footY>=c\.y-ROGUE_LANDING_SLOPE_REACH/.test(html));
check('許容は別の階の床との最小段差(2.6m)より小さく、歩行の段差(0.45m)より大きい', (() => {
  const m = /const ROGUE_LANDING_SLOPE_REACH\s*=\s*([0-9.]+);/.exec(html); const v = m ? parseFloat(m[1]) : NaN;
  return v > 0.45 && v < 2.6;
})());
check('shared.js は坂の躯体の中の床を除く関数を持つ', /function rogueDropFloorsInsideRampBody/.test(fs.readFileSync(path.join(__dirname, '..', 'public/shared.js'), 'utf8')));

if (failures) { console.error(`${failures} test(s) failed`); process.exit(1); }
console.log('ALL PASSED');
