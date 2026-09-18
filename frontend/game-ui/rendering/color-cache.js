(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createColorCache(options) {
    const cache = new Map();

    function playerColors(color) {
      return options.colorUtils.playerColors(color);
    }

    function colorsForOwner(ownerId) {
      const color = options.getPlayerColors().get(ownerId) || options.getSelectedColor();
      const cached = cache.get(ownerId);
      if (cached?.source === color) return cached;
      const colors = playerColors(color);
      const parse = (value) => {
        const match = value.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/);
        if (!match) return null;
        return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 255 : Math.round(Number(match[4]) * 255)];
      };
      const cachedColors = { source: color, colors, territoryPixel: parse(colors.territory), borderPixel: parse(colors.border) };
      cache.set(ownerId, cachedColors);
      return cachedColors;
    }

    function isBorderCell(position, owner) {
      const gameData = options.getGameData();
      const width = gameData.map.width;
      const height = gameData.map.height;
      const x = position % width;
      const y = Math.floor(position / width);
      return x === 0 || x === width - 1 || y === 0 || y === height - 1 ||
        gameData.owners[position - 1] !== owner || gameData.owners[position + 1] !== owner ||
        gameData.owners[position - width] !== owner || gameData.owners[position + width] !== owner;
    }

    return {
      playerColors,
      colorsForOwner,
      isBorderCell,
      clear() {
        cache.clear();
      }
    };
  }

  modules.colorCache = { createColorCache };
}());
