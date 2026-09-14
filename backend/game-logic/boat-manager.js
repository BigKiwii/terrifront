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
const MAX_BOATS_PER_PLAYER = 3;

// Pathfinding scratch shared by every room. Searches are synchronous and never
// interleave, and all rooms use the same map size, so one pair of buffers is
// enough.
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

class BoatManager {
  constructor(map, territory, players, expansionManager) {
    this.map = map;
    this.territory = territory;
    this.players = players;
    this.expansionManager = expansionManager;
    this.boats = new Map();
    this.nextBoatId = 1;
    this.activeBoatOwners = new Set();
    this.shoreDistance = null;

    this.scratch = getScratch(map.cellCount);
    this.buildShoreDistance();
  }

  buildShoreDistance() {
    if (this.shoreDistance) return;
    const cellCount = this.map.cellCount;
    const distances = new Uint8Array(cellCount).fill(255);
    const queue = [];
    for (let position = 0; position < cellCount; position += 1) {
      if (!this.map.isLand(position)) continue;
      distances[position] = 0;
      queue.push(position);
    }
    let head = 0;
    while (head < queue.length) {
      const position = queue[head++];
      const currentDistance = distances[position];
      for (const neighbor of this.map.getNeighbors(position)) {
        if (distances[neighbor] !== 255) continue;
        distances[neighbor] = currentDistance + 1;
        queue.push(neighbor);
      }
    }
    this.shoreDistance = distances;
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
        if (this.isWater(nextPosition)) {
          neighbors.push({ position: nextPosition, cost: offsetX === 0 || offsetY === 0 ? 1 : Math.SQRT2 });
        }
      }
    }
    return neighbors;
  }

  touchesWater(position) {
    return this.map.getNeighbors(position).some((neighbor) => this.isWater(neighbor));
  }

  heuristicDistance(position, goalX, goalY) {
    const x = position % this.map.width;
    const y = Math.floor(position / this.map.width);
    return Math.hypot(x - goalX, y - goalY);
  }

  findLanding(targetPosition) {
    if (this.map.isLand(targetPosition) && this.touchesWater(targetPosition)) return targetPosition;
    const { visited } = this.scratch;
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
        visited[neighbor] = stamp;
        queue.push(neighbor);
      }
    }
    return null;
  }

  findRoute(ownerId, landing) {
    const goals = new Set();
    for (const neighbor of this.waterNeighborsAround(landing)) {
      if (this.isWater(neighbor.position)) goals.add(neighbor.position);
    }
    if (goals.size === 0) return null;

    const goalCell = [...goals][0];
    const goalX = goalCell % this.map.width;
    const goalY = Math.floor(goalCell / this.map.width);

    const { visited, parent, distance, score } = this.scratch;
    const stamp = ++this.scratch.stamp;
    const queue = new MinHeap();
    for (const border of this.territory.getBorderSet(ownerId)) {
      if (this.map.owners[border] !== ownerId) continue;
      for (const { position: neighbor } of this.waterNeighborsAround(border)) {
        if (this.map.owners[border] !== ownerId) continue;
        if (visited[neighbor] === stamp) continue;
        visited[neighbor] = stamp;
        parent[neighbor] = -1;
        distance[neighbor] = 0;
        score[neighbor] = this.heuristicDistance(neighbor, goalX, goalY);
        queue.push({ position: neighbor, priority: score[neighbor] });
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
        const heuristic = this.heuristicDistance(neighbor, goalX, goalY);
        const nextScore = nextDistance + heuristic + this.shorePenalty(neighbor, landing, goals);
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

  shorePenalty(position, landing, goals) {
    if (goals.has(position)) return 0;
    const distanceValue = this.shoreDistance?.[position] ?? BOAT_SHORE_BUFFER_TILES + 1;
    if (distanceValue > BOAT_SHORE_BUFFER_TILES) return 0;
    return (BOAT_SHORE_BUFFER_TILES + 1 - distanceValue) ** 2 * BOAT_SHORE_PENALTY;
  }

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
    const isAlreadyConnected = this.map.getNeighbors(landing).some((neighbor) => {
      if (this.map.owners[neighbor] !== ownerId) return false;
      const localConnections = this.map.getNeighbors(neighbor).filter((cell) => this.map.owners[cell] === ownerId).length;
      return localConnections > 1;
    });
    if (isAlreadyConnected) return null;
    return front.length >= BOAT_MAX_FRONT_TILES ? null : front;
  }

  launch(playerId, power, targetPosition) {
    const player = this.players.get(playerId);
    if (!player) return { accepted: false, reason: 'PLAYER_NOT_FOUND' };
    const ownerId = Number(playerId.replace('player-', ''));
    if (this.territory.getTerritorySize(ownerId) === 0) return { accepted: false, reason: 'NO_BORDER_TERRITORY' };
    if (this.getActiveCount(playerId) >= MAX_BOATS_PER_PLAYER) return { accepted: false, reason: 'NO_WATER_ROUTE' };

    const landing = this.findLanding(targetPosition);
    if (landing === null || this.map.owners[landing] === ownerId) {
      return { accepted: false, reason: 'NO_WATER_ROUTE' };
    }
    const routeResult = this.findRoute(ownerId, landing);
    if (!routeResult || routeResult.route.length === 0) return { accepted: false, reason: 'NO_WATER_ROUTE' };
    const { route, distance } = routeResult;

    const normalizedPower = Math.max(0, Math.min(MAX_POWER, Number(power) || 0));
    const troopRatio = normalizedPower / MAX_POWER;
    const troops = Math.min(player.troops, Math.max(1, Math.floor(player.troops * troopRatio)));
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
    this.activeBoatOwners.add(playerId);
    return {
      accepted: true,
      playerId,
      troops,
      power: normalizedPower,
      boat: true,
      distance,
      expectedSurvivors: Math.floor(troops * Math.pow(1 - BOAT_DECAY_PER_TICK, distance / BOAT_TILES_PER_TICK))
    };
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

    for (const boat of finished) {
      this.boats.delete(boat.id);
      this.activeBoatOwners.delete(boat.playerId);
      if (this.getActiveCount(boat.playerId) === 0) this.activeBoatOwners.delete(boat.playerId);
    }
    return changes;
  }

  land(boat) {
    const { landing, ownerId } = boat;
    const player = this.players.get(boat.playerId);
    if (this.territory.getTerritorySize(ownerId) === 0) return null;
    const defenderId = this.map.owners[landing];
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
      this.expansionManager.startWithTroops(
        boat.playerId,
        survivors,
        this.inlandTarget(landing, ownerId),
        this.frontFrom(landing, ownerId)
      );
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
    const localSupport = this.map.getNeighbors(landing).filter((cell) => this.map.owners[cell] === defenderId).length;
    return Math.max(1, Math.floor((defender.troops / size) * (1 + localSupport * 0.75)));
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
      if (player) player.troops += Math.floor(boat.troops);
      this.boats.delete(boat.id);
    }
    this.activeBoatOwners.delete(playerId);
  }

  stopAll() {
    this.boats.clear();
    this.activeBoatOwners.clear();
  }

  releaseOwner(ownerId) {
    for (const boat of [...this.boats.values()]) {
      if (boat.ownerId === ownerId) {
        this.boats.delete(boat.id);
      }
    }
    if (this.activeBoatOwners.size > 0) {
      for (const playerId of this.activeBoatOwners) {
        if (this.getActiveCount(playerId) === 0) this.activeBoatOwners.delete(playerId);
      }
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
