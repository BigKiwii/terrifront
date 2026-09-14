const MAX_POWER = 1000;
const MAX_SCHEDULE_TICKS = 135;

class ExpansionManager {
  constructor(map, territory, players) {
    this.map = map;
    this.territory = territory;
    this.players = players;
    this.attacks = new Map();
    this.nextAttackId = 1;
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

    const targetOwnerId = targetPosition === null ? 0 : this.map.owners[targetPosition] || 0;
    const attack = {
      id: this.nextAttackId++,
      playerId,
      ownerId,
      targetOwnerId,
      troops,
      tileQueue: new Map(),
      queueSlot: 0,
      scheduledTiles: 0,
      queued: new Set(),
      targetPosition,
      neutralMomentum: false,
      borderTiles: new Set(frontTiles || this.territory.getBorderTiles(ownerId))
    };
    const candidates = this.getAttackCandidates(attack);
    if (candidates.length === 0) return { accepted: false, reason: 'NO_BORDER_TERRITORY' };

    player.troops = Math.max(0, player.troops - troops);
    this.attacks.set(attack.id, attack);
    this.scheduleCandidates(attack, candidates);
    return { accepted: true, playerId, troops, power: normalizedPower };
  }

  tick() {
    const changes = [];
    for (const attack of this.attacks.values()) {
      const currentSlot = attack.tileQueue.get(attack.queueSlot);
      if (currentSlot) attack.tileQueue.delete(attack.queueSlot);
      for (const position of currentSlot || []) {
        attack.scheduledTiles -= 1;
        attack.queued.delete(position);
        if (attack.troops <= 0) break;
        if (!this.isTargetTile(position, attack) || !this.map.isLand(position)) continue;
        if (!this.map.getNeighbors(position).some((neighbor) => this.map.owners[neighbor] === attack.ownerId)) continue;

        const result = this.territory.attackTile(position, attack.ownerId, attack.troops, this.players);
        if (!result.success || attack.troops < result.attackerLoss) continue;
        attack.troops -= result.attackerLoss;
        changes.push({ position, owner: attack.ownerId });
        for (const releasedPosition of result.releasedPositions || []) {
          changes.push({ position: releasedPosition, owner: 0 });
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

      attack.queueSlot = (attack.queueSlot + 1) % MAX_SCHEDULE_TICKS;
      if (attack.troops <= 0 || attack.scheduledTiles <= 0) this.finishAttack(attack);
    }
    return changes;
  }

  cancelEliminatedPlayer(ownerId) {
    for (const [attackId, attack] of this.attacks) {
      if (attack.ownerId !== ownerId) continue;
      this.attacks.delete(attackId);
    }
    const player = this.players.get(`player-${ownerId}`);
    if (player) player.troops = 0;
  }

  stopAllAttacks() {
    for (const attack of this.attacks.values()) {
      const player = this.players.get(attack.playerId);
      if (player && attack.troops > 0) player.troops += attack.troops;
    }
    this.attacks.clear();
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
    if (attack.targetOwnerId === 0) return this.map.isLand(position) && this.map.owners[position] === 0;
    return this.map.owners[position] === attack.targetOwnerId;
  }

  getSpeedFactor(attack) {
    if (attack.targetOwnerId === 0) return 1;
    const defender = this.players.get(`player-${attack.targetOwnerId}`);
    const attacker = this.players.get(attack.playerId);
    if (!defender || !attacker) return 1;
    const attackerPower = Math.max(1, this.territory.getTerritorySize(attack.ownerId)) * Math.max(1, attack.troops);
    const defenderPower = Math.max(1, this.territory.getTerritorySize(attack.targetOwnerId)) * Math.max(1, defender.troops);
    return 2 / (0.325 + Math.log(1 + Math.min(50, attackerPower / defenderPower)));
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
    for (const border of attack.borderTiles) {
      if (!this.territory.isOwnedBy(border, attack.ownerId)) {
        attack.borderTiles.delete(border);
        continue;
      }
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
    this.attacks.delete(attack.id);
  }

  cancel(playerId) {
    for (const attack of this.attacks.values()) {
      if (attack.playerId === playerId) this.finishAttack(attack);
    }
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
}

module.exports = ExpansionManager;
