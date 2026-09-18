(function () {
  'use strict';

  const OFFLINE_GAME_ID = 'offline-game';
  const HUMAN_ID = 'player-1';
  let worker = null;
  let workerObjectUrl = null;
  let running = false;

  let startResolve = null;
  let startReject = null;

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
      worker.postMessage({
        type: 'START',
        playerName,
        width: window.TerriMapWidth,
        height: window.TerriMapHeight,
        assetBaseUrl: window.location.protocol === 'file:' ? 'http://localhost:8080' : window.location.origin,
        terrain: window.location.protocol === 'file:' ? window.TerriEmbeddedTerrain : null,
        expansionTimes: window.location.protocol === 'file:' ? window.TerriEmbeddedExpansionTimes : null
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
}());
