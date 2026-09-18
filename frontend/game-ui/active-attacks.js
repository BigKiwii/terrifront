(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function formatTroops(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US').replace(/,/g, ' ');
  }

  function attackMergeKey(attack) {
    const targetOwnerId = Number(attack.targetOwnerId) || 0;
    return targetOwnerId ? `owner-${targetOwnerId}` : `neutral-${attack.playerId}`;
  }

  function createActiveAttacksRenderer(panel, cancelAttack) {
    const cardState = new Map();

    function bindCancel(button, playerId, attackIds) {
      button.onclick = () => {
        for (const attackId of attackIds) cancelAttack(playerId, attackId);
      };
    }

    function render(attacks, localPlayerId) {
      if (!panel) return;
      const mergedMap = new Map();
      for (const attack of attacks || []) {
        if (attack.playerId !== localPlayerId || attack.troops <= 0) continue;
        const key = attackMergeKey(attack);
        if (mergedMap.has(key)) {
          const merged = mergedMap.get(key);
          merged.troops += attack.troops;
          merged.attackIds.push(attack.id);
        } else mergedMap.set(key, { ...attack, attackIds: [attack.id] });
      }

      const existingCards = new Map(
        [...panel.querySelectorAll('.active-attack-card')]
          .map((card) => [card.dataset.key, card])
      );
      const seenKeys = new Set();
      for (const attack of mergedMap.values()) {
        const key = attackMergeKey(attack);
        seenKeys.add(key);
        const previousTroops = cardState.get(key)?.troops;
        if (existingCards.has(key)) {
          const card = existingCards.get(key);
          card.querySelector('.active-attack-troops').textContent = `${formatTroops(attack.troops)} troops`;
          bindCancel(card.querySelector('.active-attack-cancel'), localPlayerId, attack.attackIds);
          if (previousTroops !== undefined && attack.troops > previousTroops) {
            const gain = card.querySelector('.active-attack-gain');
            const gainState = cardState.get(key);
            gain.textContent = `+ ${formatTroops(attack.troops - previousTroops)}`;
            gain.classList.remove('is-fading');
            clearTimeout(gainState.fadeTimer);
            gainState.fadeTimer = setTimeout(() => gain.classList.add('is-fading'), 1800);
          }
          cardState.set(key, { ...cardState.get(key), troops: attack.troops, attackIds: attack.attackIds });
          continue;
        }

        const card = document.createElement('div');
        card.className = 'active-attack-card';
        card.dataset.key = key;
        const count = document.createElement('span');
        count.className = 'active-attack-troops';
        count.textContent = `${formatTroops(attack.troops)} troops`;
        const gain = document.createElement('span');
        gain.className = 'active-attack-gain is-fading';
        const cancel = document.createElement('button');
        cancel.className = 'active-attack-cancel';
        cancel.type = 'button';
        cancel.setAttribute('aria-label', 'Cancel attack');
        cancel.textContent = 'x';
        card.append(count, gain, cancel);
        panel.appendChild(card);
        bindCancel(cancel, localPlayerId, attack.attackIds);
        cardState.set(key, { troops: attack.troops, attackIds: attack.attackIds, fadeTimer: null });
      }

      for (const [key, card] of existingCards) {
        if (seenKeys.has(key)) continue;
        card.remove();
        const state = cardState.get(key);
        if (state) clearTimeout(state.fadeTimer);
        cardState.delete(key);
      }
      for (const [key, state] of cardState) {
        if (seenKeys.has(key)) continue;
        if (state.fadeTimer) clearTimeout(state.fadeTimer);
        cardState.delete(key);
      }
    }

    return {
      render,
      reset() {
        for (const state of cardState.values()) clearTimeout(state.fadeTimer);
        cardState.clear();
        panel?.replaceChildren();
      }
    };
  }

  modules.activeAttacks = { createActiveAttacksRenderer };
}());
