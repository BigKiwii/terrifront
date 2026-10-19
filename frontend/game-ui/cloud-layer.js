(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};
  const CLOUD_COLUMNS = 4;
  const CLOUD_ROWS = 8;
  const CELL_WIDTH = 128;
  const CELL_HEIGHT = 64;
  const CLOUD_COUNT = 12;

  function createCloudLayer(options) {
    const image = new Image();
    const clouds = [];
    let initialized = false;

    image.src = '../Assets/cloud-image.png';

    function createCloud(width, height, index) {
      const cloudWidth = 90 + Math.random() * 120;
      return {
        x: -cloudWidth - index * width / CLOUD_COUNT,
        y: Math.random() * height,
        width: cloudWidth,
        height: 45 + Math.random() * 60,
        speed: 7 + Math.random() * 6,
        column: Math.floor(Math.random() * CLOUD_COLUMNS),
        row: Math.floor(Math.random() * CLOUD_ROWS)
      };
    }

    function initialize(width, height) {
      clouds.length = 0;
      for (let index = 0; index < CLOUD_COUNT; index += 1) {
        clouds.push(createCloud(width, height, index));
      }
      initialized = true;
    }

    function draw(deltaMs) {
      const dimensions = options.getMapDimensions();
      const width = dimensions.width;
      const height = dimensions.height;
      const context = options.context;

      context.clearRect(0, 0, width, height);
      if (!image.complete || !image.naturalWidth || width <= 0 || height <= 0) return;
      if (!initialized) initialize(width, height);

      context.save();
      context.globalAlpha = 0.6;
      for (const cloud of clouds) {
        cloud.x += cloud.speed * deltaMs / 1000;
        if (cloud.x > width + cloud.width) cloud.x = -cloud.width;
        context.drawImage(
          image,
          cloud.column * CELL_WIDTH,
          cloud.row * CELL_HEIGHT,
          CELL_WIDTH,
          CELL_HEIGHT,
          cloud.x,
          cloud.y,
          cloud.width,
          cloud.height
        );
      }
      context.restore();
    }

    return { draw };
  }

  modules.cloudLayer = { createCloudLayer };
}());