(function () {
  'use strict';

  const OFFLINE_GAME_ID = 'offline-game';
  const HUMAN_ID = 'player-1';
  let worker = null;
  let workerObjectUrl = null;
  let running = false;

  let startResolve = null;
  let startReject = null;
  let preloadReady = null;
  const PLAYER_STRIDE = 8;
  let playerMetadata = new Map();

  function decodePlayers(buffer) {
    if (!buffer) return [];
    const values = buffer instanceof Int32Array ? buffer : new Int32Array(buffer);
    const players = [];
    for (let offset = 0; offset < values.length; offset += PLAYER_STRIDE) {
      const playerId = `player-${values[offset]}`;
      const flags = values[offset + 3];
      const metadata = playerMetadata.get(playerId) || { playerId };
      players.push({
        ...metadata,
        playerId,
        troops: values[offset + 1],
        territorySize: values[offset + 2],
        isBot: Boolean(flags & 1),
        isAlive: Boolean(flags & 2),
        isWinner: Boolean(flags & 4),
        expansionActive: Boolean(flags & 8),
        spawnPosition: values[offset + 4] < 0 ? null : values[offset + 4]
      });
    }
    for (const player of players) playerMetadata.set(player.playerId, player);
    return players;
  }

  // Preload map binaries as soon as the coordinator is parsed so they are
  // already in memory (and the browser HTTP cache) when the player clicks Play.
  // This eliminates the terrain-fetch delay during the spawn phase on Railway.
  // On file: protocol, embedded globals are used instead — no fetch needed.
  const preload = {};
  if (window.location.protocol !== 'file:') {
    const origin = window.location.origin;
    preloadReady = Promise.all([
      fetch(`${origin}/map/map.bin`).then((r) => r.ok ? r.arrayBuffer() : null).then((buf) => {
        if (buf) preload.terrain = new Uint8Array(buf);
      }).catch(() => {}),
      fetch(`${origin}/map/expansion-times.bin`).then((r) => r.ok ? r.arrayBuffer() : null).then((buf) => {
        if (buf) preload.expansionTimes = new Uint8Array(buf);
      }).catch(() => {})
    ]);
  }

  function stop() {
    if (worker) worker.terminate();
    if (workerObjectUrl) window.URL.revokeObjectURL(workerObjectUrl);
    worker = null;
    workerObjectUrl = null;
    startResolve = null;
    startReject = null;
    playerMetadata = new Map();
    running = false;
  }

  function handleWorkerMessage(event) {
    const message = event.data || {};
    switch (message.type) {
      case 'START_READY':
        running = true;
        playerMetadata = new Map((message.payload.spawnPhase.players || []).map((player) => [player.playerId, player]));
        TerriGameUI.start(message.payload.map);
        TerriGameUI.beginSpawnPhase(message.payload.spawnPhase);
        startResolve?.();
        startResolve = null;
        startReject = null;
        break;
      case 'SPAWN_CONFIRMED':
        {
          const spawn = message.payload || {};
          const existing = playerMetadata.get(spawn.playerId) || { playerId: spawn.playerId };
          playerMetadata.set(spawn.playerId, {
            ...existing,
            ...spawn,
            troops: Math.max(existing.troops || 0, 1000),
            territorySize: spawn.cells?.length || existing.territorySize || 0,
            isAlive: true,
            spawnPosition: spawn.position
          });
        }
        TerriGameUI.confirmSpawn(message.payload);
        break;
      case 'ACTIVE_GAME':
        {
          const activePlayers = decodePlayers(message.playersBuf);
        TerriGameUI.startActiveGame({
          ...message.payload,
          players: activePlayers.length ? activePlayers : [...playerMetadata.values()],
          changesBuf: message.changesBuf
        });
        }
        break;
      case 'UPDATE':
        TerriGameUI.applyGameUpdate({
          ...message.payload,
          players: decodePlayers(message.playersBuf) || [],
          changesBuf: message.changesBuf
        });
        break;
      case 'PERF':
        if (message.payload?.kind === 'offline-tick') {
          console.warn(`Offline simulation tick took ${message.payload.durationMs}ms at tick ${message.payload.tickCount}`);
        }
        break;
      case 'NUKE_LAUNCHED':
        TerriGameUI.startNukeAnimation(message.payload);
        break;
      case 'EXPANSION_REJECTED':
      case 'BOAT_REJECTED':
        TerriGameUI.rejectExpansion(message.payload);
        break;
      case 'NUKE_REJECTED':
        TerriGameUI.rejectExpansion(message.payload);
        break;
      case 'ERROR':
        startReject?.(new Error(message.message || 'Offline game worker failed'));
        startResolve = null;
        startReject = null;
        console.error('Offline game worker failed:', message.message);
        break;
      default:
        break;
    }
  }

  async function start(playerName) {
    if (!window.Worker) return Promise.reject(new Error('Offline game workers are unavailable'));
    if (preloadReady) await preloadReady;
    stop();
    try {
      let workerUrl = window.TerriOfflineWorkerUrl || '/dist/offline-worker.js';
      if (window.location.protocol === 'file:') {
        if (!window.TerriOfflineWorkerSource) throw new Error('Offline game worker source is unavailable');
        workerObjectUrl = window.URL.createObjectURL(new Blob([window.TerriOfflineWorkerSource], { type: 'application/javascript' }));
        workerUrl = workerObjectUrl;
      }
      worker = new Worker(workerUrl);
    } catch (error) {
      return Promise.reject(error);
    }
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (event) => {
      const message = event.message || 'Offline game worker failed';
      startReject?.(new Error(message));
      startResolve = null;
      startReject = null;
      console.error(message);
    };
    return new Promise((resolve, reject) => {
      startResolve = resolve;
      startReject = reject;
      const isFile = window.location.protocol === 'file:';
      const terrainBuf = isFile ? null : (preload.terrain ? preload.terrain.buffer.slice(0) : null);
      const expansionTimesBuf = isFile ? null : (preload.expansionTimes ? preload.expansionTimes.buffer.slice(0) : null);
      function encodeBytes(bytes) {
        if (!bytes) return null;
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
      }
      const terrainPayload = isFile
        ? window.TerriEmbeddedTerrain
        : (preload.terrain ? null : null);
      const expansionTimesPayload = isFile
        ? window.TerriEmbeddedExpansionTimes
        : (preload.expansionTimes ? null : null);
      worker.postMessage({
        type: 'START',
        playerName,
        width: window.TerriMapWidth,
        height: window.TerriMapHeight,
        assetBaseUrl: isFile ? 'http://localhost:8080' : window.location.origin,
        terrain: terrainPayload,
        expansionTimes: expansionTimesPayload,
        terrainBuf,
        expansionTimesBuf
      }, [
        ...(terrainBuf ? [terrainBuf] : []),
        ...(expansionTimesBuf ? [expansionTimesBuf] : [])
      ]);
    });
  }

  function submitSpawn(payload) {
    worker?.postMessage({ type: 'SPAWN', payload });
  }

  function requestExpansion(payload, power) {
    worker?.postMessage({ type: 'EXPAND', payload, power });
  }

  function requestBoat(payload, power) {
    worker?.postMessage({ type: 'BOAT', payload, power });
  }

  function requestNuke(payload) {
    worker?.postMessage({ type: 'NUKE', payload });
  }

  window.TerriOfflineGame = { start, stop, submitSpawn, requestExpansion, requestBoat, requestNuke, isRunning: () => running };

  // Expose preloaded buffers so gameUI.js loadTerrain / loadExpansionTimes can
  // use them directly instead of making a second fetch during the spawn phase.
  Object.defineProperty(window, 'TerriPreloadedTerrain', { get: () => preload.terrain || null, configurable: true });
  Object.defineProperty(window, 'TerriPreloadedExpansionTimes', { get: () => preload.expansionTimes || null, configurable: true });
}());
