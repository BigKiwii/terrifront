(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  modules.mathUtils = { clamp };
}());
