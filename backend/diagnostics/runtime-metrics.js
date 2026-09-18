const { monitorEventLoopDelay, performance } = require('node:perf_hooks');

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();
const startedAt = performance.now();
const cpuStarted = process.cpuUsage();
const games = new Map();
const counters = {
  websocketConnections: 0,
  websocketMessages: 0,
  websocketBytesIn: 0,
  websocketBytesOut: 0,
  encodedUpdates: 0,
  droppedUpdates: 0
};

function getGame(gameId) {
  let game = games.get(gameId);
  if (!game) {
    game = {
      ticks: 0,
      tickWallMs: 0,
      botMs: 0,
      expansionMs: 0,
      boatMs: 0,
      nukeMs: 0,
      economyMs: 0,
      updates: 0,
      maxTickMs: 0,
      maxPlayers: 0,
      maxAttacks: 0,
      maxBoats: 0,
      maxPendingNukes: 0
    };
    games.set(gameId, game);
  }
  return game;
}

function measure(gameId, field, callback) {
  const game = getGame(gameId);
  const started = performance.now();
  const result = callback();
  game[field] += performance.now() - started;
  return result;
}

function recordTick(gameId, timings, engine, producedUpdate) {
  const game = getGame(gameId);
  game.ticks += 1;
  game.tickWallMs += timings.totalMs;
  game.botMs += timings.botMs;
  game.expansionMs += timings.expansionMs;
  game.boatMs += timings.boatMs;
  game.nukeMs += timings.nukeMs;
  game.economyMs += timings.economyMs;
  game.maxTickMs = Math.max(game.maxTickMs, timings.totalMs);
  game.maxPlayers = Math.max(game.maxPlayers, engine.players.size);
  game.maxAttacks = Math.max(game.maxAttacks, engine.expansionManager?.attacks.size || 0);
  game.maxBoats = Math.max(game.maxBoats, engine.boatManager?.boats.size || 0);
  game.maxPendingNukes = Math.max(game.maxPendingNukes, engine.pendingNukes.length);
  if (producedUpdate) game.updates += 1;
}

function increment(name, amount = 1) {
  if (Object.prototype.hasOwnProperty.call(counters, name)) counters[name] += amount;
}

function snapshot() {
  const elapsedMs = Math.max(1, performance.now() - startedAt);
  const cpu = process.cpuUsage(cpuStarted);
  return {
    elapsedMs,
    process: {
      rssMb: process.memoryUsage().rss / 1024 / 1024,
      heapUsedMb: process.memoryUsage().heapUsed / 1024 / 1024,
      heapTotalMb: process.memoryUsage().heapTotal / 1024 / 1024,
      externalMb: process.memoryUsage().external / 1024 / 1024,
      cpuUserMs: cpu.user / 1000,
      cpuSystemMs: cpu.system / 1000
    },
    counters: { ...counters },
    eventLoop: {
      meanMs: histogram.mean / 1e6,
      maxMs: histogram.max / 1e6,
      p50Ms: histogram.percentile(50) / 1e6,
      p95Ms: histogram.percentile(95) / 1e6,
      p99Ms: histogram.percentile(99) / 1e6
    },
    games: Object.fromEntries([...games.entries()].map(([gameId, game]) => [gameId, { ...game }]))
  };
}

module.exports = { getGame, measure, recordTick, increment, snapshot };
