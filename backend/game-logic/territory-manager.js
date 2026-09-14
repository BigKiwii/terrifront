class TerritoryManager {
  constructor(map) {
    this.map = map;
    this.borderTiles = new Map();
    this.ownedCells = new Map();
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
    if (!this.ownedCells.has(ownerId)) this.ownedCells.set(ownerId, new Set());
    const borders = this.borderTiles.get(ownerId);
    const owned = this.ownedCells.get(ownerId);
    for (const position of cells) {
      owned.add(position);
      this.updateTileGrade(position);
      for (const neighbor of this.map.getNeighbors(position)) this.updateTileGrade(neighbor);
      this.refreshBorder(position, ownerId);
      for (const neighbor of this.map.getNeighbors(position)) this.refreshBorder(neighbor, ownerId);
    }
    const territorySize = (this.territorySizes.get(ownerId) ?? 0) + cells.length;
    this.territorySizes.set(ownerId, territorySize);
    this.eliminationBases.set(ownerId, Math.max(this.eliminationBases.get(ownerId) ?? 0, territorySize));
  }

  removeOwnerCells(ownerId, cells) {
    const borders = this.getBorderSet(ownerId);
    const owned = this.ownedCells.get(ownerId);
    for (const position of cells) {
      this.map.owners[position] = 0;
      owned?.delete(position);
      const neighbors = this.map.getNeighbors(position);
      this.updateTileGrade(position);
      for (const affectedPosition of neighbors) {
        this.updateTileGrade(affectedPosition);
        this.refreshBorder(affectedPosition, ownerId);
      }
      this.refreshBorder(position, ownerId);
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

  getAttackCandidates(ownerId) {
    const candidates = new Set();
    for (const border of this.getBorderSet(ownerId)) {
      for (const neighbor of this.map.getNeighbors(border)) {
        if (this.map.isLand(neighbor) && !this.isOwnedBy(neighbor, ownerId)) candidates.add(neighbor);
      }
    }
    return [...candidates];
  }

  attackTile(position, attackerId, attackerTroops, players) {
    if (!this.map.isLand(position)) return { success: false };
    if (this.map.owners[position] === attackerId) return { success: false };
    const neighbors = this.map.getNeighbors(position);
    if (!neighbors.some((neighbor) => this.map.owners[neighbor] === attackerId)) {
      return { success: false, attackerLoss: 0 };
    }

    const defenderId = this.map.owners[position];
    const defender = defenderId ? players.get(`player-${defenderId}`) : null;
    let attackerLoss = this.map.expansionTimes?.[position]
      ? this.map.expansionTimes[position] / 50
      : 0;
    if (defender) {
      const territorySize = this.getTerritorySize(defenderId);
      const defenderDensity = defender.troops / Math.max(1, territorySize);
      attackerLoss = Math.max(1, Math.floor(defenderDensity * 2));
    }

    if (attackerTroops < attackerLoss) {
      return { success: false, attackerLoss };
    }

    if (defenderId !== 0) {
      if (defender) {
        const defenseCost = Math.max(1, Math.ceil((1 + attackerLoss) / 1.7));
        defender.troops = Math.max(0, defender.troops - defenseCost);
      }
      this.territorySizes.set(defenderId, Math.max(0, (this.territorySizes.get(defenderId) ?? 1) - 1));
      if (this.territorySizes.get(defenderId) <= 0) {
        if (defender) defender.troops = 0;
      }
    }
    this.map.owners[position] = attackerId;
    this.ownedCells.get(defenderId)?.delete(position);
    if (!this.ownedCells.has(attackerId)) this.ownedCells.set(attackerId, new Set());
    this.ownedCells.get(attackerId).add(position);
    const attackerTerritorySize = (this.territorySizes.get(attackerId) ?? 0) + 1;
    this.territorySizes.set(attackerId, attackerTerritorySize);
    this.eliminationBases.set(attackerId, Math.max(this.eliminationBases.get(attackerId) ?? 0, attackerTerritorySize));
    this.updateTileGrade(position);
    for (const neighbor of neighbors) this.updateTileGrade(neighbor);
    const affectedOwners = new Set([attackerId]);
    for (const neighbor of neighbors) {
      const neighborOwner = this.getOwner(neighbor);
      if (neighborOwner) affectedOwners.add(neighborOwner);
    }
    for (const affectedOwner of affectedOwners) {
      this.refreshBorder(position, affectedOwner);
      for (const neighbor of neighbors) this.refreshBorder(neighbor, affectedOwner);
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
    const owned = this.ownedCells.get(ownerId) || new Set();
    for (const position of owned) {
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
    this.ownedCells.delete(ownerId);
    return releasedPositions;
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
