(function () {
  'use strict';
  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createRatioDisplay(options) {
    const track = document.querySelector('#ratio-track');
    const fill = document.querySelector('#ratio-bar-fill');
    const handle = document.querySelector('#ratio-handle');
    const label = document.querySelector('#ratio-bar-label');
    return {
      update(power, player) {
        const percentage = Number(power);
        if (fill) {
          fill.style.width = `${percentage}%`;
          fill.classList.toggle('is-aggressive', percentage > 70);
        }
        if (handle) handle.style.left = `${percentage}%`;
        if (track) track.setAttribute('aria-valuenow', String(percentage));
        const troops = Math.floor((player?.troops || 0) * percentage / 100);
        if (label) label.textContent = `${options.formatTroops(troops)} (${percentage}%)`;
      }
    };
  }

  modules.ratioDisplay = { createRatioDisplay };
}());
