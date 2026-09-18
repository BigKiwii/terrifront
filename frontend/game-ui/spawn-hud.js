(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createSpawnHud() {
    const spawnHud = document.querySelector('#spawn-hud');
    const spawnTime = document.querySelector('#spawn-time');
    const progressBar = document.querySelector('#spawn-progress-bar');
    const spawnMessage = document.querySelector('#spawn-message');
    let phase = null;
    let timer = null;
    let deadlineSubmitted = false;

    function update() {
      if (!phase) return;
      const remainingMs = Math.max(0, phase.deadline - Date.now());
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      spawnTime.textContent = remainingSeconds;
      const elapsedMs = Math.min(phase.durationMs, phase.durationMs - remainingMs);
      progressBar.style.width = `${Math.max(0, elapsedMs / phase.durationMs) * 100}%`;
      progressBar.classList.toggle('is-critical', remainingMs <= 5000);
      if (remainingMs <= 1000 && !deadlineSubmitted) {
        deadlineSubmitted = true;
        phase.onDeadline?.();
      }
      if (remainingMs === 0) {
        stop();
        spawnMessage.textContent = 'SPAWN LOCKED // WAITING FOR SERVER';
      }
    }

    function stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      phase = null;
      deadlineSubmitted = false;
    }

    return {
      start(nextPhase, onDeadline) {
        stop();
        phase = { ...nextPhase, onDeadline };
        update();
        timer = setInterval(update, 50);
      },
      stop,
      show() {
        spawnHud.hidden = false;
      },
      hide() {
        spawnHud.hidden = true;
      },
      setMessage(message) {
        spawnMessage.textContent = message;
      }
    };
  }

  modules.spawnHud = { createSpawnHud };
}());
