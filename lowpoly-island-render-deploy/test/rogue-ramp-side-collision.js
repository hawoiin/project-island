// v64.1: 坂の側面から乗り上げる侵入は止め、坂上から地面へ降りる移動は許す。
'use strict';
const Shared = require('../public/shared.js');
let failures = 0;
function check(name, ok, detail='') {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' ' + detail));
  if (!ok) failures++;
}
const ramps = Shared.ROGUE_WALK_AREAS.filter(a => a.type === 'segment' && Math.abs((a.yB||0)-(a.yA||0)) > 1e-5);
check('傾斜通路が共有の地形定義から取得できる', ramps.length >= 3, `count=${ramps.length}`);
for (const a of ramps) {
  const dx=a.bx-a.ax, dz=a.bz-a.az, len=Math.hypot(dx,dz), ux=dx/len, uz=dz/len;
  const nx=uz, nz=-ux, t=0.5, cx=a.ax+dx*t, cz=a.az+dz*t;
  const walkLimit=a.width*0.45;
  const from={x:cx+nx*(walkLimit+0.3),z:cz+nz*(walkLimit+0.3)};
  const to={x:cx+nx*(walkLimit-0.3),z:cz+nz*(walkLimit-0.3)};
  check(`坂 ${a.ax},${a.az} → ${a.bx},${a.bz} は側面からの侵入を止める`,
    Shared.isRogueRampSideEntryBlocked(from.x,from.z,to.x,to.z));
  check('坂の内側から歩行可能な地面へ出る移動は遮断しない',
    !Shared.isRogueRampSideEntryBlocked(to.x,to.z,from.x,from.z));
  const side={x:cx+nx*(walkLimit-0.3),z:cz+nz*(walkLimit-0.3)};
  const inside={x:cx+nx*(walkLimit-0.5),z:cz+nz*(walkLimit-0.5)};
  check('通路内を進んでいる移動は側面衝突扱いしない',
    !Shared.isRogueRampSideEntryBlocked(side.x,side.z,inside.x,inside.z));
  const start={x:a.ax-ux*0.8,z:a.az-uz*0.8}, entry={x:a.ax+ux*0.4,z:a.az+uz*0.4};
  check('坂の端から通路方向への進入は許可する',
    !Shared.isRogueRampSideEntryBlocked(start.x,start.z,entry.x,entry.z));
  // 端の近くでも、横方向に坂へ乗り上げるのは許可しない。
  const endT=Math.min(0.14,1.25/len);
  for (const t of [endT*0.45, 1-endT*0.45]) {
    const ecx=a.ax+dx*t, ecz=a.az+dz*t;
    for (const sign of [-1,1]) {
      const outer={x:ecx+nx*sign*(walkLimit+0.35),z:ecz+nz*sign*(walkLimit+0.35)};
      const inner={x:ecx+nx*sign*(walkLimit-0.25),z:ecz+nz*sign*(walkLimit-0.25)};
      check('坂の端に近い場所でも側面からの侵入は遮断する',Shared.isRogueRampSideEntryBlocked(outer.x,outer.z,inner.x,inner.z));
    }
  }
  if (ramps.indexOf(a) < 2) {
    const rampEdge={x:cx+nx*3.4,z:cz+nz*3.4};
    const groundSide={x:cx+nx*5.2,z:cz+nz*5.2};
    check('坂脇の地面へ出るテスト座標が歩行可能',
      Shared.isRogueDungeonWalkable(rampEdge.x,rampEdge.z,3)&&Shared.isRogueDungeonWalkable(groundSide.x,groundSide.z,3));
    check('歩行可能な坂脇の地面へ横に降りられる',
      !Shared.isRogueRampSideEntryBlocked(rampEdge.x,rampEdge.z,groundSide.x,groundSide.z));
    check('同じ場所で地面側から坂へ乗り上げる移動は引き続き遮断',
      Shared.isRogueRampSideEntryBlocked(groundSide.x,groundSide.z,rampEdge.x,rampEdge.z));
  }
}
if (failures) { console.error(`${failures} test(s) failed`); process.exit(1); }
else console.log('ALL PASSED');
