const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const manifestPath = path.join(root, 'map', 'manifest.json');
const outputPath = path.join(root, 'dist', 'terrifront.html');

const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(frontend, 'index.css'), 'utf8');
const webglRenderer = fs.readFileSync(path.join(frontend, 'game-ui', 'webgl-renderer.js'), 'utf8');
const playerLabelRenderer = fs.readFileSync(path.join(frontend, 'player-label-renderer.js'), 'utf8');
const mapGeometry = fs.readFileSync(path.join(frontend, 'game-ui', 'map-geometry.js'), 'utf8');
const colorUtils = fs.readFileSync(path.join(frontend, 'game-ui', 'color-utils.js'), 'utf8');
const gameStore = fs.readFileSync(path.join(frontend, 'game-ui', 'game-store.js'), 'utf8');
const renderLoop = fs.readFileSync(path.join(frontend, 'game-ui', 'render-loop.js'), 'utf8');
const mapAssets = fs.readFileSync(path.join(frontend, 'game-ui', 'map-assets.js'), 'utf8');
const leaderboard = fs.readFileSync(path.join(frontend, 'game-ui', 'leaderboard.js'), 'utf8');
const activeAttacks = fs.readFileSync(path.join(frontend, 'game-ui', 'active-attacks.js'), 'utf8');
const playerStats = fs.readFileSync(path.join(frontend, 'game-ui', 'player-stats.js'), 'utf8');
const spawnHud = fs.readFileSync(path.join(frontend, 'game-ui', 'spawn-hud.js'), 'utf8');
const attackRatio = fs.readFileSync(path.join(frontend, 'game-ui', 'attack-ratio.js'), 'utf8');
const mapMenu = fs.readFileSync(path.join(frontend, 'game-ui', 'map-menu.js'), 'utf8');
const nukeControls = fs.readFileSync(path.join(frontend, 'game-ui', 'nuke-controls.js'), 'utf8');
const canvasResizer = fs.readFileSync(path.join(frontend, 'game-ui', 'canvas-resizer.js'), 'utf8');
const mapRules = fs.readFileSync(path.join(frontend, 'game-ui', 'map-rules.js'), 'utf8');
const webglSync = fs.readFileSync(path.join(frontend, 'game-ui', 'rendering', 'webgl-sync.js'), 'utf8');
const colorCache = fs.readFileSync(path.join(frontend, 'game-ui', 'rendering', 'color-cache.js'), 'utf8');
const sceneRenderer = fs.readFileSync(path.join(frontend, 'game-ui', 'rendering', 'scene-renderer.js'), 'utf8');
const dynamicRenderer = fs.readFileSync(path.join(frontend, 'game-ui', 'rendering', 'dynamic-renderer.js'), 'utf8');
const labelScheduler = fs.readFileSync(path.join(frontend, 'game-ui', 'rendering', 'label-scheduler.js'), 'utf8');
const dynamicScheduler = fs.readFileSync(path.join(frontend, 'game-ui', 'rendering', 'dynamic-scheduler.js'), 'utf8');
const mapTransform = fs.readFileSync(path.join(frontend, 'game-ui', 'input', 'map-transform.js'), 'utf8');
const cameraController = fs.readFileSync(path.join(frontend, 'game-ui', 'camera-controller.js'), 'utf8');
const mapGestures = fs.readFileSync(path.join(frontend, 'game-ui', 'input', 'map-gestures.js'), 'utf8');
const playerRegistry = fs.readFileSync(path.join(frontend, 'game-ui', 'core', 'player-registry.js'), 'utf8');
const ratioDisplay = fs.readFileSync(path.join(frontend, 'game-ui', 'hud', 'ratio-display.js'), 'utf8');
const mathUtils = fs.readFileSync(path.join(frontend, 'game-ui', 'math-utils.js'), 'utf8');
const formatUtils = fs.readFileSync(path.join(frontend, 'game-ui', 'format-utils.js'), 'utf8');
const changeBuffer = fs.readFileSync(path.join(frontend, 'game-ui', 'change-buffer.js'), 'utf8');
const mapCoordinates = fs.readFileSync(path.join(frontend, 'game-ui', 'map-coordinates.js'), 'utf8');
const nukeGeometry = fs.readFileSync(path.join(frontend, 'game-ui', 'nuke-geometry.js'), 'utf8');
const gameUI = fs.readFileSync(path.join(frontend, 'gameUI.js'), 'utf8');
const offlineCoordinator = fs.readFileSync(path.join(frontend, 'offline-coordinator.js'), 'utf8');
const offlineWorker = fs.readFileSync(path.join(frontend, 'offline-worker.js'), 'utf8');
const index = fs.readFileSync(path.join(frontend, 'index.js'), 'utf8');
const terrain = fs.readFileSync(path.join(root, 'map', 'map.bin')).toString('base64');
const expansionTimes = fs.readFileSync(path.join(root, 'map', 'expansion-times.bin')).toString('base64');
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
const workerVersion = crypto.createHash('sha256').update(offlineWorkerSource).digest('hex').slice(0, 12);
const workerSourceOutputPath = path.join(root, 'dist', 'offline-worker-source.js');
const embeddedMapData = `<script>window.TerriMapWidth=${manifest.width};window.TerriMapHeight=${manifest.height};window.TerriOfflineWorkerUrl='offline-worker.js?v=${workerVersion}';</script><script src="offline-worker-source.js"></script>`;

const output = html
  .replace('<script src="../shared/binary-protocol.js"></script>', embeddedMapData)
  .replace('<link rel="stylesheet" href="index.css">', `<style>${css.replace("url('../map/europ-asia-map.webp')", "url('../map/europ-asia-map.webp')")}</style>`)
  .replace('<script src="game-ui/webgl-renderer.js"></script>', `<script>${webglRenderer}</script>`)
  .replace('<script src="player-label-renderer.js"></script>', `<script>${playerLabelRenderer}</script>`)
  .replace('<script src="game-ui/map-geometry.js"></script>', `<script>${mapGeometry}</script>`)
  .replace('<script src="game-ui/color-utils.js"></script>', `<script>${colorUtils}</script>`)
  .replace('<script src="game-ui/game-store.js"></script>', `<script>${gameStore}</script>`)
  .replace('<script src="game-ui/render-loop.js"></script>', `<script>${renderLoop}</script>`)
  .replace('<script src="game-ui/map-assets.js"></script>', `<script>${mapAssets}</script>`)
  .replace('<script src="game-ui/leaderboard.js"></script>', `<script>${leaderboard}</script>`)
  .replace('<script src="game-ui/active-attacks.js"></script>', `<script>${activeAttacks}</script>`)
  .replace('<script src="game-ui/player-stats.js"></script>', `<script>${playerStats}</script>`)
  .replace('<script src="game-ui/spawn-hud.js"></script>', `<script>${spawnHud}</script>`)
  .replace('<script src="game-ui/attack-ratio.js"></script>', `<script>${attackRatio}</script>`)
  .replace('<script src="game-ui/map-menu.js"></script>', `<script>${mapMenu}</script>`)
  .replace('<script src="game-ui/nuke-controls.js"></script>', `<script>${nukeControls}</script>`)
  .replace('<script src="game-ui/canvas-resizer.js"></script>', `<script>${canvasResizer}</script>`)
  .replace('<script src="game-ui/map-rules.js"></script>', `<script>${mapRules}</script>`)
  .replace('<script src="game-ui/rendering/webgl-sync.js"></script>', `<script>${webglSync}</script>`)
  .replace('<script src="game-ui/rendering/color-cache.js"></script>', `<script>${colorCache}</script>`)
  .replace('<script src="game-ui/rendering/scene-renderer.js"></script>', `<script>${sceneRenderer}</script>`)
  .replace('<script src="game-ui/rendering/dynamic-renderer.js"></script>', `<script>${dynamicRenderer}</script>`)
  .replace('<script src="game-ui/rendering/label-scheduler.js"></script>', `<script>${labelScheduler}</script>`)
  .replace('<script src="game-ui/rendering/dynamic-scheduler.js"></script>', `<script>${dynamicScheduler}</script>`)
  .replace('<script src="game-ui/input/map-transform.js"></script>', `<script>${mapTransform}</script>`)
  .replace('<script src="game-ui/input/camera-controller.js"></script>', `<script>${cameraController}</script>`)
  .replace('<script src="game-ui/input/map-gestures.js"></script>', `<script>${mapGestures}</script>`)
  .replace('<script src="game-ui/core/player-registry.js"></script>', `<script>${playerRegistry}</script>`)
  .replace('<script src="game-ui/hud/ratio-display.js"></script>', `<script>${ratioDisplay}</script>`)
  .replace('<script src="game-ui/math-utils.js"></script>', `<script>${mathUtils}</script>`)
  .replace('<script src="game-ui/format-utils.js"></script>', `<script>${formatUtils}</script>`)
  .replace('<script src="game-ui/change-buffer.js"></script>', `<script>${changeBuffer}</script>`)
  .replace('<script src="game-ui/map-coordinates.js"></script>', `<script>${mapCoordinates}</script>`)
  .replace('<script src="game-ui/nuke-geometry.js"></script>', `<script>${nukeGeometry}</script>`)
  .replace('<script src="offline-coordinator.js"></script>', `<script>${offlineLogicBundle}${offlineCoordinator}</script>`)
  .replace('<script src="gameUI.js"></script>', `<script>${gameUI}</script>`)
  .replace('<script src="index.js"></script>', `<script>${index}</script>`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);
fs.writeFileSync(workerOutputPath, offlineWorkerSource);
fs.writeFileSync(workerSourceOutputPath, `window.TerriEmbeddedTerrain='${terrain}';window.TerriEmbeddedExpansionTimes='${expansionTimes}';window.TerriOfflineWorkerSource=${JSON.stringify(offlineWorkerSource)};`);
console.log(`Built ${path.relative(root, outputPath)}`);