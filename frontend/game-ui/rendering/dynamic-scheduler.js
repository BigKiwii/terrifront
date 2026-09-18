(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createDynamicScheduler(options) {
    let frame = null;
    return {
      invalidate() {
        options.renderState.dynamicDirty = true;
      },
      schedule() {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          options.drawDynamic();
        });
      },
      stop() {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
      }
    };
  }

  modules.dynamicScheduler = { createDynamicScheduler };
}());
