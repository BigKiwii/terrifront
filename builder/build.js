const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const shared = path.join(root, 'shared');
const mapPath = path.join(root, 'map', 'europ-asia-map.webp');
const outputPath = path.join(root, 'dist', 'terrifront.html');

const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
const protocol = fs.readFileSync(path.join(shared, 'protocol.js'), 'utf8');
const css = fs.readFileSync(path.join(frontend, 'index.css'), 'utf8');
const communicator = fs.readFileSync(path.join(frontend, 'communicator.js'), 'utf8');
const playerLabelRenderer = fs.readFileSync(path.join(frontend, 'player-label-renderer.js'), 'utf8');
const gameUI = fs.readFileSync(path.join(frontend, 'gameUI.js'), 'utf8');
const index = fs.readFileSync(path.join(frontend, 'index.js'), 'utf8');
const map = fs.readFileSync(mapPath).toString('base64');

const output = html
  .replace('<link rel="stylesheet" href="index.css">', `<style>${css.replace("url('../map/europ-asia-map.webp')", `url('data:image/webp;base64,${map}')`)}</style>`)
  .replace('<script src="../shared/protocol.js"></script>', `<script>${protocol}</script>`)
  .replace('<script src="communicator.js"></script>', `<script>${communicator}</script>`)
  .replace('<script src="player-label-renderer.js"></script>', `<script>${playerLabelRenderer}</script>`)
  .replace('<script src="gameUI.js"></script>', `<script>${gameUI.replace("'../map/europ-asia-map.webp'", `'data:image/webp;base64,${map}'`)}</script>`)
  .replace('<script src="index.js"></script>', `<script>${index}</script>`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, output);
console.log(`Built ${path.relative(root, outputPath)}`);