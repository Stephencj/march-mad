/**
 * Phase 8 — Face Mirror page.
 *
 * Three-pane layout: webcam preview (left), Three.js dad-bod (right), control
 * panel (far right). The webcam drives MediaPipe FaceLandmarker; its
 * blendshape coefficients drive a `FacePuppet` that mutates the player's
 * 3D face mesh in real time. Optionally record sequences for later replay.
 *
 * Lifecycle invariants:
 *   - Camera starts off; user clicks "Start camera" to enable.
 *   - Live mirror toggle is gated on (cameraStarted AND a 3D face is mounted).
 *   - On face change OR live-mirror-off: dispose puppet + reset mesh to rest.
 *   - On page unload: stop camera, cancel video-frame loop, dispose puppet.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GamePlayer } from './game/player';
import { createDefaultPlayerStats } from './core/types';
import { FaceCapture } from './dev/face/capture';
import { listFaces, loadFace } from './dev/face/store';
import {
  buildFaceMeshFromStored,
  unflattenLandmarks,
  type BuiltFaceMesh,
} from './dev/face/mesh-builder';
import {
  buildHeadMeshFromAngles,
  type BuiltHeadMesh,
} from './dev/face/head-mesh-builder';
import { bundleFaceFeatures } from './dev/face/procedural-face';
import {
  createFacePuppet,
  type BlendshapeFrame,
  type FacePuppet,
} from './dev/face/blendshape-puppet';
import {
  saveFaceAnim,
  loadFaceAnim,
  listFaceAnims,
  deleteFaceAnim,
  exportFaceAnimJSON,
  importFaceAnimJSON,
} from './dev/face/face-anim-store';
import type { FaceAnimClip, FaceAnimMeta } from './dev/face/face-anim-clip';
import {
  buildFaceModeSection,
  readFaceModeFromStorage,
} from './dev/face-mode-toggle';

const FACE_LS_KEY = 'devpanel:face-mirror:face';

// Drop blendshape entries below this threshold from recorded frames — keeps
// stored clips sparse without losing visible signal. MediaPipe emits noise-
// floor coefficients ~0.001-0.01 even on a still face; capturing those just
// inflates JSON size.
const SPARSE_THRESHOLD = 0.02;

// Minimum clip duration to allow saving — anything shorter is almost certainly
// an accidental click. Brief enough that a deliberate "wink and stop" still saves.
const MIN_CLIP_DURATION_SEC = 0.5;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const videoEl = document.getElementById('webcam') as HTMLVideoElement;
const placeholderEl = document.getElementById('webcam-placeholder') as HTMLDivElement;
const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
const cameraBtn = document.getElementById('btn-camera') as HTMLDivElement;
const mirrorBtn = document.getElementById('btn-mirror') as HTMLDivElement;
const recordBtn = document.getElementById('btn-record') as HTMLDivElement;
const facePick = document.getElementById('face-pick') as HTMLSelectElement;
const facePickStatus = document.getElementById('face-pick-status') as HTMLLabelElement;

// Phase H10 — Face Mode dev toggle inserted right after the face-pick
// status line so it sits in the same visual block. The accessor returns
// the always-mounted `player` ref (face-mirror builds the rig once and
// re-mounts faces inside it), so re-applying always reaches the live rig.
{
  const faceModeNode = buildFaceModeSection(() => player);
  facePickStatus.parentElement?.insertBefore(
    faceModeNode,
    facePickStatus.nextSibling,
  );
}
const animNameInput = document.getElementById('anim-name') as HTMLInputElement;
const animList = document.getElementById('anim-list') as HTMLDivElement;
const importBtn = document.getElementById('btn-import') as HTMLDivElement;
const importFile = document.getElementById('import-file') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;
const blendshapeBarsEl = document.getElementById('blendshape-bars') as HTMLDivElement;
// Phase 8.2a: replay <video> for the side-by-side comparison view, plus the
// recording-time pill that shows up in the top-left of the webcam pane while
// MediaRecorder is active. Both default to hidden via CSS.
const replayVideoEl = document.getElementById('replay-video') as HTMLVideoElement;
const recIndicatorEl = document.getElementById('rec-indicator') as HTMLDivElement;
const recIndicatorTimeEl = document.getElementById('rec-indicator-time') as HTMLSpanElement;

// ---------------------------------------------------------------------------
// Three.js scene — minimal mirror of anim-viewer.ts (renderer, scene, camera,
// ambient light, ground, GamePlayer, OrbitControls). No animation switch:
// rig is pinned to 'idle' so we just see the face.
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
// Frame on the head — tighter than anim-viewer's full-body shot since this
// page is all about the face.
camera.position.set(0, 1.5, 1.4);
camera.lookAt(0, 1.4, 0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 1.4, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight.position.set(3, 8, 5);
scene.add(dirLight);

const platformGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.05, 24);
const platformMat = new THREE.MeshStandardMaterial({ color: 0x2a2f4a });
const platform = new THREE.Mesh(platformGeo, platformMat);
platform.position.y = -0.025;
scene.add(platform);

function resize(): void {
  const wrap = canvas.parentElement;
  if (!wrap) return;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w > 0 ? w / h : 1;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// Build the player once; never destroyed (we mount/unmount the face mesh
// inside instead).
const player = new GamePlayer(
  {
    id: 'face-mirror-player',
    name: 'Mirror',
    stats: createDefaultPlayerStats(),
    personality: 'Team Player',
    isCustom: false,
    hairOverride: 0,
  } as unknown as ConstructorParameters<typeof GamePlayer>[0],
  new THREE.Vector3(0, 0, 0),
  0xe94560,
);
// Pin to idle so the rig stays calm — the face is the show.
player.forceAnimState('idle');
scene.add(player.group);

// Resize once now that the canvas has a parent in the DOM.
resize();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const capture = new FaceCapture(videoEl);
let cameraStarted = false;

/** Currently-mounted built face mesh + its source dataUrl, kept so we can
 *  rebuild the puppet on toggle changes. Null when no 3D face is selected. */
let mountedFace: { mesh: BuiltFaceMesh; faceName: string } | null = null;

let puppet: FacePuppet | null = null;

let liveMirrorOn = false;
let liveLoopHandle: { cancel: () => void } | null = null;

interface RecordingState {
  startMs: number;
  frames: Array<{ ts: number; frame: Record<string, number> }>;
  /** Phase 8.2a: synchronized webcam recording. `recorder` and `chunks` are
   *  null when MediaRecorder is unsupported in this browser — the rest of
   *  the recording flow still works (blendshapes only). */
  recorder: MediaRecorder | null;
  chunks: Blob[];
  /** MIME type the recorder was configured with — preserved so the saved
   *  Blob's `.type` is accurate even if the chunks lose theirs. */
  videoMimeType: string;
  /** ms offset of the FIRST blendshape frame relative to recorder.start().
   *  Set on the first onLiveFrame() invocation while recording, then reused
   *  for the saved clip's `videoStartOffsetMs` field. */
  videoStartOffsetMs: number;
  /** rAF handle for the recording-time indicator pill. */
  indicatorRaf: number;
}
let recording: RecordingState | null = null;

/** Phase 8.2a: one-shot toast for "MediaRecorder unsupported" so we don't
 *  spam the user every time they hit Record on an old browser. */
let mediaRecorderUnsupportedToastShown = false;

interface ReplayState {
  clip: FaceAnimClip;
  /** Replay start time (performance.now() — used for the blendshape-only
   *  fallback path when the clip lacks a videoBlob). */
  startMs: number;
  raf: number;
  /** Phase 8.2a: when the clip carries a videoBlob, replay drives the
   *  blendshapes from `videoEl.currentTime` instead of wall-clock so the
   *  rig stays locked to the source video frame-by-frame. Object URL is
   *  revoked on stopReplay(). */
  videoUrl: string | null;
}
let replay: ReplayState | null = null;

let selectedFaceName: string = (() => {
  try { return localStorage.getItem(FACE_LS_KEY) ?? ''; } catch { return ''; }
})();

// ---------------------------------------------------------------------------
// Animation loop — drives Three.js render + the player rig's idle bob.
// MediaPipe's per-frame work happens in liveLoopHandle (separate
// requestVideoFrameCallback), so this loop is pure render + controls.
// ---------------------------------------------------------------------------
let lastTime = performance.now();
function animate(): void {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  player.animate(dt);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ---------------------------------------------------------------------------
// Toast + status helpers
// ---------------------------------------------------------------------------
function showToast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  // Auto-hide after 5s — long enough to read, short enough not to pin.
  setTimeout(() => toastEl.classList.remove('show'), 5000);
}
function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

// ---------------------------------------------------------------------------
// Face picker — populated from `march-mad-faces` IDB. Only entries with
// mesh3d are usable — the puppet needs vertex data to deform.
// ---------------------------------------------------------------------------
async function populateFacePick(): Promise<void> {
  let faces: Awaited<ReturnType<typeof listFaces>> = [];
  try {
    faces = await listFaces();
  } catch (err) {
    console.warn('face-mirror: listFaces failed', err);
    facePickStatus.style.color = '#ff7a7a';
    facePickStatus.textContent = `IDB error: ${err instanceof Error ? err.message : String(err)}`;
    return;
  }
  const has3D = faces.filter((f) => f.has3D);
  facePick.innerHTML = '';
  if (has3D.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(none — open Face Editor → 3D Scan)';
    facePick.appendChild(opt);
    facePickStatus.style.color = '#ffd700';
    facePickStatus.textContent = 'No 3D-scanned faces yet. Use Face Editor → 3D Scan.';
    facePick.disabled = true;
  } else {
    facePick.disabled = false;
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(none)';
    facePick.appendChild(none);
    for (const f of has3D) {
      const opt = document.createElement('option');
      opt.value = f.name;
      opt.textContent = f.name;
      facePick.appendChild(opt);
    }
    facePickStatus.style.color = '#888';
    facePickStatus.textContent = `${has3D.length} 3D face${has3D.length === 1 ? '' : 's'} in library.`;
  }
  // Restore prior selection if still present.
  if (selectedFaceName && has3D.some((f) => f.name === selectedFaceName)) {
    facePick.value = selectedFaceName;
    await applyFaceSelection(selectedFaceName);
  } else {
    facePick.value = '';
    if (selectedFaceName) {
      selectedFaceName = '';
      try { localStorage.removeItem(FACE_LS_KEY); } catch { /* ignore */ }
    }
    await applyFaceSelection('');
  }
  updateMirrorBtnState();
}

async function applyFaceSelection(name: string): Promise<void> {
  // Tear down any prior puppet + loops. The player's setFaceMesh3D(null)
  // will dispose the prior mesh, but we have to release the puppet's
  // displacement caches first or they'd reference a stale Float32Array.
  stopLiveMirror();
  stopReplay();
  if (puppet) {
    puppet.dispose();
    puppet = null;
  }
  if (mountedFace) {
    player.setFaceMesh3D(null);
    mountedFace = null;
  }
  selectedFaceName = name;
  try {
    if (name) localStorage.setItem(FACE_LS_KEY, name);
    else localStorage.removeItem(FACE_LS_KEY);
  } catch { /* ignore */ }

  if (!name) {
    updateMirrorBtnState();
    return;
  }

  let face;
  try {
    face = await loadFace(name);
  } catch (err) {
    console.warn('face-mirror: loadFace failed', err);
    showToast(`Failed to load face: ${err instanceof Error ? err.message : String(err)}`);
    updateMirrorBtnState();
    return;
  }
  if (!face || !face.mesh3d || !face.mesh3d.vertices?.length) {
    showToast('Face Mirror requires a 3D-scanned face. Open Face Editor → 3D Scan.');
    updateMirrorBtnState();
    return;
  }

  let built: BuiltFaceMesh;
  let headBuilt: BuiltHeadMesh | null = null;
  // G1: prefer the head-mesh path when profile poses are present.
  const angles = face.mesh3d.angles;
  const featuresForHead = bundleFaceFeatures(face.mesh3d);
  const skinToneForHead =
    (featuresForHead as { bodySkinTone?: number } | undefined)?.bodySkinTone ??
    featuresForHead?.skinTone;
  try {
    if (angles && angles.length > 0) {
      try {
        const frontLM = unflattenLandmarks(face.mesh3d.vertices);
        headBuilt = buildHeadMeshFromAngles(frontLM, angles, face.dataUrl, {
          skinTone: skinToneForHead,
        });
        built = headBuilt;
      } catch (err) {
        console.warn('face-mirror: head-mesh build failed, falling back to face-only', err);
        built = buildFaceMeshFromStored(
          face.mesh3d.vertices,
          face.mesh3d.uvs,
          face.dataUrl,
        );
        headBuilt = null;
      }
    } else {
      built = buildFaceMeshFromStored(
        face.mesh3d.vertices,
        face.mesh3d.uvs,
        face.dataUrl,
      );
    }
  } catch (err) {
    console.warn('face-mirror: buildFaceMeshFromStored failed', err);
    showToast('Face mesh build failed — try a different scan.');
    updateMirrorBtnState();
    return;
  }
  // Phase D: bundle sampled-feature payload (skin/lip/brow/eye/nose +
  // hair/hat) and pass through as the 5th positional arg. Old saves
  // missing these fields produce `undefined` and procedural-face falls
  // back to defaults.
  const features = featuresForHead;
  player.setFaceMesh3D(
    built.mesh,
    face.mesh3d.headShape,
    built.mouthInterior,
    face.mesh3d.eyeColors,
    features,
    // G1: pass the head-mesh build (or null) so setFaceMesh3D can mount
    // the head group when successful, or fall back to the sphere head.
    headBuilt,
  );
  // Phase B: mount the procedural-face overlay as a sibling of the canonical
  // mesh. Reads canonical landmark positions every frame (see updateFaceProcedural
  // call below) so blendshape-puppet deformations animate the procedural
  // features for free.
  player.setFaceProcedural(built);
  // Phase H2: mount the Mii flat-image renderer when the saved scan has a
  // baked feature bundle. Default __faceMode = 'mii' when present.
  // Phase H10: honor the dev-overlay's localStorage override
  // (`devpanel:face-mode`) — falls back to 'mii' when unset.
  if (face.mesh3d.featureImages) {
    if (typeof window !== 'undefined' && window.__faceMode === undefined) {
      const stored = readFaceModeFromStorage();
      window.__faceMode = stored ?? 'mii';
    }
    void player.setFaceMii(face.mesh3d.featureImages);
  } else {
    void player.setFaceMii(null);
  }
  mountedFace = { mesh: built, faceName: name };
  updateMirrorBtnState();
}

facePick.addEventListener('change', () => {
  void applyFaceSelection(facePick.value);
});

// Refresh on tab focus — the user may have just captured a new face.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void populateFacePick();
    void populateAnimList();
  }
});

void populateFacePick();

// ---------------------------------------------------------------------------
// Camera button
// ---------------------------------------------------------------------------
cameraBtn.addEventListener('click', async () => {
  if (cameraStarted) {
    // Stopping: tear down everything that depends on the camera.
    stopLiveMirror();
    await capture.dispose();
    cameraStarted = false;
    cameraBtn.textContent = 'Start camera';
    cameraBtn.classList.remove('active');
    videoEl.classList.add('off');
    placeholderEl.style.display = '';
    setStatus('Camera stopped.');
    updateMirrorBtnState();
    return;
  }
  cameraBtn.textContent = 'Starting…';
  try {
    // Pass a no-op preview callback — we don't need the bbox overlay on this
    // page, MediaPipe will still feed the live loop via its own VIDEO mode
    // that we drive manually below.
    await capture.startCamera(() => { /* no overlay */ });
    cameraStarted = true;
    cameraBtn.textContent = 'Stop camera';
    cameraBtn.classList.add('active');
    videoEl.classList.remove('off');
    placeholderEl.style.display = 'none';
    setStatus('Camera started. Pick a 3D face and toggle Live mirror.');
  } catch (err) {
    showToast(`Camera permission denied or unavailable: ${err instanceof Error ? err.message : String(err)}`);
    cameraBtn.textContent = 'Start camera';
    setStatus('Camera could not start.');
  }
  updateMirrorBtnState();
});

// ---------------------------------------------------------------------------
// Live mirror toggle
// ---------------------------------------------------------------------------
function updateMirrorBtnState(): void {
  const ready = cameraStarted && mountedFace !== null;
  if (!ready) {
    mirrorBtn.classList.add('disabled');
    mirrorBtn.classList.remove('active');
    mirrorBtn.textContent = 'Live mirror: OFF';
    if (liveMirrorOn) {
      // External toggle (camera stopped, face changed) — sync state.
      liveMirrorOn = false;
    }
    recordBtn.classList.add('disabled');
    return;
  }
  mirrorBtn.classList.remove('disabled');
  mirrorBtn.textContent = liveMirrorOn ? 'Live mirror: ON' : 'Live mirror: OFF';
  mirrorBtn.classList.toggle('active', liveMirrorOn);
  // Recording requires live mirror.
  if (liveMirrorOn) recordBtn.classList.remove('disabled');
  else {
    recordBtn.classList.add('disabled');
    // Fire-and-forget: stopRecording is async (awaits MediaRecorder.onstop)
    // but the toggle-state path doesn't need to block on the flush.
    if (recording) void stopRecording(true /* silent — toggle just turned off */);
  }
}

mirrorBtn.addEventListener('click', () => {
  if (mirrorBtn.classList.contains('disabled')) return;
  if (liveMirrorOn) stopLiveMirror();
  else startLiveMirror();
  updateMirrorBtnState();
});

function startLiveMirror(): void {
  if (!cameraStarted || !mountedFace) return;
  if (liveMirrorOn) return;
  // Stop any active replay — the live signal takes over the mesh.
  stopReplay();
  if (!puppet) {
    try {
      puppet = createFacePuppet(mountedFace.mesh);
    } catch (err) {
      showToast(`Puppet init failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }
  // Phase E: hand the puppet to the procedural face so its conditional
  // features (teeth, tongue) can read the smoothed jawOpen coefficient.
  // Phase H4: when a Mii face is mounted, the keyframe mixer is the
  // BlendshapeSource (it implements the same contract by translating
  // resolved track state into ARKit scalars). The puppet still feeds
  // the mixer in K2; for K1 we just route through whichever is present.
  const mixer = player?.getFaceMixer();
  player?.setFaceProceduralBlendshapeSource(mixer ?? puppet);
  liveMirrorOn = true;
  setStatus('Mirroring.');
  // Drive MediaPipe at the video-frame cadence. Reusing `requestVideoFrameCallback`
  // when available so we never run faster than the camera frame rate.
  liveLoopHandle = eachVideoFrame(videoEl, () => onLiveFrame());
}

function stopLiveMirror(): void {
  if (liveLoopHandle) {
    liveLoopHandle.cancel();
    liveLoopHandle = null;
  }
  if (liveMirrorOn) {
    liveMirrorOn = false;
    setStatus(cameraStarted ? 'Live mirror off.' : 'Camera stopped.');
  }
  if (recording) void stopRecording(true /* silent */);
  // Reset mesh to neutral so the static pose is seen post-mirror, not
  // whatever expression was last frozen on screen.
  if (puppet) puppet.reset();
  // Phase E: detach the procedural face's blendshape source so teeth /
  // tongue hide on stop rather than freezing at the last-applied state.
  player.setFaceProceduralBlendshapeSource(null);
  // Clear the bar chart.
  renderBlendshapeBars(null);
}

interface VideoFrameCallbackHandle { cancel: () => void; }

/** rAF-style loop that fires once per video frame (or RAF as fallback).
 *  Same pattern used elsewhere — duplicated here so face-mirror.ts is a
 *  self-contained page module. */
function eachVideoFrame(
  el: HTMLVideoElement,
  cb: () => void,
): VideoFrameCallbackHandle {
  const v = el as unknown as {
    requestVideoFrameCallback?: (cb: () => void) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  };
  let cancelled = false;
  if (typeof v.requestVideoFrameCallback === 'function') {
    let handle = 0;
    const tick = () => {
      if (cancelled) return;
      cb();
      handle = v.requestVideoFrameCallback!(tick);
    };
    handle = v.requestVideoFrameCallback(tick);
    return {
      cancel: () => {
        cancelled = true;
        if (typeof v.cancelVideoFrameCallback === 'function') {
          v.cancelVideoFrameCallback(handle);
        }
      },
    };
  }
  let raf = 0;
  const tick = () => {
    if (cancelled) return;
    cb();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    },
  };
}

let lastDetectTs = -1;
let detectCount = 0;
let detectFpsLastReport = performance.now();
let detectFpsCounter = 0;

function onLiveFrame(): void {
  if (!liveMirrorOn || !puppet || !mountedFace) return;
  if (videoEl.readyState < 2) return;
  // FaceCapture's preview loop is calling detectForVideo too — we have to
  // co-own the monotonic timestamp invariant. Bump-and-ours makes our
  // detect call always strictly greater than the preview loop's, so neither
  // throws.
  const ts = capture.bumpDetectTimestamp();
  if (ts <= lastDetectTs) return;
  lastDetectTs = ts;
  const landmarker = capture.getRawLandmarker();
  if (!landmarker) return;

  let result;
  try {
    result = landmarker.detectForVideo(videoEl, ts);
  } catch (err) {
    console.warn('face-mirror: detectForVideo threw', err);
    return;
  }
  const blendshapes = result.faceBlendshapes?.[0];
  if (!blendshapes || !blendshapes.categories || blendshapes.categories.length === 0) {
    // No face / no blendshapes — hold the previous expression. Status hint
    // so the user knows tracking is lost.
    setStatus('Face not detected — re-center yourself.');
    return;
  }

  // Convert to BlendshapeFrame map. Skip the implicit '_neutral' shape if
  // present (it's the always-on baseline, not an expression).
  const frame: BlendshapeFrame = new Map();
  for (const c of blendshapes.categories) {
    if (c.categoryName === '_neutral') continue;
    frame.set(c.categoryName, c.score);
  }
  puppet.apply(frame);
  // Phase B: refresh the procedural-face overlay so its geometry tracks the
  // canonical mesh's now-deformed landmarks. No-op if no procedural face is
  // mounted. MUST run before the next render.
  player.updateFaceProcedural();
  renderBlendshapeBars(frame);

  // Recording: snapshot the (sparse) frame.
  if (recording) {
    const sparse: Record<string, number> = {};
    for (const [name, score] of frame) {
      if (score >= SPARSE_THRESHOLD) sparse[name] = score;
    }
    const tsFromStart = performance.now() - recording.startMs;
    // Phase 8.2a: capture the offset of the FIRST blendshape frame relative
    // to the wall-clock start (which we set immediately after MediaRecorder.start()).
    // Both events fire on consecutive event-loop ticks, so this is typically
    // 0–30ms — but recording it lets the replay path align video.t=0 with
    // frames[0].t=0 precisely. Only assigned once: a sentinel of -1 means
    // "no first frame yet".
    if (recording.frames.length === 0) {
      recording.videoStartOffsetMs = tsFromStart;
    }
    recording.frames.push({
      ts: tsFromStart,
      frame: sparse,
    });
    setStatus(
      `Recording… ${recording.frames.length} frames (${((performance.now() - recording.startMs) / 1000).toFixed(1)}s)`,
    );
  } else {
    // Status update with a live FPS readout — replaces any "lost" message.
    detectFpsCounter++;
    detectCount++;
    const now = performance.now();
    if (now - detectFpsLastReport > 500) {
      const fps = detectFpsCounter / ((now - detectFpsLastReport) / 1000);
      setStatus(`Mirroring — ${fps.toFixed(0)} fps`);
      detectFpsCounter = 0;
      detectFpsLastReport = now;
    }
  }
}

// ---------------------------------------------------------------------------
// Blendshape bar chart
// ---------------------------------------------------------------------------
function renderBlendshapeBars(frame: BlendshapeFrame | null): void {
  if (!frame || frame.size === 0) {
    blendshapeBarsEl.innerHTML = '<div style="color:#666;font-size:11px;">(no signal)</div>';
    return;
  }
  // Sort descending by score, take top 10.
  const top = [...frame.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  // Clear existing rows. Cheap enough at 10 elements that we don't need
  // diff-style updates.
  blendshapeBarsEl.innerHTML = '';
  for (const [name, score] of top) {
    const row = document.createElement('div');
    row.className = 'bs-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'bs-name';
    nameEl.textContent = name;
    const wrap = document.createElement('span');
    wrap.className = 'bs-bar-wrap';
    const bar = document.createElement('span');
    bar.className = 'bs-bar';
    bar.style.width = `${Math.min(100, score * 100)}%`;
    wrap.appendChild(bar);
    const val = document.createElement('span');
    val.className = 'bs-val';
    val.textContent = score.toFixed(2);
    row.appendChild(nameEl);
    row.appendChild(wrap);
    row.appendChild(val);
    blendshapeBarsEl.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
recordBtn.addEventListener('click', () => {
  if (recordBtn.classList.contains('disabled')) return;
  // Fire-and-forget — stopRecording is async (it awaits MediaRecorder.onstop)
  // but the click handler doesn't need to block on it.
  if (recording) void stopRecording(false);
  else startRecording();
});

/** Phase 8.2a: pick the best WebM codec MediaRecorder will accept on this
 *  browser. VP9 is preferred for compression quality; falls through to
 *  plain webm and finally browser-default. Returns null when MediaRecorder
 *  is missing entirely (very old browsers). */
function pickRecorderMimeType(): string | null {
  // SSR / very-old-browser guard. The DOM type ships in modern lib.dom
  // but the `MediaRecorder` global is absent on e.g. iOS Safari < 14.3.
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['video/webm;codecs=vp9', 'video/webm', ''];
  for (const c of candidates) {
    // Empty string = "use the browser default" — always supported when
    // MediaRecorder itself exists, so it's our final fallback.
    if (c === '') return '';
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function startRecording(): void {
  if (!liveMirrorOn) return;

  // Phase 8.2a: spin up a MediaRecorder on the same MediaStream FaceCapture
  // is using. recorder.start() and the blendshape-frame loop fire on
  // consecutive event-loop ticks; the first onLiveFrame() invocation
  // back-fills `videoStartOffsetMs` so replay can align them precisely.
  const stream = capture.getMediaStream();
  let recorder: MediaRecorder | null = null;
  let mime = '';
  const mimePicked = pickRecorderMimeType();

  if (stream && mimePicked !== null) {
    try {
      mime = mimePicked;
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      // If we let the browser pick, surface what it actually chose so the
      // saved Blob has the right MIME for replay.
      if (!mime) mime = recorder.mimeType || 'video/webm';
    } catch (err) {
      console.warn('face-mirror: MediaRecorder ctor threw, falling back to blendshapes only', err);
      recorder = null;
      mime = '';
    }
  } else if (mimePicked === null && !mediaRecorderUnsupportedToastShown) {
    showToast('Video recording not supported in this browser — saving blendshapes only.');
    mediaRecorderUnsupportedToastShown = true;
  }

  const chunks: Blob[] = [];
  if (recorder) {
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    // 1-second timeslice — gives us periodic chunks so a hard crash doesn't
    // lose the whole recording, and keeps memory growth visible.
    try {
      recorder.start(1000);
    } catch (err) {
      console.warn('face-mirror: MediaRecorder.start() threw', err);
      recorder = null;
    }
  }

  // Snap startMs immediately AFTER recorder.start() so the offset between
  // video.t=0 and frames[0].t=0 stays tiny (one event-loop tick). The first
  // onLiveFrame() while recording back-fills `videoStartOffsetMs`.
  recording = {
    startMs: performance.now(),
    frames: [],
    recorder,
    chunks,
    videoMimeType: mime,
    videoStartOffsetMs: 0,
    indicatorRaf: 0,
  };
  recordBtn.classList.add('active');
  recordBtn.innerHTML = '<span class="rec-dot"></span>Stop recording';
  setStatus('Recording 0.0s');

  // Show the recording-time pill in the webcam pane corner.
  recIndicatorEl.classList.add('on');
  const tickIndicator = () => {
    if (!recording) return;
    const sec = (performance.now() - recording.startMs) / 1000;
    recIndicatorTimeEl.textContent = `${sec.toFixed(1)}s`;
    recording.indicatorRaf = requestAnimationFrame(tickIndicator);
  };
  recording.indicatorRaf = requestAnimationFrame(tickIndicator);
}

async function stopRecording(silent: boolean): Promise<void> {
  if (!recording) return;
  const r = recording;
  recording = null;
  recordBtn.classList.remove('active');
  recordBtn.textContent = 'Record';
  recIndicatorEl.classList.remove('on');
  if (r.indicatorRaf) cancelAnimationFrame(r.indicatorRaf);

  const durMs = performance.now() - r.startMs;
  const tooShort = r.frames.length === 0 || durMs < MIN_CLIP_DURATION_SEC * 1000;

  // Phase 8.2a: always tear down the recorder properly — the Cancel /
  // too-short paths still need to release the stream consumer and flush
  // pending dataavailable callbacks. On those paths we then drop the chunks.
  let videoBlob: Blob | null = null;
  if (r.recorder) {
    if (r.recorder.state !== 'inactive') {
      // Wait for the final dataavailable + onstop before reading chunks.
      // Assign onstop BEFORE calling stop() so we don't miss a synchronous
      // fire on browsers that fully drain the stream during stop().
      const stopped = new Promise<void>((resolve) => {
        r.recorder!.onstop = () => resolve();
      });
      try {
        r.recorder.stop();
      } catch (err) {
        console.warn('face-mirror: recorder.stop() threw', err);
      }
      await stopped;
    }
    if (!silent && !tooShort && r.chunks.length > 0) {
      // Use the chunks' actual type when present — falls back to the mime
      // we configured the recorder with.
      const blobType = r.chunks[0].type || r.videoMimeType || 'video/webm';
      videoBlob = new Blob(r.chunks, { type: blobType });
    }
    // On the silent / too-short / cancel path the chunks array is just
    // dropped here when `r` goes out of scope. Nothing to revoke; we never
    // created an object URL on the recorder side.
  }

  if (silent) return;
  if (tooShort) {
    showToast(`Clip too short — recordings need to be at least ${MIN_CLIP_DURATION_SEC}s.`);
    setStatus('Recording discarded.');
    return;
  }
  // Use the field name if provided, else timestamp-based default.
  let name = animNameInput.value.trim();
  if (!name) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    name = `face-anim-${stamp}`;
  }
  const fps = r.frames.length / (durMs / 1000);
  const clip: FaceAnimClip = {
    __version: 1,
    name,
    capturedAt: new Date().toISOString(),
    fps,
    frames: r.frames.map((f) => f.frame),
    ...(videoBlob
      ? {
          videoBlob,
          videoMimeType: videoBlob.type || r.videoMimeType || 'video/webm',
          videoStartOffsetMs: r.videoStartOffsetMs,
        }
      : {}),
  };
  void saveFaceAnim(clip)
    .then(() => {
      const videoTag = videoBlob
        ? ` + video ${(videoBlob.size / (1024 * 1024)).toFixed(2)}MB`
        : '';
      setStatus(
        `Saved ${name}: ${r.frames.length} frames @ ${fps.toFixed(1)}fps ` +
          `(${(durMs / 1000).toFixed(1)}s)${videoTag}`,
      );
      animNameInput.value = '';
      void populateAnimList();
    })
    .catch((err) => {
      showToast(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    });
}

// ---------------------------------------------------------------------------
// Saved-clips list + replay
// ---------------------------------------------------------------------------
async function populateAnimList(): Promise<void> {
  let clips: FaceAnimMeta[] = [];
  try {
    clips = await listFaceAnims();
  } catch (err) {
    animList.innerHTML = `<div style="color:#ff7a7a;font-size:11px;">IDB error: ${err instanceof Error ? err.message : String(err)}</div>`;
    return;
  }
  animList.innerHTML = '';
  if (clips.length === 0) {
    animList.innerHTML = '<div style="color:#888;font-size:11px;">No clips yet — record one above.</div>';
    return;
  }
  for (const c of clips) {
    const row = document.createElement('div');
    row.className = 'anim-row';
    row.dataset.name = c.name;

    const name = document.createElement('div');
    name.className = 'anim-name';
    name.textContent = c.name;
    // Phase 8.2a: VIDEO badge surfaces clips that carry source webcam.
    if (c.hasVideo) {
      const badge = document.createElement('span');
      badge.className = 'anim-badge';
      badge.textContent = 'VIDEO';
      badge.title = 'Synced source webcam available — Play to compare side-by-side';
      name.appendChild(badge);
    }
    row.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'anim-meta';
    meta.textContent = `${c.frameCount} frames · ${c.durationSec.toFixed(1)}s · ${c.fps.toFixed(0)}fps`;
    row.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'anim-actions';
    const playBtn = document.createElement('div');
    playBtn.className = 'btn';
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', () => void playClip(c.name));
    actions.appendChild(playBtn);
    const exportBtn = document.createElement('div');
    exportBtn.className = 'btn';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', async () => {
      const clip = await loadFaceAnim(c.name);
      if (clip) exportFaceAnimJSON(clip);
    });
    actions.appendChild(exportBtn);
    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'btn danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete "${c.name}"?`)) return;
      await deleteFaceAnim(c.name);
      void populateAnimList();
    });
    actions.appendChild(deleteBtn);
    row.appendChild(actions);
    animList.appendChild(row);
  }
}

async function playClip(name: string): Promise<void> {
  // Replay does not require the camera; it does require a 3D face mounted
  // (so we have a mesh + puppet to drive).
  if (!mountedFace) {
    showToast('Pick a 3D-scanned face first.');
    return;
  }
  const clip = await loadFaceAnim(name);
  if (!clip || clip.frames.length === 0) {
    showToast(`Clip "${name}" has no frames.`);
    return;
  }
  // Live mirror takes priority — pause it while replaying so the two
  // sources don't fight over the mesh. Replay end re-enables nothing
  // automatically; the user re-toggles live mirror to mix again.
  stopLiveMirror();
  stopReplay();
  if (!puppet) puppet = createFacePuppet(mountedFace.mesh, { smooth: false });
  // Phase E: replay drives the procedural face's conditional features off
  // the same puppet's smoothed jawOpen.
  // Phase H4: prefer the keyframe mixer when a Mii face is mounted —
  // it satisfies BlendshapeSource and (later phases) takes the puppet's
  // output as a live driver.
  {
    const mixer = player.getFaceMixer();
    player.setFaceProceduralBlendshapeSource(mixer ?? puppet);
  }
  // Mark which row is playing.
  for (const row of animList.querySelectorAll<HTMLDivElement>('.anim-row')) {
    row.classList.toggle('playing', row.dataset.name === name);
  }

  // Phase 8.2a: when the clip carries source video, mount it in the webcam
  // pane and drive blendshape lookup off of `videoEl.currentTime`. The
  // muted attribute keeps the autoplay policy happy and ensures we're not
  // distracted by recorded audio (we never recorded any anyway).
  let videoUrl: string | null = null;
  let videoMaster = false;
  if (clip.videoBlob) {
    videoUrl = URL.createObjectURL(clip.videoBlob);
    replayVideoEl.src = videoUrl;
    replayVideoEl.muted = true;
    replayVideoEl.classList.add('show');
    // Hide the live webcam <video> + placeholder while replay is mounted.
    videoEl.classList.add('off');
    placeholderEl.style.display = 'none';
    videoMaster = true;
    // Kick playback. play() returns a Promise that may reject when the
    // tab isn't visible; swallow it — the user can click again.
    replayVideoEl.play().catch((err) => {
      console.warn('face-mirror: replay video play() rejected', err);
    });
  }

  const replayState: ReplayState = {
    clip,
    startMs: performance.now(),
    raf: 0,
    videoUrl,
  };
  replay = replayState;
  setStatus(`Playing ${name}…`);

  // Master clock = video.currentTime when the clip carries video, else
  // wall-clock. Both paths look up the matching blendshape frame by elapsed
  // seconds × fps. Driving from currentTime keeps the puppet locked to the
  // playback head even if the video stutters / the user scrubs.
  //
  // The recorded videoStartOffsetMs is the tiny gap between recorder.start()
  // and the first blendshape frame — applied here so frames[0] aligns with
  // the user-visible start of the source video.
  const videoOffsetSec = (clip.videoStartOffsetMs ?? 0) / 1000;
  const tick = () => {
    if (replay !== replayState) return; // superseded by another replay/stop.
    if (!puppet || !mountedFace) {
      // Mesh was disposed mid-replay (face changed). Bail defensively.
      stopReplay();
      return;
    }
    let elapsedSec: number;
    if (videoMaster) {
      // currentTime is the master clock — replays exactly what the source
      // video shows, even if the rAF cadence is uneven.
      elapsedSec = Math.max(0, replayVideoEl.currentTime - videoOffsetSec);
      // End-of-video → stop. (Video naturally pauses at duration; check
      // ended too in case the browser lags the timeupdate slightly.)
      if (replayVideoEl.ended) {
        stopReplay();
        return;
      }
    } else {
      elapsedSec = (performance.now() - replayState.startMs) / 1000;
    }
    const idxFloat = elapsedSec * replayState.clip.fps;
    const idx = Math.floor(idxFloat);
    if (idx >= replayState.clip.frames.length) {
      // Loop or stop? v1: stop and go neutral.
      stopReplay();
      return;
    }
    if (idx >= 0) {
      const sparse = replayState.clip.frames[idx];
      const frame: BlendshapeFrame = new Map();
      for (const k of Object.keys(sparse)) frame.set(k, sparse[k]);
      puppet.apply(frame);
      // Phase B: keep the procedural-face overlay in sync with the puppet's
      // mutations on the canonical mesh.
      player.updateFaceProcedural();
      renderBlendshapeBars(frame);
    }
    replayState.raf = requestAnimationFrame(tick);
  };
  replayState.raf = requestAnimationFrame(tick);
}

function stopReplay(): void {
  if (!replay) return;
  cancelAnimationFrame(replay.raf);
  // Phase 8.2a: tear down the replay <video> + revoke the object URL so we
  // don't leak the Blob across multiple plays. The element stays in the
  // DOM (cheap); we just blank the src + hide it.
  if (replay.videoUrl) {
    replayVideoEl.pause();
    replayVideoEl.removeAttribute('src');
    // Some browsers need an explicit load() after src-removal to release
    // the underlying media resource.
    replayVideoEl.load();
    replayVideoEl.classList.remove('show');
    URL.revokeObjectURL(replay.videoUrl);
    // Restore the live webcam pane visibility so the user sees the camera
    // (or placeholder) when they go back to mirroring.
    if (cameraStarted) {
      videoEl.classList.remove('off');
    } else {
      placeholderEl.style.display = '';
    }
  }
  replay = null;
  if (puppet) puppet.reset();
  // Phase E: detach so teeth/tongue hide on replay-stop.
  player.setFaceProceduralBlendshapeSource(null);
  for (const row of animList.querySelectorAll<HTMLDivElement>('.anim-row')) {
    row.classList.remove('playing');
  }
  renderBlendshapeBars(null);
}

void populateAnimList();

// ---------------------------------------------------------------------------
// Import JSON
// ---------------------------------------------------------------------------
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  try {
    const clip = await importFaceAnimJSON(file);
    await saveFaceAnim(clip);
    showToast(`Imported "${clip.name}".`);
    void populateAnimList();
  } catch (err) {
    showToast(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    importFile.value = '';
  }
});

// ---------------------------------------------------------------------------
// Page unload — make sure we don't leak the camera or leave a runaway loop.
// ---------------------------------------------------------------------------
window.addEventListener('beforeunload', () => {
  stopLiveMirror();
  stopReplay();
  if (puppet) {
    puppet.dispose();
    puppet = null;
  }
  // Fire-and-forget — beforeunload doesn't await Promises.
  void capture.dispose();
});
