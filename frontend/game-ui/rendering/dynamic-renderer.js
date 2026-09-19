(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createDynamicRenderer(options) {
    const context = options.context;
    let nukeImpactFlash = null;

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
      const gameData = options.getGameData();
      const renderState = options.getState().renderState;
      if (nukeImpactFlash) {
        const flashProgress = Math.min(1, (timestamp - nukeImpactFlash.startedAt) / 420);
        if (flashProgress < 1) {
          const radius = flashProgress * 32;
          const alpha = (1 - flashProgress) * 0.85;
          context.save();
          const gradient = context.createRadialGradient(
            nukeImpactFlash.x, nukeImpactFlash.y, 0,
            nukeImpactFlash.x, nukeImpactFlash.y, radius
          );
          gradient.addColorStop(0, `rgba(255,255,200,${alpha})`);
          gradient.addColorStop(0.35, `rgba(255,140,40,${alpha * 0.7})`);
          gradient.addColorStop(1, 'rgba(255,60,20,0)');
          context.fillStyle = gradient;
          context.beginPath();
          context.arc(nukeImpactFlash.x, nukeImpactFlash.y, radius, 0, Math.PI * 2);
          context.fill();
          context.globalAlpha = Math.max(0, 1 - flashProgress * 3);
          context.fillStyle = '#ffffff';
          context.fillRect(nukeImpactFlash.x - 2, nukeImpactFlash.y - 2, 4, 4);
          context.restore();
          renderState.dynamicDirty = true;
        } else {
          nukeImpactFlash = null;
        }
      }
      if (!flight || !gameData) return;
      const width = gameData.map.width;
      const start = { x: flight.start % width + 0.5, y: Math.floor(flight.start / width) + 0.5 };
      const end = { x: flight.target % width + 0.5, y: Math.floor(flight.target / width) + 0.5 };
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const distance = Math.hypot(deltaX, deltaY);
      const requestedArcHeight = Math.max(40, distance / 2.8);
      const upwardRoom = Math.min(start.y, end.y) - 0.5;
      const downwardRoom = gameData.map.height - 0.5 - Math.max(start.y, end.y);
      const arcSign = upwardRoom >= downwardRoom ? -1 : 1;
      const availableRoom = Math.max(1, arcSign < 0 ? upwardRoom : downwardRoom);
      const arcHeight = Math.min(requestedArcHeight, availableRoom * 0.85);
      const firstControl = {
        x: start.x + deltaX * 0.2,
        y: options.clamp(start.y + deltaY * 0.05 + arcSign * arcHeight, 0.5, gameData.map.height - 0.5)
      };
      const secondControl = {
        x: start.x + deltaX * 0.75,
        y: options.clamp(start.y + deltaY * 0.6 + arcSign * arcHeight * 0.7, 0.5, gameData.map.height - 0.5)
      };
      const progress = Math.min(1, (timestamp - flight.startedAt) / flight.durationMs);
      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      const trailSegments = 48;
      for (let index = 0; index < trailSegments; index += 1) {
        const segmentStart = index / trailSegments * progress;
        const segmentEnd = (index + 1) / trailSegments * progress;
        const normalized = (index + 0.5) / trailSegments;
        const trailPoint = options.nukeGeometry.cubicPoint(start, firstControl, secondControl, end, segmentStart);
        const nextTrailPoint = options.nukeGeometry.cubicPoint(start, firstControl, secondControl, end, segmentEnd);
        context.globalAlpha = 0.18 + normalized * (0.62 - normalized * 0.62);
        context.strokeStyle = '#ffffff';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(trailPoint.x, trailPoint.y);
        context.lineTo(nextTrailPoint.x, nextTrailPoint.y);
        context.stroke();
      }
      if (progress < 1) {
        const position = options.nukeGeometry.cubicPoint(start, firstControl, secondControl, end, progress);
        const topLeftX = Math.round(position.x - 2.5);
        const topLeftY = Math.round(position.y - 2.5);
        const time = timestamp / 1000;
        const outerRing = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [4, 1], [0, 2], [4, 2], [0, 3], [4, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4]];
        outerRing.forEach(([offsetX, offsetY], index) => {
          const flicker = 0.5 + 0.5 * Math.sin(time * 28 + index * 1.1);
          context.globalAlpha = flicker;
          context.fillStyle = `rgb(255,${Math.round(170 + 85 * flicker)},0)`;
          context.fillRect(topLeftX + offsetX, topLeftY + offsetY, 1, 1);
        });
        const innerRing = [[1, 1], [2, 1], [3, 1], [1, 2], [3, 2], [1, 3], [2, 3], [3, 3]];
        innerRing.forEach(([offsetX, offsetY], index) => {
          const pulse = 0.75 + 0.25 * Math.sin(time * 20 + index * 0.9);
          context.globalAlpha = pulse;
          context.fillStyle = `rgb(255,${Math.round(80 + 40 * pulse)},10)`;
          context.fillRect(topLeftX + offsetX, topLeftY + offsetY, 1, 1);
        });
        context.globalAlpha = 1;
        context.fillStyle = '#cc1111';
        context.fillRect(topLeftX + 2, topLeftY + 2, 1, 1);
        context.globalAlpha = 0.28 + 0.12 * Math.sin(time * 18);
        const halo = context.createRadialGradient(position.x, position.y, 0, position.x, position.y, 5.5);
        halo.addColorStop(0, 'rgba(255,200,40,0.9)');
        halo.addColorStop(1, 'rgba(255,80,0,0)');
        context.fillStyle = halo;
        context.beginPath();
        context.arc(position.x, position.y, 5.5, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
      if (progress >= 1) {
        nukeImpactFlash = { x: end.x, y: end.y, startedAt: timestamp };
        options.onNukeImpact?.({ x: end.x, y: end.y, timestamp });
        options.clearNukeFlight();
        renderState.dynamicDirty = true;
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

    return {
      draw,
      drawCapital,
      hasNukeEffect: () => Boolean(options.getNukeFlight() || nukeImpactFlash),
      resetNukeEffects: () => { nukeImpactFlash = null; }
    };
  }

  modules.dynamicRenderer = { createDynamicRenderer };
}());
