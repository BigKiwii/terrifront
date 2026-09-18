(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function cubicPoint(start, firstControl, secondControl, end, progress) {
    const inverse = 1 - progress;
    const inverseSquared = inverse * inverse;
    const progressSquared = progress * progress;
    return {
      x: inverseSquared * inverse * start.x + 3 * inverseSquared * progress * firstControl.x +
        3 * inverse * progressSquared * secondControl.x + progressSquared * progress * end.x,
      y: inverseSquared * inverse * start.y + 3 * inverseSquared * progress * firstControl.y +
        3 * inverse * progressSquared * secondControl.y + progressSquared * progress * end.y
    };
  }

  modules.nukeGeometry = { cubicPoint };
}());
