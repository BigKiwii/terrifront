(function () {
  'use strict';

  const modules = window.TerriGameModules = window.TerriGameModules || {};

  const vertexSource = `#version 300 es
in vec2 aPosition;
in vec2 aTexCoord;
out vec2 vTexCoord;

void main() {
  vTexCoord = aTexCoord;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

  const fragmentSource = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uTerrain;
uniform highp usampler2D uOwners;
uniform sampler2D uPalette;
uniform ivec2 uMapSize;
in vec2 vTexCoord;
out vec4 outColor;

vec4 paletteColor(uint owner) {
  return texture(uPalette, vec2((float(owner) + 0.5) / 512.0, 0.5));
}

void main() {
  ivec2 cell = ivec2(
    clamp(int(vTexCoord.x * float(uMapSize.x)), 0, uMapSize.x - 1),
    clamp(int((1.0 - vTexCoord.y) * float(uMapSize.y)), 0, uMapSize.y - 1)
  );
  vec4 baseColor = texelFetch(uTerrain, cell, 0);
  uint owner = texelFetch(uOwners, cell, 0).r;
  if (owner == 0u) {
    outColor = baseColor;
    return;
  }
  vec4 paletteValue = paletteColor(owner);
  bool border = cell.x == 0 || cell.y == 0 || cell.x == uMapSize.x - 1 || cell.y == uMapSize.y - 1;
  if (!border) {
    border = texelFetch(uOwners, cell + ivec2(-1, 0), 0).r != owner ||
      texelFetch(uOwners, cell + ivec2(1, 0), 0).r != owner ||
      texelFetch(uOwners, cell + ivec2(0, -1), 0).r != owner ||
      texelFetch(uOwners, cell + ivec2(0, 1), 0).r != owner;
  }
  vec3 territoryColor = border ? paletteValue.rgb * 0.7 : paletteValue.rgb;
  float territoryAlpha = border ? 0.9 : 0.6;
  outColor = vec4(mix(baseColor.rgb, territoryColor, territoryAlpha), 1.0);
}`;

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`WebGL shader compilation failed: ${message}`);
    }
    return shader;
  }

  function createProgram(gl) {
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`WebGL program linking failed: ${message}`);
    }
    return program;
  }

  function parseHexColor(color) {
    const match = String(color || '').match(/^#([0-9a-f]{6})$/i);
    if (!match) return [105, 200, 120, 255];
    return [
      parseInt(match[1].slice(0, 2), 16),
      parseInt(match[1].slice(2, 4), 16),
      parseInt(match[1].slice(4, 6), 16),
      255
    ];
  }

  function createMapRenderer(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('Terrifront requires WebGL2 for map rendering');
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const program = createProgram(gl);
    const positionLocation = gl.getAttribLocation(program, 'aPosition');
    const texCoordLocation = gl.getAttribLocation(program, 'aTexCoord');
    const mapSizeLocation = gl.getUniformLocation(program, 'uMapSize');
    const terrainLocation = gl.getUniformLocation(program, 'uTerrain');
    const ownersLocation = gl.getUniformLocation(program, 'uOwners');
    const paletteLocation = gl.getUniformLocation(program, 'uPalette');
    const vertexArray = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const terrainTexture = gl.createTexture();
    const ownersTexture = gl.createTexture();
    const paletteTexture = gl.createTexture();
    let width = 1;
    let height = 1;
    let ownerData = new Uint16Array(1);
    let mapReady = false;

    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      -1, 1, 0, 1,
      1, 1, 1, 1
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8);

    function configureTexture(texture, minFilter, magFilter) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    configureTexture(terrainTexture, gl.NEAREST, gl.NEAREST);
    configureTexture(ownersTexture, gl.NEAREST, gl.NEAREST);
    configureTexture(paletteTexture, gl.NEAREST, gl.NEAREST);

    function resize() {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function setTerrain(terrain, mapWidth, mapHeight) {
      width = mapWidth;
      height = mapHeight;
      const pixels = new Uint8Array(width * height * 4);
      for (let position = 0; position < terrain.length; position += 1) {
        const magnitude = terrain[position] & 31;
        const pixel = position * 4;
        if ((terrain[position] & 128) !== 0) {
          pixels[pixel] = 226 + Math.min(20, magnitude * 2);
          pixels[pixel + 1] = 209 + Math.min(18, magnitude * 2);
          pixels[pixel + 2] = 161 + Math.min(16, magnitude);
        } else {
          pixels[pixel] = 79 + Math.min(9, Math.floor(magnitude * 1.2));
          pixels[pixel + 1] = 114 + Math.min(11, Math.floor(magnitude * 1.2));
          pixels[pixel + 2] = 140 + Math.min(7, Math.floor(magnitude * 0.6));
        }
        pixels[pixel + 3] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, terrainTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (ownerData.length === width * height) uploadOwners();
      mapReady = ownerData.length === width * height;
      gl.useProgram(program);
      gl.uniform2i(mapSizeLocation, width, height);
    }

    function uploadOwners() {
      gl.bindTexture(gl.TEXTURE_2D, ownersTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, ownerData);
    }

    function setOwners(owners) {
      if (ownerData.length !== owners.length) ownerData = new Uint16Array(owners.length);
      ownerData.set(owners);
      mapReady = ownerData.length === width * height;
      if (mapReady) uploadOwners();
    }

    function updateOwners(owners, changes) {
      const changeCount = changes instanceof Int32Array ? changes.length / 2 : (changes?.length || 0);
      if (!mapReady) {
        if (changes instanceof Int32Array) {
          for (let index = 0; index < changes.length; index += 2) {
            const position = changes[index];
            if (position >= 0 && position < ownerData.length) ownerData[position] = changes[index + 1];
          }
        } else for (const change of changes || []) {
          if (Number.isInteger(change.position) && change.position >= 0 && change.position < ownerData.length) ownerData[change.position] = owners[change.position];
        }
        return;
      }
      const rows = new Map();
      for (let index = 0; index < changeCount; index += 1) {
        const position = changes instanceof Int32Array ? changes[index * 2] : changes[index].position;
        if (!Number.isInteger(position) || position < 0 || position >= ownerData.length) continue;
        ownerData[position] = changes instanceof Int32Array ? changes[index * 2 + 1] : owners[position];
        const y = Math.floor(position / width);
        const x = position % width;
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push(x);
      }
      if (rows.size > 512 || changeCount > 2048) {
        uploadOwners();
        return;
      }
      gl.bindTexture(gl.TEXTURE_2D, ownersTexture);
      for (const [y, positions] of rows) {
        positions.sort((first, second) => first - second);
        let start = positions[0];
        let end = start;
        for (let index = 1; index <= positions.length; index += 1) {
          const next = index < positions.length ? positions[index] : -1;
          if (next !== end + 1 && next !== end) {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, start, y, end - start + 1, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, ownerData.subarray(y * width + start, y * width + end + 1));
            start = next;
          }
          end = next;
        }
      }
    }

    function setPalette(colors, fallbackColor) {
      const palette = new Uint8Array(512 * 4);
      const fallback = parseHexColor(fallbackColor || '#69c878');
      for (let index = 0; index < 512; index += 1) palette.set(fallback, index * 4);
      for (const [ownerId, color] of colors || []) {
        if (ownerId >= 0 && ownerId < 512) palette.set(parseHexColor(color), ownerId * 4);
      }
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 512, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, palette);
    }

    function draw() {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform1i(terrainLocation, 0);
      gl.uniform1i(ownersLocation, 1);
      gl.uniform1i(paletteLocation, 2);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, terrainTexture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, ownersTexture);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
      gl.bindVertexArray(vertexArray);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    return { resize, setTerrain, setOwners, updateOwners, setPalette, draw };
  }

  modules.webglRenderer = { createMapRenderer };
}());
