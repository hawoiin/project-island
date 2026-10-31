// v70.13: 坂の側面は壁。歩ける半幅(hwalk)から石の躯体(hbody)までは歩けない領域で、
// 坂は両端からだけ出入りできる。側面からは入れも出られもしない。
'use strict';
const Shared = require('../public/shared.js');
let failures = 0;
function check(name, ok, detail='') {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + detail));
  if (!ok) failures++;
}
for (const variant of ['classic','linear']) {
  const areas = Shared.getRogueDungeonDefinition(variant).areas;
  const ramps = Shared.getRogueRamps(areas);
  check(`${variant}: 傾斜通路が共有の地形定義から取得できる`, ramps.length >= 1, `count=${ramps.length}`);
  for (const g of ramps) {
    const tag = `${variant} 坂 ${g.ax},${g.az} → ${g.bx},${g.bz}`;
    const nx = g.uz, nz = -g.ux;
    const at = (s, lat) => ({ x: g.ax + g.ux * s + nx * lat, z: g.az + g.uz * s + nz * lat });
    const mid = g.L * 0.5;
    check(`${tag}: 歩ける半幅は見た目の半幅より狭く、躯体はさらに外側にある`, g.hwalk < g.hvis && g.hvis < g.hbody);
    for (const sign of [-1, 1]) {
      const inside = at(mid, sign * (g.hwalk - 0.1)), wall = at(mid, sign * (g.hwalk + 0.2)), wall2 = at(mid, sign * (g.hvis + 0.15));
      check(`${tag}: 歩ける半幅の内側は歩ける`, Shared.isRogueDungeonWalkable(inside.x, inside.z, 3, variant));
      // 余白の帯は必ず歩けない。縁石の帯は、坂が広間の床へ潜る所(床の切り欠きの縁)なら広間の床の縁として立てる(坂の面より高い床)。
      const rimCands = Shared.getRogueDungeonFloorCandidates(wall2.x, wall2.z, 3, variant), surf2 = Shared.getRogueRampSurfaceHeight(wall2.x, wall2.z, variant, 0.4);
      check(`${tag}: 縁の壁(余白と縁石)の上は歩けない(切り欠きの縁の高い床を除く)`, !Shared.isRogueDungeonWalkable(wall.x, wall.z, 3, variant) && (!Shared.isRogueDungeonWalkable(wall2.x, wall2.z, 3, variant) || rimCands.every(c => c.y > surf2 + 0.06)));
      check(`${tag}: 縁の壁の上には床候補が1つもない`, Shared.getRogueDungeonFloorCandidates(wall.x, wall.z, 3, variant).filter(c => c.y < Shared.getRogueRampSurfaceHeight(wall.x, wall.z, variant) - 0.06).length === 0);
      // 壁を横切る移動(坂の外→内、内→外)は、途中のどこかで歩けない領域を通る。
      const outer = at(mid, sign * (g.hbody + 0.6)), inner = at(mid, sign * (g.hwalk - 0.4));
      let blocked = false;
      for (let k = 0; k <= 60; k++) {
        const x = outer.x + (inner.x - outer.x) * k / 60, z = outer.z + (inner.z - outer.z) * k / 60;
        if (!Shared.isRogueDungeonWalkable(x, z, 3, variant)) { blocked = true; break; }
      }
      check(`${tag}: 側面を横切る経路は壁で必ず止まる`, blocked);
      check(`${tag}: 側面から坂へ入る移動は側面侵入として検出される`, Shared.isRogueRampSideEntryBlocked(outer.x, outer.z, inner.x, inner.z, variant));
    }
    // 端から軸方向への出入りは壁に当たらない。
    const before = at(-0.8, 0), enter = at(0.4, 0), exitFrom = at(g.L - 0.4, 0), after = at(g.L + 0.8, 0);
    check(`${tag}: 端から通路方向への進入は側面侵入として扱わない`, !Shared.isRogueRampSideEntryBlocked(before.x, before.z, enter.x, enter.z, variant));
    check(`${tag}: 通路内を進む移動は側面侵入として扱わない`, !Shared.isRogueRampSideEntryBlocked(enter.x, enter.z, exitFrom.x, exitFrom.z, variant));
    check(`${tag}: 反対の端から出る移動は側面侵入として扱わない`, !Shared.isRogueRampSideEntryBlocked(exitFrom.x, exitFrom.z, after.x, after.z, variant));
    check(`${tag}: 始点と終点の中心は歩ける`, Shared.isRogueDungeonWalkable(before.x, before.z, 3, variant) && Shared.isRogueDungeonWalkable(after.x, after.z, 3, variant));
  }
}
if (failures) { console.error(`${failures} test(s) failed`); process.exit(1); }
else console.log('ALL PASSED');
