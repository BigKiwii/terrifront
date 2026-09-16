const BotTickCache = require('./bot-tick-cache');

class NeutralExpansionStrategy {
  constructor(map, territory, expansionManager, random, tickCache = new BotTickCache()) {
    this.map = map;
    this.territory = territory;
    this.expansionManager = expansionManager;
    this.random = random;
    this.tickCache = tickCache;
  }

  findTarget(ownerId, tickCount) {
    this.tickCache.reset(tickCount);
    if (this.tickCache.neutralTargets.has(ownerId)) {
      return this.tickCache.neutralTargets.get(ownerId);
    }

    let target = null;
    let count = 0;
    for (const border of this.territory.getBorderSet(ownerId)) {
      for (const neighbor of this.map.getNeighbors(border)) {
        if (!this.map.isLand(neighbor) || this.map.owners[neighbor] !== 0) continue;
        count += 1;
        if (this.random() * count < 1) target = neighbor;
      }
    }
    this.tickCache.neutralTargets.set(ownerId, target);
    return target;
  }

  hasActiveAttack(playerId, tickCount) {
    this.tickCache.reset(tickCount);
    if (!this.tickCache.activeAttackers) {
      const activePlayers = new Set();
      for (const attack of this.expansionManager.attacks.values()) {
        if (attack.targetOwnerId === 0) activePlayers.add(attack.playerId);
      }
      this.tickCache.activeAttackers = activePlayers;
    }
    return this.tickCache.activeAttackers.has(playerId);
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
