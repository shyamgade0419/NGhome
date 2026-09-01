/**
 * NG Home — Icon & Splash PNG Generator
 *
 * Converts SVG source files → production-ready PNG assets required by Expo.
 *
 * Prerequisites:
 *   npm install --save-dev @resvg/resvg-js
 *   (pure JS, no native build tools needed)
 *
 * Usage:
 *   node scripts/generate-icons.js
 *
 * Output files (written to assets/images/):
 *   icon.png           1024×1024  — iOS App Store icon
 *   adaptive-icon.png  1024×1024  — Android adaptive icon (foreground layer)
 *   splash.png         1080×1920  — Splash screen
 *   favicon.png          48×48   — Web favicon
 */

const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');

const SVG_DIR    = path.join(__dirname, '../assets/svg');
const OUTPUT_DIR = path.join(__dirname, '../assets/images');

/* ── Helper ──────────────────────────────────────────────────── */
function renderSvgToPng(svgPath, outPath, width, height) {
  const svg = fs.readFileSync(svgPath, 'utf-8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false },
  });
  const pngData  = resvg.render();
  const pngBuffer = pngData.asPng();
  fs.writeFileSync(outPath, pngBuffer);
  const kb = (pngBuffer.length / 1024).toFixed(1);
  console.log(`  ✓  ${path.basename(outPath)}  (${width}×${height}, ${kb} KB)`);
}

/* ── Main ────────────────────────────────────────────────────── */
console.log('\n🎨  NG Home icon generator\n');

// 1. iOS icon  (1024×1024 — rounded square bg included in SVG)
renderSvgToPng(
  path.join(SVG_DIR, 'icon-ios.svg'),
  path.join(OUTPUT_DIR, 'icon.png'),
  1024, 1024,
);

// 2. Android adaptive icon foreground  (logo mark only, transparent bg)
renderSvgToPng(
  path.join(SVG_DIR, 'logo-mark.svg'),
  path.join(OUTPUT_DIR, 'adaptive-icon.png'),
  1024, 1024,
);

// 3. Splash screen  (1080×1920)
renderSvgToPng(
  path.join(SVG_DIR, 'splash.svg'),
  path.join(OUTPUT_DIR, 'splash.png'),
  1080, 1920,
);

// 4. Web favicon  (48×48)
renderSvgToPng(
  path.join(SVG_DIR, 'logo-mark.svg'),
  path.join(OUTPUT_DIR, 'favicon.png'),
  48, 48,
);

console.log('\n✅  All assets generated in assets/images/\n');
