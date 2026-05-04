/**
 * Phase H1 — Dump baked feature crops to PNG files for visual review.
 *
 * Usage:
 *   node scripts/dump-feature-crops.cjs <reprocessed-face.json>
 *
 * Reads each `mesh3d.featureImages.{name}.dataUrl` and writes it as
 * `scripts/_baked-features/<face-name>/<feature>.png`. Also writes a
 * tiny `_summary.json` next to the PNGs so downstream tools can inspect
 * srcBbox / center3D / size3D without re-parsing the giant face JSON.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function dataUrlToBuffer(dataUrl) {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error('not a base64 PNG/JPEG data URL');
  return Buffer.from(m[2], 'base64');
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/dump-feature-crops.cjs <reprocessed-face.json>');
    process.exit(1);
  }
  if (!fs.existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(inputPath, 'utf8');
  const face = JSON.parse(raw);
  const featureImages = face?.mesh3d?.featureImages;
  if (!featureImages) {
    console.error(
      `[dump] No mesh3d.featureImages on this face — was it reprocessed with the H1 baker?`,
    );
    process.exit(2);
  }

  const faceName = (face.name || path.basename(inputPath, path.extname(inputPath)))
    .replace(/[^A-Za-z0-9._-]/g, '_');
  const outDir = path.join(__dirname, '_baked-features', faceName);
  fs.mkdirSync(outDir, { recursive: true });

  const summary = {};
  for (const [name, crop] of Object.entries(featureImages)) {
    if (!crop?.dataUrl) {
      console.warn(`[dump] ${name}: no dataUrl, skipping`);
      continue;
    }
    let buf;
    try {
      buf = dataUrlToBuffer(crop.dataUrl);
    } catch (err) {
      console.warn(`[dump] ${name}: ${err.message}`);
      continue;
    }
    const outPath = path.join(outDir, `${name}.png`);
    fs.writeFileSync(outPath, buf);
    summary[name] = {
      pngBytes: buf.length,
      srcBbox: crop.srcBbox,
      center3D: crop.center3D,
      size3D: crop.size3D,
    };
    console.log(`[dump] wrote ${outPath} (${buf.length} bytes)`);
  }
  const summaryPath = path.join(outDir, '_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`[dump] wrote ${summaryPath}`);
}

main();
