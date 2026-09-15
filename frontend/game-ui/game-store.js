(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createGameStore() {
    return {
      gameData: null,
      terrain: null,
      expansionTimes: null,
      phase: 'IDLE',
      localPlayerId: null,
      selectedPosition: null,
      selectedColor: '#69c878',
      selectedSpawnCells: [],
      confirmedPosition: null,
      localCapitalCells: new Set(),
      zoom: 1,
      panX: 0,
      panY: 0,
      hoverPosition: null,
      playerColors: new Map(),
      playerMap: new Map(),
      boats: [],
      territoryVersion: 0,
      render: {
        sceneDirty: true,
        dynamicDirty: true,
        labelsDirty: true,
        labelsCameraDirty: true
      }
    };
  }

  modules.gameStore = { createGameStore };
}());
