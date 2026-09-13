class TerritoryManager {
  constructor(map) {
    this.map = map;
    this.borderTiles = new Map();
    this.borderSets = new Map();
    this.territorySizes = new Map();
    this.eliminationBases = new Map();
    this.tileGrades = new Uint8Array(map.cellCount);
    this.gradesInitialized = false;
  }

  getOwner(position) {
    return this.map.owners[position] ?? 0;
  }

  isOwnedBy(position, ownerId) {
    return this.getOwner(position) === ownerId;
  }

  isUnclaimedLand(position) {
    return this.map.isLand(position) && this.getOwner(position) === 0;
  }

  isBorderTile(position, ownerId) {
    return this.isOwnedBy(position, ownerId) && this.tileGrades[position] < this.map.getNeighbors(position).length;
  }

  getBorderTiles(ownerId) {
    if (!this.borderTiles.has(ownerId)) this.rebuildBorders(ownerId);
    return [...this.borderTiles.get(ownerId)];
  }

  rebuildBorders(ownerId) {
    this.initializeGrades();
    const borders = new Set();
    for (let position = 0; position < this.map.cellCount; position += 1) {
      if (this.isBorderTile(position, ownerId)) borders.add(position);
    }
    this.borderTiles.set(ownerId, borders);
  }

  refreshBorder(position, ownerId) {
    if (!this.borderTiles.has(ownerId)) this.borderTiles.set(ownerId, new Set());
    const borders = this.borderTiles.get(ownerId);
    if (this.isBorderTile(position, ownerId)) borders.add(position);
    else borders.delete(position);
  }

  getBorderSet(ownerId) {
    if (!this.borderTiles.has(ownerId)) this.rebuildBorders(ownerId);
    return this.borderTiles.get(ownerId);
  }

  registerOwner(ownerId, cells = []) {
    this.initializeGrades();
    if (!this.borderTiles.has(ownerId)) this.borderTiles.set(ownerId, new Set());
    const borders = this.borderTiles.get(ownerId);
    for (const position of cells) {
      this.updateTileGrade(position);
      for (const neighbor of this.map.getNeighbors(position)) this.updateTileGrade(neighbor);
      this.refreshBorder(position, ownerId);
      for (const neighbor of this.map.getNeighbors(position)) this.refreshBorder(neighbor, ownerId);
    }
    this.borderSets.set(ownerId, borders);
    const territorySize = (this.territorySizes.get(ownerId) ?? 0) + cells.length;
    this.territorySizes.set(ownerId, territorySize);
    this.eliminationBases.set(ownerId, Math.max(this.eliminationBases.get(ownerId) ?? 0, territorySize));
  }

  removeOwnerCells(ownerId, cells) {
    const borders = this.getBorderSet(ownerId);
    for (const position of cells) {
      this.map.owners[position] = 0;
      for (const affectedPosition of [position, ...this.map.getNeighbors(position)]) {
        this.updateTileGrade(affectedPosition);
        this.refreshBorder(affectedPosition, ownerId);
      }
      borders.delete(position);
    }
    this.territorySizes.set(ownerId, Math.max(0, (this.territorySizes.get(ownerId) ?? 0) - cells.length));
  }

  initializeGrades() {
    if (this.gradesInitialized) return;
    for (let position = 0; position < this.map.cellCount; position += 1) this.updateTileGrade(position);
    this.gradesInitialized = true;
  }

  getExpansionCandidates(ownerId) {
    const candidates = new Set();
    for (const border of this.getBorderSet(ownerId)) {
      for (const neighbor of this.map.getNeighbors(border)) {
        if (this.map.isLand(neighbor) && this.getOwner(neighbor) === 0) candidates.add(neighbor);
      }
    }
    return [...candidates];
  }

  getRandomExpansionCandidate(ownerId) {
    const candidates = [];
    for (const border of this.getBorderSet(ownerId)) {
      for (const neighbor of this.map.getNeighbors(border)) {
        if (this.map.isLand(neighbor) && this.getOwner(neighbor) === 0) candidates.push(neighbor);
      }
    }
    return candidates.length === 0 ? null : candidates[Math.floor(Math.random() * candidates.length)];
  }

  getRandomAttackCandidate(ownerId) {
    const candidates = [];
    for (const border of this.getBorderSet(ownerId)) {
      for (const neighbor of this.map.getNeighbors(border)) {
        if (this.map.isLand(neighbor) && !this.isOwnedBy(neighbor, ownerId)) candidates.push(neighbor);
      }
    }
    return candidates.length === 0 ? null : candidates[Math.floor(Math.random() * candidates.length)];
  }

  getAttackCandidates(ownerId) {
    const candidates = new Set();
    for (const border of this.getBorderSet(ownerId)) {
      for (const neighbor of this.map.getNeighbors(border)) {
        if (this.map.isLand(neighbor) && !this.isOwnedBy(neighbor, ownerId)) candidates.add(neighbor);
      }
    }
    return [...candidates];
  }

  getUniformExpansionCandidates(ownerId) {
    const byBorder = new Map();
    for (const border of this.getBorderSet(ownerId)) {
      const candidates = this.map.getNeighbors(border).filter((neighbor) =>
        this.map.isLand(neighbor) && this.getOwner(neighbor) === 0);
      if (candidates.length > 0) byBorder.set(border, candidates);
    }

    const result = [];
    const used = new Set();
    let added = true;
    while (added) {
      added = false;
      for (const candidates of byBorder.values()) {
        const position = candidates.find((candidate) => !used.has(candidate));
        if (position === undefined) continue;
        used.add(position);
        result.push(position);
        added = true;
      }
    }
    return result;
  }

  getNearestExpansionCandidate(ownerId, position, radius = 12) {
    const targetX = position % this.map.width;
    const targetY = Math.floor(position / this.map.width);
    let nearest = null;
    let nearestDistance = radius ** 2;
    for (const candidate of this.getExpansionCandidates(ownerId)) {
      const x = candidate % this.map.width;
      const y = Math.floor(candidate / this.map.width);
      const distance = (x - targetX) ** 2 + (y - targetY) ** 2;
      if (distance <= nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  getDirectedExpansionCandidates(ownerId, targetPosition) {
    const targetX = targetPosition % this.map.width;
    const targetY = Math.floor(targetPosition / this.map.width);

    return this.getExpansionCandidates(ownerId).sort((a, b) => {
      const ax = a % this.map.width;
      const ay = Math.floor(a / this.map.width);
      const bx = b % this.map.width;
      const by = Math.floor(b / this.map.width);
      const distanceA = (ax - targetX) ** 2 + (ay - targetY) ** 2;
      const distanceB = (bx - targetX) ** 2 + (by - targetY) ** 2;
      return distanceA - distanceB;
    });
  }

  attackTile(position, attackerId, attackerTroops, players) {
    if (!this.map.isLand(position)) return { success: false };
    if (this.map.owners[position] === attackerId) return { success: false };
    if (!this.map.getNeighbors(position).some((neighbor) => this.map.owners[neighbor] === attackerId)) {
      return { success: false, attackerLoss: 0 };
    }

    const defenderId = this.map.owners[position];
    let attackerLoss = this.map.expansionTimes?.[position]
      ? this.map.expansionTimes[position] / 50
      : 0;
    if (defenderId !== 0) {
      const defender = players.get(`player-${defenderId}`);
      if (defender) {
        const territorySize = this.getTerritorySize(defenderId);
        const defenderDensity = defender.troops / Math.max(1, territorySize);
        attackerLoss = Math.max(1, Math.floor(defenderDensity * 2));
      }
    }

    if (attackerTroops < attackerLoss) {
      return { success: false, attackerLoss };
    }

    if (defenderId !== 0) {
      const defender = players.get(`player-${defenderId}`);
      if (defender) {
        const defenseCost = Math.max(1, Math.ceil((1 + attackerLoss) / 1.7));
        defender.troops = Math.max(0, defender.troops - defenseCost);
      }
    }

    if (defenderId !== 0) {
      this.territorySizes.set(defenderId, Math.max(0, (this.territorySizes.get(defenderId) ?? 1) - 1));
      if (this.territorySizes.get(defenderId) <= 0) {
        const defender = players.get(`player-${defenderId}`);
        if (defender) defender.troops = 0;
      }
    }
    this.map.owners[position] = attackerId;
    const attackerTerritorySize = (this.territorySizes.get(attackerId) ?? 0) + 1;
    this.territorySizes.set(attackerId, attackerTerritorySize);
    this.eliminationBases.set(attackerId, Math.max(this.eliminationBases.get(attackerId) ?? 0, attackerTerritorySize));
    for (const affectedPosition of [position, ...this.map.getNeighbors(position)]) {
      this.updateTileGrade(affectedPosition);
    }
    const affectedOwners = new Set([attackerId]);
    for (const neighbor of this.map.getNeighbors(position)) {
      const neighborOwner = this.getOwner(neighbor);
      if (neighborOwner) affectedOwners.add(neighborOwner);
    }
    for (const affectedOwner of affectedOwners) {
      this.refreshBorder(position, affectedOwner);
      for (const neighbor of this.map.getNeighbors(position)) this.refreshBorder(neighbor, affectedOwner);
    }
    for (const affectedOwner of affectedOwners) {
      this.updateBorderOnClaim(position, affectedOwner);
    }
    let eliminatedOwnerId = 0;
    let releasedPositions = [];
    if (defenderId !== 0 && this.shouldEliminate(defenderId)) {
      eliminatedOwnerId = defenderId;
      releasedPositions = this.releaseOwner(defenderId);
      const defender = players.get(`player-${defenderId}`);
      if (defender) defender.troops = 0;
    }
    return { success: true, attackerLoss, eliminatedOwnerId, releasedPositions };
  }

  shouldEliminate(ownerId) {
    const baseSize = this.eliminationBases.get(ownerId) ?? 0;
    const currentSize = this.getTerritorySize(ownerId);
    return baseSize > 0 && currentSize > 0 && currentSize <= baseSize * 0.15;
  }

  releaseOwner(ownerId) {
    const releasedPositions = [];
    for (let position = 0; position < this.map.cellCount; position += 1) {
      if (this.map.owners[position] !== ownerId) continue;
      this.map.owners[position] = 0;
      releasedPositions.push(position);
    }
    for (const position of releasedPositions) {
      for (const affectedPosition of [position, ...this.map.getNeighbors(position)]) {
        this.updateTileGrade(affectedPosition);
      }
    }
    this.territorySizes.set(ownerId, 0);
    this.borderTiles.delete(ownerId);
    this.borderSets.delete(ownerId);
    return releasedPositions;
  }

  updateBorderOnClaim(position, ownerId) {
    if (!this.borderSets.has(ownerId)) this.borderSets.set(ownerId, new Set());
    const borders = this.borderSets.get(ownerId);
    const ownedNeighbors = this.map.getNeighbors(position).some((neighbor) => this.map.owners[neighbor] !== ownerId);
    if (this.map.owners[position] === ownerId && ownedNeighbors) borders.add(position);
    for (const neighbor of this.map.getNeighbors(position)) {
      if (this.map.owners[neighbor] !== ownerId) continue;
      const stillBorder = this.map.getNeighbors(neighbor).some((cell) => this.map.owners[cell] !== ownerId);
      if (stillBorder) borders.add(neighbor);
      else borders.delete(neighbor);
    }
  }

  updateTileGrade(position) {
    this.tileGrades[position] = this.map.getNeighbors(position)
      .filter((neighbor) => this.map.owners[neighbor] === this.map.owners[position]).length;
  }

  getTerritorySize(ownerId) {
    return this.territorySizes.get(ownerId) ?? 0;
  }
}

module.exports = TerritoryManager;
