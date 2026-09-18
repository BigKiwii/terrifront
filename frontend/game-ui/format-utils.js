(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function formatTroops(value) {
    return Math.round(Number(value) || 0).toLocaleString('en-US').replace(/,/g, ' ');
  }

  modules.formatUtils = { formatTroops };
}());
