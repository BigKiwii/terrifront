(function () {
  'use strict';

  const OFFLINE_GAME_ID = 'offline-game';
  const HUMAN_ID = 'player-1';
  let worker = null;
  let workerObjectUrl = null;
  let running = false;

  let startResolve = null;
  let startReject = null;

  // Preload map binaries as soon as the coordinator is parsed so they are
  // already in memory (and the browser HTTP cache) when the player clicks Play.
  // This eliminates the terrain-fetch delay during the spawn phase on Railway.
  // On file: protocol, embedded globals are used instead — no fetch needed.
  const preload = {};
  if (window.location.protocol !== 'file:') {
    const origin = window.location.origin;
    fetch(`${origin}/map/map.bin`).then((r) => r.ok ? r.arrayBuffer() : null).then((buf) => {
      if (buf) preload.terrain = new Uint8Array(buf);
    }).catch(() => {});
    fetch(`${origin}/map/expansion-times.bin`).then((r) => r.ok ? r.arrayBuffer() : null).then((buf) => {
      if (buf) preload.expansionTimes = new Uint8Array(buf);
    }).catch(() => {});
  }

  function stop() {
    if (worker) worker.terminate();
    if (workerObjectUrl) window.URL.revokeObjectURL(workerObjectUrl);
    worker = null;
    workerObjectUrl = null;
    startResolve = null;
    startReject = null;
    running = false;
  }

  function handleWorkerMessage(event) {
    const message = event.data || {};
    switch (message.type) {
      case 'START_READY':
        running = true;
        TerriGameUI.start(message.payload.map);
        TerriGameUI.beginSpawnPhase(message.payload.spawnPhase);
        startResolve?.();
        startResolve = null;
        startReject = null;
        break;
      case 'SPAWN_CONFIRMED':
        TerriGameUI.confirmSpawn(message.payload);
        break;
      case 'ACTIVE_GAME':
        TerriGameUI.startActiveGame({ ...message.payload, changesBuf: message.changesBuf });
        break;
      case 'UPDATE':
        TerriGameUI.applyGameUpdate({ ...message.payload, changesBuf: message.changesBuf });
        break;
      case 'NUKE_LAUNCHED':
        TerriGameUI.startNukeAnimation(message.payload);
        break;
      case 'EXPANSION_REJECTED':
      case 'BOAT_REJECTED':
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

  function start(playerName) {
    if (!window.Worker) return Promise.reject(new Error('Offline game workers are unavailable'));
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
      // Resolve terrain: embedded globals (file: protocol) → preloaded buffer →
      // null (worker will fetch). Convert Uint8Array to base64 string so the
      // worker can decode it without a structuredClone of the underlying buffer
      // (which would transfer ownership and break the preload cache).
      function encodeBytes(bytes) {
        if (!bytes) return null;
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
      }
      const terrainPayload = isFile
        ? window.TerriEmbeddedTerrain
        : (preload.terrain ? encodeBytes(preload.terrain) : null);
      const expansionTimesPayload = isFile
        ? window.TerriEmbeddedExpansionTimes
        : (preload.expansionTimes ? encodeBytes(preload.expansionTimes) : null);
      worker.postMessage({
        type: 'START',
        playerName,
        width: window.TerriMapWidth,
        height: window.TerriMapHeight,
        assetBaseUrl: isFile ? 'http://localhost:8080' : window.location.origin,
        terrain: terrainPayload,
        expansionTimes: expansionTimesPayload
      });
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
