// v67.0: the branching prototype is a separate instance; the classic dungeon stays intact.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Shared = require('../public/shared.js');

const classic = Shared.ROGUE_DUNGEON_INDEX;
const linear = Shared.ROGUE_LINEAR_DUNGEON_INDEX;
assert.equal(classic, 2, 'legacy dungeon index must remain stable');
assert.equal(linear, 3, 'new linear dungeon must have its own cave index');
assert.notEqual(classic, linear);
assert.equal(Shared.getRogueDungeonVariant(classic), 'classic');
assert.equal(Shared.getRogueDungeonVariant(linear), 'linear');
assert.equal(Shared.CAVE_SITES.length, 4, 'two existing caves plus two rogue-dungeon entrances');
assert.equal(Shared.getRogueDungeonDefinition('classic').areas, Shared.ROGUE_WALK_AREAS);
assert.equal(Shared.getRogueDungeonDefinition('linear').areas, Shared.ROGUE_LINEAR_WALK_AREAS);
const linearEntrance = Shared.ROGUE_LINEAR_WALK_AREAS[0];
const entranceCut = linearEntrance.floorHoles.find(h => h.type === 'corridor');
const entranceSegment = Shared.ROGUE_LINEAR_WALK_AREAS.find(a => a.type === 'segment' && a.az === 1 && a.bz === -24);
assert(entranceCut && entranceSegment, 'linear entrance floor and first corridor must both be defined');
for (const key of ['ax', 'az', 'bx', 'bz', 'width']) {
  assert.equal(entranceCut[key] || 0, entranceSegment[key] || 0, `entrance floor cutout and visible corridor must match ${key}`);
}
assert.equal(entranceCut.extendStart || 0, 0, 'entrance cutout must not extend past the actual corridor start');
assert.equal(entranceCut.extendEnd || 0, 0, 'entrance cutout must not extend past the actual corridor end');

// Make sure recognizable parts of the old branching dungeon are preserved.
assert.equal(Shared.isRogueDungeonWalkable(0, -83, 3, 'classic'), true, 'classic main bridge remains');
assert.equal(Shared.isRogueDungeonWalkable(8, -83, 3, 'classic'), false, 'classic chasm remains impassable away from the bridge');
assert.equal(Shared.isRogueDungeonWalkable(15, -83, 3, 'classic'), true, 'classic east bridge remains');

// New prototype has two usable routes around a central pit plus two optional side alcoves.
assert.equal(Shared.isRogueDungeonWalkable(0, -82, 3, 'linear'), false, 'central pit must not be treated as a floor');
assert(Shared.isRogueDungeonWalkable(-12, -82, 3, 'linear'), 'west route around the pit remains walkable');
assert(Shared.isRogueDungeonWalkable(12, -82, 3, 'linear'), 'east route around the pit remains walkable');
for (const sideX of [-53, 53]) {
  assert(Shared.isRogueDungeonWalkable(sideX, -82, 3, 'linear'), `side alcove ${sideX} must be walkable`);
  assert(Shared.getRogueDungeonFloorCandidates(sideX, -82, 3, 'linear').length > 0, `side alcove ${sideX} must have an actual floor`);
  assert(Shared.findRogueDungeonPath(0, -83, sideX, -82, 3, 'linear').length > 0, `side alcove ${sideX} must connect to the main hall`);
}
assert.equal(Shared.isRogueDungeonWalkable(0, -100, 0, 'linear'), false, 'the closed gate must still block the main route');
assert.equal(Shared.findRogueDungeonPath(0, -83, 0, -120, 0, 'linear').length, 0, 'the side alcoves must not bypass a closed gate');

function checkDenseLinearRoute(startZ, endZ, gates) {
  const direction = endZ < startZ ? -1 : 1;
  for (let z = startZ; direction < 0 ? z >= endZ - 1e-9 : z <= endZ + 1e-9; z += direction * 0.1) {
    const zz = Math.round(z * 1000) / 1000;
    assert(Shared.isRogueDungeonWalkable(0, zz, gates, 'linear'), `linear route not walkable at z=${zz}`);
    assert(Shared.getRogueDungeonFloorCandidates(0, zz, gates, 'linear').length > 0,
      `linear route has no actual floor candidate at z=${zz}`);
  }
}
checkDenseLinearRoute(5.5, -54, 0);   // spawn to just before first gate
// The new central pit intentionally interrupts the centerline, so use the pathfinder route for the full traversal.
const plannedRoute = Shared.findRogueDungeonPath(0, 5.5, 0, -199, 3, 'linear');
assert(plannedRoute.length > 0, 'pathfinder must connect the entrance to the boss chamber around the pit');
let routeFrom = {x:0,z:5.5};
for (const routeTo of plannedRoute) {
  const distance = Math.hypot(routeTo.x-routeFrom.x, routeTo.z-routeFrom.z);
  const samples = Math.max(1, Math.ceil(distance/0.1));
  for (let i=0;i<=samples;i++) {
    const t=i/samples, x=routeFrom.x+(routeTo.x-routeFrom.x)*t, z=routeFrom.z+(routeTo.z-routeFrom.z)*t;
    assert(Shared.isRogueDungeonWalkable(x,z,3,'linear'), `planned route has a non-walkable point at ${x.toFixed(2)},${z.toFixed(2)}`);
    assert(Shared.getRogueDungeonFloorCandidates(x,z,3,'linear').length > 0, `planned route has no floor at ${x.toFixed(2)},${z.toFixed(2)}`);
  }
  routeFrom = routeTo;
}

// Exercise the same active-variant helpers used by client-side movement/camera logic.
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const helperStart = html.indexOf('  const CLASSIC_ROGUE_DUNGEON_INDEX = Shared.ROGUE_DUNGEON_INDEX;');
const helperEnd = html.indexOf('  function buildRogueDungeonInterior(){', helperStart);
const moveStart = html.indexOf('  function rogueDungeonMovePathAllowed(', helperEnd);
const moveEnd = html.indexOf('  function constrainRogueDungeonPosition(', moveStart);
assert(helperStart >= 0 && helperEnd > helperStart && moveStart > helperEnd && moveEnd > moveStart, 'variant-aware client floor/movement helpers must exist');
const helperSource = html.slice(helperStart, helperEnd) + html.slice(moveStart, moveEnd) + `
  globalThis.__clientFloorTest = {
    setActiveRogueDungeon,
    get variant(){ return ROGUE_DUNGEON_VARIANT; },
    get areas(){ return ROGUE_WALK_AREAS; },
    isRogueWalkable,
    rogueFloorCandidatesAt,
    rogueFloorHeight,
    rogueDungeonMovePathAllowed
  };
`;
const vmContext = {
  Math, Number, Shared, rogueRun: { openGates: 0, playerFloorSurfaceId: null }, grounded: true,
  player: { position: { x: 0, y: 0, z: 5.5 } },
  THREE: { MathUtils: { clamp: (v, min, max) => Math.min(max, Math.max(min, v)) } }
};
vm.runInNewContext(helperSource, vmContext, { timeout: 1000 });
const clientFloor = vmContext.__clientFloorTest;
clientFloor.setActiveRogueDungeon(linear);
assert.equal(clientFloor.variant, 'linear');
assert.equal(clientFloor.areas.length, Shared.ROGUE_LINEAR_WALK_AREAS.length);
let clientRouteFrom = {x:0,z:5.5};
for (const routeTo of plannedRoute) {
  const distance = Math.hypot(routeTo.x-clientRouteFrom.x, routeTo.z-clientRouteFrom.z);
  const samples = Math.max(1, Math.ceil(distance/0.1));
  for(let i=0;i<=samples;i++) {
    const t=i/samples, x=clientRouteFrom.x+(routeTo.x-clientRouteFrom.x)*t, z=clientRouteFrom.z+(routeTo.z-clientRouteFrom.z)*t;
    assert(clientFloor.isRogueWalkable(x, z, 3), `client movement says planned route blocked at ${x.toFixed(2)},${z.toFixed(2)}`);
    assert(clientFloor.rogueFloorCandidatesAt(x, z, 3).length > 0, `client physics has no floor at ${x.toFixed(2)},${z.toFixed(2)}`);
  }
  clientRouteFrom = routeTo;
}
assert(Math.abs(clientFloor.rogueFloorHeight(0, -112) - (-0.6)) < 0.08, 'linear ramp height must interpolate');
assert(Math.abs(clientFloor.rogueFloorHeight(0, -145) - (-1.2)) < 0.08, 'linear lower chamber height must remain flat');
// Exercise the actual movement-path checker, not only the geometric walkability function.
let moveZ = 5.5;
clientFloor.setActiveRogueDungeon(linear);
vmContext.rogueRun.openGates = 0;
vmContext.rogueRun.playerFloorSurfaceId = null;
while (moveZ > -54 + 1e-4) {
  const nextZ = Math.max(-54, moveZ - 0.2);
  const footY = clientFloor.rogueFloorHeight(0, moveZ);
  assert(clientFloor.rogueDungeonMovePathAllowed(0, moveZ, 0, nextZ, 0, footY, false),
    `actual movement-path checker rejected the first-room approach at z=${moveZ.toFixed(2)} to ${nextZ.toFixed(2)}`);
  moveZ = nextZ;
}
assert.equal(clientFloor.isRogueWalkable(0, -56, 0), false, 'first seal gate remains closed until progress advances');
vmContext.rogueRun.openGates = 3;
vmContext.rogueRun.playerFloorSurfaceId = null;
let movementFrom = {x:0,z:5.5};
for (const waypoint of plannedRoute) {
  const distance = Math.hypot(waypoint.x-movementFrom.x, waypoint.z-movementFrom.z);
  const steps = Math.max(1, Math.ceil(distance/0.2));
  for (let i=1;i<=steps;i++) {
    const t=i/steps, nextX=movementFrom.x+(waypoint.x-movementFrom.x)*t, nextZ=movementFrom.z+(waypoint.z-movementFrom.z)*t;
    const footY = clientFloor.rogueFloorHeight(movementFrom.x, movementFrom.z);
    assert(clientFloor.rogueDungeonMovePathAllowed(movementFrom.x, movementFrom.z, nextX, nextZ, 3, footY, false),
      `actual movement checker rejected route ${movementFrom.x.toFixed(2)},${movementFrom.z.toFixed(2)} -> ${nextX.toFixed(2)},${nextZ.toFixed(2)}`);
    movementFrom = {x:nextX,z:nextZ};
  }
}
// Exercise actual client movement through both side alcoves, not only shared server geometry.
for (const sideX of [-53, 53]) {
  const path = Shared.findRogueDungeonPath(0, -75, sideX, -82, 3, 'linear');
  assert(path.length > 0, `navigation path into side alcove ${sideX} is missing`);
  let from = {x:0,z:-75};
  vmContext.rogueRun.playerFloorSurfaceId = null;
  for (const waypoint of path) {
    const distance = Math.hypot(waypoint.x-from.x, waypoint.z-from.z);
    const steps = Math.max(1, Math.ceil(distance/0.2));
    for (let i=1;i<=steps;i++) {
      const t=i/steps, to={x:from.x+(waypoint.x-from.x)*t,z:from.z+(waypoint.z-from.z)*t};
      const footY=clientFloor.rogueFloorHeight(from.x,from.z);
      assert(clientFloor.rogueDungeonMovePathAllowed(from.x,from.z,to.x,to.z,3,footY,false),
        `client movement could not enter side alcove ${sideX} near ${to.x.toFixed(2)},${to.z.toFixed(2)}`);
      from=to;
    }
  }
}
clientFloor.setActiveRogueDungeon(classic);
assert.equal(clientFloor.variant, 'classic');
assert(Math.abs(clientFloor.rogueFloorHeight(0, -159) - (-3.3)) < 0.12, 'switching back to classic must restore its old ramp height');

const classicLayout = Shared.getRogueDungeonLayout(123456, 'classic');
const classicLayoutAgain = Shared.getRogueDungeonLayout(123456, 'classic');
const linearLayout = Shared.getRogueDungeonLayout(123456, 'linear');
assert.deepEqual(classicLayout, classicLayoutAgain, 'classic layout remains deterministic');
assert.notDeepEqual(classicLayout.enemies.map(e => [e.x, e.z]), linearLayout.enemies.map(e => [e.x, e.z]), 'layout is variant-specific');
for (const [variant, layout] of [['classic', classicLayout], ['linear', linearLayout]]) {
  assert(layout.enemies.length > 0 && layout.chests.length === (variant === 'linear' ? 7 : 5) && layout.boss);
  for (const obj of [...layout.enemies, ...layout.chests, layout.boss]) {
    assert(Shared.isRogueDungeonWalkable(obj.x, obj.z, 4, variant), `${variant} object outside walkable ground: ${obj.id || obj.kind}`);
    assert(Shared.getRogueDungeonFloorCandidates(obj.x, obj.z, 4, variant).length > 0,
      `${variant} object has no floor candidate: ${obj.id || obj.kind}`);
  }
}

// Server-level isolation: same party code must not merge the classic and linear dungeons.
const sim = new Shared.WorldSim({ seed: 770066 });
const sent = [];
sim.out = {
  sendTo(id, msg) { sent.push({ to: id, msg }); },
  broadcast(msg, except) { for (const id of sim.clients.keys()) if (id !== except) sent.push({ to: id, msg }); }
};
function enterDungeon(id, variant, code) {
  sim.addClient(id);
  sim.handle(id, { t: 'join', name: `Player${id}`, key: `v66-test-player-${id}` });
  sim.handle(id, { t: 'roguePartySelect', mode: 'join', code, dungeonType: variant });
  const caveIndex = variant === 'linear' ? linear : classic;
  const site = Shared.CAVE_SITES[caveIndex];
  const mouth = { x: site.x + site.dirX * Shared.CAVE_MOUTH_OFFSET, z: site.z + site.dirZ * Shared.CAVE_MOUTH_OFFSET };
  sim.handle(id, { t: 'state', x: mouth.x, y: Shared.islandHeight(mouth.x, mouth.z), z: mouth.z, ry: 0, cave: -1, f: 0 });
  sim.handle(id, { t: 'state', x: Shared.CAVE_INTERIOR_ENTRY.x, y: 0, z: Shared.CAVE_INTERIOR_ENTRY.z, ry: 0, cave: caveIndex, f: 0 });
  const room = sim.getRogueRoomForClient(id);
  assert(room, `player ${id} did not enter their ${variant} dungeon room`);
  return room;
}
const classicRoom = enterDungeon(801, 'classic', 'SAME66');
const linearRoom = enterDungeon(802, 'linear', 'SAME66');
const linearRoomMate = enterDungeon(803, 'linear', 'SAME66');
assert.notEqual(classicRoom.id, linearRoom.id, 'cross-variant party-code reuse must not join the old dungeon room');
assert.equal(classicRoom.dungeonType, 'classic');
assert.equal(linearRoom.dungeonType, 'linear');
assert.equal(sim.getRogueRoomForClient(803).id, linearRoom.id, 'same linear party code should share the linear room');
assert.equal(linearRoom.members.size, 2);
assert.equal(classicRoom.members.size, 1);
const linearJoinMsg = sent.findLast(x => x.to === 802 && x.msg.t === 'rogueRoomJoined');
assert(linearJoinMsg && linearJoinMsg.msg.dungeonType === 'linear', 'room snapshot exposes the variant');

console.log('PASS v67.0 keeps classic dungeon and adds an isolated branching dungeon');
console.log('PASS branching route, both pit bypasses, side alcoves and floor candidates are connected');
console.log('PASS layouts, parties, optional branch enemies/chests and room snapshots remain variant-specific');
