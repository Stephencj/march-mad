import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GamePlayer } from './game/player';
import { Ball } from './game/ball';
import { createHoop } from './game/hoop';
import { createDefaultPlayerStats, type Position } from './core/types';
import {
  playerConfig,
  resetPlayer,
  serializePlayer,
  applyPlayerJSON,
  getDefaults,
} from './dev/player-config';
import { serializeBalance, applyBalanceJSON, resetBalance } from './dev/balance-config';
import { serializeLevel, applyLevelJSON, resetLevel } from './dev/level-config';
import { serializeAnim, applyAnimJSON, resetAnim } from './dev/anim-config';
import { persistDetails, detailsKey } from './dev/details-state';
import { AnimLoop, ANIM_IDS, type AnimId } from './dev/anim-loop';
import { installSnapshotAPI } from './dev/snapshot/install';
import type {
  SnapshotAPI,
  SnapshotCameraOpts,
  SnapshotCameraTarget,
} from './dev/snapshot/types';
import { buildBodySections } from './dev/body-sliders';
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
import {
  bundleFaceFeatures,
  type ProceduralFaceFeatures,
  type ProceduralFaceApplyExtension,
} from './dev/face/procedural-face';
import { listFaceAnims, loadFaceAnim } from './dev/face/face-anim-store';
import { createFacePuppet, type FacePuppet, type BlendshapeFrame } from './dev/face/blendshape-puppet';
import type { FaceAnimClip } from './dev/face/face-anim-clip';

const DEVPANEL_PREFIX = 'devpanel:player-editor';
const FACE_LS_KEY = 'devpanel:player-editor:face';
const FACE_ANIM_LS_KEY = 'devpanel:player-editor:face-anim';
// Phase 8.2a: persistence for the "Show source video" toggle. '1' / '0'.
const FACE_ANIM_SHOW_VIDEO_LS_KEY = 'devpanel:player-editor:face-anim-show-video';

// Ordered to match HAIR_STYLE_WEIGHTS in game/player.ts
const HAIR_STYLES = ['bald', 'receding', 'flat-top', 'afro', 'mohawk', 'headband'] as const;
const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

let teamColor = 0xe94560;
let hairOverride: number = 0; // 0..3
let positionOverride: Position | undefined = undefined;
// Selected face library entry. `''` means "(none — default eyes)". Persisted
// in localStorage so the editor remembers across reloads.
let selectedFaceName: string = (() => {
  try { return localStorage.getItem(FACE_LS_KEY) ?? ''; } catch { return ''; }
})();
// Most recently loaded face dataUrl, refreshed when the picker changes or
// the player rebuilds. Cached so rebuilds (which dispose+recreate the mesh)
// re-apply the active face without an async IDB hit. Phase 7.6 adds
// `selectedFaceMesh3D` — present when the picked entry has a mesh3d field;
// rebuild path reconstructs the THREE.Mesh from this without IDB.
let selectedFaceDataUrl: string | null = null;
// Phase 7.7: cache the detected 478-landmark set alongside the dataUrl so
// rebuildPlayer() can re-apply the same face-shaped alpha mask + plane
// transform after the rig is recreated. Undefined when the active face has
// no landmarks (older saves, AI-generated uploads with no detected face).
let selectedFaceLandmarks: number[] | undefined = undefined;
// Phase 7.8: cache per-face headShape alongside the mesh3d payload so the
// rebuild path can re-apply the head-sphere scaling consistently. Optional —
// older scans without it use the rig default.
let selectedFaceMesh3D: {
  vertices: number[];
  uvs: number[];
  imageDataUrl: string;
  headShape?: { aspectWH: number; aspectDH: number };
  // Phase 8.4: per-face iris colors sampled at scan time. Optional —
  // older saves and AI uploads (no detection) leave this undefined and
  // the runtime falls back to default brown irises.
  eyeColors?: { left: number; right: number };
  // G1: per-pose captures (front + 4 sides + 2 profiles). When profile
  // entries are present, the rebuild path calls `buildHeadMeshFromAngles`
  // to produce a real head mesh that REPLACES the rig sphere head.
  angles?: Array<{
    poseName: 'front' | 'left' | 'right' | 'up' | 'down' | 'profile-left' | 'profile-right';
    imageDataUrl: string;
    landmarks: number[];
  }>;
} | null = null;
// Phase D: cache the sampled-feature bundle alongside the mesh3d payload
// (skin/lip/brow/eye/nose/hair/hat) so player rebuilds re-apply the same
// procedural-face values without an IDB round trip.
let selectedFaceFeatures:
  | (ProceduralFaceFeatures & ProceduralFaceApplyExtension)
  | undefined = undefined;
// Stable id across body-slider rebuilds so skin tone + hair-color RNG rolls
// don't flicker while the user tunes dimensions. Only the explicit Re-roll
// button bumps this to generate a new appearance.
let rebuildSeq = 0;

// Animation playback state — the editor plays a looping anim so the user can
// tune body dimensions while watching the character in motion, not a static pose.
let currentAnim: AnimId = 'idle';
let speedMultiplier = 1.0;

// --- Renderer / Scene / Camera ---
const canvas = document.getElementById('editor-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
camera.position.set(0, 1.5, 4);
camera.lookAt(0, 0.9, 0);

function resize(): void {
  const wrap = document.getElementById('canvas-wrap')!;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.9, 0);

// --- Lighting + platform ---
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
dirLight.position.set(3, 8, 5);
scene.add(dirLight);

const platform = new THREE.Mesh(
  new THREE.CylinderGeometry(1.2, 1.2, 0.05, 32),
  new THREE.MeshStandardMaterial({ color: 0x2a2f4a }),
);
platform.position.y = -0.025;
scene.add(platform);

// --- Hoop + ball props (for shoot/dunk/pass animations) ---
const hoopPos = new THREE.Vector3(0, 3.05, 2.5);
const hoop = createHoop(hoopPos, 0xe94560);
hoop.rotation.y = Math.PI; // backboard faces the player
hoop.visible = false; // only visible for shoot/dunk/pass
scene.add(hoop);

const ball = new Ball(new THREE.Vector3(0, 1, 0));
ball.mesh.visible = false;
scene.add(ball.mesh);

// --- Player ---
// Parent container so user-provided XYZ offset sliders can bump the player
// without fighting position logic. Mirrors anim-viewer's playerContainer.
const playerContainer = new THREE.Group();
scene.add(playerContainer);
let playerOffsetX = 0;
let playerOffsetY = 0;
let playerOffsetZ = 0;

let player: GamePlayer | null = null;
let animLoop: AnimLoop | null = null;

/** Walk a three.js group and dispose every geometry + material. Mirrors
 * level-editor's disposeCourt — without this, rebuildPlayer() leaks on every
 * slider tick. */
function disposePlayerGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) (m as THREE.Material).dispose();
    }
  });
}

function rebuildPlayer(): void {
  // Capture current anim context so body rebuilds don't pop back to idle.
  // Re-trigger fresh rather than preserving animTime for timed anims — body
  // rebuilds are rare enough that a brief animation restart is fine.
  const savedAnim: AnimId = currentAnim;
  const savedAnimTime: number = player?.animTime ?? 0;

  if (player) {
    playerContainer.remove(player.group);
    disposePlayerGroup(player.group);
  }
  player = new GamePlayer(
    {
      id: `editor-${rebuildSeq}`,
      name: 'Editor Player',
      stats: createDefaultPlayerStats(),
      personality: 'Team Player',
      isCustom: false,
      position: positionOverride,
      hairOverride,
    } as any,
    new THREE.Vector3(0, 0, 0),
    teamColor,
  );
  playerContainer.add(player.group);
  player.animTime = savedAnimTime;

  if (animLoop) {
    animLoop.setPlayer(player);
  } else {
    animLoop = new AnimLoop(player, { ball, hoopPos });
  }
  animLoop.setAnim(savedAnim); // resets per-anim timers; next tick re-triggers fresh
  applyAnimPropsVisibility();
  // Re-apply the cached face after a rebuild — the new mesh starts with
  // default eyes and an invisible face plane otherwise. Prefer the 3D path
  // when available; fall back to flat dataUrl on either no-mesh3d or build
  // failure (so a corrupt mesh entry doesn't leave the player faceless).
  applyCachedFaceToPlayer();
}

function applyCachedFaceToPlayer(): void {
  if (!player) return;
  // Phase 8: tear down active face-anim puppet before swapping the mesh —
  // the puppet references the prior mesh's position attribute.
  stopFaceAnimPlayback();
  if (selectedFaceMesh3D) {
    try {
      // G1: prefer the head-mesh path (front face + side panels + back +
      // ears) when profile poses are available. Falls back to face-only
      // when angles are missing or head-mesh construction fails.
      let built: BuiltFaceMesh;
      let headBuilt: BuiltHeadMesh | null = null;
      const angles = selectedFaceMesh3D.angles;
      const skinToneForHead =
        (selectedFaceFeatures as { bodySkinTone?: number } | undefined)?.bodySkinTone ??
        selectedFaceFeatures?.skinTone;
      if (angles && angles.length > 0) {
        try {
          const frontLM = unflattenLandmarks(selectedFaceMesh3D.vertices);
          headBuilt = buildHeadMeshFromAngles(
            frontLM,
            angles,
            selectedFaceMesh3D.imageDataUrl,
            { skinTone: skinToneForHead },
          );
          built = headBuilt;
        } catch (err) {
          console.warn('player-editor: head-mesh build failed, falling back to face-only', err);
          built = buildFaceMeshFromStored(
            selectedFaceMesh3D.vertices,
            selectedFaceMesh3D.uvs,
            selectedFaceMesh3D.imageDataUrl,
          );
          headBuilt = null;
        }
      } else {
        built = buildFaceMeshFromStored(
          selectedFaceMesh3D.vertices,
          selectedFaceMesh3D.uvs,
          selectedFaceMesh3D.imageDataUrl,
        );
      }
      player.setFaceMesh3D(
        built.mesh,
        selectedFaceMesh3D.headShape,
        built.mouthInterior,
        selectedFaceMesh3D.eyeColors,
        // Phase D: sampled-feature bundle (skin/lip/brow/eye/nose +
        // hair/hat/bodySkinTone). Drives the procedural face's per-face
        // colors and the head/body skin recoloring.
        selectedFaceFeatures,
        // G1: pass the head-mesh build (or null) so setFaceMesh3D can
        // mount the head group when successful, or fall back to the
        // sphere head when null/unsuccessful.
        headBuilt,
      );
      // Phase B: mount the procedural-face overlay as a sibling of the
      // canonical mesh. Face-anim replay loop below calls
      // updateFaceProcedural() so the procedural geometry tracks deformations.
      player.setFaceProcedural(built);
      builtFaceMeshCache = built;
      // Re-apply face-anim selection if any.
      if (selectedFaceAnimName) void applyFaceAnim(selectedFaceAnimName);
      return;
    } catch (err) {
      console.warn('player-editor: 3D face rebuild failed, falling back to flat', err);
    }
  }
  builtFaceMeshCache = null;
  if (selectedFaceDataUrl !== null) {
    player.setFaceImage(selectedFaceDataUrl, selectedFaceLandmarks);
  } else {
    player.setFaceImage(null);
  }
}

// --- Face anim playback (Phase 8) ---
let builtFaceMeshCache: BuiltFaceMesh | null = null;
let facePuppet: FacePuppet | null = null;
let faceAnimRaf = 0;
let selectedFaceAnimName: string = (() => {
  try { return localStorage.getItem(FACE_ANIM_LS_KEY) ?? ''; } catch { return ''; }
})();
// Phase 8.2a: "Show source video" toggle state + tracking for the corner
// overlay's object URL so we can revoke it on every clip change / stop.
let faceAnimShowVideo: boolean = (() => {
  try { return localStorage.getItem(FACE_ANIM_SHOW_VIDEO_LS_KEY) === '1'; } catch { return false; }
})();
let faceAnimVideoUrl: string | null = null;

function stopFaceAnimPlayback(): void {
  if (faceAnimRaf) {
    cancelAnimationFrame(faceAnimRaf);
    faceAnimRaf = 0;
  }
  if (facePuppet) {
    facePuppet.dispose();
    facePuppet = null;
  }
  // Phase E: detach the procedural face's blendshape source so teeth /
  // tongue hide on stop rather than freezing at the last-applied state.
  player?.setFaceProceduralBlendshapeSource(null);
  // Phase 8.2a: tear down the source-video overlay + revoke its URL.
  const sourceVideoEl = document.getElementById('face-anim-source-video') as HTMLVideoElement | null;
  if (sourceVideoEl) {
    sourceVideoEl.pause();
    sourceVideoEl.removeAttribute('src');
    sourceVideoEl.load();
    sourceVideoEl.style.display = 'none';
  }
  if (faceAnimVideoUrl) {
    URL.revokeObjectURL(faceAnimVideoUrl);
    faceAnimVideoUrl = null;
  }
}

async function applyFaceAnim(name: string): Promise<void> {
  stopFaceAnimPlayback();
  selectedFaceAnimName = name;
  try {
    if (name) localStorage.setItem(FACE_ANIM_LS_KEY, name);
    else localStorage.removeItem(FACE_ANIM_LS_KEY);
  } catch { /* ignore */ }
  if (!name) return;
  if (!builtFaceMeshCache) {
    console.warn('player-editor: face-anim selected but no 3D mesh mounted');
    return;
  }
  let clip: FaceAnimClip | null;
  try {
    clip = await loadFaceAnim(name);
  } catch (err) {
    console.warn('player-editor: loadFaceAnim failed', err);
    return;
  }
  if (!clip || clip.frames.length === 0) return;
  facePuppet = createFacePuppet(builtFaceMeshCache, { smooth: false });
  // Phase E: hand the puppet to the procedural face for conditional-feature
  // visibility (teeth, tongue) driven off smoothed jawOpen.
  player?.setFaceProceduralBlendshapeSource(facePuppet);

  // Phase 8.2a: source-video overlay. Same logic as anim-viewer — only
  // mounted when the toggle is on AND the clip carries a Blob; the
  // master clock for blendshape lookup is then video.currentTime.
  let videoMaster = false;
  const sourceVideoEl = document.getElementById('face-anim-source-video') as HTMLVideoElement | null;
  if (faceAnimShowVideo && clip.videoBlob && sourceVideoEl) {
    faceAnimVideoUrl = URL.createObjectURL(clip.videoBlob);
    sourceVideoEl.src = faceAnimVideoUrl;
    sourceVideoEl.muted = true;
    sourceVideoEl.loop = true;
    sourceVideoEl.style.display = 'block';
    sourceVideoEl.play().catch((err) => {
      console.warn('player-editor: source video play() rejected', err);
    });
    videoMaster = true;
  }

  const startMs = performance.now();
  const videoOffsetSec = (clip.videoStartOffsetMs ?? 0) / 1000;
  const tick = () => {
    if (!facePuppet) return;
    let elapsedSec: number;
    if (videoMaster && sourceVideoEl) {
      elapsedSec = Math.max(0, sourceVideoEl.currentTime - videoOffsetSec);
    } else {
      elapsedSec = (performance.now() - startMs) / 1000;
    }
    const idx = Math.floor(elapsedSec * clip!.fps) % clip!.frames.length;
    if (idx >= 0) {
      const sparse = clip!.frames[idx];
      const frame: BlendshapeFrame = new Map();
      for (const k of Object.keys(sparse)) frame.set(k, sparse[k]);
      facePuppet.apply(frame);
      // Phase B: refresh the procedural-face overlay so its geometry tracks
      // the puppet's now-deformed canonical landmarks.
      player?.updateFaceProcedural();
    }
    faceAnimRaf = requestAnimationFrame(tick);
  };
  faceAnimRaf = requestAnimationFrame(tick);
}

/** Hoop + ball show only for the animations that use them. */
function applyAnimPropsVisibility(): void {
  const needsHoop = currentAnim === 'shoot' || currentAnim === 'dunk';
  const needsBall =
    needsHoop ||
    currentAnim === 'pass' ||
    currentAnim === 'dribble' ||
    currentAnim === 'dribble-walk' ||
    currentAnim === 'dribble-sprint';
  hoop.visible = needsHoop;
  ball.mesh.visible = needsBall;
}

rebuildPlayer();

// Hoisted state — these used to live alongside the functions that read/write
// them (buildFaceSection, populateFaceSelect, populateFaceAnimSelect), but
// buildPanel() runs synchronously below and writes `lastFaceAnimSelect`
// inside buildFaceSection BEFORE the original `let` was reached, throwing a
// TDZ ReferenceError that broke later module top-level (including the
// __snapshot install). Hoisting keeps the same semantics without the trap.
let lastFaceAnimSelect: HTMLSelectElement | null = null;
let lastFaceSelect: HTMLSelectElement | null = null;
let lastFaceStatusEl: HTMLDivElement | null = null;

// --- Animate loop ---
// Snapshot-driver hooks: when frozen, the loop runs at dt=0 (rig holds its
// pose). Each pending step consumes one rAF tick at dt=1/60 so the snapshot
// driver can advance N frames deterministically.
let __snapFrozen = false;
let __snapPendingSteps = 0;

let lastTime = performance.now();
function animate(): void {
  requestAnimationFrame(animate);
  const now = performance.now();
  const rawDt = (now - lastTime) / 1000;
  lastTime = now;

  controls.update();
  if (animLoop) {
    let dt = rawDt * speedMultiplier;
    if (__snapFrozen) {
      if (__snapPendingSteps > 0) {
        dt = 1 / 60;
        __snapPendingSteps--;
      } else {
        dt = 0;
      }
    }
    animLoop.tick(dt);
  }
  renderer.render(scene, camera);
}
animate();

// --- Side panel types + binding registries (must be declared BEFORE
//     buildPanel() runs, otherwise the slider builders that call
//     numericBindings.push(...) hit a temporal-dead-zone crash and the
//     whole page fails to render anything but the red panel border). ---
interface NumericFieldSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  defaultValue: number;
}

interface ColorFieldSpec {
  label: string;
  get: () => number;
  set: (v: number) => void;
  defaultValue: number;
}

interface SectionSpec {
  title: string;
  numerics?: NumericFieldSpec[];
  colors?: ColorFieldSpec[];
}

const numericBindings: Array<{ spec: NumericFieldSpec; slider: HTMLInputElement; numeric: HTMLInputElement }> = [];
const colorBindings: Array<{ spec: ColorFieldSpec; picker: HTMLInputElement }> = [];

// --- Side panel ---
const panel = document.getElementById('panel')!;
buildPanel();

function syncFromConfig(): void {
  for (const b of numericBindings) {
    const v = b.spec.get();
    b.slider.value = String(v);
    b.numeric.value = String(v);
  }
  for (const b of colorBindings) {
    b.picker.value = numToHex(b.spec.get());
  }
  rebuildPlayer();
}

function numToHex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function hexToNum(s: string): number {
  return parseInt(s.replace('#', ''), 16);
}

function buildPanel(): void {
  panel.innerHTML = '';

  // Header
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', flexDirection: 'column', gap: '8px',
    marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #333',
  });

  const title = document.createElement('div');
  title.textContent = 'PLAYER EDITOR';
  Object.assign(title.style, {
    fontSize: '16px', fontWeight: 'bold', letterSpacing: '2px', color: '#e94560',
  });
  header.appendChild(title);

  const hint = document.createElement('div');
  hint.textContent = 'Edits rebuild the player live. Pan/zoom/orbit with mouse.';
  Object.assign(hint.style, { fontSize: '11px', color: '#888' });
  header.appendChild(hint);

  // "ALL CONFIGS" row — resets/exports/imports balance + level + player + anim
  // together. Placed ABOVE the domain-scoped row so the player-only buttons
  // remain the quick default and the combined action is clearly labeled.
  const allLabel = document.createElement('div');
  allLabel.textContent = 'ALL CONFIGS';
  Object.assign(allLabel.style, {
    fontSize: '10px', letterSpacing: '1.5px', color: '#888', marginTop: '4px',
  });
  header.appendChild(allLabel);

  const allRow = document.createElement('div');
  Object.assign(allRow.style, { display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' });
  allRow.appendChild(makeButton('Reset All', () => {
    resetBalance();
    resetLevel();
    resetPlayer();
    resetAnim();
    syncFromConfig();
  }));
  allRow.appendChild(makeButton('Export All', exportAllJSON));
  allRow.appendChild(makeButton('Import All', importAllJSON));
  header.appendChild(allRow);

  const buttonRow = document.createElement('div');
  Object.assign(buttonRow.style, { display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' });
  buttonRow.appendChild(makeButton('Reset', () => { resetPlayer(); syncFromConfig(); }));
  buttonRow.appendChild(makeButton('Export JSON', exportJSON));
  buttonRow.appendChild(makeButton('Import JSON', importJSON));
  buttonRow.appendChild(makeButton('Export GLB', exportGLB));
  buttonRow.appendChild(makeButton('Re-roll', () => { rebuildSeq++; rebuildPlayer(); }));
  header.appendChild(buttonRow);

  panel.appendChild(header);

  // Preview controls (not part of the config — affect just the editor view)
  panel.appendChild(buildPreviewSection());

  // Face picker — dropdown of saved faces from face-editor's IndexedDB.
  panel.appendChild(buildFaceSection());

  // Player position offset (bump the model without changing its pose).
  panel.appendChild(buildPlayerOffsetSection());

  // Animation playback (speed + state picker). Sits above body/limb sections
  // so the user can pick an anim once and then scroll down to tune dimensions.
  panel.appendChild(buildAnimationSection());

  for (const section of buildSections()) {
    panel.appendChild(buildSection(section));
  }
}

function applyPlayerOffset(): void {
  playerContainer.position.set(playerOffsetX, playerOffsetY, playerOffsetZ);
}

function buildPlayerOffsetSection(): HTMLElement {
  const details = document.createElement('details');
  details.open = true;
  Object.assign(details.style, { marginBottom: '12px' });
  persistDetails(details, detailsKey(DEVPANEL_PREFIX, 'PLAYER OFFSET'));

  const summary = document.createElement('summary');
  summary.textContent = 'PLAYER OFFSET';
  Object.assign(summary.style, {
    cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
    color: '#aaa', padding: '4px 0', letterSpacing: '1px',
  });
  details.appendChild(summary);

  const hint = document.createElement('div');
  hint.textContent = 'Bumps the player relative to where the anim places it.';
  Object.assign(hint.style, { fontSize: '10px', color: '#666', padding: '2px 0 6px 0' });
  details.appendChild(hint);

  const makeAxisRow = (axis: 'x' | 'y' | 'z', min: number, max: number): HTMLElement => {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', flexDirection: 'column', gap: '2px',
      padding: '4px 0', borderBottom: '1px solid #222',
    });

    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
    const label = document.createElement('label');
    label.textContent = axis.toUpperCase();
    Object.assign(label.style, { fontSize: '12px', color: '#ddd', fontFamily: 'monospace' });
    head.appendChild(label);
    const valEl = document.createElement('span');
    valEl.textContent = '0.00';
    Object.assign(valEl.style, { fontSize: '12px', color: '#fff', fontFamily: 'monospace' });
    head.appendChild(valEl);
    row.appendChild(head);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = '0.05';
    slider.value = '0';
    Object.assign(slider.style, { width: '100%' });
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      if (axis === 'x') playerOffsetX = v;
      else if (axis === 'y') playerOffsetY = v;
      else playerOffsetZ = v;
      valEl.textContent = v.toFixed(2);
      applyPlayerOffset();
    });
    row.appendChild(slider);
    return row;
  };

  details.appendChild(makeAxisRow('x', -3, 3));
  details.appendChild(makeAxisRow('y', -2, 3));
  details.appendChild(makeAxisRow('z', -3, 3));

  const resetBtn = makeButton('Reset Offset', () => {
    playerOffsetX = 0;
    playerOffsetY = 0;
    playerOffsetZ = 0;
    applyPlayerOffset();
    // Sync the slider DOM — rebuild the section by refreshing buildPanel
    // would be heavy, so just zero each input in place.
    for (const input of details.querySelectorAll<HTMLInputElement>('input[type=range]')) {
      input.value = '0';
    }
    for (const span of details.querySelectorAll<HTMLElement>('span')) {
      span.textContent = '0.00';
    }
  });
  Object.assign(resetBtn.style, { marginTop: '6px' });
  details.appendChild(resetBtn);

  return details;
}

function buildAnimationSection(): HTMLElement {
  const details = document.createElement('details');
  details.open = true;
  Object.assign(details.style, { marginBottom: '12px' });
  persistDetails(details, detailsKey(DEVPANEL_PREFIX, 'ANIMATION'));

  const summary = document.createElement('summary');
  summary.textContent = 'ANIMATION';
  Object.assign(summary.style, {
    cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
    color: '#aaa', padding: '4px 0', letterSpacing: '1px',
  });
  details.appendChild(summary);

  // --- Speed slider ---
  const speedRow = document.createElement('div');
  Object.assign(speedRow.style, {
    display: 'flex', flexDirection: 'column', gap: '4px',
    padding: '6px 0', borderBottom: '1px solid #222',
  });

  const speedHead = document.createElement('div');
  Object.assign(speedHead.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
  const speedLabel = document.createElement('label');
  speedLabel.textContent = 'Speed';
  Object.assign(speedLabel.style, { fontSize: '12px', color: '#ddd' });
  speedHead.appendChild(speedLabel);
  const speedVal = document.createElement('span');
  speedVal.textContent = speedMultiplier.toFixed(1) + 'x';
  Object.assign(speedVal.style, { fontSize: '12px', color: '#fff', fontFamily: 'monospace' });
  speedHead.appendChild(speedVal);
  speedRow.appendChild(speedHead);

  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.min = '0.1';
  speedSlider.max = '2.0';
  speedSlider.step = '0.1';
  speedSlider.value = String(speedMultiplier);
  Object.assign(speedSlider.style, { width: '100%' });
  speedSlider.addEventListener('input', () => {
    speedMultiplier = parseFloat(speedSlider.value);
    speedVal.textContent = speedMultiplier.toFixed(1) + 'x';
  });
  speedRow.appendChild(speedSlider);
  details.appendChild(speedRow);

  // --- Animation button grid ---
  const animGridLabel = document.createElement('div');
  animGridLabel.textContent = 'State';
  Object.assign(animGridLabel.style, {
    fontSize: '12px', color: '#ddd', padding: '6px 0 4px 0',
  });
  details.appendChild(animGridLabel);

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '4px', paddingBottom: '6px',
  });
  const buttons: HTMLButtonElement[] = [];

  const markActive = () => {
    for (const b of buttons) {
      const isActive = b.dataset.anim === currentAnim;
      b.style.background = isActive ? '#e94560' : '#1f2540';
      b.style.borderColor = isActive ? '#e94560' : '#444';
      b.style.color = '#fff';
    }
  };

  for (const id of ANIM_IDS) {
    const btn = document.createElement('button');
    btn.textContent = id;
    btn.dataset.anim = id;
    Object.assign(btn.style, {
      padding: '6px 4px', fontSize: '11px', fontFamily: 'sans-serif',
      background: '#1f2540', color: '#fff', border: '1px solid #444',
      borderRadius: '3px', cursor: 'pointer', letterSpacing: '0.5px',
    });
    btn.addEventListener('click', () => {
      currentAnim = id;
      if (animLoop) animLoop.setAnim(id);
      applyAnimPropsVisibility();
      markActive();
    });
    buttons.push(btn);
    grid.appendChild(btn);
  }
  details.appendChild(grid);
  markActive();
  return details;
}

function buildPreviewSection(): HTMLElement {
  const details = document.createElement('details');
  details.open = true;
  Object.assign(details.style, { marginBottom: '12px' });
  persistDetails(details, detailsKey(DEVPANEL_PREFIX, 'PREVIEW'));

  const summary = document.createElement('summary');
  summary.textContent = 'PREVIEW';
  Object.assign(summary.style, {
    cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
    color: '#aaa', padding: '4px 0', letterSpacing: '1px',
  });
  details.appendChild(summary);

  details.appendChild(buildDropdown('Position', ['(default)', ...POSITIONS], positionOverride ?? '(default)', (v) => {
    positionOverride = v === '(default)' ? undefined : v as Position;
    rebuildPlayer();
  }));

  details.appendChild(buildDropdown('Hair Style', HAIR_STYLES.map(String), HAIR_STYLES[hairOverride], (v) => {
    hairOverride = HAIR_STYLES.indexOf(v as typeof HAIR_STYLES[number]);
    rebuildPlayer();
  }));

  // Team color picker (drives jersey)
  const colorRow = document.createElement('div');
  Object.assign(colorRow.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0', borderBottom: '1px solid #222',
  });
  const colorLabel = document.createElement('label');
  colorLabel.textContent = 'Team Color';
  Object.assign(colorLabel.style, { fontSize: '12px', color: '#ddd' });
  colorRow.appendChild(colorLabel);

  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.value = numToHex(teamColor);
  Object.assign(colorPicker.style, {
    width: '60px', height: '24px', cursor: 'pointer',
    background: 'transparent', border: '1px solid #444', borderRadius: '3px',
  });
  colorPicker.addEventListener('input', () => {
    teamColor = hexToNum(colorPicker.value);
    rebuildPlayer();
  });
  colorRow.appendChild(colorPicker);
  details.appendChild(colorRow);

  return details;
}

/** Face picker section — dropdown populated from /face-editor's IDB plus a
 *  link to /face-editor.html. Selection is persisted in localStorage and
 *  applied (or cleared) on the live player via setFaceImage(). */
function buildFaceSection(): HTMLElement {
  const details = document.createElement('details');
  details.open = true;
  Object.assign(details.style, { marginBottom: '12px' });
  persistDetails(details, detailsKey(DEVPANEL_PREFIX, 'FACE'));

  const summary = document.createElement('summary');
  summary.textContent = 'FACE';
  Object.assign(summary.style, {
    cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
    color: '#aaa', padding: '4px 0', letterSpacing: '1px',
  });
  details.appendChild(summary);

  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', gap: '8px', alignItems: 'center',
    padding: '6px 0', borderBottom: '1px solid #222',
  });

  const label = document.createElement('label');
  label.textContent = 'Face';
  Object.assign(label.style, { fontSize: '12px', color: '#ddd' });
  row.appendChild(label);

  const select = document.createElement('select');
  Object.assign(select.style, {
    flex: '1', padding: '4px', background: '#0d101e',
    color: '#fff', border: '1px solid #333', borderRadius: '3px', fontSize: '12px',
  });
  details.appendChild(row);
  row.appendChild(select);

  // Refresh button — manually re-pulls listFaces() in case the visibilitychange
  // path missed (e.g., user came in via direct link, not tab switch).
  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = '↻';
  refreshBtn.title = 'Refresh face library';
  Object.assign(refreshBtn.style, {
    padding: '4px 8px', background: '#2a2a4e', color: '#fff',
    border: '1px solid #444', borderRadius: '3px', cursor: 'pointer', fontSize: '12px',
  });
  refreshBtn.addEventListener('click', () => { void populateFaceSelect(select, statusEl); });
  row.appendChild(refreshBtn);

  // Status line — shows count or error so we can diagnose empty dropdowns.
  const statusEl = document.createElement('div');
  Object.assign(statusEl.style, { fontSize: '11px', color: '#888', padding: '2px 0' });
  statusEl.textContent = 'Loading…';
  details.appendChild(statusEl);

  // Async-populate (no top-level await, this is a non-async builder).
  void populateFaceSelect(select, statusEl);

  select.addEventListener('change', () => {
    void applyFaceSelection(select.value);
  });

  // Hint + nav link to /face-editor for capturing more faces.
  const linkRow = document.createElement('div');
  Object.assign(linkRow.style, { display: 'flex', justifyContent: 'flex-end', padding: '4px 0' });
  const link = document.createElement('a');
  link.href = '/face-editor.html';
  link.textContent = 'Open Face Editor →';
  Object.assign(link.style, {
    fontSize: '11px', color: '#e94560', textDecoration: 'none',
  });
  linkRow.appendChild(link);
  details.appendChild(linkRow);

  // --- Face Anim picker (Phase 8) ---
  // Plays a saved blendshape clip on top of the currently-mounted 3D face
  // mesh. Disabled (alert + revert) when the active face is flat.
  const animRow = document.createElement('div');
  Object.assign(animRow.style, {
    display: 'flex', gap: '8px', alignItems: 'center',
    padding: '6px 0', borderBottom: '1px solid #222',
  });
  const animLabel = document.createElement('label');
  animLabel.textContent = 'Anim';
  Object.assign(animLabel.style, { fontSize: '12px', color: '#ddd' });
  animRow.appendChild(animLabel);
  const animSelect = document.createElement('select');
  Object.assign(animSelect.style, {
    flex: '1', padding: '4px', background: '#0d101e',
    color: '#fff', border: '1px solid #333', borderRadius: '3px', fontSize: '12px',
  });
  animRow.appendChild(animSelect);
  details.appendChild(animRow);

  const animHint = document.createElement('div');
  animHint.textContent = 'Plays only on 3D-scanned faces.';
  Object.assign(animHint.style, { fontSize: '10px', color: '#666', padding: '2px 0' });
  details.appendChild(animHint);

  void populateFaceAnimSelect(animSelect);
  animSelect.addEventListener('change', () => {
    const name = animSelect.value;
    if (name && !builtFaceMeshCache) {
      alert('Face anims play only on 3D-scanned faces. Pick a [3D] face above first.');
      animSelect.value = selectedFaceAnimName || '';
      return;
    }
    void applyFaceAnim(name);
  });

  // Phase 8.2a: "Show source video" toggle — enables the corner overlay
  // that mirrors the user's webcam recording for side-by-side comparison.
  // Persists across reloads.
  const showVideoRow = document.createElement('label');
  Object.assign(showVideoRow.style, {
    display: 'flex', gap: '6px', alignItems: 'center',
    padding: '4px 0', fontSize: '11px', color: '#ccc', cursor: 'pointer',
  });
  const showVideoCb = document.createElement('input');
  showVideoCb.type = 'checkbox';
  showVideoCb.checked = faceAnimShowVideo;
  showVideoCb.addEventListener('change', () => {
    faceAnimShowVideo = showVideoCb.checked;
    try {
      localStorage.setItem(FACE_ANIM_SHOW_VIDEO_LS_KEY, faceAnimShowVideo ? '1' : '0');
    } catch { /* ignore */ }
    // Restart the active playback so the new mode takes effect immediately.
    if (selectedFaceAnimName) void applyFaceAnim(selectedFaceAnimName);
  });
  showVideoRow.appendChild(showVideoCb);
  const showVideoLabel = document.createElement('span');
  showVideoLabel.textContent = 'Show source video (when available)';
  showVideoRow.appendChild(showVideoLabel);
  details.appendChild(showVideoRow);

  // Track the select for visibilitychange repopulation, mirroring the
  // existing face-select tracking below.
  lastFaceAnimSelect = animSelect;

  const mirrorLinkRow = document.createElement('div');
  Object.assign(mirrorLinkRow.style, { display: 'flex', justifyContent: 'flex-end', padding: '4px 0' });
  const mirrorLink = document.createElement('a');
  mirrorLink.href = '/face-mirror.html';
  mirrorLink.textContent = 'Capture in Face Mirror →';
  Object.assign(mirrorLink.style, {
    fontSize: '11px', color: '#e94560', textDecoration: 'none',
  });
  mirrorLinkRow.appendChild(mirrorLink);
  details.appendChild(mirrorLinkRow);

  return details;
}

async function populateFaceAnimSelect(select: HTMLSelectElement): Promise<void> {
  let clips: Awaited<ReturnType<typeof listFaceAnims>> = [];
  try {
    clips = await listFaceAnims();
  } catch (err) {
    console.warn('player-editor: listFaceAnims failed', err);
  }
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '(none)';
  select.appendChild(none);
  for (const c of clips) {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = `${c.name} (${c.frameCount}f, ${c.durationSec.toFixed(1)}s)`;
    select.appendChild(opt);
  }
  if (selectedFaceAnimName && clips.some((c) => c.name === selectedFaceAnimName)) {
    select.value = selectedFaceAnimName;
    void applyFaceAnim(selectedFaceAnimName);
  } else {
    select.value = '';
    if (selectedFaceAnimName) {
      selectedFaceAnimName = '';
      try { localStorage.removeItem(FACE_ANIM_LS_KEY); } catch { /* ignore */ }
    }
  }
}

// Refresh the face library on tab focus — the user may have just captured a
// new face in /face-editor in another tab. The two `let`s used to live
// here, but were hoisted near the top of the module to avoid a TDZ trap
// (see comment at the rebuildPlayer call).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && lastFaceSelect) {
    void populateFaceSelect(lastFaceSelect, lastFaceStatusEl);
  }
  if (document.visibilityState === 'visible' && lastFaceAnimSelect) {
    void populateFaceAnimSelect(lastFaceAnimSelect);
  }
});

async function populateFaceSelect(
  select: HTMLSelectElement,
  statusEl: HTMLDivElement | null,
): Promise<void> {
  lastFaceSelect = select;
  lastFaceStatusEl = statusEl;
  let faces: Awaited<ReturnType<typeof listFaces>> = [];
  let errMsg: string | null = null;
  try {
    faces = await listFaces();
  } catch (err) {
    errMsg = err instanceof Error ? err.message : String(err);
    console.warn('face: listFaces failed', err);
  }
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '(none — default eyes)';
  select.appendChild(none);
  for (const f of faces) {
    const opt = document.createElement('option');
    opt.value = f.name;
    // [3D] prefix mirrors the badge in the face-editor library grid.
    opt.textContent = f.has3D ? `[3D] ${f.name}` : f.name;
    select.appendChild(opt);
  }
  if (statusEl) {
    if (errMsg) {
      statusEl.style.color = '#ff7a7a';
      statusEl.textContent = `IDB error: ${errMsg}`;
    } else if (faces.length === 0) {
      statusEl.style.color = '#888';
      statusEl.textContent = 'No saved faces yet — open Face Editor to capture one.';
    } else {
      statusEl.style.color = '#888';
      statusEl.textContent = `${faces.length} face${faces.length === 1 ? '' : 's'} in library.`;
    }
  }
  // Restore the persisted selection if it still exists in the library.
  const restoreName = selectedFaceName;
  if (restoreName && faces.some((f) => f.name === restoreName)) {
    select.value = restoreName;
    await applyFaceSelection(restoreName);
  } else {
    select.value = '';
    if (selectedFaceName) {
      // Selection was deleted from the library — fall back to default eyes
      // silently per the brief.
      selectedFaceName = '';
      try { localStorage.removeItem(FACE_LS_KEY); } catch { /* ignore */ }
    }
    await applyFaceSelection('');
  }
}

async function applyFaceSelection(name: string): Promise<void> {
  selectedFaceName = name;
  try {
    if (name) localStorage.setItem(FACE_LS_KEY, name);
    else localStorage.removeItem(FACE_LS_KEY);
  } catch { /* ignore quota / privacy mode */ }

  if (!name) {
    selectedFaceDataUrl = null;
    selectedFaceLandmarks = undefined;
    selectedFaceMesh3D = null;
    selectedFaceFeatures = undefined;
    if (player) {
      player.setFaceMesh3D(null);
      player.setFaceImage(null);
    }
    return;
  }
  try {
    const face = await loadFace(name);
    if (!face) {
      // Stale selection (deleted between listFaces and now). Silent fallback.
      selectedFaceDataUrl = null;
      selectedFaceLandmarks = undefined;
      selectedFaceMesh3D = null;
      selectedFaceFeatures = undefined;
      if (player) {
        player.setFaceMesh3D(null);
        player.setFaceImage(null);
      }
      return;
    }
    selectedFaceDataUrl = face.dataUrl;
    selectedFaceLandmarks = face.faceLandmarks;
    if (face.mesh3d && Array.isArray(face.mesh3d.vertices) && face.mesh3d.vertices.length > 0) {
      selectedFaceMesh3D = {
        vertices: face.mesh3d.vertices,
        uvs: face.mesh3d.uvs,
        imageDataUrl: face.dataUrl,
        // Phase 7.8: pass through the optional headShape (older scans that
        // predate this field leave it `undefined`, and the player rig falls
        // back to its default sphere scale).
        headShape: face.mesh3d.headShape,
        // Phase 8.4: pass through optional iris colors (older scans leave
        // it `undefined`, runtime falls back to default brown).
        eyeColors: face.mesh3d.eyeColors,
        // G1: pass through the captured pose angles for head-mesh build.
        angles: face.mesh3d.angles,
      };
      // Phase D: bundle sampled-feature payload — skin/lip/brow/eye/nose +
      // hair/hat — into the shape `setFaceMesh3D` accepts.
      selectedFaceFeatures = bundleFaceFeatures(face.mesh3d);
    } else {
      selectedFaceMesh3D = null;
      selectedFaceFeatures = undefined;
    }
    applyCachedFaceToPlayer();
  } catch (err) {
    console.warn('face: loadFace failed', err);
    selectedFaceDataUrl = null;
    selectedFaceLandmarks = undefined;
    selectedFaceMesh3D = null;
    selectedFaceFeatures = undefined;
    if (player) {
      player.setFaceMesh3D(null);
      player.setFaceImage(null);
    }
  }
}

function buildDropdown(label: string, options: string[], current: string, onChange: (v: string) => void): HTMLElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0', borderBottom: '1px solid #222', gap: '8px',
  });
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  Object.assign(labelEl.style, { fontSize: '12px', color: '#ddd' });
  row.appendChild(labelEl);

  const select = document.createElement('select');
  Object.assign(select.style, {
    flex: '1', padding: '4px', background: '#0d101e',
    color: '#fff', border: '1px solid #333', borderRadius: '3px', fontSize: '12px',
  });
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opt === current) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => onChange(select.value));
  row.appendChild(select);
  return row;
}

// Delegates to the shared list in src/dev/body-sliders.ts so the anim-viewer
// and player-editor always expose the same 5 sections / ~50 fields in the
// same order with the same ranges. Types are structurally compatible.
function buildSections(): SectionSpec[] {
  return buildBodySections() as unknown as SectionSpec[];
}

function buildSection(spec: SectionSpec): HTMLElement {
  const details = document.createElement('details');
  details.open = true;
  Object.assign(details.style, { marginBottom: '12px' });

  const summary = document.createElement('summary');
  summary.textContent = spec.title;
  Object.assign(summary.style, {
    cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
    color: '#aaa', padding: '4px 0', letterSpacing: '1px',
  });
  details.appendChild(summary);

  for (const n of spec.numerics ?? []) details.appendChild(buildNumericRow(n));
  for (const c of spec.colors ?? []) details.appendChild(buildColorRow(c));
  persistDetails(details, detailsKey(DEVPANEL_PREFIX, spec.title));
  return details;
}

function buildNumericRow(spec: NumericFieldSpec): HTMLElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', flexDirection: 'column', gap: '4px',
    padding: '6px 0', borderBottom: '1px solid #222',
  });

  const labelRow = document.createElement('div');
  Object.assign(labelRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });

  const label = document.createElement('label');
  label.textContent = spec.label;
  Object.assign(label.style, { fontSize: '12px', color: '#ddd' });
  labelRow.appendChild(label);

  const numeric = document.createElement('input');
  numeric.type = 'number';
  numeric.min = String(spec.min);
  numeric.max = String(spec.max);
  numeric.step = String(spec.step);
  numeric.value = String(spec.get());
  Object.assign(numeric.style, {
    width: '70px', padding: '2px 4px', background: '#0d101e',
    color: '#fff', border: '1px solid #333', borderRadius: '3px',
    fontSize: '12px', fontFamily: 'monospace',
  });
  labelRow.appendChild(numeric);

  row.appendChild(labelRow);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(spec.min);
  slider.max = String(spec.max);
  slider.step = String(spec.step);
  slider.value = String(spec.get());
  Object.assign(slider.style, { width: '100%' });
  row.appendChild(slider);

  const defaultLabel = document.createElement('div');
  defaultLabel.textContent = `default: ${spec.defaultValue}`;
  Object.assign(defaultLabel.style, { fontSize: '10px', color: '#666' });
  row.appendChild(defaultLabel);

  const apply = (raw: string) => {
    if (raw.trim() === '') return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    spec.set(v);
    slider.value = String(v);
    numeric.value = String(v);
    rebuildPlayer();
  };
  slider.addEventListener('input', () => apply(slider.value));
  numeric.addEventListener('input', () => apply(numeric.value));

  numericBindings.push({ spec, slider, numeric });
  return row;
}

function buildColorRow(spec: ColorFieldSpec): HTMLElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0', borderBottom: '1px solid #222',
  });

  const label = document.createElement('label');
  label.textContent = spec.label;
  Object.assign(label.style, { fontSize: '12px', color: '#ddd' });
  row.appendChild(label);

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = numToHex(spec.get());
  Object.assign(picker.style, {
    width: '60px', height: '24px', cursor: 'pointer',
    background: 'transparent', border: '1px solid #444', borderRadius: '3px',
  });
  picker.addEventListener('input', () => {
    spec.set(hexToNum(picker.value));
    rebuildPlayer();
  });
  row.appendChild(picker);

  colorBindings.push({ spec, picker });
  return row;
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  Object.assign(btn.style, {
    flex: '1', minWidth: '70px', padding: '6px 8px',
    background: '#1f2540', color: '#ffffff',
    border: '1px solid #444', borderRadius: '4px',
    cursor: 'pointer', fontSize: '12px', fontFamily: 'sans-serif',
  });
  btn.addEventListener('click', onClick);
  return btn;
}

function exportJSON(): void {
  const blob = new Blob([serializePlayer()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'march-mad-player.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        applyPlayerJSON(text);
        syncFromConfig();
      } catch (err) {
        console.error('Failed to import player JSON:', err);
        alert('Failed to import: ' + (err instanceof Error ? err.message : String(err)));
      }
    });
  });
  input.click();
}

function exportAllJSON(): void {
  const combined = JSON.stringify({
    balance: JSON.parse(serializeBalance()),
    level: JSON.parse(serializeLevel()),
    player: JSON.parse(serializePlayer()),
    animConfig: JSON.parse(serializeAnim()),
  }, null, 2);
  const blob = new Blob([combined], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'march-mad-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importAllJSON(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { throw new Error('Invalid JSON'); }
        if (parsed && typeof parsed === 'object' && (parsed.balance || parsed.level || parsed.player || parsed.animConfig)) {
          if (parsed.balance) applyBalanceJSON(JSON.stringify(parsed.balance));
          if (parsed.level) applyLevelJSON(JSON.stringify(parsed.level));
          if (parsed.player) applyPlayerJSON(JSON.stringify(parsed.player));
          if (parsed.animConfig) applyAnimJSON(JSON.stringify(parsed.animConfig));
        } else {
          try { applyBalanceJSON(text); } catch {
            try { applyLevelJSON(text); } catch {
              try { applyPlayerJSON(text); } catch { applyAnimJSON(text); }
            }
          }
        }
        syncFromConfig();
      } catch (err) {
        console.error('Failed to import all-config JSON:', err);
        alert('Failed to import: ' + (err instanceof Error ? err.message : String(err)));
      }
    });
  });
  input.click();
}

function exportGLB(): void {
  if (!player) return;
  const exporter = new GLTFExporter();
  exporter.parse(
    player.group,
    (result) => {
      const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'march-mad-player.glb';
      a.click();
      URL.revokeObjectURL(url);
    },
    (err) => {
      console.error('GLB export failed:', err);
      alert('GLB export failed: ' + (err instanceof Error ? err.message : String(err)));
    },
    { binary: true },
  );
}

// =============================================================================
// Unified snapshot-API adapter (window.__snapshot).
// Mirrors the anim-viewer implementation so the CLI driver
// (scripts/snapshot.cjs) can target either page through a single shape.
// Additive — no UX impact when the page is opened in a normal browser tab.
// =============================================================================

function snapResolveTarget(t?: SnapshotCameraTarget): THREE.Vector3 {
  if (t && typeof t === 'object') return new THREE.Vector3(t.x, t.y, t.z);
  const aliases: Record<string, string[]> = {
    head: ['head'],
    torso: ['torso', 'body-pivot'],
    feet: ['shoe-left', 'shoe-right', 'ankle-left'],
    'hand-left': ['forearm-left', 'elbow-left'],
    'hand-right': ['forearm-right', 'elbow-right'],
  };
  const names = aliases[t ?? 'head'] ?? aliases.head;
  const out = new THREE.Vector3();
  if (player) {
    player.group.updateWorldMatrix(true, true);
    for (const n of names) {
      const obj = player.group.getObjectByName(n);
      if (obj) {
        obj.getWorldPosition(out);
        return out;
      }
    }
  }
  switch (t) {
    case 'feet': return new THREE.Vector3(0, 0.05, 0);
    case 'torso': return new THREE.Vector3(0, 0.9, 0);
    case 'hand-left': return new THREE.Vector3(-0.25, 1.0, 0.05);
    case 'hand-right': return new THREE.Vector3(0.25, 1.0, 0.05);
    case 'head': default: return new THREE.Vector3(0, 1.4, 0);
  }
}

function snapApplyAnimState(state: string, opts?: { freeze?: boolean }): void {
  if (!(ANIM_IDS as readonly string[]).includes(state)) {
    console.warn(`[snapshot] unknown anim state "${state}"`);
    return;
  }
  currentAnim = state as AnimId;
  if (animLoop) animLoop.setAnim(currentAnim);
  applyAnimPropsVisibility();
  __snapFrozen = !!opts?.freeze;
  __snapPendingSteps = 0;
}

const snapshotAPI: SnapshotAPI = {
  scene: 'player-editor',
  capabilities: { face: true, anim: true, beer: true, mocap: false, level: false },
  async ready(): Promise<void> {
    // Player rig is created synchronously via rebuildPlayer() before the
    // module reaches this point, so ready() resolves immediately.
  },
  async setCamera(opts: SnapshotCameraOpts): Promise<void> {
    // Disable OrbitControls so manual position survives the rAF loop.
    controls.enabled = false;
    const target = snapResolveTarget(opts.target);
    const r = opts.dist;
    const x = target.x + r * Math.cos(opts.pitch) * Math.sin(opts.yaw);
    const y = target.y + r * Math.sin(opts.pitch);
    const z = target.z + r * Math.cos(opts.pitch) * Math.cos(opts.yaw);
    camera.position.set(x, y, z);
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
    await new Promise<void>((r2) => requestAnimationFrame(() => r2()));
  },
  async capture(): Promise<string | null> {
    try {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    } catch {
      return null;
    }
  },
  async setFace(name: string): Promise<void> {
    // Drive the same code path as the dropdown: applyFaceSelection re-fetches
    // by name from IDB, populates the in-page caches, and triggers
    // applyCachedFaceToPlayer (setFaceMesh3D + setFaceProcedural). Concurrent
    // populateFaceSelect restores can race against the explicit setFace
    // (both call applyFaceSelection); the apply is idempotent, but we wait a
    // microtask + rAF tick afterward so any in-flight restore lands BEFORE
    // we resolve. Without the wait, the CLI's subsequent setCamera / capture
    // can fire before the head-mesh is mounted, producing a default-faced PNG.
    await applyFaceSelection(name);
    // Yield once so any concurrent populateFaceSelect → applyFaceSelection
    // path's IDB read settles before we declare ready.
    await Promise.resolve();
    // rAF settle: the renderer's next frame draws the freshly-mounted
    // head-mesh-group + cranium + procedural face, so callers that screenshot
    // immediately after setFace see the mounted face rather than the rig's
    // default sphere head.
    await new Promise<void>((r2) => requestAnimationFrame(() => r2()));
  },
  setAnimState(state: string, opts?: { freeze?: boolean }): void {
    snapApplyAnimState(state, opts);
  },
  async stepFrames(n: number): Promise<void> {
    if (!__snapFrozen) {
      console.warn('[snapshot] stepFrames called without freeze=true; ignoring');
      return;
    }
    __snapPendingSteps += Math.max(0, Math.floor(n));
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        if (__snapPendingSteps <= 0) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  },
  setBeer(visible: boolean): void {
    if (!player) return;
    const beer = player.group.getObjectByName('beer');
    if (beer) beer.visible = visible;
  },
};
installSnapshotAPI(snapshotAPI);

// Expose a minimal debug surface mirroring `__animViewerDebug`. The snapshot
// CLI driver probes `hasMesh3D` on whichever debug object exists, so the
// per-page settle wait works on player-editor without page-specific branches.
// `inspectFaceRig` is for one-off diagnostics (cranium centerline tuning).
(window as unknown as { __playerEditorDebug: unknown }).__playerEditorDebug = {
  hasMesh3D(): boolean {
    return builtFaceMeshCache !== null;
  },
  inspectFaceRig() {
    if (!player) return { ok: false, msg: 'no player' };
    player.group.updateWorldMatrix(true, true);
    const slot = player.group.getObjectByName('face-mesh-3d');
    const cranium = player.group.getObjectByName('head-cranium');
    const headSphere = player.group.getObjectByName('head');
    const headGroup = player.group.getObjectByName('head-mesh-group');
    const eyeLeft = player.group.getObjectByName('eye-left');
    const eyeRight = player.group.getObjectByName('eye-right');
    const w = (o: THREE.Object3D | undefined): { x: number; y: number; z: number } | null => {
      if (!o) return null;
      const v = new THREE.Vector3();
      o.getWorldPosition(v);
      return { x: v.x, y: v.y, z: v.z };
    };
    return {
      ok: true,
      slotPos: slot ? { x: slot.position.x, y: slot.position.y, z: slot.position.z } : null,
      slotWorldPos: w(slot),
      craniumWorldPos: w(cranium),
      craniumLocalPos: cranium ? { x: cranium.position.x, y: cranium.position.y, z: cranium.position.z } : null,
      craniumScale: cranium ? { x: cranium.scale.x, y: cranium.scale.y, z: cranium.scale.z } : null,
      headSphereWorldPos: w(headSphere),
      headSphereVisible: headSphere?.visible,
      headGroupChildren: headGroup ? headGroup.children.map((c: THREE.Object3D) => c.name) : null,
      eyeLeftWorldPos: w(eyeLeft),
      eyeRightWorldPos: w(eyeRight),
    };
  },
};
