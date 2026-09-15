const OP = Object.freeze({
  GAME_ACCEPTED: 0x01,
  SPAWN_PHASE_STARTED: 0x02,
  SPAWN_CONFIRMED: 0x03,
  SPAWN_REJECTED: 0x04,
  GAME_REJECTED: 0x05,
  GAME_STARTED: 0x06,
  GAME_UPDATE: 0x07,
  EXPANSION_REJECTED: 0x08,
  BOAT_REJECTED: 0x09,
  LOBBY_STATE: 0x0a,
  LOBBY_REJECTED: 0x0b,
  REQUEST_GAME: 0x10,
  SPAWN_POSITION: 0x11,
  EXPANSION_REQUEST: 0x12,
  CANCEL_EXPANSION: 0x13,
  BOAT_REQUEST: 0x14,
  LEAVE_LOBBY: 0x15,
  REQUEST_LOBBY: 0x16,
  JOIN_LOBBY: 0x17
});

const REASON = Object.freeze({
  INVALID_JSON: 0,
  INVALID_GAME_REQUEST: 1,
  INVALID_PLAYER_NAME: 2,
  MAP_LOAD_FAILED: 3,
  PLAYER_NOT_FOUND: 4,
  SPAWN_PHASE_CLOSED: 5,
  SPAWN_DEADLINE_PASSED: 6,
  INVALID_POSITION: 7,
  SPAWN_LOCATION_OCCUPIED: 8,
  INVALID_SPAWN_LOCATION: 9,
  GAME_NOT_ACTIVE: 10,
  GAME_FINISHED: 11,
  NOT_LAND: 12,
  ALREADY_OWNED: 13,
  NO_BORDER_TERRITORY: 14,
  NOT_ENOUGH_TROOPS: 15,
  EXPANSION_NOT_FOUND: 16,
  NO_WATER_ROUTE: 17,
  LOBBY_FULL: 18,
  SESSION_ACTIVE: 19
});

const REASON_NAMES = Object.keys(REASON);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_PLAYER_ID = 0xffff;

class BinaryWriter {
  constructor(initialSize = 256) {
    this.buffer = new Uint8Array(initialSize);
    this.view = new DataView(this.buffer.buffer);
    this.position = 0;
  }

  grow(size) {
    if (this.position + size <= this.buffer.length) return;
    const next = new Uint8Array(Math.max(this.buffer.length * 2, this.position + size));
    next.set(this.buffer);
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }

  u8(value) { this.grow(1); this.view.setUint8(this.position, value); this.position += 1; }
  u16(value) {
    if (value < 0 || value > MAX_PLAYER_ID) throw new Error(`Value ${value} exceeds binary u16 range`);
    this.grow(2);
    this.view.setUint16(this.position, value, false);
    this.position += 2;
  }
  u24(value) {
    if (value < 0 || value > 0xffffff) throw new Error(`Value ${value} exceeds binary u24 range`);
    this.grow(3);
    this.view.setUint8(this.position, (value >>> 16) & 0xff);
    this.view.setUint8(this.position + 1, (value >>> 8) & 0xff);
    this.view.setUint8(this.position + 2, value & 0xff);
    this.position += 3;
  }
  u32(value) { this.grow(4); this.view.setUint32(this.position, value >>> 0, false); this.position += 4; }

  string(value) {
    const bytes = textEncoder.encode(String(value));
    if (bytes.length > 255) throw new Error('Binary protocol strings cannot exceed 255 bytes');
    this.u8(bytes.length);
    this.grow(bytes.length);
    this.buffer.set(bytes, this.position);
    this.position += bytes.length;
  }

  color(value) {
    const match = String(value || '').match(/^#([0-9a-f]{6})$/i);
    const number = match ? parseInt(match[1], 16) : 0x888888;
    this.u8((number >> 16) & 0xff);
    this.u8((number >> 8) & 0xff);
    this.u8(number & 0xff);
  }

  finish() { return this.buffer.slice(0, this.position); }
}

class BinaryReader {
  constructor(value) {
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : value instanceof Uint8Array
        ? value
        : new Uint8Array(value);
    this.buffer = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.position = 0;
  }

  ensure(size) {
    if (this.position + size > this.buffer.length) throw new Error('Truncated binary protocol message');
  }

  u8() { this.ensure(1); const value = this.view.getUint8(this.position); this.position += 1; return value; }
  u16() { this.ensure(2); const value = this.view.getUint16(this.position, false); this.position += 2; return value; }
  u24() { this.ensure(3); const value = (this.view.getUint8(this.position) << 16) | (this.view.getUint8(this.position + 1) << 8) | this.view.getUint8(this.position + 2); this.position += 3; return value; }
  u32() { this.ensure(4); const value = this.view.getUint32(this.position, false); this.position += 4; return value; }

  string() {
    const length = this.u8();
    this.ensure(length);
    const value = textDecoder.decode(this.buffer.subarray(this.position, this.position + length));
    this.position += length;
    return value;
  }

  color() {
    return `#${this.u8().toString(16).padStart(2, '0')}${this.u8().toString(16).padStart(2, '0')}${this.u8().toString(16).padStart(2, '0')}`;
  }
}

function playerNumber(playerId) {
  return Number(String(playerId).replace('player-', '')) || 0;
}

function playerFlags(player) {
  return (player.isBot ? 1 : 0) |
    (player.isAlive !== false ? 2 : 0) |
    (player.isWinner ? 4 : 0) |
    (player.expansionActive ? 8 : 0);
}

function boundedU24(value) {
  return Math.min(0xffffff, Math.max(0, Math.floor(Number(value) || 0)));
}

function writePlayer(writer, player, includeDetails) {
  writer.u16(playerNumber(player.playerId));
  if (includeDetails) writer.string(player.playerName || '');
  writer.u24(boundedU24(player.troops));
  writer.u24(boundedU24(player.territorySize));
  if (includeDetails) {
    writer.color(player.capitalColor);
    writer.u32(player.spawnPosition == null ? 0xffffffff : player.spawnPosition);
  }
  writer.u8(playerFlags(player));
}

function readPlayer(reader, includeDetails) {
  const playerId = `player-${reader.u16()}`;
  const player = { playerId };
  if (includeDetails) player.playerName = reader.string();
  player.troops = reader.u24();
  player.territorySize = reader.u24();
  if (includeDetails) {
    player.capitalColor = reader.color();
    const spawnPosition = reader.u32();
    player.spawnPosition = spawnPosition === 0xffffffff ? null : spawnPosition;
  }
  const flags = reader.u8();
  player.isBot = Boolean(flags & 1);
  player.isAlive = Boolean(flags & 2);
  player.isWinner = Boolean(flags & 4);
  player.expansionActive = Boolean(flags & 8);
  return player;
}

function writeChanges(writer, changes) {
  writer.u32(changes.length);
  for (const change of changes) {
    writer.u32(change.position);
    writer.u16(change.owner);
  }
}

function readChanges(reader) {
  const changes = [];
  for (let index = 0, count = reader.u32(); index < count; index += 1) {
    changes.push({ position: reader.u32(), owner: reader.u16() });
  }
  return changes;
}

function encodeGameAccepted(game) {
  const writer = new BinaryWriter(128);
  writer.u8(OP.GAME_ACCEPTED);
  writer.string(game.playerId);
  writer.string(game.playerName);
  writer.u16(game.map.width);
  writer.u16(game.map.height);
  writer.string(game.map.terrainUrl);
  writer.string(game.map.expansionTimesUrl || '');
  return writer.finish();
}

function encodeLobbyState(state, playerId) {
  const writer = new BinaryWriter(128 + state.players.length * 32);
  writer.u8(OP.LOBBY_STATE);
  writer.string(state.lobbyId);
  writer.string(playerId || '');
  writer.u32(Math.max(0, state.deadline - Date.now()));
  writer.u16(state.players.length);
  writer.u16(state.maxPlayers);
  for (const player of state.players) {
    writer.u16(playerNumber(player.playerId));
    writer.string(player.playerName);
    writer.u8(player.ready ? 1 : 0);
  }
  return writer.finish();
}

function encodeSpawnPhaseStarted(playerId, phase, state = null) {
  const ownedCells = state
    ? Array.from(state.owners || [], (owner, position) => ({ position, owner })).filter((change) => change.owner !== 0)
    : [];
  const writer = new BinaryWriter(32 + phase.spawnPoints.length * 4 + ownedCells.length * 6);
  writer.u8(OP.SPAWN_PHASE_STARTED);
  writer.string(playerId);
  writer.u32(Math.max(0, phase.deadline - Date.now()));
  writer.u32(phase.durationMs);
  writer.u32(phase.spawnPoints.length);
  for (const point of phase.spawnPoints) writer.u32(point);
  writer.u16(state?.players?.length || 0);
  for (const player of state?.players || []) writePlayer(writer, player, true);
  writeChanges(writer, ownedCells);
  return writer.finish();
}

function encodeSpawnConfirmed(result) {
  const writer = new BinaryWriter(32 + result.cells.length * 4 + (result.clearedCells?.length || 0) * 4);
  writer.u8(OP.SPAWN_CONFIRMED);
  writer.string(result.playerId || '');
  writer.u32(result.position);
  writer.color(result.color);
  writer.u32(result.clearedCells?.length || 0);
  for (const cell of result.clearedCells || []) writer.u32(cell);
  writer.u32(result.cells.length);
  for (const cell of result.cells) writer.u32(cell);
  return writer.finish();
}

function encodeRejected(opcode, reason) {
  const writer = new BinaryWriter(2);
  writer.u8(opcode);
  writer.u8(REASON[reason] ?? REASON.INVALID_GAME_REQUEST);
  return writer.finish();
}

function encodeGameStarted(state) {
  const ownedCells = state.changes?.length
    ? state.changes
    : Array.from(state.owners || [], (owner, position) => ({ position, owner }))
      .filter((change) => change.owner !== 0);
  const writer = new BinaryWriter(512 + state.players.length * 64 + ownedCells.length * 6);
  writer.u8(OP.GAME_STARTED);
  writer.u16(state.players.length);
  for (const player of state.players) writePlayer(writer, player, true);
  writeChanges(writer, ownedCells);
  writer.u16(state.winnerId ? playerNumber(state.winnerId) : 0);
  return writer.finish();
}

function writeActiveAttacks(writer, attacks) {
  writer.u16(attacks.length);
  for (const attack of attacks) {
    writer.u32(attack.id);
    writer.u16(playerNumber(attack.playerId));
    writer.u16(attack.targetOwnerId || 0);
    writer.u24(boundedU24(attack.troops));
  }
}

function readActiveAttacks(reader) {
  const attacks = [];
  for (let index = 0, count = reader.u16(); index < count; index += 1) {
    attacks.push({ id: reader.u32(), playerId: `player-${reader.u16()}`, targetOwnerId: reader.u16(), troops: reader.u24() });
  }
  return attacks;
}

function encodeGameUpdate(state) {
  const boats = state.boats || [];
  const writer = new BinaryWriter(32 + state.changes.length * 6 + state.players.length * 17 + boats.length * 10);
  writer.u8(OP.GAME_UPDATE);
  writer.u32(state.tickCount);
  let flags = 0;
  if (state.changes.length) flags |= 1;
  if (state.players.length) flags |= 2;
  if (state.winnerId) flags |= 4;
  if (boats.length) flags |= 8;
  flags |= 16;
  writer.u8(flags);
  if (state.changes.length) writeChanges(writer, state.changes);
  if (state.players.length) {
    writer.u16(state.players.length);
    for (const player of state.players) writePlayer(writer, player, false);
  }
  if (state.winnerId) writer.u16(playerNumber(state.winnerId));
  if (boats.length) {
    writer.u16(boats.length);
    for (const boat of boats) {
      writer.u16(boat.ownerId);
      writer.u32(boat.position);
      writer.u16(boat.troops || 0);
    }
  }
  if (flags & 16) writeActiveAttacks(writer, state.activeAttacks || []);
  return writer.finish();
}

function decodeServerMessage(value) {
  const reader = new BinaryReader(value);
  const opcode = reader.u8();
  if (opcode === OP.GAME_ACCEPTED) {
    const playerId = reader.string();
    const playerName = reader.string();
    const width = reader.u16();
    const height = reader.u16();
    const terrainUrl = reader.string();
    const expansionTimesUrl = reader.string();
    return { opcode, payload: { playerId, playerName, map: { width, height, terrainUrl, expansionTimesUrl } } };
  }
  if (opcode === OP.SPAWN_PHASE_STARTED) {
    const playerId = reader.string();
    const deadline = Date.now() + reader.u32();
    const durationMs = reader.u32();
    const spawnPoints = [];
    for (let index = 0, count = reader.u32(); index < count; index += 1) spawnPoints.push(reader.u32());
    const players = [];
    for (let index = 0, count = reader.u16(); index < count; index += 1) players.push(readPlayer(reader, true));
    const changes = readChanges(reader);
    return { opcode, payload: { playerId, deadline, durationMs, spawnPoints, players, changes } };
  }
  if (opcode === OP.SPAWN_CONFIRMED) {
    const confirmedPlayerId = reader.string();
    const position = reader.u32();
    const color = reader.color();
    const clearedCells = [];
    for (let index = 0, count = reader.u32(); index < count; index += 1) clearedCells.push(reader.u32());
    const cells = [];
    for (let index = 0, count = reader.u32(); index < count; index += 1) cells.push(reader.u32());
    return { opcode, payload: { accepted: true, playerId: confirmedPlayerId, position, color, clearedCells, cells } };
  }
  if (opcode === OP.GAME_REJECTED || opcode === OP.SPAWN_REJECTED || opcode === OP.EXPANSION_REJECTED || opcode === OP.BOAT_REJECTED || opcode === OP.LOBBY_REJECTED) {
    const reason = REASON_NAMES[reader.u8()] || 'INVALID_GAME_REQUEST';
    return { opcode, payload: { reason } };
  }
  if (opcode === OP.LOBBY_STATE) {
    const lobbyId = reader.string();
    const playerId = reader.string();
    const deadline = Date.now() + reader.u32();
    const players = [];
    const count = reader.u16();
    const maxPlayers = reader.u16();
    for (let index = 0; index < count; index += 1) {
      players.push({
        playerId: `player-${reader.u16()}`,
        playerName: reader.string(),
        ready: Boolean(reader.u8())
      });
    }
    return { opcode, payload: { lobbyId, playerId, deadline, players, maxPlayers } };
  }
  if (opcode === OP.GAME_STARTED) {
    const players = [];
    for (let index = 0, count = reader.u16(); index < count; index += 1) players.push(readPlayer(reader, true));
    const changes = readChanges(reader);
    const winnerNumber = reader.u16();
    const winnerId = winnerNumber ? `player-${winnerNumber}` : null;
    return { opcode, payload: { players, changes, winnerId, activeAttacks: [] } };
  }
  if (opcode === OP.GAME_UPDATE) {
    const tickCount = reader.u32();
    const flags = reader.u8();
    const changes = flags & 1 ? readChanges(reader) : [];
    const players = [];
    if (flags & 2) for (let index = 0, count = reader.u16(); index < count; index += 1) players.push(readPlayer(reader, false));
    const winnerId = flags & 4 ? `player-${reader.u16()}` : null;
    const boats = [];
    if (flags & 8) {
      for (let index = 0, count = reader.u16(); index < count; index += 1) {
        boats.push({ ownerId: reader.u16(), position: reader.u32(), troops: reader.u16() });
      }
    }
    const activeAttacks = flags & 16 ? readActiveAttacks(reader) : [];
    return { opcode, payload: { tickCount, changes, players, winnerId, boats, activeAttacks } };
  }
  throw new Error(`Unknown binary protocol opcode: ${opcode}`);
}

function decodeClientMessage(value) {
  const reader = new BinaryReader(value);
  if (reader.buffer.length === 1 && reader.buffer[0] === OP.REQUEST_LOBBY) return { opcode: OP.REQUEST_LOBBY };
  const opcode = reader.u8();
  if (opcode === OP.REQUEST_GAME) return { opcode, playerName: reader.string() };
  if (opcode === OP.JOIN_LOBBY) return { opcode, playerName: reader.string() };
  if (opcode === OP.SPAWN_POSITION) return { opcode, playerId: `player-${reader.u16()}`, position: reader.u32() };
  if (opcode === OP.EXPANSION_REQUEST) return { opcode, playerId: `player-${reader.u16()}`, position: reader.u32(), power: reader.u16() };
  if (opcode === OP.CANCEL_EXPANSION) return { opcode, playerId: `player-${reader.u16()}`, attackId: reader.u32() };
  if (opcode === OP.BOAT_REQUEST) return { opcode, playerId: `player-${reader.u16()}`, position: reader.u32(), power: reader.u16() };
  if (opcode === OP.LEAVE_LOBBY) return { opcode, playerId: `player-${reader.u16()}` };
  throw new Error(`Unknown client opcode: ${opcode}`);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OP, REASON, BinaryWriter, BinaryReader, encodeGameAccepted, encodeLobbyState, encodeSpawnPhaseStarted, encodeSpawnConfirmed, encodeRejected, encodeGameStarted, encodeGameUpdate, decodeServerMessage, decodeClientMessage };
}

if (typeof window !== 'undefined') {
  window.TerriBinaryProtocol = { OP, decodeServerMessage, encodeRequestLobby: () => new Uint8Array([OP.REQUEST_LOBBY]), encodeJoinLobby: (name) => encodeClientRequest(OP.JOIN_LOBBY, writer => writer.string(name)), encodeRequestGame: (name) => encodeClientRequest(OP.REQUEST_GAME, writer => writer.string(name)), encodeSpawnPosition: (id, position) => encodeClientRequest(OP.SPAWN_POSITION, writer => { writer.u16(playerNumber(id)); writer.u32(position); }), encodeExpansionRequest: (id, position, power) => encodeClientRequest(OP.EXPANSION_REQUEST, writer => { writer.u16(playerNumber(id)); writer.u32(position); writer.u16(power); }), encodeCancelExpansion: (id, attackId = 0) => encodeClientRequest(OP.CANCEL_EXPANSION, writer => { writer.u16(playerNumber(id)); writer.u32(attackId); }), encodeBoatRequest: (id, position, power) => encodeClientRequest(OP.BOAT_REQUEST, writer => { writer.u16(playerNumber(id)); writer.u32(position); writer.u16(power); }), encodeLeaveLobby: (id) => encodeClientRequest(OP.LEAVE_LOBBY, writer => writer.u16(playerNumber(id))) };
}

function encodeClientRequest(opcode, writePayload) {
  const writer = new BinaryWriter(32);
  writer.u8(opcode);
  writePayload(writer);
  return writer.finish();
}
