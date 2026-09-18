const test = require('node:test');
const assert = require('node:assert/strict');
const { createMap, cloneMap } = require('../backend/game-logic/map-generator');
const TerritoryManager = require('../backend/game-logic/territory-manager');
const GameEngine = require('../backend/game-master-main/game-engine');
const {
  NUKE_RADIUS,
  createWasteland,
  getImpactCells,
  applyNukeImpact
} = require('../backend/game-logic/nukes');

function createLandMap(width = 50, height = 50) {
  return createMap(new Uint8Array(width * height).fill(0x80), width, height, new Uint8Array(width * height).fill(50));
}

test('map clones share immutable topology but isolate ownership', () => {
  const source = createLandMap(20, 20);
  const clone = cloneMap(source);
  assert.notEqual(clone.owners, source.owners);
  assert.equal(clone.topology, source.topology);
  assert.equal(clone.terrain, source.terrain);
  assert.equal(clone.expansionTimes, source.expansionTimes);
  assert.equal(clone.getNeighbors(21), source.getNeighbors(21));
  clone.owners[21] = 7;
  assert.equal(source.owners[21], 0);
});

test('nuke impact is a clipped land-only circle', () => {
  const map = createLandMap(80, 80);
  const center = 40 * map.width + 40;
  const cells = getImpactCells(map, center);
  assert.equal(cells.length, 2821);
  assert.ok(cells.every((position) => {
    const x = position % map.width;
    const y = Math.floor(position / map.width);
    return (x - 40) ** 2 + (y - 40) ** 2 <= NUKE_RADIUS ** 2;
  }));

  const edgeCells = getImpactCells(map, 0);
  assert.ok(edgeCells.length < cells.length);
  assert.ok(edgeCells.every((position) => position >= 0 && position < map.cellCount));
});

test('nuke clears ownership, applies proportional troop loss, and is idempotent', () => {
  const map = createLandMap(100, 100);
  const territory = new TerritoryManager(map);
  const players = new Map([['player-1', { playerId: 'player-1', troops: 1000 }]]);
  const owned = [];
  for (let y = 20; y < 80; y += 1) {
    for (let x = 20; x < 80; x += 1) {
      const position = y * map.width + x;
      map.owners[position] = 1;
      owned.push(position);
    }
  }
  territory.registerOwner(1, owned);
  const wasteland = createWasteland(map.cellCount);
  const impact = applyNukeImpact({
    map,
    territory,
    players,
    wasteland,
    targetPosition: 50 * map.width + 50
  });
  const destroyed = impact.ownerChanges.length;
  assert.ok(destroyed > 0 && destroyed < owned.length);
  assert.equal(impact.wastelandChanges.length, getImpactCells(map, 50 * map.width + 50).length);
  assert.equal(territory.getTerritorySize(1), owned.length - destroyed);
  assert.equal(players.get('player-1').troops, 1000 - Math.floor(1000 * destroyed / owned.length));
  assert.ok(impact.troopLosses[0].troopsLost >= 0);

  const repeated = applyNukeImpact({
    map,
    territory,
    players,
    wasteland,
    targetPosition: 50 * map.width + 50
  });
  assert.equal(repeated.ownerChanges.length, 0);
  assert.equal(repeated.wastelandChanges.length, 0);
});

test('game engine resolves a launched nuke on its authoritative tick', async () => {
  const map = createLandMap(50, 50);
  const engine = new GameEngine('nuke-test', map);
  await engine.addPlayer('Tester', 'player-1');
  engine.startSpawnPhase(100000);
  assert.equal(engine.selectSpawn('player-1', 25 * map.width + 25).accepted, true);
  engine.finalizeSpawnPhase();

  const launch = engine.requestNuke('player-1', 30 * map.width + 30);
  assert.equal(launch.accepted, true);
  const beforeImpact = engine.tick(Date.now());
  assert.equal(beforeImpact, null);
  const impact = engine.tick(Date.now() + launch.durationMs + 1);
  assert.ok(impact.wastelandChanges.length > 0);
  assert.ok(impact.changes.some((change) => change.owner === 0));
});

test('wasteland conquest has a real three-times troop cost', () => {
  const map = createLandMap(20, 20);
  const territory = new TerritoryManager(map);
  const players = new Map([
    ['player-1', { playerId: 'player-1', troops: 100 }]
  ]);
  const owned = [10 * map.width + 9, 10 * map.width + 10];
  map.owners[owned[0]] = 1;
  map.owners[owned[1]] = 1;
  territory.registerOwner(1, owned);
  map.wasteland = new Uint8Array(map.cellCount);
  map.wasteland[10 * map.width + 11] = 1;
  const result = territory.attackTile(10 * map.width + 11, 1, 2, players);
  assert.equal(result.success, false);
  assert.equal(result.attackerLoss, 3);
  const captured = territory.attackTile(10 * map.width + 11, 1, 3, players);
  assert.equal(captured.success, true);
  assert.equal(map.wasteland[10 * map.width + 11], 0);
});

test('nuke queue is bounded per game', async () => {
  const map = createLandMap(50, 50);
  const engine = new GameEngine('nuke-limit-test', map);
  await engine.addPlayer('Tester', 'player-1');
  engine.startSpawnPhase(100000);
  assert.equal(engine.selectSpawn('player-1', 25 * map.width + 25).accepted, true);
  engine.finalizeSpawnPhase();

  assert.equal(engine.requestNuke('player-1', 10).accepted, true);
  assert.equal(engine.requestNuke('player-1', 11).accepted, true);
  assert.equal(engine.requestNuke('player-1', 12).accepted, true);
  assert.deepEqual(engine.requestNuke('player-1', 13), {
    accepted: false,
    reason: 'NUKE_LIMIT_REACHED'
  });
});

test('neutral attacks use one indexed fixed schedule', async () => {
  const map = createLandMap(50, 50);
  const engine = new GameEngine('attack-index-test', map);
  await engine.addPlayer('Tester', 'player-1');
  engine.startSpawnPhase(100000);
  assert.equal(engine.selectSpawn('player-1', 25 * map.width + 25).accepted, true);
  engine.finalizeSpawnPhase();

  const target = 25 * map.width + 28;
  const first = engine.requestExpansion('player-1', target, 100);
  assert.equal(first.accepted, true);
  const attack = engine.expansionManager.neutralAttackByOwner.get('player-1');
  assert.ok(attack);
  assert.equal(engine.expansionManager.attacks.size, 1);
  assert.equal(attack.tileQueue.length, 135);

  const reinforcement = engine.expansionManager.reinforceNeutralAttack('player-1', 100);
  assert.equal(reinforcement.accepted, true);
  assert.equal(reinforcement.attackId, attack.id);
  assert.equal(engine.expansionManager.attacks.size, 1);
  assert.equal(engine.expansionManager.neutralAttackByOwner.get('player-1'), attack);
});

test('random spawn is confirmed before active expansion', async () => {
  const map = createLandMap(50, 50);
  const engine = new GameEngine('random-spawn-test', map);
  await engine.addPlayer('Tester', 'player-1');
  engine.startSpawnPhase(100000);

  const spawn = engine.submitSpawn('player-1', 0xffffffff);
  assert.equal(spawn.accepted, true);
  assert.ok(Number.isInteger(spawn.position));
  assert.ok(Number.isInteger(engine.players.get('player-1').spawnPosition));
  engine.finalizeSpawnPhase();

  const player = engine.players.get('player-1');
  const expansionTarget = player.spawnPosition + 3;
  const expansion = engine.requestExpansion('player-1', expansionTarget, 100);
  assert.equal(expansion.accepted, true);
});
