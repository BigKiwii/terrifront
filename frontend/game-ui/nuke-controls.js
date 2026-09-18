(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createNukeControls(options) {
    options.trigger.addEventListener('click', () => options.onEnable());
    options.selectTarget.addEventListener('click', () => options.onSelectTarget());
    options.launch.addEventListener('click', () => options.onLaunch());
    options.cancel.addEventListener('click', () => options.onCancel());
  }

  modules.nukeControls = { createNukeControls };
}());
