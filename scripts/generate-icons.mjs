// Generates app icons for Chakaas Player.
// Run with: node scripts/generate-icons.mjs
//
// Design: bold "C" + spark mark in Apple-Music red (#FA233B) on a soft
// off-white (#F5F5F7) base, with a pale red halo. Apple-Music-aligned
// palette, light theme. Replace by overwriting assets/icon.png etc with
// a custom illustration when a richer mascot icon is available.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(__dirname, '..', 'assets');

// Palette
const BG = '#F5F5F7';
const ACCENT = '#FA233B';
const ACCENT_DEEP = '#C81E33';
const HALO = '#FAD5DA';

// ---------- Geometry helpers ----------

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function cArcPath(cx, cy, r, gap = 70) {
  const half = gap / 2;
  const [x1, y1] = polar(cx, cy, r, -half);
  const [x2, y2] = polar(cx, cy, r, half);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 1 0 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

// ---------- Shared SVG fragments ----------

const defs = `
  <defs>
    <radialGradient id="halo" cx="50%" cy="50%" r="60%">
      <stop offset="0%"  stop-color="${HALO}" stop-opacity="0.85"/>
      <stop offset="60%" stop-color="${HALO}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${HALO}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="accent" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%"   stop-color="#FF5060"/>
      <stop offset="55%"  stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_DEEP}"/>
    </linearGradient>
    <filter id="softShadow" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feOffset dx="0" dy="4"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.18"/></feComponentTransfer>
      <feComposite in2="SourceGraphic" operator="out"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
`;

function chakaasMark({
  cx = 512,
  cy = 512,
  radius = 320,
  strokeWidth = 130,
  gap = 78,
  stroke = 'url(#accent)',
  withSpark = true,
} = {}) {
  const arc = cArcPath(cx, cy, radius, gap);
  const sparkY = cy;
  const sparkLeft = cx + radius - strokeWidth * 0.3;
  const sparkRight = cx + radius + strokeWidth * 0.55;
  const sparkH = strokeWidth * 0.18;
  const sparkPath =
    `M ${sparkLeft.toFixed(2)} ${(sparkY - sparkH).toFixed(2)} ` +
    `L ${sparkRight.toFixed(2)} ${(sparkY - sparkH * 0.35).toFixed(2)} ` +
    `L ${sparkRight.toFixed(2)} ${(sparkY + sparkH * 0.35).toFixed(2)} ` +
    `L ${sparkLeft.toFixed(2)} ${(sparkY + sparkH).toFixed(2)} Z`;

  const sparkSvg = withSpark
    ? `<path d="${sparkPath}" fill="${stroke}"/>`
    : '';

  return `
    <g filter="url(#softShadow)">
      <path d="${arc}"
            fill="none"
            stroke="${stroke}"
            stroke-width="${strokeWidth}"
            stroke-linecap="round"/>
      ${sparkSvg}
    </g>
  `;
}

// ---------- 1) Main icon (1024×1024) ----------
const iconSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  <rect width="1024" height="1024" rx="220" fill="${BG}"/>
  <circle cx="512" cy="512" r="430" fill="url(#halo)"/>
  ${chakaasMark()}
</svg>
`;

// ---------- 2) Adaptive icon (1024×1024 foreground) ----------
const adaptiveSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${defs}
  <rect width="1024" height="1024" fill="${BG}"/>
  <circle cx="512" cy="512" r="350" fill="url(#halo)"/>
  <g transform="translate(512 512) scale(0.62) translate(-512 -512)">
    ${chakaasMark()}
  </g>
</svg>
`;

// ---------- 3) Notification icon (96×96 white-only) ----------
const notificationSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  ${chakaasMark({
    stroke: '#FFFFFF',
    radius: 280,
    strokeWidth: 150,
    gap: 78,
    withSpark: true,
  })}
</svg>
`;

// ---------- 4) Splash (1242×2436) ----------
const splashSvg = `
<svg width="1242" height="2436" viewBox="0 0 1242 2436" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="splashHalo" cx="50%" cy="44%" r="50%">
      <stop offset="0%"  stop-color="${HALO}" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="${HALO}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="splashAccent" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%"   stop-color="#FF5060"/>
      <stop offset="55%"  stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_DEEP}"/>
    </linearGradient>
  </defs>
  <rect width="1242" height="2436" fill="${BG}"/>
  <circle cx="621" cy="1080" r="560" fill="url(#splashHalo)"/>
  <g>
    <path d="${cArcPath(621, 1080, 280, 78)}"
          fill="none"
          stroke="url(#splashAccent)"
          stroke-width="115"
          stroke-linecap="round"/>
    <path d="M ${(621 + 280 - 39).toFixed(2)} ${(1080 - 21).toFixed(2)}
             L ${(621 + 280 + 63).toFixed(2)} ${(1080 - 7).toFixed(2)}
             L ${(621 + 280 + 63).toFixed(2)} ${(1080 + 7).toFixed(2)}
             L ${(621 + 280 - 39).toFixed(2)} ${(1080 + 21).toFixed(2)} Z"
          fill="url(#splashAccent)"/>
  </g>
  <text x="621" y="1620"
        text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif"
        font-weight="900"
        font-size="180"
        letter-spacing="16"
        fill="url(#splashAccent)">CHAKAAS</text>
  <text x="621" y="1700"
        text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif"
        font-weight="500"
        font-size="44"
        letter-spacing="22"
        fill="${ACCENT}"
        opacity="0.55">BOLLYWOOD ON LOOP</text>
  <rect x="461" y="1740" width="320" height="3" rx="1.5"
        fill="${ACCENT}" opacity="0.45"/>
</svg>
`;

// ---------- Render pipeline ----------
async function render(svg, outFile, width, height, opts = {}) {
  const buf = Buffer.from(svg);
  const pipeline = sharp(buf, { density: 384 }).resize(width, height, {
    fit: 'fill',
    background: opts.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
  });
  await pipeline.png({ compressionLevel: 9 }).toFile(outFile);
  console.log(`  wrote ${outFile} (${width}x${height})`);
}

(async () => {
  console.log('Generating Chakaas icons (Apple Music light palette) into', ASSETS);
  await render(iconSvg, resolve(ASSETS, 'icon.png'), 1024, 1024, {
    background: { r: 245, g: 245, b: 247, alpha: 1 },
  });
  await render(adaptiveSvg, resolve(ASSETS, 'adaptive-icon.png'), 1024, 1024, {
    background: { r: 245, g: 245, b: 247, alpha: 1 },
  });
  await render(notificationSvg, resolve(ASSETS, 'notification-icon.png'), 96, 96, {
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  await render(splashSvg, resolve(ASSETS, 'splash.png'), 1242, 2436, {
    background: { r: 245, g: 245, b: 247, alpha: 1 },
  });
  console.log('Done.');
})();
