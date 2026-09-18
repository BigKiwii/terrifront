const NUKE_RADIUS = 30;
const NUKE_SPEED_CELLS_PER_SECOND = 240;
const NUKE_MIN_DURATION_MS = 3750;
const MAX_PENDING_NUKES = 3;

const circleOffsets = [];
for (let offsetY = -NUKE_RADIUS; offsetY <= NUKE_RADIUS; offsetY += 1) {
  const width = Math.floor(Math.sqrt(NUKE_RADIUS ** 2 - offsetY ** 2));
  circleOffsets.push({ offsetY, minX: -width, maxX: width });
}

function createWasteland(cellCount) {
  return new Uint8Array(cellCount);
}

function getNukeDuration(startPosition, targetPosition, map) {
  const startX = startPosition % map.width;
  const startY = Math.floor(startPosition / map.width);
  const targetX = targetPosition % map.width;
  const targetY = Math.floor(targetPosition / map.width);
  const distance = Math.hypot(targetX - startX, targetY - startY);
  return Math.max(NUKE_MIN_DURATION_MS, Math.round(distance / NUKE_SPEED_CELLS_PER_SECOND * 1000));
}

function getImpactCells(map, targetPosition) {
  const centerX = targetPosition % map.width;
  const centerY = Math.floor(targetPosition / map.width);
  const cells = [];
  for (const row of circleOffsets) {
    const y = centerY + row.offsetY;
    if (y < 0 || y >= map.height) continue;
    const minX = Math.max(0, centerX + row.minX);
    const maxX = Math.min(map.width - 1, centerX + row.maxX);
    for (let x = minX; x <= maxX; x += 1) {
      const position = y * map.width + x;
      if (map.isLand(position)) cells.push(position);
    }
  }
  return cells;
}

function applyNukeImpact({ map, territory, players, wasteland, targetPosition }) {
  const wastelandChanges = [];
  const ownerChanges = [];
  const destroyedByOwner = new Map();
  const impactCells = getImpactCells(map, targetPosition);

  for (const position of impactCells) {
    if (wasteland[position]) continue;
    const ownerId = map.owners[position];
    if (ownerId) destroyedByOwner.set(ownerId, (destroyedByOwner.get(ownerId) || 0) + 1);
    wasteland[position] = 1;
    wastelandChanges.push({ position, value: 1 });
    if (ownerId) ownerChanges.push({ position, owner: 0 });
  }

  if (ownerChanges.length) territory.destroyCells(ownerChanges.map((change) => change.position));

  const troopLosses = [];
  for (const [ownerId, destroyedCount] of destroyedByOwner) {
    const player = players.get(`player-${ownerId}`);
    if (!player) continue;
    const territorySize = territory.getTerritorySize(ownerId) + destroyedCount;
    const troopsLost = player.troops > 0
      ? Math.min(player.troops, Math.max(1, Math.floor(player.troops * destroyedCount / Math.max(1, territorySize))))
      : 0;
    if (troopsLost > 0) {
      player.troops -= troopsLost;
      troopLosses.push({ playerId: player.playerId, troopsLost });
    }
  }

  return { ownerChanges, wastelandChanges, troopLosses };
}

function getWastelandPositions(wasteland) {
  const positions = [];
  for (let position = 0; position < wasteland.length; position += 1) {
    if (wasteland[position]) positions.push(position);
  }
  return positions;
}

module.exports = {
  NUKE_RADIUS,
  NUKE_SPEED_CELLS_PER_SECOND,
  NUKE_MIN_DURATION_MS,
  MAX_PENDING_NUKES,
  createWasteland,
  getNukeDuration,
  getImpactCells,
  applyNukeImpact,
  getWastelandPositions
};
