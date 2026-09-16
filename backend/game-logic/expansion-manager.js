const MAX_POWER = 1000;
const MAX_SCHEDULE_TICKS = 135;
const DENSITY_SPEED_PRESSURE = 0.65;
const SPEED_BOOST_THRESHOLDS = [
  { territorySize: 3000, boost: 0.20 },
  { territorySize: 10000, boost: 0.25 },
  { territorySize: 20000, boost: 0.30 }
];
// NOTE: These were previously module-level (shared across all game instances),
// which caused cross-game data corruption when multiple games ticked
// concurrently. They are now instance properties on ExpansionManager.

class ExpansionManager {
  constructor(map, territory, players) {
    this.map = map;
    this.territory = territory;
    this.players = players;
    this.attacks = new Map();
    this.attacksByOwner = new Map();
    this.nextAttackId = 1;
    this.activeAttacksCache = [];
    this.activeAttacksDirty = true;
    // Per-instance scratch arrays — avoids cross-game corruption that occurred
    // when these were declared at module scope and shared by all game instances.
    this._tickChanges = [];
    this._attacksToFinish = [];
  }

  // `frontTiles` limits which of the player's own tiles the attack radiates
  // from. Omitted (the normal case) it uses the whole border, so a regular
  // attack still pushes along every front at once.
  start(playerId, power, targetPosition = null, frontTiles = null) {
    const player = this.players.get(playerId);
    if (!player) return { accepted: false, reason: 'PLAYER_NOT_FOUND' };
    const ownerId = Number(playerId.replace('player-', ''));
    const normalizedPower = Math.max(0, Math.min(MAX_POWER, Number(power) || 0));
    const troops = Math.min(player.troops, Math.floor(player.troops * normalizedPower / MAX_POWER));
    if (troops < 1) return { accepted: false, reason: 'NOT_ENOUGH_TROOPS' };
    return this.startWithTroops(playerId, troops, targetPosition, frontTiles);
  }

  reinforceNeutralAttack(playerId, power = 100) {
    const player = this.players.get(playerId);
    if (!player) return { accepted: false, reason: 'PLAYER_NOT_FOUND' };
    const attack = [...this.attacks.values()].find((activeAttack) =>
      activeAttack.playerId === playerId && activeAttack.targetOwnerId === 0
    );
    if (!attack) return { accepted: false, reason: 'NO_ACTIVE_NEUTRAL_ATTACK' };
    const normalizedPower = Math.max(0, Math.min(MAX_POWER, Number(power) || 0));
    const troops = Math.min(player.troops, Math.floor(player.troops * normalizedPower / MAX_POWER));
    if (troops < 1) return { accepted: false, reason: 'NOT_ENOUGH_TROOPS' };
    player.troops = Math.max(0, player.troops - troops);
    attack.troops += troops;
    return { accepted: true, playerId, troops, attackId: attack.id, merged: true };
  }

  startWithTroops(playerId, troops, targetPosition = null, frontTiles = null) {
    const player = this.players.get(playerId);
    if (!player) return { accepted: false, reason: 'PLAYER_NOT_FOUND' };
    const ownerId = Number(playerId.replace('player-', ''));
    const exactTroops = Math.max(0, Math.min(player.troops, Number(troops) || 0));
    if (exactTroops < 1) return { accepted: false, reason: 'NOT_ENOUGH_TROOPS' };

    // Resolve target identity purely by owner at click time.
    // For player attacks (targetOwnerId != 0) we track the *owner*, not the
    // clicked tile — any tile of that owner is the same target.
    // For neutral expansion (targetOwnerId === 0) targetPosition is the
    // anchor only used to distinguish separate neutral expansions.
    const targetOwnerId = targetPosition === null ? 0 : this.map.owners[targetPosition] || 0;

    // Merge key: for player attacks use targetOwnerId; for neutral use targetPosition.
    const existingAttack = [...this.attacks.values()].find((activeAttack) => {
      if (activeAttack.playerId !== playerId) return false;
      if (targetOwnerId !== 0) return activeAttack.targetOwnerId === targetOwnerId;
      return activeAttack.targetOwnerId === 0 && activeAttack.targetPosition === targetPosition;
    });

    if (existingAttack) {
      player.troops = Math.max(0, player.troops - exactTroops);
      existingAttack.troops += exactTroops;
      // Rebuild the full border so the merged attack radiates from everywhere,
      // then clear and reschedule all pending tiles with updated troop count.
      existingAttack.borderTiles = new Set(this.territory.getBorderSet(ownerId));
      const pendingTiles = [];
      for (const slotTiles of existingAttack.tileQueue.values()) pendingTiles.push(...slotTiles);
      existingAttack.tileQueue.clear();
      existingAttack.scheduledTiles = 0;
      existingAttack.queued.clear();
      const mergedCandidates = new Set(pendingTiles);
      for (const candidate of this.getAttackCandidates(existingAttack)) mergedCandidates.add(candidate);
      this.scheduleCandidates(existingAttack, [...mergedCandidates]);
      return { accepted: true, playerId, troops: exactTroops, attackId: existingAttack.id, merged: true };
    }

    const attack = {
      id: this.nextAttackId++,
      playerId,
      ownerId,
      targetOwnerId,
      troops: exactTroops,
      tileQueue: new Map(),
      queueSlot: 0,
      scheduledTiles: 0,
      queued: new Set(),
      // For player attacks drop targetPosition — it was only ever used as a
      // fallback merge key and caused the "different tile = new attack" bug.
      targetPosition: targetOwnerId === 0 ? targetPosition : null,
      neutralMomentum: false,
      frontTiles: frontTiles ? new Set(frontTiles) : null,
      borderTiles: new Set(frontTiles || this.territory.getBorderSet(ownerId)),
      frontierDirty: false
    };
    const candidates = this.getAttackCandidates(attack);
    if (candidates.size === 0) return { accepted: false, reason: 'NO_BORDER_TERRITORY' };

    player.troops = Math.max(0, player.troops - exactTroops);
    this.attacks.set(attack.id, attack);
    this.indexAttack(attack);
    this.activeAttacksDirty = true;
    this.scheduleCandidates(attack, candidates);
    return { accepted: true, playerId, troops: exactTroops };
  }

  tick() {
    const tickChanges = this._tickChanges;
    const attacksToFinish = this._attacksToFinish;
    tickChanges.length = 0;
    attacksToFinish.length = 0;
    for (const attack of this.attacks.values()) {
      const currentSlot = attack.tileQueue.get(attack.queueSlot);
      if (currentSlot) attack.tileQueue.delete(attack.queueSlot);
      // Do NOT reset frontierDirty here — getAttackCandidates (called below)
      // reads it to decide whether to rebuild the border copy. It is cleared
      // after that call so it is fresh for the next tick.
      for (const position of currentSlot || []) {
        attack.scheduledTiles -= 1;
        attack.queued.delete(position);
        if (attack.troops <= 0) break;
        if (!this.isTargetTile(position, attack) || !this.map.isLand(position)) continue;
        if (!this.map.getNeighbors(position).some((neighbor) => this.map.owners[neighbor] === attack.ownerId)) continue;

        const result = this.territory.attackTile(position, attack.ownerId, attack.troops, this.players);
        if (!result.success) continue;
        if (attack.troops < result.attackerLoss) {
          attack.troops = 0;
          break;
        }
        attack.troops -= result.attackerLoss;
        attack.frontierDirty = true;
        this.markOwnerFrontiersDirty(attack.ownerId);
        tickChanges.push({ position, owner: attack.ownerId });
        for (const releasedPosition of result.releasedPositions || []) {
          tickChanges.push({ position: releasedPosition, owner: 0 });
        }
        this.refreshAttackBorder(attack, position);
        if (result.eliminatedOwnerId) {
          attack.targetOwnerId = 0;
          attack.targetPosition = null;
          attack.neutralMomentum = true;
          this.requeueNeutralFrontier(attack, result.releasedPositions || []);
          this.cancelEliminatedPlayer(result.eliminatedOwnerId);
        }
        const frontier = [];
        for (const neighbor of this.map.getNeighbors(position)) {
          if (this.isTargetTile(neighbor, attack) && !attack.queued.has(neighbor)) frontier.push(neighbor);
        }
        this.scheduleCandidates(attack, frontier);
      }

      if (attack.frontierDirty || attack.scheduledTiles === 0) {
        this.scheduleCandidates(attack, this.getAttackCandidates(attack));
      }
      // Clear after getAttackCandidates has had a chance to read the flag.
      attack.frontierDirty = false;
      attack.queueSlot = (attack.queueSlot + 1) % MAX_SCHEDULE_TICKS;
      if (attack.troops <= 0 || (attack.scheduledTiles <= 0 && attack.tileQueue.size === 0)) attacksToFinish.push(attack);
    }
    for (const attack of attacksToFinish) this.finishAttack(attack);
    return tickChanges;
  }

  cancelEliminatedPlayer(ownerId) {
    const toDelete = [];
    for (const [attackId, attack] of this.attacks) {
      if (attack.ownerId === ownerId) toDelete.push(attackId);
    }
    for (const attackId of toDelete) {
      const attack = this.attacks.get(attackId);
      if (attack) this.unindexAttack(attack);
      this.attacks.delete(attackId);
    }
    if (toDelete.length > 0) this.activeAttacksDirty = true;
    const player = this.players.get(`player-${ownerId}`);
    if (player) player.troops = 0;
  }

  stopAllAttacks() {
    for (const attack of this.attacks.values()) {
      const player = this.players.get(attack.playerId);
      if (player && attack.troops > 0) player.troops += attack.troops;
    }
    this.attacks.clear();
    this.attacksByOwner.clear();
    this.activeAttacksDirty = true;
  }

  requeueNeutralFrontier(attack, releasedPositions) {
    const released = new Set(releasedPositions);
    for (const queue of attack.tileQueue.values()) {
      let write = 0;
      for (let index = 0; index < queue.length; index += 1) {
        if (released.has(queue[index])) {
          attack.scheduledTiles -= 1;
          continue;
        }
        queue[write++] = queue[index];
      }
      queue.length = write;
    }
    for (const position of released) attack.queued.delete(position);
    this.scheduleCandidates(attack, this.getAttackCandidates(attack));
  }

  isTargetTile(position, attack) {
    // For neutral expansion: any unowned land tile.
    if (attack.targetOwnerId === 0) return this.map.isLand(position) && this.map.owners[position] === 0;
    // For player attacks: any tile currently owned by that player, regardless
    // of which tile was originally clicked. This ensures the full enemy
    // territory is treated as the target, not just tiles near the click point.
    return this.map.owners[position] === attack.targetOwnerId;
  }

  getSpeedFactor(attack) {
    const attackerTerritorySize = this.territory.getTerritorySize(attack.ownerId);
    const defender = this.players.get(`player-${attack.targetOwnerId}`);
    const attacker = this.players.get(attack.playerId);
    const territoryBoost = attacker?.isBot ? 1 : this.getTerritorySpeedBoost(attackerTerritorySize);
    if (attack.targetOwnerId === 0) return 1 / territoryBoost;
    if (!defender || !attacker) return 1 / territoryBoost;
    const attackerPower = Math.max(1, attackerTerritorySize) * Math.max(1, attack.troops);
    const defenderPower = Math.max(1, this.territory.getTerritorySize(attack.targetOwnerId)) * Math.max(1, defender.troops) * DENSITY_SPEED_PRESSURE;
    return 2 / (0.325 + Math.log(1 + Math.min(50, attackerPower / defenderPower))) / territoryBoost;
  }

  getTerritorySpeedBoost(territorySize) {
    if (territorySize <= 0) return 1;
    let previousThreshold = 0;
    let previousBoost = 0;
    for (const threshold of SPEED_BOOST_THRESHOLDS) {
      if (territorySize <= threshold.territorySize) {
        const progress = (territorySize - previousThreshold) / (threshold.territorySize - previousThreshold);
        return 1 + previousBoost + (threshold.boost - previousBoost) * progress;
      }
      previousThreshold = threshold.territorySize;
      previousBoost = threshold.boost;
    }
    return 1 + SPEED_BOOST_THRESHOLDS[SPEED_BOOST_THRESHOLDS.length - 1].boost;
  }

  scheduleCandidates(attack, candidates) {
    const speedFactor = this.getSpeedFactor(attack);
    for (const position of candidates) {
      if (attack.queued.has(position)) continue;
      attack.queued.add(position);
      let contacts = 0;
      for (const neighbor of this.map.getNeighbors(position)) {
        if (this.map.owners[neighbor] === attack.ownerId) contacts += 1;
      }
      const expansionTime = this.map.expansionTimes?.[position] || 50;
      const jitter = Math.random() * 0.06;
      const momentum = attack.neutralMomentum ? 0.6 : 1;
      const delayTicks = Math.max(1, Math.floor(expansionTime * (0.08 - 0.02 * Math.min(3, contacts) + jitter) * speedFactor * momentum));
      const slot = (attack.queueSlot + delayTicks) % MAX_SCHEDULE_TICKS;
      let slotQueue = attack.tileQueue.get(slot);
      if (!slotQueue) {
        slotQueue = [];
        attack.tileQueue.set(slot, slotQueue);
      }
      slotQueue.push(position);
      attack.scheduledTiles += 1;
    }
  }

  getAttackCandidates(attack) {
    const candidates = new Set();
    if (attack.frontTiles) {
      // frontTiles is a constrained set (boat landing beachhead). Filter to
      // tiles still owned by the attacker, rebuild borderTiles from the result,
      // then collect neighbours that are valid targets.
      // Only rebuild when the frontier is actually dirty — avoids an O(N) copy
      // of the full border set on every tick for every active attack.
      if (attack.frontierDirty || attack.borderTiles.size === 0) {
        attack.borderTiles.clear();
        for (const position of attack.frontTiles) {
          if (this.territory.isOwnedBy(position, attack.ownerId)) {
            attack.borderTiles.add(position);
          }
        }
      }
    } else {
      // Normal attack: use the live border Set from TerritoryManager directly.
      // getBorderSet returns the internal Set — do NOT mutate it. We rebuild
      // attack.borderTiles from it so refreshAttackBorder can still track the
      // per-attack frontier independently.
      // Only copy when the frontier changed or the set is empty — this avoids
      // copying tens of thousands of border tiles on every tick for every
      // active attack when nothing has changed.
      if (attack.frontierDirty || attack.borderTiles.size === 0) {
        const liveBorder = this.territory.getBorderSet(attack.ownerId);
        attack.borderTiles.clear();
        for (const position of liveBorder) attack.borderTiles.add(position);
      }
    }
    for (const border of attack.borderTiles) {
      for (const neighbor of this.map.getNeighbors(border)) {
        if (this.isTargetTile(neighbor, attack)) candidates.add(neighbor);
      }
    }
    return candidates;
  }

  refreshAttackBorder(attack, position) {
    const refresh = (candidate) => {
      if (!this.territory.isOwnedBy(candidate, attack.ownerId)) return;
      if (this.territory.isBorderTile(candidate, attack.ownerId)) attack.borderTiles.add(candidate);
      else attack.borderTiles.delete(candidate);
    };
    refresh(position);
    for (const neighbor of this.map.getNeighbors(position)) refresh(neighbor);
  }

  finishAttack(attack) {
    const player = this.players.get(attack.playerId);
    if (player && attack.troops > 0) player.troops += attack.troops;
    if (this.attacks.delete(attack.id)) {
      this.unindexAttack(attack);
      this.activeAttacksDirty = true;
    }
  }

  indexAttack(attack) {
    let ownerAttacks = this.attacksByOwner.get(attack.ownerId);
    if (!ownerAttacks) {
      ownerAttacks = new Set();
      this.attacksByOwner.set(attack.ownerId, ownerAttacks);
    }
    ownerAttacks.add(attack);
  }

  unindexAttack(attack) {
    const ownerAttacks = this.attacksByOwner.get(attack.ownerId);
    if (!ownerAttacks) return;
    ownerAttacks.delete(attack);
    if (ownerAttacks.size === 0) this.attacksByOwner.delete(attack.ownerId);
  }

  markOwnerFrontiersDirty(ownerId) {
    for (const attack of this.attacksByOwner.get(ownerId) || []) attack.frontierDirty = true;
  }

  cancel(playerId) {
    for (const attack of this.attacks.values()) {
      if (attack.playerId === playerId) this.finishAttack(attack);
    }
  }

  cancelAttack(playerId, attackId) {
    const attack = this.attacks.get(Number(attackId));
    if (!attack || attack.playerId !== playerId) return false;
    this.finishAttack(attack);
    return true;
  }

  getActiveAttacks(playerId) {
    if (this.activeAttacksDirty) {
      this.activeAttacksCache = [...this.attacks.values()].map((attack) => ({
        id: attack.id,
        playerId: attack.playerId,
        targetOwnerId: attack.targetOwnerId,
        troops: attack.troops
      }));
      this.activeAttacksDirty = false;
    } else {
      let index = 0;
      for (const attack of this.attacks.values()) {
        const cachedAttack = this.activeAttacksCache[index++];
        cachedAttack.targetOwnerId = attack.targetOwnerId;
        cachedAttack.troops = attack.troops;
      }
    }
    if (!playerId) return this.activeAttacksCache;
    return this.activeAttacksCache.filter((attack) => attack.playerId === playerId);
  }

  isActive(playerId) {
    for (const attack of this.attacks.values()) {
      if (attack.playerId === playerId) return true;
    }
    return false;
  }

  getActiveCount(playerId) {
    let count = 0;
    for (const attack of this.attacks.values()) {
      if (attack.playerId === playerId) count += 1;
    }
    return count;
  }

  hasActiveTarget(playerId, targetOwnerId) {
    for (const attack of this.attacks.values()) {
      if (attack.playerId === playerId && attack.targetOwnerId === targetOwnerId) return true;
    }
    return false;
  }

  hasActivePlayerAttack(playerId) {
    for (const attack of this.attacks.values()) {
      if (attack.playerId === playerId && attack.targetOwnerId !== 0) return true;
    }
    return false;
  }
}

module.exports = ExpansionManager;
