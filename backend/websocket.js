const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { CODES, createMessage } = require('../shared/protocol');
const GameMaster = require('./game-master-main/game-master');

const port = Number(process.env.PORT || 8080);
const root = path.resolve(__dirname, '..');
const staticServer = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const requestedPath = requestUrl.pathname === '/' ? '/dist/terrifront.html' : requestUrl.pathname;
  const filePath = path.resolve(root, `.${requestedPath}`);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
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
  fs.createReadStream(filePath).pipe(response);
});
const server = new WebSocket.Server({ server: staticServer });
const gameMaster = new GameMaster();
const gameSockets = new Map();

server.on('connection', (socket) => {
  const clientAddress = socket._socket?.remoteAddress || 'unknown-client';
  console.log(`[${new Date().toISOString()}] CLIENT_CONNECTED ${clientAddress}`);

  socket.on('message', async (rawMessage) => {
    const rawText = rawMessage.toString();
    console.log(`[${new Date().toISOString()}] REQUEST from=${clientAddress} raw=${rawText}`);

    let message;
    try {
      message = JSON.parse(rawText);
    } catch {
      console.log(`[${new Date().toISOString()}] REQUEST_REJECTED reason=INVALID_JSON`);
      socket.send(JSON.stringify(createMessage(CODES.GAME_REJECTED, null, { reason: 'INVALID_JSON' })));
      return;
    }

    if (message.code === CODES.EXPANSION_REQUEST) {
      const playerId = message.payload?.playerId;
      const result = gameMaster.requestExpansion(playerId, message.payload?.position, message.payload?.power);
      if (!result.accepted) {
        socket.send(JSON.stringify(createMessage(CODES.EXPANSION_REJECTED, message.requestId, result || { reason: 'PLAYER_NOT_FOUND' })));
        return;
      }
      const player = gameMaster.players.get(playerId);
      socket.send(JSON.stringify(createMessage(CODES.GAME_UPDATE, message.requestId, {
        ...result,
        ...(player.engine.getTickState([]))
      })));
      return;
    }

    if (message.code === CODES.CANCEL_EXPANSION) {
      const playerId = message.payload?.playerId;
      const player = gameMaster.players.get(playerId);
      if (player) player.engine.cancelExpansion(playerId);
      return;
    }

    if (message.code === CODES.SPAWN_POSITION_SUBMITTED) {
      const playerId = message.payload?.playerId;
      const result = gameMaster.submitSpawn(playerId, message.payload?.position);
      const responseCode = result.accepted ? CODES.SPAWN_CONFIRMED : CODES.SPAWN_REJECTED;
      console.log(`[${new Date().toISOString()}] SPAWN_${result.accepted ? 'ACCEPTED' : 'REJECTED'} playerId=${playerId ?? 'missing'} position=${message.payload?.position ?? 'missing'} reason=${result.reason ?? 'none'}`);
      socket.send(JSON.stringify(createMessage(responseCode, message.requestId, result)));
      return;
    }

    if (message.code !== CODES.REQUEST_GAME || typeof message.payload?.playerName !== 'string') {
      console.log(`[${new Date().toISOString()}] REQUEST_REJECTED code=${message.code ?? 'missing'} requestId=${message.requestId ?? 'missing'} reason=INVALID_GAME_REQUEST`);
      socket.send(JSON.stringify(createMessage(CODES.GAME_REJECTED, message.requestId, { reason: 'INVALID_GAME_REQUEST' })));
      return;
    }

    const playerName = message.payload.playerName.trim().slice(0, 24);
    if (!playerName) {
      console.log(`[${new Date().toISOString()}] REQUEST_REJECTED code=${message.code} requestId=${message.requestId ?? 'missing'} reason=INVALID_PLAYER_NAME`);
      socket.send(JSON.stringify(createMessage(CODES.GAME_REJECTED, message.requestId, { reason: 'INVALID_PLAYER_NAME' })));
      return;
    }

    let gameData;
    try {
      gameData = await gameMaster.requestGame(playerName);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] REQUEST_FAILED reason=${error.message}`);
      socket.send(JSON.stringify(createMessage(CODES.GAME_REJECTED, message.requestId, { reason: 'MAP_LOAD_FAILED' })));
      return;
    }
    const { game, spawnPhase } = gameData;
    gameSockets.set(game.gameId, socket);
    socket.gameId = game.gameId;
    console.log(`[${new Date().toISOString()}] REQUEST_ACCEPTED code=${message.code} requestId=${message.requestId ?? 'missing'} playerName=${playerName} gameId=${game.gameId}`);
    socket.send(JSON.stringify(createMessage(CODES.GAME_ACCEPTED, message.requestId, game)));
    socket.send(JSON.stringify(createMessage(CODES.SPAWN_PHASE_STARTED, message.requestId, { ...spawnPhase, playerId: game.playerId })));
    setTimeout(async () => {
      gameMaster.finalizeGame(game.gameId);
      const state = await gameMaster.populateBots(game.gameId);
      if (state && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(createMessage(CODES.GAME_STARTED, message.requestId, state)));
      }
    }, spawnPhase.durationMs);
  });

  socket.on('close', () => {
    if (socket.gameId && gameSockets.get(socket.gameId) === socket) gameSockets.delete(socket.gameId);
    if (socket.gameId) gameMaster.removeGame(socket.gameId);
  });
});

gameMaster.startTicker((update) => {
    const socket = gameSockets.get(update.gameId);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(createMessage(CODES.GAME_UPDATE, null, update)));
});

staticServer.listen(port, () => {
  console.log(`Terrifront WebSocket server listening on ws://localhost:${port}`);
});