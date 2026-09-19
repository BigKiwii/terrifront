const TROOPS_PER_TERRITORY = 4;
const SIMULATION_TICK_MS = 50;
const ECONOMY_TICKS_PER_SECOND = 10;
const ECONOMY_CYCLE_SECONDS = 10;
const NAME_DISPLAY_TERRITORY = 50;
const BOT_COUNT = 230;
const BOT_TROOP_INCOME_MULTIPLIER = 0.65;

// Boating: troops ferried across water lose strength every tick, so long
// crossings cost far more than short hops between neighbouring coasts.
const BOAT_TILES_PER_TICK = 0.6;            // 40% slower than the original speed
const BOAT_DECAY_PER_TICK = 0.004;          // ~7.7% of the cargo per second
const BOAT_MIN_TROOPS = 1;                  // below this the crossing is lost
const BOAT_MAX_SEARCH_CELLS = 50000;        // bound on the water pathfind; 50k is ample for any crossing on this map
const BOAT_MAX_FRONT_TILES = 20000;         // bound on the beachhead front search

module.exports = {
  TROOPS_PER_TERRITORY,
  SIMULATION_TICK_MS,
  ECONOMY_TICKS_PER_SECOND,
  ECONOMY_CYCLE_SECONDS,
  NAME_DISPLAY_TERRITORY,
  BOT_COUNT,
  BOT_TROOP_INCOME_MULTIPLIER,
  BOAT_TILES_PER_TICK,
  BOAT_DECAY_PER_TICK,
  BOAT_MIN_TROOPS,
  BOAT_MAX_SEARCH_CELLS,
  BOAT_MAX_FRONT_TILES
};
