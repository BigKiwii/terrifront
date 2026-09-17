const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const shared = path.join(root, 'shared');
const mapPath = path.join(root, 'map', 'europ-asia-map.webp');
const terrainPath = path.join(root, 'map', 'map.bin');
const expansionTimesPath = path.join(root, 'map', 'expansion-times.bin');
const manifestPath = path.join(root, 'map', 'manifest.json');
const outputPath = path.join(root, 'dist', 'terrifront.html');

const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
const binaryProtocol = fs.readFileSync(path.join(shared, 'binary-protocol.js'), 'utf8');
const css = fs.readFileSync(path.join(frontend, 'index.css'), 'utf8');
const communicator = fs.readFileSync(path.join(frontend, 'communicator.js'), 'utf8');
const webglRenderer = fs.readFileSync(path.join(frontend, 'game-ui', 'webgl-renderer.js'), 'utf8');
const playerLabelRenderer = fs.readFileSync(path.join(frontend, 'player-label-renderer.js'), 'utf8');
const mapGeometry = fs.readFileSync(path.join(frontend, 'game-ui', 'map-geometry.js'), 'utf8');
const colorUtils = fs.readFileSync(path.join(frontend, 'game-ui', 'color-utils.js'), 'utf8');
const gameStore = fs.readFileSync(path.join(frontend, 'game-ui', 'game-store.js'), 'utf8');
const gameUI = fs.readFileSync(path.join(frontend, 'gameUI.js'), 'utf8');
const offlineCoordinator = fs.readFileSync(path.join(frontend, 'offline-coordinator.js'), 'utf8');
const offlineWorker = fs.readFileSync(path.join(frontend, 'offline-worker.js'), 'utf8');
const index = fs.readFileSync(path.join(frontend, 'index.js'), 'utf8');
const map = fs.readFileSync(mapPath).toString('base64');
const terrain = fs.existsSync(terrainPath) ? fs.readFileSync(terrainPath).toString('base64') : '';
const expansionTimes = fs.existsSync(expansionTimesPath) ? fs.readFileSync(expansionTimesPath).toString('base64') : '';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function resolveModule(request, parentId) {
  if (!request.startsWith('.')) return null;
  const candidate = path.resolve(root, path.dirname(parentId), request);
  if (fs.existsSync(`${candidate}.js`)) return `${path.relative(root, `${candidate}.js`)}`.replace(/\\/g, '/');
  if (fs.existsSync(path.join(candidate, 'index.js'))) return `${path.relative(root, path.join(candidate, 'index.js'))}`.replace(/\\/g, '/');
  throw new Error(`Unable to resolve browser module ${request} from ${parentId}`);
}

function collectModules(entryId, modules = new Map()) {
  if (modules.has(entryId)) return modules;
  const source = fs.readFileSync(path.join(root, entryId), 'utf8');
  const dependencies = [];
  const transformed = source.replace(/require\((['"])(.+?)\1\)/g, (match, quote, request) => {
    const dependencyId = resolveModule(request, entryId);
    if (!dependencyId) return match;
    dependencies.push(dependencyId);
    return `require('${dependencyId}')`;
  });
  modules.set(entryId, transformed);
  for (const dependency of dependencies) collectModules(dependency, modules);
  return modules;
}

function buildOfflineLogicBundle() {
  const entryId = 'backend/game-master-main/game-engine.js';
  const modules = collectModules(entryId);
  const definitions = [...modules.entries()]
    .map(([id, source]) => `${JSON.stringify(id)}: function(require, module, exports) {\n${source}\n}`)
    .join(',\n');
  return `(function(){const modules={${definitions}};const cache={};function load(id){if(cache[id])return cache[id].exports;const definition=modules[id];if(!definition)throw new Error('Offline module not found: '+id);const module={exports:{}};cache[id]=module;definition(load,module,module.exports);return module.exports;}const mapGenerator=load('backend/game-logic/map-generator.js');const rules=load('shared/game-rules.js');globalThis.TerriOfflineLogic={GameEngine:load('backend/game-master-main/game-engine.js'),createMap:mapGenerator.createMap,BOT_COUNT:rules.BOT_COUNT};}());`;
}

const offlineLogicBundle = buildOfflineLogicBundle();
const workerOutputPath = path.join(root, 'dist', 'offline-worker.js');
const offlineWorkerSource = `${offlineLogicBundle}${offlineWorker}`;
const embeddedMapData = `<script>window.TerriEmbeddedTerrain='${terrain}';window.TerriEmbeddedExpansionTimes='${expansionTimes}';window.TerriMapWidth=${manifest.width};window.TerriMapHeight=${manifest.height};window.TerriOfflineWorkerUrl='/dist/offline-worker.js';window.TerriOfflineWorkerSource=${JSON.stringify(offlineWorkerSource)};</script>`;

const output = html
  .replace('<script src="../shared/binary-protocol.js"></script>', `${embeddedMapData}<script src="../shared/binary-protocol.js"></script>`)
  .replace('<link rel="stylesheet" href="index.css">', `<style>${css.replace("url('../map/europ-asia-map.webp')", `url('data:image/webp;base64,${map}')`)}</style>`)
  .replace('<script src="../shared/binary-protocol.js"></script>', `<script>${binaryProtocol}</script>`)
  .replace('<script src="communicator.js"></script>', `<script>${communicator}</script>`)
  .replace('<script src="game-ui/webgl-renderer.js"></script>', `<script>${webglRenderer}</script>`)
  .replace('<script src="player-label-renderer.js"></script>', `<script>${playerLabelRenderer}</script>`)
  .replace('<script src="game-ui/map-geometry.js"></script>', `<script>${mapGeometry}</script>`)
  .replace('<script src="game-ui/color-utils.js"></script>', `<script>${colorUtils}</script>`)
  .replace('<script src="game-ui/game-store.js"></script>', `<script>${gameStore}</script>`)
  .replace('<script src="offline-coordinator.js"></script>', `<script>${offlineLogicBundle}${offlineCoordinator}</script>`)
  .replace('<script src="gameUI.js"></script>', `<script>${gameUI.replace("'../map/europ-asia-map.webp'", `'data:image/webp;base64,${map}'`)}</script>`)
  .replace('<script src="index.js"></script>', `<script>${index}</script>`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);
fs.writeFileSync(workerOutputPath, offlineWorkerSource);
console.log(`Built ${path.relative(root, outputPath)}`);