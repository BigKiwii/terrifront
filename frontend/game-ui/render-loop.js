(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createRenderLoop(options) {
    let running = false;
    let lastFrameAt = 0;
    let frameHandle = null;
    let pendingChanges = new Int32Array(0);
    let pendingLength = 0;
    let pendingHead = 0;
    let drainRate = 0;
    let drainCarry = 0;

    function queueChanges(changes, packetIntervalMs) {
      if (!changes?.length) return;
      const unread = pendingLength - pendingHead;
      if (pendingChanges.length < unread + changes.length) {
        const next = new Int32Array(Math.max(unread + changes.length, pendingChanges.length * 2, 1024));
        if (unread) next.set(pendingChanges.subarray(pendingHead, pendingLength));
        pendingChanges = next;
        pendingLength = unread;
        pendingHead = 0;
      } else if (pendingHead > 0 && unread) {
        pendingChanges.copyWithin(0, pendingHead, pendingLength);
        pendingLength = unread;
        pendingHead = 0;
      } else if (unread === 0) {
        pendingLength = 0;
        pendingHead = 0;
      }
      pendingChanges.set(changes, pendingLength);
      pendingLength += changes.length;
      const remaining = (pendingLength - pendingHead) / 2;
      drainRate = remaining / Math.max(16, packetIntervalMs);
    }

    function drainPendingChanges(deltaMs) {
      const remaining = (pendingLength - pendingHead) / 2;
      if (remaining === 0) return;
      drainCarry += drainRate * deltaMs;
      let budget = Math.floor(drainCarry);
      if (budget < 1) return;
      drainCarry -= budget;
      if (remaining <= budget + 1) budget = remaining;

      const applied = new Int32Array(Math.min(budget, remaining) * 2);
      let appliedLength = 0;
      const gameData = options.getGameData();
      while (pendingHead < pendingLength && budget > 0) {
        const position = pendingChanges[pendingHead++];
        const owner = pendingChanges[pendingHead++];
        gameData.owners[position] = owner;
        applied[appliedLength++] = position;
        applied[appliedLength++] = owner;
        budget -= 1;
      }
      if (pendingHead >= pendingLength) {
        pendingLength = 0;
        pendingHead = 0;
      } else if (pendingHead > 8192) {
        pendingChanges.copyWithin(0, pendingHead, pendingLength);
        pendingLength -= pendingHead;
        pendingHead = 0;
      }
      if (appliedLength) {
        const appliedChanges = applied.subarray(0, appliedLength);
        options.updateWebglOwners(appliedChanges);
        options.updateTerritoryLayer(appliedChanges);
        options.onTerritoryChanged();
      }
    }

    function renderFrame(timestamp) {
      if (!running) return;
      const deltaMs = lastFrameAt ? Math.min(200, timestamp - lastFrameAt) : 16;
      lastFrameAt = timestamp;
      drainPendingChanges(deltaMs);
      options.smoothTroops(deltaMs);
      if (options.getNukeFlight()) options.renderState.dynamicDirty = true;
      if (options.renderState.sceneDirty) options.drawScene();
      if (options.renderState.dynamicDirty) options.drawDynamic();
      if (options.renderState.labelsDirty && options.shouldDrawLabels()) options.drawLabels();
      frameHandle = requestAnimationFrame(renderFrame);
    }

    return {
      start() {
        if (running) return;
        running = true;
        lastFrameAt = 0;
        frameHandle = requestAnimationFrame(renderFrame);
      },
      stop() {
        running = false;
        lastFrameAt = 0;
        if (frameHandle !== null) cancelAnimationFrame(frameHandle);
        frameHandle = null;
        pendingChanges = new Int32Array(0);
        pendingLength = 0;
        pendingHead = 0;
        drainRate = 0;
        drainCarry = 0;
        options.resetInterpolation();
      },
      queueChanges,
      isRunning() {
        return running;
      }
    };
  }

  modules.renderLoop = { createRenderLoop };
}());
