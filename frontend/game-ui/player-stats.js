(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function formatTroops(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US').replace(/,/g, ' ');
  }

  function createPlayerStatsRenderer(options = {}) {
    const selectorStats = document.querySelector('#selector-stats');
    const selectorTroopCount = document.querySelector('#selector-troop-count');
    const selectorTerritory = document.querySelector('#selector-territory');
    const selectorDensity = document.querySelector('#selector-density');

    return {
      render(player) {
        if (!player) return;
        options.setTargetTroops(player.troops || 0);
        if (selectorStats) selectorStats.hidden = false;
        if (selectorTroopCount) selectorTroopCount.textContent = formatTroops(player.troops || 0);
        if (selectorTerritory) selectorTerritory.textContent = formatTroops(player.territorySize || 0);
        if (selectorDensity) {
          const density = player.territorySize > 0
            ? (player.troops / player.territorySize).toFixed(2)
            : '0.00';
          selectorDensity.textContent = density;
        }
        options.updateRatioDisplay();
      }
    };
  }

  modules.playerStats = { createPlayerStatsRenderer };
}());
