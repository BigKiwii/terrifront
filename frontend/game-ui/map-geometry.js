(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function getCapitalCells(position, width, height) {
    if (!Number.isInteger(position) || position < 0 || position >= width * height) return [];
    const centerX = position % width;
    const centerY = Math.floor(position / width);
    const cells = [];
    for (let y = centerY - 2; y <= centerY + 2; y += 1) {
      for (let x = centerX - 2; x <= centerX + 2; x += 1) {
        if (x < 0 || x >= width || y < 0 || y >= height) return [];
        if (Math.abs(x - centerX) === 2 && Math.abs(y - centerY) === 2) continue;
        cells.push(y * width + x);
      }
    }
    return cells;
  }

  function mapNeighbors(position, width, height) {
    if (!Number.isInteger(position) || position < 0 || position >= width * height) return [];
    const x = position % width;
    const neighbors = [];
    if (x > 0) neighbors.push(position - 1);
    if (x < width - 1) neighbors.push(position + 1);
    if (position >= width) neighbors.push(position - width);
    if (position < width * height - width) neighbors.push(position + width);
    return neighbors;
  }

  modules.mapGeometry = { getCapitalCells, mapNeighbors };
}());
