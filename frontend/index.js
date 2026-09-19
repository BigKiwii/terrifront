(function () {
  'use strict';

  const nameInput = document.querySelector('#player-name');
  const launchForm = document.querySelector('#launch-form');
  const status = document.querySelector('#launch-status');
  const homeScreen = document.querySelector('.home-screen');
  const gameScreen = document.querySelector('#game-screen');
  const quitButton = document.querySelector('#quit-button');
  const powerSlider = document.querySelector('#power-slider');

  const namePool = ['River Fox', 'Iron Finch', 'Neon Atlas', 'Moss Runner'];

  function showOfflineGame() {
    const playerName = nameInput.value.trim();
    if (!playerName) {
      nameInput.focus();
      status.textContent = 'ENTER A PLAYER NAME TO DEPLOY.';
      return;
    }
    status.textContent = 'INITIALIZING OFFLINE FRONT...';
    TerriOfflineGame.start(playerName)
      .then(() => {
        homeScreen.hidden = true;
        gameScreen.hidden = false;
        status.textContent = '';
      })
      .catch((error) => {
        console.error('Unable to start offline game:', error);
        status.textContent = 'OFFLINE GAME INITIALIZATION FAILED.';
      });
  }

  function randomName() {
    return namePool[Math.floor(Math.random() * namePool.length)];
  }

  nameInput.value = randomName();

  TerriGameUI.onSpawnSubmit(function (payload) {
    TerriOfflineGame.submitSpawn(payload);
  });

  TerriGameUI.onMapAction(function (payload) {
    const power = Math.round(Number(powerSlider.value) * 10);
    TerriOfflineGame.requestExpansion(payload, power);
  });

  TerriGameUI.onBoatAction(function (payload) {
    const power = Math.round(Number(powerSlider.value) * 10);
    TerriOfflineGame.requestBoat(payload, power);
  });

  TerriGameUI.onNukeLaunch(function (payload) {
    TerriOfflineGame.requestNuke(payload);
  });

  quitButton.addEventListener('click', function () {
    TerriOfflineGame.stop();
    TerriGameUI.stop();
    gameScreen.hidden = true;
    homeScreen.hidden = false;
    status.textContent = '';
  });

  launchForm.addEventListener('submit', function (event) {
    event.preventDefault();
    showOfflineGame();
  });
}());