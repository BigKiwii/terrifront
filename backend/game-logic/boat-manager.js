const {
  BOAT_TILES_PER_TICK,
  BOAT_DECAY_PER_TICK,
  BOAT_MIN_TROOPS,
  BOAT_MAX_SEARCH_CELLS,
  BOAT_MAX_FRONT_TILES
} = require('../../shared/game-rules');
const MinHeap = require('./min-heap');

const MAX_POWER = 1000;
const BOAT_SHORE_BUFFER_TILES = 3;
const BOAT_SHORE_PENALTY = 12;

// Pathfinding scratch shared by every room. Searches are synchronous and never
// interleave, and all rooms use the same map size, so one pair of buffers is
// enough - the arrays are several MB each and are only touched while a boat is
// being launched. The stamp lives here too, so rooms cannot collide.
let scratch = null;
function getScratch(cellCount) {
  if (!scratch || scratch.visited.length !== cellCount) {
    scratch = {
      visited: new Int32Array(cellCount),
      parent: new Int32Array(cellCount),
      distance: new Float64Array(cellCount),
      score: new Float64Array(cellCount),
      stamp: 0
    };
  }
  return scratch;
}

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

    // Stamped scratch so a search never has to clear 600k entries.
    this.scratch = getScratch(map.cellCount);
  }

  isWater(position) {
    return !this.map.isLand(position);
  }

  waterNeighbors(position) {
    const width = this.map.width;
    const height = this.map.height;
    const x = position % width;
    const y = Math.floor(position / width);
    const neighbors = [];
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue;
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const nextPosition = nextY * width + nextX;
        if (!this.isWater(nextPosition)) continue;
        if (offsetX !== 0 && offsetY !== 0) {
          const horizontal = y * width + nextX;
          const vertical = nextY * width + x;
          if (!this.isWater(horizontal) || !this.isWater(vertical)) continue;
        }
        neighbors.push({ position: nextPosition, cost: offsetX === 0 || offsetY === 0 ? 1 : Math.SQRT2 });
      }
    }
    return neighbors;
  }

  touchesWater(position) {
    return this.map.getNeighbors(position).some((neighbor) => this.isWater(neighbor));
  }

  // The clicked tile if it is on the coast, otherwise the nearest coastal tile
  // to it, so clicking inland across a sea still picks a sensible beach.
  findLanding(targetPosition) {
    if (this.map.isLand(targetPosition) && this.touchesWater(targetPosition)) return targetPosition;
    const { visited, parent } = this.scratch;
    const stamp = ++this.scratch.stamp;
    const queue = [targetPosition];
    visited[targetPosition] = stamp;
    let head = 0;
    let explored = 0;
    while (head < queue.length && explored < 20000) {
      const position = queue[head++];
      explored += 1;
      if (this.map.isLand(position) && this.touchesWater(position)) return position;
      for (const neighbor of this.map.getNeighbors(position)) {
        if (visited[neighbor] === stamp) continue;
        if (!this.map.isLand(neighbor)) continue;
        visited[neighbor] = stamp;
        queue.push(neighbor);
      }
    }
    return null;
  }

  // Shortest water route from any coast this player owns to the landing beach.
  findRoute(ownerId, landing) {
    const goals = new Set();
    for (const neighbor of this.waterNeighborsAround(landing)) {
      if (this.isWater(neighbor.position)) goals.add(neighbor.position);
    }
    if (goals.size === 0) return null;

    const { visited, parent, distance, score } = this.scratch;
    const stamp = ++this.scratch.stamp;
    const queue = new MinHeap();
    for (const border of this.territory.getBorderSet(ownerId)) {
      if (this.map.owners[border] !== ownerId) continue;
      for (const { position: neighbor } of this.waterNeighborsAround(border)) {
        if (visited[neighbor] === stamp) continue;
        visited[neighbor] = stamp;
        parent[neighbor] = -1;
        distance[neighbor] = 0;
        score[neighbor] = 0;
        queue.push({ position: neighbor, priority: 0 });
      }
    }
    if (queue.size === 0) return null;

    let explored = 0;
    while (queue.size > 0 && explored < BOAT_MAX_SEARCH_CELLS) {
      const current = queue.pop();
      const position = current.position;
      if (current.priority !== score[position]) continue;
      explored += 1;
      if (goals.has(position)) {
        const route = [];
        for (let step = position; step !== -1; step = parent[step]) route.push(step);
        route.reverse();
        return { route, distance: distance[position] };
      }
      for (const { position: neighbor, cost } of this.waterNeighbors(position)) {
        const nextDistance = distance[position] + cost;
        const nextScore = score[position] + cost + this.shorePenalty(neighbor, landing, goals);
        if (visited[neighbor] === stamp && nextScore >= score[neighbor]) continue;
        visited[neighbor] = stamp;
        distance[neighbor] = nextDistance;
        score[neighbor] = nextScore;
        parent[neighbor] = position;
        queue.push({ position: neighbor, priority: nextScore });
      }
    }
    return null;
  }

  waterNeighborsAround(position) {
    const width = this.map.width;
    const height = this.map.height;
    const x = position % width;
    const y = Math.floor(position / width);
    const neighbors = [];
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue;
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const nextPosition = nextY * width + nextX;
        if (this.isWater(nextPosition)) neighbors.push({ position: nextPosition, cost: offsetX === 0 || offsetY === 0 ? 1 : Math.SQRT2 });
      }
    }
    return neighbors;
  }

  shorePenalty(position, landing, goals) {
    if (goals.has(position)) return 0;
    const width = this.map.width;
    const height = this.map.height;
    const x = position % width;
    const y = Math.floor(position / width);
    let nearestLand = BOAT_SHORE_BUFFER_TILES + 1;
    for (let offsetY = -BOAT_SHORE_BUFFER_TILES; offsetY <= BOAT_SHORE_BUFFER_TILES; offsetY += 1) {
      for (let offsetX = -BOAT_SHORE_BUFFER_TILES; offsetX <= BOAT_SHORE_BUFFER_TILES; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue;
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const neighbor = nextY * width + nextX;
        if (neighbor === landing || !this.map.isLand(neighbor)) continue;
        nearestLand = Math.min(nearestLand, Math.max(Math.abs(offsetX), Math.abs(offsetY)));
      }
    }
    return nearestLand > BOAT_SHORE_BUFFER_TILES
      ? 0
      : (BOAT_SHORE_BUFFER_TILES + 1 - nearestLand) ** 2 * BOAT_SHORE_PENALTY;
  }

  // The owned tiles a landing party can attack from: the connected pocket of our
  // territory containing the beachhead. After a sea landing that is usually just
  // the beach itself, so the push stays local instead of firing every front we
  // own. If the beach does touch ground we already held, that whole pocket joins.
  frontFrom(landing, ownerId) {
    const { visited } = this.scratch;
    const stamp = ++this.scratch.stamp;
    const front = [];
    const queue = [landing];
    visited[landing] = stamp;
    let head = 0;
    while (head < queue.length && front.length < BOAT_MAX_FRONT_TILES) {
      const position = queue[head++];
      front.push(position);
      for (const neighbor of this.map.getNeighbors(position)) {
        if (visited[neighbor] === stamp || this.map.owners[neighbor] !== ownerId) continue;
        visited[neighbor] = stamp;
        queue.push(neighbor);
      }
    }
    // Hit the cap: this is a big contiguous nation, so the normal whole-border
    // front is what we want anyway.
    return front.length >= BOAT_MAX_FRONT_TILES ? null : front;
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
    const routeResult = this.findRoute(ownerId, landing);
    if (!routeResult || routeResult.route.length === 0) return { accepted: false, reason: 'NO_WATER_ROUTE' };
    const { route, distance } = routeResult;

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
    return { accepted: true, playerId, troops, power: normalizedPower, boat: true, distance };
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
    const player = this.players.get(boat.playerId);
    // A player wiped out while their boat was at sea does not get to land and
    // come back from the dead.
    if (this.territory.getTerritorySize(ownerId) === 0) return null;
    const defenderId = this.map.owners[landing];
    // We took this beach by land while the boat was still crossing; bring the
    // cargo home rather than losing it.
    if (defenderId === ownerId) {
      if (player) player.troops += Math.floor(boat.troops);
      return null;
    }

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
    if (player && survivors > 0) {
      player.troops += survivors;
      // Push inland with the landing party only. start() spends a percentage of
      // the player's whole pool, so express the survivors as that percentage and
      // round down - a landing must never spend troops that stayed at home.
      const power = Math.floor((survivors / player.troops) * MAX_POWER);
      if (power >= 1) {
        this.expansionManager.start(
          boat.playerId,
          power,
          this.inlandTarget(landing, ownerId),
          this.frontFrom(landing, ownerId)
        );
      }
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
        position: boat.route[Math.min(Math.floor(boat.index), boat.route.length - 1)],
        troops: Math.floor(boat.troops)
      });
    }
    return list;
  }
}

module.exports = BoatManager;
