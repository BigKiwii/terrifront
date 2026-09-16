class NeutralExpansionStrategy {
  constructor(map, territory, expansionManager, random) {
    this.map = map;
    this.territory = territory;
    this.expansionManager = expansionManager;
    this.random = random;
  }

  findTarget(ownerId) {
    let target = null;
    let count = 0;
    for (const border of this.territory.getBorderSet(ownerId)) {
      for (const neighbor of this.map.getNeighbors(border)) {
        if (!this.map.isLand(neighbor) || this.map.owners[neighbor] !== 0) continue;
        count += 1;
        if (this.random() * count < 1) target = neighbor;
      }
    }
    return target;
  }

  hasActiveAttack(playerId) {
    for (const attack of this.expansionManager.attacks.values()) {
      if (attack.playerId === playerId && attack.targetOwnerId === 0) return true;
    }
    return false;
  }

  execute(bot, target = this.findTarget(bot.ownerId)) {
    if (this.hasActiveAttack(bot.playerId)) {
      return this.expansionManager.reinforceNeutralAttack(bot.playerId, 100).accepted;
    }
    if (target === null) return false;
    const result = this.expansionManager.start(bot.playerId, 100, target);
    return result.accepted;
  }
}

module.exports = NeutralExpansionStrategy;
