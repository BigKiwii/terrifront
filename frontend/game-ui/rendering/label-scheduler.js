(function () {
  'use strict';
  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createLabelScheduler(options) {
    let frame = null;
    let lastDrawAt = 0;
    return {
      draw() {
        const gameData = options.getGameData();
        const terrain = options.getTerrain();
        if (!gameData || !terrain) return;
        options.renderer.draw(gameData, options.getZoom(), options.getTerritoryVersion());
        options.renderState.labelsDirty = false;
        options.renderState.labelsCameraDirty = false;
        lastDrawAt = performance.now();
      },
      schedule() {
        options.renderState.labelsDirty = true;
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          if (options.getGameData() && options.getTerrain() && options.renderState.labelsDirty && options.renderState.labelsCameraDirty) this.draw();
        });
      },
      shouldDraw() {
        return options.renderState.labelsCameraDirty || performance.now() - lastDrawAt >= options.intervalMs;
      },
      stop() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
      }
    };
  }

  modules.labelScheduler = { createLabelScheduler };
}());
