(function () {
  'use strict';
  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createRatioDisplay(options) {
    const fill = document.querySelector('#ratio-bar-fill');
    const label = document.querySelector('#ratio-bar-label');
    return {
      update(power, player) {
        const percentage = Number(power);
        if (fill) {
          fill.style.width = `${percentage}%`;
          fill.classList.toggle('is-aggressive', percentage > 70);
        }
        const troops = Math.floor((player?.troops || 0) * percentage / 100);
        if (label) label.textContent = `${options.formatTroops(troops)} (${percentage}%)`;
      }
    };
  }

  modules.ratioDisplay = { createRatioDisplay };
}());
