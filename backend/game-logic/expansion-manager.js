const MAX_POWER = 1000;
const MAX_SCHEDULE_TICKS = 135;

class ExpansionManager {
  constructor(map, territory, players) {
    this.map = map;
    this.territory = territory;
    this.players = players;
    this.attacks = new Map();
  }

  start(playerId, power, targetPosition = null) {
    const player = this.players.get(playerId);
    if (!player) return { accepted: false, reason: 'PLAYER_NOT_FOUND' };
    const ownerId = Number(playerId.replace('player-', ''));
    const normalizedPower = Math.max(0, Math.min(MAX_POWER, Number(power) || 0));
    const troops = Math.min(player.troops, Math.floor(player.troops * normalizedPower / MAX_POWER));
    if (troops < 1) return { accepted: false, reason: 'NOT_ENOUGH_TROOPS' };

    const targetOwnerId = targetPosition === null ? 0 : this.map.owners[targetPosition] || 0;
    const existing = this.attacks.get(playerId);
    if (existing) {
      player.troops = Math.max(0, player.troops - troops);
      existing.troops += troops;
      if (targetPosition !== null) {
        existing.targetPosition = targetPosition;
        existing.targetOwnerId = targetOwnerId;
      }
      return { accepted: true, playerId, troops, power: normalizedPower };
    }

    const attack = {
      playerId,
      ownerId,
      targetOwnerId,
      troops,
      tileQueue: Array.from({ length: MAX_SCHEDULE_TICKS }, () => []),
      queueSlot: 0,
      scheduledTiles: 0,
      queued: new Set(),
      targetPosition,
      borderTiles: new Set(this.territory.getBorderTiles(ownerId))
    };
    const candidates = this.getAttackCandidates(attack);
    if (candidates.length === 0) return { accepted: false, reason: 'NO_BORDER_TERRITORY' };

    player.troops = Math.max(0, player.troops - troops);
    this.attacks.set(playerId, attack);
    this.scheduleCandidates(attack, candidates);
    return { accepted: true, playerId, troops, power: normalizedPower };
  }

  tick() {
    const changes = [];
    for (const attack of this.attacks.values()) {
      const currentSlot = attack.tileQueue[attack.queueSlot];
      const toProcess = currentSlot.splice(0, currentSlot.length);
      for (const position of toProcess) {
        attack.scheduledTiles -= 1;
        attack.queued.delete(position);
        if (attack.troops <= 0) break;
        if (!this.isTargetTile(position, attack) || !this.map.isLand(position)) continue;
        if (!this.map.getNeighbors(position).some((neighbor) => this.map.owners[neighbor] === attack.ownerId)) continue;

        const result = this.territory.attackTile(position, attack.ownerId, attack.troops, this.players);
        if (!result.success || attack.troops < result.attackerLoss) continue;
        attack.troops -= result.attackerLoss;
        changes.push({ position, owner: attack.ownerId });
        this.refreshAttackBorder(attack, position);
        const frontier = this.map.getNeighbors(position)
          .filter((neighbor) => this.isTargetTile(neighbor, attack) && !attack.queued.has(neighbor));
        this.scheduleCandidates(attack, frontier);
      }

      attack.queueSlot = (attack.queueSlot + 1) % MAX_SCHEDULE_TICKS;
      if (attack.troops <= 0 || attack.scheduledTiles <= 0) this.finishAttack(attack);
    }
    return changes;
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
      const contacts = this.map.getNeighbors(position)
        .filter((neighbor) => this.map.owners[neighbor] === attack.ownerId).length;
      const expansionTime = this.map.expansionTimes?.[position] || 50;
      const jitter = Math.random() * 0.06;
      const delayTicks = Math.max(1, Math.floor(expansionTime * (0.08 - 0.02 * Math.min(3, contacts) + jitter) * speedFactor));
      const slot = (attack.queueSlot + delayTicks) % MAX_SCHEDULE_TICKS;
      attack.tileQueue[slot].push(position);
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
    return [...candidates];
  }

  refreshAttackBorder(attack, position) {
    for (const candidate of [position, ...this.map.getNeighbors(position)]) {
      if (!this.territory.isOwnedBy(candidate, attack.ownerId)) continue;
      if (this.territory.isBorderTile(candidate, attack.ownerId)) attack.borderTiles.add(candidate);
      else attack.borderTiles.delete(candidate);
    }
  }

  finishAttack(attack) {
    const player = this.players.get(attack.playerId);
    if (player && attack.troops > 0) player.troops += attack.troops;
    this.attacks.delete(attack.playerId);
  }

  cancel(playerId) {
    const attack = this.attacks.get(playerId);
    if (attack) this.finishAttack(attack);
  }

  isActive(playerId) {
    return this.attacks.has(playerId);
  }
}

module.exports = ExpansionManager;
