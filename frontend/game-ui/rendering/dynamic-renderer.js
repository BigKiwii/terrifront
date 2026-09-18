(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createDynamicRenderer(options) {
    const context = options.context;

    function drawCapital(position, color) {
      const gameData = options.getGameData();
      if (!Number.isInteger(position) || position < 0 || position >= gameData.map.width * gameData.map.height) return;
      const centerX = position % gameData.map.width;
      const centerY = Math.floor(position / gameData.map.width);
      const colors = options.colorCache.playerColors(color || '#69c878');
      context.fillStyle = colors.border;
      for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
        for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
          if (Math.abs(offsetX) === 2 && Math.abs(offsetY) === 2) continue;
          context.fillRect(centerX + offsetX, centerY + offsetY, 1, 1);
        }
      }
      context.fillStyle = colors.territory;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) context.fillRect(centerX + offsetX, centerY + offsetY, 1, 1);
      }
    }

    function drawHover() {
      const state = options.getState();
      if (state.hoverPosition === null || state.selectedPosition !== null || !state.spawnPhase || state.selectionLocked || !options.isValidCapital(state.hoverPosition)) return;
      const width = state.gameData.map.width;
      const shape = options.getCapitalCells(state.hoverPosition);
      const cellSet = new Set(shape);
      context.save();
      context.strokeStyle = '#f4d35e';
      context.lineWidth = 1;
      context.globalAlpha = 0.9;
      for (const cell of shape) {
        const x = cell % width;
        const y = Math.floor(cell / width);
        const hasEast = cellSet.has(cell + 1);
        const hasWest = cellSet.has(cell - 1);
        const hasNorth = cellSet.has(cell - width);
        const hasSouth = cellSet.has(cell + width);
        context.beginPath();
        if (!hasNorth) { context.moveTo(x, y); context.lineTo(x + 1, y); }
        if (!hasEast) { context.moveTo(x + 1, y); context.lineTo(x + 1, y + 1); }
        if (!hasSouth) { context.moveTo(x + 1, y + 1); context.lineTo(x, y + 1); }
        if (!hasWest) { context.moveTo(x, y + 1); context.lineTo(x, y); }
        context.stroke();
      }
      context.restore();
    }

    function drawNukeTarget() {
      const state = options.getState();
      if (!state.nukeMode || state.nukeTarget === null) return;
      const width = state.gameData.map.width;
      const x = state.nukeTarget % width;
      const y = Math.floor(state.nukeTarget / width);
      context.save();
      context.strokeStyle = '#071221';
      context.fillStyle = 'rgba(232, 107, 82, 0.45)';
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(x + 0.5, y + 0.5, 8, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.beginPath();
      context.moveTo(x - 11, y + 0.5);
      context.lineTo(x + 12, y + 0.5);
      context.moveTo(x + 0.5, y - 11);
      context.lineTo(x + 0.5, y + 12);
      context.stroke();
      context.restore();
    }

    function drawNukeFlight(timestamp) {
      const flight = options.getNukeFlight();
      if (!flight) return;
      const gameData = options.getGameData();
      const width = gameData.map.width;
      const start = { x: flight.start % width + 0.5, y: Math.floor(flight.start / width) + 0.5 };
      const end = { x: flight.target % width + 0.5, y: Math.floor(flight.target / width) + 0.5 };
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
        y: options.clamp(start.y + deltaY / 4 + arcSign * arcHeight, 0.5, gameData.map.height - 0.5)
      };
      const secondControl = {
        x: start.x + deltaX * 3 / 4,
        y: options.clamp(start.y + deltaY * 3 / 4 + arcSign * arcHeight, 0.5, gameData.map.height - 0.5)
      };
      const progress = Math.min(1, (timestamp - flight.startedAt) / flight.durationMs);
      const trailStart = Math.max(0, progress - 0.22);
      const position = options.nukeGeometry.cubicPoint(start, firstControl, secondControl, end, progress);
      const previous = options.nukeGeometry.cubicPoint(start, firstControl, secondControl, end, Math.max(0, progress - 0.02));
      const angle = Math.atan2(position.y - previous.y, position.x - previous.x);
      context.save();
      context.lineCap = 'round';
      const trailSamples = 16;
      for (let index = 0; index < trailSamples; index += 1) {
        const segmentStart = trailStart + (progress - trailStart) * index / trailSamples;
        const segmentEnd = trailStart + (progress - trailStart) * (index + 1) / trailSamples;
        const trailPoint = options.nukeGeometry.cubicPoint(start, firstControl, secondControl, end, segmentStart);
        const nextTrailPoint = options.nukeGeometry.cubicPoint(start, firstControl, secondControl, end, segmentEnd);
        context.globalAlpha = 0.12 + index / trailSamples * 0.72;
        context.strokeStyle = '#ffffff';
        context.lineWidth = 1.1 + index / trailSamples;
        context.beginPath();
        context.moveTo(trailPoint.x, trailPoint.y);
        context.lineTo(nextTrailPoint.x, nextTrailPoint.y);
        context.stroke();
      }
      context.translate(position.x, position.y);
      context.rotate(angle);
      context.globalAlpha = 1;
      context.fillStyle = '#f4f3ea';
      context.strokeStyle = '#071221';
      context.lineWidth = 0.9;
      context.beginPath();
      context.moveTo(7, 0);
      context.lineTo(2, -2);
      context.lineTo(-5, -1.5);
      context.lineTo(-7, 0);
      context.lineTo(-5, 1.5);
      context.lineTo(2, 2);
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = '#e86b52';
      context.fillRect(-3, -1, 3, 2);
      context.restore();
      if (progress >= 1) {
        options.clearNukeFlight();
        options.onNukeImpact();
      }
    }

    function drawSpawnCapitals() {
      const state = options.getState();
      const localPreviewActive = state.selectedPosition !== null;
      for (const player of state.gameData.players || []) {
        if (!Number.isInteger(player.spawnPosition)) continue;
        if (player.playerId === state.localPlayerId && localPreviewActive) continue;
        drawCapital(player.spawnPosition, player.capitalColor || state.playerColors.get(Number(player.playerId.replace('player-', ''))));
      }
      if (localPreviewActive) drawCapital(state.selectedPosition, state.selectedColor);
    }

    function drawBoats() {
      const state = options.getState();
      if (!state.boats.length) return;
      const width = state.gameData.map.width;
      context.save();
      for (const boat of state.boats) {
        const x = boat.position % width;
        const y = Math.floor(boat.position / width);
        const colors = options.colorCache.playerColors(state.playerColors.get(boat.ownerId) || '#f4d35e');
        context.fillStyle = colors.territory;
        context.fillRect(x - 1, y - 1, 3, 3);
        context.fillStyle = colors.border;
        context.fillRect(x, y, 1, 1);
      }
      context.restore();
    }

    function draw() {
      const state = options.getState();
      if (!state.gameData || !state.terrain || !state.renderState.dynamicDirty) return;
      context.clearRect(0, 0, state.gameData.map.width, state.gameData.map.height);
      if (state.spawnPhase) drawSpawnCapitals();
      drawBoats();
      drawHover();
      drawNukeTarget();
      drawNukeFlight(performance.now());
      state.renderState.dynamicDirty = false;
    }

    return { draw, drawCapital };
  }

  modules.dynamicRenderer = { createDynamicRenderer };
}());
