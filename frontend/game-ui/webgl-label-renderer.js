(function () {
  'use strict';

  const vertexSource = `#version 300 es
in vec2 aPosition;
in vec2 aTexCoord;
uniform vec2 uViewport;
out vec2 vTexCoord;
void main() {
  vec2 clip = vec2(aPosition.x / uViewport.x * 2.0 - 1.0, 1.0 - aPosition.y / uViewport.y * 2.0);
  vTexCoord = aTexCoord;
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

  const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D uGlyphAtlas;
in vec2 vTexCoord;
out vec4 outColor;
void main() {
  float alpha = texture(uGlyphAtlas, vTexCoord).a;
  float outline = 0.0;
  vec2 texel = vec2(1.0 / 1280.0, 1.0 / 768.0);
  for (int y = -1; y <= 1; y += 1) {
    for (int x = -1; x <= 1; x += 1) outline = max(outline, texture(uGlyphAtlas, vTexCoord + vec2(float(x), float(y)) * texel).a);
  }
  vec3 fillColor = vec3(1.0, 0.953, 0.69);
  vec3 outlineColor = vec3(0.027, 0.071, 0.129);
  outColor = vec4(mix(outlineColor, fillColor, step(0.5, alpha)), max(alpha, outline * 0.8));
}`;

  let cachedGameData = null;
  let cachedTerritoryVersion = -1;
  let cachedSquares = new Map();
  let labelCanvas = null;
  let gl = null;
  let program = null;
  let atlasTexture = null;
  let positionBuffer = null;
  let positionLocation = -1;
  let texCoordLocation = -1;
  let viewportLocation = null;
  let atlasLocation = null;
  let mapCanvas = null;
  let mapBounds = null;
  let lastDrawState = null;
  let atlasMetrics = new Map();
  const MIN_LABEL_PIXELS = 1;
  const ATLAS_WIDTH = 1280;
  const ATLAS_HEIGHT = 768;
  const GLYPH_WIDTH = 80;
  const GLYPH_HEIGHT = 96;
  const GLYPHS = " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.:/%♛";

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Label shader compilation failed: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  }

  function createProgram() {
    const nextProgram = gl.createProgram();
    gl.attachShader(nextProgram, compileShader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(nextProgram, compileShader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(nextProgram);
    if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) throw new Error(`Label shader linking failed: ${gl.getProgramInfoLog(nextProgram)}`);
    return nextProgram;
  }

  function buildAtlas() {
    const atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = ATLAS_WIDTH;
    atlasCanvas.height = ATLAS_HEIGHT;
    const context = atlasCanvas.getContext('2d');
    context.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
    context.font = '900 64px "Barlow Condensed", "Arial Narrow", sans-serif';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#fff';
    for (let index = 0; index < GLYPHS.length; index += 1) {
      const glyph = GLYPHS[index];
      const x = (index % 16) * GLYPH_WIDTH;
      const y = Math.floor(index / 16) * GLYPH_HEIGHT;
      context.fillText(glyph, x + 4, y + 72);
      atlasMetrics.set(glyph, { index, advance: Math.max(8, context.measureText(glyph).width) });
    }
    atlasTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ATLAS_WIDTH, ATLAS_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
  }

  function largestOwnedSquares(owners, width, height) {
    const depths = new Uint16Array(width);
    const bestSquares = new Map();
    for (let y = 0; y < height; y += 1) {
      let diagonal = 0;
      for (let x = 0; x < width; x += 1) {
        const position = y * width + x;
        const ownerId = owners[position];
        const previous = depths[x];
        if (ownerId) {
          const left = x > 0 && owners[position - 1] === ownerId ? depths[x - 1] : 0;
          const above = y > 0 && owners[position - width] === ownerId ? previous : 0;
          const upperLeft = x > 0 && y > 0 && owners[position - width - 1] === ownerId ? diagonal : 0;
          depths[x] = Math.min(left, above, upperLeft) + 1;
          const current = bestSquares.get(ownerId);
          if (!current || depths[x] > current.size) bestSquares.set(ownerId, { size: depths[x], x: x - depths[x] + 1, y: y - depths[x] + 1 });
        } else depths[x] = 0;
        diagonal = previous;
      }
    }
    return bestSquares;
  }

  function resolveLabelLayout(gameData, territoryVersion) {
    const width = gameData.map.width;
    const height = gameData.map.height;
    if (gameData !== cachedGameData || territoryVersion !== cachedTerritoryVersion) {
      cachedSquares = largestOwnedSquares(gameData.owners, width, height);
      cachedGameData = gameData;
      cachedTerritoryVersion = territoryVersion;
    }
    if (!mapBounds) mapBounds = mapCanvas.getBoundingClientRect();
    const scaleX = mapBounds.width / width;
    const scaleY = mapBounds.height / height;
    const biggestPlayer = [...gameData.players].filter((player) => player.isAlive !== false && (player.territorySize || 0) > 0).sort((first, second) =>
      (second.territorySize || 0) - (first.territorySize || 0) || (second.troops || 0) - (first.troops || 0))[0];
    const entries = [];
    for (const player of gameData.players) {
      const ownerId = Number(player.playerId.replace('player-', ''));
      const square = cachedSquares.get(ownerId);
      if (!square) continue;
      const squarePixels = Math.min(square.size * scaleX, square.size * scaleY);
      if (squarePixels < MIN_LABEL_PIXELS) continue;
      const screenX = mapBounds.left + square.x * scaleX;
      const screenY = mapBounds.top + square.y * scaleY;
      const screenWidth = square.size * scaleX;
      const screenHeight = square.size * scaleY;
      if (screenX + screenWidth < 0 || screenX > window.innerWidth || screenY + screenHeight < 0 || screenY > window.innerHeight) continue;
      entries.push({ player, screenX, screenY, screenWidth, screenHeight, hasCrown: player.isWinner || player.playerId === biggestPlayer?.playerId });
    }
    return entries;
  }

  function addText(vertices, text, x, y, width, height, baselineBottom) {
    const fontSize = Math.max(10, Math.min(18, Math.floor(Math.min(Math.max(10, width - 1) / Math.max(1, text.length * 0.55), Math.max(10, height * 0.22)))));
    const scale = fontSize / 64;
    const metrics = [...text].map((glyph) => atlasMetrics.get(glyph) || atlasMetrics.get(' '));
    const textWidth = metrics.reduce((total, metric) => total + metric.advance * scale, 0);
    let cursorX = x + (width - textWidth) / 2;
    const top = y + height * (baselineBottom ? 0.10 : 0.64);
    for (let index = 0; index < text.length; index += 1) {
      const glyph = atlasMetrics.get(text[index]) || atlasMetrics.get(' ');
      const atlasX = (glyph.index % 16) * GLYPH_WIDTH;
      const atlasY = Math.floor(glyph.index / 16) * GLYPH_HEIGHT;
      const glyphWidth = glyph.advance * scale;
      const left = cursorX;
      const right = cursorX + glyphWidth;
      const bottom = top + fontSize;
      const u0 = atlasX / ATLAS_WIDTH;
      const u1 = (atlasX + GLYPH_WIDTH) / ATLAS_WIDTH;
      const v0 = 1 - (atlasY + GLYPH_HEIGHT) / ATLAS_HEIGHT;
      const v1 = 1 - atlasY / ATLAS_HEIGHT;
      vertices.push(
        left, top, u0, v1,
        right, top, u1, v1,
        left, bottom, u0, v0,
        left, bottom, u0, v0,
        right, top, u1, v1,
        right, bottom, u1, v0
      );
      cursorX = right;
    }
  }

  function draw(gameData, zoom, territoryVersion = 0) {
    if (!gl || !mapCanvas || !gameData?.owners || !gameData.players) return;
    const bounds = mapCanvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    mapBounds = bounds;
    const nextState = { version: territoryVersion, left: Math.round(bounds.left), top: Math.round(bounds.top), width: Math.round(bounds.width), height: Math.round(bounds.height), zoom: Number.isFinite(zoom) ? Number(zoom.toFixed(3)) : 1 };
    const entries = resolveLabelLayout(gameData, territoryVersion);
    const stateChanged = !lastDrawState || JSON.stringify(lastDrawState) !== JSON.stringify(nextState);
    lastDrawState = nextState;
    if (!stateChanged && entries.length === 0) return;
    const vertices = [];
    for (const entry of entries) {
      const { player, screenX, screenY, screenWidth, screenHeight, hasCrown } = entry;
      if (hasCrown) addText(vertices, '♛', screenX, screenY, screenWidth, screenHeight, true);
      addText(vertices, player.playerName, screenX, screenY, screenWidth, screenHeight, true);
      addText(vertices, Math.round(Number(player.troops) || 0).toLocaleString('en-US').replace(/,/g, ' '), screenX, screenY, screenWidth, screenHeight, false);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, labelCanvas.width, labelCanvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(program);
    gl.uniform2f(viewportLocation, window.innerWidth, window.innerHeight);
    gl.uniform1i(atlasLocation, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 4);
  }

  function init(screen, canvas) {
    if (labelCanvas) return;
    mapCanvas = canvas;
    labelCanvas = document.createElement('canvas');
    labelCanvas.setAttribute('aria-hidden', 'true');
    labelCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    screen.appendChild(labelCanvas);
    gl = labelCanvas.getContext('webgl2', { alpha: true, antialias: true });
    if (!gl) throw new Error('Terrifront requires WebGL2 for player labels');
    program = createProgram();
    positionLocation = gl.getAttribLocation(program, 'aPosition');
    texCoordLocation = gl.getAttribLocation(program, 'aTexCoord');
    viewportLocation = gl.getUniformLocation(program, 'uViewport');
    atlasLocation = gl.getUniformLocation(program, 'uGlyphAtlas');
    positionBuffer = gl.createBuffer();
    buildAtlas();
    resize();
    window.addEventListener('resize', () => {
      mapBounds = null;
      lastDrawState = null;
      resize();
    });
  }

  function resize() {
    if (!labelCanvas || !gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    labelCanvas.width = Math.ceil(window.innerWidth * dpr);
    labelCanvas.height = Math.ceil(window.innerHeight * dpr);
    gl.viewport(0, 0, labelCanvas.width, labelCanvas.height);
  }

  function getLabelCenter(playerId, gameData, territoryVersion = 0) {
    if (!gameData?.owners || !gameData.players) return null;
    const width = gameData.map.width;
    const height = gameData.map.height;
    if (gameData !== cachedGameData || territoryVersion !== cachedTerritoryVersion) {
      cachedSquares = largestOwnedSquares(gameData.owners, width, height);
      cachedGameData = gameData;
      cachedTerritoryVersion = territoryVersion;
    }
    const ownerId = Number(String(playerId).replace('player-', ''));
    const square = cachedSquares.get(ownerId);
    if (square) return { x: square.x + square.size / 2, y: square.y + square.size / 2 };
    for (let position = 0; position < gameData.owners.length; position += 1) {
      if (gameData.owners[position] === ownerId) return { x: position % width + 0.5, y: Math.floor(position / width) + 0.5 };
    }
    return null;
  }

  function invalidateLayout() {
    mapBounds = null;
    lastDrawState = null;
  }

  window.TerriPlayerLabelRenderer = { init, draw, getLabelCenter, invalidateLayout };
}());
