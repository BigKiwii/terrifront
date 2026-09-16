class BoatAttackStrategy {
  constructor(map, territory, boatManager, random) {
    this.map = map;
    this.territory = territory;
    this.boatManager = boatManager;
    this.random = random;
  }

  execute(bot) {
    if (!this.boatManager || this.random() >= 0.3) return false;
    const borderTiles = this.territory.getBorderSet(bot.ownerId);
    let waterBorder = null;
    let waterCount = 0;
    for (const border of borderTiles) {
      if (!this.map.getNeighbors(border).some((neighbor) => !this.map.isLand(neighbor))) continue;
      waterCount += 1;
      if (this.random() * waterCount < 1) waterBorder = border;
    }
    if (waterBorder === null) return false;

    const targetPosition = this.findTarget(bot.ownerId, waterBorder);
    if (targetPosition === null) return false;
    const result = this.boatManager.launch(bot.playerId, 100, targetPosition);
    return result.accepted;
  }

  findTarget(ownerId, borderPosition) {
    const neighbors = this.map.getNeighbors(borderPosition);
    for (const neighbor of neighbors) {
      if (this.map.isLand(neighbor) && this.map.owners[neighbor] !== ownerId) return neighbor;
    }
    for (let attempts = 0; attempts < 12; attempts += 1) {
      const position = Math.floor(this.random() * this.map.cellCount);
      if (this.map.isLand(position) && this.map.owners[position] !== ownerId) return position;
    }
    return null;
  }
}

module.exports = BoatAttackStrategy;
