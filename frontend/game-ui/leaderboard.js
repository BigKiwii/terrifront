(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};
  const UPDATE_INTERVAL_MS = 250;

  function formatTroops(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US').replace(/,/g, ' ');
  }

  function createLeaderboardRenderer(leaderboard, focusPlayer) {
    let lastRenderedAt = 0;
    let list = null;

    function render(players, localPlayerId, force = false) {
      if (!players || !leaderboard) return;
      const now = performance.now();
      if (!force && now - lastRenderedAt < UPDATE_INTERVAL_MS) return;
      lastRenderedAt = now;
      const ranked = [...players]
        .filter((player) => player.isAlive !== false && (player.territorySize || 0) > 0)
        .sort((a, b) =>
          (b.territorySize || 0) - (a.territorySize || 0) || (b.troops || 0) - (a.troops || 0));
      const rankedEntries = ranked.map((player, index) => ({ player, index }));
      const displayEntries = rankedEntries;

      if (!list) {
        leaderboard.innerHTML = '<div class="leaderboard-title">LEADERBOARD</div><div class="leaderboard-list"></div>';
        list = leaderboard.querySelector('.leaderboard-list');
      }

      const existingRows = list.children;
      for (let index = 0; index < displayEntries.length; index += 1) {
        const { player, index: rankIndex } = displayEntries[index];
        const isLocal = player.playerId === localPlayerId;
        const wantedClass = `leaderboard-row${isLocal ? ' is-local' : ''}`;

        if (index < existingRows.length) {
          const row = existingRows[index];
          if (row.dataset.playerId !== player.playerId) {
            const fresh = row.cloneNode(true);
            fresh.dataset.playerId = player.playerId;
            fresh.title = `Focus ${player.playerName || player.playerId}`;
            fresh.addEventListener('click', () => focusPlayer(player.playerId));
            fresh.addEventListener('keydown', (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              focusPlayer(player.playerId);
            });
            list.replaceChild(fresh, row);
          }
          const current = existingRows[index];
          if (current.className !== wantedClass) current.className = wantedClass;
          const rank = current.querySelector('.leaderboard-rank');
          const name = current.querySelector('.leaderboard-name');
          const values = current.querySelector('.leaderboard-values');
          const wantedRank = `${rankIndex + 1}.`;
          const wantedName = player.playerName || player.playerId;
          const wantedValues = formatTroops(player.territorySize || 0);
          if (rank && rank.textContent !== wantedRank) rank.textContent = wantedRank;
          if (name && name.textContent !== wantedName) name.textContent = wantedName;
          if (values && values.textContent !== wantedValues) values.textContent = wantedValues;
        } else {
          const row = document.createElement('div');
          row.className = wantedClass;
          row.dataset.playerId = player.playerId;
          row.tabIndex = 0;
          row.setAttribute('role', 'button');
          row.title = `Focus ${player.playerName || player.playerId}`;
          row.addEventListener('click', () => focusPlayer(player.playerId));
          row.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            focusPlayer(player.playerId);
          });
          row.innerHTML = `<span class="leaderboard-rank">${rankIndex + 1}.</span><span class="leaderboard-name"></span><span class="leaderboard-values">${formatTroops(player.territorySize || 0)}</span>`;
          row.querySelector('.leaderboard-name').textContent = player.playerName || player.playerId;
          list.appendChild(row);
        }
      }
      while (list.children.length > displayEntries.length) list.removeChild(list.lastChild);
    }

    return {
      render,
      reset() {
        lastRenderedAt = 0;
        list = null;
        leaderboard.innerHTML = '';
      }
    };
  }

  modules.leaderboard = { createLeaderboardRenderer };
}());
