(function () {
  'use strict';

  let cachedGameData = null;
  let cachedTerritoryVersion = -1;
  let cachedSquares = new Map();
  let labelCanvas = null;
  let labelContext = null;
  let mapCanvas = null;
  let mapBounds = null;
  const MIN_LABEL_PIXELS = 7;

  function formatTroops(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US').replace(/,/g, ' ');
  }

  function largestOwnedSquares(owners, width, height) {
    const depths = new Uint16Array(width);
    const bestSquares = new Map();

    for (let y = 0; y < height; y += 1) {
      let diagonal = 0;
      for (let x = 0; x < width; x += 1) {
        const position = y * width + x;
        const ownerId = owners[position];
        const previous = depths[x];
        if (ownerId) {
          const left = x > 0 && owners[position - 1] === ownerId ? depths[x - 1] : 0;
          const above = y > 0 && owners[position - width] === ownerId ? previous : 0;
          const upperLeft = x > 0 && y > 0 && owners[position - width - 1] === ownerId ? diagonal : 0;
          depths[x] = Math.min(left, above, upperLeft) + 1;
          const current = bestSquares.get(ownerId);
          if (!current || depths[x] > current.size) {
            bestSquares.set(ownerId, {
              size: depths[x],
              x: x - depths[x] + 1,
              y: y - depths[x] + 1
            });
          }
        } else {
          depths[x] = 0;
        }
        diagonal = previous;
      }
    }

    return bestSquares;
  }

  function drawText(context, text, x, y, squareWidth, squareHeight, baselineBottom) {
    const maxWidth = Math.max(1, squareWidth - 1);
    const fontSize = Math.max(1, Math.floor(Math.min(maxWidth / Math.max(1, text.length * 0.55), squareHeight * 0.28)));
    const centerX = Math.round(x + squareWidth / 2);
    const textY = Math.round(y + squareHeight * (baselineBottom ? 0.38 : 0.62));
    context.font = `900 ${fontSize}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = baselineBottom ? 'bottom' : 'top';
    context.lineWidth = Math.max(1, Math.round(fontSize * 0.12));
    context.strokeStyle = '#071221';
    context.fillStyle = '#fff3b0';
    context.strokeText(text, centerX, textY);
    context.fillText(text, centerX, textY);
  }

  function drawCrown(context, x, y, squareWidth, squareHeight) {
    const fontSize = Math.max(10, Math.round(Math.min(squareWidth * 0.22, squareHeight * 0.34)));
    context.font = `900 ${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.lineWidth = Math.max(1, Math.round(fontSize * 0.08));
    context.strokeStyle = '#071221';
    context.fillStyle = '#f4d35e';
    context.strokeText('👑', Math.round(x + squareWidth / 2), Math.round(y + squareHeight * 0.20));
    context.fillText('👑', Math.round(x + squareWidth / 2), Math.round(y + squareHeight * 0.20));
  }

  function resizeLabelCanvas() {
    if (!labelCanvas || !labelContext) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const physicalWidth = Math.ceil(width * dpr);
    const physicalHeight = Math.ceil(height * dpr);
    if (labelCanvas.width !== physicalWidth || labelCanvas.height !== physicalHeight) {
      labelCanvas.width = physicalWidth;
      labelCanvas.height = physicalHeight;
    }
    labelContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    labelContext.imageSmoothingEnabled = true;
  }

  function init(screen, canvas) {
    if (labelCanvas) return;
    mapCanvas = canvas;
    labelCanvas = document.createElement('canvas');
    labelCanvas.setAttribute('aria-hidden', 'true');
    labelCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    screen.appendChild(labelCanvas);
    labelContext = labelCanvas.getContext('2d');
    resizeLabelCanvas();
    window.addEventListener('resize', () => {
      mapBounds = null;
      resizeLabelCanvas();
    });
  }

  function draw(gameData, zoom, territoryVersion = 0) {
    if (!labelContext || !mapCanvas || !gameData?.owners || !gameData.players) return;
    const width = gameData.map.width;
    const height = gameData.map.height;
    if (gameData !== cachedGameData || territoryVersion !== cachedTerritoryVersion) {
      cachedSquares = largestOwnedSquares(gameData.owners, width, height);
      cachedGameData = gameData;
      cachedTerritoryVersion = territoryVersion;
    }
    if (!mapBounds) mapBounds = mapCanvas.getBoundingClientRect();
    const scaleX = mapBounds.width / width;
    const scaleY = mapBounds.height / height;
    const biggestPlayer = gameData.players
      .filter((player) => player.isAlive !== false && (player.territorySize || 0) > 0)
      .sort((first, second) =>
        (second.territorySize || 0) - (first.territorySize || 0) ||
        (second.troops || 0) - (first.troops || 0))[0];
    labelContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const player of gameData.players) {
      const ownerId = Number(player.playerId.replace('player-', ''));
      const square = cachedSquares.get(ownerId);
      if (!square || Math.min(square.size * scaleX, square.size * scaleY) < MIN_LABEL_PIXELS) continue;
      const screenX = mapBounds.left + square.x * scaleX;
      const screenY = mapBounds.top + square.y * scaleY;
      const screenWidth = square.size * scaleX;
      const screenHeight = square.size * scaleY;
      if (screenX + screenWidth < 0 || screenX > window.innerWidth ||
        screenY + screenHeight < 0 || screenY > window.innerHeight) continue;
      const hasCrown = player.isWinner || player.playerId === biggestPlayer?.playerId;
      if (hasCrown) drawCrown(labelContext, screenX, screenY, screenWidth, screenHeight);
      drawText(labelContext, player.playerName, screenX, screenY, screenWidth, screenHeight, true);
      drawText(labelContext, formatTroops(player.troops), screenX, screenY, screenWidth, screenHeight, false);
    }
  }

  function getLabelCenter(playerId, gameData, territoryVersion = 0) {
    if (!gameData?.owners || !gameData.players) return null;
    const width = gameData.map.width;
    const height = gameData.map.height;
    if (gameData !== cachedGameData || territoryVersion !== cachedTerritoryVersion) {
      cachedSquares = largestOwnedSquares(gameData.owners, width, height);
      cachedGameData = gameData;
      cachedTerritoryVersion = territoryVersion;
    }
    const square = cachedSquares.get(Number(String(playerId).replace('player-', '')));
    if (!square) {
      const ownerId = Number(String(playerId).replace('player-', ''));
      for (let position = 0; position < gameData.owners.length; position += 1) {
        if (gameData.owners[position] !== ownerId) continue;
        return { x: position % width + 0.5, y: Math.floor(position / width) + 0.5 };
      }
      return null;
    }
    return { x: square.x + square.size / 2, y: square.y + square.size / 2 };
  }

  function invalidateLayout() {
    mapBounds = null;
  }

  window.TerriPlayerLabelRenderer = { init, draw, getLabelCenter, invalidateLayout };
}());
