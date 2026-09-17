const { loadMap, cloneMap } = require('../game-logic/map-generator');
const SpawnManager = require('../game-logic/spawn-manager');
const TerritoryManager = require('../game-logic/territory-manager');
const ExpansionManager = require('../game-logic/expansion-manager');
const { BotManager } = require('../bots/bot-manager');
const BoatManager = require('../game-logic/boat-manager');
const {
  ECONOMY_TICKS_PER_SECOND,
  BOT_COUNT,
  BOT_TROOP_INCOME_MULTIPLIER
} = require('../../shared/game-rules');

class GameEngine {
  constructor(gameId, initialMap = null) {
    this.gameId = gameId;
    this.map = initialMap;
    this.players = new Map();
    this.phase = 'WAITING';
    this.spawnDeadline = null;
    this.spawnManager = null;
    this.territoryManager = null;
    this.expansionManager = null;
    this.boatManager = null;
    this.botManager = null;
    this.tickCount = 0;
    this.economyTickCount = 0;
    this.activeSince = null;
    this.winnerId = null;
  }

  async addPlayer(playerName, playerId = `player-${this.players.size + 1}`, isBot = false) {
    if (!this.map) this.map = cloneMap(await loadMap());
    if (!this.spawnManager) this.spawnManager = new SpawnManager(this.map);
    if (!this.territoryManager) this.territoryManager = new TerritoryManager(this.map);
    if (!this.expansionManager) this.expansionManager = new ExpansionManager(this.map, this.territoryManager, this.players);
    if (!this.boatManager) this.boatManager = new BoatManager(this.map, this.territoryManager, this.players, this.expansionManager);
    this.botManager?.invalidatePlayerCache();
    this.players.set(playerId, {
      playerId,
      name: playerName,
      troops: 0,
      spawnPosition: null,
      spawnCells: [],
      capitalColor: null,
      isBot,
      _sent: { troops: -1, territorySize: -1, flags: -1 }
    });

    return {
      gameId: this.gameId,
      playerId,
      playerName,
      map: this.map.serialize()
    };
  }

  startSpawnPhase(durationMs = 30000) {
    this.phase = 'SPAWNING';
    this.spawnDeadline = Date.now() + durationMs;
    const maxPlayers = Math.min(500, Math.max(8, BOT_COUNT));
    this.spawnManager.initialize(maxPlayers);
    return {
      gameId: this.gameId,
      phase: this.phase,
      durationMs,
      deadline: this.spawnDeadline,
      spawnPoints: this.spawnManager.getCandidates(),
      maxPlayers
    };
  }

  finalizeSpawnPhase() {
    if (this.phase !== 'SPAWNING') return;
    for (const player of this.players.values()) {
      if (player.spawnPosition === null) {
        const fallback = this.spawnManager.randomPosition();
        if (fallback !== null) this.selectSpawn(player.playerId, fallback);
      }
    }
    this.phase = 'ACTIVE';
    this.botManager = new BotManager(this.map, this.territoryManager, this.expansionManager, this.players, this.boatManager);
    this.startTicker();
    return this.getState();
  }

  releasePlayer(playerId) {
    this.spawnManager?.release(playerId);
  }

  submitSpawn(playerId, position) {
    const player = this.players.get(playerId);
    if (!player) return { accepted: false, reason: 'PLAYER_NOT_FOUND' };
    if (this.phase !== 'SPAWNING') return { accepted: false, reason: 'SPAWN_PHASE_CLOSED' };
    if (Date.now() > this.spawnDeadline + 1000) return { accepted: false, reason: 'SPAWN_DEADLINE_PASSED' };
    if (!Number.isInteger(position)) return { accepted: false, reason: 'INVALID_POSITION' };

    const previousCells = [...player.spawnCells];
    const selected = this.selectSpawn(playerId, position);
    if (!selected.accepted) return selected;
    return { accepted: true, playerId, position, color: player.capitalColor, clearedCells: previousCells, cells: selected.cells };
  }

  selectSpawn(playerId, position) {
    const player = this.players.get(playerId);
    if (!player) return { accepted: false, reason: 'PLAYER_NOT_FOUND' };
    const ownerId = Number(playerId.replace('player-', ''));
    const selected = this.spawnManager.select(playerId, position);
    if (selected.accepted) {
      if (player.spawnPosition !== null) {
        this.territoryManager.removeOwnerCells(ownerId, player.spawnCells);
      }
      player.spawnPosition = selected.position;
      player.spawnCells = selected.cells;
      this.commitSpawn(player, selected.cells);
    }
    return selected;
  }

  commitSpawn(player, cells = player.spawnCells) {
    const ownerId = Number(player.playerId.replace('player-', ''));
    cells.forEach((cell) => { this.map.owners[cell] = ownerId; });
    this.territoryManager.registerOwner(ownerId, cells);
    player.troops = Math.min(1000, this.getMaxTroops(player));
    player.cachedMaxTroops = player.troops;
    if (!player.capitalColor) player.capitalColor = this.createPlayerColor(player.playerId);
  }

  getMaxTroops(player) {
    return this.territoryManager.getTerritorySize(Number(player.playerId.replace('player-', ''))) * 100;
  }

  createPlayerColor(playerId) {
    if (this.players.get(playerId)?.isBot) return '#8b9298';
    const palette = [
      '#7ec48a', '#e8907a', '#85b4e0', '#d4bc6a',
      '#c49ad4', '#e8a0bc', '#6ec4bc', '#e0aa72'
    ];
    const playerNumber = Number(playerId.replace('player-', '')) || 1;
    return palette[(playerNumber - 1) % palette.length];
  }

  startTicker() {
    this.tickCount = 0;
    this.economyTickCount = 0;
    this.activeSince = Date.now();
  }

  tick(now = Date.now()) {
    if (this.phase !== 'ACTIVE') return null;
    if (this.winnerId) return null;
    this.tickCount += 1;
    const hadActiveAttacks = this.expansionManager.attacks.size > 0;
    this.botManager?.tick(this.tickCount);
    const changes = this.expansionManager.tick();
    for (const landing of this.boatManager.tick()) changes.push(landing);
    this.updateWinner();
    const economyTick = this.tickCount % ECONOMY_TICKS_PER_SECOND === 0;
    const attacksEnded = hadActiveAttacks && this.expansionManager.attacks.size === 0;
    if (economyTick) {
      this.economyTickCount += 1;
      this.collectIncome();
    }

    // Fast-exit: nothing happened this tick at all — no tile changes, no
    // economy update, no active boats or attacks that need a heartbeat.
    // Skip getTickState entirely; all of its work would produce an empty packet.
    if (
      changes.length === 0 &&
      !economyTick &&
      this.boatManager.boats.size === 0 &&
      this.expansionManager.attacks.size === 0 &&
      !attacksEnded
    ) return null;

    return this.getTickState(changes, economyTick, attacksEnded);
  }

  requestExpansion(playerId, position, power = 1000) {
    if (this.phase !== 'ACTIVE') return { accepted: false, reason: 'GAME_NOT_ACTIVE' };
    if (this.winnerId) return { accepted: false, reason: 'GAME_FINISHED' };
    if (!Number.isInteger(position) || position < 0 || position >= this.map.cellCount) return { accepted: false, reason: 'INVALID_POSITION' };
    if (!this.map.isLand(position)) return { accepted: false, reason: 'NOT_LAND' };
    const ownerId = Number(playerId.replace('player-', ''));
    if (this.map.owners[position] === ownerId) return { accepted: false, reason: 'ALREADY_OWNED' };
    return this.expansionManager.start(playerId, power, position);
  }

  // Explicit sea crossing, chosen from the map menu. Unlike an attack this does
  // not need a shared border, and the target may be neutral land.
  requestBoat(playerId, position, power = 1000) {
    if (this.phase !== 'ACTIVE') return { accepted: false, reason: 'GAME_NOT_ACTIVE' };
    if (this.winnerId) return { accepted: false, reason: 'GAME_FINISHED' };
    if (!Number.isInteger(position) || position < 0 || position >= this.map.cellCount) return { accepted: false, reason: 'INVALID_POSITION' };
    if (!this.map.isLand(position)) return { accepted: false, reason: 'NOT_LAND' };
    const ownerId = Number(playerId.replace('player-', ''));
    if (this.map.owners[position] === ownerId) return { accepted: false, reason: 'ALREADY_OWNED' };
    return this.boatManager.launch(playerId, power, position);
  }

  cancelExpansion(playerId) {
    this.expansionManager.cancel(playerId);
    this.boatManager.cancel(playerId);
  }

  cancelAttack(playerId, attackId) {
    return this.expansionManager.cancelAttack(playerId, attackId);
  }

  collectIncome() {
    for (const player of this.players.values()) {
      const ownerId = Number(player.playerId.replace('player-', ''));
      const tiles = this.territoryManager.getTerritorySize(ownerId);
      if (tiles === 0) continue;

      const maxTroops = this.getMaxTroops(player);
      player.cachedMaxTroops = maxTroops;
      const current = player.troops;
      const partA = Math.floor(tiles / 10);
      const exponent = 1 - Math.log(current + 1) / Math.LN2;
      const partB = Math.floor(Math.pow(3 / 5, exponent));
      const income = Math.max(1, partA + partB);
      const botMultiplier = player.isBot ? BOT_TROOP_INCOME_MULTIPLIER : 1;
      player.troops = Math.min(maxTroops, current + Math.max(1, Math.floor(income * botMultiplier)));
    }
  }

  updateWinner() {
    if (this.winnerId) return;
    const targetSize = this.map.conquerableTerrainCount * 0.85;
    for (const player of this.players.values()) {
      const ownerId = Number(player.playerId.replace('player-', ''));
      if (this.territoryManager.getTerritorySize(ownerId) < targetSize) continue;
      this.winnerId = player.playerId;
      this.expansionManager.stopAllAttacks();
      this.boatManager.stopAll();
      return;
    }
  }

  getState() {
    return {
      gameId: this.gameId,
      phase: this.phase,
      players: [...this.players.values()].map((player) => ({
        playerId: player.playerId,
        playerName: player.name,
        troops: player.troops,
        territorySize: this.territoryManager?.getTerritorySize(Number(player.playerId.replace('player-', ''))) || 0,
        expansionActive: this.expansionManager?.isActive(player.playerId) || this.boatManager?.getActiveCount(player.playerId) > 0 || false,
        spawnPosition: player.spawnPosition,
        capitalColor: player.capitalColor,
        isBot: player.isBot,
        isWinner: player.playerId === this.winnerId,
        isAlive: this.territoryManager.getTerritorySize(Number(player.playerId.replace('player-', ''))) > 0
      })),
      owners: [...this.map.owners],
      tickCount: this.tickCount,
      winnerId: this.winnerId,
      activeAttacks: this.expansionManager.getActiveAttacks(),
    };
  }

  getPlayerSnapshot(player) {
    const ownerId = Number(player.playerId.replace('player-', ''));
    const territorySize = this.territoryManager?.getTerritorySize(ownerId) || 0;
    const expansionActive = this.expansionManager?.isActive(player.playerId) || this.boatManager?.getActiveCount(player.playerId) > 0 || false;
    const isAlive = territorySize > 0;
    const isWinner = player.playerId === this.winnerId;
    const flags = (player.isBot ? 1 : 0) |
      (isAlive ? 2 : 0) |
      (isWinner ? 4 : 0) |
      (expansionActive ? 8 : 0);

    return {
      playerId: player.playerId,
      playerName: player.name,
      troops: player.troops,
      territorySize,
      expansionActive,
      isBot: player.isBot,
      isWinner,
      spawnPosition: player.spawnPosition,
      capitalColor: player.capitalColor,
      isAlive,
      flags
    };
  }

  getTickState(changes, economyTick = false, attacksEnded = false) {
    // Only iterate players when something could have made them dirty:
    // tile changes (captures alter territorySize), economy ticks (troops change),
    // or a winner being decided this tick (flags change).
    const playersDirty = changes.length > 0 || economyTick || this.winnerId !== null;
    let players = null;

    if (playersDirty) {
      for (const player of this.players.values()) {
        const snapshot = this.getPlayerSnapshot(player);
        const previous = player._sent || { troops: -1, territorySize: -1, flags: -1 };
        if (
          snapshot.troops !== previous.troops ||
          snapshot.territorySize !== previous.territorySize ||
          snapshot.flags !== previous.flags
        ) {
          if (players === null) players = [];
          players.push({
            playerId: snapshot.playerId,
            playerName: snapshot.playerName,
            troops: snapshot.troops,
            territorySize: snapshot.territorySize,
            expansionActive: snapshot.expansionActive,
            isBot: snapshot.isBot,
            isWinner: snapshot.isWinner,
            spawnPosition: snapshot.spawnPosition,
            capitalColor: snapshot.capitalColor,
            isAlive: snapshot.isAlive
          });
          player._sent = {
            troops: snapshot.troops,
            territorySize: snapshot.territorySize,
            flags: snapshot.flags
          };
        }
      }
    }

    // If nothing is dirty at all — no tile changes, no dirty players, no winner
    // flip — and we only arrived here because boats/attacks need a heartbeat,
    // skip the packet entirely rather than sending empty noise.
    const hasBoats = this.boatManager.boats.size > 0;
    const hasAttacks = this.expansionManager.attacks.size > 0;
    if (
      changes.length === 0 &&
      (players === null || players.length === 0) &&
      !this.winnerId &&
      !hasBoats &&
      !hasAttacks &&
      !attacksEnded
    ) return null;

    // serialize() and getActiveAttacks() only run when we know a packet is
    // going out. Both allocate arrays, so guarding them matters on quiet ticks
    // where only boats/attacks are active but no tiles changed.
    const boats = hasBoats ? this.boatManager.serialize() : [];
    const activeAttacks = hasAttacks ? this.expansionManager.getActiveAttacks() : [];

    return {
      gameId: this.gameId,
      tickCount: this.tickCount,
      changes,
      players: players ?? [],
      boats,
      activeAttacks,
      winnerId: this.winnerId
    };
  }
}

module.exports = GameEngine;