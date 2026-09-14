const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'map', 'europ-asia-map.webp');
const outputDir = path.join(root, 'map');
const outputPath = path.join(outputDir, 'map.bin');
const expansionTimesPath = path.join(outputDir, 'expansion-times.bin');
const manifestPath = path.join(outputDir, 'manifest.json');

function terrainMagnitude(blue) {
  if (blue < 159) return 0;
  if (blue < 179) return 10;
  return Math.min(30, 20 + Math.floor((blue - 179) / 2));
}

async function bake() {
  const { data, info } = await sharp(sourcePath).raw().toBuffer({ resolveWithObject: true });
  const terrain = Buffer.alloc(info.width * info.height);
  const expansionTimes = Buffer.alloc(info.width * info.height);
  for (let position = 0; position < terrain.length; position += 1) {
    const pixel = position * info.channels;
    const red = data[pixel];
    const green = data[pixel + 1];
    const blue = data[pixel + 2];
    const land = !(blue > red + 15 && blue > green + 10);
    terrain[position] = land ? 0x80 | terrainMagnitude(blue) : 0;
    const brightness = Math.floor((red + green + blue) / 3);
    expansionTimes[position] = land ? Math.max(10, Math.min(200, 220 - brightness)) : 0;
  }
  fs.writeFileSync(outputPath, terrain);
  fs.writeFileSync(expansionTimesPath, expansionTimes);
  fs.writeFileSync(manifestPath, `${JSON.stringify({ width: info.width, height: info.height, cellCount: terrain.length, format: 'terrain-u8-v1', expansionTimes: 'expansion-times.bin' }, null, 2)}\n`);
  console.log(`Baked ${path.relative(root, outputPath)} (${info.width}x${info.height})`);
}

bake().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});