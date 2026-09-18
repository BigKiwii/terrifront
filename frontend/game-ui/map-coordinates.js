(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  function createMapCoordinates(canvas, getDimensions) {
    return {
      fromPointer(event) {
        const dimensions = getDimensions();
        const rectangle = canvas.getBoundingClientRect();
        const localX = (event.clientX - rectangle.left) * (dimensions.width / rectangle.width);
        const localY = (event.clientY - rectangle.top) * (dimensions.height / rectangle.height);
        const mapX = Math.floor(localX);
        const mapY = Math.floor(localY);
        if (mapX < 0 || mapX >= dimensions.width || mapY < 0 || mapY >= dimensions.height) return null;
        return mapY * dimensions.width + mapX;
      }
    };
  }

  modules.mapCoordinates = { createMapCoordinates };
}());
