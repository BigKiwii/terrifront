(function () {
  'use strict';

  const nameInput = document.querySelector('#player-name');
  const launchForm = document.querySelector('#launch-form');
  const status = document.querySelector('#launch-status');
  const homeScreen = document.querySelector('.home-screen');
  const gameScreen = document.querySelector('#game-screen');
  const quitButton = document.querySelector('#quit-button');
  const powerSlider = document.querySelector('#power-slider');
  const PROTOCOL = window.TerriBinaryProtocol;
  const OP = PROTOCOL.OP;

  const namePool = ['River Fox', 'Iron Finch', 'Neon Atlas', 'Moss Runner'];

  function randomName() {
    return namePool[Math.floor(Math.random() * namePool.length)];
  }

  nameInput.value = randomName();

  TerriCommunicator.on(OP.GAME_ACCEPTED, function (message) {
    homeScreen.hidden = true;
    gameScreen.hidden = false;
    TerriGameUI.start(message.payload);
  });

  TerriCommunicator.on(OP.GAME_REJECTED, function (message) {
    status.textContent = `REQUEST REJECTED // ${message.payload.reason}`;
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
    TerriCommunicator.socket?.close();
    TerriGameUI.stop();
    gameScreen.hidden = true;
    homeScreen.hidden = false;
    status.textContent = '';
  });

  launchForm.addEventListener('submit', function (event) {
    event.preventDefault();
    const playerName = nameInput.value.trim();

    if (!playerName) {
      nameInput.focus();
      status.textContent = 'ENTER A PLAYER NAME TO DEPLOY.';
      return;
    }

    status.textContent = 'CONNECTING TO GAME SERVER...';
    TerriCommunicator.connect()
      .then(() => {
        if (!TerriCommunicator.send(PROTOCOL.encodeRequestGame(playerName))) {
          status.textContent = 'GAME SERVER CONNECTION FAILED.';
        }
      })
      .catch(() => {
        status.textContent = 'GAME SERVER UNAVAILABLE.';
      });
  });
}());