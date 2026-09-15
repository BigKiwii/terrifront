(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function playerColors(color) {
    const hexMatch = String(color).match(/^#([0-9a-f]{6})$/i);
    if (hexMatch) {
      const red = parseInt(hexMatch[1].slice(0, 2), 16);
      const green = parseInt(hexMatch[1].slice(2, 4), 16);
      const blue = parseInt(hexMatch[1].slice(4, 6), 16);
      return {
        territory: `rgba(${red},${green},${blue},0.6)`,
        border: `rgba(${Math.floor(red * 0.7)},${Math.floor(green * 0.7)},${Math.floor(blue * 0.7)},0.9)`
      };
    }

    const match = String(color).match(/hsl\(\s*([\d.-]+),\s*([\d.-]+)%\s*,\s*([\d.-]+)%\s*\)/);
    if (!match) return { territory: color, border: color };
    const hue = Number(match[1]);
    const saturation = Number(match[2]) * 0.5;
    return {
      territory: `hsla(${hue},${saturation}%,68%,0.6)`,
      border: `hsla(${hue},${saturation}%,46%,0.9)`
    };
  }

  function parsePixel(value) {
    const match = String(value).match(/^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/);
    if (!match) return null;
    return [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      match[4] === undefined ? 255 : Math.round(Number(match[4]) * 255)
    ];
  }

  function createColorCache() {
    const cache = new Map();
    return function getColors(color) {
      const cached = cache.get(color);
      if (cached) return cached;
      const colors = playerColors(color);
      const value = {
        source: color,
        colors,
        territoryPixel: parsePixel(colors.territory),
        borderPixel: parsePixel(colors.border)
      };
      cache.set(color, value);
      return value;
    };
  }

  modules.colorUtils = { playerColors, parsePixel, createColorCache };
}());
