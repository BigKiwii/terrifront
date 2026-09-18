(function () {
  'use strict';
  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createPlayerRegistry(existingMap = new Map()) {
    const players = existingMap;
    return {
      map: players,
      rebuild(list) {
        players.clear();
        for (const player of list || []) players.set(player.playerId, player);
      },
      merge(list, allPlayers) {
        for (const player of list || []) {
          const current = players.get(player.playerId);
          if (current) Object.assign(current, player);
          else {
            const next = { ...player };
            players.set(player.playerId, next);
            allPlayers.push(next);
          }
        }
      }
    };
  }

  modules.playerRegistry = { createPlayerRegistry };
}());
