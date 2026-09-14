(function () {
  'use strict';

  const nameInput = document.querySelector('#player-name');
  const launchForm = document.querySelector('#launch-form');
  const status = document.querySelector('#launch-status');
  const homeScreen = document.querySelector('.home-screen');
  const lobbyScreen = document.querySelector('#lobby-screen');
  const lobbyId = document.querySelector('#lobby-id');
  const lobbyCountdown = document.querySelector('#lobby-countdown');
  const lobbyMeterFill = document.querySelector('#lobby-meter-fill');
  const lobbyPlayerCount = document.querySelector('#lobby-player-count');
  const lobbyStatus = document.querySelector('#lobby-status');
  const lobbyRoster = document.querySelector('#lobby-roster');
  const lobbyJoinButton = document.querySelector('#lobby-join-button');
  const lobbyLeaveButton = document.querySelector('#lobby-leave-button');
  const gameScreen = document.querySelector('#game-screen');
  const quitButton = document.querySelector('#quit-button');
  const powerSlider = document.querySelector('#power-slider');
  const PROTOCOL = window.TerriBinaryProtocol;
  const OP = PROTOCOL.OP;

  const namePool = ['River Fox', 'Iron Finch', 'Neon Atlas', 'Moss Runner'];
  let lobbyPlayerId = null;
  let lobbyDeadline = 0;
  let lobbyDuration = 30000;
  let lobbyTimer = null;

  function randomName() {
    return namePool[Math.floor(Math.random() * namePool.length)];
  }

  nameInput.value = randomName();

  TerriCommunicator.on(OP.GAME_ACCEPTED, function (message) {
    homeScreen.hidden = true;
    lobbyScreen.hidden = true;
    gameScreen.hidden = false;
    if (lobbyTimer) window.clearInterval(lobbyTimer);
    TerriGameUI.start(message.payload);
  });

  TerriCommunicator.on(OP.LOBBY_STATE, function (message) {
    const lobby = message.payload;
    lobbyPlayerId = lobby.playerId;
    lobbyDeadline = lobby.deadline;
    lobbyDuration = 30000;
    homeScreen.hidden = true;
    gameScreen.hidden = true;
    lobbyScreen.hidden = false;
    renderLobby(lobby);
    if (lobbyTimer) window.clearInterval(lobbyTimer);
    lobbyTimer = window.setInterval(() => {
      updateLobbyCountdown();
      if (lobbyDeadline <= Date.now()) window.clearInterval(lobbyTimer);
    }, 100);
  });

  TerriCommunicator.on(OP.GAME_REJECTED, function (message) {
    status.textContent = `REQUEST REJECTED // ${message.payload.reason}`;
  });

  TerriCommunicator.on(OP.LOBBY_REJECTED, function (message) {
    lobbyJoinButton.disabled = false;
    lobbyJoinButton.textContent = 'JOIN LOBBY';
    lobbyStatus.textContent = `REJECTED // ${message.payload.reason}`;
  });

  TerriCommunicator.on(OP.SPAWN_PHASE_STARTED, function (message) {
    TerriGameUI.beginSpawnPhase(message.payload);
  });

  TerriCommunicator.on(OP.SPAWN_CONFIRMED, function (message) {
    TerriGameUI.confirmSpawn(message.payload);
  });

  TerriCommunicator.on(OP.SPAWN_REJECTED, function (message) {
    TerriGameUI.rejectSpawn(message.payload);
  });

  TerriCommunicator.on(OP.GAME_STARTED, function (message) {
    TerriGameUI.startActiveGame(message.payload);
  });

  TerriCommunicator.on(OP.GAME_UPDATE, function (message) {
    TerriGameUI.applyGameUpdate(message.payload);
  });

  TerriCommunicator.on(OP.EXPANSION_REJECTED, function (message) {
    TerriGameUI.rejectExpansion(message.payload);
  });

  TerriCommunicator.on(OP.BOAT_REJECTED, function (message) {
    TerriGameUI.rejectExpansion(message.payload);
  });

  TerriGameUI.onSpawnSubmit(function (payload) {
    TerriCommunicator.send(PROTOCOL.encodeSpawnPosition(payload.playerId, payload.position));
  });

  TerriGameUI.onMapAction(function (payload) {
    const power = Math.round(Number(powerSlider.value) * 10);
    TerriCommunicator.send(PROTOCOL.encodeExpansionRequest(payload.playerId, payload.position, power));
  });

  TerriGameUI.onBoatAction(function (payload) {
    const power = Math.round(Number(powerSlider.value) * 10);
    TerriCommunicator.send(PROTOCOL.encodeBoatRequest(payload.playerId, payload.position, power));
  });

  quitButton.addEventListener('click', function () {
    TerriCommunicator.disconnect();
    TerriGameUI.stop();
    gameScreen.hidden = true;
    homeScreen.hidden = false;
    status.textContent = '';
  });

  lobbyLeaveButton.addEventListener('click', function () {
    if (lobbyPlayerId) TerriCommunicator.send(PROTOCOL.encodeLeaveLobby(lobbyPlayerId));
    if (lobbyTimer) window.clearInterval(lobbyTimer);
    TerriCommunicator.disconnect();
    lobbyScreen.hidden = true;
    homeScreen.hidden = false;
    status.textContent = '';
    lobbyPlayerId = null;
  });

  lobbyJoinButton.addEventListener('click', function () {
    const playerName = nameInput.value.trim();
    if (!playerName) return;
    lobbyJoinButton.disabled = true;
    lobbyJoinButton.textContent = 'JOINING...';
    TerriCommunicator.send(PROTOCOL.encodeJoinLobby(playerName));
  });

  launchForm.addEventListener('submit', function (event) {
    event.preventDefault();
    const playerName = nameInput.value.trim();

    if (!playerName) {
      nameInput.focus();
      status.textContent = 'ENTER A PLAYER NAME TO DEPLOY.';
      return;
    }

    status.textContent = 'OPENING MATCH LOBBY...';
    TerriCommunicator.connect()
      .then(() => {
        if (!TerriCommunicator.send(PROTOCOL.encodeRequestLobby())) {
          status.textContent = 'GAME SERVER CONNECTION FAILED.';
        }
      })
      .catch(() => {
        status.textContent = 'GAME SERVER UNAVAILABLE.';
      });
  });

  function renderLobby(lobby) {
    lobbyId.textContent = `${lobby.lobbyId.toUpperCase()} // OPEN FRONT`;
    lobbyPlayerCount.textContent = `${lobby.players.length} / ${lobby.maxPlayers}`;
    lobbyStatus.textContent = 'OPEN';
    lobbyRoster.replaceChildren();
    for (const player of lobby.players) {
      const row = document.createElement('div');
      row.className = `lobby-player${player.playerId === lobbyPlayerId ? ' is-local' : ''}`;
      row.innerHTML = '<span></span><small>READY</small>';
      row.querySelector('span').textContent = player.playerName;
      lobbyRoster.appendChild(row);
    }
    lobbyJoinButton.hidden = Boolean(lobbyPlayerId);
    lobbyJoinButton.disabled = false;
    lobbyJoinButton.textContent = 'JOIN LOBBY';
    lobbyLeaveButton.hidden = !lobbyPlayerId;
    updateLobbyCountdown();
  }

  function updateLobbyCountdown() {
    const remaining = Math.max(0, lobbyDeadline - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    lobbyCountdown.textContent = `00:${String(seconds).padStart(2, '0')}`;
    lobbyMeterFill.style.width = `${Math.max(0, Math.min(100, remaining / lobbyDuration * 100))}%`;
  }
}());