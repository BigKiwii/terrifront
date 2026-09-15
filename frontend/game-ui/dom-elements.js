(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function getGameDom(root = document) {
    return {
      canvas: root.querySelector('#game-canvas'),
      dynamicCanvas: root.querySelector('#dynamic-canvas'),
      mapFrame: root.querySelector('.map-frame'),
      gameScreen: root.querySelector('#game-screen'),
      mapMenu: root.querySelector('#map-menu'),
      spawnHud: root.querySelector('#spawn-hud'),
      spawnTime: root.querySelector('#spawn-time'),
      progressBar: root.querySelector('#spawn-progress-bar'),
      spawnMessage: root.querySelector('#spawn-message'),
      troopDisplay: root.querySelector('#troop-display'),
      troopCount: root.querySelector('#troop-count'),
      territoryCount: root.querySelector('#territory-count'),
      leaderboard: root.querySelector('#leaderboard'),
      cancelButton: root.querySelector('#cancel-button'),
      winnerBanner: root.querySelector('#winner-banner'),
      attackRatioPanel: root.querySelector('#attack-ratio-panel'),
      powerSlider: root.querySelector('#power-slider'),
      ratioPercent: root.querySelector('#ratio-percent'),
      ratioTroops: root.querySelector('#ratio-troops')
    };
  }

  modules.domElements = { getGameDom };
}());