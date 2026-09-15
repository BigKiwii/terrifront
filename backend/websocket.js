const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const {
  OP,
  encodeGameAccepted,
  encodeLobbyState,
  encodeSpawnPhaseStarted,
  encodeSpawnConfirmed,
  encodeRejected,
  encodeGameStarted,
  encodeGameUpdate,
  decodeClientMessage
} = require('../shared/binary-protocol');
const GameMaster = require('./game-master-main/game-master');
const LobbyManager = require('./multiplayer/lobby-manager');

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
const lobbySockets = new Map();
const lobbyObservers = new Set();

function broadcastLobby(lobby) {
  const sockets = lobbySockets.get(lobby.lobbyId);
  if (!sockets) return;
  const payload = lobby.snapshot();
  const recipients = new Set(sockets);
  for (const socket of lobbyObservers) recipients.add(socket);
  for (const socket of recipients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(encodeLobbyState(payload, socket.playerId));
  }
}

async function startLobbyMatch(lobby) {
  const match = await gameMaster.createMatch(lobby);
  const sockets = lobbySockets.get(lobby.lobbyId) || new Set();
  lobbySockets.delete(lobby.lobbyId);
  gameSockets.set(match.gameId, sockets);

  for (const lobbyPlayer of lobby.players.values()) {
    const socket = [...sockets].find((candidate) => candidate.playerId === lobbyPlayer.playerId);
    if (!socket) continue;
    const game = match.acceptedPlayers.get(lobbyPlayer.playerId);
    socket.lobbyId = null;
    socket.gameId = match.gameId;
    socket.send(encodeGameAccepted(game));
    socket.send(encodeSpawnPhaseStarted(game.playerId, match.spawnPhase, match.engine.getState()));
  }

  setTimeout(() => {
    gameMaster.finalizeGame(match.gameId);
    const state = match.engine.getState();
    const matchSockets = gameSockets.get(match.gameId) || new Set();
    for (const socket of matchSockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(encodeGameStarted(state));
    }
  }, match.spawnPhase.durationMs);
}

const lobbyManager = new LobbyManager({ onStart: startLobbyMatch });

function broadcastCurrentLobby(lobby) {
  const payload = lobby.snapshot();
  for (const socket of lobbyObservers) {
    if (socket.readyState === WebSocket.OPEN) socket.send(encodeLobbyState(payload, ''));
  }
}

// The callback is assigned after broadcast helpers exist so lobby rotation can
// immediately refresh browsers that are viewing but have not joined yet.
lobbyManager.onRotate = broadcastCurrentLobby;
lobbyManager.start();

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

async function handleLobbyRequest(socket, message) {
  const playerName = message.playerName.trim().slice(0, 24);
  if (!playerName) {
    console.log(`[${new Date().toISOString()}] REQUEST_REJECTED reason=INVALID_PLAYER_NAME`);
    socket.send(encodeRejected(OP.GAME_REJECTED, 'INVALID_PLAYER_NAME'));
    return;
  }
  if (socket.playerId || socket.lobbyId || socket.gameId) {
    socket.send(encodeRejected(OP.LOBBY_REJECTED, 'SESSION_ACTIVE'));
    return;
  }

  const result = lobbyManager.join(playerName);
  if (!result.accepted) {
    socket.send(encodeRejected(OP.LOBBY_REJECTED, result.reason));
    return;
  }
  socket.playerId = result.playerId;
  socket.lobbyId = result.lobby.lobbyId;
  lobbyObservers.delete(socket);
  if (!lobbySockets.has(socket.lobbyId)) lobbySockets.set(socket.lobbyId, new Set());
  lobbySockets.get(socket.lobbyId).add(socket);
  console.log(`[${new Date().toISOString()}] LOBBY_JOINED playerName=${playerName} lobbyId=${socket.lobbyId}`);
  broadcastLobby(lobbyManager.getLobbyForPlayer(socket.playerId));
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
      if (!isAuthorizedMatchAction(socket, message.playerId)) return;
      const result = gameMaster.requestExpansion(message.playerId, message.position, message.power);
      if (!result.accepted) {
        socket.send(encodeRejected(OP.EXPANSION_REJECTED, result.reason));
        return;
      }
      return;
    }

    if (message.opcode === OP.REQUEST_LOBBY) {
      lobbyObservers.add(socket);
      socket.send(encodeLobbyState(lobbyManager.getCurrentSnapshot(), ''));
      return;
    }

    if (message.opcode === OP.BOAT_REQUEST) {
      if (!isAuthorizedMatchAction(socket, message.playerId)) return;
      const result = gameMaster.requestBoat(message.playerId, message.position, message.power);
      if (!result.accepted) {
        socket.send(encodeRejected(OP.BOAT_REJECTED, result.reason));
        return;
      }
      return;
    }

    if (message.opcode === OP.CANCEL_EXPANSION) {
      if (!isAuthorizedMatchAction(socket, message.playerId)) return;
      const player = gameMaster.players.get(message.playerId);
      if (player) {
        if (message.attackId) player.engine.cancelAttack(message.playerId, message.attackId);
        else player.engine.cancelExpansion(message.playerId);
      }
      return;
    }

    if (message.opcode === OP.SPAWN_POSITION) {
      if (!isAuthorizedMatchAction(socket, message.playerId)) return;
      const result = gameMaster.submitSpawn(message.playerId, message.position);
      console.log(`[${new Date().toISOString()}] SPAWN_${result.accepted ? 'ACCEPTED' : 'REJECTED'} playerId=${message.playerId} position=${message.position} reason=${result.reason ?? 'none'}`);
      if (!result.accepted) {
        socket.send(encodeRejected(OP.SPAWN_REJECTED, result.reason));
        return;
      }
      const payload = encodeSpawnConfirmed(result);
      for (const peer of gameSockets.get(socket.gameId) || []) {
        if (peer.readyState === WebSocket.OPEN) peer.send(payload);
      }
      return;
    }

    if (message.opcode === OP.LEAVE_LOBBY) {
      if (socket.lobbyId && socket.playerId === message.playerId) {
        const lobby = lobbyManager.getLobbyForPlayer(socket.playerId);
        lobbyManager.leave(socket.playerId);
        const sockets = lobbySockets.get(socket.lobbyId);
        sockets?.delete(socket);
        socket.lobbyId = null;
        if (lobby) broadcastLobby(lobby);
      }
      return;
    }

    if ((message.opcode !== OP.REQUEST_GAME && message.opcode !== OP.JOIN_LOBBY) || typeof message.playerName !== 'string') {
      console.log(`[${new Date().toISOString()}] REQUEST_REJECTED reason=INVALID_GAME_REQUEST`);
      socket.send(encodeRejected(OP.GAME_REJECTED, 'INVALID_GAME_REQUEST'));
      return;
    }

    handleLobbyRequest(socket, message).catch((error) => {
      console.error(`[${new Date().toISOString()}] REQUEST_FAILED reason=${error.message}`);
      socket.send(encodeRejected(OP.GAME_REJECTED, 'MAP_LOAD_FAILED'));
    });
  });

  socket.on('close', () => {
    lobbyObservers.delete(socket);
    if (socket.lobbyId) {
      const lobby = lobbyManager.getLobbyForPlayer(socket.playerId);
      lobbyManager.leave(socket.playerId);
      lobbySockets.get(socket.lobbyId)?.delete(socket);
      if (lobby) broadcastLobby(lobby);
    }
    if (socket.gameId) gameSockets.get(socket.gameId)?.delete(socket);
  });
});

function isAuthorizedMatchAction(socket, playerId) {
  return Boolean(socket.gameId && socket.playerId === playerId && gameMaster.players.get(playerId)?.gameId === socket.gameId);
}

gameMaster.startTicker((update) => {
  const sockets = gameSockets.get(update.gameId) || new Set();
  const payload = encodeGameUpdate(update);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
});

staticServer.listen(port, () => {
  console.log(`Terrifront WebSocket server listening on ws://localhost:${port}`);
});