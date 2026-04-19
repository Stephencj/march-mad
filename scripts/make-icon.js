/**
 * One-shot icon generator. Reads build/basketball.svg, rasterizes it at
 * several resolutions with sharp, and bundles the multi-size result into
 * build/icon.ico (Windows) + build/icon.png (Linux / generic fallback).
 *
 * Run with: node scripts/make-icon.js
 */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const SRC = path.join(__dirname, '..', 'build', 'basketball.svg');
const OUT_DIR = path.join(__dirname, '..', 'build');
const SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  const svg = fs.readFileSync(SRC);
  const pngBuffers = await Promise.all(
    SIZES.map(size =>
      sharp(svg, { density: 512 })
        .resize(size, size)
        .png()
        .toBuffer()
    )
  );

  const ico = await pngToIco(pngBuffers);
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);

  const png512 = await sharp(svg, { density: 512 })
    .resize(512, 512)
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png512);

  const sizesStr = SIZES.join(', ');
  process.stdout.write(`wrote build/icon.ico (${sizesStr}) and build/icon.png (512)\n`);
}

main().catch(err => {
  process.stderr.write(`icon generation failed: ${err.stack || err}\n`);
  process.exit(1);
});
