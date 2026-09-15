(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function createCameraController({ mapFrame, canvas, windowObject = window, getState, setState, getMapSize, getLabelCenter, onTransform }) {
    let animationFrame = null;

    function applyTransform() {
      const state = getState();
      const maxPanX = Math.max(260, (mapFrame.clientWidth * state.zoom - windowObject.innerWidth) / 2 + 100);
      const maxPanY = Math.max(220, (mapFrame.clientHeight * state.zoom - windowObject.innerHeight) / 2 + 100);
      state.panX = clamp(state.panX, -maxPanX, maxPanX);
      state.panY = clamp(state.panY, -maxPanY, maxPanY);
      setState(state);
      mapFrame.style.transform = `translate3d(${state.panX}px, ${state.panY}px, 0) scale(${state.zoom})`;
      onTransform();
    }

    function cancel() {
      if (animationFrame) windowObject.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }

    function reset() {
      setState({ zoom: 1, panX: 0, panY: 0 });
      applyTransform();
    }

    function animateToCenter() {
      cancel();
      const start = { ...getState() };
      const startedAt = windowObject.performance.now();
      const duration = 2800;

      function step(now) {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        setState({
          zoom: start.zoom + (1 - start.zoom) * eased,
          panX: start.panX * (1 - eased),
          panY: start.panY * (1 - eased)
        });
        applyTransform();
        if (progress < 1) animationFrame = windowObject.requestAnimationFrame(step);
        else {
          animationFrame = null;
          reset();
        }
      }

      animationFrame = windowObject.requestAnimationFrame(step);
    }

    function focusPlayer(playerId, territoryVersion) {
      const target = getLabelCenter(playerId, territoryVersion);
      if (!target) return;
      const state = getState();
      const mapSize = getMapSize();
      const targetZoom = 4;
      const targetOffsetX = canvas.offsetLeft + target.x / mapSize.width * canvas.offsetWidth - mapFrame.offsetWidth / 2;
      const targetOffsetY = canvas.offsetTop + target.y / mapSize.height * canvas.offsetHeight - mapFrame.offsetHeight / 2;
      const targetPanX = -targetOffsetX * targetZoom;
      const targetPanY = -targetOffsetY * targetZoom;
      const startedAt = windowObject.performance.now();
      const duration = 650;
      cancel();

      function step(now) {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        setState({
          zoom: state.zoom + (targetZoom - state.zoom) * eased,
          panX: state.panX + (targetPanX - state.panX) * eased,
          panY: state.panY + (targetPanY - state.panY) * eased
        });
        applyTransform();
        if (progress < 1) animationFrame = windowObject.requestAnimationFrame(step);
        else animationFrame = null;
      }

      animationFrame = windowObject.requestAnimationFrame(step);
    }

    return {
      applyTransform,
      animateToCenter,
      cancel,
      focusPlayer,
      isAnimating: () => animationFrame !== null,
      reset
    };
  }

  modules.cameraController = { createCameraController };
}());