(function () {
  'use strict';

  const logic = globalThis.TerriOfflineLogic;
  const OFFLINE_GAME_ID = 'offline-game';
  const HUMAN_ID = 'player-1';
  const SPAWN_DURATION_MS = 10000;
  const TICK_MS = 50;
  let engine = null;
  let tickHandle = null;
  let spawnHandle = null;
  let nextTickAt = 0;

  function decodeBytes(encoded) {
    const binary = atob(encoded || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  // Encode all non-zero owners as a flat Int32Array: [pos0, owner0, pos1, owner1, ...]
  // postMessage with a transferable ArrayBuffer is zero-copy — no structured-clone
  // overhead of serializing hundreds of {position, owner} plain objects.
  function encodeChanges(owners) {
    let count = 0;
    for (let i = 0; i < owners.length; i += 1) { if (owners[i] !== 0) count += 1; }
    const buf = new Int32Array(count * 2);
    let offset = 0;
    for (let i = 0; i < owners.length; i += 1) {
      if (owners[i] !== 0) { buf[offset++] = i; buf[offset++] = owners[i]; }
    }
    return buf;
  }

  // Encode a sparse changes array into a transferable flat Int32Array.
  function encodeChangesList(changes) {
    if (!changes || changes.length === 0) return null;
    const buf = new Int32Array(changes.length * 2);
    for (let i = 0; i < changes.length; i += 1) {
      buf[i * 2] = changes[i].position;
      buf[i * 2 + 1] = changes[i].owner;
    }
    return buf;
  }

  // Encode wasteland changes [{position, value}] as a flat transferable Int32Array.
  function encodeWastelandList(changes) {
    if (!changes || changes.length === 0) return null;
    const buf = new Int32Array(changes.length * 2);
    for (let i = 0; i < changes.length; i += 1) {
      buf[i * 2]     = changes[i].position;
      buf[i * 2 + 1] = changes[i].value != null ? changes[i].value : 1;
    }
    return buf;
  }

  // Encode players as a flat transferable Int32Array — avoids structured-clone
  // of a large array of objects on every tick. String fields (name, color) are
  // already held by the main thread from START_READY/ACTIVE_GAME; only numeric
  // fields change tick-to-tick.
  // Layout per player (8 ints, PLAYER_STRIDE):
  //   [0] numericId  – integer suffix of "player-N"
  //   [1] troops
  //   [2] territorySize
  //   [3] flags  – bit0=isBot, bit1=isAlive, bit2=isWinner, bit3=expansionActive
  //   [4] spawnPosition (-1 if null)
  //   [5..7] reserved 0
  const PLAYER_STRIDE = 8;
  function encodePlayersList(players) {
    if (!players || players.length === 0) return null;
    const buf = new Int32Array(players.length * PLAYER_STRIDE);
    for (let i = 0; i < players.length; i += 1) {
      const p = players[i];
      const base = i * PLAYER_STRIDE;
      buf[base]     = Number(String(p.playerId || '').replace('player-', '')) || 0;
      buf[base + 1] = Math.round(p.troops || 0);
      buf[base + 2] = p.territorySize || 0;
      buf[base + 3] = (p.isBot ? 1 : 0) | (p.isAlive !== false ? 2 : 0) | (p.isWinner ? 4 : 0) | (p.expansionActive ? 8 : 0);
      buf[base + 4] = Number.isInteger(p.spawnPosition) ? p.spawnPosition : -1;
      // reserved
      buf[base + 5] = 0;
      buf[base + 6] = 0;
      buf[base + 7] = 0;
    }
    return buf;
  }

  // Encode boats as a flat transferable Int32Array: [ownerId, position, troops] per boat.
  const BOAT_STRIDE = 3;
  function encodeBoatsList(boats) {
    if (!boats || boats.length === 0) return null;
    const buf = new Int32Array(boats.length * BOAT_STRIDE);
    for (let i = 0; i < boats.length; i += 1) {
      const b = boats[i];
      buf[i * BOAT_STRIDE]     = b.ownerId || 0;
      buf[i * BOAT_STRIDE + 1] = b.position || 0;
      buf[i * BOAT_STRIDE + 2] = Math.round(b.troops || 0);
    }
    return buf;
  }

  function clearTimers() {
    if (tickHandle !== null) clearInterval(tickHandle);
    if (spawnHandle !== null) clearTimeout(spawnHandle);
    tickHandle = null;
    spawnHandle = null;
    nextTickAt = 0;
  }

  async function loadBytes(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load offline map asset ${url}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
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
    // Encode as transferable flat buffer; decoded on the main thread.
    state.changesBuf = encodeChanges(state.owners);
    state.changes = null; // don't send the full owners array or object-array changes
    return state;
  }

  function finalizeSpawn() {
    if (!engine || engine.phase !== 'SPAWNING') return;
    const state = engine.finalizeSpawnPhase();
    if (!state) return;
    const changesBuf   = encodeChanges(state.owners);
    const playersBuf   = encodePlayersList(state.players);
    const wastelandBuf = encodeWastelandList(state.wastelandChanges);
    state.changes         = null;
    state.owners          = null;
    state.players         = null; // sent via playersBuf
    state.wastelandChanges = null; // sent via wastelandBuf
    const transferables = [changesBuf.buffer];
    if (playersBuf)   transferables.push(playersBuf.buffer);
    if (wastelandBuf) transferables.push(wastelandBuf.buffer);
    self.postMessage({ type: 'ACTIVE_GAME', payload: state, changesBuf, playersBuf, wastelandBuf }, transferables);
    nextTickAt = Date.now() + TICK_MS;
    scheduleTick();
  }

  function scheduleTick() {
    if (!engine) return;
    tickHandle = setTimeout(() => {
      if (!engine) return;
      const update = engine.tick();
      if (update) {
        // Encode every per-tick array as a transferable flat typed buffer.
        // This eliminates structured-clone cost for large object arrays (players,
        // boats, wastelandChanges) which was the main source of lag on Railway's
        // single-core containers during the early expansion burst.
        const changesBuf    = encodeChangesList(update.changes);
        const playersBuf    = encodePlayersList(update.players);
        const wastelandBuf  = encodeWastelandList(update.wastelandChanges);
        const boatsBuf      = encodeBoatsList(update.boats);

        // Build a lean scalar-only payload — no object arrays at all.
        const payload = {
          gameId:    update.gameId,
          tickCount: update.tickCount,
          winnerId:  update.winnerId ?? null,
          // activeAttacks omitted: offline mode has no server cancel path
          // (TerriCommunicator.send is a no-op offline), so sending this
          // 200-entry object array every tick is pure waste.
        };

        // Collect all non-null transferable buffers.
        const transferables = [];
        if (changesBuf)   transferables.push(changesBuf.buffer);
        if (playersBuf)   transferables.push(playersBuf.buffer);
        if (wastelandBuf) transferables.push(wastelandBuf.buffer);
        if (boatsBuf)     transferables.push(boatsBuf.buffer);

        self.postMessage(
          { type: 'UPDATE', payload, changesBuf, playersBuf, wastelandBuf, boatsBuf },
          transferables
        );
      }
      nextTickAt += TICK_MS;
      const now = Date.now();
      if (nextTickAt <= now) nextTickAt = now + TICK_MS;
      scheduleTick();
    }, Math.max(0, nextTickAt - Date.now()));
  }

  async function start(message) {
    clearTimers();
    const assetBaseUrl = message.assetBaseUrl || self.location.origin;
    const terrain = message.terrainBuf
      ? new Uint8Array(message.terrainBuf)
      : (message.terrain ? decodeBytes(message.terrain) : await loadBytes(`${assetBaseUrl}/map/map.bin`));
    const expansionTimes = message.expansionTimesBuf
      ? new Uint8Array(message.expansionTimesBuf)
      : (message.expansionTimes ? decodeBytes(message.expansionTimes) : await loadBytes(`${assetBaseUrl}/map/expansion-times.bin`));
    const map = logic.createMap(terrain, message.width, message.height, expansionTimes);
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
    const changesBuf = state.changesBuf; // flat Int32Array from encodeChanges
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
          changesBuf // decoded on main thread; replaces changes object-array
        }
      }
    }, changesBuf ? [changesBuf.buffer] : []);
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
      } else if (message.type === 'NUKE') {
        const result = engine.requestNuke(message.payload.playerId, message.payload.target);
        if (result.accepted) self.postMessage({
          type: 'NUKE_LAUNCHED',
          payload: { ...result, start: result.startPosition, target: result.targetPosition }
        });
      }
    } catch (error) {
      self.postMessage({ type: 'ERROR', message: error.message });
    }
  };
}());