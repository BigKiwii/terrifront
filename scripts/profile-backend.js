const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const protocol = require('../shared/binary-protocol');

const durationMs = Number(process.env.PROFILE_DURATION_MS || 15000);
const clientCount = Number(process.env.PROFILE_CLIENTS || 4);
const matchCount = Number(process.env.PROFILE_MATCHES || 1);
const randomSeed = process.env.PROFILE_RANDOM_SEED || '417';
const lobbyDurationMs = Number(process.env.PROFILE_LOBBY_MS || 1500);
const spawnDurationMs = Number(process.env.PROFILE_SPAWN_MS || 1500);
const port = Number(process.env.PROFILE_PORT || 8090);
const root = path.resolve(__dirname, '..');
const metricsPath = path.join(root, 'profile-metrics.json');
const reportPath = path.join(root, 'report.txt');
if (fs.existsSync(metricsPath)) fs.unlinkSync(metricsPath);
const server = spawn(process.execPath, ['backend/websocket.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    TERRIFRONT_METRICS_FILE: metricsPath,
    TERRIFRONT_LOBBY_DURATION_MS: String(lobbyDurationMs),
    TERRIFRONT_SPAWN_DURATION_MS: String(spawnDurationMs),
    TERRIFRONT_RANDOM_SEED: randomSeed
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

const clients = [];
const startedAt = Date.now();
let gameAccepted = 0;
let gameStarted = 0;
let protocolErrors = 0;
let connectionsOpened = 0;
let connectionsClosed = 0;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function connectClient(index, batch) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    socket.binaryType = 'arraybuffer';
    const client = { socket, index, batch, playerId: null, spawnPoints: [] };
    clients.push(client);
    socket.once('open', () => {
      connectionsOpened += 1;
      socket.send(protocol.encodeRequestLobby ? protocol.encodeRequestLobby() : Buffer.from([protocol.OP.REQUEST_LOBBY]));
      socket.send(encodeJoinLobby(`Profiler ${batch + 1}-${index + 1}`));
      resolve(client);
    });
    socket.on('close', () => { connectionsClosed += 1; });
    socket.on('error', reject);
    socket.on('message', raw => handleMessage(client, raw));
  });
}

function encodeJoinLobby(name) {
  const writer = new protocol.BinaryWriter(32);
  writer.u8(protocol.OP.JOIN_LOBBY);
  writer.string(name);
  return writer.finish();
}

function handleMessage(client, raw) {
  try {
    const message = protocol.decodeServerMessage(raw);
    if (message.opcode === protocol.OP.GAME_ACCEPTED) {
      gameAccepted += 1;
      client.playerId = message.payload.playerId;
    }
    if (message.opcode === protocol.OP.SPAWN_PHASE_STARTED) {
      client.spawnPoints = message.payload.spawnPoints || [];
      const position = client.spawnPoints[client.index] ?? client.spawnPoints[0];
      if (client.playerId && position !== undefined) {
        client.socket.send(encodeSpawn(client.playerId, position));
      }
    }
    if (message.opcode === protocol.OP.GAME_STARTED) gameStarted += 1;
  } catch {
    protocolErrors += 1;
  }
}

function encodeSpawn(playerId, position) {
  const writer = new protocol.BinaryWriter(12);
  writer.u8(protocol.OP.SPAWN_POSITION);
  writer.u32(Number(playerId.replace('player-', '')));
  writer.u32(position);
  return writer.finish();
}

function closeEverything() {
  for (const client of clients) client.socket.close();
  server.kill('SIGINT');
}

function number(value) {
  return Number.isFinite(value) ? value.toFixed(2) : 'n/a';
}

function buildReport(metrics) {
  const games = Object.entries(metrics.games || {});
  const elapsedSeconds = metrics.elapsedMs / 1000;
  const cpuMs = (metrics.process?.cpuUserMs || 0) + (metrics.process?.cpuSystemMs || 0);
  const lines = [
    'TERRIFRONT BACKEND PERFORMANCE REPORT',
    '=======================================',
    `Generated: ${new Date().toISOString()}`,
    `Host: ${os.platform()} ${os.arch()} ${os.cpus().length} CPUs`,
    `Node: ${process.version}`,
    `Duration: ${number(elapsedSeconds)} seconds`,
    `Matches requested: ${matchCount}`,
    `Clients per match requested/opened/closed: ${clientCount}/${connectionsOpened}/${connectionsClosed}`,
    `Player game accepts/starts: ${gameAccepted}/${gameStarted}`,
    `Games with simulation metrics: ${games.length}`,
    `Profiler random seed: ${randomSeed}`,
    `Protocol decode errors: ${protocolErrors}`,
    '',
    'PROCESS RESOURCES',
    '-----------------',
    `RSS: ${number(metrics.process?.rssMb)} MB`,
    `Heap used/total: ${number(metrics.process?.heapUsedMb)} / ${number(metrics.process?.heapTotalMb)} MB`,
    `External memory: ${number(metrics.process?.externalMb)} MB`,
    `CPU user/system: ${number(metrics.process?.cpuUserMs)} / ${number(metrics.process?.cpuSystemMs)} ms`,
    `Approx CPU utilisation: ${number(cpuMs / Math.max(1, metrics.elapsedMs) * 100)}%`,
    '',
    'EVENT LOOP',
    '----------',
    `Mean/p50/p95/p99/max delay: ${number(metrics.eventLoop?.meanMs)} / ${number(metrics.eventLoop?.p50Ms)} / ${number(metrics.eventLoop?.p95Ms)} / ${number(metrics.eventLoop?.p99Ms)} / ${number(metrics.eventLoop?.maxMs)} ms`,
    '',
    'NETWORK',
    '-------',
    `Messages in: ${metrics.counters?.websocketMessages || 0}`,
    `Bytes in/out: ${metrics.counters?.websocketBytesIn || 0} / ${metrics.counters?.websocketBytesOut || 0}`,
    '',
    'PER-GAME SIMULATION',
    '-------------------'
  ];
  if (!games.length) lines.push('No game metrics captured. Increase PROFILE_DURATION_MS or check server startup.');
  for (const [gameId, game] of games) {
    const ticks = Math.max(1, game.ticks);
    lines.push(
      `${gameId}: ticks=${game.ticks}, updates=${game.updates}, avgTick=${number(game.tickWallMs / ticks)}ms, maxTick=${number(game.maxTickMs)}ms`,
      `  phase ms total: bots=${number(game.botMs)}, attacks=${number(game.expansionMs)}, boats=${number(game.boatMs)}, nukes=${number(game.nukeMs)}, economy=${number(game.economyMs)}`,
      `  peaks: players=${game.maxPlayers}, attacks=${game.maxAttacks}, boats=${game.maxBoats}, pendingNukes=${game.maxPendingNukes}`
    );
  }
  const totalTicks = games.reduce((total, [, game]) => total + game.ticks, 0);
  const totalTickMs = games.reduce((total, [, game]) => total + game.tickWallMs, 0);
  const totalAttackMs = games.reduce((total, [, game]) => total + game.expansionMs, 0);
  lines.push(
    '',
    'AGGREGATE SCALING',
    '-----------------',
    `Games measured: ${games.length}`,
    `Total ticks: ${totalTicks}`,
    `Average tick across games: ${number(totalTickMs / Math.max(1, totalTicks))} ms`,
    `Attack share of simulation time: ${number(totalAttackMs / Math.max(1, totalTickMs) * 100)}%`,
    '',
    'INTERPRETATION',
    '--------------',
    'Compare aggregate tick time and event-loop delay as match count increases. Linear growth is expected; a sharp increase indicates scheduler contention or shared-process pressure. High attack share confirms the attack path remains the next optimization target.'
  );
  return `${lines.join('\n')}\n`;
}

(async () => {
  try {
    await wait(500);
    for (let batch = 0; batch < matchCount; batch += 1) {
      await Promise.all(Array.from({ length: clientCount }, (_, index) => connectClient(index, batch)));
      if (batch < matchCount - 1) await wait(lobbyDurationMs + spawnDurationMs + 250);
    }
    await wait(durationMs);
  } catch (error) {
    console.error(`Profiler failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    closeEverything();
    await wait(500);
    let metrics = {};
    if (fs.existsSync(metricsPath)) metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    fs.writeFileSync(reportPath, buildReport(metrics));
    console.log(`Wrote ${path.relative(root, reportPath)}`);
    console.log(`Wrote ${path.relative(root, metricsPath)}`);
  }
})();
