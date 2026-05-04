/**
 * Phase F3 — Reprocess a FaceImage JSON via the in-browser pipeline.
 *
 * Usage:
 *   node scripts/reprocess-face.cjs <path-to-face.json>
 *
 * Output:
 *   <path-to-face>.reprocessed.json (same dir, suffix replaces .json)
 *
 * Why puppeteer? `reprocessFace` uses browser APIs (Image, Canvas,
 * getImageData) via `loadImageToCanvas`. Rather than introduce node-canvas
 * as a dep, we drive the existing face-editor.html dev server via
 * puppeteer: navigate, inject the JSON, call `reprocessFace` from the
 * page context, read back the result, write to disk.
 *
 * The dev server (`vite`) must be running on http://localhost:5173 — we
 * try a couple ports and bail with a useful message if nothing answers.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const CANDIDATE_URLS = [
  'http://localhost:5173/face-editor.html',
  'http://localhost:5174/face-editor.html',
  'http://localhost:4173/face-editor.html',
];

async function pickReachableUrl(browser) {
  const page = await browser.newPage();
  for (const url of CANDIDATE_URLS) {
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });
      if (resp && resp.ok()) {
        await page.close();
        return url;
      }
    } catch {
      /* try next */
    }
  }
  await page.close();
  return null;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/reprocess-face.cjs <path-to-face.json>');
    process.exit(1);
  }
  if (!fs.existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(inputPath, 'utf8');
  let face;
  try {
    face = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to parse input JSON: ${err.message}`);
    process.exit(1);
  }

  console.log(`[reprocess] launching puppeteer...`);
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const url = await pickReachableUrl(browser);
    if (!url) {
      console.error(
        '[reprocess] No dev server reachable on 5173/5174/4173. Run `npm run dev` in another terminal first.',
      );
      process.exit(1);
    }
    console.log(`[reprocess] using ${url}`);
    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        console.log(`[page ${msg.type()}] ${msg.text()}`);
      }
    });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for the page to attach `reprocessFace` to window — the
    // face-editor module imports it but doesn't expose it globally. We
    // import the module directly via dynamic import inside the page.
    const result = await page.evaluate(async (faceJson) => {
      // Import the source module directly (Vite serves source files in dev).
      const mod = await import('/src/dev/face/reprocess.ts');
      const out = await mod.reprocessFace(faceJson);
      return out;
    }, face);

    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const outPath = path.join(dir, `${base}.reprocessed.json`);
    fs.writeFileSync(outPath, JSON.stringify(result.face, null, 2), 'utf8');
    console.log(`[reprocess] wrote ${outPath}`);

    const populated = Object.entries(result.diagnostics)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const missing = Object.entries(result.diagnostics)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    const total = Object.keys(result.diagnostics).length;
    console.log(`[reprocess] sampled ${populated.length}/${total} features:`);
    console.log(`  populated: ${populated.join(', ') || '(none)'}`);
    console.log(`  missing:   ${missing.join(', ') || '(none)'}`);
    if (result.warnings.length > 0) {
      console.log(`[reprocess] warnings:`);
      for (const w of result.warnings) console.log(`  - ${w}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
