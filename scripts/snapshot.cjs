#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Unified snapshot / inspection CLI for march-mad dev pages.
 *
 * Boots the Vite dev server (or reuses an existing one with --no-server),
 * navigates puppeteer to the requested scene's page, drives `window.__snapshot`
 * through one or more presets, captures a PNG per preset, exits.
 *
 * Usage:
 *   node scripts/snapshot.cjs <scene> <preset> [options]
 *
 * Scenes: face | player    (registered under scripts/snapshot-scenes/)
 *
 * Options:
 *   --face <path>          face JSON to apply (default: F4 default path)
 *   --out <name>           output folder name under scripts/_snapshot-output/
 *   --player-id <id>       player config to load (currently ignored — scene reserves the option)
 *   --no-server            skip starting Vite (assume one is running on :5188)
 *   --headed               show the browser window (default: headless)
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(__dirname, '_snapshot-output');
const SCENES_DIR = path.join(__dirname, 'snapshot-scenes');
const DEFAULT_FACE = 'C:\\Users\\Stephen\\Downloads\\face-2026-05-03T04-03-35.json';
const DEFAULT_PORT = 5188;
const VIEWPORT = { width: 800, height: 800 };
const CAPTURE_SIZE = 400;

function parseArgs(argv) {
  const out = { scene: null, preset: null, opts: {} };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--face') out.opts.face = argv[++i];
    else if (a === '--out') out.opts.out = argv[++i];
    else if (a === '--player-id') out.opts.playerId = argv[++i];
    else if (a === '--no-server') out.opts.noServer = true;
    else if (a === '--headed') out.opts.headed = true;
    else if (a === '--help' || a === '-h') out.opts.help = true;
    else positional.push(a);
  }
  out.scene = positional[0];
  out.preset = positional[1];
  return out;
}

function printUsage() {
  console.log(`
Usage: node scripts/snapshot.cjs <scene> <preset> [options]

Scenes:
  face       — face-rendering page (anim-viewer.html with face applied)
  player     — single-player page (player-editor.html)

Common presets per scene (each scene module advertises its own list):
  face/front, face/3q-left, face/3q-right, face/profile-left,
  face/profile-right, face/jaw-open, face/blink, face/smile, face/all
  player/idle-front, player/idle-3q, player/holding-beer-3q,
  player/holding-beer-hand-closeup, player/walk-front, player/dribble-3q,
  player/head-closeup, player/face-vs-cranium, player/all

Options:
  --face <path>     face JSON to apply (default: ${DEFAULT_FACE})
  --out <name>      output folder under scripts/_snapshot-output/
  --no-server       skip Vite spawn; assume http://localhost:${DEFAULT_PORT} is up
  --headed          show the browser window for debugging
`);
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function loadScene(name) {
  const file = path.join(SCENES_DIR, `${name}.cjs`);
  if (!fs.existsSync(file)) {
    throw new Error(`unknown scene "${name}" (expected ${file})`);
  }
  // eslint-disable-next-line global-require
  return require(file);
}

function expandPreset(scene, presetName) {
  const presets = scene.presets || {};
  const entry = presets[presetName];
  if (entry === undefined) {
    throw new Error(
      `unknown preset "${presetName}" for scene "${scene.name}". ` +
      `Known: ${Object.keys(presets).join(', ')}`,
    );
  }
  // Expand: an `all` preset is an array of preset NAMES; a regular preset is
  // either a single capture object {name?, camera, ...} or an array of capture
  // objects (for multi-shot presets like face-vs-cranium).
  const flatten = (e, fallbackName) => {
    if (Array.isArray(e)) {
      const out = [];
      for (const sub of e) {
        if (typeof sub === 'string') {
          // Reference to another preset by name. Recursively expand.
          out.push(...expandPreset(scene, sub));
        } else {
          out.push({ name: sub.name || fallbackName, ...sub });
        }
      }
      return out;
    }
    if (typeof e === 'string') return expandPreset(scene, e);
    return [{ name: e.name || fallbackName, ...e }];
  };
  return flatten(entry, presetName);
}

function loadFaceJSON(p) {
  if (!fs.existsSync(p)) throw new Error(`Face JSON not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function tryRequireSharp() {
  try { return require('sharp'); } catch { return null; }
}

async function startDevServer(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
      cwd: REPO_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let resolved = false;
    let buffer = '';
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const onChunk = (data) => {
      buffer += data.toString();
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
        const put = store.put(face);
        put.onsuccess = () => resolve({ ok: true });
        put.onerror = () => resolve({ ok: false, err: String(put.error) });
      };
      req.onerror = () => resolve({ ok: false, err: String(req.error) });
    });
  }, faceObj);
  if (!result.ok) throw new Error(`IDB put failed: ${result.err}`);
}

async function captureCanvas(page, outPath) {
  // Use page.screenshot of the canvas bounding box — proven path from
  // verify-face-render.cjs. Avoids the preserveDrawingBuffer + toDataURL
  // edge cases entirely. We crop to a center-square so the side panel
  // (when present, e.g. player-editor) is excluded.
  const canvasHandle = await page.$('canvas');
  if (!canvasHandle) throw new Error('no canvas on page');
  const box = await canvasHandle.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const side = Math.min(box.width, box.height);
  const clip = {
    x: Math.round(box.x + (box.width - side) / 2),
    y: Math.round(box.y + (box.height - side) / 2),
    width: Math.round(side),
    height: Math.round(side),
  };
  await page.screenshot({ path: outPath, clip });
  // Resize via sharp when available — keeps PNGs in the parent's
  // Read-tool decode budget. Skip silently when sharp is missing.
  const sharp = tryRequireSharp();
  if (sharp) {
    const buf = await sharp(outPath)
      .resize(CAPTURE_SIZE, CAPTURE_SIZE, { fit: 'cover' })
      .png()
      .toBuffer();
    fs.writeFileSync(outPath, buf);
  }
  return fs.statSync(outPath).size;
}

// Drive a single capture object — applies camera + scene-specific knobs
// (face/anim/blendshapes/beer), then screenshots.
async function applyCaptureAndShoot(page, capture, outDir, errors) {
  const label = capture.name;
  const outPath = path.join(outDir, `${label}.png`);
  // Push the capture spec into the page and let __snapshot apply it.
  const apiResult = await page.evaluate(async (cap) => {
    const api = window.__snapshot;
    if (!api) return { ok: false, err: '__snapshot not installed' };
    try {
      // 1. anim state (must precede camera resolution since target
      //    bones move when the rig animates)
      if (cap.animState && api.setAnimState) {
        api.setAnimState(cap.animState, cap.freezeAnim ? { freeze: true } : undefined);
      }
      if (cap.stepFrames && api.stepFrames) {
        await api.stepFrames(cap.stepFrames);
      }
      // 2. blendshapes
      if (api.resetBlendshapes) api.resetBlendshapes();
      if (cap.blendshapes && api.setBlendshape) {
        for (const k of Object.keys(cap.blendshapes)) {
          api.setBlendshape(k, cap.blendshapes[k]);
        }
      }
      // 3. beer
      if (typeof cap.beer === 'boolean' && api.setBeer) {
        api.setBeer(cap.beer);
      }
      // 4. camera (after rig pose lands so logical targets resolve correctly)
      if (cap.camera) {
        await api.setCamera(cap.camera);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, err: String(err && err.message ? err.message : err) };
    }
  }, capture);
  if (!apiResult.ok) {
    errors.push(`[apply] ${label}: ${apiResult.err}`);
    return { name: label, path: outPath, bytes: 0, ok: false };
  }
  // Frame settle — single rAF should be enough since setCamera awaits one.
  await new Promise((r) => setTimeout(r, 80));
  try {
    const bytes = await captureCanvas(page, outPath);
    return { name: label, path: outPath, bytes, ok: true };
  } catch (err) {
    errors.push(`[capture] ${label}: ${err.message}`);
    return { name: label, path: outPath, bytes: 0, ok: false };
  }
}

async function runScene({ baseUrl, browser, scene, captures, outDir, faceObj, errors }) {
  ensureDir(outDir);
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning') errors.push(`[${t}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  page.on('requestfailed', (req) => {
    errors.push(`[requestfailed] ${req.url()} :: ${req.failure()?.errorText ?? ''}`);
  });

  // Land on face-editor first when a face is provided — shares the IDB
  // origin and lets us drop the FaceImage in without the file-input dance.
  // Scenes that mark `needsFace: true` REQUIRE one; scenes like "player"
  // accept an optional face — when faceObj is null we skip the IDB step.
  if (scene.needsFace && !faceObj) {
    throw new Error(`scene "${scene.name}" needs a face — pass --face <path>`);
  }
  if (faceObj) {
    await page.goto(`${baseUrl}/face-editor.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 600));
    await importFaceIntoIDB(page, faceObj);
    // Pre-seed the per-page face-selection localStorage keys so that when
    // each editor's auto-populate finishes, it RESTORES the same face name
    // we're about to apply — avoids a race where populateFaceSelect resolves
    // late and silently re-clears the face we just set.
    await page.evaluate((name) => {
      try {
        localStorage.setItem('devpanel:anim-viewer:face', name);
        localStorage.setItem('devpanel:player-editor:face', name);
      } catch { /* ignore */ }
    }, faceObj.name);
  }

  await page.goto(`${baseUrl}${scene.page}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for __snapshot to land (banner is logged on install).
  await page.waitForFunction(() => !!window.__snapshot, { timeout: 30000 });
  await page.evaluate(async () => { await window.__snapshot.ready(); });

  // Apply the face when one is present (works for both face + player scenes).
  if (faceObj) {
    // Anim-viewer auto-rotates by default — toggle it off so manual camera
    // positions stick. Harmless on pages without the checkbox.
    await page.evaluate(() => {
      const cb = document.getElementById('auto-rotate');
      if (cb && cb.checked) cb.click();
    });
    // Wait for each page's auto-populate path to finish restoring the
    // pre-seeded localStorage face. This avoids a race where the populate
    // resolves AFTER our explicit setFace and overwrites it. We refresh
    // the dropdown (anim-viewer has __animViewerDebug.refreshFaceList) and
    // then call setFace explicitly — the redundant call is harmless but
    // guarantees the face lands even if the restore path didn't.
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(async (faceName) => {
      const dbg = window.__animViewerDebug;
      if (dbg && dbg.refreshFaceList) await dbg.refreshFaceList();
      const api = window.__snapshot;
      if (api && api.setFace) await api.setFace(faceName);
    }, faceObj.name);

    // Best-effort wait for the 3D mesh on either anim-viewer or
    // player-editor (each exposes hasMesh3D on its own debug global). If
    // neither is present, fall through to the fixed settle delay.
    try {
      await page.waitForFunction(
        () => {
          const dbg = window.__animViewerDebug || window.__playerEditorDebug;
          if (!dbg || !dbg.hasMesh3D) return true; // page doesn't expose probe
          return dbg.hasMesh3D() === true;
        },
        { timeout: 5000 },
      );
    } catch {
      errors.push(`[warn] no mesh3D mounted for "${faceObj.name}" — capturing flat-face fallback`);
    }
    // Geometry/material settle so the head-mesh build flushes before captures.
    await new Promise((r) => setTimeout(r, 400));
  }

  const captured = [];
  for (const cap of captures) {
    const r = await applyCaptureAndShoot(page, cap, outDir, errors);
    captured.push(r);
  }
  await page.close();
  return captured;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.opts.help || !args.scene || !args.preset) {
    printUsage();
    process.exit(args.opts.help ? 0 : 2);
  }

  let scene;
  try {
    scene = loadScene(args.scene);
  } catch (err) {
    console.error(`[FAIL] ${err.message}`);
    process.exit(2);
  }

  let captures;
  try {
    captures = expandPreset(scene, args.preset);
  } catch (err) {
    console.error(`[FAIL] ${err.message}`);
    process.exit(2);
  }

  // Resolve face: required when scene.needsFace is true, optional otherwise.
  // The player scene supports --face but doesn't require it (default eyes
  // when omitted). The face scene errors out if --face is missing AND the
  // default file isn't on disk — guards against silent confusion.
  let faceObj = null;
  const faceArgGiven = !!args.opts.face;
  if (scene.needsFace || faceArgGiven) {
    const facePath = args.opts.face || DEFAULT_FACE;
    if (!require('fs').existsSync(facePath)) {
      if (scene.needsFace) {
        console.error(`[FAIL] face JSON not found: ${facePath}`);
        process.exit(2);
      }
      // Optional face — silently skip when default missing AND no --face.
    } else {
      faceObj = loadFaceJSON(facePath);
      if (!faceObj.name) {
        console.error(`[FAIL] FaceImage missing 'name' field: ${facePath}`);
        process.exit(2);
      }
    }
  }

  const runTag = args.opts.out || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(OUTPUT_ROOT, runTag);
  ensureDir(outDir);

  let server = null;
  let baseUrl = `http://localhost:${DEFAULT_PORT}`;
  if (!args.opts.noServer) {
    console.log('[snapshot] starting Vite dev server...');
    server = await startDevServer(DEFAULT_PORT);
    baseUrl = server.url;
    console.log(`[snapshot] server up at ${baseUrl}`);
  } else {
    console.log(`[snapshot] reusing server at ${baseUrl}`);
  }

  let browser;
  const errors = [];
  let captured = [];
  try {
    browser = await puppeteer.launch({
      headless: args.opts.headed ? false : 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    captured = await runScene({
      baseUrl, browser, scene, captures, outDir, faceObj, errors,
    });
  } catch (err) {
    console.error(`[FAIL] scene=${args.scene} preset=${args.preset}: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
    if (server) server.kill();
    process.exit(2);
  }

  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();

  // ───── Summary ─────
  console.log('');
  console.log('───────────────────────────────────────');
  console.log(`Scene  : ${args.scene}`);
  console.log(`Preset : ${args.preset}`);
  console.log(`Output : ${outDir}`);
  console.log('───────────────────────────────────────');
  let failed = 0;
  for (const c of captured) {
    const kb = (c.bytes / 1024).toFixed(1);
    const flag = !c.ok ? ' [FAIL]' : c.bytes < 5 * 1024 ? ' [TINY]' : '';
    if (!c.ok) failed++;
    console.log(`  ${c.name.padEnd(30)} ${kb} KB${flag}`);
    console.log(`    ${c.path}`);
  }
  if (errors.length > 0) {
    console.log('');
    console.log(`Browser console (${errors.length} entries):`);
    for (const e of errors.slice(0, 20)) console.log(`  - ${e}`);
    if (errors.length > 20) console.log(`  (... ${errors.length - 20} more)`);
  }
  if (failed > 0) {
    console.error(`[FAIL] ${failed}/${captured.length} captures failed`);
    process.exit(2);
  }
  console.log('');
  console.log(`Done — ${captured.length} PNG(s).`);
})().catch((err) => {
  console.error('[FAIL] fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});
