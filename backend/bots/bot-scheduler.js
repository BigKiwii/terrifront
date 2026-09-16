const GROUP_COUNT = 5;

class BotScheduler {
  constructor(random = Math.random) {
    this.random = random;
    this.groups = Array.from({ length: GROUP_COUNT }, () => []);
    this.groupIndexes = Array(GROUP_COUNT).fill(0);
    this.groupIndex = 0;
    this.botCount = 0;
  }

  rebuild(bots) {
    const shuffled = [...bots];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(this.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    this.groups = Array.from({ length: GROUP_COUNT }, () => []);
    shuffled.forEach((bot, index) => this.groups[index % GROUP_COUNT].push(bot));
    this.groupIndexes = Array(GROUP_COUNT).fill(0);
    this.groupIndex = Math.floor(this.random() * GROUP_COUNT);
    this.botCount = shuffled.length;
  }

  tick(tickCount) {
    if (this.botCount === 0) return;
    const botsPerTick = Math.max(3, Math.ceil(this.botCount / 20));
    for (let index = 0; index < botsPerTick; index += 1) this.nextBot()?.tick(tickCount);
  }

  nextBot() {
    for (let attempts = 0; attempts < GROUP_COUNT; attempts += 1) {
      const group = this.groups[this.groupIndex];
      const groupIndex = this.groupIndex;
      this.groupIndex = (this.groupIndex + 1) % GROUP_COUNT;
      if (group.length === 0) continue;
      const bot = group[this.groupIndexes[groupIndex] % group.length];
      this.groupIndexes[groupIndex] = (this.groupIndexes[groupIndex] + 1) % group.length;
      return bot;
    }
    return null;
  }
}

module.exports = BotScheduler;