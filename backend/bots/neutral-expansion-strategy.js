class NeutralExpansionStrategy {
  constructor(map, territory, expansionManager, random) {
    this.map = map;
    this.territory = territory;
    this.expansionManager = expansionManager;
    this.random = random;
    this.targetCache = new Map();
    this.activeAttackCache = null;
  }

  findTarget(ownerId, tickCount) {
    const cached = this.targetCache.get(ownerId);
    if (cached && cached.tick === tickCount) return cached.target;

    let target = null;
    let count = 0;
    for (const border of this.territory.getBorderSet(ownerId)) {
      for (const neighbor of this.map.getNeighbors(border)) {
        if (!this.map.isLand(neighbor) || this.map.owners[neighbor] !== 0) continue;
        count += 1;
        if (this.random() * count < 1) target = neighbor;
      }
    }
    this.targetCache.set(ownerId, { tick: tickCount, target });
    return target;
  }

  hasActiveAttack(playerId, tickCount) {
    if (!this.activeAttackCache || this.activeAttackCache.tick !== tickCount) {
      const activePlayers = new Set();
      for (const attack of this.expansionManager.attacks.values()) {
        if (attack.targetOwnerId === 0) activePlayers.add(attack.playerId);
      }
      this.activeAttackCache = { tick: tickCount, activePlayers };
    }
    return this.activeAttackCache.activePlayers.has(playerId);
  }

  execute(bot, tickCount, target) {
    if (this.hasActiveAttack(bot.playerId, tickCount)) {
      return this.expansionManager.reinforceNeutralAttack(bot.playerId, 100).accepted;
    }
    const resolvedTarget = target ?? this.findTarget(bot.ownerId, tickCount);
    if (resolvedTarget === null) return false;
    const result = this.expansionManager.start(bot.playerId, 100, resolvedTarget);
    return result.accepted;
  }
}

module.exports = NeutralExpansionStrategy;
