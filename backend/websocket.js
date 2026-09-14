const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const {
  OP,
  encodeGameAccepted,
  encodeSpawnPhaseStarted,
  encodeSpawnConfirmed,
  encodeRejected,
  encodeGameStarted,
  encodeGameUpdate,
  decodeClientMessage
} = require('../shared/binary-protocol');
const GameMaster = require('./game-master-main/game-master');

const port = Number(process.env.PORT || 8080);
const root = path.resolve(__dirname, '..');
const fileCache = new Map();

function cacheStaticFile(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    fileCache.set(path.relative(root, filePath).replace(/\\/g, '/'), content);
    return content;
  } catch {
    return null;
  }
}

const staticServer = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const requestedPath = requestUrl.pathname === '/' ? '/dist/terrifront.html' : requestUrl.pathname;
  const filePath = path.resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(root)) {
    response.writeHead(404, { 'Cache-Control': 'no-store' });
    response.end('Not found');
    return;
  }

  let payload = fileCache.get(requestedPath.replace(/^\//, ''));
  if (!payload && fs.existsSync(filePath)) {
    payload = fs.readFileSync(filePath);
    fileCache.set(requestedPath.replace(/^\//, ''), payload);
  }

  if (!payload) {
    response.writeHead(404, { 'Cache-Control': 'no-store' });
    response.end('Not found');
    return;
  }

  const contentType = filePath.endsWith('.html') ? 'text/html; charset=utf-8'
    : filePath.endsWith('.bin') ? 'application/octet-stream'
      : filePath.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream';
  const cacheControl = filePath.endsWith('.html') || filePath.endsWith('.bin')
    ? 'no-cache, no-store, must-revalidate'
    : 'public, max-age=31536000, immutable';
  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'Access-Control-Allow-Origin': '*'
  });
  response.end(payload);
});
const server = new WebSocket.Server({ server: staticServer });
const gameMaster = new GameMaster();
const gameSockets = new Map();

const STATIC_FILES = [
  '/dist/terrifront.html',
  '/map/europ-asia-map.webp',
  '/map/map.bin',
  '/map/expansion-times.bin'
];
for (const file of STATIC_FILES) {
  const fullPath = path.resolve(root, `.${file}`);
  cacheStaticFile(fullPath);
}

async function handleGameRequest(socket, message) {
  const playerName = message.playerName.trim().slice(0, 24);
  if (!playerName) {
    console.log(`[${new Date().toISOString()}] REQUEST_REJECTED reason=INVALID_PLAYER_NAME`);
    socket.send(encodeRejected(OP.GAME_REJECTED, 'INVALID_PLAYER_NAME'));
    return;
  }

  let gameData;
  try {
    gameData = await gameMaster.requestGame(playerName);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] REQUEST_FAILED reason=${error.message}`);
    socket.send(encodeRejected(OP.GAME_REJECTED, 'MAP_LOAD_FAILED'));
    return;
  }

  const { game, spawnPhase } = gameData;
  gameSockets.set(game.gameId, socket);
  socket.gameId = game.gameId;
  console.log(`[${new Date().toISOString()}] REQUEST_ACCEPTED playerName=${playerName} gameId=${game.gameId}`);
  socket.send(encodeGameAccepted(game));
  socket.send(encodeSpawnPhaseStarted(game.playerId, spawnPhase));
  setTimeout(async () => {
    gameMaster.finalizeGame(game.gameId);
    const state = await gameMaster.populateBots(game.gameId);
    if (state && socket.readyState === WebSocket.OPEN) {
      socket.send(encodeGameStarted(state));
    }
  }, spawnPhase.durationMs);
}

server.on('connection', (socket) => {
  const clientAddress = socket._socket?.remoteAddress || 'unknown-client';
  console.log(`[${new Date().toISOString()}] CLIENT_CONNECTED ${clientAddress}`);

  socket.on('message', (rawMessage) => {
    let message;
    try {
      message = decodeClientMessage(rawMessage);
    } catch {
      console.log(`[${new Date().toISOString()}] REQUEST_REJECTED reason=INVALID_BINARY_MESSAGE`);
      socket.send(encodeRejected(OP.GAME_REJECTED, 'INVALID_JSON'));
      return;
    }

    if (message.opcode === OP.EXPANSION_REQUEST) {
      const result = gameMaster.requestExpansion(message.playerId, message.position, message.power);
      if (!result.accepted) {
        socket.send(encodeRejected(OP.EXPANSION_REJECTED, result.reason));
        return;
      }
      return;
    }

    if (message.opcode === OP.BOAT_REQUEST) {
      const result = gameMaster.requestBoat(message.playerId, message.position, message.power);
      if (!result.accepted) {
        socket.send(encodeRejected(OP.BOAT_REJECTED, result.reason));
        return;
      }
      return;
    }

    if (message.opcode === OP.CANCEL_EXPANSION) {
      const player = gameMaster.players.get(message.playerId);
      if (player) player.engine.cancelExpansion(message.playerId);
      return;
    }

    if (message.opcode === OP.SPAWN_POSITION) {
      const result = gameMaster.submitSpawn(message.playerId, message.position);
      console.log(`[${new Date().toISOString()}] SPAWN_${result.accepted ? 'ACCEPTED' : 'REJECTED'} playerId=${message.playerId} position=${message.position} reason=${result.reason ?? 'none'}`);
      socket.send(result.accepted
        ? encodeSpawnConfirmed(result)
        : encodeRejected(OP.SPAWN_REJECTED, result.reason));
      return;
    }

    if (message.opcode !== OP.REQUEST_GAME || typeof message.playerName !== 'string') {
      console.log(`[${new Date().toISOString()}] REQUEST_REJECTED reason=INVALID_GAME_REQUEST`);
      socket.send(encodeRejected(OP.GAME_REJECTED, 'INVALID_GAME_REQUEST'));
      return;
    }

    handleGameRequest(socket, message).catch((error) => {
      console.error(`[${new Date().toISOString()}] REQUEST_FAILED reason=${error.message}`);
      socket.send(encodeRejected(OP.GAME_REJECTED, 'MAP_LOAD_FAILED'));
    });
  });

  socket.on('close', () => {
    if (socket.gameId && gameSockets.get(socket.gameId) === socket) gameSockets.delete(socket.gameId);
    if (socket.gameId) gameMaster.removeGame(socket.gameId);
  });
});

gameMaster.startTicker((update) => {
    const socket = gameSockets.get(update.gameId);
  if (socket?.readyState === WebSocket.OPEN) socket.send(encodeGameUpdate(update));
});

staticServer.listen(port, () => {
  console.log(`Terrifront WebSocket server listening on ws://localhost:${port}`);
});