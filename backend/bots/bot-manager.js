const { BotPlayer, BOT_NAMES } = require('./bot-player');
const BotScheduler = require('./bot-scheduler');
const BotTickCache = require('./bot-tick-cache');

class BotManager {
  constructor(map, territory, expansionManager, players, boatManager = null) {
    this.map = map;
    this.territory = territory;
    this.expansionManager = expansionManager;
    this.boatManager = boatManager;
    this.players = players;
    this.botList = [];
    this.botListValid = false;
    this.bots = new Map();
    this.scheduler = new BotScheduler();
    this.tickCache = new BotTickCache();
  }

  tick(tickCount) {
    this.refreshBotList();
    this.tickCache.reset(tickCount);
    this.scheduler.tick(tickCount);
  }

  refreshBotList() {
    if (this.botListValid) return;
    const activeBotIds = new Set();
    const nextBotList = [];
    for (const [playerId, player] of this.players) {
      if (!player.isBot) continue;
      activeBotIds.add(playerId);
      let bot = this.bots.get(playerId);
      if (!bot) {
        bot = new BotPlayer(playerId, player, {
          map: this.map,
          territory: this.territory,
          expansionManager: this.expansionManager,
          boatManager: this.boatManager,
          players: this.players,
          tickCache: this.tickCache
        });
        this.bots.set(playerId, bot);
      }
      nextBotList.push(bot);
    }
    for (const playerId of this.bots.keys()) {
      if (!activeBotIds.has(playerId)) this.bots.delete(playerId);
    }

    const botSetChanged = nextBotList.length !== this.botList.length ||
      nextBotList.some((bot, index) => bot !== this.botList[index]);
    this.botList = nextBotList;
    if (botSetChanged) {
      this.scheduler.rebuild(this.botList);
    }
    this.botListValid = true;
  }

  invalidatePlayerCache() {
    this.botListValid = false;
  }
}

module.exports = { BotManager, BOT_NAMES };
