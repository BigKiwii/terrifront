(function () {
  'use strict';
  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createMapGestures(options) {
    const activePointers = new Map();
    let dragStart = null;
    let dragMoved = false;
    let pinchState = null;

    function blocked() { return options.isBlocked(); }
    function getCamera() { return options.getCamera(); }
    function setCamera(camera) { options.setCamera(camera); }

    options.mapFrame.addEventListener('wheel', (event) => {
      if (blocked()) return;
      if (event.shiftKey) {
        event.preventDefault();
        options.onRatioAdjust(event.deltaY > 0 ? -5 : 5);
        return;
      }
      event.preventDefault();
      const camera = getCamera();
      const rectangle = options.mapFrame.getBoundingClientRect();
      const visualCenterX = rectangle.left + rectangle.width / 2;
      const visualCenterY = rectangle.top + rectangle.height / 2;
      const localX = (event.clientX - visualCenterX) / camera.zoom;
      const localY = (event.clientY - visualCenterY) / camera.zoom;
      const nextZoom = options.clamp(camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1), 1, 200);
      const baseCenterX = visualCenterX - camera.panX;
      const baseCenterY = visualCenterY - camera.panY;
      setCamera({
        zoom: nextZoom,
        panX: event.clientX - localX * nextZoom - baseCenterX,
        panY: event.clientY - localY * nextZoom - baseCenterY
      });
      options.applyTransform();
    }, { passive: false });

    options.mapFrame.addEventListener('pointerdown', (event) => {
      if (blocked()) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const camera = getCamera();
      if (activePointers.size === 2) {
        const points = [...activePointers.values()];
        pinchState = {
          distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
          zoom: camera.zoom,
          panX: camera.panX,
          panY: camera.panY,
          midpoint: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
        };
        dragStart = null;
        dragMoved = true;
        options.mapFrame.classList.remove('is-dragging');
        options.mapFrame.setPointerCapture(event.pointerId);
        return;
      }
      dragStart = { x: event.clientX - camera.panX, y: event.clientY - camera.panY };
      dragMoved = false;
      options.mapFrame.setPointerCapture(event.pointerId);
      options.mapFrame.classList.add('is-dragging');
    });

    options.mapFrame.addEventListener('pointermove', (event) => {
      if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchState && activePointers.size >= 2) {
        const points = [...activePointers.values()];
        const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
        const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
        const scale = options.clamp(distance / pinchState.distance, 0.35, 4);
        setCamera({
          zoom: options.clamp(pinchState.zoom * scale, 1, 200),
          panX: pinchState.panX + midpoint.x - pinchState.midpoint.x,
          panY: pinchState.panY + midpoint.y - pinchState.midpoint.y
        });
        options.applyTransform();
        options.invalidateDynamic();
        options.scheduleDynamicDraw();
        return;
      }
      if (!dragStart) return;
      const camera = getCamera();
      if (Math.abs(event.clientX - dragStart.x - camera.panX) > 6 || Math.abs(event.clientY - dragStart.y - camera.panY) > 6) dragMoved = true;
      setCamera({ zoom: camera.zoom, panX: event.clientX - dragStart.x, panY: event.clientY - dragStart.y });
      options.applyTransform();
      options.onHover(options.positionFromPointer(event));
      options.invalidateDynamic();
      options.scheduleDynamicDraw();
    });

    options.mapFrame.addEventListener('pointerleave', () => {
      options.onHover(null);
      options.invalidateDynamic();
      options.scheduleDynamicDraw();
    });

    function stopDragging(event) {
      activePointers.delete(event.pointerId);
      if (pinchState) {
        if (activePointers.size < 2) pinchState = null;
        dragStart = null;
        if (options.mapFrame.hasPointerCapture(event.pointerId)) options.mapFrame.releasePointerCapture(event.pointerId);
        return;
      }
      if (!dragStart) return;
      const wasClick = !dragMoved;
      dragStart = null;
      options.mapFrame.classList.remove('is-dragging');
      if (options.mapFrame.hasPointerCapture(event.pointerId)) options.mapFrame.releasePointerCapture(event.pointerId);
      if (wasClick) options.onTap(event, options.positionFromPointer(event));
      options.onHover(null);
      options.invalidateDynamic();
      options.scheduleDynamicDraw();
    }

    options.mapFrame.addEventListener('pointerup', stopDragging);
    options.mapFrame.addEventListener('pointercancel', stopDragging);

    return {
      stop() {
        activePointers.clear();
        dragStart = null;
        pinchState = null;
        options.mapFrame.classList.remove('is-dragging');
      }
    };
  }

  modules.mapGestures = { createMapGestures };
}());
