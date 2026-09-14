(function () {
  'use strict';

  const canvas = document.querySelector('#game-canvas');
  const dynamicCanvas = document.querySelector('#dynamic-canvas');
  const mapFrame = document.querySelector('.map-frame');
  const gameScreen = document.querySelector('#game-screen');
  const mapMenu = document.querySelector('#map-menu');
  const spawnHud = document.querySelector('#spawn-hud');
  const spawnTime = document.querySelector('#spawn-time');
  const progressBar = document.querySelector('#spawn-progress-bar');
  const spawnMessage = document.querySelector('#spawn-message');
  const troopDisplay = document.querySelector('#troop-display');
  const troopCount = document.querySelector('#troop-count');
  const territoryCount = document.querySelector('#territory-count');
  const leaderboard = document.querySelector('#leaderboard');
  const cancelButton = document.querySelector('#cancel-button');
  const winnerBanner = document.querySelector('#winner-banner');
  const attackRatioPanel = document.querySelector('#attack-ratio-panel');
  const powerSlider = document.querySelector('#power-slider');
  const ratioPercent = document.querySelector('#ratio-percent');
  const ratioTroops = document.querySelector('#ratio-troops');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const dynamicContext = dynamicCanvas.getContext('2d');
  const terrainCanvas = document.createElement('canvas');
  const terrainContext = terrainCanvas.getContext('2d');
  const territoryCanvas = document.createElement('canvas');
  const territoryContext = territoryCanvas.getContext('2d');
  const sceneCanvas = document.createElement('canvas');
  const sceneContext = sceneCanvas.getContext('2d');
  const renderScale = 1;
  TerriPlayerLabelRenderer.init(document.querySelector('#game-screen'), canvas);
  let gameData = null;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let dragStart = null;
  let dragMoved = false;
  let spawnPhase = null;
  let selectedPosition = null;
  let selectedColor = '#69c878';
  let spawnSubmitHandler = null;
  let timerHandle = null;
  let terrain = null;
  let expansionTimes = null;
  let spawnPoints = new Set();
  let selectionLocked = false;
  let localPlayerId = null;
  let activeGame = false;
  let mapActionHandler = null;
  let boatActionHandler = null;
  let menuPosition = null;
  let mapScale = 1;
  let hoverPosition = null;
  let playerColors = new Map();
  let localCapitalCells = new Set();
  let confirmedPosition = null;
  let currentPower = 500;
  let territoryVersion = 0;
  let eliminationAnimationFrame = null;
  let localPlayerEliminated = false;
  let localPlayerWon = false;
  const TROOP_SMOOTHING_MS = 90;
  const LEADERBOARD_INTERVAL_MS = 250;
  const LABEL_UPDATE_INTERVAL_MS = 250;
  const PLAYER_FOCUS_ZOOM = 4;
  let pendingChanges = [];
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
  let sceneDirty = true;
  let dynamicLayerDirty = true;
  let labelsDirty = true;
  let boats = [];
  let labelsCameraDirty = true;
  let lastLabelDrawAt = 0;
  let labelDrawFrame = null;
  let canvasResizeFrame = null;
  let gameSessionId = 0;

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function formatTroops(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US').replace(/,/g, ' ');
  }

  function updatePowerSlider() {
    const percentage = Math.round(currentPower / 10);
    powerSlider.value = percentage;
    powerSlider.style.setProperty('--slider-fill', `${percentage}%`);
    powerSlider.classList.toggle('is-aggressive', percentage > 70);
  }

  function updateRatioDisplay() {
    const percentage = Number(powerSlider.value);
    currentPower = percentage * 10;
    powerSlider.style.setProperty('--slider-fill', `${percentage}%`);
    powerSlider.classList.toggle('is-aggressive', percentage > 70);
    ratioPercent.textContent = `${percentage}%`;
    const localPlayer = gameData?.players?.find((player) => player.playerId === localPlayerId);
    const troops = Math.floor((localPlayer?.troops || 0) * percentage / 100);
    ratioTroops.textContent = `${formatTroops(troops)} troops`;
  }

  function resetInterpolation() {
    pendingChanges = [];
    pendingHead = 0;
    drainRate = 0;
    drainCarry = 0;
    packetIntervalMs = 100;
    lastPacketAt = 0;
  }

  function queueChanges(changes) {
    if (!changes?.length) return;
    pendingChanges.push(...changes);
    const remaining = pendingChanges.length - pendingHead;
    drainRate = remaining / Math.max(16, packetIntervalMs);
    drainCarry = 0;
  }

  function drainPendingChanges(deltaMs) {
    const remaining = pendingChanges.length - pendingHead;
    if (remaining === 0) return;
    drainCarry += drainRate * deltaMs;
    let budget = Math.floor(drainCarry);
    if (budget < 1) return;
    drainCarry -= budget;
    if (remaining <= budget + 1) budget = remaining;

    const applied = [];
    while (pendingHead < pendingChanges.length && budget > 0) {
      const change = pendingChanges[pendingHead++];
      gameData.owners[change.position] = change.owner;
      applied.push(change);
      budget -= 1;
    }
    if (pendingHead >= pendingChanges.length) {
      pendingChanges = [];
      pendingHead = 0;
    } else if (pendingHead > 4096) {
      pendingChanges = pendingChanges.slice(pendingHead);
      pendingHead = 0;
    }
    if (applied.length) {
      updateTerritoryLayer(applied);
      territoryVersion += 1;
      labelsDirty = true;
    }
  }

  function smoothTroops(deltaMs) {
    const alpha = 1 - Math.exp(-deltaMs / TROOP_SMOOTHING_MS);
    displayTroops += (targetTroops - displayTroops) * alpha;
    if (Math.abs(targetTroops - displayTroops) < 0.5) displayTroops = targetTroops;
    troopCount.textContent = formatTroops(displayTroops);
  }

  function renderFrame(timestamp) {
    if (!renderLoopRunning) return;
    const deltaMs = lastFrameAt ? Math.min(200, timestamp - lastFrameAt) : 16;
    lastFrameAt = timestamp;
    drainPendingChanges(deltaMs);
    smoothTroops(deltaMs);
    drawScene();
    drawDynamic();
    if (labelsDirty && (labelsCameraDirty || performance.now() - lastLabelDrawAt >= LABEL_UPDATE_INTERVAL_MS)) drawLabels();
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
    if (canvasResizeFrame !== null) cancelAnimationFrame(canvasResizeFrame);
    canvasResizeFrame = null;
  }

  function applyMapTransform() {
    const maxPanX = Math.max(260, (mapFrame.clientWidth * zoom - window.innerWidth) / 2 + 100);
    const maxPanY = Math.max(220, (mapFrame.clientHeight * zoom - window.innerHeight) / 2 + 100);
    panX = clamp(panX, -maxPanX, maxPanX);
    panY = clamp(panY, -maxPanY, maxPanY);
    mapFrame.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
    labelsCameraDirty = true;
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
    mapScale = renderScale * Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${mapFrame.clientWidth}px`;
    canvas.style.height = `${mapFrame.clientHeight}px`;
    dynamicCanvas.style.width = `${canvas.offsetWidth}px`;
    dynamicCanvas.style.height = `${canvas.offsetHeight}px`;
    canvas.width = Math.ceil(width * mapScale);
    canvas.height = Math.ceil(height * mapScale);
    dynamicCanvas.width = Math.ceil(width * mapScale);
    dynamicCanvas.height = Math.ceil(height * mapScale);
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

  function mapMetrics() {
    const width = gameData.map.width;
    const height = gameData.map.height;
    const imageWidth = width;
    const imageHeight = height;
    return {
      width,
      height,
      imageWidth,
      imageHeight,
      offsetX: (width - imageWidth) / 2,
      offsetY: (height - imageHeight) / 2,
      cellWidth: imageWidth / gameData.map.width,
      cellHeight: imageHeight / gameData.map.height
    };
  }

  function drawCapital(position, color) {
    if (!Number.isInteger(position) || position < 0 || position >= gameData.map.width * gameData.map.height) return;
    const centerX = position % gameData.map.width;
    const centerY = Math.floor(position / gameData.map.width);
    const colors = warFrontPlayerColors(color);
    dynamicContext.save();
    dynamicContext.lineWidth = 1;
    dynamicContext.fillStyle = colors.territory;
    dynamicContext.strokeStyle = colors.border;
    dynamicContext.lineWidth = 1;
    for (let y = -2; y <= 2; y += 1) {
      for (let x = -2; x <= 2; x += 1) {
        if (Math.abs(x) === 2 && Math.abs(y) === 2) continue;
        dynamicContext.fillRect(centerX + x, centerY + y, 1, 1);
        dynamicContext.strokeRect(centerX + x, centerY + y, 1, 1);
      }
    }
    dynamicContext.restore();
  }

  function decodeTerrain(encodedTerrain) {
    const binary = atob(encodedTerrain);
    terrain = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) terrain[index] = binary.charCodeAt(index);
  }

  function decodeEmbeddedBytes(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function loadTerrain(mapData, sessionId) {
    if (window.TerriEmbeddedTerrain) {
      const decodedTerrain = decodeEmbeddedBytes(window.TerriEmbeddedTerrain);
      if (sessionId !== gameSessionId) return;
      terrain = decodedTerrain;
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
    buildTerrainLayer();
    draw();
  }

  async function loadExpansionTimes(mapData, sessionId) {
    if (!mapData.expansionTimesUrl) return;
    if (window.TerriEmbeddedExpansionTimes) {
      const decodedExpansionTimes = decodeEmbeddedBytes(window.TerriEmbeddedExpansionTimes);
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
        if ((terrain[y * gameData.map.width + x] & 0x80) === 0) return false;
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
        pixels.data[pixel] = 126 + magnitude * 3;
        pixels.data[pixel + 1] = 157 + Math.min(30, magnitude);
        pixels.data[pixel + 2] = 108 + Math.min(45, magnitude * 2);
      } else {
        pixels.data[pixel] = 25;
        pixels.data[pixel + 1] = 25;
        pixels.data[pixel + 2] = 95;
      }
      pixels.data[pixel + 3] = 255;
    }
    terrainContext.putImageData(pixels, 0, 0);
    composeSceneLayer();
  }

  function warFrontPlayerColors(color) {
    const hexMatch = String(color).match(/^#([0-9a-f]{6})$/i);
    if (hexMatch) {
      const red = parseInt(hexMatch[1].slice(0, 2), 16);
      const green = parseInt(hexMatch[1].slice(2, 4), 16);
      const blue = parseInt(hexMatch[1].slice(4, 6), 16);
      return {
        territory: `rgb(${red},${green},${blue})`,
        border: `rgba(${Math.floor(red * 0.6)},${Math.floor(green * 0.6)},${Math.floor(blue * 0.6)},1)`
      };
    }

    const match = String(color).match(/hsl\(\s*([\d.-]+),\s*([\d.-]+)%\s*,\s*([\d.-]+)%\s*\)/);
    if (!match) return { territory: color, border: color };
    const hue = Number(match[1]);
    const saturation = Number(match[2]) * 0.5;
    return {
      territory: `hsl(${hue}, ${saturation}%, 58%)`,
      border: `hsla(${hue}, ${saturation}%, 37.5%, 1)`
    };
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
    const x = position % width;
    const y = Math.floor(position / width);
    territoryContext.clearRect(x, y, 1, 1);
    if (!owner) return;
    const colors = warFrontPlayerColors(playerColors.get(owner) || selectedColor);
    territoryContext.fillStyle = colors.territory;
    territoryContext.fillRect(x, y, 1, 1);
    if (isBorderCell(position, owner)) {
      territoryContext.fillStyle = colors.border;
      territoryContext.fillRect(x, y, 1, 1);
    }
  }

  function rebuildTerritoryLayer() {
    if (!gameData?.owners) return;
    territoryCanvas.width = gameData.map.width;
    territoryCanvas.height = gameData.map.height;
    territoryContext.clearRect(0, 0, gameData.map.width, gameData.map.height);
    for (let position = 0; position < gameData.owners.length; position += 1) {
      paintTerritoryTile(position);
    }
    composeSceneLayer();
  }

  function updateTerritoryLayer(changes) {
    const affected = new Set();
    for (const change of changes || []) {
      affected.add(change.position);
      for (const neighbor of mapNeighbors(change.position)) affected.add(neighbor);
    }
    for (const position of affected) paintTerritoryTile(position);
    composeSceneLayer();
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
    if (territoryCanvas.width === width && territoryCanvas.height === height) {
      sceneContext.drawImage(territoryCanvas, 0, 0, width, height);
    }
    sceneDirty = true;
  }

  function mapNeighbors(position) {
    const width = gameData.map.width;
    const height = gameData.map.height;
    const x = position % width;
    const neighbors = [];
    if (x > 0) neighbors.push(position - 1);
    if (x < width - 1) neighbors.push(position + 1);
    if (position >= width) neighbors.push(position - width);
    if (position < width * height - width) neighbors.push(position + width);
    return neighbors;
  }

  function drawHover() {
    if (hoverPosition === null || !spawnPhase || selectionLocked || !isValidCapital(hoverPosition)) return;
    const x = hoverPosition % gameData.map.width;
    const y = Math.floor(hoverPosition / gameData.map.width);
    dynamicContext.save();
    dynamicContext.strokeStyle = '#f4d35e';
    dynamicContext.lineWidth = 1;
    dynamicContext.globalAlpha = 0.9;
    dynamicContext.strokeRect(x - 2.5, y - 2.5, 6, 6);
    dynamicContext.restore();
  }

  function drawSpawnPoints() {
    if (!spawnPhase || spawnPoints.size === 0) return;
    dynamicContext.save();
    dynamicContext.fillStyle = 'rgba(154, 162, 166, 0.9)';
    dynamicContext.globalAlpha = 0.9;
    for (const position of spawnPoints) {
      if (!isValidCapital(position)) continue;
      const centerX = position % gameData.map.width;
      const centerY = Math.floor(position / gameData.map.width);
      for (let y = -2; y <= 2; y += 1) {
        for (let x = -2; x <= 2; x += 1) {
          if (Math.abs(x) === 2 && Math.abs(y) === 2) continue;
          dynamicContext.fillRect(centerX + x, centerY + y, 1, 1);
        }
      }
    }
    dynamicContext.restore();
  }

  function renderLeaderboard(force = false) {
    if (!gameData?.players || !leaderboard) return;
    const now = performance.now();
    if (!force && now - leaderboardAt < LEADERBOARD_INTERVAL_MS) return;
    leaderboardAt = now;
    const ranked = [...gameData.players].sort((a, b) =>
      (b.territorySize || 0) - (a.territorySize || 0) || (b.troops || 0) - (a.troops || 0));
    let list = leaderboard.querySelector('.leaderboard-list');
    const scrollTop = list?.scrollTop || 0;
    const rankedEntries = ranked.map((player, index) => ({ player, index }));
    const localIndex = ranked.findIndex((player) => player.playerId === localPlayerId);
    const initialEntries = rankedEntries.slice(0, 9);
    if (localIndex >= 9) initialEntries.push(rankedEntries[localIndex]);
    const initialIds = new Set(initialEntries.map(({ player }) => player.playerId));
    const displayEntries = [
      ...initialEntries,
      ...rankedEntries.filter(({ player }) => !initialIds.has(player.playerId))
    ];
    if (!list) {
      leaderboard.innerHTML = '<div class="leaderboard-title"></div><div class="leaderboard-list"></div>';
      list = leaderboard.querySelector('.leaderboard-list');
    }
    leaderboard.querySelector('.leaderboard-title').innerHTML = `LIVE RANKING <span>${ranked.length} PLAYERS</span>`;
    const rows = document.createDocumentFragment();
    displayEntries.forEach(({ player, index }) => {
      const ownerId = Number(player.playerId.replace('player-', ''));
      const color = playerColors.get(ownerId) || '#69c878';
      const row = document.createElement('div');
      row.className = `leaderboard-row${player.playerId === localPlayerId ? ' is-local' : ''}${player.isBot ? ' is-bot' : ''}${player.isAlive === false ? ' is-eliminated' : ''}`;
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
      row.innerHTML = `<span class="leaderboard-rank">${index + 1}</span><span class="leaderboard-swatch" style="background:${color}"></span><span class="leaderboard-name"></span><span class="leaderboard-values">${formatTroops(player.troops)}<br>${player.territorySize || 0} tiles</span>`;
      row.querySelector('.leaderboard-name').textContent = `${player.isBot ? 'BOT ' : ''}${player.playerName || player.playerId}`;
      rows.appendChild(row);
    });
    list.replaceChildren(rows);
    list.scrollTop = scrollTop;
  }

  function updateLocalTroops(player) {
    if (!player) return;
    targetTroops = player.troops || 0;
    if (!renderLoopRunning) {
      displayTroops = targetTroops;
      troopCount.textContent = formatTroops(targetTroops);
    }
    territoryCount.textContent = player.territorySize || 0;
    troopDisplay.classList.toggle('is-attacking', Boolean(player.expansionActive));
    cancelButton.hidden = !player.expansionActive;
    updateRatioDisplay();
  }

  function drawScene() {
    if (!gameData || !terrain) return;
    const width = gameData.map.width;
    const height = gameData.map.height;
    if (!sceneDirty) return;
    context.clearRect(0, 0, width, height);
    context.drawImage(sceneCanvas, 0, 0, width, height);
    sceneDirty = false;
  }

  function drawDynamic() {
    if (!gameData || !terrain || !dynamicLayerDirty) return;
    const width = gameData.map.width;
    const height = gameData.map.height;
    dynamicContext.clearRect(0, 0, width, height);
    drawSpawnPoints();
    if (spawnPhase && gameData.players) {
      for (const player of gameData.players) {
        if (player.spawnPosition == null || !player.capitalColor) continue;
        if (player.playerId === localPlayerId) continue;
        drawCapital(player.spawnPosition, player.capitalColor);
      }
    }
    if (spawnPhase && selectedPosition !== null) drawCapital(selectedPosition, selectedColor);
    drawBoats();
    drawHover();
    dynamicLayerDirty = false;
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
    TerriPlayerLabelRenderer.draw(gameData, zoom, territoryVersion);
    labelsDirty = false;
    labelsCameraDirty = false;
    lastLabelDrawAt = performance.now();
  }

  function scheduleLabelDraw() {
    labelsDirty = true;
    if (labelDrawFrame !== null) return;
    labelDrawFrame = requestAnimationFrame(() => {
      labelDrawFrame = null;
      if (gameData && terrain && labelsDirty && labelsCameraDirty) drawLabels();
    });
  }

  function invalidateDynamic() {
    dynamicLayerDirty = true;
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
    const metrics = mapMetrics();
    const mapX = Math.floor((localX - metrics.offsetX) / metrics.cellWidth);
    const mapY = Math.floor((localY - metrics.offsetY) / metrics.cellHeight);
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
    zoom = clamp(zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.1, 200);
    applyMapTransform();
  }, { passive: false });

  mapFrame.addEventListener('pointerdown', function (event) {
    if (event.button !== 0) return;
    if (eliminationAnimationFrame) return;
    dragStart = { x: event.clientX - panX, y: event.clientY - panY };
    dragMoved = false;
    mapFrame.setPointerCapture(event.pointerId);
    mapFrame.classList.add('is-dragging');
  });

  mapFrame.addEventListener('pointermove', function (event) {
    if (!dragStart) return;
    if (Math.abs(event.clientX - dragStart.x - panX) > 6 || Math.abs(event.clientY - dragStart.y - panY) > 6) dragMoved = true;
    panX = event.clientX - dragStart.x;
    panY = event.clientY - dragStart.y;
    applyMapTransform();
    hoverPosition = positionFromPointer(event);
    invalidateDynamic();
    drawDynamic();
  });

  mapFrame.addEventListener('pointerleave', function () {
    hoverPosition = null;
    invalidateDynamic();
    drawDynamic();
  });

  function stopDragging(event) {
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
        selectedColor = randomColor();
        spawnMessage.textContent = 'CAPITAL SELECTED // CLICK AGAIN TO REPLACE';
        spawnSubmitHandler?.({ playerId: spawnPhase.playerId, position: selectedPosition });
        invalidateDynamic();
        drawDynamic();
      }
    } else if (wasClick && activeGame) {
      const position = positionFromPointer(event);
      const ownerId = Number(localPlayerId.replace('player-', ''));
      if (position !== null && (terrain[position] & 0x80) !== 0 && gameData.owners[position] !== ownerId) {
        troopDisplay.classList.add('is-attacking');
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
    for (let position = 0; position < gameData.owners.length; position += 1) {
      if (gameData.owners[position] !== ownerId) continue;
      if (mapNeighbors(position).some((neighbor) => (terrain[neighbor] & 0x80) === 0)) return true;
    }
    return false;
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
      troopDisplay.classList.add('is-attacking');
      mapActionHandler?.({ playerId: localPlayerId, position });
    } else if (action === 'boat') {
      troopDisplay.classList.add('is-attacking');
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

  cancelButton.addEventListener('click', function () {
    window.TerriCommunicator?.send(window.TerriBinaryProtocol.encodeCancelExpansion(localPlayerId));
    cancelButton.hidden = true;
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
    start(data) {
      stopRenderLoop();
      const sessionId = ++gameSessionId;
      gameData = data;
      territoryVersion = 0;
      displayTroops = 0;
      targetTroops = 0;
      localPlayerId = data.playerId;
      activeGame = false;
      gameData.players = [{ playerId: data.playerId, playerName: data.playerName, troops: 0, territorySize: 0 }];
      gameData.owners = new Int32Array(data.map.width * data.map.height);
      territoryCanvas.width = data.map.width;
      territoryCanvas.height = data.map.height;
      territoryContext.clearRect(0, 0, data.map.width, data.map.height);
      terrain = null;
      expansionTimes = null;
      context.clearRect(0, 0, data.map.width, data.map.height);
      dynamicContext.clearRect(0, 0, data.map.width, data.map.height);
      sceneContext.clearRect(0, 0, sceneCanvas.width, sceneCanvas.height);
      sceneDirty = true;
      dynamicLayerDirty = true;
      labelsDirty = true;
      labelsCameraDirty = true;
      boats = [];
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
      confirmedPosition = null;
      localCapitalCells = new Set();
      hoverPosition = null;
      playerColors = new Map();
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
      troopDisplay.hidden = true;
      attackRatioPanel.hidden = true;
      leaderboard.hidden = true;
      spawnPhase = data;
      spawnPoints = new Set(data.spawnPoints || []);
      selectionLocked = false;
      spawnHud.hidden = false;
      spawnMessage.textContent = 'CHOOSE A LAND POSITION FOR YOUR CAPITAL';
      clearInterval(timerHandle);
      updateSpawnTimer();
      timerHandle = setInterval(updateSpawnTimer, 50);
      invalidateDynamic();
      drawDynamic();
    },
    confirmSpawn(data) {
      spawnMessage.textContent = 'CAPITAL CONFIRMED // GAME STARTING';
      if (data.color) selectedColor = data.color;
      const previousCells = [...localCapitalCells];
      previousCells.forEach((cell) => { gameData.owners[cell] = 0; });
      localCapitalCells = new Set(data.cells || []);
      if (data.cells) {
        const ownerId = Number(localPlayerId.replace('player-', ''));
        data.cells.forEach((cell) => { gameData.owners[cell] = ownerId; });
        territoryVersion += 1;
        labelsDirty = true;
        updateTerritoryLayer([
          ...previousCells.map((position) => ({ position, owner: 0 })),
          ...data.cells.map((position) => ({ position, owner: ownerId }))
        ]);
      }
      confirmedPosition = data.position;
      selectedPosition = data.position;
      invalidateDynamic();
      drawDynamic();
      scheduleLabelDraw();
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
      troopDisplay.hidden = false;
      attackRatioPanel.hidden = false;
      updateRatioDisplay();
      leaderboard.hidden = false;
      spawnMessage.textContent = 'GAME ACTIVE // CAPITAL SECURED';
      if (data.players) {
        gameData.players = data.players;
        data.players.forEach((player) => playerColors.set(Number(player.playerId.replace('player-', '')), player.capitalColor));
        for (const change of data.changes || []) gameData.owners[change.position] = change.owner;
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
      const localPlayerBeforeAlive = gameData.players.find((player) => player.playerId === localPlayerId)?.isAlive !== false;
      const now = performance.now();
      if (lastPacketAt) {
        const gap = now - lastPacketAt;
        packetIntervalMs = Math.min(250, Math.max(30, packetIntervalMs * 0.8 + gap * 0.2));
      }
      lastPacketAt = now;
      const hadBoats = boats.length > 0;
      boats = data.boats || [];
      if (hadBoats || boats.length) invalidateDynamic();
      queueChanges(data.changes);
      for (const player of data.players || []) {
        const current = gameData.players.find((item) => item.playerId === player.playerId);
        if (current) Object.assign(current, player);
        else {
          gameData.players.push({ ...player });
          const ownerId = Number(player.playerId.replace('player-', ''));
          if (player.capitalColor) playerColors.set(ownerId, player.capitalColor);
        }
        if (player.playerId === localPlayerId) updateLocalTroops(current || player);
      }
      const localPlayerAfter = gameData.players.find((player) => player.playerId === localPlayerId);
      if (!localPlayerEliminated && localPlayerBeforeAlive && localPlayerAfter?.isAlive === false) {
        localPlayerEliminated = true;
        winnerBanner.textContent = 'LOST';
        winnerBanner.hidden = false;
        activeGame = false;
        selectionLocked = true;
        attackRatioPanel.hidden = true;
        cancelButton.hidden = true;
        troopDisplay.classList.remove('is-attacking');
        animateMapToCenter();
      }
      if (!localPlayerWon && localPlayerAfter?.isWinner === true) {
        localPlayerWon = true;
        winnerBanner.hidden = false;
        activeGame = false;
        selectionLocked = true;
        attackRatioPanel.hidden = true;
        cancelButton.hidden = true;
        troopDisplay.classList.remove('is-attacking');
        animateMapToCenter();
      }
      updateRatioDisplay();
      renderLeaderboard();
      labelsDirty = true;
      if (!renderLoopRunning) draw();
    },
    rejectExpansion(data) {
      troopDisplay.classList.remove('is-attacking');
      spawnMessage.textContent = `EXPANSION REJECTED // ${data.reason}`;
    },
    stop() {
      gameSessionId += 1;
      stopRenderLoop();
      spawnPhase = null;
      activeGame = false;
      winnerBanner.hidden = true;
    }
  };
}());
