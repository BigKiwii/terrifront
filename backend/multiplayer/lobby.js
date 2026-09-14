class Lobby {
  constructor(lobbyId, maxPlayers, durationMs) {
    this.lobbyId = lobbyId;
    this.maxPlayers = maxPlayers;
    this.createdAt = Date.now();
    this.deadline = this.createdAt + durationMs;
    this.status = 'OPEN';
    this.players = new Map();
  }

  addPlayer(playerId, playerName) {
    if (this.status !== 'OPEN' || this.players.size >= this.maxPlayers) return false;
    this.players.set(playerId, {
      playerId,
      playerName,
      ready: true,
      joinedAt: Date.now()
    });
    return true;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
  }

  snapshot() {
    return {
      lobbyId: this.lobbyId,
      status: this.status,
      deadline: this.deadline,
      maxPlayers: this.maxPlayers,
      players: [...this.players.values()].map((player) => ({ ...player }))
    };
  }
}

module.exports = Lobby;
