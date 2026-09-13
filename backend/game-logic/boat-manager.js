const {
  BOAT_TILES_PER_TICK,
  BOAT_DECAY_PER_TICK,
  BOAT_MIN_TROOPS,
  BOAT_MAX_SEARCH_CELLS
} = require('../../shared/game-rules');

const MAX_POWER = 1000;

// Ferries troops across water to a coast the player cannot reach by land.
// A boat follows a water route tile by tile, bleeding troops the whole way, and
// on arrival claims a beachhead and hands the survivors to a normal expansion.
class BoatManager {
  constructor(map, territory, players, expansionManager) {
    this.map = map;
    this.territory = territory;
    this.players = players;
    this.expansionManager = expansionManager;
    this.boats = new Map();
    this.nextBoatId = 1;

    // Stamped scratch buffers so a search never has to clear 600k entries.
    this.visited = new Int32Array(map.cellCount);
    this.parent = new Int32Array(map.cellCount);
    this.searchId = 0;
  }

  isWater(position) {
    return !this.map.isLand(position);
  }

  touchesWater(position) {
    return this.map.getNeighbors(position).some((neighbor) => this.isWater(neighbor));
  }

  // The clicked tile if it is on the coast, otherwise the nearest coastal tile
  // to it, so clicking inland across a sea still picks a sensible beach.
  findLanding(targetPosition) {
    if (this.map.isLand(targetPosition) && this.touchesWater(targetPosition)) return targetPosition;
    const stamp = ++this.searchId;
    const queue = [targetPosition];
    this.visited[targetPosition] = stamp;
    let head = 0;
    let explored = 0;
    while (head < queue.length && explored < 20000) {
      const position = queue[head++];
      explored += 1;
      if (this.map.isLand(position) && this.touchesWater(position)) return position;
      for (const neighbor of this.map.getNeighbors(position)) {
        if (this.visited[neighbor] === stamp) continue;
        if (!this.map.isLand(neighbor)) continue;
        this.visited[neighbor] = stamp;
        queue.push(neighbor);
      }
    }
    return null;
  }

  // Shortest water route from any coast this player owns to the landing beach.
  findRoute(ownerId, landing) {
    const goals = new Set();
    for (const neighbor of this.map.getNeighbors(landing)) {
      if (this.isWater(neighbor)) goals.add(neighbor);
    }
    if (goals.size === 0) return null;

    const stamp = ++this.searchId;
    const queue = [];
    for (const border of this.territory.getBorderSet(ownerId)) {
      if (this.map.owners[border] !== ownerId) continue;
      for (const neighbor of this.map.getNeighbors(border)) {
        if (!this.isWater(neighbor) || this.visited[neighbor] === stamp) continue;
        this.visited[neighbor] = stamp;
        this.parent[neighbor] = -1;
        queue.push(neighbor);
      }
    }
    if (queue.length === 0) return null;

    let head = 0;
    let explored = 0;
    while (head < queue.length && explored < BOAT_MAX_SEARCH_CELLS) {
      const position = queue[head++];
      explored += 1;
      if (goals.has(position)) {
        const route = [];
        for (let step = position; step !== -1; step = this.parent[step]) route.push(step);
        route.reverse();
        return route;
      }
      for (const neighbor of this.map.getNeighbors(position)) {
        if (this.visited[neighbor] === stamp || !this.isWater(neighbor)) continue;
        this.visited[neighbor] = stamp;
        this.parent[neighbor] = position;
        queue.push(neighbor);
      }
    }
    return null;
  }

  launch(playerId, power, targetPosition) {
    const player = this.players.get(playerId);
    if (!player) return { accepted: false, reason: 'PLAYER_NOT_FOUND' };
    const ownerId = Number(playerId.replace('player-', ''));
    if (this.territory.getTerritorySize(ownerId) === 0) return { accepted: false, reason: 'NO_BORDER_TERRITORY' };

    const landing = this.findLanding(targetPosition);
    if (landing === null || this.map.owners[landing] === ownerId) {
      return { accepted: false, reason: 'NO_WATER_ROUTE' };
    }
    const route = this.findRoute(ownerId, landing);
    if (!route || route.length === 0) return { accepted: false, reason: 'NO_WATER_ROUTE' };

    const normalizedPower = Math.max(0, Math.min(MAX_POWER, Number(power) || 0));
    const troops = Math.min(player.troops, Math.floor(player.troops * normalizedPower / MAX_POWER));
    if (troops < BOAT_MIN_TROOPS) return { accepted: false, reason: 'NOT_ENOUGH_TROOPS' };

    player.troops = Math.max(0, player.troops - troops);
    const boat = {
      id: this.nextBoatId++,
      playerId,
      ownerId,
      troops,
      route,
      index: 0,
      landing
    };
    this.boats.set(boat.id, boat);
    return { accepted: true, playerId, troops, power: normalizedPower, boat: true, distance: route.length };
  }

  tick() {
    const changes = [];
    const finished = [];

    for (const boat of this.boats.values()) {
      boat.troops *= 1 - BOAT_DECAY_PER_TICK;
      if (boat.troops < BOAT_MIN_TROOPS) {
        finished.push(boat);
        continue;
      }
      boat.index += BOAT_TILES_PER_TICK;
      if (boat.index < boat.route.length) continue;

      const landed = this.land(boat);
      if (landed) changes.push(landed);
      finished.push(boat);
    }

    for (const boat of finished) this.boats.delete(boat.id);
    return changes;
  }

  // Take the beach, then let the normal expansion logic carry on inland.
  land(boat) {
    const { landing, ownerId } = boat;
    // A player wiped out while their boat was at sea does not get to land and
    // come back from the dead.
    if (this.territory.getTerritorySize(ownerId) === 0) return null;
    const defenderId = this.map.owners[landing];
    if (defenderId === ownerId) return null;

    const cost = this.landingCost(landing, defenderId);
    const troops = Math.floor(boat.troops);
    if (troops < cost) return null;

    if (defenderId) {
      const defender = this.players.get(`player-${defenderId}`);
      if (defender) defender.troops = Math.max(0, defender.troops - Math.ceil(cost / 2));
      this.territory.removeOwnerCells(defenderId, [landing]);
    }
    this.map.owners[landing] = ownerId;
    this.territory.registerOwner(ownerId, [landing]);

    const survivors = troops - cost;
    const player = this.players.get(boat.playerId);
    if (player && survivors > 0) {
      player.troops += survivors;
      // Spend the survivors pushing inland from the new beachhead.
      this.expansionManager.start(boat.playerId, MAX_POWER, this.inlandTarget(landing, ownerId));
    }
    return { position: landing, owner: ownerId };
  }

  landingCost(landing, defenderId) {
    if (!defenderId) {
      const expansionTime = this.map.expansionTimes?.[landing] || 50;
      return Math.max(1, Math.floor(expansionTime / 50));
    }
    const defender = this.players.get(`player-${defenderId}`);
    if (!defender) return 1;
    const size = Math.max(1, this.territory.getTerritorySize(defenderId));
    return Math.max(1, Math.floor((defender.troops / size) * 2));
  }

  inlandTarget(landing, ownerId) {
    for (const neighbor of this.map.getNeighbors(landing)) {
      if (this.map.isLand(neighbor) && this.map.owners[neighbor] !== ownerId) return neighbor;
    }
    return landing;
  }

  getActiveCount(playerId) {
    let count = 0;
    for (const boat of this.boats.values()) if (boat.playerId === playerId) count += 1;
    return count;
  }

  cancel(playerId) {
    for (const boat of [...this.boats.values()]) {
      if (boat.playerId !== playerId) continue;
      const player = this.players.get(playerId);
      if (player) player.troops += Math.floor(boat.troops);   // recalled before landing
      this.boats.delete(boat.id);
    }
  }

  stopAll() {
    this.boats.clear();
  }

  releaseOwner(ownerId) {
    for (const boat of [...this.boats.values()]) {
      if (boat.ownerId === ownerId) this.boats.delete(boat.id);
    }
  }

  serialize() {
    const list = [];
    for (const boat of this.boats.values()) {
      list.push({
        ownerId: boat.ownerId,
        position: boat.route[Math.min(boat.index, boat.route.length - 1)],
        troops: Math.floor(boat.troops)
      });
    }
    return list;
  }
}

module.exports = BoatManager;
