const Lobby = require('./lobby');

const DEFAULT_LOBBY_DURATION_MS = 30000;
const DEFAULT_MAX_PLAYERS = 250;

class LobbyManager {
  constructor({ onStart, onRotate, durationMs = DEFAULT_LOBBY_DURATION_MS, maxPlayers = DEFAULT_MAX_PLAYERS } = {}) {
    this.onStart = onStart;
    this.onRotate = onRotate;
    this.durationMs = durationMs;
    this.maxPlayers = maxPlayers;
    this.nextLobbyNumber = 1;
    this.nextPlayerNumber = 1;
    this.currentLobby = null;
    this.lobbies = new Map();
    this.playerLobbies = new Map();
    this.timer = null;
  }

  start() {
    if (!this.currentLobby) this.createNextLobby();
    return this.currentLobby.snapshot();
  }

  createNextLobby() {
    const lobby = new Lobby(`lobby-${this.nextLobbyNumber++}`, this.maxPlayers, this.durationMs);
    this.currentLobby = lobby;
    this.lobbies.set(lobby.lobbyId, lobby);
    this.timer = setTimeout(() => this.expire(lobby.lobbyId), this.durationMs);
    if (this.onRotate) this.onRotate(lobby);
    return lobby;
  }

  join(playerName) {
    const lobby = this.currentLobby || this.createNextLobby();
    const playerId = `player-${this.nextPlayerNumber++}`;
    if (!lobby.addPlayer(playerId, playerName)) {
      return { accepted: false, reason: 'LOBBY_FULL' };
    }
    this.playerLobbies.set(playerId, lobby.lobbyId);
    return { accepted: true, playerId, lobby: lobby.snapshot() };
  }

  leave(playerId) {
    const lobbyId = this.playerLobbies.get(playerId);
    if (!lobbyId) return false;
    const lobby = this.lobbies.get(lobbyId);
    this.playerLobbies.delete(playerId);
    if (!lobby || lobby.status !== 'OPEN') return false;
    lobby.removePlayer(playerId);
    return true;
  }

  getLobbyForPlayer(playerId) {
    const lobbyId = this.playerLobbies.get(playerId);
    return lobbyId ? this.lobbies.get(lobbyId) || null : null;
  }

  getCurrentSnapshot() {
    if (!this.currentLobby) this.createNextLobby();
    return this.currentLobby.snapshot();
  }

  expire(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.status !== 'OPEN') return;
    if (this.currentLobby?.lobbyId === lobbyId) this.currentLobby = null;
    lobby.status = lobby.players.size > 0 ? 'STARTING' : 'DISCARDED';
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.createNextLobby();
    if (lobby.status === 'STARTING' && this.onStart) {
      Promise.resolve(this.onStart(lobby)).catch((error) => {
        lobby.status = 'DISCARDED';
        console.error(`[${new Date().toISOString()}] MATCH_START_FAILED lobbyId=${lobby.lobbyId} reason=${error.message}`);
      });
    }
  }
}

module.exports = LobbyManager;
