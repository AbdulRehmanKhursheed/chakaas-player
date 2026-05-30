// Generate Chakaas Player app icons from the master Arc Reactor SVG.
//
// Reads the master SVG and rasterizes it (via sharp) into the exact PNG
// paths that app.json references:
//   - assets/icon.png            1024x1024, full-bleed #07090D field
//   - assets/adaptive-icon.png   1024x1024, foreground on #07090D
//   - assets/splash.png          1242x2436, centered reactor on #07090D
//   - assets/notification-icon.png 96x96, white mono on transparent (Android tint)
//
// Usage: node scripts/genIcons.mjs

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ASSETS = resolve(ROOT, 'assets');
const LOGO = resolve(ASSETS, 'logo');

const FIELD = '#07090D';

const masterSvgPath = resolve(LOGO, 'arc-reactor.svg');
const monoSvgPath = resolve(LOGO, 'arc-reactor-mono.svg');

const masterSvg = await readFile(masterSvgPath);
const monoSvg = await readFile(monoSvgPath);

// Render the master SVG at a given square size onto an opaque #07090D field.
// The SVG already paints its own full-bleed field, but we flatten to guarantee
// no alpha leaks into the app-store icon.
async function renderSquare(size, outPath, { scale = 1 } = {}) {
  // scale < 1 insets the reactor (used for splash so the mark is not edge-to-edge)
  const inner = Math.round(size * scale);
  const pad = Math.round((size - inner) / 2);

  const mark = await sharp(masterSvg, { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: FIELD })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: FIELD,
    },
  })
    .composite([{ input: mark, top: pad, left: pad }])
    .png()
    .toFile(outPath);

  return outPath;
}

// Splash: portrait canvas, reactor centered, sized to ~48% of width.
async function renderSplash(width, height, outPath) {
  const markSize = Math.round(width * 0.5);
  const mark = await sharp(masterSvg, { density: 384 })
    .resize(markSize, markSize, { fit: 'contain', background: FIELD })
    .png()
    .toBuffer();

  await sharp({
    create: { width, height, channels: 4, background: FIELD },
  })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(outPath);

  return outPath;
}

// Notification icon: white mono mark on transparent for Android status-bar tinting.
async function renderNotification(size, outPath) {
  await sharp(monoSvg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
  return outPath;
}

const written = [];

written.push(await renderSquare(1024, resolve(ASSETS, 'icon.png')));
// Adaptive foreground: inset the mark a bit so the OS safe-zone crop doesn't clip the ring.
written.push(await renderSquare(1024, resolve(ASSETS, 'adaptive-icon.png'), { scale: 0.72 }));
written.push(await renderSplash(1242, 2436, resolve(ASSETS, 'splash.png')));
written.push(await renderNotification(96, resolve(ASSETS, 'notification-icon.png')));

for (const p of written) {
  console.log('wrote', p);
}
console.log('Done. Generated', written.length, 'PNG assets.');
