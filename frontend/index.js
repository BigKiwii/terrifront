(function () {
  'use strict';

  const nameInput = document.querySelector('#player-name');
  const launchForm = document.querySelector('#launch-form');
  const rerollButton = document.querySelector('#reroll-name');
  const status = document.querySelector('#launch-status');
  const homeScreen = document.querySelector('.home-screen');
  const gameScreen = document.querySelector('#game-screen');
  const quitButton = document.querySelector('#quit-button');
  const liveClock = document.querySelector('#live-clock');
  const powerSlider = document.querySelector('#power-slider');
  const CODES = window.TerriProtocolCodes;

  const namePool = ['River Fox', 'Iron Finch', 'Neon Atlas', 'Moss Runner'];

  function randomName() {
    return namePool[Math.floor(Math.random() * namePool.length)];
  }

  function setRandomName() {
    nameInput.value = randomName();
    nameInput.select();
  }

  let namePreviewIndex = 0;
  nameInput.value = namePool[namePreviewIndex];
  const namePreviewTimer = setInterval(function () {
    if (document.activeElement === nameInput || nameInput.value !== namePool[namePreviewIndex]) {
      clearInterval(namePreviewTimer);
      return;
    }
    namePreviewIndex = (namePreviewIndex + 1) % namePool.length;
    nameInput.value = namePool[namePreviewIndex];
  }, 360);
  rerollButton.addEventListener('click', setRandomName);

  function updateClock() {
    liveClock.textContent = new Date().toLocaleTimeString();
  }
  updateClock();
  setInterval(updateClock, 1000);

  TerriCommunicator.on(CODES.GAME_ACCEPTED, function (message) {
    homeScreen.hidden = true;
    gameScreen.hidden = false;
    TerriGameUI.start(message.payload);
  });

  TerriCommunicator.on(CODES.GAME_REJECTED, function (message) {
    status.textContent = `REQUEST REJECTED // ${message.payload.reason}`;
  });

  TerriCommunicator.on(CODES.SPAWN_PHASE_STARTED, function (message) {
    TerriGameUI.beginSpawnPhase(message.payload);
  });

  TerriCommunicator.on(CODES.SPAWN_CONFIRMED, function (message) {
    TerriGameUI.confirmSpawn(message.payload);
  });

  TerriCommunicator.on(CODES.SPAWN_REJECTED, function (message) {
    TerriGameUI.rejectSpawn(message.payload);
  });

  TerriCommunicator.on(CODES.GAME_STARTED, function (message) {
    TerriGameUI.startActiveGame(message.payload);
  });

  TerriCommunicator.on(CODES.GAME_UPDATE, function (message) {
    TerriGameUI.applyGameUpdate(message.payload);
  });

  TerriCommunicator.on(CODES.EXPANSION_REJECTED, function (message) {
    TerriGameUI.rejectExpansion(message.payload);
  });

  TerriGameUI.onSpawnSubmit(function (payload) {
    TerriCommunicator.send(CODES.SPAWN_POSITION_SUBMITTED, payload);
  });

  TerriGameUI.onMapAction(function (payload) {
    const power = Math.round(Number(powerSlider.value) * 10);
    TerriCommunicator.send(CODES.EXPANSION_REQUEST, { ...payload, power });
  });

  quitButton.addEventListener('click', function () {
    TerriCommunicator.socket?.close();
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
        if (!TerriCommunicator.send(CODES.REQUEST_GAME, { playerName })) {
          status.textContent = 'GAME SERVER CONNECTION FAILED.';
        }
      })
      .catch(() => {
        status.textContent = 'GAME SERVER UNAVAILABLE.';
      });
  });
}());