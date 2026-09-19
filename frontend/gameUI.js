(function () {
  'use strict';

  const modules = window.TerriGameModules || {};
  const clamp = modules.mathUtils.clamp;
  const formatTroops = modules.formatUtils.formatTroops;
  const changeBuffer = modules.changeBuffer;
  const nukeGeometry = modules.nukeGeometry;
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
  const attackRatioPanel = document.querySelector('#attack-ratio-panel');
  const powerSlider = document.querySelector('#power-slider');
  const nukeTrigger = document.querySelector('#nuke-trigger');
  const nukeControls = document.querySelector('#nuke-controls');
  const nukeSelectTarget = document.querySelector('#nuke-select-target');
  const nukeLaunch = document.querySelector('#nuke-launch');
  const nukeCancel = document.querySelector('#nuke-cancel');
  const nukeStatus = document.querySelector('#nuke-status');
  const nukeInboundBanner = document.querySelector('#nuke-inbound-banner');
  const nukeVignette = document.querySelector('#nuke-vignette');
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
  let terrain = null;
  let wasteland = null;
  let expansionTimes = null;
  let selectionLocked = false;
  let localPlayerId = null;
  let activeGame = false;
  let mapActionHandler = null;
  let boatActionHandler = null;
  let hoverPosition = null;
  let localCapitalCells = new Set();
  let selectedSpawnCells = [];
  let confirmedPosition = null;
  let currentPower = 500;
  let territoryVersion = 0;
  let localPlayerEliminated = false;
  let localPlayerWon = false;
  let nukeMode = false;
  let nukeSelecting = false;
  let nukeTarget = null;
  let nukeFlight = null;
  let nukeShake = null;
  let nukeInbound = false;
  const TROOP_SMOOTHING_MS = 90;
  let packetIntervalMs = 100;
  let lastPacketAt = 0;
  let displayTroops = 0;
  let targetTroops = 0;
  let troopUpdateWatchdog = null;
  let lastTroopUpdateAt = 0;

  let gameSessionId = 0;

  function applyWastelandChanges(changes = []) {
    if (!wasteland || !changes.length) return;
    for (const change of changes) {
      const position = typeof change === 'number' ? change : change.position;
      const value = typeof change === 'number' ? 1 : change.value;
      if (position >= 0 && position < wasteland.length) wasteland[position] = value;
    }
    webglSync.updateWasteland(changes);
    sceneRenderer.updateWasteland(changes);
    renderState.sceneDirty = true;
  }

  const NUKE_RADIUS = 30;
  const nukeCircleOffsets = [];
  for (let offsetY = -NUKE_RADIUS; offsetY <= NUKE_RADIUS; offsetY += 1) {
    const width = Math.round(Math.sqrt(NUKE_RADIUS ** 2 - offsetY ** 2));
    nukeCircleOffsets.push({ offsetY, minX: -width, maxX: width });
  }

  function isNukeTargetingLocalPlayer(targetPosition) {
    if (!gameData?.owners || !localPlayerId) return false;
    const width = gameData.map.width;
    const height = gameData.map.height;
    const ownerId = Number(localPlayerId.replace('player-', ''));
    const centerX = targetPosition % width;
    const centerY = Math.floor(targetPosition / width);
    for (const row of nukeCircleOffsets) {
      const y = centerY + row.offsetY;
      if (y < 0 || y >= height) continue;
      const minX = Math.max(0, centerX + row.minX);
      const maxX = Math.min(width - 1, centerX + row.maxX);
      for (let x = minX; x <= maxX; x += 1) {
        if (gameData.owners[y * width + x] === ownerId) return true;
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

  function updatePowerSlider() {
    const percentage = Math.round(currentPower / 10);
    powerSlider.value = percentage;
    updateRatioDisplay();
  }

  function updateRatioDisplay() {
    const percentage = Number(powerSlider.value);
    currentPower = percentage * 10;
    const localPlayer = gameData?.players?.find((player) => player.playerId === localPlayerId);
    ratioDisplay.update(percentage, localPlayer);
  }

  function resetInterpolation() {
    packetIntervalMs = 100;
    lastPacketAt = 0;
  }

  // Keep offline updates flat; only the multiplayer compatibility path needs a
  // one-time conversion from its legacy object array.
  function smoothTroops(deltaMs) {
    const alpha = 1 - Math.exp(-deltaMs / TROOP_SMOOTHING_MS);
    displayTroops += (targetTroops - displayTroops) * alpha;
    if (Math.abs(targetTroops - displayTroops) < 0.5) displayTroops = targetTroops;
  }

  function startRenderLoop() {
    renderLoop.start();
  }

  function stopRenderLoop() {
    renderLoop.stop();
    spawnHudController.stop();
    cameraController.cancel();
    labelScheduler.stop();
    dynamicScheduler.stop();
    canvasResizer.stop();
    mapGestures.stop();
  }

  function getNukeShakeOffset() {
    if (!nukeShake) return { x: 0, y: 0 };
    const elapsed = performance.now() - nukeShake.startedAt;
    if (elapsed >= nukeShake.durationMs) {
      nukeShake = null;
      return { x: 0, y: 0 };
    }
    const progress = elapsed / nukeShake.durationMs;
    const magnitude = nukeShake.strength * (1 - progress) ** 3;
    const bucket = Math.floor(elapsed / 16);
    const horizontal = (bucket * 1664525 + 1013904223) & 0xffffffff;
    const vertical = (bucket * 22695477 + 1) & 0xffffffff;
    return {
      x: (((horizontal >>> 16) & 0xff) / 127.5 - 1) * magnitude,
      y: (((vertical >>> 16) & 0xff) / 127.5 - 1) * magnitude
    };
  }

  function stopTroopUpdateWatchdog() {
    if (troopUpdateWatchdog !== null) clearTimeout(troopUpdateWatchdog);
    troopUpdateWatchdog = null;
  }

  function scheduleTroopUpdateWatchdog() {
    stopTroopUpdateWatchdog();
    if (!activeGame) return;
    troopUpdateWatchdog = setTimeout(() => {
      const elapsedMs = performance.now() - lastTroopUpdateAt;
      console.warn('[TerriFront] No troop value update received after active game start', {
        elapsedMs: Math.round(elapsedMs),
        playerId: localPlayerId
      });
      scheduleTroopUpdateWatchdog();
    }, 5000);
  }

  function logTroopUpdate(player, tickCount, previousTroops) {
    lastTroopUpdateAt = performance.now();
    console.info('[TerriFront] Troop update received', {
      tickCount,
      playerId: player.playerId,
      previousTroops,
      troops: player.troops,
      territorySize: player.territorySize
    });
    scheduleTroopUpdateWatchdog();
  }

  function applyMapTransform() {
    mapTransform.apply();
  }

  function resetMapTransform() {
    mapTransform.reset();
  }

  function animateMapToCenter() {
    dragStart = null;
    dragMoved = false;
    cameraController.animateToCenter();
  }

  function focusPlayer(playerId) {
    if (gameData) cameraController.focusPlayer(playerId, territoryVersion);
  }

  function getCapitalCells(position) {
    return mapGeometry.getCapitalCells(position, gameData.map.width, gameData.map.height);
  }

  function isAvailableCapital(position) {
    const cells = getCapitalCells(position);
    return cells.length === 21 && cells.every((cell) => gameData.owners[cell] === 0);
  }

  function drawCapital(position, color) {
    dynamicRenderer.drawCapital(position, color);
  }

  async function loadTerrain(mapData, sessionId) {
    const loadedTerrain = await mapAssets.loadTerrain(mapData);
    if (sessionId !== gameSessionId) return;
    terrain = loadedTerrain;
    if (webglRenderer) webglRenderer.setTerrain(terrain, mapData.width, mapData.height);
    sceneRenderer.buildTerrain();
    draw();
  }

  async function loadExpansionTimes(mapData, sessionId) {
    const loadedExpansionTimes = await mapAssets.loadExpansionTimes(mapData);
    if (!loadedExpansionTimes || sessionId !== gameSessionId) return;
    expansionTimes = loadedExpansionTimes;
  }

  function hashPosition(position) {
    let value = position + 1;
    value = (value ^ (value >>> 16)) * 0x45d9f3b;
    value = (value ^ (value >>> 16)) * 0x45d9f3b;
    return (value ^ (value >>> 16)) >>> 0;
  }

  function mapNeighbors(position) {
    return mapGeometry.mapNeighbors(position, gameData.map.width, gameData.map.height);
  }

  function drawHover() {
    dynamicRenderer.draw();
  }

  function drawNukeTarget() {
    dynamicRenderer.draw();
  }

  function drawNukeFlight(timestamp) {
    if (!nukeFlight) return;
    const width = gameData.map.width;
    const start = { x: nukeFlight.start % width + 0.5, y: Math.floor(nukeFlight.start / width) + 0.5 };
    const end = { x: nukeFlight.target % width + 0.5, y: Math.floor(nukeFlight.target / width) + 0.5 };
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const distance = Math.hypot(deltaX, deltaY);
    const requestedArcHeight = Math.max(50, distance / 3);
    const upwardRoom = Math.min(start.y, end.y) - 0.5;
    const downwardRoom = gameData.map.height - 0.5 - Math.max(start.y, end.y);
    const arcSign = upwardRoom >= downwardRoom ? -1 : 1;
    const availableRoom = Math.max(1, arcSign < 0 ? upwardRoom : downwardRoom);
    const arcHeight = Math.min(requestedArcHeight, availableRoom);
    const firstControl = {
      x: start.x + deltaX / 4,
      y: clamp(start.y + deltaY / 4 + arcSign * arcHeight, 0.5, gameData.map.height - 0.5)
    };
    const secondControl = {
      x: start.x + deltaX * 3 / 4,
      y: clamp(start.y + deltaY * 3 / 4 + arcSign * arcHeight, 0.5, gameData.map.height - 0.5)
    };
    const progress = Math.min(1, (timestamp - nukeFlight.startedAt) / nukeFlight.durationMs);
    const trailStart = Math.max(0, progress - 0.22);
    const position = nukeGeometry.cubicPoint(start, firstControl, secondControl, end, progress);
    const previous = nukeGeometry.cubicPoint(start, firstControl, secondControl, end, Math.max(0, progress - 0.02));
    const angle = Math.atan2(position.y - previous.y, position.x - previous.x);

    dynamicContext.save();
    dynamicContext.lineCap = 'round';
    const trailSamples = 16;
    for (let index = 0; index < trailSamples; index += 1) {
      const segmentStart = trailStart + (progress - trailStart) * index / trailSamples;
      const segmentEnd = trailStart + (progress - trailStart) * (index + 1) / trailSamples;
      const trailPoint = nukeGeometry.cubicPoint(start, firstControl, secondControl, end, segmentStart);
      const nextTrailPoint = nukeGeometry.cubicPoint(start, firstControl, secondControl, end, segmentEnd);
      dynamicContext.globalAlpha = 0.12 + index / trailSamples * 0.72;
      dynamicContext.strokeStyle = '#ffffff';
      dynamicContext.lineWidth = 1.1 + index / trailSamples;
      dynamicContext.beginPath();
      dynamicContext.moveTo(trailPoint.x, trailPoint.y);
      dynamicContext.lineTo(nextTrailPoint.x, nextTrailPoint.y);
      dynamicContext.stroke();
    }

    dynamicContext.translate(position.x, position.y);
    dynamicContext.rotate(angle);
    dynamicContext.globalAlpha = 1;
    dynamicContext.fillStyle = '#f4f3ea';
    dynamicContext.strokeStyle = '#071221';
    dynamicContext.lineWidth = 0.9;
    dynamicContext.beginPath();
    dynamicContext.moveTo(7, 0);
    dynamicContext.lineTo(2, -2);
    dynamicContext.lineTo(-5, -1.5);
    dynamicContext.lineTo(-7, 0);
    dynamicContext.lineTo(-5, 1.5);
    dynamicContext.lineTo(2, 2);
    dynamicContext.closePath();
    dynamicContext.fill();
    dynamicContext.stroke();
    dynamicContext.fillStyle = '#e86b52';
    dynamicContext.fillRect(-3, -1, 3, 2);
    dynamicContext.restore();

    if (progress >= 1) {
      nukeFlight = null;
      nukeLaunch.disabled = true;
      nukeSelectTarget.disabled = false;
      nukeStatus.textContent = 'IMPACT REGISTERED // DAMAGE OFFLINE';
    }
  }

  function startNukeFlight(data) {
    const start = data?.startPosition ?? data?.start;
    const target = data?.targetPosition ?? data?.target;
    if (!gameData || !Number.isInteger(start) || !Number.isInteger(target)) return;
    nukeFlight = {
      start,
      target,
      startedAt: performance.now(),
      durationMs: Math.max(3750, Number(data.durationMs) || 3750)
    };
    if (isNukeTargetingLocalPlayer(target)) showNukeInbound();
    invalidateDynamic();
  }

  function rebuildPlayerMap() {
    playerRegistry.rebuild(gameData?.players || []);
  }

  function updateActiveAttacks(attacks) {
    activeAttacksRenderer.render(attacks, localPlayerId);
  }

  function updateLocalTroops(player) {
    playerStatsRenderer.render(player);
  }

  function drawScene() {
    sceneRenderer.draw();
  }

  function drawDynamic() {
    dynamicRenderer.draw();
  }

  function scheduleDynamicDraw() {
    dynamicScheduler.schedule();
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
      const colors = colorCache.playerColors(playerColors.get(boat.ownerId) || '#f4d35e');
      dynamicContext.fillStyle = colors.territory;
      dynamicContext.fillRect(x - 1, y - 1, 3, 3);
      dynamicContext.fillStyle = colors.border;
      dynamicContext.fillRect(x, y, 1, 1);
    }
    dynamicContext.restore();
  }

  function drawLabels() {
    labelScheduler.draw();
  }

  function scheduleLabelDraw() {
    labelScheduler.schedule();
  }

  function invalidateDynamic() {
    dynamicScheduler.invalidate();
  }

  function draw() {
    drawScene();
    invalidateDynamic();
    drawDynamic();
    drawLabels();
  }

  const webglSync = modules.webglSync.createWebglSync({
    renderer: webglRenderer,
    renderState,
    getGameData: () => gameData,
    getWasteland: () => wasteland,
    getPlayerColors: () => playerColors,
    getSelectedColor: () => selectedColor
  });
  const colorCache = modules.colorCache.createColorCache({
    colorUtils,
    getGameData: () => gameData,
    getPlayerColors: () => playerColors,
    getSelectedColor: () => selectedColor
  });
  const ratioDisplay = modules.ratioDisplay.createRatioDisplay({ formatTroops });
  const playerRegistry = modules.playerRegistry.createPlayerRegistry(playerMap);
  const labelScheduler = modules.labelScheduler.createLabelScheduler({
    renderer: TerriPlayerLabelRenderer,
    renderState,
    intervalMs: 500,
    getGameData: () => gameData,
    getTerrain: () => terrain,
    getZoom: () => zoom,
    getTerritoryVersion: () => territoryVersion
  });
  const sceneRenderer = modules.sceneRenderer.createSceneRenderer({
    getGameData: () => gameData,
    getTerrain: () => terrain,
    getWasteland: () => wasteland,
    terrainCanvas,
    terrainContext,
    wastelandCanvas,
    wastelandContext,
    territoryCanvas,
    territoryContext,
    sceneCanvas,
    sceneContext,
    context,
    renderState,
    webglRenderer,
    webglSync,
    colorCache,
    changeBuffer,
    getNeighbors: (position) => mapNeighbors(position)
  });
  const dynamicRenderer = modules.dynamicRenderer.createDynamicRenderer({
    context: dynamicContext,
    getGameData: () => gameData,
    getState: () => ({
      gameData,
      terrain,
      renderState,
      spawnPhase,
      selectionLocked,
      selectedPosition,
      selectedColor,
      localPlayerId,
      hoverPosition,
      playerColors,
      boats,
      nukeMode,
      nukeTarget
    }),
    getCapitalCells,
    isValidCapital: (position) => mapRules.isValidCapital(position),
    colorCache,
    clamp,
    nukeGeometry,
    getNukeFlight: () => nukeFlight,
    clearNukeFlight: () => { nukeFlight = null; },
    onNukeImpact: () => {
      clearNukeInbound();
      nukeShake = { startedAt: performance.now(), durationMs: 600, strength: 5 };
      nukeLaunch.disabled = true;
      nukeSelectTarget.disabled = false;
      nukeStatus.textContent = 'IMPACT REGISTERED // DAMAGE OFFLINE';
    }
  });
  const dynamicScheduler = modules.dynamicScheduler.createDynamicScheduler({
    renderState,
    drawDynamic
  });

  const renderLoop = modules.renderLoop.createRenderLoop({
    renderState,
    getNukeFlight: () => nukeFlight,
    hasNukeEffect: () => dynamicRenderer.hasNukeEffect(),
    getNukeShake: () => nukeShake !== null,
    applyMapTransform,
    getGameData: () => gameData,
    updateWebglOwners: (changes) => webglSync.updateOwners(changes),
    updateTerritoryLayer: (changes) => sceneRenderer.updateTerritory(changes),
    onTerritoryChanged: () => {
      territoryVersion += 1;
      renderState.labelsDirty = true;
    },
    smoothTroops,
    drawScene,
    drawDynamic,
    drawLabels,
    shouldDrawLabels: () => renderState.labelsCameraDirty || labelScheduler.shouldDraw(),
    resetInterpolation
  });
  const mapAssets = modules.mapAssets.createMapAssets();
  const leaderboardRenderer = modules.leaderboard.createLeaderboardRenderer(
    leaderboard,
    (playerId) => focusPlayer(playerId)
  );
  const activeAttacksRenderer = modules.activeAttacks.createActiveAttacksRenderer(
    activeAttacksPanel,
    (playerId, attackId) => {
      window.TerriCommunicator?.send(window.TerriBinaryProtocol.encodeCancelExpansion(playerId, attackId));
    }
  );
  const playerStatsRenderer = modules.playerStats.createPlayerStatsRenderer({
    setTargetTroops: (value) => { targetTroops = value; },
    updateRatioDisplay
  });
  const spawnHudController = modules.spawnHud.createSpawnHud();
  const attackRatioController = modules.attackRatio.createAttackRatioControl({
    slider: powerSlider,
    isActive: () => activeGame,
    onChange: updateRatioDisplay
  });
  const mapMenuController = modules.mapMenu.createMapMenu({
    menu: mapMenu,
    screen: gameScreen,
    onAction: (action, position) => {
      if (action === 'attack') mapActionHandler?.({ playerId: localPlayerId, position });
      if (action === 'boat') boatActionHandler?.({ playerId: localPlayerId, position });
    }
  });
  const mapTransform = modules.mapTransform.createMapTransform({
    mapFrame,
    clamp,
    getZoom: () => zoom,
    setZoom: (value) => { zoom = value; },
    getPan: () => ({ x: panX, y: panY }),
    setPan: (value) => { panX = value.x; panY = value.y; },
    getShakeOffset: getNukeShakeOffset,
    onCameraChanged: () => {
      renderState.labelsCameraDirty = true;
      hideMapMenu();
      TerriPlayerLabelRenderer.invalidateLayout();
      scheduleLabelDraw();
    }
  });
  const cameraController = modules.cameraController.createCameraController({
    mapFrame,
    canvas,
    getState: () => ({ zoom, panX, panY }),
    setState: (state) => { zoom = state.zoom; panX = state.panX; panY = state.panY; },
    getMapSize: () => ({ width: gameData?.map.width || 876, height: gameData?.map.height || 694 }),
    getLabelCenter: (playerId, version) => TerriPlayerLabelRenderer.getLabelCenter(playerId, gameData, version),
    onTransform: () => {
      renderState.labelsCameraDirty = true;
      hideMapMenu();
      TerriPlayerLabelRenderer.invalidateLayout();
      scheduleLabelDraw();
    }
  });
  const nukeControlsModule = modules.nukeControls;
  const canvasResizer = modules.canvasResizer.createCanvasResizer({
    mapFrame,
    gameScreen,
    canvas,
    webglCanvas,
    dynamicCanvas,
    context,
    dynamicContext,
    webglRenderer,
    getMapDimensions: () => ({
      width: gameData?.map.width || 876,
      height: gameData?.map.height || 694
    }),
    invalidateLabels: () => TerriPlayerLabelRenderer.invalidateLayout(),
    hasTerrain: () => Boolean(terrain),
    buildTerrainLayer: () => sceneRenderer.buildTerrain(),
    composeSceneLayer: () => sceneRenderer.compose(),
    draw,
    applyMapTransform
  });
  const mapRules = modules.mapRules.createMapRules({
    getState: () => ({ gameData, terrain, territoryVersion }),
    getNeighbors: (position) => mapNeighbors(position)
  });
  const mapCoordinates = modules.mapCoordinates.createMapCoordinates(
    canvas,
    () => ({ width: gameData?.map.width || 876, height: gameData?.map.height || 694 })
  );
  const mapGestures = modules.mapGestures.createMapGestures({
    mapFrame,
    isBlocked: () => cameraController.isAnimating(),
    getCamera: () => ({ zoom, panX, panY }),
    setCamera: (camera) => { zoom = camera.zoom; panX = camera.panX; panY = camera.panY; },
    clamp,
    applyTransform: applyMapTransform,
    onRatioAdjust: (step) => attackRatioController.adjust(step),
    positionFromPointer: (event) => mapCoordinates.fromPointer(event),
    onHover: (position) => { hoverPosition = position; },
    invalidateDynamic,
    scheduleDynamicDraw,
    onTap: (event, position) => {
      if (position === null) return;
      if (spawnPhase && !selectionLocked) {
        if (!mapRules.isValidCapital(position) || !isAvailableCapital(position)) {
          spawnMessage.textContent = !isAvailableCapital(position)
            ? 'INVALID POSITION // CAPITAL AREA IS OCCUPIED'
            : 'INVALID POSITION // CAPITAL MUST BE ON LAND';
          hoverPosition = null;
          invalidateDynamic();
          drawDynamic();
          return;
        }
        selectedPosition = position;
        selectedSpawnCells = getCapitalCells(position);
        if (selectedSpawnCells.length !== 21 || !mapRules.isValidCapital(position) || !isAvailableCapital(position)) {
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
        return;
      }
      if (!activeGame) return;
      if (nukeMode && nukeSelecting) {
        nukeTarget = position;
        nukeSelecting = false;
        nukeStatus.textContent = 'TARGET LOCKED // READY TO LAUNCH';
        nukeLaunch.disabled = false;
        return;
      }
      const ownerId = Number(localPlayerId.replace('player-', ''));
      if ((terrain[position] & 0x80) !== 0 && gameData.owners[position] !== ownerId) {
        mapActionHandler?.({ playerId: localPlayerId, position });
      }
    }
  });

  function randomColor() {
    const colors = ['#69c878', '#e86b52', '#6ba8e8', '#d9b84c', '#bb75d4', '#e889b1'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /* Legacy gesture listeners are replaced by mapGestures below.
  mapFrame.addEventListener('wheel', function (event) {
    if (cameraController.isAnimating()) return;
    if (event.shiftKey) {
      event.preventDefault();
      attackRatioController.adjust(event.deltaY > 0 ? -5 : 5);
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
    if (cameraController.isAnimating()) return;
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
    hoverPosition = mapCoordinates.fromPointer(event);
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
      const position = mapCoordinates.fromPointer(event);
      if (position !== null) {
        if (!mapRules.isValidCapital(position) || !isAvailableCapital(position)) {
          spawnMessage.textContent = !isAvailableCapital(position)
            ? 'INVALID POSITION // CAPITAL AREA IS OCCUPIED'
            : 'INVALID POSITION // CAPITAL MUST BE ON LAND';
          hoverPosition = null;
          invalidateDynamic();
          drawDynamic();
          return;
        }
        selectedPosition = position;
        selectedSpawnCells = getCapitalCells(position);
        if (selectedSpawnCells.length !== 21 || !mapRules.isValidCapital(position) || !isAvailableCapital(position)) {
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
      const position = mapCoordinates.fromPointer(event);
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
    mapMenuController.hide();
  }

  function showMapMenu(event, position) {
    const ownerId = Number(localPlayerId.replace('player-', ''));
    const canLaunchBoat = mapRules.targetNearWater(position) && mapRules.playerHasWaterBorder(ownerId);
    mapMenuController.show(event, position, canLaunchBoat);
  }

  mapFrame.addEventListener('contextmenu', function (event) {
    event.preventDefault();
    if (!activeGame || localPlayerId === null) return;
    const position = mapCoordinates.fromPointer(event);
    const ownerId = Number(localPlayerId.replace('player-', ''));
    // Only offer the menu on land we do not already hold.
    if (position === null || (terrain[position] & 0x80) === 0 || gameData.owners[position] === ownerId) {
      hideMapMenu();
      return;
    }
    showMapMenu(event, position);
  });

  mapFrame.addEventListener('pointerup', stopDragging);
  mapFrame.addEventListener('pointercancel', stopDragging);
  */

  function hideMapMenu() {
    mapMenuController.hide();
  }

  window.addEventListener('resize', function () {
    canvasResizer.schedule();
    applyMapTransform();
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

  nukeControlsModule.createNukeControls({
    trigger: nukeTrigger,
    selectTarget: nukeSelectTarget,
    launch: nukeLaunch,
    cancel: nukeCancel,
    onEnable: () => setNukeMode(true),
    onSelectTarget: () => {
      if (nukeFlight) return;
      nukeSelecting = true;
      nukeTarget = null;
      nukeLaunch.disabled = true;
      nukeStatus.textContent = 'SELECT A TARGET';
      invalidateDynamic();
      drawDynamic();
    },
    onLaunch: () => {
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
    },
    onCancel: () => {
      nukeFlight = null;
      clearNukeInbound();
      dynamicRenderer.resetNukeEffects();
      setNukeMode(false);
    }
  });

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
      TerriPlayerLabelRenderer.clear?.();
      const sessionId = ++gameSessionId;
      gameData = data;
      nukeFlight = null;
      nukeShake = null;
      clearNukeInbound();
      dynamicRenderer.resetNukeEffects();
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
      webglSync.updateOwners();
      webglSync.updateWasteland();
      webglSync.updatePalette();
      territoryCanvas.width = data.map.width;
      territoryCanvas.height = data.map.height;
      sceneRenderer.reset();
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
      colorCache.clear();
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
      cameraController.cancel();
      resetMapTransform();
      canvasResizer.schedule();
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
      webglSync.updatePalette();
      const spawnChanges = changeBuffer.decode(data);
      if (spawnChanges.length) {
        changeBuffer.forEach(spawnChanges, (position, owner) => { gameData.owners[position] = owner; });
        webglSync.updateOwners(spawnChanges);
        sceneRenderer.updateTerritory(spawnChanges);
        territoryVersion += 1;
        renderState.labelsDirty = true;
      }
      selectedSpawnCells = [];
      selectionLocked = false;
      spawnHudController.show();
      spawnHudController.setMessage('CHOOSE A LAND POSITION FOR YOUR CAPITAL');
      spawnHudController.start(data, () => {
        if (selectionLocked) return;
        selectionLocked = true;
        spawnSubmitHandler?.({ playerId: data.playerId, position: selectedPosition ?? confirmedPosition });
      });
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
        webglSync.updateOwners([
          ...previousCells.map((position) => ({ position, owner: 0 })),
          ...data.cells.map((position) => ({ position, owner: confirmedOwnerId }))
        ]);
        webglSync.updatePalette();
        territoryVersion += 1;
        renderState.labelsDirty = true;
        sceneRenderer.updateTerritory([
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
      spawnHudController.stop();
      spawnHudController.hide();
      document.getElementById('selector-stats').hidden = false;
      updateActiveAttacks(data.activeAttacks || []);
      attackRatioPanel.hidden = false;
      updateRatioDisplay();
      leaderboard.hidden = false;
      spawnMessage.textContent = 'GAME ACTIVE // CAPITAL SECURED';
      if (data.players?.length) {
        gameData.players = data.players;
        rebuildPlayerMap();
        data.players.forEach((player) => playerColors.set(Number(player.playerId.replace('player-', '')), player.capitalColor));
        const activeChanges = changeBuffer.decode(data);
        changeBuffer.forEach(activeChanges, (position, owner) => { gameData.owners[position] = owner; });
        webglSync.updateOwners(activeChanges);
        webglSync.updatePalette();
        applyWastelandChanges(data.wastelandChanges || []);
        sceneRenderer.rebuildTerritory();
        const player = data.players.find((item) => item.playerId === localPlayerId);
        localCapitalCells = new Set();
        if (player?.capitalColor) selectedColor = player.capitalColor;
        updateLocalTroops(player);
        selectedPosition = player?.spawnPosition ?? null;
      }
      resetInterpolation();
      lastTroopUpdateAt = performance.now();
      console.info('[TerriFront] Active player snapshot received', {
        tickCount: data.tickCount,
        players: (data.players || []).map((player) => ({
          playerId: player.playerId,
          troops: player.troops,
          territorySize: player.territorySize
        }))
      });
      scheduleTroopUpdateWatchdog();
      leaderboardRenderer.render(gameData.players, localPlayerId, true);
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
      renderLoop.queueChanges(changeBuffer.decode(data), packetIntervalMs);
      let leaderboardDirty = false;
      const troopUpdates = [];
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
          troopUpdates.push({ player, previousTroops: null });
        }
        if (current && previous.troops !== player.troops) troopUpdates.push({ player, previousTroops: previous.troops });
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
      if (troopUpdates.length) {
        troopUpdates.forEach(({ player, previousTroops }) => logTroopUpdate(player, data.tickCount, previousTroops));
      } else if (data.players?.length) {
        console.debug('[TerriFront] Player packet received without troop value changes', {
          tickCount: data.tickCount,
          players: data.players.map((player) => ({ playerId: player.playerId, troops: player.troops }))
        });
      }
      // Keep the rendered collection tied to the registry. This also handles
      // update packets arriving before a complete player list is installed.
      if (data.players?.length) gameData.players = [...playerMap.values()];
      const localPlayerAfter = playerMap.get(localPlayerId) || (gameData?.players || []).find((player) => player.playerId === localPlayerId);
      if (localPlayerAfter) updateLocalTroops(localPlayerAfter);
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
      if (leaderboardDirty) leaderboardRenderer.render(gameData.players, localPlayerId);
      renderState.labelsDirty = true;
      if (!renderLoop.isRunning()) draw();
    },
    rejectExpansion(data) {
      spawnMessage.textContent = `EXPANSION REJECTED // ${data.reason}`;
    },
    stop() {
      gameSessionId += 1;
      stopTroopUpdateWatchdog();
      stopRenderLoop();
      TerriPlayerLabelRenderer.clear?.();
      spawnPhase = null;
      activeGame = false;
      nukeFlight = null;
      nukeShake = null;
      clearNukeInbound();
      dynamicRenderer.resetNukeEffects();
      setNukeMode(false);
      updateActiveAttacks([]);
      winnerBanner.hidden = true;
      leaderboard.hidden = true;
      document.getElementById('selector-stats').hidden = true;
      attackRatioPanel.hidden = true;
      leaderboardRenderer.reset();
    }
  };
}());
