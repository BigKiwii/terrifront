const fs = require('fs');
const http = require('http');
const path = require('path');

const port = Number(process.env.PORT || 8080);
const root = path.resolve(__dirname, '..');

const aliases = {
  '/': '/dist/terrifront.html',
  '/terrifront.html': '/dist/terrifront.html',
  '/offline-worker.js': '/dist/offline-worker.js',
  '/offline-worker-source.js': '/dist/offline-worker-source.js'
};

const contentTypes = {
  '.bin': 'application/octet-stream',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function resolveFile(requestPath) {
  const mappedPath = aliases[requestPath] || requestPath;
  const filePath = path.resolve(root, `.${mappedPath}`);
  return filePath.startsWith(root) ? filePath : null;
}

const server = http.createServer((request, response) => {
  const requestPath = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  const filePath = resolveFile(requestPath);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { 'Cache-Control': 'no-store' });
    response.end('Not found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': extension === '.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000, immutable',
    'Content-Type': contentTypes[extension] || 'application/octet-stream'
  });
  response.end(fs.readFileSync(filePath));
});

server.listen(port, () => {
  console.log(`TerriFront static server listening on http://localhost:${port}`);
});
