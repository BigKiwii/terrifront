const BOT_NAMES = Array.from({ length: 220 }, (_, index) => `Bot ${String(index + 1).padStart(3, '0')}`);
const BOT_PROFILES = [
  { triggerChance: 8, cooldownTicks: 15, triggerRatio: 0.4, reserveRatio: 0.15, enemyBias: 0.6 },
  { triggerChance: 5, cooldownTicks: 30, triggerRatio: 0.6, reserveRatio: 0.3, enemyBias: 0.3 },
  { triggerChance: 3, cooldownTicks: 50, triggerRatio: 0.8, reserveRatio: 0.5, enemyBias: 0.1 }
];

class BotManager {
  constructor(map, territory, expansionManager, players) {
    this.map = map;
    this.territory = territory;
    this.expansionManager = expansionManager;
    this.players = players;
    this.botList = [];
    this.botSliceIndex = 0;
    this.botProfiles = new Map();
    this.botCooldowns = new Map();
  }

  tick(tickCount) {
    if (this.botList.length === 0) {
      this.botList = [...this.players.keys()].filter((playerId) => this.players.get(playerId)?.isBot);
    }
    const total = this.botList.length;
    if (total === 0) return;

    const botsPerTick = Math.min(10, total);
    for (let index = 0; index < botsPerTick; index += 1) {
      const playerId = this.botList[(this.botSliceIndex + index) % total];
      const player = this.players.get(playerId);
      if (player) this.tickBot(playerId, player, tickCount);
    }
    this.botSliceIndex = (this.botSliceIndex + botsPerTick) % total;
  }

  tickBot(playerId, player, tickCount) {
    if (!player.isBot || player.spawnPosition === null) return;
    if (!this.botProfiles.has(playerId)) {
      this.botProfiles.set(playerId, BOT_PROFILES[Math.floor(Math.random() * BOT_PROFILES.length)]);
    }
    const profile = this.botProfiles.get(playerId);
    if (!this.botCooldowns.has(playerId)) {
      this.botCooldowns.set(playerId, Math.floor(Math.random() * profile.cooldownTicks));
    }
    if (this.expansionManager.getActiveCount(playerId) >= 3) return;
    if (tickCount < this.botCooldowns.get(playerId)) return;
    if (Math.floor(Math.random() * 100) >= profile.triggerChance) return;
    this.botCooldowns.set(playerId, tickCount + profile.cooldownTicks);

    const ownerId = Number(playerId.replace('player-', ''));
    const maxTroops = player.cachedMaxTroops ?? 1000;
    if (player.troops < maxTroops * profile.triggerRatio) return;

    const targets = this.collectTargets(ownerId);
    let target = this.selectTarget(targets, profile.enemyBias);
    if (target === null) return;

    const reserve = Math.floor(maxTroops * profile.reserveRatio);
    const available = player.troops - reserve;
    if (available < 1) return;

    const power = Math.min(1000, Math.floor((available / Math.max(1, player.troops)) * 1000));
    this.expansionManager.start(playerId, power, target.position);
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

  selectTarget(targets, enemyBias) {
    if (targets.neutral.length > 0 && Math.random() >= enemyBias) {
      return { position: targets.neutral[Math.floor(Math.random() * targets.neutral.length)] };
    }
    if (targets.enemies.size > 0) {
      const owners = [...targets.enemies.keys()];
      const owner = owners[Math.floor(Math.random() * owners.length)];
      const positions = targets.enemies.get(owner);
      return { position: positions[Math.floor(Math.random() * positions.length)] };
    }
    if (targets.neutral.length > 0) {
      return { position: targets.neutral[Math.floor(Math.random() * targets.neutral.length)] };
    }
    return null;
  }

}

module.exports = { BotManager, BOT_NAMES };
