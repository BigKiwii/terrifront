(function () {
  'use strict';

  const modules = window.TerriGameModules || {};
  const mapGeometry = modules.mapGeometry;
  const colorUtils = modules.colorUtils;
  const gameStore = modules.gameStore;
  if (!mapGeometry || !colorUtils || !gameStore) throw new Error('TerriGameUI modules are not loaded');
  const store = gameStore.createGameStore();
  const renderState = store.render;
  const playerColors = store.playerColors;
  const playerMap = store.playerMap;
  const boats = store.boats;

  const canvas = document.querySelector('#game-canvas');
  const webglCanvas = document.querySelector('#webgl-canvas');
  const dynamicCanvas = document.querySelector('#dynamic-canvas');
  const mapFrame = document.querySelector('.map-frame');
  const gameScreen = document.querySelector('#game-screen');
  const mapMenu = document.querySelector('#map-menu');
  const spawnHud = document.querySelector('#spawn-hud');
  const spawnTime = document.querySelector('#spawn-time');
  const progressBar = document.querySelector('#spawn-progress-bar');
  const spawnMessage = document.querySelector('#spawn-message');
  const activeAttacksPanel = document.querySelector('#active-attacks');
  const leaderboard = document.querySelector('#leaderboard');
  const winnerBanner = document.querySelector('#winner-banner');
  const nukeInboundBanner = document.querySelector('#nuke-inbound-banner');
  const nukeVignette = document.querySelector('#nuke-vignette');
  const attackRatioPanel = document.querySelector('#attack-ratio-panel');
  const powerSlider = document.querySelector('#power-slider');
  const nukeTrigger = document.querySelector('#nuke-trigger');
  const nukeControls = document.querySelector('#nuke-controls');
  const nukeSelectTarget = document.querySelector('#nuke-select-target');
  const nukeLaunch = document.querySelector('#nuke-launch');
  const nukeCancel = document.querySelector('#nuke-cancel');
  const nukeStatus = document.querySelector('#nuke-status');
  const context = canvas.getContext('2d');
  let webglRenderer = null;
  try {
    webglRenderer = modules.webglRenderer?.createMapRenderer(webglCanvas);
  } catch (error) {
    console.warn('WebGL map renderer unavailable; using 2D fallback:', error.message);
    webglRenderer = null;
    canvas.style.visibility = 'visible';
    webglCanvas.style.display = 'none';
  }
  const dynamicContext = dynamicCanvas.getContext('2d');
  const terrainCanvas = document.createElement('canvas');
  const terrainContext = terrainCanvas.getContext('2d');
  const territoryCanvas = document.createElement('canvas');
  const territoryContext = territoryCanvas.getContext('2d');
  const wastelandCanvas = document.createElement('canvas');
  const wastelandContext = wastelandCanvas.getContext('2d');
  const sceneCanvas = document.createElement('canvas');
  const sceneContext = sceneCanvas.getContext('2d');
  const renderScale = 1;
  try {
    TerriPlayerLabelRenderer.init(document.querySelector('#game-screen'), canvas);
  } catch (error) {
    console.warn('Player label renderer unavailable:', error.message);
  }
  let gameData = null;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let dragStart = null;
  let dragMoved = false;
  const activePointers = new Map();
  let pinchState = null;
  let spawnPhase = null;
  let selectedPosition = null;
  let selectedColor = '#69c878';
  let spawnSubmitHandler = null;
  let nukeLaunchHandler = null;
  let timerHandle = null;
  let terrain = null;
  let wasteland = null;
  let expansionTimes = null;
  let selectionLocked = false;
  let localPlayerId = null;
  let activeGame = false;
  let mapActionHandler = null;
  let boatActionHandler = null;
  let menuPosition = null;
  let mapScale = 1;
  let hoverPosition = null;
  let playerColorCache = new Map();
  let localCapitalCells = new Set();
  let selectedSpawnCells = [];
  let confirmedPosition = null;
  let currentPower = 500;
  let territoryVersion = 0;
  let labelTerritoryVersion = -1;
  let eliminationAnimationFrame = null;
  let localPlayerEliminated = false;
  let localPlayerWon = false;
  let nukeMode = false;
  let nukeSelecting = false;
  let nukeTarget = null;
  let nukeFlight = null;
  const TROOP_SMOOTHING_MS = 90;
  const LEADERBOARD_INTERVAL_MS = 250;
  const LABEL_UPDATE_INTERVAL_MS = 500;
  const PLAYER_FOCUS_ZOOM = 4;
  let pendingChanges = new Int32Array(0);
  let pendingLength = 0;
  let pendingHead = 0;
  let drainRate = 0;
  let drainCarry = 0;
  let packetIntervalMs = 100;
  let lastPacketAt = 0;
  let renderLoopRunning = false;
  let lastFrameAt = 0;
  let displayTroops = 0;
  let targetTroops = 0;
  let leaderboardAt = 0;
  let activeAttacks = [];
  const attackCardState = new Map();

  let territoryImageData = null;
  let territoryLayerDirty = false;
  let wastelandImageData = null;
  let wastelandLayerDirty = false;
  let localWaterBorderVersion = -1;
  let localPlayerHasWaterBorder = false;
  let dirtyMinX = Infinity;
  let dirtyMinY = Infinity;
  let dirtyMaxX = -Infinity;
  let dirtyMaxY = -Infinity;
  let lastLabelDrawAt = 0;
  let labelDrawFrame = null;
  let dynamicDrawFrame = null;
  let canvasResizeFrame = null;
  let gameSessionId = 0;

  function updateWebglPalette() {
    if (!webglRenderer) return;
    webglRenderer.setPalette(playerColors, selectedColor);
    renderState.sceneDirty = true;
  }

  function updateWebglOwners(changes = null) {
    if (!webglRenderer || !gameData?.owners) return;
    if (changes?.length) webglRenderer.updateOwners(gameData.owners, changes);
    else webglRenderer.setOwners(gameData.owners);
    renderState.sceneDirty = true;
  }

  function updateWebglWasteland(changes = null) {
    if (!webglRenderer || !wasteland) return;
    if (changes?.length) webglRenderer.updateWasteland(wasteland, changes);
    else webglRenderer.setWasteland(wasteland);
    renderState.sceneDirty = true;
  }

  function applyWastelandChanges(changes = []) {
    if (!wasteland || !changes.length) return;
    for (const change of changes) {
      const position = typeof change === 'number' ? change : change.position;
      const value = typeof change === 'number' ? 1 : change.value;
      if (position >= 0 && position < wasteland.length) wasteland[position] = value;
    }
    updateWebglWasteland(changes);
    updateWastelandLayer(changes);
    renderState.sceneDirty = true;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function formatTroops(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US').replace(/,/g, ' ');
  }

  function updatePowerSlider() {
    const percentage = Math.round(currentPower / 10);
    powerSlider.value = percentage;
    updateRatioDisplay();
  }

  function updateRatioDisplay() {
    const percentage = Number(powerSlider.value);
    currentPower = percentage * 10;
    const fill = document.getElementById('ratio-bar-fill');
    const label = document.getElementById('ratio-bar-label');
    if (fill) {
      fill.style.width = `${percentage}%`;
      fill.classList.toggle('is-aggressive', percentage > 70);
    }
    const localPlayer = gameData?.players?.find((player) => player.playerId === localPlayerId);
    const troops = Math.floor((localPlayer?.troops || 0) * percentage / 100);
    if (label) label.textContent = `${formatTroops(troops)} (${percentage}%)`;
  }

  function resetInterpolation() {
    pendingChanges = new Int32Array(0);
    pendingLength = 0;
    pendingHead = 0;
    drainRate = 0;
    drainCarry = 0;
    packetIntervalMs = 100;
    lastPacketAt = 0;
  }

  // Keep offline updates flat; only the multiplayer compatibility path needs a
  // one-time conversion from its legacy object array.
  function decodeChangesBuf(data) {
    if (data.changesBuf) return data.changesBuf instanceof Int32Array ? data.changesBuf : new Int32Array(data.changesBuf);
    const changes = data.changes || [];
    if (changes instanceof Int32Array) return changes;
    const buffer = new Int32Array(changes.length * 2);
    for (let index = 0; index < changes.length; index += 1) {
      buffer[index * 2] = changes[index].position;
      buffer[index * 2 + 1] = changes[index].owner;
    }
    return buffer;
  }

  function forEachChange(changes, callback) {
    if (changes instanceof Int32Array) {
      for (let index = 0; index < changes.length; index += 2) callback(changes[index], changes[index + 1]);
      return;
    }
    for (const change of changes || []) callback(change.position, change.owner);
  }

  function queueChanges(changes) {
    if (!changes?.length) return;
    const incoming = changes instanceof Int32Array ? changes : decodeChangesBuf({ changes });
    const unread = pendingLength - pendingHead;
    if (pendingChanges.length < unread + incoming.length) {
      const next = new Int32Array(Math.max(unread + incoming.length, pendingChanges.length * 2, 1024));
      if (unread) next.set(pendingChanges.subarray(pendingHead, pendingLength));
      pendingChanges = next;
      pendingLength = unread;
      pendingHead = 0;
    } else if (pendingHead > 0 && unread) {
      pendingChanges.copyWithin(0, pendingHead, pendingLength);
      pendingLength = unread;
      pendingHead = 0;
    } else if (unread === 0) {
      pendingLength = 0;
      pendingHead = 0;
    }
    pendingChanges.set(incoming, pendingLength);
    pendingLength += incoming.length;
    const remaining = (pendingLength - pendingHead) / 2;
    drainRate = remaining / Math.max(16, packetIntervalMs);
  }

  function drainPendingChanges(deltaMs) {
    const remaining = (pendingLength - pendingHead) / 2;
    if (remaining === 0) return;
    drainCarry += drainRate * deltaMs;
    let budget = Math.floor(drainCarry);
    if (budget < 1) return;
    drainCarry -= budget;
    if (remaining <= budget + 1) budget = remaining;

    const applied = new Int32Array(Math.min(budget, remaining) * 2);
    let appliedLength = 0;
    while (pendingHead < pendingLength && budget > 0) {
      const position = pendingChanges[pendingHead++];
      const owner = pendingChanges[pendingHead++];
      gameData.owners[position] = owner;
      applied[appliedLength++] = position;
      applied[appliedLength++] = owner;
      budget -= 1;
    }
    if (pendingHead >= pendingLength) {
      pendingLength = 0;
      pendingHead = 0;
    } else if (pendingHead > 8192) {
      pendingChanges.copyWithin(0, pendingHead, pendingLength);
      pendingLength -= pendingHead;
      pendingHead = 0;
    }
    if (appliedLength) {
      const appliedChanges = applied.subarray(0, appliedLength);
      updateWebglOwners(appliedChanges);
      updateTerritoryLayer(appliedChanges);
      territoryVersion += 1;
      renderState.labelsDirty = true;
    }
  }

  function smoothTroops(deltaMs) {
    const alpha = 1 - Math.exp(-deltaMs / TROOP_SMOOTHING_MS);
    displayTroops += (targetTroops - displayTroops) * alpha;
    if (Math.abs(targetTroops - displayTroops) < 0.5) displayTroops = targetTroops;
  }

  function renderFrame(timestamp) {
    if (!renderLoopRunning) return;
    const deltaMs = lastFrameAt ? Math.min(200, timestamp - lastFrameAt) : 16;
    lastFrameAt = timestamp;
    drainPendingChanges(deltaMs);
    smoothTroops(deltaMs);
    if (nukeFlight) renderState.dynamicDirty = true;
    if (nukeShake) { renderState.dynamicDirty = true; applyMapTransform(); }
    if (renderState.sceneDirty) drawScene();
    if (renderState.dynamicDirty) drawDynamic();
    if (renderState.labelsDirty && (renderState.labelsCameraDirty || performance.now() - lastLabelDrawAt >= LABEL_UPDATE_INTERVAL_MS)) {
      drawLabels();
    }
    requestAnimationFrame(renderFrame);
  }

  function startRenderLoop() {
    if (renderLoopRunning) return;
    renderLoopRunning = true;
    lastFrameAt = 0;
    requestAnimationFrame(renderFrame);
  }

  function stopRenderLoop() {
    renderLoopRunning = false;
    resetInterpolation();
    clearInterval(timerHandle);
    timerHandle = null;
    if (eliminationAnimationFrame) cancelAnimationFrame(eliminationAnimationFrame);
    eliminationAnimationFrame = null;
    if (labelDrawFrame !== null) cancelAnimationFrame(labelDrawFrame);
    labelDrawFrame = null;
    if (dynamicDrawFrame !== null) cancelAnimationFrame(dynamicDrawFrame);
    dynamicDrawFrame = null;
    if (canvasResizeFrame !== null) cancelAnimationFrame(canvasResizeFrame);
    canvasResizeFrame = null;
  }

  function applyMapTransform() {
    const maxPanX = Math.max(260, (mapFrame.clientWidth * zoom - window.innerWidth) / 2 + 100);
    const maxPanY = Math.max(220, (mapFrame.clientHeight * zoom - window.innerHeight) / 2 + 100);
    panX = clamp(panX, -maxPanX, maxPanX);
    panY = clamp(panY, -maxPanY, maxPanY);
    // Screen shake: decaying random jitter on top of the normal pan.
    // Uses a fast hash of (time, tick) to stay stable within a single frame
    // but jump per-frame, giving a mechanical shudder feel rather than smooth
    // oscillation.
    let shakeX = 0;
    let shakeY = 0;
    if (nukeShake) {
      const elapsed = performance.now() - nukeShake.startedAt;
      if (elapsed < nukeShake.durationMs) {
        // Decay: starts at 1, falls off quickly (cubic ease-out)
        const t = elapsed / nukeShake.durationMs;
        const decay = (1 - t) * (1 - t) * (1 - t);
        const mag = nukeShake.strength * decay;
        // Deterministic per-frame jitter via a cheap integer hash of elapsed
        // rounded to 16ms buckets, so it changes ~every frame but is stable
        // within a frame (no drift mid-draw).
        const bucket = Math.floor(elapsed / 16);
        const hx = (bucket * 1664525 + 1013904223) & 0xffffffff;
        const hy = (bucket * 22695477 + 1) & 0xffffffff;
        shakeX = (((hx >>> 16) & 0xff) / 127.5 - 1) * mag;
        shakeY = (((hy >>> 16) & 0xff) / 127.5 - 1) * mag;
      } else {
        nukeShake = null;
      }
    }
    mapFrame.style.transform = `translate3d(${panX + shakeX}px, ${panY + shakeY}px, 0) scale(${zoom})`;
    renderState.labelsCameraDirty = true;
    hideMapMenu();
    TerriPlayerLabelRenderer.invalidateLayout();
    scheduleLabelDraw();
  }

  function resetMapTransform() {
    zoom = 1;
    panX = 0;
    panY = 0;
    applyMapTransform();
  }

  function animateMapToCenter() {
    if (eliminationAnimationFrame) cancelAnimationFrame(eliminationAnimationFrame);
    dragStart = null;
    dragMoved = false;
    const startZoom = zoom;
    const startPanX = panX;
    const startPanY = panY;
    const startedAt = performance.now();
    const duration = 2800;

    function step(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      zoom = startZoom + (1 - startZoom) * eased;
      panX = startPanX * (1 - eased);
      panY = startPanY * (1 - eased);
      applyMapTransform();
      if (progress < 1) {
        eliminationAnimationFrame = requestAnimationFrame(step);
      } else {
        eliminationAnimationFrame = null;
        resetMapTransform();
      }
    }

    eliminationAnimationFrame = requestAnimationFrame(step);
  }

  function focusPlayer(playerId) {
    if (!gameData) return;
    const target = TerriPlayerLabelRenderer.getLabelCenter(playerId, gameData, territoryVersion);
    if (!target) return;
    const mapWidth = gameData.map.width;
    const mapHeight = gameData.map.height;
    const targetZoom = PLAYER_FOCUS_ZOOM;
    const targetOffsetX = canvas.offsetLeft + target.x / mapWidth * canvas.offsetWidth - mapFrame.offsetWidth / 2;
    const targetOffsetY = canvas.offsetTop + target.y / mapHeight * canvas.offsetHeight - mapFrame.offsetHeight / 2;
    const targetPanX = -targetOffsetX * targetZoom;
    const targetPanY = -targetOffsetY * targetZoom;
    const startZoom = zoom;
    const startPanX = panX;
    const startPanY = panY;
    const startedAt = performance.now();
    const duration = 650;
    if (eliminationAnimationFrame) cancelAnimationFrame(eliminationAnimationFrame);

    function step(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      zoom = startZoom + (targetZoom - startZoom) * eased;
      panX = startPanX + (targetPanX - startPanX) * eased;
      panY = startPanY + (targetPanY - startPanY) * eased;
      applyMapTransform();
      if (progress < 1) eliminationAnimationFrame = requestAnimationFrame(step);
      else eliminationAnimationFrame = null;
    }

    eliminationAnimationFrame = requestAnimationFrame(step);
  }

  function resizeCanvas() {
    if (mapFrame.clientWidth <= 10 || mapFrame.clientHeight <= 10) return false;
    TerriPlayerLabelRenderer.invalidateLayout();
    const width = gameData?.map.width || 876;
    const height = gameData?.map.height || 694;
    mapScale = renderScale * Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.style.width = `${mapFrame.clientWidth}px`;
    canvas.style.height = `${mapFrame.clientHeight}px`;
    webglCanvas.style.width = `${mapFrame.clientWidth}px`;
    webglCanvas.style.height = `${mapFrame.clientHeight}px`;
    dynamicCanvas.style.width = `${canvas.offsetWidth}px`;
    dynamicCanvas.style.height = `${canvas.offsetHeight}px`;
    canvas.width = Math.ceil(width * mapScale);
    canvas.height = Math.ceil(height * mapScale);
    dynamicCanvas.width = Math.ceil(width * mapScale);
    dynamicCanvas.height = Math.ceil(height * mapScale);
    if (webglRenderer) {
      webglCanvas.width = canvas.width;
      webglCanvas.height = canvas.height;
      webglRenderer.resize();
    }
    context.setTransform(mapScale, 0, 0, mapScale, 0, 0);
    dynamicContext.setTransform(mapScale, 0, 0, mapScale, 0, 0);
    context.imageSmoothingEnabled = false;
    dynamicContext.imageSmoothingEnabled = false;
    if (terrain) {
      buildTerrainLayer();
      composeSceneLayer();
      draw();
    }
    return true;
  }

  function scheduleCanvasResize() {
    if (canvasResizeFrame !== null) return;
    canvasResizeFrame = requestAnimationFrame(() => {
      canvasResizeFrame = null;
      if (gameScreen.hidden) return;
      if (!resizeCanvas()) {
        scheduleCanvasResize();
        return;
      }
      applyMapTransform();
    });
  }

  function getCapitalCells(position) {
    return mapGeometry.getCapitalCells(position, gameData.map.width, gameData.map.height);
  }

  function drawCapital(position, color) {
    if (!Number.isInteger(position) || position < 0 || position >= gameData.map.width * gameData.map.height) return;
    const centerX = position % gameData.map.width;
    const centerY = Math.floor(position / gameData.map.width);
    const colors = warFrontPlayerColors(color || '#69c878');

    dynamicContext.fillStyle = colors.border;
    for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
      for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
        if (Math.abs(offsetX) === 2 && Math.abs(offsetY) === 2) continue;
        dynamicContext.fillRect(centerX + offsetX, centerY + offsetY, 1, 1);
      }
    }

    dynamicContext.fillStyle = colors.territory;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        dynamicContext.fillRect(centerX + offsetX, centerY + offsetY, 1, 1);
      }
    }
  }

  function decodeBytes(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function loadTerrain(mapData, sessionId) {
    if (window.TerriEmbeddedTerrain) {
      const decodedTerrain = decodeBytes(window.TerriEmbeddedTerrain);
      if (sessionId !== gameSessionId) return;
      terrain = decodedTerrain;
      if (webglRenderer) webglRenderer.setTerrain(terrain, mapData.width, mapData.height);
      buildTerrainLayer();
      draw();
      return;
    }
    const terrainUrl = window.location.protocol === 'file:'
      ? `http://localhost:8080${mapData.terrainUrl}`
      : new URL(mapData.terrainUrl, window.location.href).href;
    const response = await fetch(terrainUrl);
    if (!response.ok) throw new Error(`Terrain request failed: ${response.status}`);
    const loadedTerrain = new Uint8Array(await response.arrayBuffer());
    if (sessionId !== gameSessionId) return;
    terrain = loadedTerrain;
    if (webglRenderer) webglRenderer.setTerrain(terrain, mapData.width, mapData.height);
    buildTerrainLayer();
    draw();
  }

  async function loadExpansionTimes(mapData, sessionId) {
    if (!mapData.expansionTimesUrl) return;
    if (window.TerriEmbeddedExpansionTimes) {
      const decodedExpansionTimes = decodeBytes(window.TerriEmbeddedExpansionTimes);
      if (sessionId !== gameSessionId) return;
      expansionTimes = decodedExpansionTimes;
      return;
    }
    const expansionTimesUrl = window.location.protocol === 'file:'
      ? `http://localhost:8080${mapData.expansionTimesUrl}`
      : new URL(mapData.expansionTimesUrl, window.location.href).href;
    const response = await fetch(expansionTimesUrl);
    if (!response.ok) throw new Error(`Expansion times request failed: ${response.status}`);
    const loadedExpansionTimes = new Uint8Array(await response.arrayBuffer());
    if (sessionId !== gameSessionId) return;
    expansionTimes = loadedExpansionTimes;
  }

  function isValidCapital(position) {
    if (!terrain) return false;
    const centerX = position % gameData.map.width;
    const centerY = Math.floor(position / gameData.map.width);
    for (let y = centerY - 2; y <= centerY + 2; y += 1) {
      for (let x = centerX - 2; x <= centerX + 2; x += 1) {
        if (x < 0 || x >= gameData.map.width || y < 0 || y >= gameData.map.height) return false;
        if (Math.abs(x - centerX) === 2 && Math.abs(y - centerY) === 2) continue;
        const cell = y * gameData.map.width + x;
        if ((terrain[cell] & 0x80) === 0 || gameData.owners[cell] !== 0) return false;
      }
    }
    return true;
  }

  function hashPosition(position) {
    let value = position + 1;
    value = (value ^ (value >>> 16)) * 0x45d9f3b;
    value = (value ^ (value >>> 16)) * 0x45d9f3b;
    return (value ^ (value >>> 16)) >>> 0;
  }

  function buildTerrainLayer() {
    if (!gameData || !terrain) return;
    if (webglRenderer) return;
    const width = gameData.map.width;
    const height = gameData.map.height;
    terrainCanvas.width = width;
    terrainCanvas.height = height;
    const pixels = terrainContext.createImageData(width, height);
    for (let position = 0; position < terrain.length; position += 1) {
      const pixel = position * 4;
      const land = (terrain[position] & 0x80) !== 0;
      const magnitude = terrain[position] & 0x1f;
      if (land) {
        pixels.data[pixel] = 226 + Math.min(20, magnitude * 2);
        pixels.data[pixel + 1] = 209 + Math.min(18, magnitude * 2);
        pixels.data[pixel + 2] = 161 + Math.min(16, magnitude);
      } else {
        pixels.data[pixel] = 79 + Math.min(9, Math.floor(magnitude * 1.2));
        pixels.data[pixel + 1] = 114 + Math.min(11, Math.floor(magnitude * 1.2));
        pixels.data[pixel + 2] = 140 + Math.min(7, Math.floor(magnitude * 0.6));
      }
      pixels.data[pixel + 3] = 255;
    }
    terrainContext.putImageData(pixels, 0, 0);
    composeSceneLayer();
  }

  function paintWastelandTile(position) {
    if (!wastelandImageData || !wasteland?.[position]) return;
    const pixel = position * 4;
    wastelandImageData.data[pixel] = 51;
    wastelandImageData.data[pixel + 1] = 173;
    wastelandImageData.data[pixel + 2] = 82;
    wastelandImageData.data[pixel + 3] = 220;
  }

  function buildWastelandLayer() {
    if (!gameData || !wasteland || webglRenderer) return;
    const width = gameData.map.width;
    const height = gameData.map.height;
    wastelandCanvas.width = width;
    wastelandCanvas.height = height;
    wastelandImageData = wastelandContext.createImageData(width, height);
    for (let position = 0; position < wasteland.length; position += 1) paintWastelandTile(position);
    wastelandContext.putImageData(wastelandImageData, 0, 0);
    composeSceneLayer();
  }

  function warFrontPlayerColors(color) {
    return colorUtils.playerColors(color);
  }

  function colorsForOwner(ownerId) {
    const color = playerColors.get(ownerId) || selectedColor;
    const cached = playerColorCache.get(ownerId);
    if (cached?.source === color) return cached;
    const colors = warFrontPlayerColors(color);
    const parse = (value) => {
      const match = value.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/);
      if (!match) return null;
      return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 255 : Math.round(Number(match[4]) * 255)];
    };
    const cachedColors = { source: color, colors, territoryPixel: parse(colors.territory), borderPixel: parse(colors.border) };
    playerColorCache.set(ownerId, cachedColors);
    return cachedColors;
  }

  function isBorderCell(position, owner) {
    const width = gameData.map.width;
    const height = gameData.map.height;
    const x = position % width;
    const y = Math.floor(position / width);
    return x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
      gameData.owners[position - 1] !== owner || gameData.owners[position + 1] !== owner ||
      gameData.owners[position - width] !== owner || gameData.owners[position + width] !== owner;
  }

  function paintTerritoryTile(position) {
    if (position < 0 || position >= gameData.owners.length) return;
    const width = gameData.map.width;
    const owner = gameData.owners[position];
    if (!territoryImageData) return;
    const pixel = position * 4;
    territoryImageData.data[pixel] = 0;
    territoryImageData.data[pixel + 1] = 0;
    territoryImageData.data[pixel + 2] = 0;
    territoryImageData.data[pixel + 3] = 0;
    if (!owner) return;
    const colors = colorsForOwner(owner);
    const color = isBorderCell(position, owner) ? colors.borderPixel : colors.territoryPixel;
    if (!color) return;
    territoryImageData.data[pixel] = color[0];
    territoryImageData.data[pixel + 1] = color[1];
    territoryImageData.data[pixel + 2] = color[2];
    territoryImageData.data[pixel + 3] = color[3];
  }

  function rebuildTerritoryLayer() {
    if (!gameData?.owners) return;
    if (webglRenderer) {
      updateWebglOwners();
      return;
    }
    territoryCanvas.width = gameData.map.width;
    territoryCanvas.height = gameData.map.height;
    territoryImageData = territoryContext.createImageData(gameData.map.width, gameData.map.height);
    for (let position = 0; position < gameData.owners.length; position += 1) {
      paintTerritoryTile(position);
    }
    territoryContext.putImageData(territoryImageData, 0, 0);
    composeSceneLayer();
  }

  function updateTerritoryLayer(changes) {
    if (webglRenderer) return;
    if (!territoryImageData) return;
    const affected = new Set();
    forEachChange(changes, (position) => {
      affected.add(position);
      for (const neighbor of mapNeighbors(position)) affected.add(neighbor);
    });
    for (const position of affected) {
      paintTerritoryTile(position);
      const x = position % gameData.map.width;
      const y = Math.floor(position / gameData.map.width);
      dirtyMinX = Math.min(dirtyMinX, x);
      dirtyMinY = Math.min(dirtyMinY, y);
      dirtyMaxX = Math.max(dirtyMaxX, x);
      dirtyMaxY = Math.max(dirtyMaxY, y);
    }
    territoryLayerDirty = true;
    renderState.sceneDirty = true;
  }

  function updateWastelandLayer(changes) {
    if (webglRenderer || !wastelandImageData) return;
    for (const change of changes || []) {
      const position = typeof change === 'number' ? change : change.position;
      if (position < 0 || position >= wasteland.length) continue;
      if (wasteland[position]) paintWastelandTile(position);
      else if (wastelandImageData) {
        const pixel = position * 4;
        wastelandImageData.data[pixel] = 0;
        wastelandImageData.data[pixel + 1] = 0;
        wastelandImageData.data[pixel + 2] = 0;
        wastelandImageData.data[pixel + 3] = 0;
      }
      const x = position % gameData.map.width;
      const y = Math.floor(position / gameData.map.width);
      dirtyMinX = Math.min(dirtyMinX, x);
      dirtyMinY = Math.min(dirtyMinY, y);
      dirtyMaxX = Math.max(dirtyMaxX, x);
      dirtyMaxY = Math.max(dirtyMaxY, y);
    }
    if (changes?.length) {
      wastelandLayerDirty = true;
      renderState.sceneDirty = true;
    }
  }

  function composeSceneLayer() {
    if (!gameData || !terrainCanvas.width || !terrainCanvas.height) return;
    const width = gameData.map.width;
    const height = gameData.map.height;
    if (sceneCanvas.width !== width || sceneCanvas.height !== height) {
      sceneCanvas.width = width;
      sceneCanvas.height = height;
    }
    sceneContext.clearRect(0, 0, width, height);
    sceneContext.drawImage(terrainCanvas, 0, 0, width, height);
    if (wastelandCanvas.width === width && wastelandCanvas.height === height) {
      sceneContext.drawImage(wastelandCanvas, 0, 0, width, height);
    }
    if (territoryCanvas.width === width && territoryCanvas.height === height) {
      sceneContext.drawImage(territoryCanvas, 0, 0, width, height);
    }
    renderState.sceneDirty = true;
  }

  function mapNeighbors(position) {
    return mapGeometry.mapNeighbors(position, gameData.map.width, gameData.map.height);
  }

  function drawHover() {
    if (hoverPosition === null || selectedPosition !== null || !spawnPhase || selectionLocked || !isValidCapital(hoverPosition)) return;
    const width = gameData.map.width;
    const shape = getCapitalCells(hoverPosition);
    const cellSet = new Set(shape);
    dynamicContext.save();
    dynamicContext.strokeStyle = '#f4d35e';
    dynamicContext.lineWidth = 1;
    dynamicContext.globalAlpha = 0.9;
    for (const cell of shape) {
      const x = cell % width;
      const y = Math.floor(cell / width);
      const hasEast = cellSet.has(cell + 1);
      const hasWest = cellSet.has(cell - 1);
      const hasNorth = cellSet.has(cell - width);
      const hasSouth = cellSet.has(cell + width);
      dynamicContext.beginPath();
      if (!hasNorth) { dynamicContext.moveTo(x, y); dynamicContext.lineTo(x + 1, y); }
      if (!hasEast) { dynamicContext.moveTo(x + 1, y); dynamicContext.lineTo(x + 1, y + 1); }
      if (!hasSouth) { dynamicContext.moveTo(x + 1, y + 1); dynamicContext.lineTo(x, y + 1); }
      if (!hasWest) { dynamicContext.moveTo(x, y + 1); dynamicContext.lineTo(x, y); }
      dynamicContext.stroke();
    }
    dynamicContext.restore();
  }

  function drawNukeTarget() {
    if (!nukeMode || nukeTarget === null) return;
    const width = gameData.map.width;
    const x = nukeTarget % width;
    const y = Math.floor(nukeTarget / width);
    dynamicContext.save();
    dynamicContext.strokeStyle = '#071221';
    dynamicContext.fillStyle = 'rgba(232, 107, 82, 0.45)';
    dynamicContext.lineWidth = 1.5;
    dynamicContext.beginPath();
    dynamicContext.arc(x + 0.5, y + 0.5, 8, 0, Math.PI * 2);
    dynamicContext.fill();
    dynamicContext.stroke();
    dynamicContext.beginPath();
    dynamicContext.moveTo(x - 11, y + 0.5);
    dynamicContext.lineTo(x + 12, y + 0.5);
    dynamicContext.moveTo(x + 0.5, y - 11);
    dynamicContext.lineTo(x + 0.5, y + 12);
    dynamicContext.stroke();
    dynamicContext.restore();
  }

  function cubicPoint(start, firstControl, secondControl, end, progress) {
    const inverse = 1 - progress;
    const inverseSquared = inverse * inverse;
    const progressSquared = progress * progress;
    return {
      x: inverseSquared * inverse * start.x + 3 * inverseSquared * progress * firstControl.x +
        3 * inverse * progressSquared * secondControl.x + progressSquared * progress * end.x,
      y: inverseSquared * inverse * start.y + 3 * inverseSquared * progress * firstControl.y +
        3 * inverse * progressSquared * secondControl.y + progressSquared * progress * end.y
    };
  }

  // ─── Nuke flight animation ────────────────────────────────────────────────
  // Warhead: 3×3 pixel block — centre pixel glows red, outer 8 pixels flicker
  // yellow like a star. Leaves a 1px-wide clean white trail along the arc.
  // On impact the warhead vanishes immediately and a brief radial flash expands
  // from the target to signal detonation before the wasteland renders.

  let nukeImpactFlash = null; // { x, y, startedAt }
  let nukeShake = null;       // { startedAt, durationMs, strength }
  let nukeInbound = false;    // true while a nuke is flying toward local territory

  function drawNukeFlight(timestamp) {
    // Draw lingering impact flash even after nukeFlight clears.
    if (nukeImpactFlash) {
      const FLASH_MS = 420;
      const fp = Math.min(1, (timestamp - nukeImpactFlash.startedAt) / FLASH_MS);
      if (fp < 1) {
        const radius = fp * 32;
        const alpha = (1 - fp) * 0.85;
        dynamicContext.save();
        // Outer bloom ring
        const grad = dynamicContext.createRadialGradient(
          nukeImpactFlash.x, nukeImpactFlash.y, 0,
          nukeImpactFlash.x, nukeImpactFlash.y, radius
        );
        grad.addColorStop(0, `rgba(255,255,200,${alpha})`);
        grad.addColorStop(0.35, `rgba(255,140,40,${alpha * 0.7})`);
        grad.addColorStop(1, 'rgba(255,60,20,0)');
        dynamicContext.globalAlpha = 1;
        dynamicContext.fillStyle = grad;
        dynamicContext.beginPath();
        dynamicContext.arc(nukeImpactFlash.x, nukeImpactFlash.y, radius, 0, Math.PI * 2);
        dynamicContext.fill();
        // Hard white core that shrinks as it fades
        dynamicContext.globalAlpha = Math.max(0, 1 - fp * 3);
        dynamicContext.fillStyle = '#ffffff';
        dynamicContext.fillRect(
          nukeImpactFlash.x - 2, nukeImpactFlash.y - 2, 4, 4
        );
        dynamicContext.restore();
        renderState.dynamicDirty = true;
      } else {
        nukeImpactFlash = null;
      }
    }

    if (!nukeFlight) return;

    const mapWidth = gameData.map.width;
    const start = {
      x: nukeFlight.start % mapWidth + 0.5,
      y: Math.floor(nukeFlight.start / mapWidth) + 0.5
    };
    const end = {
      x: nukeFlight.target % mapWidth + 0.5,
      y: Math.floor(nukeFlight.target / mapWidth) + 0.5
    };
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const distance = Math.hypot(deltaX, deltaY);

    // Arc: always lifts away from the midpoint toward the least-crowded edge,
    // capped so the path never leaves the map canvas.
    const requestedArcHeight = Math.max(40, distance / 2.8);
    const upwardRoom = Math.min(start.y, end.y) - 0.5;
    const downwardRoom = gameData.map.height - 0.5 - Math.max(start.y, end.y);
    const arcSign = upwardRoom >= downwardRoom ? -1 : 1;
    const availableRoom = Math.max(1, arcSign < 0 ? upwardRoom : downwardRoom);
    const arcHeight = Math.min(requestedArcHeight, availableRoom * 0.85);

    // Cubic Bézier control points — asymmetric so the warhead launches steeply
    // and arrives at a shallow dive angle, matching real ICBM trajectories.
    const ctrl1 = {
      x: start.x + deltaX * 0.2,
      y: clamp(start.y + deltaY * 0.05 + arcSign * arcHeight, 0.5, gameData.map.height - 0.5)
    };
    const ctrl2 = {
      x: start.x + deltaX * 0.75,
      y: clamp(start.y + deltaY * 0.6 + arcSign * arcHeight * 0.7, 0.5, gameData.map.height - 0.5)
    };

    const progress = Math.min(1, (timestamp - nukeFlight.startedAt) / nukeFlight.durationMs);

    // ── Trail ──────────────────────────────────────────────────────────────
    // Persistent full arc from launch, fading near the head. 1px-wide, white.
    dynamicContext.save();
    dynamicContext.lineCap = 'round';
    dynamicContext.lineJoin = 'round';

    const TRAIL_SEGMENTS = 48;
    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      const t0 = (i / TRAIL_SEGMENTS) * progress;
      const t1 = ((i + 1) / TRAIL_SEGMENTS) * progress;
      // Normalised segment position along the already-drawn trail [0..1]
      const tNorm = (i + 0.5) / TRAIL_SEGMENTS;
      // Fade: opaque at the back, nearly invisible just behind the head
      const alpha = 0.18 + tNorm * (0.62 - tNorm * 0.62);
      const p0 = cubicPoint(start, ctrl1, ctrl2, end, t0);
      const p1 = cubicPoint(start, ctrl1, ctrl2, end, t1);
      dynamicContext.globalAlpha = alpha;
      dynamicContext.strokeStyle = '#ffffff';
      dynamicContext.lineWidth = 1;
      dynamicContext.beginPath();
      dynamicContext.moveTo(p0.x, p0.y);
      dynamicContext.lineTo(p1.x, p1.y);
      dynamicContext.stroke();
    }

    // -- Warhead ---------------------------------------------------------------
    // 5x5 pixel block (~60% bigger than original 3x3).
    // Centre pixel = solid red core. Inner ring = orange-red pulse.
    // Outer ring = flickering yellow star shimmer.
    if (progress < 1) {
      const pos = cubicPoint(start, ctrl1, ctrl2, end, progress);
      const px = Math.round(pos.x - 2.5); // top-left of the 5x5 block
      const py = Math.round(pos.y - 2.5);

      const t = timestamp / 1000;
      dynamicContext.globalAlpha = 1;

      // Outer ring -- 16 cells along the 5x5 perimeter, flickering yellow star
      const outerRing = [
        [0,0],[1,0],[2,0],[3,0],[4,0],
        [0,1],                  [4,1],
        [0,2],                  [4,2],
        [0,3],                  [4,3],
        [0,4],[1,4],[2,4],[3,4],[4,4]
      ];
      for (let s = 0; s < outerRing.length; s++) {
        const [ox, oy] = outerRing[s];
        const flicker = 0.50 + 0.50 * Math.sin(t * 28 + s * 1.1);
        dynamicContext.globalAlpha = flicker;
        const g = Math.round(170 + 85 * flicker);
        dynamicContext.fillStyle = `rgb(255,${g},0)`;
        dynamicContext.fillRect(px + ox, py + oy, 1, 1);
      }

      // Inner ring -- 3x3 without corners, warm orange-red, subtly pulsing
      const innerRing = [
        [1,1],[2,1],[3,1],
        [1,2],      [3,2],
        [1,3],[2,3],[3,3]
      ];
      for (let s = 0; s < innerRing.length; s++) {
        const [ox, oy] = innerRing[s];
        const pulse = 0.75 + 0.25 * Math.sin(t * 20 + s * 0.9);
        dynamicContext.globalAlpha = pulse;
        dynamicContext.fillStyle = `rgb(255,${Math.round(80 + 40 * pulse)},10)`;
        dynamicContext.fillRect(px + ox, py + oy, 1, 1);
      }

      // Centre pixel -- deep red, always fully opaque
      dynamicContext.globalAlpha = 1;
      dynamicContext.fillStyle = '#cc1111';
      dynamicContext.fillRect(px + 2, py + 2, 1, 1);

      // Radial halo -- scaled up to match the larger block
      dynamicContext.globalAlpha = 0.28 + 0.12 * Math.sin(t * 18);
      const halo = dynamicContext.createRadialGradient(
        pos.x, pos.y, 0, pos.x, pos.y, 5.5
      );
      halo.addColorStop(0, 'rgba(255,200,40,0.9)');
      halo.addColorStop(1, 'rgba(255,80,0,0)');
      dynamicContext.fillStyle = halo;
      dynamicContext.beginPath();
      dynamicContext.arc(pos.x, pos.y, 5.5, 0, Math.PI * 2);
      dynamicContext.fill();
    }

    dynamicContext.restore();

    // ── Impact ─────────────────────────────────────────────────────────────
    if (progress >= 1) {
      // Warhead disappears instantly — spawn the flash and screen shake.
      if (!nukeImpactFlash) {
        nukeImpactFlash = { x: end.x, y: end.y, startedAt: timestamp };
        nukeShake = { startedAt: timestamp, durationMs: 600, strength: 5 };
      }
      clearNukeInbound();
      nukeFlight = null;
      nukeLaunch.disabled = true;
      nukeSelectTarget.disabled = false;
      nukeStatus.textContent = 'IMPACT REGISTERED // DAMAGE OFFLINE';
    }
  }

  // ── Nuke-inbound detection (client-side only) ─────────────────────────────
  // Mirrors the server's getImpactCells circle logic to check if the local
  // player's territory overlaps the blast radius — no server message needed.
  const NUKE_RADIUS_CLIENT = 30;
  const nukeCircleOffsets = [];
  for (let oy = -NUKE_RADIUS_CLIENT; oy <= NUKE_RADIUS_CLIENT; oy += 1) {
    const w = Math.round(Math.sqrt(NUKE_RADIUS_CLIENT ** 2 - oy ** 2));
    nukeCircleOffsets.push({ oy, minX: -w, maxX: w });
  }

  function isNukeTargetingLocalPlayer(targetPosition) {
    if (!gameData?.owners || !localPlayerId) return false;
    const mapWidth = gameData.map.width;
    const mapHeight = gameData.map.height;
    const localOwnerId = Number(localPlayerId.replace('player-', ''));
    const centerX = targetPosition % mapWidth;
    const centerY = Math.floor(targetPosition / mapWidth);
    for (const row of nukeCircleOffsets) {
      const y = centerY + row.oy;
      if (y < 0 || y >= mapHeight) continue;
      const minX = Math.max(0, centerX + row.minX);
      const maxX = Math.min(mapWidth - 1, centerX + row.maxX);
      for (let x = minX; x <= maxX; x += 1) {
        if (gameData.owners[y * mapWidth + x] === localOwnerId) return true;
      }
    }
    return false;
  }

  function showNukeInbound() {
    nukeInbound = true;
    if (nukeInboundBanner) nukeInboundBanner.hidden = false;
    if (nukeVignette) nukeVignette.hidden = false;
  }

  function clearNukeInbound() {
    nukeInbound = false;
    if (nukeInboundBanner) nukeInboundBanner.hidden = true;
    if (nukeVignette) nukeVignette.hidden = true;
  }

  function startNukeFlight(data) {
    // Accept both {startPosition, targetPosition} (multiplayer + fixed offline)
    // and the legacy {start, target} shape as a fallback.
    const startPos = data?.startPosition ?? data?.start;
    const targetPos = data?.targetPosition ?? data?.target;
    if (!gameData || !Number.isInteger(startPos) || !Number.isInteger(targetPos)) return;
    nukeFlight = {
      start: startPos,
      target: targetPos,
      startedAt: performance.now(),
      durationMs: Math.max(3750, Number(data.durationMs) || 3750)
    };
    // Client-side detection: show NUKE INBOUND if blast radius overlaps our territory.
    if (isNukeTargetingLocalPlayer(targetPos)) showNukeInbound();
    invalidateDynamic();
  }

  // Cached references for leaderboard — avoids querySelector on every render.
  let _lbList = null;
  let _lbTitle = null;

  function renderLeaderboard(force = false) {
    if (!gameData?.players || !leaderboard) return;
    const now = performance.now();
    if (!force && now - leaderboardAt < LEADERBOARD_INTERVAL_MS) return;
    leaderboardAt = now;
    const ranked = [...gameData.players]
      .filter((player) => player.isAlive !== false && (player.territorySize || 0) > 0)
      .sort((a, b) =>
      (b.territorySize || 0) - (a.territorySize || 0) || (b.troops || 0) - (a.troops || 0));
    const rankedEntries = ranked.map((player, index) => ({ player, index }));
    const localIndex = ranked.findIndex((player) => player.playerId === localPlayerId);
    const displayEntries = rankedEntries.slice(0, 9);
    if (localIndex >= 9) displayEntries.push(rankedEntries[localIndex]);

    // One-time scaffold — only built on the very first render.
    if (!_lbList) {
      leaderboard.innerHTML = '<div class="leaderboard-title">LEADERBOARD</div><div class="leaderboard-list"></div>';
      _lbTitle = leaderboard.querySelector('.leaderboard-title');
      _lbList = leaderboard.querySelector('.leaderboard-list');
    }

    // Diff existing rows against the new display list.
    // Rows are keyed by playerId stored in dataset.playerId.
    // Strategy: walk both the current DOM children and the new entries in
    // parallel, updating text in-place where the key matches, inserting new
    // rows where needed, and removing surplus rows at the end.
    // This avoids destroying and recreating all rows + event listeners on
    // every economy tick (previously every ~1 s with 250 players).
    const existingRows = _lbList.children;
    for (let i = 0; i < displayEntries.length; i += 1) {
      const { player, index } = displayEntries[i];
      const isLocal = player.playerId === localPlayerId;
      const wantedClass = `leaderboard-row${isLocal ? ' is-local' : ''}`;

      if (i < existingRows.length) {
        // Reuse the existing row — update only what changed.
        const row = existingRows[i];
        if (row.dataset.playerId !== player.playerId) {
          // Different player in this slot — re-key and rebind the click.
          row.dataset.playerId = player.playerId;
          row.title = `Focus ${player.playerName || player.playerId}`;
          // Replace listeners by cloning the node without listeners, then
          // re-attaching. Cheaper than removeEventListener when playerId swaps.
          const fresh = row.cloneNode(true);
          fresh.dataset.playerId = player.playerId;
          fresh.title = `Focus ${player.playerName || player.playerId}`;
          fresh.addEventListener('click', () => focusPlayer(player.playerId));
          fresh.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            focusPlayer(player.playerId);
          });
          _lbList.replaceChild(fresh, row);
          // existingRows is live — the replaced node is now fresh at index i.
        }
        const current = existingRows[i];
        if (current.className !== wantedClass) current.className = wantedClass;
        const rank = current.querySelector('.leaderboard-rank');
        const name = current.querySelector('.leaderboard-name');
        const values = current.querySelector('.leaderboard-values');
        const wantedRank = `${index + 1}.`;
        const wantedName = player.playerName || player.playerId;
        const wantedValues = formatTroops(player.territorySize || 0);
        if (rank && rank.textContent !== wantedRank) rank.textContent = wantedRank;
        if (name && name.textContent !== wantedName) name.textContent = wantedName;
        if (values && values.textContent !== wantedValues) values.textContent = wantedValues;
      } else {
        // New row needed — build and append.
        const row = document.createElement('div');
        row.className = wantedClass;
        row.dataset.playerId = player.playerId;
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.title = `Focus ${player.playerName || player.playerId}`;
        row.addEventListener('click', () => focusPlayer(player.playerId));
        row.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          focusPlayer(player.playerId);
        });
        row.innerHTML = `<span class="leaderboard-rank">${index + 1}.</span><span class="leaderboard-name"></span><span class="leaderboard-values">${formatTroops(player.territorySize || 0)}</span>`;
        row.querySelector('.leaderboard-name').textContent = player.playerName || player.playerId;
        _lbList.appendChild(row);
      }
    }
    // Remove surplus rows (players that dropped off the display list).
    while (_lbList.children.length > displayEntries.length) {
      _lbList.removeChild(_lbList.lastChild);
    }
  }

  function rebuildPlayerMap() {
    playerMap.clear();
    for (const player of gameData?.players || []) playerMap.set(player.playerId, player);
  }

  function attackMergeKey(attack) {
    const targetOwnerId = Number(attack.targetOwnerId) || 0;
    return targetOwnerId ? `owner-${targetOwnerId}` : `neutral-${attack.playerId}`;
  }

  function updateActiveAttacks(attacks) {
    activeAttacks = attacks || [];
    if (!activeAttacksPanel) return;
    const mergedMap = new Map();
    for (const attack of activeAttacks) {
      if (attack.playerId !== localPlayerId || attack.troops <= 0) continue;
      const key = attackMergeKey(attack);
      if (mergedMap.has(key)) {
        const merged = mergedMap.get(key);
        merged.troops += attack.troops;
        merged.attackIds.push(attack.id);
      } else mergedMap.set(key, { ...attack, attackIds: [attack.id] });
    }

    const mergedAttacks = [...mergedMap.values()];
    const existingCards = new Map(
      [...activeAttacksPanel.querySelectorAll('.active-attack-card')]
        .map((card) => [card.dataset.key, card])
    );
    const seenKeys = new Set();
    mergedAttacks
      .filter((attack) => attack.playerId === localPlayerId && attack.troops > 0)
      .forEach((attack) => {
        const key = attackMergeKey(attack);
        seenKeys.add(key);
        const previousTroops = attackCardState.get(key)?.troops;
        if (existingCards.has(key)) {
          const card = existingCards.get(key);
          card.querySelector('.active-attack-troops').textContent = `${formatTroops(attack.troops)} troops`;
          card.querySelector('.active-attack-cancel').onclick = () => {
            for (const attackId of attack.attackIds) {
              window.TerriCommunicator?.send(window.TerriBinaryProtocol.encodeCancelExpansion(localPlayerId, attackId));
            }
          };
          if (previousTroops !== undefined && attack.troops > previousTroops) {
            const gain = card.querySelector('.active-attack-gain');
            const gainState = attackCardState.get(key);
            gain.textContent = `+ ${formatTroops(attack.troops - previousTroops)}`;
            gain.classList.remove('is-fading');
            clearTimeout(gainState.fadeTimer);
            gainState.fadeTimer = setTimeout(() => gain.classList.add('is-fading'), 1800);
          }
          attackCardState.set(key, { ...attackCardState.get(key), troops: attack.troops, attackIds: attack.attackIds });
          return;
        }
        const card = document.createElement('div');
        card.className = 'active-attack-card';
        card.dataset.key = key;
        const count = document.createElement('span');
        count.className = 'active-attack-troops';
        count.textContent = `${formatTroops(attack.troops)} troops`;
        const gain = document.createElement('span');
        gain.className = 'active-attack-gain is-fading';
        const cancel = document.createElement('button');
        cancel.className = 'active-attack-cancel';
        cancel.type = 'button';
        cancel.setAttribute('aria-label', 'Cancel attack');
        cancel.textContent = 'x';
        card.append(count, gain, cancel);
        activeAttacksPanel.appendChild(card);
        cancel.onclick = () => {
          for (const attackId of attack.attackIds) {
            window.TerriCommunicator?.send(window.TerriBinaryProtocol.encodeCancelExpansion(localPlayerId, attackId));
          }
        };
        attackCardState.set(key, { troops: attack.troops, attackIds: attack.attackIds, fadeTimer: null });
      });
    for (const [key, card] of existingCards) {
      if (!seenKeys.has(key)) {
        card.remove();
        const state = attackCardState.get(key);
        if (state) clearTimeout(state.fadeTimer);
        attackCardState.delete(key);
      }
    }
    for (const [key, state] of attackCardState) {
      if (seenKeys.has(key)) continue;
      if (state.fadeTimer) clearTimeout(state.fadeTimer);
      attackCardState.delete(key);
    }
  }

  function updateLocalTroops(player) {
    if (!player) return;
    targetTroops = player.troops || 0;
    const selectorTroopCount = document.getElementById('selector-troop-count');
    const selectorTerritory = document.getElementById('selector-territory');
    const selectorDensity = document.getElementById('selector-density');
    const selectorStats = document.getElementById('selector-stats');
    if (selectorStats) selectorStats.hidden = false;
    if (selectorTroopCount) selectorTroopCount.textContent = formatTroops(player.troops || 0);
    if (selectorTerritory) selectorTerritory.textContent = formatTroops(player.territorySize || 0);
    if (selectorDensity) {
      const density = player.territorySize > 0
        ? (player.troops / player.territorySize).toFixed(2)
        : '0.00';
      selectorDensity.textContent = density;
    }
    updateRatioDisplay();
  }

  function drawScene() {
    if (!gameData || !terrain) return;
    if (webglRenderer) {
      if (renderState.sceneDirty) webglRenderer.draw();
      renderState.sceneDirty = false;
      return;
    }
    const width = gameData.map.width;
    const height = gameData.map.height;
    if (territoryLayerDirty || wastelandLayerDirty) {
      if (dirtyMinX <= dirtyMaxX && dirtyMinY <= dirtyMaxY) {
        const dirtyWidth = dirtyMaxX - dirtyMinX + 1;
        const dirtyHeight = dirtyMaxY - dirtyMinY + 1;
        // During heavy expansion phases (all bots attacking simultaneously)
        // the dirty rect can expand to cover most of the map. At that point
        // the partial-blit path has nearly the same cost as a full redraw but
        // with extra arithmetic overhead. Fall back to a full putImageData
        // when the dirty region exceeds 60 % of either map dimension.
        const useFullBlit = dirtyWidth > width * 0.6 || dirtyHeight > height * 0.6;
        if (useFullBlit) {
          if (territoryLayerDirty) territoryContext.putImageData(territoryImageData, 0, 0);
          if (wastelandLayerDirty) wastelandContext.putImageData(wastelandImageData, 0, 0);
          sceneContext.clearRect(0, 0, width, height);
          sceneContext.drawImage(terrainCanvas, 0, 0, width, height);
          sceneContext.drawImage(wastelandCanvas, 0, 0, width, height);
          sceneContext.drawImage(territoryCanvas, 0, 0, width, height);
        } else {
          if (territoryLayerDirty) territoryContext.putImageData(territoryImageData, 0, 0, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight);
          if (wastelandLayerDirty) wastelandContext.putImageData(wastelandImageData, 0, 0, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight);
          sceneContext.clearRect(dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight);
          sceneContext.drawImage(terrainCanvas, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight);
          sceneContext.drawImage(wastelandCanvas, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight);
          sceneContext.drawImage(territoryCanvas, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight);
        }
      }
      dirtyMinX = Infinity;
      dirtyMinY = Infinity;
      dirtyMaxX = -Infinity;
      dirtyMaxY = -Infinity;
      territoryLayerDirty = false;
      wastelandLayerDirty = false;
    }
    if (!renderState.sceneDirty) return;
    context.clearRect(0, 0, width, height);
    context.drawImage(sceneCanvas, 0, 0, width, height);
    renderState.sceneDirty = false;
  }

  function drawDynamic() {
    if (!gameData || !terrain || !renderState.dynamicDirty) return;
    const width = gameData.map.width;
    const height = gameData.map.height;
    dynamicContext.clearRect(0, 0, width, height);
    if (spawnPhase) drawSpawnCapitals();
    drawBoats();
    drawHover();
    drawNukeTarget();
    drawNukeFlight(performance.now());
    renderState.dynamicDirty = false;
  }

  function scheduleDynamicDraw() {
    if (dynamicDrawFrame !== null) return;
    dynamicDrawFrame = requestAnimationFrame(() => {
      dynamicDrawFrame = null;
      drawDynamic();
    });
  }

  function drawSpawnCapitals() {
    const localPreviewActive = selectedPosition !== null;
    for (const player of gameData.players || []) {
      if (!Number.isInteger(player.spawnPosition)) continue;
      if (player.playerId === localPlayerId && localPreviewActive) continue;
      drawCapital(player.spawnPosition, player.capitalColor || playerColors.get(Number(player.playerId.replace('player-', ''))));
    }
    if (localPreviewActive) drawCapital(selectedPosition, selectedColor);
  }

  // Troops at sea, drawn as a small marker in the owner's colour.
  function drawBoats() {
    if (!boats.length) return;
    const width = gameData.map.width;
    dynamicContext.save();
    for (const boat of boats) {
      const x = boat.position % width;
      const y = Math.floor(boat.position / width);
      const colors = warFrontPlayerColors(playerColors.get(boat.ownerId) || '#f4d35e');
      dynamicContext.fillStyle = colors.territory;
      dynamicContext.fillRect(x - 1, y - 1, 3, 3);
      dynamicContext.fillStyle = colors.border;
      dynamicContext.fillRect(x, y, 1, 1);
    }
    dynamicContext.restore();
  }

  function drawLabels() {
    if (!gameData || !terrain) return;
    labelTerritoryVersion = territoryVersion;
    TerriPlayerLabelRenderer.draw(gameData, zoom, labelTerritoryVersion);
    renderState.labelsDirty = false;
    renderState.labelsCameraDirty = false;
    lastLabelDrawAt = performance.now();
  }

  function scheduleLabelDraw() {
    renderState.labelsDirty = true;
    if (labelDrawFrame !== null) return;
    labelDrawFrame = requestAnimationFrame(() => {
      labelDrawFrame = null;
      if (gameData && terrain && renderState.labelsDirty && renderState.labelsCameraDirty) drawLabels();
    });
  }

  function invalidateDynamic() {
    renderState.dynamicDirty = true;
  }

  function draw() {
    drawScene();
    invalidateDynamic();
    drawDynamic();
    drawLabels();
  }

  function randomColor() {
    const colors = ['#69c878', '#e86b52', '#6ba8e8', '#d9b84c', '#bb75d4', '#e889b1'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  function positionFromPointer(event) {
    const rectangle = canvas.getBoundingClientRect();
    const localX = (event.clientX - rectangle.left) * (gameData.map.width / rectangle.width);
    const localY = (event.clientY - rectangle.top) * (gameData.map.height / rectangle.height);
    const mapX = Math.floor(localX);
    const mapY = Math.floor(localY);
    if (mapX < 0 || mapX >= gameData.map.width || mapY < 0 || mapY >= gameData.map.height) return null;
    return mapY * gameData.map.width + mapX;
  }

  function updateSpawnTimer() {
    if (!spawnPhase) return;
    const remainingMs = Math.max(0, spawnPhase.deadline - Date.now());
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    spawnTime.textContent = remainingSeconds;
    const elapsedMs = Math.min(spawnPhase.durationMs, spawnPhase.durationMs - remainingMs);
    progressBar.style.width = `${Math.max(0, elapsedMs / spawnPhase.durationMs) * 100}%`;
    progressBar.classList.toggle('is-critical', remainingMs <= 5000);
    if (remainingMs <= 1000 && !selectionLocked) {
      selectionLocked = true;
      spawnSubmitHandler?.({ playerId: spawnPhase.playerId, position: selectedPosition });
    }
    if (remainingMs === 0) {
      clearInterval(timerHandle);
      spawnMessage.textContent = 'SPAWN LOCKED // WAITING FOR SERVER';
    }
  }

  mapFrame.addEventListener('wheel', function (event) {
    if (eliminationAnimationFrame) return;
    if (event.shiftKey) {
      event.preventDefault();
      powerSlider.value = clamp(Number(powerSlider.value) + (event.deltaY > 0 ? -5 : 5), 1, 100);
      localStorage.setItem('terrifront-attack-ratio', powerSlider.value);
      updateRatioDisplay();
      return;
    }
    event.preventDefault();
    const rectangle = mapFrame.getBoundingClientRect();
    const visualCenterX = rectangle.left + rectangle.width / 2;
    const visualCenterY = rectangle.top + rectangle.height / 2;
    const localX = (event.clientX - visualCenterX) / zoom;
    const localY = (event.clientY - visualCenterY) / zoom;
    const nextZoom = clamp(zoom * (event.deltaY > 0 ? 0.9 : 1.1), 1, 200);
    const baseCenterX = visualCenterX - panX;
    const baseCenterY = visualCenterY - panY;
    zoom = nextZoom;
    panX = event.clientX - localX * zoom - baseCenterX;
    panY = event.clientY - localY * zoom - baseCenterY;
    applyMapTransform();
  }, { passive: false });

  mapFrame.addEventListener('pointerdown', function (event) {
    if (eliminationAnimationFrame) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 2) {
      const points = [...activePointers.values()];
      pinchState = {
        distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
        zoom,
        panX,
        panY,
        midpoint: {
          x: (points[0].x + points[1].x) / 2,
          y: (points[0].y + points[1].y) / 2
        }
      };
      dragStart = null;
      dragMoved = true;
      mapFrame.classList.remove('is-dragging');
      mapFrame.setPointerCapture(event.pointerId);
      return;
    }
    dragStart = { x: event.clientX - panX, y: event.clientY - panY };
    dragMoved = false;
    mapFrame.setPointerCapture(event.pointerId);
    mapFrame.classList.add('is-dragging');
  });

  mapFrame.addEventListener('pointermove', function (event) {
    if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchState && activePointers.size >= 2) {
      const points = [...activePointers.values()];
      const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
      const midpoint = {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2
      };
      const scale = clamp(distance / pinchState.distance, 0.35, 4);
      zoom = clamp(pinchState.zoom * scale, 1, 200);
      panX = pinchState.panX + midpoint.x - pinchState.midpoint.x;
      panY = pinchState.panY + midpoint.y - pinchState.midpoint.y;
      applyMapTransform();
      invalidateDynamic();
      scheduleDynamicDraw();
      return;
    }
    if (!dragStart) return;
    if (Math.abs(event.clientX - dragStart.x - panX) > 6 || Math.abs(event.clientY - dragStart.y - panY) > 6) dragMoved = true;
    panX = event.clientX - dragStart.x;
    panY = event.clientY - dragStart.y;
    applyMapTransform();
    hoverPosition = positionFromPointer(event);
    invalidateDynamic();
    scheduleDynamicDraw();
  });

  mapFrame.addEventListener('pointerleave', function () {
    hoverPosition = null;
    invalidateDynamic();
    scheduleDynamicDraw();
  });

  function stopDragging(event) {
    activePointers.delete(event.pointerId);
    if (pinchState) {
      if (activePointers.size < 2) pinchState = null;
      dragStart = null;
      if (mapFrame.hasPointerCapture(event.pointerId)) mapFrame.releasePointerCapture(event.pointerId);
      return;
    }
    if (!dragStart) return;
    const wasClick = !dragMoved;
    dragStart = null;
    mapFrame.classList.remove('is-dragging');
    if (mapFrame.hasPointerCapture(event.pointerId)) mapFrame.releasePointerCapture(event.pointerId);
    if (wasClick && spawnPhase && !selectionLocked) {
      const position = positionFromPointer(event);
      if (position !== null) {
        if (!isValidCapital(position)) {
          spawnMessage.textContent = 'INVALID POSITION // CAPITAL MUST BE ON LAND';
          hoverPosition = null;
          invalidateDynamic();
          drawDynamic();
          return;
        }
        selectedPosition = position;
        selectedSpawnCells = getCapitalCells(position);
        if (selectedSpawnCells.length !== 21 || !isValidCapital(position)) {
          selectedSpawnCells = [];
          spawnMessage.textContent = 'INVALID POSITION // CAPITAL MUST BE ON LAND';
          hoverPosition = null;
          invalidateDynamic();
          drawDynamic();
          return;
        }
        selectedColor = playerColors.get(Number(localPlayerId.replace('player-', ''))) || randomColor();
        spawnMessage.textContent = 'CAPITAL SELECTED // CLICK AGAIN TO REPLACE';
        spawnSubmitHandler?.({ playerId: spawnPhase.playerId, position: selectedPosition });
        invalidateDynamic();
        drawDynamic();
      }
    } else if (wasClick && activeGame) {
      const position = positionFromPointer(event);
      if (nukeMode && nukeSelecting) {
        if (position !== null) {
          nukeTarget = position;
          nukeSelecting = false;
          nukeStatus.textContent = 'TARGET LOCKED // READY TO LAUNCH';
          nukeLaunch.disabled = false;
          invalidateDynamic();
          drawDynamic();
        }
        hoverPosition = null;
        return;
      }
      const ownerId = Number(localPlayerId.replace('player-', ''));
      if (position !== null && (terrain[position] & 0x80) !== 0 && gameData.owners[position] !== ownerId) {
        mapActionHandler?.({ playerId: localPlayerId, position });
      }
    }
    hoverPosition = null;
    invalidateDynamic();
    drawDynamic();
  }

  function hideMapMenu() {
    if (mapMenu.hidden) return;
    mapMenu.hidden = true;
    menuPosition = null;
  }

  function playerHasWaterBorder(ownerId) {
    if (localWaterBorderVersion === territoryVersion) return localPlayerHasWaterBorder;
    localPlayerHasWaterBorder = false;
    for (let position = 0; position < gameData.owners.length; position += 1) {
      if (gameData.owners[position] !== ownerId) continue;
      if (mapNeighbors(position).some((neighbor) => (terrain[neighbor] & 0x80) === 0)) {
        localPlayerHasWaterBorder = true;
        break;
      }
    }
    localWaterBorderVersion = territoryVersion;
    return localPlayerHasWaterBorder;
  }

  function targetNearWater(position, maxDistance = 10) {
    const visited = new Set([position]);
    const queue = [{ position, distance: 0 }];
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      const neighbors = mapNeighbors(current.position);
      if (neighbors.some((neighbor) => (terrain[neighbor] & 0x80) === 0)) return true;
      if (current.distance >= maxDistance) continue;
      for (const neighbor of neighbors) {
        if (visited.has(neighbor) || (terrain[neighbor] & 0x80) === 0) continue;
        visited.add(neighbor);
        queue.push({ position: neighbor, distance: current.distance + 1 });
      }
    }
    return false;
  }

  function showMapMenu(event, position) {
    menuPosition = position;
    const bounds = gameScreen.getBoundingClientRect();
    mapMenu.hidden = false;
    const attackButton = mapMenu.querySelector('[data-action="attack"]');
    const boatButton = mapMenu.querySelector('[data-action="boat"]');
    const ownerId = Number(localPlayerId.replace('player-', ''));
    const canLaunchBoat = targetNearWater(position) && playerHasWaterBorder(ownerId);
    boatButton.hidden = !canLaunchBoat;
    // Clamp so the menu never opens off the edge of the screen.
    const width = mapMenu.offsetWidth || 34;
    const height = mapMenu.offsetHeight || (canLaunchBoat ? 74 : 34);
    const attackWidth = attackButton?.offsetWidth || 34;
    const attackHeight = attackButton?.offsetHeight || 34;
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const x = pointerX - attackWidth / 2;
    const y = pointerY - attackHeight / 2;
    mapMenu.style.left = `${Math.min(Math.max(4, x), Math.max(4, bounds.width - width - 4))}px`;
    mapMenu.style.top = `${Math.min(Math.max(4, y), Math.max(4, bounds.height - height - 4))}px`;
  }

  mapFrame.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    if (!activeGame || localPlayerId === null) return;
    const position = positionFromPointer(event);
    const ownerId = Number(localPlayerId.replace('player-', ''));
    // Only offer the menu on land we do not already hold.
    if (position === null || (terrain[position] & 0x80) === 0 || gameData.owners[position] === ownerId) {
      hideMapMenu();
      return;
    }
    showMapMenu(event, position);
  });

  mapMenu.addEventListener('click', function (event) {
    const action = event.target.closest('.map-menu-item')?.dataset.action;
    if (!action || menuPosition === null) return;
    const position = menuPosition;
    hideMapMenu();
    if (action === 'attack') {
      mapActionHandler?.({ playerId: localPlayerId, position });
    } else if (action === 'boat') {
      boatActionHandler?.({ playerId: localPlayerId, position });
    }
  });

  document.addEventListener('pointerdown', function (event) {
    if (mapMenu.hidden || mapMenu.contains(event.target)) return;
    hideMapMenu();
  });

  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') hideMapMenu();
  });

  mapFrame.addEventListener('pointerup', stopDragging);
  mapFrame.addEventListener('pointercancel', stopDragging);
  window.addEventListener('resize', function () {
    scheduleCanvasResize();
    applyMapTransform();
  });

  powerSlider.addEventListener('input', function () {
    localStorage.setItem('terrifront-attack-ratio', powerSlider.value);
    updateRatioDisplay();
  });

  function setNukeMode(enabled) {
    nukeMode = enabled;
    nukeSelecting = enabled;
    nukeTarget = null;
    gameScreen.classList.toggle('nuke-mode', enabled);
    nukeControls.hidden = !enabled;
    attackRatioPanel.hidden = enabled || !activeGame;
    leaderboard.hidden = enabled || !activeGame;
    activeAttacksPanel.hidden = enabled;
    nukeLaunch.disabled = true;
    nukeSelectTarget.disabled = false;
    nukeStatus.textContent = 'SELECT A TARGET';
    if (enabled) hideMapMenu();
    invalidateDynamic();
    drawDynamic();
  }

  nukeTrigger.addEventListener('click', () => setNukeMode(true));
  nukeSelectTarget.addEventListener('click', () => {
    if (nukeFlight) return;
    nukeSelecting = true;
    nukeTarget = null;
    nukeLaunch.disabled = true;
    nukeStatus.textContent = 'SELECT A TARGET';
    invalidateDynamic();
    drawDynamic();
  });
  nukeLaunch.addEventListener('click', () => {
    if (nukeTarget === null || nukeFlight) return;
    const localPlayer = playerMap.get(localPlayerId);
    const launchPosition = localPlayer?.spawnPosition ?? selectedPosition ?? confirmedPosition;
    if (!Number.isInteger(launchPosition)) {
      nukeStatus.textContent = 'CAPITAL POSITION UNAVAILABLE';
      return;
    }
    const launch = { playerId: localPlayerId, start: launchPosition, target: nukeTarget };
    if (nukeLaunchHandler) nukeLaunchHandler(launch);
    else startNukeFlight(launch);
    setNukeMode(false);
  });
  nukeCancel.addEventListener('click', () => {
    nukeFlight = null;
    setNukeMode(false);
  });

  const ratioTrack = document.querySelector('.ratio-bar-track');
  if (ratioTrack) {
    function ratioFromEvent(event) {
      const rect = ratioTrack.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      return Math.max(1, Math.round(ratio * 100));
    }
    let draggingRatio = false;
    ratioTrack.addEventListener('pointerdown', (event) => {
      draggingRatio = true;
      ratioTrack.setPointerCapture(event.pointerId);
      powerSlider.value = ratioFromEvent(event);
      updateRatioDisplay();
    });
    ratioTrack.addEventListener('pointermove', (event) => {
      if (!draggingRatio) return;
      powerSlider.value = ratioFromEvent(event);
      updateRatioDisplay();
    });
    ratioTrack.addEventListener('pointerup', () => {
      draggingRatio = false;
      localStorage.setItem('terrifront-attack-ratio', powerSlider.value);
    });
    ratioTrack.addEventListener('pointercancel', () => {
      draggingRatio = false;
      localStorage.setItem('terrifront-attack-ratio', powerSlider.value);
    });
  }

  document.getElementById('ratio-minus')?.addEventListener('click', () => {
    powerSlider.value = Math.max(1, Number(powerSlider.value) - 5);
    localStorage.setItem('terrifront-attack-ratio', powerSlider.value);
    updateRatioDisplay();
  });
  document.getElementById('ratio-plus')?.addEventListener('click', () => {
    powerSlider.value = Math.min(100, Number(powerSlider.value) + 5);
    localStorage.setItem('terrifront-attack-ratio', powerSlider.value);
    updateRatioDisplay();
  });

  window.addEventListener('keydown', function (event) {
    if (!activeGame || event.target.tagName === 'INPUT') return;
    if (event.key === '1') powerSlider.value = Math.max(1, Number(powerSlider.value) - 5);
    if (event.key === '2') powerSlider.value = Math.min(100, Number(powerSlider.value) + 5);
    if (event.key === '1' || event.key === '2') {
      localStorage.setItem('terrifront-attack-ratio', powerSlider.value);
      updateRatioDisplay();
    }
  });

  const savedRatio = localStorage.getItem('terrifront-attack-ratio');
  if (savedRatio !== null && Number(savedRatio) >= 1 && Number(savedRatio) <= 100) powerSlider.value = savedRatio;
  updateRatioDisplay();

  window.TerriGameUI = {
    onSpawnSubmit(handler) {
      spawnSubmitHandler = handler;
    },
    onNukeLaunch(handler) {
      nukeLaunchHandler = handler;
    },
    startNukeAnimation(data) {
      startNukeFlight(data);
    },
    start(data) {
      stopRenderLoop();
      const sessionId = ++gameSessionId;
      gameData = data;
      nukeFlight = null;
      nukeImpactFlash = null;
      nukeShake = null;
      clearNukeInbound();
      setNukeMode(false);
      territoryVersion = 0;
      displayTroops = 0;
      targetTroops = 0;
      localPlayerId = data.playerId;
      activeGame = false;
      gameData.players = [{ playerId: data.playerId, playerName: data.playerName, troops: 0, territorySize: 0 }];
      rebuildPlayerMap();
      gameData.owners = new Int32Array(data.map.width * data.map.height);
      wasteland = new Uint8Array(data.map.width * data.map.height);
      wastelandCanvas.width = data.map.width;
      wastelandCanvas.height = data.map.height;
      labelTerritoryVersion = -1;
      updateWebglOwners();
      updateWebglWasteland();
      updateWebglPalette();
      territoryCanvas.width = data.map.width;
      territoryCanvas.height = data.map.height;
      wastelandImageData = wastelandContext.createImageData(data.map.width, data.map.height);
      territoryImageData = territoryContext.createImageData(data.map.width, data.map.height);
      territoryContext.putImageData(territoryImageData, 0, 0);
      terrain = null;
      expansionTimes = null;
      context.clearRect(0, 0, data.map.width, data.map.height);
      dynamicContext.clearRect(0, 0, data.map.width, data.map.height);
      sceneContext.clearRect(0, 0, sceneCanvas.width, sceneCanvas.height);
      renderState.sceneDirty = true;
      renderState.dynamicDirty = true;
      renderState.labelsDirty = true;
      renderState.labelsCameraDirty = true;
      boats.length = 0;
      playerColorCache = new Map();
      localWaterBorderVersion = -1;
      lastLabelDrawAt = 0;
      loadTerrain(data.map, sessionId).catch((error) => {
        if (sessionId !== gameSessionId) return;
        console.error('Unable to load terrain map:', error);
        spawnMessage.textContent = 'MAP DATA UNAVAILABLE // REFRESH TO RETRY';
      });
      loadExpansionTimes(data.map, sessionId).catch((error) => {
        if (sessionId !== gameSessionId) return;
        console.warn('Expansion times unavailable; using server timing only:', error.message);
      });
      mapFrame.style.aspectRatio = `${data.map.width} / ${data.map.height}`;
      selectedPosition = null;
      selectedSpawnCells = [];
      confirmedPosition = null;
      localCapitalCells = new Set();
      selectedSpawnCells = [];
      hoverPosition = null;
      playerColors.clear();
      selectedColor = playerColors.get(Number(localPlayerId.replace('player-', ''))) || '#69c878';
      spawnPhase = null;
      selectionLocked = false;
      localPlayerEliminated = false;
      localPlayerWon = false;
      winnerBanner.textContent = 'WINNER';
      winnerBanner.hidden = true;
      if (eliminationAnimationFrame) cancelAnimationFrame(eliminationAnimationFrame);
      eliminationAnimationFrame = null;
      resetMapTransform();
      scheduleCanvasResize();
    },
    beginSpawnPhase(data) {
      activeGame = false;
      updateActiveAttacks([]);
      document.getElementById('selector-stats').hidden = true;
      attackRatioPanel.hidden = true;
      leaderboard.hidden = true;
      spawnPhase = data;
      if (data.players?.length) {
        gameData.players = data.players;
        rebuildPlayerMap();
        for (const player of data.players) {
          const ownerId = Number(player.playerId.replace('player-', ''));
          if (player.capitalColor) {
            playerColors.set(ownerId, player.capitalColor);
            if (player.playerId === localPlayerId) selectedColor = player.capitalColor;
          }
        }
        const localOwnerId = Number(localPlayerId.replace('player-', ''));
        if (!selectedColor || selectedColor === '#8b9298') selectedColor = playerColors.get(localOwnerId) || '#69c878';
      }
      updateWebglPalette();
      const spawnChanges = decodeChangesBuf(data);
      if (spawnChanges.length) {
        forEachChange(spawnChanges, (position, owner) => { gameData.owners[position] = owner; });
        updateWebglOwners(spawnChanges);
        updateTerritoryLayer(spawnChanges);
        territoryVersion += 1;
        renderState.labelsDirty = true;
      }
      selectedSpawnCells = [];
      selectionLocked = false;
      spawnHud.hidden = false;
      spawnMessage.textContent = 'CHOOSE A LAND POSITION FOR YOUR CAPITAL';
      clearInterval(timerHandle);
      updateSpawnTimer();
      timerHandle = setInterval(updateSpawnTimer, 50);
      invalidateDynamic();
      draw();
    },
    confirmSpawn(data) {
      const confirmedPlayerId = data.playerId || localPlayerId;
      const isLocalPlayer = confirmedPlayerId === localPlayerId;
      if (isLocalPlayer) {
        spawnMessage.textContent = 'CAPITAL CONFIRMED // GAME STARTING';
        if (data.color) selectedColor = data.color;
      }
      const previousCells = isLocalPlayer ? [...localCapitalCells] : (data.clearedCells || []);
      previousCells.forEach((cell) => { gameData.owners[cell] = 0; });
      const confirmedOwnerId = Number(confirmedPlayerId.replace('player-', ''));
      const player = playerMap.get(confirmedPlayerId);
      if (player) {
        player.spawnPosition = data.position;
        player.capitalColor = data.color;
        player.isAlive = true;
      }
      if (data.color) {
        playerColors.set(confirmedOwnerId, data.color);
        if (confirmedPlayerId === localPlayerId) selectedColor = data.color;
      }
      if (isLocalPlayer) localCapitalCells = new Set(data.cells || []);
      if (data.cells) {
        if (isLocalPlayer) selectedSpawnCells = [...data.cells];
        data.cells.forEach((cell) => { gameData.owners[cell] = confirmedOwnerId; });
        updateWebglOwners([
          ...previousCells.map((position) => ({ position, owner: 0 })),
          ...data.cells.map((position) => ({ position, owner: confirmedOwnerId }))
        ]);
        updateWebglPalette();
        territoryVersion += 1;
        renderState.labelsDirty = true;
        updateTerritoryLayer([
          ...previousCells.map((position) => ({ position, owner: 0 })),
          ...data.cells.map((position) => ({ position, owner: confirmedOwnerId }))
        ]);
      }
      if (isLocalPlayer) {
        confirmedPosition = data.position;
        selectedPosition = null;
      }
      invalidateDynamic();
      draw();
    },
    rejectSpawn(data) {
      selectionLocked = false;
      selectedPosition = confirmedPosition;
      spawnMessage.textContent = `SPAWN REJECTED // ${data.reason}`;
      invalidateDynamic();
      drawDynamic();
    },
    startActiveGame(data) {
      spawnPhase = null;
      activeGame = true;
      localPlayerEliminated = false;
      localPlayerWon = false;
      selectionLocked = true;
      clearInterval(timerHandle);
      spawnHud.hidden = true;
      document.getElementById('selector-stats').hidden = false;
      updateActiveAttacks(data.activeAttacks || []);
      attackRatioPanel.hidden = false;
      updateRatioDisplay();
      leaderboard.hidden = false;
      spawnMessage.textContent = 'GAME ACTIVE // CAPITAL SECURED';
      if (data.players) {
        gameData.players = data.players;
        rebuildPlayerMap();
        data.players.forEach((player) => playerColors.set(Number(player.playerId.replace('player-', '')), player.capitalColor));
        const activeChanges = decodeChangesBuf(data);
        forEachChange(activeChanges, (position, owner) => { gameData.owners[position] = owner; });
        updateWebglOwners(activeChanges);
        updateWebglPalette();
        applyWastelandChanges(data.wastelandChanges || []);
        rebuildTerritoryLayer();
        const player = data.players.find((item) => item.playerId === localPlayerId);
        localCapitalCells = new Set();
        if (player?.capitalColor) selectedColor = player.capitalColor;
        updateLocalTroops(player);
        selectedPosition = player?.spawnPosition ?? null;
      }
      resetInterpolation();
      renderLeaderboard(true);
      draw();
      startRenderLoop();
    },
    onMapAction(handler) {
      mapActionHandler = handler;
    },
    onBoatAction(handler) {
      boatActionHandler = handler;
    },
    applyGameUpdate(data) {
      const localPlayerBeforeAlive = (gameData?.players || []).find((player) => player.playerId === localPlayerId)?.isAlive !== false;
      const now = performance.now();
      if (lastPacketAt) {
        const gap = now - lastPacketAt;
        packetIntervalMs = Math.min(250, Math.max(30, packetIntervalMs * 0.8 + gap * 0.2));
      }
      lastPacketAt = now;
      const hadBoats = boats.length > 0;
      boats.splice(0, boats.length, ...(data.boats || []));
      applyWastelandChanges(data.wastelandChanges || []);
      updateActiveAttacks(data.activeAttacks || []);
      if (hadBoats || boats.length) invalidateDynamic();
      queueChanges(decodeChangesBuf(data));
      let leaderboardDirty = false;
      if (!playerMap.size && gameData?.players?.length) rebuildPlayerMap();
      for (const player of data.players || []) {
        const current = playerMap.get(player.playerId);
        const previous = current ? {
          troops: current.troops,
          territorySize: current.territorySize,
          isAlive: current.isAlive,
          isWinner: current.isWinner,
          expansionActive: current.expansionActive
        } : null;
        if (current) Object.assign(current, player);
        else {
          const nextPlayer = { ...player };
          playerMap.set(player.playerId, nextPlayer);
          gameData.players.push(nextPlayer);
          const ownerId = Number(player.playerId.replace('player-', ''));
          if (player.capitalColor) playerColors.set(ownerId, player.capitalColor);
          leaderboardDirty = true;
        }
        if (current && (
          previous.troops !== player.troops ||
          previous.territorySize !== player.territorySize ||
          previous.isAlive !== player.isAlive ||
          previous.isWinner !== player.isWinner ||
          previous.expansionActive !== player.expansionActive
        )) {
          leaderboardDirty = true;
        }
        if (player.playerId === localPlayerId) updateLocalTroops(current || player);
      }
      // NOTE: We do NOT rebuild gameData.players from playerMap here.
      // playerMap values are the exact same object references that gameData.players
      // already holds, so mutations via Object.assign above are already reflected.
      // Rebuilding the array every packet (~50 ms) with 250 players was causing
      // unnecessary allocations and GC pressure.
      const localPlayerAfter = playerMap.get(localPlayerId) || (gameData?.players || []).find((player) => player.playerId === localPlayerId);
      if (!localPlayerEliminated && localPlayerBeforeAlive && localPlayerAfter?.isAlive === false) {
        localPlayerEliminated = true;
        winnerBanner.textContent = 'LOST';
        winnerBanner.hidden = false;
        activeGame = false;
        setNukeMode(false);
        selectionLocked = true;
        attackRatioPanel.hidden = true;
        updateActiveAttacks([]);
        animateMapToCenter();
      }
      if (!localPlayerWon && localPlayerAfter?.isWinner === true) {
        localPlayerWon = true;
        winnerBanner.hidden = false;
        activeGame = false;
        setNukeMode(false);
        selectionLocked = true;
        attackRatioPanel.hidden = true;
        updateActiveAttacks([]);
        animateMapToCenter();
      }
      updateRatioDisplay();
      if (leaderboardDirty) renderLeaderboard();
      renderState.labelsDirty = true;
      if (!renderLoopRunning) draw();
    },
    rejectExpansion(data) {
      spawnMessage.textContent = `EXPANSION REJECTED // ${data.reason}`;
    },
    stop() {
      gameSessionId += 1;
      stopRenderLoop();
      spawnPhase = null;
      activeGame = false;
      nukeFlight = null;
      nukeImpactFlash = null;
      nukeShake = null;
      clearNukeInbound();
      setNukeMode(false);
      updateActiveAttacks([]);
      winnerBanner.hidden = true;
      // Reset cached leaderboard DOM references so the next session rebuilds
      // them fresh rather than pointing at nodes from the previous game.
      _lbList = null;
      _lbTitle = null;
      leaderboard.innerHTML = '';
    }
  };
}());
