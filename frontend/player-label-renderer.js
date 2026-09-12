(function () {
  'use strict';

  let cachedGameData = null;
  let cachedTerritoryVersion = -1;
  let cachedAt = 0;
  let cachedSquares = new Map();

  function largestOwnedSquare(owners, ownerId, width, height) {
    const depths = new Uint16Array(width);
    let bestSize = 0;
    let bestPosition = -1;

    for (let y = 0; y < height; y += 1) {
      let diagonal = 0;
      for (let x = 0; x < width; x += 1) {
        const position = y * width + x;
        const previous = depths[x];
        if (owners[position] === ownerId) {
          depths[x] = Math.min(depths[x] || 0, depths[x - 1] || 0, diagonal) + 1;
          if (depths[x] > bestSize) {
            bestSize = depths[x];
            bestPosition = position;
          }
        } else {
          depths[x] = 0;
        }
        diagonal = previous;
      }
    }

    if (bestPosition < 0) return null;
    return {
      size: bestSize,
      x: bestPosition % width - bestSize + 1,
      y: Math.floor(bestPosition / width) - bestSize + 1
    };
  }

  function drawText(context, text, x, y, squareSize, baselineBottom) {
    const maxWidth = Math.max(1, squareSize - 1);
    const fontSize = Math.max(1, Math.min(maxWidth / Math.max(1, text.length * 0.62), squareSize * 0.4));
    context.font = `700 ${fontSize}px "Cascadia Mono", "Courier New", monospace`;
    context.textAlign = 'center';
    context.textBaseline = baselineBottom ? 'bottom' : 'top';
    const centerX = x + squareSize / 2;
    const textY = baselineBottom ? y + squareSize / 2 : y + squareSize / 2 + fontSize * 0.15;
    context.lineWidth = Math.max(0.25, fontSize * 0.22);
    context.strokeStyle = 'rgba(244, 243, 234, 0.9)';
    context.fillStyle = '#111820';
    context.strokeText(text, centerX, textY);
    context.fillText(text, centerX, textY);
  }

  function draw(context, gameData, zoom, territoryVersion = 0) {
    if (!gameData?.owners || !gameData.players) return;
    const width = gameData.map.width;
    const height = gameData.map.height;
    const now = performance.now();
    const cacheExpired = now - cachedAt >= 500;
    if (gameData !== cachedGameData || (territoryVersion !== cachedTerritoryVersion && cacheExpired)) {
      cachedSquares = new Map();
      for (const player of gameData.players) {
        const ownerId = Number(player.playerId.replace('player-', ''));
        cachedSquares.set(ownerId, largestOwnedSquare(gameData.owners, ownerId, width, height));
      }
      cachedGameData = gameData;
      cachedTerritoryVersion = territoryVersion;
      cachedAt = now;
    }
    context.save();
    for (const player of gameData.players) {
      const ownerId = Number(player.playerId.replace('player-', ''));
      const square = cachedSquares.get(ownerId);
      if (!square || square.size * zoom < 1) continue;
      drawText(context, player.playerName, square.x, square.y, square.size, true);
      drawText(context, String(player.troops), square.x, square.y, square.size, false);
    }
    context.restore();
  }

  window.TerriPlayerLabelRenderer = { draw };
}());
