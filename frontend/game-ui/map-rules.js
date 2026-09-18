(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createMapRules(options) {
    let cachedTerritoryVersion = -1;
    let cachedWaterBorderOwner = null;
    let cachedHasWaterBorder = false;

    function state() {
      return options.getState();
    }

    function isValidCapital(position) {
      const { gameData, terrain } = state();
      if (!gameData || !terrain) return false;
      const centerX = position % gameData.map.width;
      const centerY = Math.floor(position / gameData.map.width);
      for (let y = centerY - 2; y <= centerY + 2; y += 1) {
        for (let x = centerX - 2; x <= centerX + 2; x += 1) {
          if (x < 0 || x >= gameData.map.width || y < 0 || y >= gameData.map.height) return false;
          if (Math.abs(x - centerX) === 2 && Math.abs(y - centerY) === 2) continue;
          const cell = y * gameData.map.width + x;
          if ((terrain[cell] & 0x80) === 0 || gameData.owners[cell] !== 0) return false;
        }
      }
      return true;
    }

    function playerHasWaterBorder(ownerId) {
      const { gameData, terrain, territoryVersion } = state();
      if (cachedTerritoryVersion === territoryVersion && cachedWaterBorderOwner === ownerId) return cachedHasWaterBorder;
      cachedTerritoryVersion = territoryVersion;
      cachedWaterBorderOwner = ownerId;
      cachedHasWaterBorder = false;
      for (let position = 0; position < gameData.owners.length; position += 1) {
        if (gameData.owners[position] !== ownerId) continue;
        if (options.getNeighbors(position).some((neighbor) => (terrain[neighbor] & 0x80) === 0)) {
          cachedHasWaterBorder = true;
          break;
        }
      }
      return cachedHasWaterBorder;
    }

    function targetNearWater(position, maxDistance = 10) {
      const { terrain } = state();
      const visited = new Set([position]);
      const queue = [{ position, distance: 0 }];
      let head = 0;
      while (head < queue.length) {
        const current = queue[head++];
        const neighbors = options.getNeighbors(current.position);
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

    return { isValidCapital, playerHasWaterBorder, targetNearWater };
  }

  modules.mapRules = { createMapRules };
}());
