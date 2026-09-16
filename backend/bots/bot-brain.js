const NeutralExpansionStrategy = require('./neutral-expansion-strategy');
const NeighbourAttackStrategy = require('./neighbour-attack-strategy');
const BoatAttackStrategy = require('./boat-attack-strategy');

class BotBrain {
  constructor(bot, dependencies, random = Math.random) {
    this.bot = bot;
    this.random = random;
    this.state = 'HUNGRY_FOR_NEUTRAL';
    this.neutralStrategy = new NeutralExpansionStrategy(
      dependencies.map,
      dependencies.territory,
      dependencies.expansionManager,
      random
    );
    this.neighbourStrategy = new NeighbourAttackStrategy(
      dependencies.map,
      dependencies.territory,
      dependencies.expansionManager,
      dependencies.players,
      random
    );
    this.boatStrategy = new BoatAttackStrategy(
      dependencies.map,
      dependencies.territory,
      dependencies.boatManager,
      random
    );
  }

  think(tickCount) {
    if (this.bot.territory.getTerritorySize(this.bot.ownerId) === 0) {
      this.state = 'ELIMINATED';
      return false;
    }

    if (this.neutralStrategy.hasActiveAttack(this.bot.playerId)) {
      this.state = 'HUNGRY_FOR_NEUTRAL';
      return this.neutralStrategy.execute(this.bot);
    }
    const neutralTarget = this.neutralStrategy.findTarget(this.bot.ownerId);
    if (neutralTarget !== null) {
      this.state = 'HUNGRY_FOR_NEUTRAL';
      const result = this.neutralStrategy.execute(this.bot, neutralTarget);
      return result;
    }

    this.state = 'ATTACK_NEIGHBOUR';
    if (this.neighbourStrategy.execute(this.bot)) return true;
    return this.boatStrategy.execute(this.bot);
  }
}

module.exports = BotBrain;
