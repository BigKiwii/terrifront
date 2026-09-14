class SpawnManager {
  constructor(map) {
    this.map = map;
    this.available = [];
    this.reservations = new Map();
    this.backup = [];
  }

  initialize(maxPlayers) {
    let radius = Math.max(5, Math.sqrt(this.map.cellCount / maxPlayers / 1.1 / Math.sqrt(2)));
    let candidates = [];
    while (radius >= 5) {
      candidates = this.buildCandidates(radius, maxPlayers);
      if (candidates.length >= maxPlayers) break;
      radius *= 0.9;
    }

    this.available = candidates;
    this.backup = this.buildFallbackCandidates(maxPlayers, candidates);
    return candidates.length;
  }

  buildFallbackCandidates(maxPlayers, excluded) {
    const excludedPositions = new Set(excluded);
    const candidates = [];
    for (let position = 0; position < this.map.cellCount && candidates.length < maxPlayers * 4; position += 1) {
      if (excludedPositions.has(position) || !this.isValidCapital(position)) continue;
      candidates.push(position);
    }
    return candidates;
  }

  buildCandidates(radius, maxPlayers) {
    const random = seededRandom(417 + Math.floor(radius * 100));
    const minimumDistance = radius ** 2;
    const cellSize = radius / Math.sqrt(2);
    const columns = Math.ceil(this.map.width / cellSize);
    const rows = Math.ceil(this.map.height / cellSize);
    const grid = new Int32Array(columns * rows).fill(-1);
    const active = [];
    const candidates = [];
    let seed = null;
    for (let attempt = 0; attempt < this.map.cellCount && seed === null; attempt += 1) {
      const position = Math.floor(random() * this.map.cellCount);
      if (this.isValidCapital(position)) seed = position;
    }
    if (seed === null) return candidates;
    const seedX = seed % this.map.width;
    const seedY = Math.floor(seed / this.map.width);
    grid[Math.floor(seedX / cellSize) + Math.floor(seedY / cellSize) * columns] = seed;
    active.push(seed);
    candidates.push(seed);
    while (active.length > 0 && candidates.length < maxPlayers * 4) {
      const activeIndex = Math.floor(random() * active.length);
      const point = active[activeIndex];
      const pointX = point % this.map.width;
      const pointY = Math.floor(point / this.map.width);
      let found = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const angle = random() * Math.PI * 2;
        const distance = (random() + 1) * radius;
        const x = Math.floor(pointX + Math.cos(angle) * distance);
        const y = Math.floor(pointY + Math.sin(angle) * distance);
        const cellX = Math.floor(x / cellSize);
        const cellY = Math.floor(y / cellSize);
        if (x < 0 || x >= this.map.width || y < 0 || y >= this.map.height || cellX < 0 || cellY < 0 || cellX >= columns || cellY >= rows) continue;
        if (grid[cellX + cellY * columns] !== -1) continue;
        let valid = true;
        for (let offsetY = -1; offsetY <= 1 && valid; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const neighborX = cellX + offsetX;
            const neighborY = cellY + offsetY;
            if (neighborX < 0 || neighborY < 0 || neighborX >= columns || neighborY >= rows) continue;
            const other = grid[neighborX + neighborY * columns];
            if (other < 0) continue;
            const otherX = other % this.map.width;
            const otherY = Math.floor(other / this.map.width);
            if ((otherX - x) ** 2 + (otherY - y) ** 2 < minimumDistance) valid = false;
          }
        }
        if (!valid) continue;
        const candidate = y * this.map.width + x;
        grid[cellX + cellY * columns] = candidate;
        active.push(candidate);
        if (this.isValidCapital(candidate)) candidates.push(candidate);
        found = true;
        break;
      }
      if (!found) active.splice(activeIndex, 1);
    }
    return candidates;
  }

  select(playerId, position) {
    const cells = this.map.getCapitalCells(position);
    if (cells.length !== 21 || !cells.every((cell) => this.map.isLand(cell) && this.map.owners[cell] === 0)) {
      return { accepted: false, reason: 'INVALID_SPAWN_LOCATION' };
    }

    this.release(playerId);
    const nearby = this.available.filter((candidate) =>
      Math.abs(candidate % this.map.width - position % this.map.width) <= 4 &&
      Math.abs(Math.floor(candidate / this.map.width) - Math.floor(position / this.map.width)) <= 4);
    this.available = this.available.filter((candidate) => !nearby.includes(candidate));
    this.reservations.set(playerId, { position, blocked: nearby });
    return { accepted: true, position, cells };
  }

  release(playerId) {
    const reservation = this.reservations.get(playerId);
    if (!reservation) return;
    this.available.push(...reservation.blocked.filter((position) => !this.available.includes(position)));
    this.reservations.delete(playerId);
  }

  randomPosition() {
    while (this.available.length > 0) {
      const position = this.available.shift();
      if (this.map.getCapitalCells(position).every((cell) => this.map.owners[cell] === 0)) return position;
    }
    while (this.backup.length > 0) {
      const position = this.backup.shift();
      if (this.map.getCapitalCells(position).every((cell) => this.map.owners[cell] === 0)) return position;
    }
    return null;
  }

  getPosition(playerId) {
    return this.reservations.get(playerId)?.position ?? null;
  }

  getCandidates() {
    return [...this.available];
  }

  isValidCapital(position) {
    const cells = this.map.getCapitalCells(position);
    return cells.length === 21 && cells.every((cell) => this.map.isLand(cell));
  }
}

function distanceSquared(first, second, width) {
  const firstX = first % width;
  const firstY = Math.floor(first / width);
  const secondX = second % width;
  const secondY = Math.floor(second / width);
  return (firstX - secondX) ** 2 + (firstY - secondY) ** 2;
}

function seededRandom(seed) {
  let value = seed;
  return function next() {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

module.exports = SpawnManager;