(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function decodeBytes(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function createMapAssets() {
    async function load(mapData, embeddedValue, errorLabel) {
      if (embeddedValue) return decodeBytes(embeddedValue);
      const assetUrl = window.location.protocol === 'file:'
        ? `http://localhost:8080${mapData[errorLabel.urlKey]}`
        : new URL(mapData[errorLabel.urlKey], window.location.href).href;
      const response = await fetch(assetUrl);
      if (!response.ok) throw new Error(`${errorLabel.name} request failed: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    }

    return {
      loadTerrain(mapData) {
        return load(mapData, window.TerriEmbeddedTerrain, { name: 'Terrain', urlKey: 'terrainUrl' });
      },
      loadExpansionTimes(mapData) {
        if (!mapData.expansionTimesUrl && !window.TerriEmbeddedExpansionTimes) return Promise.resolve(null);
        return load(mapData, window.TerriEmbeddedExpansionTimes, { name: 'Expansion times', urlKey: 'expansionTimesUrl' });
      }
    };
  }

  modules.mapAssets = { createMapAssets };
}());
