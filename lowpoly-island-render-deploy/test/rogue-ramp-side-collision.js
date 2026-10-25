// v65: 唯一の傾斜通路で側面侵入を防ぎ、端からの出入りを許可する。
'use strict';
const Shared=require('../public/shared.js');
let failures=0;
function check(name,ok,detail=''){console.log((ok?'PASS ':'FAIL ')+name+(ok?'':' '+detail));if(!ok)failures++;}
const ramps=Shared.ROGUE_WALK_AREAS.filter(a=>a.type==='segment'&&Math.abs((a.yB||0)-(a.yA||0))>1e-5);
check('高さが変わる通路は主経路に1本だけある',ramps.length===1,`count=${ramps.length}`);
for(const a of ramps){
 const dx=a.bx-a.ax,dz=a.bz-a.az,len=Math.hypot(dx,dz),ux=dx/len,uz=dz/len,nx=uz,nz=-ux,cx=(a.ax+a.bx)/2,cz=(a.az+a.bz)/2,limit=a.width*.45;
 const from={x:cx+nx*(limit+.3),z:cz+nz*(limit+.3)},to={x:cx+nx*(limit-.3),z:cz+nz*(limit-.3)};
 check('坂の側面からの侵入を止める',Shared.isRogueRampSideEntryBlocked(from.x,from.z,to.x,to.z));
 check('坂から隣の床へ出る動きは遮断しない',!Shared.isRogueRampSideEntryBlocked(to.x,to.z,from.x,from.z));
 check('坂の端から軸方向へ進入できる',!Shared.isRogueRampSideEntryBlocked(a.ax-ux*.8,a.az-uz*.8,a.ax+ux*.4,a.az+uz*.4));
 check('中央広間の側から坂入口に歩いて接続できる',Shared.isRogueDungeonWalkable(0,-103,3)&&Shared.isRogueDungeonWalkable(0,-105,3));
}
if(failures){console.error(`${failures} test(s) failed`);process.exit(1);}console.log('ALL PASSED');
