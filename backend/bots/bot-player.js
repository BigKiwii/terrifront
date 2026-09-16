const BotBrain = require('./bot-brain');

class BotPlayer {
  constructor(playerId, player, dependencies, random = Math.random) {
    this.playerId = playerId;
    this.player = player;
    this.territory = dependencies.territory;
    this.ownerId = Number(playerId.replace('player-', ''));
    this.random = random;
    this.expansionManager = dependencies.expansionManager;
    this.triggerSeed = Math.floor(random() * 100);
    this.randomTriggerChance = this.triggerSeed < 3
      ? null
      : this.triggerSeed < 10
        ? this.triggerSeed
        : Math.max(1, this.triggerSeed % 10);
    this.interval = this.triggerSeed < 3 ? 5 : this.triggerSeed < 10 ? null : this.triggerSeed + 10;
    this.nextIntervalTick = this.interval === null
      ? Infinity
      : this.triggerSeed < 3 ? Math.floor(random() * 5) : Math.floor(random() * this.triggerSeed);
    this.cooldown = 1 + Math.floor(random() * 20);
    this.nextActionTick = 0;
    this.brain = new BotBrain(this, { ...dependencies, players: dependencies.players }, random);
  }

  tick(tickCount) {
    if (!this.player.isBot || this.player.spawnPosition === null || this.territory.getTerritorySize(this.ownerId) === 0) return false;
    if (!this.shouldTrigger(tickCount) || tickCount < this.nextActionTick) return false;
    this.nextActionTick = tickCount + this.cooldown;
    return this.brain.think(tickCount);
  }

  shouldTrigger(tickCount) {
    let triggered = false;
    if (this.interval !== null && tickCount >= this.nextIntervalTick) {
      triggered = true;
      this.nextIntervalTick = tickCount + this.interval;
    }
    if (this.randomTriggerChance !== null && this.random() * 100 < this.randomTriggerChance) triggered = true;
    return triggered;
  }
}

module.exports = { BotPlayer, BOT_NAMES: Array.from({ length: 250 }, (_, index) => `Bot ${String(index + 1).padStart(3, '0')}`) };
