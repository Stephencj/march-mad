/**
 * Phase H1 — Dump baked feature crops to PNG files for visual review.
 *
 * Usage:
 *   node scripts/dump-feature-crops.cjs <reprocessed-face.json>
 *
 * Reads each `mesh3d.featureImages.{name}.dataUrl` and writes it as
 * `scripts/_baked-features/<face-name>/<feature>.png`. Also writes:
 *   - `_summary.json` — bbox / center3D / size3D per feature
 *   - `_source.png` — the front photo with normalized landmarks (so we
 *     can see what bbox the baker drew from)
 *   - `<feature>_compare.png` per feature: a side-by-side image with
 *     the SOURCE bbox region (cropped from the front photo) on the left
 *     and the BAKED output on the right. Lets a human (or another
 *     agent) eyeball exactly what the baker did to the input.
 *
 * `_compare.png` generation requires `sharp` (already a dev dep).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

function dataUrlToBuffer(dataUrl) {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error('not a base64 PNG/JPEG data URL');
  return Buffer.from(m[2], 'base64');
}

/**
 * Build a side-by-side compare image: [src bbox crop | gap | baked
 * output]. Both panels are normalized to the same height (the larger
 * of the two) so they line up. A 4-px gray gutter sits between them.
 */
async function makeCompareImage(sourceBuf, srcBbox, bakedBuf, outPath) {
  const sourceMeta = await sharp(sourceBuf).metadata();
  const sw = sourceMeta.width;
  const sh = sourceMeta.height;
  // Clamp bbox to source bounds (handles cover-mode / negative-y trims).
  const bx = Math.max(0, Math.min(sw - 1, Math.round(srcBbox.x)));
  const by = Math.max(0, Math.min(sh - 1, Math.round(srcBbox.y)));
  const bw = Math.max(1, Math.min(sw - bx, Math.round(srcBbox.w)));
  const bh = Math.max(1, Math.min(sh - by, Math.round(srcBbox.h)));

  const srcCrop = await sharp(sourceBuf)
    .extract({ left: bx, top: by, width: bw, height: bh })
    .png()
    .toBuffer();
  const bakedMeta = await sharp(bakedBuf).metadata();

  const targetH = Math.max(bh, bakedMeta.height);
  const srcResized = await sharp(srcCrop)
    .resize({ height: targetH, fit: 'contain', background: { r: 32, g: 32, b: 32, alpha: 1 } })
    .png()
    .toBuffer();
  const bakedResized = await sharp(bakedBuf)
    .resize({ height: targetH, fit: 'contain', background: { r: 32, g: 32, b: 32, alpha: 1 } })
    .png()
    .toBuffer();

  const srcResizedMeta = await sharp(srcResized).metadata();
  const bakedResizedMeta = await sharp(bakedResized).metadata();
  const gap = 4;
  const totalW = srcResizedMeta.width + gap + bakedResizedMeta.width;

  await sharp({
    create: {
      width: totalW,
      height: targetH,
      channels: 4,
      background: { r: 96, g: 96, b: 96, alpha: 1 },
    },
  })
    .composite([
      { input: srcResized, left: 0, top: 0 },
      { input: bakedResized, left: srcResizedMeta.width + gap, top: 0 },
    ])
    .png()
    .toFile(outPath);
}

async function main() {
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

  // Find the source front-pose photo. The FaceImage schema stores it
  // at the root `face.dataUrl`; older formats stuck it under
  // `poses[POSE].imageDataUrl`. Fall through both.
  let sourceBuf = null;
  if (face?.dataUrl) {
    try {
      sourceBuf = dataUrlToBuffer(face.dataUrl);
    } catch (err) {
      console.warn(`[dump] root dataUrl parse failed: ${err.message}`);
    }
  }
  if (!sourceBuf) {
    const poses = face?.poses ?? face?.mesh3d?.poses ?? null;
    if (poses && typeof poses === 'object') {
      const front = poses.front || poses['front-pose'] || poses.f1 ||
        Object.values(poses).find((p) => p?.imageDataUrl);
      if (front?.imageDataUrl) {
        try {
          sourceBuf = dataUrlToBuffer(front.imageDataUrl);
        } catch (err) {
          console.warn(`[dump] front-pose data URL parse failed: ${err.message}`);
        }
      }
    }
  }
  if (sourceBuf) {
    fs.writeFileSync(path.join(outDir, '_source.png'), sourceBuf);
  } else {
    console.warn('[dump] no front-pose source image found — _compare.png files will be skipped');
  }

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

    if (sourceBuf && crop.srcBbox) {
      const comparePath = path.join(outDir, `${name}_compare.png`);
      try {
        await makeCompareImage(sourceBuf, crop.srcBbox, buf, comparePath);
        console.log(`[dump] wrote ${comparePath}`);
      } catch (err) {
        console.warn(`[dump] ${name}_compare: ${err.message}`);
      }
    }
  }
  const summaryPath = path.join(outDir, '_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`[dump] wrote ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
