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
      if (!gameData || !terrain) return;
      if (options.webglRenderer) {
        options.webglRenderer.setTerrain(terrain, gameData.map.width, gameData.map.height);
        options.renderState.sceneDirty = true;
        return;
      }
      throw new Error('Terrifront requires WebGL2 for map rendering');
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
      throw new Error('Terrifront requires WebGL2 for map rendering');
    }

    function updateTerritory(changes) {
      if (!options.webglRenderer) {
        throw new Error('Terrifront requires WebGL2 for map rendering');
      }
      options.webglSync.updateOwners(changes);
      options.renderState.sceneDirty = true;
    }

    function updateWasteland(changes) {
      if (!options.webglRenderer) {
        throw new Error('Terrifront requires WebGL2 for map rendering');
      }
      options.webglSync.updateWasteland(changes);
      options.renderState.sceneDirty = true;
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
      throw new Error('Terrifront requires WebGL2 for map rendering');
    }

    return { buildTerrain, reset, rebuildTerritory, updateTerritory, updateWasteland, draw, compose };
  }

  modules.sceneRenderer = { createSceneRenderer };
}());
