(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createWebglSync(options) {
    return {
      updatePalette() {
        if (!options.renderer) return;
        options.renderer.setPalette(options.getPlayerColors(), options.getSelectedColor());
        options.renderState.sceneDirty = true;
      },
      updateOwners(changes = null) {
        const gameData = options.getGameData();
        if (!options.renderer || !gameData?.owners) return;
        if (changes?.length) options.renderer.updateOwners(gameData.owners, changes);
        else options.renderer.setOwners(gameData.owners);
        options.renderState.sceneDirty = true;
      },
      updateWasteland(changes = null) {
        if (!options.renderer || !options.getWasteland()) return;
        if (changes?.length) options.renderer.updateWasteland(options.getWasteland(), changes);
        else options.renderer.setWasteland(options.getWasteland());
        options.renderState.sceneDirty = true;
      }
    };
  }

  modules.webglSync = { createWebglSync };
}());
