(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createMapTransform(options) {
    function apply() {
      const zoom = options.getZoom();
      const pan = options.getPan();
      const maxPanX = Math.max(260, (options.mapFrame.clientWidth * zoom - window.innerWidth) / 2 + 100);
      const maxPanY = Math.max(220, (options.mapFrame.clientHeight * zoom - window.innerHeight) / 2 + 100);
      options.setPan({
        x: options.clamp(pan.x, -maxPanX, maxPanX),
        y: options.clamp(pan.y, -maxPanY, maxPanY)
      });
      const nextPan = options.getPan();
      options.mapFrame.style.transform = `translate3d(${nextPan.x}px, ${nextPan.y}px, 0) scale(${zoom})`;
      options.onCameraChanged();
    }

    return {
      apply,
      reset() {
        options.setZoom(1);
        options.setPan({ x: 0, y: 0 });
        apply();
      }
    };
  }

  modules.mapTransform = { createMapTransform };
}());
