(function () {
  'use strict';
  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createNukeAlert(options) {
    const banner = document.querySelector('#nuke-inbound-banner');
    const vignette = document.querySelector('#nuke-vignette');
    let shakeTimer = null;
    return {
      show() {
        banner.hidden = false;
        vignette.hidden = false;
        options.gameScreen.classList.add('nuke-inbound');
        clearTimeout(shakeTimer);
        shakeTimer = setTimeout(() => options.gameScreen.classList.remove('nuke-inbound'), 900);
      },
      clear() {
        banner.hidden = true;
        vignette.hidden = true;
        options.gameScreen.classList.remove('nuke-inbound');
        clearTimeout(shakeTimer);
        shakeTimer = null;
      }
    };
  }

  modules.nukeAlert = { createNukeAlert };
}());
