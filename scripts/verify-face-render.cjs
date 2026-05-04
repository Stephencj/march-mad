#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * F4 visual verification harness.
 *
 * Boots the Vite dev server, imports a FaceImage JSON into the face-editor's
 * IndexedDB, then loads /anim-viewer.html and screenshots the rig from
 * 5 camera angles + 6 blendshape states for visual review.
 *
 * Usage:
 *   node scripts/verify-face-render.cjs [face1.json] [face2.json]
 *
 * Outputs:
 *   scripts/_verify-output/<face-name>/<scenario>.png
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(__dirname, '_verify-output');
const DEFAULT_FACE = 'C:\\Users\\Stephen\\Downloads\\face-2026-05-03T04-03-35.json';
const VIEWPORT = { width: 800, height: 800 };
const CAPTURE_SIZE = 400; // resize after screenshot via clip

// ───── Camera matrix (yaw radians around the head, pitch ≈ 0 = level) ─────
// Yaw=0 looks at the BACK of the head (camera at +z), so we offset by π so
// "front" looks at the player's face. The player rig faces +z by default.
// Subject left/right uses subject's perspective: 3/4-left = camera on
// subject's left side at 45°. Distance 2.4m gives a head-and-shoulders frame.
const CAM_DIST = 2.4;
const CAM_PITCH = 0.05;
const CAMERA_ANGLES = [
  { name: 'front',         yaw: 0,                       pitch: CAM_PITCH },
  { name: '3q-left',       yaw: -Math.PI / 4,            pitch: CAM_PITCH },
  { name: '3q-right',      yaw:  Math.PI / 4,            pitch: CAM_PITCH },
  { name: 'profile-left',  yaw: -Math.PI / 2,            pitch: CAM_PITCH },
  { name: 'profile-right', yaw:  Math.PI / 2,            pitch: CAM_PITCH },
];

// ───── Blendshape matrix (all from front view) ─────
const BLENDSHAPE_STATES = [
  { name: 'rest',          shapes: {} },
  { name: 'jawOpen',       shapes: { jawOpen: 1.0 } },
  { name: 'mouthSmile',    shapes: { mouthSmileLeft: 1.0, mouthSmileRight: 1.0 } },
  { name: 'eyeBlink',      shapes: { eyeBlinkLeft: 1.0, eyeBlinkRight: 1.0 } },
  { name: 'browInnerUp',   shapes: { browInnerUp: 1.0 } },
  { name: 'mouthPucker',   shapes: { mouthPucker: 1.0 } },
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function loadFaceJSON(p) {
  if (!fs.existsSync(p)) {
    throw new Error(`Face JSON not found: ${p}`);
  }
  const raw = fs.readFileSync(p, 'utf8');
  return { obj: JSON.parse(raw), text: raw, path: p };
}

// Boot the Vite dev server. Returns { url, kill }.
async function startDevServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', 'dev', '--', '--port', '5188'], {
      cwd: REPO_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let resolved = false;
    let buffer = '';
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const onChunk = (data) => {
      const s = data.toString();
      buffer += s;
      // Vite logs e.g. "Local:   http://localhost:5188/"  — but with ANSI
      // color escapes stitched into "Local" / between segments. Strip first.
      const clean = stripAnsi(buffer);
      const m = clean.match(/(http:\/\/localhost:\d+)\/?/);
      if (m && !resolved) {
        resolved = true;
        resolve({
          url: m[1],
          kill: () => {
            try {
              if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', proc.pid, '/f', '/t'], { shell: true });
              } else {
                proc.kill('SIGTERM');
              }
            } catch { /* ignore */ }
          },
        });
      }
    };
    proc.stdout.on('data', onChunk);
    proc.stderr.on('data', onChunk);
    proc.on('exit', (code) => {
      if (!resolved) reject(new Error(`vite exited early (code=${code})\n${buffer.slice(-2000)}`));
    });
    setTimeout(() => {
      if (!resolved) reject(new Error(`vite startup timeout\n${buffer.slice(-2000)}`));
    }, 60000);
  });
}

// Push a FaceImage JSON object straight into the page's IndexedDB. Bypasses
// the file-input dance because we already have the parsed JSON in Node and
// the schema check + saveFace path is well-tested.
async function importFaceIntoIDB(page, faceObj) {
  const result = await page.evaluate(async (face) => {
    return new Promise((resolve) => {
      const req = indexedDB.open('march-mad-faces', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'name' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('images', 'readwrite');
        const store = tx.objectStore('images');
        const putReq = store.put(face);
        putReq.onsuccess = () => resolve({ ok: true });
        putReq.onerror = () => resolve({ ok: false, err: String(putReq.error) });
      };
      req.onerror = () => resolve({ ok: false, err: String(req.error) });
    });
  }, faceObj);
  if (!result.ok) throw new Error(`IDB put failed: ${result.err}`);
}

async function captureFace(browser, baseUrl, faceObj, outDir, errors) {
  ensureDir(outDir);
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') {
      errors.push(`[${t}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  page.on('requestfailed', (req) => {
    errors.push(`[requestfailed] ${req.url()} :: ${req.failure()?.errorText ?? ''}`);
  });

  // 1. Land on face-editor first so we share the IDB origin and let
  //    Vite warm-load all face modules. No interactive UI needed — we
  //    write the FaceImage straight into IDB.
  await page.goto(`${baseUrl}/face-editor.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Give the bundle a beat to register modules + stand up the IDB schema.
  await sleep(800);
  await importFaceIntoIDB(page, faceObj);

  // 2. Now load the anim viewer. The FACE_LS_KEY default is empty, so the
  //    dropdown lands on "(none)" — we trigger applyFaceByName explicitly.
  await page.goto(`${baseUrl}/anim-viewer.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for the debug hook to be installed (anim-viewer.ts appends it
  // unconditionally at module-init bottom).
  await page.waitForFunction(
    () => !!(window).__animViewerDebug,
    { timeout: 30000 },
  );

  // Auto-rotate OFF so manual camera positions stick.
  await page.evaluate(() => {
    const cb = document.getElementById('auto-rotate');
    if (cb && cb.checked) cb.click();
  });

  // Refresh the face dropdown so it picks up the freshly imported face,
  // then apply it programmatically. Wait for builtFaceMeshCache to land.
  await page.evaluate(async (faceName) => {
    const dbg = (window).__animViewerDebug;
    await dbg.refreshFaceList();
    await dbg.applyFaceByName(faceName);
  }, faceObj.name);

  // Wait until the 3D mesh is mounted (or 5 s, whichever comes first —
  // some uploads have no mesh3d, in which case we still capture the flat
  // face fallback so the harness produces output).
  try {
    await page.waitForFunction(
      () => (window).__animViewerDebug?.hasMesh3D() === true,
      { timeout: 5000 },
    );
  } catch {
    errors.push(`[warn] no mesh3D mounted for "${faceObj.name}" — capturing flat-face fallback`);
  }

  // Settle frame so geometry/material updates flush before screenshot.
  await sleep(400);

  const canvasHandle = await page.$('#viewer-canvas');
  if (!canvasHandle) throw new Error('viewer-canvas not found');

  // Helper: screenshot canvas, post-process to ~400px square.
  async function shoot(label) {
    const fullPath = path.join(outDir, `${label}.png`);
    // Crop to the canvas bounding box so the side panel is excluded.
    const box = await canvasHandle.boundingBox();
    if (!box) throw new Error('canvas has no bounding box');
    // Center-square crop of the canvas.
    const side = Math.min(box.width, box.height);
    const clip = {
      x: Math.round(box.x + (box.width - side) / 2),
      y: Math.round(box.y + (box.height - side) / 2),
      width: Math.round(side),
      height: Math.round(side),
    };
    await page.screenshot({ path: fullPath, clip });
    // Resize to ~400×400 for the parent's Read-tool decode budget. Keep
    // the original on disk if puppeteer can't resize — we only have
    // sharp as a devDep; use it when available.
    try {
      // Lazy require so harness still runs if sharp is missing.
      const sharp = require('sharp');
      const buf = await sharp(fullPath)
        .resize(CAPTURE_SIZE, CAPTURE_SIZE, { fit: 'cover' })
        .png()
        .toBuffer();
      fs.writeFileSync(fullPath, buf);
    } catch (err) {
      // sharp not available — that's fine, just leave the larger file.
      errors.push(`[warn] sharp resize skipped: ${err.message}`);
    }
    const stat = fs.statSync(fullPath);
    return { path: fullPath, bytes: stat.size };
  }

  const captured = [];

  // 3. Camera-angle matrix at rest.
  await page.evaluate(() => {
    (window).__animViewerDebug.resetBlendshapes();
  });
  for (const ang of CAMERA_ANGLES) {
    await page.evaluate((yaw, pitch, dist) => {
      (window).__animViewerDebug.setCameraAngle(yaw, pitch, dist);
    }, ang.yaw, ang.pitch, CAM_DIST);
    await sleep(150); // let one rAF tick land
    const r = await shoot(`cam-${ang.name}`);
    captured.push({ scenario: `cam-${ang.name}`, ...r });
  }

  // 4. Blendshape matrix from front view.
  await page.evaluate((yaw, pitch, dist) => {
    (window).__animViewerDebug.setCameraAngle(yaw, pitch, dist);
  }, 0, CAM_PITCH, CAM_DIST);
  for (const state of BLENDSHAPE_STATES) {
    await page.evaluate((shapes) => {
      const dbg = (window).__animViewerDebug;
      dbg.resetBlendshapes();
      for (const [k, v] of Object.entries(shapes)) {
        dbg.applyBlendshape(k, v);
      }
    }, state.shapes);
    await sleep(150);
    const r = await shoot(`bs-${state.name}`);
    captured.push({ scenario: `bs-${state.name}`, ...r });
  }

  await page.close();
  return captured;
}

(async () => {
  const arg1 = process.argv[2] || DEFAULT_FACE;
  const arg2 = process.argv[3];
  const inputs = [arg1, arg2].filter(Boolean);

  console.log('[F4] inputs:');
  for (const p of inputs) console.log(`      ${p}`);

  const faces = inputs.map((p) => {
    const { obj, path: full } = loadFaceJSON(p);
    if (!obj.name) throw new Error(`FaceImage missing 'name' field: ${full}`);
    return { obj, baseName: path.basename(full, '.json') };
  });

  ensureDir(OUTPUT_ROOT);

  console.log('[F4] starting Vite dev server...');
  const server = await startDevServer();
  console.log(`[F4] server up at ${server.url}`);

  let browser;
  const allErrors = [];
  const summary = [];
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    for (const face of faces) {
      const outDir = path.join(OUTPUT_ROOT, face.baseName);
      console.log(`[F4] capturing "${face.obj.name}" → ${outDir}`);
      const errors = [];
      const captured = await captureFace(browser, server.url, face.obj, outDir, errors);
      summary.push({ face: face.baseName, captured, errors });
      allErrors.push(...errors.map((e) => `[${face.baseName}] ${e}`));
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }

  // ───── Report ─────
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' F4 verification-harness summary');
  console.log('═══════════════════════════════════════════════════════════');
  for (const entry of summary) {
    console.log(`\nFace: ${entry.face}`);
    console.log(`  Captured ${entry.captured.length} screenshot(s):`);
    let small = 0;
    for (const c of entry.captured) {
      const kb = (c.bytes / 1024).toFixed(1);
      const flag = c.bytes < 5 * 1024 ? ' [TINY]' : '';
      if (c.bytes < 5 * 1024) small++;
      console.log(`    - ${c.scenario.padEnd(20)} ${kb} KB${flag}`);
    }
    if (small > 0) console.log(`  WARN: ${small} screenshot(s) < 5KB (likely blank).`);
    if (entry.errors.length === 0) {
      console.log('  Browser console: clean.');
    } else {
      console.log(`  Browser console errors (${entry.errors.length}):`);
      for (const e of entry.errors.slice(0, 20)) {
        console.log(`    - ${e}`);
      }
      if (entry.errors.length > 20) {
        console.log(`    (... ${entry.errors.length - 20} more)`);
      }
    }
  }
  console.log('\nDone. Output: ' + OUTPUT_ROOT);

  // Non-zero exit if anything obviously broke.
  const totalCaptured = summary.reduce((s, e) => s + e.captured.length, 0);
  const expected = faces.length * (CAMERA_ANGLES.length + BLENDSHAPE_STATES.length);
  if (totalCaptured < expected) {
    console.error(`[F4] expected ${expected} screenshots, got ${totalCaptured}`);
    process.exitCode = 2;
  }
})().catch((err) => {
  console.error('[F4] fatal:', err);
  process.exitCode = 1;
});
