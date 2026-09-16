(function () {
  'use strict';

  const logic = window.TerriOfflineLogic;
  const OFFLINE_GAME_ID = 'offline-game';
  const HUMAN_ID = 'player-1';
  const SPAWN_DURATION_MS = 10000;
  let engine = null;
  let tickHandle = null;
  let spawnHandle = null;
  let running = false;

  function decodeBytes(encoded) {
    const binary = atob(encoded || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function ownerChanges(owners) {
    const changes = [];
    for (let position = 0; position < owners.length; position += 1) {
      if (owners[position] !== 0) changes.push({ position, owner: owners[position] });
    }
    return changes;
  }

  function clearTimers() {
    if (tickHandle !== null) window.clearInterval(tickHandle);
    if (spawnHandle !== null) window.clearTimeout(spawnHandle);
    tickHandle = null;
    spawnHandle = null;
  }

  function mapData(playerName) {
    return {
      gameId: OFFLINE_GAME_ID,
      playerId: HUMAN_ID,
      playerName,
      map: {
        mapId: 'europa-asia-01',
        width: window.TerriMapWidth,
        height: window.TerriMapHeight,
        backgroundAsset: 'map/europ-asia-map.webp',
        terrainUrl: '/map/map.bin',
        expansionTimesUrl: '/map/expansion-times.bin'
      }
    };
  }

  function currentState() {
    const state = engine.getState();
    state.changes = ownerChanges(state.owners);
    return state;
  }

  function finalizeSpawn() {
    if (!engine || engine.phase !== 'SPAWNING') return;
    const state = engine.finalizeSpawnPhase();
    if (!state) return;
    state.changes = ownerChanges(state.owners);
    TerriGameUI.startActiveGame(state);
    tickHandle = window.setInterval(() => {
      const update = engine.tick();
      if (update) TerriGameUI.applyGameUpdate(update);
    }, 50);
  }

  async function start(playerName) {
    if (!logic || !window.TerriGameUI) throw new Error('Offline game logic is unavailable');
    stop();
    const terrain = decodeBytes(window.TerriEmbeddedTerrain);
    const expansionTimes = decodeBytes(window.TerriEmbeddedExpansionTimes);
    const map = logic.createMap(terrain, window.TerriMapWidth, window.TerriMapHeight, expansionTimes);
    engine = new logic.GameEngine(OFFLINE_GAME_ID, map);
    await engine.addPlayer(playerName, HUMAN_ID, false);
    const botCount = Math.max(0, logic.BOT_COUNT - 1);
    for (let index = 0; index < botCount; index += 1) {
      await engine.addPlayer(`Bot ${String(index + 1).padStart(3, '0')}`, `player-${index + 2}`, true);
    }

    const spawnPhase = engine.startSpawnPhase(SPAWN_DURATION_MS);
    for (const player of engine.players.values()) {
      if (!player.isBot) continue;
      const position = engine.spawnManager.randomPosition();
      if (position !== null) engine.selectSpawn(player.playerId, position);
    }

    running = true;
    TerriGameUI.start(mapData(playerName));
    const state = currentState();
    TerriGameUI.beginSpawnPhase({
      playerId: HUMAN_ID,
      deadline: Date.now() + SPAWN_DURATION_MS,
      durationMs: SPAWN_DURATION_MS,
      spawnPoints: spawnPhase.spawnPoints,
      players: state.players,
      changes: state.changes
    });
    spawnHandle = window.setTimeout(finalizeSpawn, SPAWN_DURATION_MS);
  }

  function submitSpawn(payload) {
    if (!engine || engine.phase !== 'SPAWNING') return;
    const result = engine.submitSpawn(payload.playerId, payload.position);
    if (result.accepted) TerriGameUI.confirmSpawn(result);
  }

  function requestExpansion(payload, power) {
    if (!engine) return;
    const result = engine.requestExpansion(payload.playerId, payload.position, power);
    if (!result.accepted) TerriGameUI.rejectExpansion(result);
  }

  function requestBoat(payload, power) {
    if (!engine) return;
    const result = engine.requestBoat(payload.playerId, payload.position, power);
    if (!result.accepted) TerriGameUI.rejectExpansion(result);
  }

  function stop() {
    clearTimers();
    engine = null;
    running = false;
  }

  window.TerriOfflineGame = { start, stop, submitSpawn, requestExpansion, requestBoat, isRunning: () => running };
}());
