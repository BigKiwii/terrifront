const GameEngine = require('./game-engine');
const { BOT_NAMES } = require('../game-logic/bot-manager');
const { BOT_COUNT } = require('../../shared/game-rules');

class GameMaster {
  constructor() {
    this.games = new Map();
    this.players = new Map();
    this.nextGameNumber = 1;
    this.nextPlayerNumber = 1;
    this.tickHandle = null;
  }

  async requestGame(playerName) {
    const gameId = `game-${this.nextGameNumber++}`;
    const engine = new GameEngine(gameId);
    this.games.set(gameId, engine);
    const playerId = `player-${this.nextPlayerNumber++}`;
    const game = await engine.addPlayer(playerName, playerId);
    this.players.set(game.playerId, { gameId, engine });
    const spawnPhase = engine.startSpawnPhase();
    return { game, spawnPhase };
  }

  finalizeGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return null;
    return game.finalizeSpawnPhase();
  }

  async addBot(gameId, botName) {
    const engine = this.games.get(gameId);
    if (!engine || engine.phase !== 'ACTIVE') return null;
    const playerId = `player-${this.nextPlayerNumber++}`;
    await engine.addPlayer(botName, playerId, true);
    this.players.set(playerId, { gameId, engine });
    return playerId;
  }

  async populateBots(gameId, count = BOT_COUNT) {
    const engine = this.games.get(gameId);
    if (!engine || engine.phase !== 'ACTIVE') return null;
    const names = BOT_NAMES.slice(0, count);
    const candidates = engine.spawnManager.getCandidates();
    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
    }
    let candidateIndex = 0;
    for (const name of names) {
      const playerId = await this.addBot(gameId, name);
      if (!playerId) continue;
      let position = null;
      while (candidateIndex < candidates.length) {
        const candidate = candidates[candidateIndex++];
        const cells = engine.map.getCapitalCells(candidate);
        if (cells.length === 21 && cells.every((cell) => engine.map.owners[cell] === 0)) {
          position = candidate;
          break;
        }
      }
      if (position === null) position = engine.spawnManager.randomPosition();
      if (position === null) continue;
      const selected = engine.selectSpawn(playerId, position);
      if (selected.accepted) engine.players.get(playerId).capitalColor = engine.createPlayerColor(playerId);
    }
    return engine.getState();
  }

  removeGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return false;
    this.games.delete(gameId);
    for (const [playerId, player] of this.players) {
      if (player.gameId === gameId) {
        if (game.phase === 'SPAWNING') player.engine.releasePlayer(playerId);
        this.players.delete(playerId);
      }
    }
    return true;
  }

  tick() {
    const updates = [];
    for (const game of this.games.values()) {
      const update = game.tick();
      if (update) updates.push(update);
    }
    return updates;
  }

  requestExpansion(playerId, position, power = 1000) {
    const player = this.players.get(playerId);
    if (!player) return { accepted: false, reason: 'PLAYER_NOT_FOUND' };
    return player.engine.requestExpansion(playerId, position, power);
  }

  requestBoat(playerId, position, power = 1000) {
    const player = this.players.get(playerId);
    if (!player) return { accepted: false, reason: 'PLAYER_NOT_FOUND' };
    return player.engine.requestBoat(playerId, position, power);
  }

  startTicker(onUpdate) {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => {
      for (const update of this.tick()) onUpdate(update);
    }, 50);
  }

  stopTicker() {
    clearInterval(this.tickHandle);
    this.tickHandle = null;
  }

  submitSpawn(playerId, position) {
    const player = this.players.get(playerId);
    if (!player) return { accepted: false, reason: 'PLAYER_NOT_FOUND' };
    return player.engine.submitSpawn(playerId, position);
  }
}

module.exports = GameMaster;