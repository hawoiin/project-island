// v70.13: ダンジョンの坂の作り直し(歩行判定・床候補・側面の壁・描画を1つの矩形に統一)の回帰テスト。
//
// 作り直す前の問題(数値で確認したもの):
//  - 旧遺跡の坂2本(西の高台・東の窪地)の始点が裂け目に張り出し、見えている坂の面の約1〜2割(合計約90点/1200点)が歩けなかった。
//  - 歩ける幅(width*0.45)・見た目の幅(広間の切り欠きの幅)・側面の壁(別の判定関数)が別々に決まり、坂ごとに食い違っていた。
//  - 坂の端の外や縁石の外でも、通路の中心線までの距離で「坂の高さ」が返っていた。
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const Shared = require('../public/shared.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'public/index.html'), 'utf8');
let failures = 0;
function check(name, ok, detail = '') { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + detail)); if (!ok) failures++; }

// ---------- 1. 配置: 坂が裂け目に張り出さず、両端が同じ高さの床につながる ----------
const ravine = (x, z) => Math.abs(z + 83) < 4.55 && Math.abs(x) < 38;
function floorsExcluding(areas, variant, x, z, g) {
  const ys = [];
  if (variant !== 'linear' && ravine(x, z)) return ys;
  areas.forEach((a, i) => {
    if (i === g.index) return;
    if (a.type === 'ellipse') {
      const rx = a.rx * .99 - .45, rz = a.rz * .99 - .45;
      if (((x - a.x) / rx) ** 2 + ((z - a.z) / rz) ** 2 > 1) return;
      const own = { floorHoles: (a.floorHoles || []).filter(h => !(h.type === 'corridor' && h.ax === g.ax && h.az === g.az && h.bx === g.bx && h.bz === g.bz)) };
      if (Shared.rogueFloorHoleContainsPoint(own, x, z)) return;
      ys.push(a.floorY || 0);
    } else if (a.type === 'segment' && Math.abs((a.yB || 0) - (a.yA || 0)) < 1e-5) {
      const dx = a.bx - a.ax, dz = a.bz - a.az, L = Math.hypot(dx, dz), al = ((x - a.ax) * dx + (z - a.az) * dz) / L, la = ((x - a.ax) * dz - (z - a.az) * dx) / L;
      if (al >= 0 && al <= L && Math.abs(la) <= a.width * (variant === 'linear' ? .5 : .45)) ys.push(a.yA || 0);
    }
  });
  return ys;
}
for (const variant of ['classic', 'linear']) {
  const areas = Shared.getRogueDungeonDefinition(variant).areas;
  for (const g of Shared.getRogueRamps(areas)) {
    const tag = `${variant} 坂 ${g.ax},${g.az} → ${g.bx},${g.bz}`;
    const nx = g.uz, nz = -g.ux;
    let over = 0, badStart = 0, badEnd = 0;
    for (let s = 0; s <= g.L; s += .5) for (let lat = -g.hvis; lat <= g.hvis + 1e-9; lat += .5) {
      if (variant !== 'linear' && ravine(g.ax + g.ux * s + nx * lat, g.az + g.uz * s + nz * lat)) over++;
    }
    for (let lat = -g.hwalk; lat <= g.hwalk + 1e-9; lat += .25) {
      // 辺そのもの(広間の床の切り欠きは辺の線上まで含む)ではなく、辺のすぐ外側0.3mで、隣り合う床が同じ高さで続くことを見る。
      const sx = g.ax - g.ux * .3 + nx * lat, sz = g.az - g.uz * .3 + nz * lat, ex = g.bx + g.ux * .3 + nx * lat, ez = g.bz + g.uz * .3 + nz * lat;
      if (!floorsExcluding(areas, variant, sx, sz, g).some(y => Math.abs(y - g.yA) < .05)) badStart++;
      if (!floorsExcluding(areas, variant, ex, ez, g).some(y => Math.abs(y - g.yB) < .05)) badEnd++;
    }
    check(`${tag}: 見た目の坂全体が裂け目の上に張り出さない`, over === 0, `over=${over}`);
    check(`${tag}: 始点の辺の全幅の手前に、同じ高さの床が続く`, badStart === 0, `bad=${badStart}`);
    check(`${tag}: 終点の辺の全幅の先に、同じ高さの床が続く`, badEnd === 0, `bad=${badEnd}`);
    const slope = Math.atan(Math.abs(g.yB - g.yA) / g.L) * 180 / Math.PI;
    check(`${tag}: 勾配が歩きやすい範囲(3〜16度)`, slope >= 3 && slope <= 16, `slope=${slope.toFixed(1)}`);
  }
}

// ---------- 2. 見えている坂の面 = 歩ける面(見た目と判定のずれがない) ----------
for (const variant of ['classic', 'linear']) {
  const areas = Shared.getRogueDungeonDefinition(variant).areas;
  for (const g of Shared.getRogueRamps(areas)) {
    const tag = `${variant} 坂 ${g.ax},${g.az} → ${g.bx},${g.bz}`;
    const nx = g.uz, nz = -g.ux;
    let walkMiss = 0, wallLeak = 0, total = 0;
    for (let s = .3; s <= g.L - .3; s += .5) for (let lat = -g.hvis; lat <= g.hvis + 1e-9; lat += .2) {
      const x = g.ax + g.ux * s + nx * lat, z = g.az + g.uz * s + nz * lat;
      const c = Shared.getRogueDungeonFloorCandidates(x, z, 3, variant), ramp = c.find(k => k.kind === 'ramp' && k.area === g.area);
      const walk = Shared.isRogueDungeonWalkable(x, z, 3, variant);
      total++;
      if (Math.abs(lat) <= g.hwalk - 1e-6) { if (!ramp || !walk) walkMiss++; }
      else if (Math.abs(lat) >= g.hwalk + 1e-6 && ramp) wallLeak++;
    }
    check(`${tag}: 歩ける半幅の内側はすべて坂の面に立てる (${total}点)`, walkMiss === 0, `miss=${walkMiss}`);
    check(`${tag}: 歩ける半幅の外側(壁)は坂の面として立てない`, wallLeak === 0, `leak=${wallLeak}`);
    // 面の高さ: 床候補・rogueFloorHeight(下で確認)・描画で同じ式。
    let worst = 0;
    for (let k = 0; k <= 30; k++) {
      const t = k / 30, x = g.ax + (g.bx - g.ax) * t, z = g.az + (g.bz - g.az) * t;
      const y = Shared.getRogueRampSurfaceHeight(x, z, variant);
      worst = Math.max(worst, Math.abs(y - (g.yA + (g.yB - g.yA) * t)));
    }
    check(`${tag}: 面の高さが始点〜終点の直線補間と一致`, worst < 1e-9, `worst=${worst}`);
  }
}

// ---------- 3. 実際の移動検証(index.html の関数)で両端は通れ、側面は壁 ----------
function extractBetween(a, b, from = 0) { const i = html.indexOf(a, from), j = html.indexOf(b, i); if (i < 0 || j < i) throw new Error('not found: ' + a); return [html.slice(i, j), j]; }
function makeWorld(variant) {
  const [helpers, helperEnd] = extractBetween('  const CLASSIC_ROGUE_DUNGEON_INDEX = Shared.ROGUE_DUNGEON_INDEX;', '  // 岩の中心線だけでなく');
  const [move] = extractBetween('  function rogueDungeonMovePathAllowed(', '  function constrainRogueDungeonPosition(', helperEnd);
  const ctx = { Shared, Math, Number, rogueRun: { openGates: 3 }, grounded: true, player: { position: { y: 0 } }, THREE: { MathUtils: { clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) } } };
  vm.runInNewContext(helpers + move + `\nglobalThis.__w={setActiveRogueDungeon,rogueFloorHeight,rogueDungeonMovePathAllowed,rogueFloorCandidatesAt,rogueChooseConnectedFloor};`, ctx, { timeout: 2000 });
  ctx.__w.setActiveRogueDungeon(variant === 'linear' ? Shared.ROGUE_LINEAR_DUNGEON_INDEX : Shared.ROGUE_DUNGEON_INDEX);
  return { w: ctx.__w, ctx };
}
for (const variant of ['classic', 'linear']) {
  const { w, ctx } = makeWorld(variant);
  const areas = Shared.getRogueDungeonDefinition(variant).areas;
  for (const g of Shared.getRogueRamps(areas)) {
    const tag = `${variant} 坂 ${g.ax},${g.az} → ${g.bx},${g.bz}`;
    const nx = g.uz, nz = -g.ux;
    const P = (s, lat) => ({ x: g.ax + g.ux * s + nx * lat, z: g.az + g.uz * s + nz * lat });
    // 3a. 床から入って反対側の床まで、横位置を変えて歩き通せる(1歩の長さを変えて走り・低fpsも)。
    let routeFail = 0, routes = 0;
    for (const step of [.1, .3, .8, 1.5]) for (let lat = -g.hwalk + .15; lat <= g.hwalk - .14; lat += .5) {
      for (const dir of [1, -1]) {
        let s = dir > 0 ? -1.5 : g.L + 1.5, y = dir > 0 ? g.yA : g.yB;
        const end = dir > 0 ? g.L + 1.5 : -1.5;
        ctx.rogueRun.playerFloorSurfaceId = null; routes++;
        let ok = true, guard = 0;
        while ((dir > 0 ? s < end : s > end) && guard++ < 400) {
          const ns = dir > 0 ? Math.min(end, s + step) : Math.max(end, s - step);
          const a = P(s, lat), b = P(ns, lat);
          ctx.player.position.y = y;
          if (!w.rogueDungeonMovePathAllowed(a.x, a.z, b.x, b.z, 3, y, false)) { ok = false; break; }
          // 実際のゲームと同じく、足元の高さから連続する床を選んで次の足元の高さにする(高台と広間が重なる所で床を取り違えない)。
          const fl = w.rogueChooseConnectedFloor(w.rogueFloorCandidatesAt(b.x, b.z, 3), y, y, false, ctx.rogueRun.playerFloorSurfaceId);
          if (!fl) { ok = false; break; }
          y = fl.y; ctx.rogueRun.playerFloorSurfaceId = fl.id; s = ns;
        }
        if (!ok) { routeFail++; if (process.env.DEBUG_RAMP) console.log('  route fail', tag, 'step', step, 'lat', lat.toFixed(2), 'dir', dir, 's', s.toFixed(2), 'y', y.toFixed(3)); }
      }
    }
    check(`${tag}: 両端から横位置・歩幅を変えて反対側の床まで通り抜けられる (${routes}通り)`, routeFail === 0, `fail=${routeFail}`);
    // 3b. 側面は壁: 外の床から坂の面へ、坂の面から外の床へ、どの位置でも横には出入りできない。
    let leak = 0, tried = 0;
    for (let s = 1; s <= g.L - 1; s += 1.5) for (const sign of [-1, 1]) for (const fy of [null]) {
      const outer = P(s, sign * (g.hbody + .8)), inner = P(s, sign * (g.hwalk - .6));
      const surf = Shared.getRogueRampSurfaceHeight(inner.x, inner.z, variant);
      for (const [from, to, y] of [[outer, inner, w.rogueFloorHeight(outer.x, outer.z)], [inner, outer, surf]]) {
        if (!Shared.isRogueDungeonWalkable(from.x, from.z, 3, variant)) continue; // 外側が歩けない場所(奈落の縁など)は対象外
        for (const airborne of [false, true]) {
          ctx.rogueRun.playerFloorSurfaceId = null; ctx.player.position.y = y; ctx.grounded = !airborne; tried++;
          if (w.rogueDungeonMovePathAllowed(from.x, from.z, to.x, to.z, 3, y, airborne)) leak++;
        }
      }
    }
    ctx.grounded = true;
    check(`${tag}: 側面からの出入りは歩き・空中とも壁で止まる (${tried}通り)`, leak === 0, `leak=${leak}`);
  }
}

// ---------- 4. 描画・敵配置の高さも同じ矩形 ----------
{
  const { w } = makeWorld('classic');
  const g = Shared.getRogueRamps(Shared.ROGUE_WALK_AREAS)[0];
  const mid = { x: (g.ax + g.bx) / 2, z: (g.az + g.bz) / 2 };
  check('rogueFloorHeight は坂の中央で面の高さ(始点と終点の中間)を返す', Math.abs(w.rogueFloorHeight(mid.x, mid.z) - (g.yA + g.yB) / 2) < 1e-9);
  const beyond = { x: g.ax - g.ux * 3, z: g.az - g.uz * 3 };
  check('坂の始点の外側(広間の床)では坂の高さを返さず、広間の床の高さを返す', Math.abs(w.rogueFloorHeight(beyond.x, beyond.z) - g.yA) < 1e-9);
}
check('旧実装の中心線距離による坂の高さ判定(width*factor で端の外まで拾う処理)は残っていない', !/d<=a\.width\*segmentFactor&&\(!best\|\|d<best\.d\)\) best=\{d,y:\(a\.yA\|\|0\)\+/.test(html));
check('index.html は共有の坂の定義(getRogueRamps)を描画の幅に使っている', /Shared\.rogueRampSlotWidth\(a,areas\)/.test(html) && /Shared\.getRogueRampSurfaceHeight\(/.test(html));
check('坂専用の移動の特例(側面侵入フラグ・軸合わせ候補)は移動検証から取り除かれている', !/rampSideEntryBlocked/.test(html) && !/rogueAlignedRampCandidate/.test(html));
if (failures) { console.error(`${failures} test(s) failed`); process.exit(1); }
console.log('ALL PASSED');
