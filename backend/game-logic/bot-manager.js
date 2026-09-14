const BOT_NAMES = Array.from({ length: 250 }, (_, index) => `Bot ${String(index + 1).padStart(3, '0')}`);
const BOT_MIN_ACTION_INTERVAL = 22;
const BOT_MAX_ACTION_INTERVAL = 46;
const BOT_MIN_TRIGGER_CHANCE = 68;
const BOT_MAX_TRIGGER_CHANCE = 96;
const BOT_MIN_TRIGGER_RATIO = 0.38;
const BOT_MAX_TRIGGER_RATIO = 0.58;
const BOT_MIN_RESERVE_RATIO = 0.25;
const BOT_MAX_RESERVE_RATIO = 0.4;

class BotManager {
  constructor(map, territory, expansionManager, players) {
    this.map = map;
    this.territory = territory;
    this.expansionManager = expansionManager;
    this.players = players;
    this.botList = [];
    this.botProfiles = new Map();
  }

  tick(tickCount) {
    if (this.botList.length === 0) {
      this.botList = [...this.players.keys()].filter((playerId) => this.players.get(playerId)?.isBot);
    }
    const total = this.botList.length;
    if (total === 0) return;

    for (const playerId of this.botList) {
      const player = this.players.get(playerId);
      if (player) this.tickBot(playerId, player, tickCount);
    }
  }

  tickBot(playerId, player, tickCount) {
    if (!player.isBot || player.spawnPosition === null) return;
    const profile = this.getProfile(playerId, tickCount);
    if (this.expansionManager.getActiveCount(playerId) >= 3) return;
    if (tickCount < profile.nextActionTick) return;
    if (Math.random() * 100 >= profile.triggerChance) {
      profile.nextActionTick = tickCount + this.randomInterval(profile);
      return;
    }

    const ownerId = Number(playerId.replace('player-', ''));
    const maxTroops = player.cachedMaxTroops ?? 1000;
    if (player.troops < maxTroops * profile.triggerRatio) return;

    const targets = this.collectTargets(ownerId);
    const target = this.selectTarget(targets);
    if (target === null) return;
    if (target.ownerId === 0 && this.expansionManager.hasActiveTarget(playerId, 0)) return;

    const reserve = Math.floor(maxTroops * profile.reserveRatio);
    const available = player.troops - reserve;
    if (available < 1) {
      profile.nextActionTick = tickCount + this.randomInterval(profile);
      return;
    }

    const power = Math.min(1000, Math.floor((available / Math.max(1, player.troops)) * 1000));
    const result = this.expansionManager.start(playerId, power, target.position);
    profile.nextActionTick = tickCount + this.randomInterval(profile);
  }

  getProfile(playerId, tickCount) {
    let profile = this.botProfiles.get(playerId);
    if (profile) return profile;
    profile = {
      triggerChance: BOT_MIN_TRIGGER_CHANCE + Math.random() * (BOT_MAX_TRIGGER_CHANCE - BOT_MIN_TRIGGER_CHANCE),
      triggerRatio: BOT_MIN_TRIGGER_RATIO + Math.random() * (BOT_MAX_TRIGGER_RATIO - BOT_MIN_TRIGGER_RATIO),
      reserveRatio: BOT_MIN_RESERVE_RATIO + Math.random() * (BOT_MAX_RESERVE_RATIO - BOT_MIN_RESERVE_RATIO),
      actionInterval: BOT_MIN_ACTION_INTERVAL + Math.random() * (BOT_MAX_ACTION_INTERVAL - BOT_MIN_ACTION_INTERVAL),
      nextActionTick: tickCount + Math.floor(Math.random() * BOT_MAX_ACTION_INTERVAL)
    };
    this.botProfiles.set(playerId, profile);
    return profile;
  }

  randomInterval(profile) {
    const jitter = (Math.random() - 0.5) * 10;
    return Math.max(BOT_MIN_ACTION_INTERVAL, Math.round(profile.actionInterval + jitter));
  }

  collectTargets(ownerId) {
    const neutral = [];
    const enemies = new Map();
    for (const border of this.territory.getBorderSet(ownerId)) {
      for (const neighbor of this.map.getNeighbors(border)) {
        if (!this.map.isLand(neighbor)) continue;
        const targetOwner = this.map.owners[neighbor] || 0;
        if (targetOwner === ownerId) continue;
        if (targetOwner === 0) {
          neutral.push(neighbor);
          continue;
        }
        if (!enemies.has(targetOwner)) enemies.set(targetOwner, []);
        enemies.get(targetOwner).push(neighbor);
      }
    }
    return { neutral, enemies };
  }

  selectTarget(targets) {
    if (targets.neutral.length > 0) {
      return { position: targets.neutral[Math.floor(Math.random() * targets.neutral.length)], ownerId: 0 };
    }
    if (targets.enemies.size > 0) {
      const owners = [...targets.enemies.keys()];
      const owner = owners[Math.floor(Math.random() * owners.length)];
      const positions = targets.enemies.get(owner);
      return { position: positions[Math.floor(Math.random() * positions.length)], ownerId: owner };
    }
    return null;
  }

}

module.exports = { BotManager, BOT_NAMES };
