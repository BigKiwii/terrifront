const MAP_ID = 'europa-asia-01';
const TERRAIN_WATER = 0;
const TERRAIN_LAND = 0x80;
const OWNER_NEUTRAL = 0;
let mapPromise = null;

function loadMap() {
  if (!mapPromise) {
    const path = require('path');
    const fs = require('fs');
    const defaultMapPath = path.resolve(__dirname, '../../map/map.bin');
    const mapPath = process.env.TERRIFRONT_MAP_PATH
      ? path.resolve(process.env.TERRIFRONT_MAP_PATH)
      : defaultMapPath;
    mapPromise = Promise.resolve().then(() => {
      const manifestPath = path.join(path.dirname(mapPath), 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const terrain = new Uint8Array(fs.readFileSync(mapPath));
      const expansionTimesPath = path.join(path.dirname(mapPath), 'expansion-times.bin');
      const expansionTimes = fs.existsSync(expansionTimesPath)
        ? new Uint8Array(fs.readFileSync(expansionTimesPath))
        : null;
      if (terrain.length !== manifest.cellCount) throw new Error('Terrain binary size does not match manifest');
      return createMap(terrain, manifest.width, manifest.height, expansionTimes);
    }).catch((error) => {
      mapPromise = null;
      throw new Error(`Unable to load baked Terrifront map at ${mapPath}: ${error.message}`);
    });
  }
  return mapPromise;
}

function cloneMap(source) {
  return createMap(source.terrain, source.width, source.height, source.expansionTimes);
}

function createMap(sourceTerrain, width, height, sourceExpansionTimes) {
  const cellCount = width * height;
  const terrain = Uint8Array.from(sourceTerrain);
  const conquerableTerrainCount = terrain.reduce((count, value) => count + ((value & TERRAIN_LAND) !== 0 ? 1 : 0), 0);
  const owners = new Int32Array(cellCount);
  const expansionTimes = sourceExpansionTimes
    ? Uint8Array.from(sourceExpansionTimes)
    : new Uint8Array(cellCount).fill(50);
  const neighborTable = new Array(cellCount);
  for (let position = 0; position < cellCount; position += 1) {
    const x = position % width;
    const neighbors = [];
    if (x > 0) neighbors.push(position - 1);
    if (x < width - 1) neighbors.push(position + 1);
    if (position >= width) neighbors.push(position - width);
    if (position < cellCount - width) neighbors.push(position + width);
    neighborTable[position] = neighbors;
  }

  return {
    mapId: MAP_ID,
    width,
    height,
    cellCount,
    conquerableTerrainCount,
    backgroundAsset: 'map/europ-asia-map.webp',
    terrain,
    owners,
    expansionTimes,
    getTerrain(position) {
      return terrain[position] ?? TERRAIN_WATER;
    },
    isLand(position) {
      return (terrain[position] & TERRAIN_LAND) !== 0;
    },
    getNeighbors(position) {
      return neighborTable[position] || [];
    },
    getCapitalCells(centerPosition) {
      const centerX = centerPosition % width;
      const centerY = Math.floor(centerPosition / width);
      const cells = [];
      for (let y = centerY - 2; y <= centerY + 2; y += 1) {
        for (let x = centerX - 2; x <= centerX + 2; x += 1) {
          if (x < 0 || x >= width || y < 0 || y >= height) return [];
          if (Math.abs(x - centerX) === 2 && Math.abs(y - centerY) === 2) continue;
          cells.push(y * width + x);
        }
      }
      return cells;
    },
    serialize() {
      return {
        mapId: MAP_ID,
        width,
        height,
        backgroundAsset: 'map/europ-asia-map.webp',
        terrainUrl: '/map/map.bin',
        terrainEncoding: 'packed-u8',
        terrainLength: terrain.length,
        expansionTimesUrl: '/map/expansion-times.bin',
        ownersEncoding: 'sparse-updates'
      };
    }
  };
}

module.exports = { loadMap, cloneMap, createMap, TERRAIN_WATER, TERRAIN_LAND, OWNER_NEUTRAL };
