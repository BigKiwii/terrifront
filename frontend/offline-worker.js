(function () {
  'use strict';

  const logic = globalThis.TerriOfflineLogic;
  const OFFLINE_GAME_ID = 'offline-game';
  const HUMAN_ID = 'player-1';
  const SPAWN_DURATION_MS = 10000;
  let engine = null;
  let tickHandle = null;
  let spawnHandle = null;

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
    if (tickHandle !== null) clearInterval(tickHandle);
    if (spawnHandle !== null) clearTimeout(spawnHandle);
    tickHandle = null;
    spawnHandle = null;
  }

  function mapData(playerName, width, height) {
    return {
      gameId: OFFLINE_GAME_ID,
      playerId: HUMAN_ID,
      playerName,
      map: {
        mapId: 'europa-asia-01',
        width,
        height,
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
    self.postMessage({ type: 'ACTIVE_GAME', payload: state });
    tickHandle = setInterval(() => {
      const update = engine.tick();
      if (update) self.postMessage({ type: 'UPDATE', payload: update });
    }, 50);
  }

  async function start(message) {
    clearTimers();
    const map = logic.createMap(
      decodeBytes(message.terrain),
      message.width,
      message.height,
      decodeBytes(message.expansionTimes)
    );
    engine = new logic.GameEngine(OFFLINE_GAME_ID, map);
    await engine.addPlayer(message.playerName, HUMAN_ID, false);
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

    const state = currentState();
    self.postMessage({
      type: 'START_READY',
      payload: {
        map: mapData(message.playerName, message.width, message.height),
        spawnPhase: {
          playerId: HUMAN_ID,
          deadline: Date.now() + SPAWN_DURATION_MS,
          durationMs: SPAWN_DURATION_MS,
          spawnPoints: spawnPhase.spawnPoints,
          players: state.players,
          changes: state.changes
        }
      }
    });
    spawnHandle = setTimeout(finalizeSpawn, SPAWN_DURATION_MS);
  }

  self.onmessage = function (event) {
    const message = event.data || {};
    try {
      if (message.type === 'START') {
        start(message).catch((error) => self.postMessage({ type: 'ERROR', message: error.message }));
        return;
      }
      if (message.type === 'STOP') {
        clearTimers();
        engine = null;
        return;
      }
      if (!engine) return;
      if (message.type === 'SPAWN') {
        const result = engine.submitSpawn(message.payload.playerId, message.payload.position);
        if (result.accepted) self.postMessage({ type: 'SPAWN_CONFIRMED', payload: result });
      } else if (message.type === 'EXPAND') {
        const result = engine.requestExpansion(message.payload.playerId, message.payload.position, message.power);
        if (!result.accepted) self.postMessage({ type: 'EXPANSION_REJECTED', payload: result });
      } else if (message.type === 'BOAT') {
        const result = engine.requestBoat(message.payload.playerId, message.payload.position, message.power);
        if (!result.accepted) self.postMessage({ type: 'BOAT_REJECTED', payload: result });
      }
    } catch (error) {
      self.postMessage({ type: 'ERROR', message: error.message });
    }
  };
}());