class NeighbourAttackStrategy {
  constructor(map, territory, expansionManager, players, random) {
    this.map = map;
    this.territory = territory;
    this.expansionManager = expansionManager;
    this.players = players;
    this.random = random;
  }

  execute(bot) {
    const target = this.selectTarget(bot);
    if (target === null) return false;
    return this.expansionManager.start(bot.playerId, 600, target).accepted;
  }

  selectTarget(bot) {
    const targets = [];
    const seenOwners = new Set();
    for (const border of this.territory.getBorderSet(bot.ownerId)) {
      for (const position of this.map.getNeighbors(border)) {
        const ownerId = this.map.owners[position] || 0;
        if (!this.map.isLand(position) || ownerId === 0 || ownerId === bot.ownerId || seenOwners.has(ownerId)) continue;
        const defender = this.players.get(`player-${ownerId}`);
        if (!defender || this.territory.getTerritorySize(ownerId) === 0) continue;
        seenOwners.add(ownerId);
        targets.push({ ownerId, position });
      }
    }
    if (targets.length === 0) return null;

    let candidates = targets;
    if (this.random() * 100 < 45) {
      const smallTargets = targets.filter((target) =>
        this.territory.getTerritorySize(target.ownerId) < this.territory.getTerritorySize(bot.ownerId) * 0.1
      );
      if (smallTargets.length > 0) candidates = smallTargets;
    }

    if (this.random() * 100 < 55) {
      const botTargets = candidates.filter((target) => this.players.get(`player-${target.ownerId}`)?.isBot);
      if (botTargets.length > 0) candidates = botTargets;
    }

    if (this.random() * 100 < 20) {
      let lowestDensity = Infinity;
      let lowestTarget = candidates[0];
      for (const target of candidates) {
        const defender = this.players.get(`player-${target.ownerId}`);
        const density = defender.troops / Math.max(1, this.territory.getTerritorySize(target.ownerId));
        if (density < lowestDensity) {
          lowestDensity = density;
          lowestTarget = target;
        }
      }
      return lowestTarget.position;
    }

    return candidates[Math.floor(this.random() * candidates.length)].position;
  }
}

module.exports = NeighbourAttackStrategy;
