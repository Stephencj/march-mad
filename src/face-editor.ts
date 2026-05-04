/**
 * Face editor entry point.
 *
 * Wires DOM controls in `face-editor.html` to the face capture engine
 * (`./dev/face/capture.ts`) and the IndexedDB store (`./dev/face/store.ts`).
 *
 * Phase 7 only — capture + persist `FaceImage` records (webcam snapshot OR
 * uploaded still). The "apply to player" path lives in player-editor /
 * anim-viewer; this page is a face-library manager. No 3D rendering.
 */
import {
  FaceCapture,
  coreFaceBoundingBox,
  FACE_CROP_PAD_TOP,
  FACE_CROP_PAD_BOTTOM,
  FACE_CROP_PAD_SIDES,
} from './dev/face/capture';
import {
  saveFace,
  loadFace,
  listFaces,
  deleteFace,
  exportFaceJSON,
  importFaceJSON,
  type FaceMeta,
} from './dev/face/store';
import type { FaceImage } from './dev/face/types';
import type { FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import {
  FaceScanner,
  type CapturedAngle,
  SCAN_TARGETS,
  type ScanProgressDetail,
} from './dev/face/scan';
import { buildFaceMesh, flattenLandmarks, type BuiltFaceMesh } from './dev/face/mesh-builder';
import { createFaceMeshPreview, type FaceMeshPreview } from './dev/face/mesh-3d-preview';
import { sampleIrisColors } from './dev/face/iris-color';
import { reprocessFace } from './dev/face/reprocess';
import {
  setVoiceEnabled,
  speakNow,
  speakPoseInstruction,
  speakLightingWarning,
  resetSpokenState,
  beep,
} from './dev/face/scan-voice';

// --- DOM ---
const videoEl = document.getElementById('webcam') as HTMLVideoElement;
const overlayEl = document.getElementById('overlay') as HTMLCanvasElement;
const nameEl = document.getElementById('face-name') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLDivElement;
const btnCamera = document.getElementById('btn-camera') as HTMLDivElement;
const btnSnapshot = document.getElementById('btn-snapshot') as HTMLDivElement;
const btnScan3D = document.getElementById('btn-scan-3d') as HTMLDivElement;
const btnUpload = document.getElementById('btn-upload') as HTMLDivElement;
const btnImport = document.getElementById('btn-import') as HTMLDivElement;
const uploadFileEl = document.getElementById('upload-file') as HTMLInputElement;
const importFileEl = document.getElementById('import-file') as HTMLInputElement;
const dropZoneEl = document.getElementById('drop-zone') as HTMLDivElement;
const gridEl = document.getElementById('face-grid') as HTMLDivElement;
// Phase 7.6 — 3D scan overlay + post-scan preview DOM.
const scanOverlay = document.getElementById('scan-overlay') as HTMLDivElement;
const scanStepEl = document.getElementById('scan-step') as HTMLDivElement;
const scanInstrEl = document.getElementById('scan-instruction') as HTMLDivElement;
const scanStatusEl = document.getElementById('scan-status') as HTMLDivElement;
const scanProgressFillEl = document.getElementById('scan-progress-fill') as HTMLDivElement;
const scanCancelBtn = document.getElementById('scan-cancel') as HTMLDivElement;
// Phase 7.8.1 — pose-delta UI + voice toggle.
const scanTargetIconEl = document.getElementById('scan-target-icon') as HTMLDivElement;
const scanPoseFeedbackEl = document.getElementById('scan-pose-feedback') as HTMLDivElement;
const scanArrowEl = document.getElementById('scan-arrow') as HTMLSpanElement;
const scanDeltaEl = document.getElementById('scan-delta') as HTMLSpanElement;
const scanNoFaceEl = document.getElementById('scan-no-face') as HTMLDivElement;
const scanLightingEl = document.getElementById('scan-lighting') as HTMLDivElement;
const scanVoiceToggleEl = document.getElementById('scan-voice-toggle') as HTMLInputElement;
const meshPreviewContainer = document.getElementById('mesh-preview-container') as HTMLDivElement;
const meshPreviewHost = document.getElementById('mesh-preview-canvas-host') as HTMLDivElement;
const meshAcceptBtn = document.getElementById('mesh-preview-accept') as HTMLDivElement;
const meshRedoBtn = document.getElementById('mesh-preview-redo') as HTMLDivElement;

// --- State ---
const capture = new FaceCapture(videoEl);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

// --- Helpers ---
function setStatus(text: string): void {
  statusEl.textContent = text;
}
function setError(msg: string): void {
  errorEl.textContent = msg;
}
function clearError(): void {
  errorEl.textContent = '';
}
function showToast(msg: string, durationMs = 4000): void {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove('show');
  }, durationMs);
}
function setBtnEnabled(btn: HTMLDivElement, enabled: boolean): void {
  if (enabled) btn.classList.remove('disabled');
  else btn.classList.add('disabled');
}

function defaultFaceName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `face-${stamp}`;
}

function getOrDefaultName(): string {
  const v = nameEl.value.trim();
  return v || defaultFaceName();
}

function resizeOverlay(): void {
  // Match the overlay canvas to its CSS box so the bbox draw lands aligned
  // with the video frame.
  const rect = overlayEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const dpr = window.devicePixelRatio || 1;
  overlayEl.width = Math.round(rect.width * dpr);
  overlayEl.height = Math.round(rect.height * dpr);
  const ctx = overlayEl.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeOverlay);
resizeOverlay();

/** Draw the detected face bbox on the live preview. The video element is
 *  CSS-mirrored via scaleX(-1), and so is the overlay — landmarks are in
 *  un-mirrored image space, so we just draw in image-space directly and
 *  the CSS transform handles the visual flip. */
function drawBboxOverlay(result: FaceLandmarkerResult, video: HTMLVideoElement): void {
  const ctx = overlayEl.getContext('2d');
  if (!ctx) return;
  const cssW = overlayEl.clientWidth;
  const cssH = overlayEl.clientHeight;
  ctx.clearRect(0, 0, cssW, cssH);
  const lm = result.faceLandmarks?.[0];
  if (!lm || lm.length === 0) return;

  // The video is `object-fit: contain` — compute the letterboxed render box.
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw === 0 || vh === 0) return;
  const scale = Math.min(cssW / vw, cssH / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const offX = (cssW - drawW) * 0.5;
  const offY = (cssH - drawH) * 0.5;

  // Use the same 4-landmark "core face" bbox the capture pipeline uses.
  // Drawing this directly (rather than the all-landmark min/max box) keeps
  // the live preview honest about what will actually be detected + cropped.
  const bbox = coreFaceBoundingBox(lm);
  if (!bbox) return;
  const x = offX + bbox.left * drawW;
  const y = offY + bbox.top * drawH;
  const w = (bbox.right - bbox.left) * drawW;
  const h = (bbox.bottom - bbox.top) * drawH;

  // Solid green: the detected core-face bbox (forehead → chin, ear → ear).
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#3ddc7e';
  ctx.strokeRect(x, y, w, h);

  // Dashed yellow: the padded crop preview — what will actually be saved.
  // Math here mirrors padToSquarePixels (sans the squaring step, which is
  // hard to render meaningfully in 0..1 letterbox coords without knowing
  // the source aspect ratio; the rectangle preview is "before squaring").
  const px = x - w * FACE_CROP_PAD_SIDES;
  const py = y - h * FACE_CROP_PAD_TOP;
  const pw = w * (1 + 2 * FACE_CROP_PAD_SIDES);
  const ph = h * (1 + FACE_CROP_PAD_TOP + FACE_CROP_PAD_BOTTOM);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#ffd700';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(px, py, pw, ph);
  ctx.setLineDash([]);
}

// --- Camera button ---
btnCamera.addEventListener('click', async () => {
  if (capture.isCameraStarted()) return;
  if (btnCamera.classList.contains('disabled')) return;
  setBtnEnabled(btnCamera, false);
  setStatus('Loading model + camera...');
  clearError();
  try {
    await capture.startCamera((result, video) => {
      resizeOverlay();
      drawBboxOverlay(result, video);
    });
    btnCamera.textContent = 'Camera ready';
    btnCamera.classList.add('active');
    setBtnEnabled(btnSnapshot, true);
    setBtnEnabled(btnScan3D, true);
    setStatus('Camera ready. Frame your face + click Snapshot, or 3D Scan.');
  } catch (err) {
    setBtnEnabled(btnCamera, true);
    const msg = err instanceof Error ? err.message : String(err);
    setStatus('Camera failed.');
    setError(msg);
  }
});

// --- Snapshot button ---
btnSnapshot.addEventListener('click', async () => {
  if (btnSnapshot.classList.contains('disabled')) return;
  if (!capture.isCameraStarted()) return;
  clearError();
  const name = getOrDefaultName();
  // Disallow silent overwrite.
  const existing = await loadFace(name);
  if (existing && !confirm(`Face "${name}" exists. Overwrite?`)) return;
  setBtnEnabled(btnSnapshot, false);
  try {
    const face = await capture.snapshot({ name });
    await saveFace(face);
    setStatus(`Saved "${face.name}".`);
    nameEl.value = '';
    nameEl.placeholder = defaultFaceName();
    await refreshGrid();
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    setStatus('Snapshot failed.');
    setError(m);
  } finally {
    setBtnEnabled(btnSnapshot, true);
  }
});

// =============================================================================
// 3D SCAN FLOW (Phase 7.6)
// User clicks "3D Scan" → 5 guided poses (front/left/right/up/down) → build a
// 3D BufferGeometry from the front-pose landmarks, texture from the front-pose
// photo → preview in a small Three.js canvas → Accept persists with mesh3d
// populated, Redo restarts the scan from pose 1.
// =============================================================================

let scanner: FaceScanner | null = null;
let scanResultAngles: CapturedAngle[] | null = null;
let meshPreview: FaceMeshPreview | null = null;
let pendingBuiltMesh: BuiltFaceMesh | null = null;

function showScanOverlay(show: boolean): void {
  if (show) scanOverlay.classList.add('show');
  else scanOverlay.classList.remove('show');
}
function showMeshPreview(show: boolean): void {
  if (show) meshPreviewContainer.classList.add('show');
  else meshPreviewContainer.classList.remove('show');
}

/** Tracks scan-loop UX state across frames — needed because the progress
 *  callback is the only signal we get and we have to detect *transitions*
 *  (step advanced → "captured" beep + voice; halfway-hold tick; pose
 *  changed → speak the new instruction). Reset by `resetScanUiState()`
 *  whenever a fresh scan starts. */
let prevScanStep = -1;
let prevHoldProgress = 0;
let prevPose: string | null = null;
/** Lighting-warning state. We track the wall-clock time we *first* saw
 *  imgMean drop below LIGHTING_DARK_THRESHOLD; a warning fires only after
 *  it stays below for LIGHTING_DARK_HOLD_MS. The "soft hint" band fires
 *  immediately (no hold) — it's just a tone, not an interruption. */
let lightingDarkSinceMs: number | null = null;
let lightingWarnShown = false;
const LIGHTING_DARK_THRESHOLD = 60;
const LIGHTING_OK_THRESHOLD = 90;
const LIGHTING_DARK_HOLD_MS = 2000;

function resetScanUiState(): void {
  prevScanStep = -1;
  prevHoldProgress = 0;
  prevPose = null;
  lightingDarkSinceMs = null;
  lightingWarnShown = false;
  // Reset the overlay to its idle state.
  scanLightingEl.setAttribute('data-level', 'ok');
  scanLightingEl.textContent = '';
}

/**
 * Update the live lighting advisory based on the latest imgMean. Three
 * bands:
 *   imgMean < 60      → "warn": dark; show after LIGHTING_DARK_HOLD_MS of
 *                       sustained darkness; speak the voice prompt once.
 *   60 ≤ imgMean < 90 → "hint": workable but suboptimal; show immediately,
 *                       no voice (would get annoying mid-pose).
 *   imgMean ≥ 90      → "ok":   clear the advisory and reset the dark-hold
 *                       timer.
 *   imgMean === null  → leave whatever was previously shown (no signal).
 */
function updateLightingAdvisory(imgMean: number | null, nowMs: number): void {
  if (imgMean === null) return;
  if (imgMean >= LIGHTING_OK_THRESHOLD) {
    lightingDarkSinceMs = null;
    lightingWarnShown = false;
    scanLightingEl.setAttribute('data-level', 'ok');
    scanLightingEl.textContent = '';
    return;
  }
  if (imgMean >= LIGHTING_DARK_THRESHOLD) {
    // Soft hint band — show immediately, no voice prompt.
    lightingDarkSinceMs = null;
    lightingWarnShown = false;
    scanLightingEl.setAttribute('data-level', 'hint');
    scanLightingEl.innerHTML =
      '<span class="icon">&#9888;</span>Lighting could be brighter for best results';
    return;
  }
  // Dark band — start the hold timer if not already armed.
  if (lightingDarkSinceMs === null) {
    lightingDarkSinceMs = nowMs;
  }
  if (nowMs - lightingDarkSinceMs >= LIGHTING_DARK_HOLD_MS) {
    if (!lightingWarnShown) {
      lightingWarnShown = true;
      // Speak once per scan; the helper is internally deduped too.
      speakLightingWarning();
    }
    scanLightingEl.setAttribute('data-level', 'warn');
    scanLightingEl.innerHTML =
      '<span class="icon">&#9888;</span>Lighting too dark &mdash; consider moving to better light';
  }
  // (else: still inside the hold window — keep whatever was previously
  // shown. If we were on "hint" before dropping into the dark band the
  // user keeps seeing the hint, which is fine — they get an upgrade to
  // "warn" only after sustained darkness.)
}

const RAD_TO_DEG = 180 / Math.PI;

function updateScanUI(
  step: number,
  total: number,
  status: string,
  detail: ScanProgressDetail | undefined,
): void {
  scanStepEl.textContent = `STEP ${Math.min(step + 1, total)} / ${total}`;
  // Pull instruction from the targets list — same source the scanner uses.
  const target = SCAN_TARGETS[Math.min(step, SCAN_TARGETS.length - 1)];
  scanInstrEl.textContent = target.instruction;
  scanStatusEl.textContent = status;
  // Fill represents per-pose hold progress (resets on each pose advance).
  // Combined with the step-of-total label, the user sees both axes.
  const holdProgress = detail?.holdProgress ?? 0;
  const overall = (step + holdProgress) / total;
  scanProgressFillEl.style.width = `${Math.max(0, Math.min(1, overall)) * 100}%`;

  // -- Pose silhouette (5 SVGs, [data-pose] toggles which is visible). --
  scanTargetIconEl.setAttribute('data-pose', target.pose);

  // -- Voice prompt: speak each new pose's instruction (deduped inside the
  //    helper, so per-frame calls are cheap). --
  if (target.pose !== prevPose) {
    speakPoseInstruction(target.pose, target.instruction);
    prevPose = target.pose;
  }

  // -- Step advance detection: beep + "captured" announcement on success. --
  if (step > prevScanStep && prevScanStep >= 0 && step <= total) {
    beep(880, 120); // clean A5 success tone
    if (step < total) speakNow('Captured.');
  }
  prevScanStep = step;

  // -- Halfway hold tick: fires the first frame holdProgress crosses 0.5. --
  if (holdProgress >= 0.5 && prevHoldProgress < 0.5) {
    beep(660, 80, 0.08); // softer "halfway there" cue
  }
  prevHoldProgress = holdProgress;

  // -- Live lighting-quality advisory. Cheap (just a numeric comparison
  //    + DOM attribute swap when state changes); the actual luma sample
  //    is throttled to ~1Hz inside FaceScanner. --
  updateLightingAdvisory(detail?.imgMean ?? null, performance.now());

  // -- Live pose-delta arrow + degrees. --
  if (!detail || detail.faceVisible === false || detail.yaw === null || detail.pitch === null) {
    // No face this frame — blank the arrow + degrees, surface the warning.
    scanArrowEl.textContent = ' ';
    scanDeltaEl.textContent = ' ';
    scanPoseFeedbackEl.classList.remove('in-range');
    scanNoFaceEl.hidden = !(detail && detail.faceVisible === false);
    return;
  }

  scanNoFaceEl.hidden = true;

  const dy = detail.yaw - detail.targetYaw;
  const dp = detail.pitch - detail.targetPitch;
  const tol = detail.toleranceRad;
  const inRange = Math.abs(dy) <= tol && Math.abs(dp) <= tol;

  if (inRange) {
    scanArrowEl.textContent = '✓'; // check mark
    scanDeltaEl.textContent = '';
    scanPoseFeedbackEl.classList.add('in-range');
  } else {
    // Pick the dominant axis. Yaw "overshoot" (current > target) means the
    // user is too far in the +yaw direction (their left); they need to come
    // back *right* on screen — arrow ▶. Inverse for the other direction.
    let arrow: string;
    let delta: number;
    if (Math.abs(dy) > Math.abs(dp)) {
      arrow = dy < 0 ? '◀' : '▶'; // ◀ need more left, ▶ need more right
      delta = -dy * RAD_TO_DEG; // sign so "need to turn N° left" reads as positive when ◀
    } else {
      arrow = dp < 0 ? '▲' : '▼'; // ▲ tilt up, ▼ tilt down
      delta = -dp * RAD_TO_DEG;
    }
    const sign = delta >= 0 ? '+' : '';
    scanArrowEl.textContent = arrow;
    scanDeltaEl.textContent = `${sign}${delta.toFixed(0)}°`;
    scanPoseFeedbackEl.classList.remove('in-range');
  }
}

async function runScan(): Promise<void> {
  if (!capture.isCameraStarted()) {
    setError('Start the camera first.');
    return;
  }
  // The scan fights the live preview's bbox draw — clear the canvas so
  // there's no stale rectangle peeking through the dim overlay.
  const ctx = overlayEl.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, overlayEl.width, overlayEl.height);

  scanner = new FaceScanner(capture);
  scanResultAngles = null;
  resetScanUiState();
  resetSpokenState();
  showScanOverlay(true);
  setBtnEnabled(btnScan3D, false);
  setBtnEnabled(btnSnapshot, false);
  clearError();
  setStatus('3D scan in progress...');
  // Speak the intro AFTER the click handler — Chrome only allows
  // SpeechSynthesis + AudioContext on a user gesture, and runScan is
  // invoked from the scan-3d click. This call lazily kicks both alive.
  speakNow('3D scan starting. Five poses, then two profile shots.');

  try {
    await scanner.startScan((step, total, status, detail) => {
      updateScanUI(step, total, status, detail);
    });
    scanResultAngles = scanner.finishScan().angles;
    scanner.dispose();
    scanner = null;
    showScanOverlay(false);
    speakNow('Scan complete. Reviewing.');
    await openMeshPreview();
  } catch (err) {
    showScanOverlay(false);
    setBtnEnabled(btnScan3D, true);
    setBtnEnabled(btnSnapshot, true);
    if (scanner) {
      scanner.dispose();
      scanner = null;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Scan cancelled') {
      setStatus('3D scan cancelled.');
      // Cancel any utterance still queued so the cancel feels immediate.
      resetSpokenState();
    } else {
      setStatus('3D scan failed.');
      setError(msg);
      resetSpokenState();
    }
  }
}

// Voice toggle — wired once at module load. Default to the checkbox's
// initial `checked` state (true) so we stay in sync with the DOM.
scanVoiceToggleEl.addEventListener('change', () => {
  setVoiceEnabled(scanVoiceToggleEl.checked);
});

scanCancelBtn.addEventListener('click', () => {
  if (scanner) scanner.stopScan();
});

btnScan3D.addEventListener('click', () => {
  if (btnScan3D.classList.contains('disabled')) return;
  void runScan();
});

async function openMeshPreview(): Promise<void> {
  if (!scanResultAngles || scanResultAngles.length === 0) return;
  const front = scanResultAngles.find((a) => a.pose === 'front');
  if (!front) {
    setError('3D scan: front pose missing — cannot build mesh.');
    setBtnEnabled(btnScan3D, true);
    setBtnEnabled(btnSnapshot, true);
    return;
  }
  // Build the mesh.
  try {
    pendingBuiltMesh = buildFaceMesh(front.landmarks, front.imageDataUrl);
  } catch (err) {
    setError(`Mesh build failed: ${err instanceof Error ? err.message : String(err)}`);
    setBtnEnabled(btnScan3D, true);
    setBtnEnabled(btnSnapshot, true);
    return;
  }
  // Spin up the preview canvas. Order matters: show the container BEFORE
  // calling resize() — otherwise the canvas-host has 0×0 because the
  // container is still display:none, the renderer locks in 0×0, and the
  // user sees a blank canvas even after the container becomes visible.
  showMeshPreview(true);
  if (!meshPreview) {
    meshPreview = createFaceMeshPreview(meshPreviewHost);
  }
  meshPreview.setMesh(pendingBuiltMesh);
  // One frame for layout to settle (display:flex applied), then size.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  meshPreview.resize();
  setStatus('Scan complete. Review the 3D mesh + Accept or Redo.');
}

function disposePendingPreview(): void {
  if (meshPreview) {
    // Clear the mesh from the preview (disposes its GPU resources). The
    // preview itself stays alive for the next scan to reuse.
    meshPreview.setMesh(null);
  }
  // setMesh(null) above already disposed the built mesh's resources, so
  // we just drop our reference.
  pendingBuiltMesh = null;
}

meshRedoBtn.addEventListener('click', () => {
  showMeshPreview(false);
  disposePendingPreview();
  scanResultAngles = null;
  // Re-enable buttons so the user can either redo or fall back to snapshot.
  setBtnEnabled(btnScan3D, true);
  setBtnEnabled(btnSnapshot, true);
  // Re-launch immediately so the user doesn't have to click "3D Scan" twice.
  void runScan();
});

meshAcceptBtn.addEventListener('click', async () => {
  if (!scanResultAngles || !pendingBuiltMesh) return;
  const front = scanResultAngles.find((a) => a.pose === 'front');
  if (!front) {
    setError('Front pose missing — cannot save.');
    return;
  }
  const name = getOrDefaultName();
  const existing = await loadFace(name);
  if (existing && !confirm(`Face "${name}" exists. Overwrite?`)) return;

  // Phase 7.8 — infer head proportions from front-pose landmarks. We use:
  //   width  = |lm[454].x − lm[234].x|     (right cheek − left cheek, image x)
  //   height = |lm[152].y − lm[10].y|      (chin − forehead, image y)
  //   depth  = |lm[1].z   − earLineZ|      (nose tip Z vs mean ear-line Z)
  // The aspects are clamped to plausible human ranges so a bad capture
  // (e.g. scan auto-snapped just as the user blinked / yawed) doesn't
  // produce a deformed dad-bod head; outside the clamps we still keep the
  // value but bound it. setFaceMesh3D then scales the head sphere to
  // (aspectWH, 1, aspectDH × headDepthScale).
  const lm = front.landmarks;
  const widthIm = Math.abs(lm[454].x - lm[234].x);
  const heightIm = Math.abs(lm[152].y - lm[10].y);
  const earLineZ = (lm[234].z + lm[454].z) / 2;
  const noseDepth = Math.abs(lm[1].z - earLineZ);
  const aspectWH = widthIm / Math.max(heightIm, 1e-6);
  const aspectDH = noseDepth / Math.max(heightIm, 1e-6);
  // aspectWH typical: 0.70–0.85 (faces are taller than wide). Clamp 0.55–1.05.
  const clampedWH = Math.max(0.55, Math.min(1.05, aspectWH));
  // aspectDH typical: 0.15–0.30; deep-set/large-nose faces up to ~0.55.
  // 0.65 upper bound preserves headroom without clipping common cases —
  // tighter clamps on a high-confidence measurement just throw away signal.
  const clampedDH = Math.max(0.10, Math.min(0.65, aspectDH));

  // Phase 8.4 — sample iris colors from the front-pose photo. Failure is
  // non-fatal; the runtime falls back to default brown irises when the
  // optional `eyeColors` field is absent. Wrapped in try/catch so a
  // pathological data URL or canvas exception can't take down the save.
  // Done HERE rather than inside reprocessFace because: (a) iris colors
  // are not re-sampled at reprocess time (they're already on Phase 8.4
  // scans), (b) reprocessFace is the unified Phase 8.5 path and we want
  // to keep the iris-color call out of it.
  let eyeColors: { left: number; right: number } | undefined;
  try {
    const sampled = await sampleIrisColors(front.imageDataUrl, front.landmarks);
    eyeColors = sampled ?? undefined;
  } catch (err) {
    console.warn('iris-color: sampling threw, saving without eyeColors', err);
    eyeColors = undefined;
  }

  // Build a "raw" FaceImage with mesh3d.angles + headShape + eyeColors
  // (the Phase 8.4-or-earlier fields). reprocessFace then runs the Phase
  // 8.5 sampler pipeline and returns a fully-populated FaceImage.
  // Single code path: scan-accept and the Reprocess library button both
  // call reprocessFace, so the orchestration logic lives in one place.
  const rawFace: FaceImage = {
    __version: 1,
    name,
    capturedAt: new Date().toISOString(),
    source: 'webcam',
    dataUrl: front.imageDataUrl,
    bbox: null, // 3D scan path doesn't currently compute the core-face bbox
    mesh3d: {
      vertices: flattenLandmarks(front.landmarks),
      uvs: (() => {
        // UVs are derived from landmarks at build time — store them too so
        // a future schema bump (different UV scheme) can migrate cleanly.
        const uvs = new Array<number>(front.landmarks.length * 2);
        for (let i = 0; i < front.landmarks.length; i++) {
          uvs[i * 2 + 0] = front.landmarks[i].x;
          uvs[i * 2 + 1] = 1 - front.landmarks[i].y;
        }
        return uvs;
      })(),
      angles: scanResultAngles.map((a) => ({
        poseName: a.pose,
        imageDataUrl: a.imageDataUrl,
        landmarks: flattenLandmarks(a.landmarks),
      })),
      headShape: {
        aspectWH: clampedWH,
        aspectDH: clampedDH,
        aspectDHSource: 'front-z',
      },
      ...(eyeColors ? { eyeColors } : {}),
    },
  };

  // Run the Phase 8.5 sampler pipeline. Best-effort: per-sampler failures
  // surface in `result.diagnostics` and `result.warnings` but never throw.
  let face: FaceImage;
  try {
    const result = await reprocessFace(rawFace);
    face = result.face;
    if (result.warnings.length > 0) {
      console.warn('Phase 8.5 reprocess warnings:', result.warnings);
    }
  } catch (err) {
    console.warn('reprocessFace threw, saving with raw mesh3d only', err);
    face = rawFace;
  }

  try {
    await saveFace(face);
    setStatus(`Saved "${face.name}" (3D mesh).`);
    nameEl.value = '';
    nameEl.placeholder = defaultFaceName();
  } catch (err) {
    setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  } finally {
    showMeshPreview(false);
    disposePendingPreview();
    scanResultAngles = null;
    setBtnEnabled(btnScan3D, true);
    setBtnEnabled(btnSnapshot, true);
  }
  await refreshGrid();
});

// --- Upload (file picker) ---
btnUpload.addEventListener('click', () => uploadFileEl.click());
uploadFileEl.addEventListener('change', async () => {
  const file = uploadFileEl.files?.[0];
  if (!file) return;
  await ingestUpload(file);
  uploadFileEl.value = '';
});

// --- Drag-drop ---
dropZoneEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZoneEl.classList.add('drag-over');
});
dropZoneEl.addEventListener('dragleave', () => {
  dropZoneEl.classList.remove('drag-over');
});
dropZoneEl.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZoneEl.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  await ingestUpload(file);
});

async function ingestUpload(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) {
    setError(`Not an image file: ${file.type || file.name}`);
    return;
  }
  clearError();
  const name = getOrDefaultName();
  const existing = await loadFace(name);
  if (existing && !confirm(`Face "${name}" exists. Overwrite?`)) return;
  setStatus(`Processing "${file.name}"...`);
  try {
    const face = await capture.processUpload(file, { name });
    await saveFace(face);
    if (face.bbox === null) {
      // Explicit AI-generated-funny-face path. Surface a yellow warning toast
      // — the image is saved, but FaceLandmarker didn't recognize it as a
      // face, so Phase 8 puppeting won't have eye/mouth anchor points.
      showToast(
        `Saved "${face.name}" without face detection — stylized images ` +
          `won't support live puppeting in Phase 8, but the static face will ` +
          `still apply to players.`,
        7000,
      );
      setStatus(`Saved "${face.name}" (no face detected).`);
    } else {
      setStatus(`Saved "${face.name}".`);
    }
    nameEl.value = '';
    nameEl.placeholder = defaultFaceName();
    await refreshGrid();
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    setStatus('Upload failed.');
    setError(m);
  }
}

// --- Import JSON ---
btnImport.addEventListener('click', () => importFileEl.click());
importFileEl.addEventListener('change', async () => {
  const file = importFileEl.files?.[0];
  if (!file) return;
  try {
    const face = await importFaceJSON(file);
    const existing = await loadFace(face.name);
    if (existing && !confirm(`Face "${face.name}" exists. Overwrite?`)) {
      importFileEl.value = '';
      return;
    }
    await saveFace(face);
    await refreshGrid();
    setStatus(`Imported "${face.name}".`);
    clearError();
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    setError(`Import failed: ${m}`);
  } finally {
    importFileEl.value = '';
  }
});

// --- Library grid ---
async function refreshGrid(): Promise<void> {
  const meta = await listFaces();
  gridEl.innerHTML = '';
  if (meta.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'grid-column: 1 / -1; font-size: 11px; color: #666; padding: 6px;';
    empty.textContent = 'No faces yet. Snap one or upload a PNG.';
    gridEl.appendChild(empty);
    return;
  }
  for (const m of meta) {
    gridEl.appendChild(renderFaceCard(m));
  }
}

function renderFaceCard(m: FaceMeta): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'face-card';

  const img = document.createElement('img');
  img.src = m.dataUrl;
  img.alt = m.name;
  card.appendChild(img);

  const name = document.createElement('div');
  name.className = 'face-name';
  name.textContent = m.name;
  card.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'face-meta';
  const ts = m.capturedAt.replace('T', ' ').replace(/\..*$/, '').slice(5);
  meta.textContent = `${m.source} - ${ts}`;
  card.appendChild(meta);

  // Phase 7.6: surface a small "3D" badge on cards whose entry was
  // captured via the multi-pose scan flow. Helps the user tell at a
  // glance which library entries will render as a tessellated mesh.
  if (m.has3D) {
    const badge = document.createElement('span');
    badge.className = 'badge-3d';
    badge.textContent = '3D';
    badge.title = '3D mesh scan — front + 4 side captures stored';
    card.appendChild(badge);
  }

  const actions = document.createElement('div');
  actions.className = 'face-actions';

  const renameBtn = document.createElement('div');
  renameBtn.className = 'btn';
  renameBtn.textContent = 'Rename';
  renameBtn.addEventListener('click', async () => {
    const next = window.prompt('New name:', m.name);
    if (!next || next === m.name) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    const existing = await loadFace(trimmed);
    if (existing && !confirm(`Face "${trimmed}" exists. Overwrite?`)) return;
    const orig = await loadFace(m.name);
    if (!orig) {
      setError(`Face "${m.name}" not found.`);
      return;
    }
    const renamed: FaceImage = { ...orig, name: trimmed };
    await saveFace(renamed);
    if (trimmed !== m.name) await deleteFace(m.name);
    await refreshGrid();
    setStatus(`Renamed "${m.name}" → "${trimmed}".`);
  });
  actions.appendChild(renameBtn);

  const exportBtn = document.createElement('div');
  exportBtn.className = 'btn';
  exportBtn.textContent = 'Export';
  exportBtn.addEventListener('click', async () => {
    const face = await loadFace(m.name);
    if (!face) {
      setError(`Face "${m.name}" not found.`);
      return;
    }
    exportFaceJSON(face);
  });
  actions.appendChild(exportBtn);

  // Phase F3 — Reprocess. Re-runs the Phase 8.5 sampler pipeline on the
  // stored mesh3d.angles, so old scans saved before Phase C pick up the
  // new richness (skinTone/lipColor/brows/beard/eyeShape/eyelashes/nose/
  // hair/hat) without re-scanning. Only meaningful for 3D entries — the
  // samplers need stored angle landmarks to run.
  if (m.has3D) {
    const reprocessBtn = document.createElement('div');
    reprocessBtn.className = 'btn';
    reprocessBtn.textContent = 'Reprocess';
    reprocessBtn.addEventListener('click', async () => {
      // Guard against double-clicks during async work.
      if (reprocessBtn.classList.contains('disabled')) return;
      const loaded = await loadFace(m.name);
      if (!loaded) {
        setError(`Face "${m.name}" not found.`);
        return;
      }
      // Confirm if we'd be overwriting Phase 8.5 fields. The user may
      // want to preserve a hand-tweaked / debugged state.
      const hasNewFields = !!(
        loaded.mesh3d?.skinTone ||
        loaded.mesh3d?.lipColor ||
        loaded.mesh3d?.brows
      );
      if (
        hasNewFields &&
        !confirm(`"${m.name}" already has Phase 8.5 features. Re-sample anyway?`)
      ) {
        return;
      }
      reprocessBtn.classList.add('disabled');
      setStatus(`Reprocessing "${m.name}"...`);
      try {
        const result = await reprocessFace(loaded);
        await saveFace(result.face);
        const populated = Object.values(result.diagnostics).filter((v) => v).length;
        const total = Object.keys(result.diagnostics).length;
        setStatus(`Reprocessed "${m.name}": ${populated}/${total} features sampled.`);
        if (result.warnings.length > 0) {
          console.warn('Reprocess warnings:', result.warnings);
        }
        await refreshGrid();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Reprocess failed: ${msg}`);
      } finally {
        reprocessBtn.classList.remove('disabled');
      }
    });
    actions.appendChild(reprocessBtn);
  }

  const delBtn = document.createElement('div');
  delBtn.className = 'btn danger';
  delBtn.textContent = 'Del';
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Delete "${m.name}"?`)) return;
    await deleteFace(m.name);
    await refreshGrid();
    setStatus(`Deleted "${m.name}".`);
  });
  actions.appendChild(delBtn);

  card.appendChild(actions);
  return card;
}

// --- Init ---
nameEl.placeholder = defaultFaceName();

window.addEventListener('beforeunload', () => {
  void capture.dispose();
});

void refreshGrid();
setStatus('idle - click "Start camera" or upload a PNG to begin.');
