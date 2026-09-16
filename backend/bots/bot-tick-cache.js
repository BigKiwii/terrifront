class BotTickCache {
  constructor() {
    this.tick = -1;
    this.neutralTargets = new Map();
    this.activeAttackers = null;
  }

  reset(tickCount) {
    if (this.tick === tickCount) return;
    this.tick = tickCount;
    this.neutralTargets.clear();
    this.activeAttackers = null;
  }
}

module.exports = BotTickCache;
