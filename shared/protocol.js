const CODES = Object.freeze({
  REQUEST_GAME: 0,
  GAME_ACCEPTED: 1,
  SPAWN_PHASE_STARTED: 2,
  SPAWN_POSITION_SUBMITTED: 10,
  GAME_REJECTED: 3,
  SPAWN_CONFIRMED: 4,
  SPAWN_REJECTED: 5,
  GAME_STARTED: 6,
  EXPANSION_REQUEST: 7,
  GAME_UPDATE: 8,
  EXPANSION_REJECTED: 9,
  BOAT_REJECTED: 12,
  CANCEL_EXPANSION: 11
});

function createMessage(code, requestId, payload) {
  return { code, requestId, payload };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { CODES, createMessage };
if (typeof window !== 'undefined') window.TerriProtocolCodes = CODES;