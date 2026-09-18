(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createCanvasResizer(options) {
    let frame = null;
    let mapScale = 1;

    function resize() {
      if (options.mapFrame.clientWidth <= 10 || options.mapFrame.clientHeight <= 10) return false;
      options.invalidateLabels();
      const dimensions = options.getMapDimensions();
      mapScale = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      options.canvas.style.width = `${options.mapFrame.clientWidth}px`;
      options.canvas.style.height = `${options.mapFrame.clientHeight}px`;
      options.webglCanvas.style.width = `${options.mapFrame.clientWidth}px`;
      options.webglCanvas.style.height = `${options.mapFrame.clientHeight}px`;
      options.dynamicCanvas.style.width = `${options.canvas.offsetWidth}px`;
      options.dynamicCanvas.style.height = `${options.canvas.offsetHeight}px`;
      options.canvas.width = Math.ceil(dimensions.width * mapScale);
      options.canvas.height = Math.ceil(dimensions.height * mapScale);
      options.dynamicCanvas.width = Math.ceil(dimensions.width * mapScale);
      options.dynamicCanvas.height = Math.ceil(dimensions.height * mapScale);
      if (options.webglRenderer) {
        options.webglCanvas.width = options.canvas.width;
        options.webglCanvas.height = options.canvas.height;
        options.webglRenderer.resize();
      }
      options.context.setTransform(mapScale, 0, 0, mapScale, 0, 0);
      options.dynamicContext.setTransform(mapScale, 0, 0, mapScale, 0, 0);
      options.context.imageSmoothingEnabled = false;
      options.dynamicContext.imageSmoothingEnabled = false;
      if (options.hasTerrain()) {
        options.buildTerrainLayer();
        options.composeSceneLayer();
        options.draw();
      }
      return true;
    }

    function schedule() {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (options.gameScreen.hidden) return;
        if (!resize()) {
          schedule();
          return;
        }
        options.applyMapTransform();
      });
    }

    return {
      schedule,
      stop() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
      }
    };
  }

  modules.canvasResizer = { createCanvasResizer };
}());
