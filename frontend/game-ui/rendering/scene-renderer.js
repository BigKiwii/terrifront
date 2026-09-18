(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createSceneRenderer(options) {
    let territoryImageData = null;
    let wastelandImageData = null;
    let territoryLayerDirty = false;
    let wastelandLayerDirty = false;
    let dirtyMinX = Infinity;
    let dirtyMinY = Infinity;
    let dirtyMaxX = -Infinity;
    let dirtyMaxY = -Infinity;

    function dimensions() {
      const gameData = options.getGameData();
      return { width: gameData.map.width, height: gameData.map.height };
    }

    function markDirty(position) {
      const { width } = dimensions();
      const x = position % width;
      const y = Math.floor(position / width);
      dirtyMinX = Math.min(dirtyMinX, x);
      dirtyMinY = Math.min(dirtyMinY, y);
      dirtyMaxX = Math.max(dirtyMaxX, x);
      dirtyMaxY = Math.max(dirtyMaxY, y);
    }

    function compose() {
      const gameData = options.getGameData();
      if (!gameData || !options.terrainCanvas.width || !options.terrainCanvas.height) return;
      const { width, height } = dimensions();
      if (options.sceneCanvas.width !== width || options.sceneCanvas.height !== height) {
        options.sceneCanvas.width = width;
        options.sceneCanvas.height = height;
      }
      options.sceneContext.clearRect(0, 0, width, height);
      options.sceneContext.drawImage(options.terrainCanvas, 0, 0, width, height);
      if (options.wastelandCanvas.width === width && options.wastelandCanvas.height === height) {
        options.sceneContext.drawImage(options.wastelandCanvas, 0, 0, width, height);
      }
      if (options.territoryCanvas.width === width && options.territoryCanvas.height === height) {
        options.sceneContext.drawImage(options.territoryCanvas, 0, 0, width, height);
      }
      options.renderState.sceneDirty = true;
    }

    function buildTerrain() {
      const gameData = options.getGameData();
      const terrain = options.getTerrain();
      if (!gameData || !terrain || options.webglRenderer) return;
      const { width, height } = dimensions();
      options.terrainCanvas.width = width;
      options.terrainCanvas.height = height;
      const pixels = options.terrainContext.createImageData(width, height);
      for (let position = 0; position < terrain.length; position += 1) {
        const pixel = position * 4;
        const land = (terrain[position] & 0x80) !== 0;
        const magnitude = terrain[position] & 0x1f;
        if (land) {
          pixels.data[pixel] = 226 + Math.min(20, magnitude * 2);
          pixels.data[pixel + 1] = 209 + Math.min(18, magnitude * 2);
          pixels.data[pixel + 2] = 161 + Math.min(16, magnitude);
        } else {
          pixels.data[pixel] = 79 + Math.min(9, Math.floor(magnitude * 1.2));
          pixels.data[pixel + 1] = 114 + Math.min(11, Math.floor(magnitude * 1.2));
          pixels.data[pixel + 2] = 140 + Math.min(7, Math.floor(magnitude * 0.6));
        }
        pixels.data[pixel + 3] = 255;
      }
      options.terrainContext.putImageData(pixels, 0, 0);
      compose();
    }

    function paintWastelandTile(position) {
      const wasteland = options.getWasteland();
      if (!wastelandImageData || !wasteland?.[position]) return;
      const pixel = position * 4;
      wastelandImageData.data[pixel] = 51;
      wastelandImageData.data[pixel + 1] = 173;
      wastelandImageData.data[pixel + 2] = 82;
      wastelandImageData.data[pixel + 3] = 220;
    }

    function paintTerritoryTile(position) {
      const gameData = options.getGameData();
      if (position < 0 || position >= gameData.owners.length || !territoryImageData) return;
      const pixel = position * 4;
      territoryImageData.data[pixel] = 0;
      territoryImageData.data[pixel + 1] = 0;
      territoryImageData.data[pixel + 2] = 0;
      territoryImageData.data[pixel + 3] = 0;
      const owner = gameData.owners[position];
      if (!owner) return;
      const colors = options.colorCache.colorsForOwner(owner);
      const color = options.colorCache.isBorderCell(position, owner) ? colors.borderPixel : colors.territoryPixel;
      if (!color) return;
      territoryImageData.data[pixel] = color[0];
      territoryImageData.data[pixel + 1] = color[1];
      territoryImageData.data[pixel + 2] = color[2];
      territoryImageData.data[pixel + 3] = color[3];
    }

    function reset() {
      const gameData = options.getGameData();
      const { width, height } = dimensions();
      wastelandImageData = options.wastelandContext.createImageData(width, height);
      territoryImageData = options.territoryContext.createImageData(width, height);
      options.territoryContext.putImageData(territoryImageData, 0, 0);
      options.wastelandCanvas.width = width;
      options.wastelandCanvas.height = height;
      options.territoryCanvas.width = width;
      options.territoryCanvas.height = height;
      territoryLayerDirty = false;
      wastelandLayerDirty = false;
      dirtyMinX = Infinity;
      dirtyMinY = Infinity;
      dirtyMaxX = -Infinity;
      dirtyMaxY = -Infinity;
    }

    function rebuildTerritory() {
      const gameData = options.getGameData();
      if (!gameData?.owners) return;
      if (options.webglRenderer) {
        options.webglSync.updateOwners();
        return;
      }
      const { width, height } = dimensions();
      options.territoryCanvas.width = width;
      options.territoryCanvas.height = height;
      territoryImageData = options.territoryContext.createImageData(width, height);
      for (let position = 0; position < gameData.owners.length; position += 1) paintTerritoryTile(position);
      options.territoryContext.putImageData(territoryImageData, 0, 0);
      compose();
    }

    function updateTerritory(changes) {
      if (options.webglRenderer || !territoryImageData) return;
      const affected = new Set();
      options.changeBuffer.forEach(changes, (position) => {
        affected.add(position);
        for (const neighbor of options.getNeighbors(position)) affected.add(neighbor);
      });
      for (const position of affected) {
        paintTerritoryTile(position);
        markDirty(position);
      }
      territoryLayerDirty = true;
      options.renderState.sceneDirty = true;
    }

    function updateWasteland(changes) {
      if (options.webglRenderer || !wastelandImageData) return;
      const wasteland = options.getWasteland();
      for (const change of changes || []) {
        const position = typeof change === 'number' ? change : change.position;
        if (position < 0 || position >= wasteland.length) continue;
        if (wasteland[position]) paintWastelandTile(position);
        else {
          const pixel = position * 4;
          wastelandImageData.data[pixel] = 0;
          wastelandImageData.data[pixel + 1] = 0;
          wastelandImageData.data[pixel + 2] = 0;
          wastelandImageData.data[pixel + 3] = 0;
        }
        markDirty(position);
      }
      if (changes?.length) {
        wastelandLayerDirty = true;
        options.renderState.sceneDirty = true;
      }
    }

    function draw() {
      const gameData = options.getGameData();
      const terrain = options.getTerrain();
      if (!gameData || !terrain || !options.renderState.sceneDirty) return;
      if (options.webglRenderer) {
        options.webglRenderer.draw();
        options.renderState.sceneDirty = false;
        return;
      }
      const { width, height } = dimensions();
      if (territoryLayerDirty || wastelandLayerDirty) {
        if (dirtyMinX <= dirtyMaxX && dirtyMinY <= dirtyMaxY) {
          const dirtyWidth = dirtyMaxX - dirtyMinX + 1;
          const dirtyHeight = dirtyMaxY - dirtyMinY + 1;
          const useFullBlit = dirtyWidth > width * 0.6 || dirtyHeight > height * 0.6;
          if (useFullBlit) {
            if (territoryLayerDirty) options.territoryContext.putImageData(territoryImageData, 0, 0);
            if (wastelandLayerDirty) options.wastelandContext.putImageData(wastelandImageData, 0, 0);
            compose();
          } else {
            if (territoryLayerDirty) options.territoryContext.putImageData(territoryImageData, 0, 0, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight);
            if (wastelandLayerDirty) options.wastelandContext.putImageData(wastelandImageData, 0, 0, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight);
            options.sceneContext.clearRect(dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight);
            options.sceneContext.drawImage(options.terrainCanvas, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight);
            options.sceneContext.drawImage(options.wastelandCanvas, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight);
            options.sceneContext.drawImage(options.territoryCanvas, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight, dirtyMinX, dirtyMinY, dirtyWidth, dirtyHeight);
          }
        }
        dirtyMinX = Infinity;
        dirtyMinY = Infinity;
        dirtyMaxX = -Infinity;
        dirtyMaxY = -Infinity;
        territoryLayerDirty = false;
        wastelandLayerDirty = false;
      }
      if (!options.renderState.sceneDirty) return;
      options.context.clearRect(0, 0, width, height);
      options.context.drawImage(options.sceneCanvas, 0, 0, width, height);
      options.renderState.sceneDirty = false;
    }

    return { buildTerrain, reset, rebuildTerritory, updateTerritory, updateWasteland, draw, compose };
  }

  modules.sceneRenderer = { createSceneRenderer };
}());
