(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function drawCapital(context, position, color, width, height) {
    if (!Number.isInteger(position) || position < 0 || position >= width * height) return;
    const centerX = position % width;
    const centerY = Math.floor(position / width);
    const colors = modules.colorUtils.playerColors(color || '#69c878');

    context.fillStyle = colors.border;
    for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
      for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
        if (Math.abs(offsetX) === 2 && Math.abs(offsetY) === 2) continue;
        context.fillRect(centerX + offsetX, centerY + offsetY, 1, 1);
      }
    }

    context.fillStyle = colors.territory;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        context.fillRect(centerX + offsetX, centerY + offsetY, 1, 1);
      }
    }
  }

  modules.capitalRenderer = { drawCapital };
}());