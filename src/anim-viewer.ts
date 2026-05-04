import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GamePlayer } from './game/player';
import { Ball } from './game/ball';
import { createHoop } from './game/hoop';
import { createDefaultPlayerStats } from './core/types';
import type { Position } from './core/types';
import {
  animConfig,
  serializeAnim,
  applyAnimJSON,
  resetAnim,
  getDefaults as getAnimDefaults,
} from './dev/anim-config';
import { serializeBalance, applyBalanceJSON, resetBalance } from './dev/balance-config';
import { serializeLevel, applyLevelJSON, resetLevel } from './dev/level-config';
import { serializePlayer, applyPlayerJSON, resetPlayer } from './dev/player-config';
import { pickSliderRange, type RangeTier } from './dev/shared-ranges';
import { persistDetails, detailsKey } from './dev/details-state';
import {
  buildBodySections,
  numToHex,
  hexToNum,
  type BodyNumericSpec,
  type BodyColorSpec,
  type BodySectionSpec,
} from './dev/body-sliders';
import { AnimLoop, ANIM_IDS as SNAP_ANIM_IDS, type AnimId as SnapAnimId } from './dev/anim-loop';
import { installSnapshotAPI } from './dev/snapshot/install';
import type {
  SnapshotAPI,
  SnapshotCameraOpts,
  SnapshotCameraTarget,
} from './dev/snapshot/types';
import { listClips, loadClip } from './dev/mocap/clip-store';
import { retarget } from './dev/mocap/retarget';
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

const DEVPANEL_PREFIX = 'devpanel:anim-viewer';
const FACE_LS_KEY = 'devpanel:anim-viewer:face';
const FACE_ANIM_LS_KEY = 'devpanel:anim-viewer:face-anim';
// Phase 8.2a: persistence for the "Show source video" toggle. Stored as
// '1' / '0' so we can flip it without bringing in JSON.parse.
const FACE_ANIM_SHOW_VIDEO_LS_KEY = 'devpanel:anim-viewer:face-anim-show-video';

// --- Renderer ---
const canvas = document.getElementById('viewer-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
camera.position.set(0, 1.5, 4);
camera.lookAt(0, 0.8, 0);

// OrbitControls: click-drag to rotate around the model, scroll to zoom.
// Disabled while auto-rotate is on (we drive the camera manually via camAngle
// so the existing per-animation camera tweaks — pull back for jumps, shift
// focus for shoot/dunk/pass — keep working). Enabled when auto-rotate is off.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.8, 0);
// Enabled when auto-rotate is OFF (the default). Without this init line,
// click-drag was silently ignored because `controls.enabled` was hardcoded
// to false even though `autoRotate = false` — both paths were dead.
controls.enabled = true;

function resize() {
  const wrap = document.getElementById('canvas-wrap')!;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- Lighting ---
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(3, 8, 5);
scene.add(dirLight);

// --- Ground platform ---
const platformGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.05, 24);
const platformMat = new THREE.MeshStandardMaterial({ color: 0x333355 });
const platform = new THREE.Mesh(platformGeo, platformMat);
platform.position.y = -0.025;
scene.add(platform);

// --- Hoop ---
// Hidden by default — the 3.5u team-colored pole sits directly between
// the default camera and player, blocking the view as a giant red column.
// Only shown for animations that visibly need the rim: shoot / dunk / pass.
const hoopPos = new THREE.Vector3(0, 3.05, 2.5); // closer for dunking
const hoop = createHoop(hoopPos, 0xe94560);
hoop.rotation.y = Math.PI; // rotate 180° so backboard faces the player
hoop.visible = false;
scene.add(hoop);

// Grid lines on platform for reference
const gridGeo = new THREE.RingGeometry(0.5, 0.52, 24);
const gridMat = new THREE.MeshBasicMaterial({ color: 0x555577, side: THREE.DoubleSide });
const grid1 = new THREE.Mesh(gridGeo, gridMat);
grid1.rotation.x = -Math.PI / 2;
grid1.position.y = 0.01;
scene.add(grid1);
const grid2 = grid1.clone();
grid2.scale.set(2, 2, 2);
scene.add(grid2);

// --- Player ---
let currentAnim = 'idle';
let animSpeed = 1;
let autoRotate = false;
let camAngle = 0;
let camHeight = 1.5;
let camDist = 4;
let shootReleased = false;
let dunkReleased = false;
let passReleased = false;
let shootResetDelay = 0;
let shootBallFalling = false;
let shootInIdle = false;
let shootIdleTimer = 0;

let player: GamePlayer;
let passTarget: GamePlayer | null = null;

// Face picker state. `selectedFaceName` is the IDB key; the dataUrl is
// cached so player rebuilds (which dispose+recreate the mesh) re-apply
// the face without re-hitting IDB. Phase 7.6 adds `selectedFaceMesh3D` —
// the parsed mesh3d payload (raw landmarks/uvs + image) cached so the
// rebuild path can reconstruct the THREE.Mesh without an IDB round trip.
let selectedFaceName: string = (() => {
  try { return localStorage.getItem(FACE_LS_KEY) ?? ''; } catch { return ''; }
})();
let selectedFaceDataUrl: string | null = null;
// Phase 7.7: cache the detected 478-landmark set alongside the dataUrl so
// rebuildPlayer / createPlayer can re-apply the same face-shaped alpha mask
// + plane transform after the rig is recreated. Undefined when the active
// face has no landmarks (older saves, stylized AI uploads).
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
  // Older scans without profiles fall through to the sphere-head path.
  angles?: Array<{
    poseName: 'front' | 'left' | 'right' | 'up' | 'down' | 'profile-left' | 'profile-right';
    imageDataUrl: string;
    landmarks: number[];
  }>;
  // Phase H2: baked feature-image bundle from H1's stylized baker. When
  // present AND `__faceMode === 'mii'` (default when present), the rig
  // mounts these as flat textured planes (cranium silhouette behind).
  // Older scans without the bundle fall through to the procedural overlay.
  featureImages?: import('./dev/face/types').FeatureImagesBundle;
} | null = null;
// Phase D: cache the sampled-feature bundle alongside the mesh3d payload
// so player rebuilds can re-apply skin/lip/brow/nose/hair/hat without an
// IDB round trip. Bundled as the same `features` shape that
// `setFaceMesh3D` accepts as its 5th positional arg.
let selectedFaceFeatures:
  | (ProceduralFaceFeatures & ProceduralFaceApplyExtension)
  | undefined = undefined;

// --- Mocap-playback state ---
// Lazily instantiated when the user clicks Play Mocap. While `mocapActive`
// is true the inline animation switch below is bypassed and `mocapAnimLoop`
// drives the rig instead. Stop returns control to the regular path.
let mocapAnimLoop: AnimLoop | null = null;
let mocapActive = false;

// Parent container so user-provided XYZ offset sliders can bump the player
// without fighting the per-animation position logic. Child transforms
// compose automatically, so ball.followHolder() still tracks correctly.
const playerContainer = new THREE.Group();
scene.add(playerContainer);
let playerOffsetX = 0;
let playerOffsetY = 0;
let playerOffsetZ = 0;

// Dispose every geometry / material under a THREE.Group so rebuilding the
// player mesh while tuning body dimensions doesn't leak GPU resources.
// Same shape as level-editor.ts's `disposeCourt`.
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

function createPlayer(teamColor: number, hairId: number, position?: Position) {
  if (player) {
    playerContainer.remove(player.group);
    disposePlayerGroup(player.group);
  }
  const stats = createDefaultPlayerStats();
  player = new GamePlayer({
    id: `viewer-${hairId}`,
    name: 'Viewer Player',
    stats,
    personality: 'Team Player',
    isCustom: false,
    position,
    hairOverride: hairId,
  } as any, new THREE.Vector3(0, 0, 0), teamColor);

  player.isHumanControlled = true; // show the indicator
  playerContainer.add(player.group);

  // Re-apply the cached face after a rebuild. The new mesh starts with
  // default eye-spheres + invisible face-plane until setFaceImage / setFaceMesh3D
  // is called. Prefer the 3D mesh path when available — it carries more detail
  // and the flat dataUrl is still available as a fallback if mesh build fails.
  applyCachedFaceToPlayer();
}

function applyCachedFaceToPlayer(): void {
  if (!player) return;
  // Phase 8: any active face-anim puppet must be torn down before we
  // mount a new mesh (the puppet holds a reference to the prior mesh's
  // position attribute). The replay loop is restarted by `applyFaceAnim`
  // after the new mesh lands.
  stopFaceAnimPlayback();
  if (selectedFaceMesh3D) {
    try {
      // G1: prefer the head-mesh path (front face + side panels + back +
      // ears) when profile poses are available in the saved angles. The
      // resulting BuiltHeadMesh extends BuiltFaceMesh, so the procedural
      // overlay + face-anim path stay unchanged.
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
          console.warn('anim-viewer: head-mesh build failed, falling back to face-only', err);
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
      // Phase B: mount the procedural-face overlay alongside the canonical
      // mesh. The face-anim replay loop (below) calls updateFaceProcedural()
      // every frame so the procedural geometry tracks the puppet's
      // deformations.
      player.setFaceProcedural(built);
      // Phase H2: mount the Mii flat-image face when the saved scan has a
      // baked feature bundle. Default __faceMode = 'mii' when present so
      // the planes win over the procedural overlay; A/B can flip via
      // window.__faceMode = 'procedural' / 'mesh' / 'both' in DevTools.
      if (selectedFaceMesh3D.featureImages) {
        if (typeof window !== 'undefined' && window.__faceMode === undefined) {
          window.__faceMode = 'mii';
        }
        void player.setFaceMii(selectedFaceMesh3D.featureImages);
      } else {
        void player.setFaceMii(null);
      }
      // Cache the BuiltFaceMesh so the face-anim path can wrap it without
      // rebuilding. The mesh's geometry is owned by the player from here on.
      builtFaceMeshCache = built;
      // Re-apply the active face-anim selection (if any) on the new mesh.
      if (selectedFaceAnimName) void applyFaceAnim(selectedFaceAnimName);
      return;
    } catch (err) {
      console.warn('anim-viewer: 3D face rebuild failed, falling back to flat', err);
    }
  }
  builtFaceMeshCache = null;
  if (selectedFaceDataUrl !== null) {
    player.setFaceImage(selectedFaceDataUrl, selectedFaceLandmarks);
  } else {
    player.setFaceImage(null);
  }
}

// =============================================================================
// FACE ANIM playback (Phase 8)
// Drives a saved blendshape clip onto the currently-mounted 3D face mesh.
// Lives alongside the existing face dropdown — only active when both a 3D
// face and a clip are selected. Persisted across reloads via FACE_ANIM_LS_KEY.
// =============================================================================

let builtFaceMeshCache: BuiltFaceMesh | null = null;
let facePuppet: FacePuppet | null = null;
let faceAnimRaf = 0;
let selectedFaceAnimName: string = (() => {
  try { return localStorage.getItem(FACE_ANIM_LS_KEY) ?? ''; } catch { return ''; }
})();
// Phase 8.2a: "Show source video" toggle state. The overlay only appears
// when BOTH this flag is on AND the active clip carries a videoBlob.
let faceAnimShowVideo: boolean = (() => {
  try { return localStorage.getItem(FACE_ANIM_SHOW_VIDEO_LS_KEY) === '1'; } catch { return false; }
})();
// Object URL for the currently-displayed source video. Tracked so we can
// revoke it on every clip change / playback stop (no Blob leak).
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
  player.setFaceProceduralBlendshapeSource(null);
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
  // Mesh required — flat-face path can't be deformed.
  if (!builtFaceMeshCache) {
    console.warn('anim-viewer: face-anim selected but no 3D mesh mounted');
    return;
  }
  let clip: FaceAnimClip | null;
  try {
    clip = await loadFaceAnim(name);
  } catch (err) {
    console.warn('anim-viewer: loadFaceAnim failed', err);
    return;
  }
  if (!clip || clip.frames.length === 0) return;
  facePuppet = createFacePuppet(builtFaceMeshCache, { smooth: false });
  // Phase E: hand the puppet to the procedural face for conditional-feature
  // visibility (teeth, tongue) driven off smoothed jawOpen.
  // Phase H4: route through the keyframe mixer when a Mii face is mounted
  // (the mixer is also a BlendshapeSource via its track-state adapter).
  {
    const mixer = player.getFaceMixer();
    player.setFaceProceduralBlendshapeSource(mixer ?? facePuppet);
  }

  // Phase 8.2a: if the toggle is on AND the clip carries source video,
  // mount it in the small corner overlay. Master clock for blendshape
  // lookup is then the video's currentTime — keeps the overlay locked
  // to the rig even at irregular rAF rates.
  let videoMaster = false;
  const sourceVideoEl = document.getElementById('face-anim-source-video') as HTMLVideoElement | null;
  if (faceAnimShowVideo && clip.videoBlob && sourceVideoEl) {
    faceAnimVideoUrl = URL.createObjectURL(clip.videoBlob);
    sourceVideoEl.src = faceAnimVideoUrl;
    sourceVideoEl.muted = true;
    sourceVideoEl.loop = true;
    sourceVideoEl.style.display = 'block';
    sourceVideoEl.play().catch((err) => {
      console.warn('anim-viewer: source video play() rejected', err);
    });
    videoMaster = true;
  }

  const startMs = performance.now();
  const videoOffsetSec = (clip.videoStartOffsetMs ?? 0) / 1000;
  const tick = () => {
    if (!facePuppet) return;
    let elapsedSec: number;
    if (videoMaster && sourceVideoEl) {
      // Drive blendshape lookup from the loop'd video. modulo handles loop
      // wrap; subtract the recorded start offset so frames[0] aligns with
      // video.t=0 from the user's perspective.
      elapsedSec = Math.max(0, sourceVideoEl.currentTime - videoOffsetSec);
    } else {
      elapsedSec = (performance.now() - startMs) / 1000;
    }
    // Loop the clip — anim-viewer's whole pattern is "looping animations".
    const idx = Math.floor(elapsedSec * clip!.fps) % clip!.frames.length;
    if (idx >= 0) {
      const sparse = clip!.frames[idx];
      const frame: BlendshapeFrame = new Map();
      for (const k of Object.keys(sparse)) frame.set(k, sparse[k]);
      facePuppet.apply(frame);
      // Phase B: refresh the procedural-face overlay so its geometry tracks
      // the puppet's now-deformed canonical landmarks.
      player.updateFaceProcedural();
    }
    faceAnimRaf = requestAnimationFrame(tick);
  };
  faceAnimRaf = requestAnimationFrame(tick);
}

createPlayer(0xe94560, 0);

// --- Pass target player (stands opposite, faces passer) ---
function createPassTarget(teamColor: number) {
  if (passTarget) scene.remove(passTarget.group);
  passTarget = new GamePlayer({
    id: 'pass-target',
    name: 'Target',
    stats: createDefaultPlayerStats(),
    personality: 'Team Player',
    isCustom: false,
    hairOverride: 2,
  } as any, new THREE.Vector3(0, 0, 3), teamColor);
  passTarget.group.rotation.y = Math.PI; // face the passer
  passTarget.group.visible = false; // hidden by default
  scene.add(passTarget.group);
}
createPassTarget(0xe94560);

// --- Ball for dribble/shoot/dunk preview ---
const ball = new Ball(new THREE.Vector3(0, 1, 0));
scene.add(ball.mesh);

// --- Animation Loop ---
let lastTime = performance.now();

// Snapshot-driver hooks. When `__snapFrozen` is true, the loop runs at dt=0
// (rig holds its pose). Each pending step consumes one rAF tick at dt=1/60
// so the snapshot driver can advance N frames deterministically without
// fighting wall-clock-derived rawDt. See window.__snapshot.stepFrames().
let __snapFrozen = false;
let __snapPendingSteps = 0;

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const rawDt = (now - lastTime) / 1000;
  lastTime = now;
  let dt = rawDt * animSpeed;
  if (__snapFrozen) {
    if (__snapPendingSteps > 0) {
      dt = 1 / 60;
      __snapPendingSteps--;
    } else {
      dt = 0;
    }
  }

  // Mocap-playback shortcut. When active, bypass the per-anim switch +
  // ball/dunk/pass logic entirely and let AnimLoop drive the rig from the
  // captured PoseFrame stream. Camera + state-label + ball visibility are
  // handled separately so the rest of the page UI keeps working.
  if (mocapActive && mocapAnimLoop) {
    mocapAnimLoop.tick(dt);
    ball.mesh.visible = false;
    if (passTarget) passTarget.group.visible = false;
    // Camera stays under user / auto-rotate control.
    if (autoRotate) {
      camAngle += rawDt * 0.5;
      camera.position.set(
        Math.sin(camAngle) * camDist,
        camHeight,
        Math.cos(camAngle) * camDist,
      );
      camera.lookAt(0, 0.8, 0);
    } else {
      controls.update();
    }
    renderer.render(scene, camera);
    return;
  }

  // Drive the animation state
  switch (currentAnim) {
    case 'idle':
      player.hasBall = false;
      player.velocity.set(0, 0, 0);
      break;
    case 'walk':
      player.hasBall = false;
      // Simulate movement velocity without actually moving
      player.velocity.set(0, 0, 2);
      break;
    case 'dribble':
      player.hasBall = true;
      player.velocity.set(0, 0, 0); // stationary dribble
      break;
    case 'dribble-walk':
      player.hasBall = true;
      player.velocity.set(0, 0, 2); // moving dribble
      break;
    case 'guard':
      player.hasBall = false;
      player.velocity.set(0, 0, 0);
      break;
    case 'steal':
      player.hasBall = false;
      player.velocity.set(0, 0, 0);
      if ((player as unknown as { stealTimer: number }).stealTimer <= 0) {
        player.triggerSteal();
      }
      break;
    case 'shoot':
      player.velocity.set(0, 0, 0);
      if (shootInIdle) {
        // Idle pause between shots
        player.hasBall = false;
      } else if (shootReleased) {
        // Ball has been released — NEVER set hasBall true again
        player.hasBall = false;
      } else {
        player.hasBall = true; // start with ball (only before release)
        if ((player as unknown as { shootTimer: number }).shootTimer <= 0 && shootResetDelay <= 0) {
          player.triggerShoot();
        }
      }
      break;
    case 'jump':
      player.hasBall = false;
      player.velocity.set(0, 0, 0);
      if (!player.isJumping) {
        player.jump();
      }
      break;
    case 'sprint':
      player.hasBall = false;
      player.isSprinting = true;
      player.velocity.set(0, 0, 3);
      break;
    case 'dribble-sprint':
      player.hasBall = true;
      player.isSprinting = true;
      player.velocity.set(0, 0, 3);
      break;
    case 'jump-block':
      player.hasBall = false;
      player.velocity.set(0, 0, 0);
      if (!player.isJumping) player.jump();
      break;
    case 'fall':
      player.hasBall = false;
      player.velocity.set(0, 0, 0);
      break;
    case 'dunk':
      player.hasBall = true;
      player.velocity.set(0, 0, 0);
      if ((player as unknown as { dunkTimer: number }).dunkTimer <= 0) {
        // Reset
        ball.pickup('viewer');
        ball.isInFlight = false;
        player.triggerDunk();
        dunkReleased = false;
      }
      break;
    case 'pass':
      player.velocity.set(0, 0, 0);
      if ((player as unknown as { passTimer: number }).passTimer <= 0) {
        // Reset for next pass cycle
        ball.pickup('viewer');
        ball.isInFlight = false;
        player.hasBall = true;
        player.triggerPass();
        passReleased = false;
      }
      if (!passReleased) {
        player.hasBall = true;
      }
      break;
  }

  // Set forced state for guard/fall/dunk (forceAnimState is checked inside animate)
  if (currentAnim === 'guard') {
    player.forceAnimState('guard');
  }
  if (currentAnim === 'fall') {
    player.forceAnimState('fall');
    if ((player as unknown as { fallTimer: number }).fallTimer <= 0) {
      player.triggerFall();
    }
  }
  if (currentAnim === 'dunk') {
    player.forceAnimState('dunk');
  }

  player.animate(dt);

  // Show/hide pass target player
  if (passTarget) {
    passTarget.group.visible = (currentAnim === 'pass');
    if (currentAnim === 'pass') {
      passTarget.velocity.set(0, 0, 0);
      passTarget.animate(dt); // idle animation
    }
  }

  // CRITICAL: Force hasBall=false after animate() when ball has been released
  // This prevents player.animate() from auto-detecting 'dribble' state
  if (currentAnim === 'shoot' && shootReleased) {
    player.hasBall = false;
  }

  // Handle shoot ball release
  if (currentAnim === 'shoot') {
    const shootTimer = (player as unknown as { shootTimer: number }).shootTimer;

    // Release ball at the right moment
    if (!shootReleased && shootTimer > 0 && shootTimer < 0.2) {
      shootReleased = true;
      player.hasBall = false;
      ball.release();
      ball.shootAt(new THREE.Vector3(0, 3.05, 2.5), 0.8);
      shootBallFalling = false;
    }

    // Keep ball updating if in flight
    if (ball.isInFlight) {
      ball.update(dt);
    }

    // When arc finishes, release the ball so it falls with gravity
    if (shootReleased && !ball.isInFlight && ball.heldBy !== null) {
      ball.release();
    }

    // When arc just finished, give it downward velocity to fall through net
    if (shootReleased && !ball.isInFlight && !shootBallFalling && ball.heldBy === null) {
      ball.velocity.set(0, -3, 0); // gentle drop through net
      shootBallFalling = true;
    }

    // Ball falling after arc — update physics
    if (shootReleased && !ball.isInFlight && ball.heldBy === null) {
      ball.update(dt);
    }

    // Keep player NOT dribbling after shot
    if (shootReleased) {
      player.hasBall = false;
    }

    // After ball lands and shoot is done, wait then reset
    if (shootReleased && !ball.isInFlight && shootTimer <= 0) {
      shootResetDelay += dt;
      if (shootResetDelay > 1.5) {
        // Full reset — go to idle first, not straight to next shot
        ball.pickup('viewer');
        ball.isInFlight = false;
        shootBallFalling = false;
        shootReleased = false;
        shootResetDelay = 0;
        // Idle pause before next shot
        shootInIdle = true;
        shootIdleTimer = 1.0;
        player.hasBall = false;
      }
    }

    // Idle pause between shots
    if (shootInIdle) {
      shootIdleTimer -= dt;
      player.hasBall = false;
      if (shootIdleTimer <= 0) {
        shootInIdle = false;
        player.hasBall = true;
        ball.pickup('viewer');
        player.triggerShoot();
      }
    }

    ball.mesh.visible = true;

    // While ball is in hand, track it
    if (ball.heldBy) {
      ball.followHolder(player.group, false, 0);
    }
  }

  // Handle dunk ball release + body swing
  if (currentAnim === 'dunk') {
    const dunkTimer = (player as unknown as { dunkTimer: number }).dunkTimer;
    const dunkDuration2 = 1.2;
    const dunkProg = 1 - (dunkTimer / dunkDuration2);

    // Release ball at SLAM point — animate it going UP and INTO the hoop
    if (!dunkReleased && dunkProg > 0.38) {
      dunkReleased = true;
      player.hasBall = false;
      ball.release();
      // Start ball at player's hand height, above the rim
      ball.mesh.position.set(0, 3.2, 2.5); // just above rim
      ball.velocity.set(0, -4, 0); // drop through
    }

    if (!ball.heldBy && dunkReleased) {
      ball.update(dt);
    }
    // NOTE: ball.followHolder for dunk is called AFTER player positioning below
    ball.mesh.visible = true;

    // Body swing during rim hang handled in the positioning block below
    if (dunkProg < 0.45 || dunkProg >= 0.65) {
      player.group.rotation.x = 0;
    }
  } else {
    player.group.rotation.x = 0;
  }

  // Ball visibility and position for dribble animations
  if (currentAnim === 'dribble' || currentAnim === 'dribble-walk' || currentAnim === 'dribble-sprint') {
    ball.mesh.visible = true;
    ball.pickup('viewer');
    ball.followHolder(player.group, true, player.dribblePhase);
  } else if (currentAnim === 'pass') {
    // Pass ball handling — ball in hand, then flies to target
    const passTimer = (player as unknown as { passTimer: number }).passTimer;

    // Release ball at throw point (progress ~0.4 => passTimer ~0.21)
    if (!passReleased && passTimer > 0 && passTimer < 0.2) {
      passReleased = true;
      player.hasBall = false;
      ball.release();
      // Pass toward the target player at chest height
      ball.passTo(new THREE.Vector3(0, 1.0, 3));
    }

    if (ball.isInFlight || (!ball.heldBy && passReleased)) {
      ball.update(dt);
    } else if (ball.heldBy) {
      ball.followHolder(player.group, false, 0);
    }

    // Force hasBall false after release so player doesn't dribble
    if (passReleased) {
      player.hasBall = false;
    }

    ball.mesh.visible = true;
  } else if (currentAnim !== 'shoot' && currentAnim !== 'dunk') {
    // Non-ball animations
    ball.mesh.visible = false;
  }
  // shoot and dunk handled separately above

  // Keep player on platform (don't let bouncing move them off)
  // BUT during dunk, let them move toward the hoop
  if (currentAnim !== 'dunk') {
    player.group.position.x = 0;
    player.group.position.z = 0;
  } else {
    // During dunk, TRUE PARABOLIC ARC from start to hoop
    const dunkTimer2 = (player as unknown as { dunkTimer: number }).dunkTimer;
    const dunkDuration3 = 1.2;
    const dunkProgress = 1 - (dunkTimer2 / dunkDuration3);
    const hoopZ = 2.5; // match the hoop position

    // Pendulum parameters for rim hang
    const rimY = 3.05; // rim height (world Y)
    const pendulumLen = 1.8; // hand-on-rim to feet distance

    if (dunkProgress < 0.35) {
      // Arc phase: jump TO the hoop in a parabola
      const arcT = dunkProgress / 0.35; // 0 to 1
      player.group.position.z = arcT * hoopZ; // linear z toward hoop
      // Feet at 1.25 means hand reaches ~3.05 (rim height)
      const endY = rimY - pendulumLen; // ~1.25
      const overshoot = 1.0; // peak above endY at midpoint
      player.group.position.y = endY * arcT + overshoot * Math.sin(arcT * Math.PI);
    } else if (dunkProgress < 0.45) {
      // Slam phase — at front of rim, straight hang
      player.group.position.z = hoopZ - 0.4; // front side of rim
      player.group.position.y = rimY - pendulumLen;
      player.group.rotation.x = 0;
    } else if (dunkProgress < 0.65) {
      // RIM HANG — pendulum swing from hand on rim
      // Hand grips rim at (0, rimY, hoopZ). Body hangs as pendulum below.
      const hangT = (dunkProgress - 0.45) / 0.2; // 0 to 1

      // Pendulum angle: slow tilt in, slightly faster tilt out before dismount
      let angle: number;
      if (hangT < 0.5) {
        // Slow inward tilt
        angle = hangT * 2 * 0.25; // 0 to 0.25 radians over first half
      } else {
        // Slightly faster outward tilt before dismount
        const outT = (hangT - 0.5) / 0.5;
        angle = 0.25 - outT * 0.35; // 0.25 to -0.1 (swings past center)
      }

      // Player position computed from pendulum pivot at FRONT of rim
      const rimFrontZ = hoopZ - 0.4; // front edge of rim
      player.group.position.y = rimY - Math.cos(angle) * pendulumLen;
      player.group.position.z = rimFrontZ - Math.sin(angle) * pendulumLen;
      player.group.rotation.x = angle; // body tilts with the swing
    } else if (dunkProgress < 0.85) {
      // Drop from rim
      const dropT = (dunkProgress - 0.65) / 0.2;
      // Start from where pendulum ended (angle = -0.1)
      const startY = rimY - Math.cos(-0.1) * pendulumLen;
      const rimFrontZ2 = hoopZ - 0.4;
      const startZ = rimFrontZ2 - Math.sin(-0.1) * pendulumLen;
      player.group.position.z = startZ + (hoopZ - startZ) * dropT;
      player.group.position.y = startY * (1 - dropT);
      player.group.rotation.x = -0.1 * (1 - dropT); // straighten during drop
    } else {
      // On ground — landing
      player.group.position.z = hoopZ;
      player.group.position.y = 0;
    }
    player.group.position.x = 0;

    // Update ball to track hand AFTER player position is set
    if (currentAnim === 'dunk' && ball.heldBy && !dunkReleased) {
      player.group.updateWorldMatrix(true, true);
      ball.followHolder(player.group, false);
    }
  }

  // Camera: either the built-in orbit (autoRotate) drives it with the
  // per-animation framing tweaks, or OrbitControls drives it from user drag.
  if (autoRotate) {
    camAngle += rawDt * 0.5;
    // Pull camera back for airborne animations
    let viewCamDist = camDist;
    let viewCamHeight = camHeight;
    if (currentAnim === 'dunk' || currentAnim === 'jump' || currentAnim === 'jump-block' || currentAnim === 'fall') {
      viewCamDist = Math.max(camDist, 6);
      viewCamHeight = Math.max(camHeight, 3);
    }
    camera.position.set(
      Math.sin(camAngle) * viewCamDist,
      viewCamHeight,
      Math.cos(camAngle) * viewCamDist
    );
    if (currentAnim === 'shoot' || currentAnim === 'dunk') {
      camera.lookAt(0, 1.5, 1.25); // between player and hoop (hoop at z=2.5)
    } else if (currentAnim === 'pass') {
      camera.lookAt(0, 1.0, 1.5); // between passer and target (target at z=3)
    } else {
      camera.lookAt(0, 0.8, 0);
    }
  } else {
    controls.update();
  }

  renderer.render(scene, camera);
}
animate();

// --- UI Wiring ---
// Animation buttons
function applyHoopVisibility(): void {
  // Hoop (and its team-colored pole) only rendered for anims that need it.
  hoop.visible = currentAnim === 'shoot' || currentAnim === 'dunk' || currentAnim === 'pass';
}

document.querySelectorAll('[data-anim]').forEach(btn => {
  btn.addEventListener('click', () => {
    currentAnim = (btn as HTMLElement).dataset.anim!;
    document.querySelectorAll('[data-anim]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('state-label')!.textContent = currentAnim;
    applyHoopVisibility();
    // Reset timers and forced state so the new animation can start fresh
    (player as unknown as { stealTimer: number }).stealTimer = 0;
    (player as unknown as { shootTimer: number }).shootTimer = 0;
    (player as unknown as { fallTimer: number }).fallTimer = 0;
    (player as unknown as { dunkTimer: number }).dunkTimer = 0;
    (player as unknown as { passTimer: number }).passTimer = 0;
    player.isJumping = false;
    player.isSprinting = false;
    shootReleased = false;
    dunkReleased = false;
    passReleased = false;
    shootResetDelay = 0;
    shootBallFalling = false;
    shootInIdle = false;
    shootIdleTimer = 0;
    // Reset player position (dunk moves them forward)
    player.group.position.set(0, 0, 0);
    // Clear forced state — only re-force if selecting guard/fall/dunk
    if (currentAnim === 'guard') {
      player.forceAnimState('guard');
    } else if (currentAnim === 'fall') {
      player.forceAnimState('fall');
    } else if (currentAnim === 'dunk') {
      player.forceAnimState('dunk');
    } else {
      player.forceAnimState(null);
    }
    rebuildAnimTuning();
  });
});

// =============================================================================
// MOCAP CLIP playback
// Picks a clip from IndexedDB (populated by /mocap-editor.html) and drives the
// rig directly from the retargeted PoseClip via AnimLoop. While playing, the
// regular animation buttons + speed slider are visually disabled — the speed
// slider is still read for animSpeed (it wraps around the mocap dt too).
// =============================================================================

const mocapSelect = document.getElementById('mocap-clip') as HTMLSelectElement;
const mocapMetaEl = document.getElementById('mocap-clip-meta') as HTMLElement;
const mocapPlayBtn = document.getElementById('mocap-play') as HTMLElement;
const mocapStopBtn = document.getElementById('mocap-stop') as HTMLElement;

const ANIM_BTN_NODES = Array.from(
  document.querySelectorAll<HTMLElement>('[data-anim]'),
);

function setMocapPlayDisabled(disabled: boolean): void {
  mocapPlayBtn.style.opacity = disabled ? '0.4' : '';
  mocapPlayBtn.style.pointerEvents = disabled ? 'none' : '';
}

function setRegularAnimButtonsDisabled(disabled: boolean): void {
  for (const btn of ANIM_BTN_NODES) {
    btn.style.opacity = disabled ? '0.4' : '';
    btn.style.pointerEvents = disabled ? 'none' : '';
  }
}

async function refreshMocapDropdown(): Promise<void> {
  let clips: Awaited<ReturnType<typeof listClips>> = [];
  try {
    clips = await listClips();
  } catch (err) {
    console.warn('mocap: listClips failed', err);
  }
  // Preserve the user's selection when possible.
  const prev = mocapSelect.value;
  mocapSelect.innerHTML = '';
  if (clips.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(no clips — record one in /mocap-editor.html)';
    mocapSelect.appendChild(opt);
    mocapSelect.disabled = true;
    setMocapPlayDisabled(true);
    mocapMetaEl.textContent = 'Plays a saved capture from /mocap-editor on this rig.';
    return;
  }
  mocapSelect.disabled = false;
  setMocapPlayDisabled(mocapActive);
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '(none)';
  mocapSelect.appendChild(placeholder);
  for (const c of clips) {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = `${c.name} (${c.frameCount}f, ${c.targetAnim})`;
    mocapSelect.appendChild(opt);
  }
  if (prev && clips.some((c) => c.name === prev)) {
    mocapSelect.value = prev;
    updateMocapMeta();
  } else {
    mocapMetaEl.textContent = 'Plays a saved capture from /mocap-editor on this rig.';
  }
}

function updateMocapMeta(): void {
  const opt = mocapSelect.options[mocapSelect.selectedIndex];
  if (!opt || opt.value === '') {
    mocapMetaEl.textContent = 'Plays a saved capture from /mocap-editor on this rig.';
    return;
  }
  // The label already encodes frame count + targetAnim — surface targetAnim
  // explicitly so the user knows what motion the clip represents.
  mocapMetaEl.textContent = `Source: ${opt.textContent}`;
}

mocapSelect.addEventListener('change', updateMocapMeta);

mocapPlayBtn.addEventListener('click', async () => {
  const name = mocapSelect.value;
  if (!name) return;
  let clip;
  try {
    clip = await loadClip(name);
  } catch (err) {
    alert('Load failed: ' + (err instanceof Error ? err.message : String(err)));
    return;
  }
  if (!clip) {
    alert(`Clip "${name}" not found in storage.`);
    return;
  }
  const poseClip = retarget(clip);
  if (!mocapAnimLoop) mocapAnimLoop = new AnimLoop(player, { ball });
  else mocapAnimLoop.setPlayer(player);
  mocapAnimLoop.playMocap(poseClip);
  mocapActive = true;
  setRegularAnimButtonsDisabled(true);
  mocapPlayBtn.classList.add('active');
  hoop.visible = false;
  document.getElementById('state-label')!.textContent = `mocap: ${clip.name}`;
});

mocapStopBtn.addEventListener('click', () => {
  if (!mocapActive) return;
  mocapActive = false;
  if (mocapAnimLoop) mocapAnimLoop.stopMocap();
  setRegularAnimButtonsDisabled(false);
  mocapPlayBtn.classList.remove('active');
  // Restore the previously selected anim so the regular path resumes cleanly.
  player.forceAnimState(null);
  player.group.position.set(0, 0, 0);
  player.group.rotation.set(0, 0, 0);
  document.getElementById('state-label')!.textContent = currentAnim;
  applyHoopVisibility();
});

// Refresh the dropdown when the page becomes visible again — the user may
// have just recorded a clip in another tab.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void refreshMocapDropdown();
  }
});

// Initial population.
void refreshMocapDropdown();

// Speed slider
const speedSlider = document.getElementById('speed') as HTMLInputElement;
speedSlider.addEventListener('input', () => {
  animSpeed = parseFloat(speedSlider.value);
  document.getElementById('speed-val')!.textContent = animSpeed.toFixed(1) + 'x';
});

// Position selector
const posSelect = document.getElementById('position') as HTMLSelectElement;
posSelect.addEventListener('change', () => {
  const pos = posSelect.value as Position | '';
  const colorInput = document.getElementById('team-color') as HTMLInputElement;
  const hairSelect = document.getElementById('hair-style') as HTMLSelectElement;
  const color = parseInt(colorInput.value.replace('#', ''), 16);
  createPlayer(color, parseInt(hairSelect.value), pos || undefined);
});

// Camera controls
const autoRotateCheck = document.getElementById('auto-rotate') as HTMLInputElement;
autoRotateCheck.addEventListener('change', () => {
  autoRotate = autoRotateCheck.checked;
  controls.enabled = !autoRotate;
  if (!autoRotate) {
    // Sync OrbitControls' internal spherical state to wherever the auto-
    // rotate camera was just parked, so the first drag doesn't snap.
    controls.target.set(0, 0.8, 0);
    controls.update();
  }
});

const camHeightSlider = document.getElementById('cam-height') as HTMLInputElement;
camHeightSlider.addEventListener('input', () => {
  camHeight = parseFloat(camHeightSlider.value);
  document.getElementById('cam-height-val')!.textContent = camHeight.toFixed(1);
});

const camDistSlider = document.getElementById('cam-dist') as HTMLInputElement;
camDistSlider.addEventListener('input', () => {
  camDist = parseFloat(camDistSlider.value);
  document.getElementById('cam-dist-val')!.textContent = camDist.toFixed(1);
});

// Player XYZ offset — bumps the player from its per-animation baseline
// position. Applied on the parent container so the per-tick animation code
// is untouched and ball.followHolder() tracks correctly via world matrix.
function applyPlayerOffset(): void {
  playerContainer.position.set(playerOffsetX, playerOffsetY, playerOffsetZ);
}
function wireOffsetSlider(axis: 'x' | 'y' | 'z'): void {
  const slider = document.getElementById(`player-offset-${axis}`) as HTMLInputElement;
  const valEl = document.getElementById(`player-offset-${axis}-val`)!;
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    if (axis === 'x') playerOffsetX = v;
    else if (axis === 'y') playerOffsetY = v;
    else playerOffsetZ = v;
    valEl.textContent = v.toFixed(2);
    applyPlayerOffset();
  });
}
wireOffsetSlider('x');
wireOffsetSlider('y');
wireOffsetSlider('z');

const offsetResetBtn = document.getElementById('player-offset-reset')!;
offsetResetBtn.addEventListener('click', () => {
  playerOffsetX = 0;
  playerOffsetY = 0;
  playerOffsetZ = 0;
  for (const axis of ['x', 'y', 'z'] as const) {
    const s = document.getElementById(`player-offset-${axis}`) as HTMLInputElement;
    s.value = '0';
    document.getElementById(`player-offset-${axis}-val`)!.textContent = '0.00';
  }
  applyPlayerOffset();
});

// Appearance
const hairSelect = document.getElementById('hair-style') as HTMLSelectElement;
hairSelect.addEventListener('change', () => {
  const colorInput = document.getElementById('team-color') as HTMLInputElement;
  const color = parseInt(colorInput.value.replace('#', ''), 16);
  const pos = (document.getElementById('position') as HTMLSelectElement).value as Position | '';
  createPlayer(color, parseInt(hairSelect.value), pos || undefined);
});

const colorInput = document.getElementById('team-color') as HTMLInputElement;
colorInput.addEventListener('input', () => {
  const color = parseInt(colorInput.value.replace('#', ''), 16);
  const pos = (document.getElementById('position') as HTMLSelectElement).value as Position | '';
  createPlayer(color, parseInt(hairSelect.value), pos || undefined);
});

// Face picker — populated from /face-editor's IDB. Selecting a face
// applies its image as a texture on the head's face-plane (and hides
// the eye-spheres); selecting "(none)" restores default eyes.
const facePick = document.getElementById('face-pick') as HTMLSelectElement;

async function populateFacePick(): Promise<void> {
  let faces: Awaited<ReturnType<typeof listFaces>> = [];
  let errMsg: string | null = null;
  try {
    faces = await listFaces();
  } catch (err) {
    errMsg = err instanceof Error ? err.message : String(err);
    console.warn('face: listFaces failed', err);
  }
  facePick.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '(none — default eyes)';
  facePick.appendChild(none);
  for (const f of faces) {
    const opt = document.createElement('option');
    opt.value = f.name;
    // [3D] prefix flags entries with mesh3d, mirroring the badge in the
    // face-editor library grid.
    opt.textContent = f.has3D ? `[3D] ${f.name}` : f.name;
    facePick.appendChild(opt);
  }
  // Update the status hint so the user can see whether the list is empty,
  // populated, or errored. Created once next to the select if missing.
  let status = document.getElementById('face-pick-status') as HTMLDivElement | null;
  if (!status) {
    status = document.createElement('div');
    status.id = 'face-pick-status';
    Object.assign(status.style, { fontSize: '11px', padding: '2px 0' });
    facePick.parentElement?.insertBefore(status, facePick.nextSibling);
  }
  if (errMsg) {
    status.style.color = '#ff7a7a';
    status.textContent = `IDB error: ${errMsg}`;
  } else if (faces.length === 0) {
    status.style.color = '#888';
    status.textContent = 'No saved faces yet — open Face Editor to capture one.';
  } else {
    status.style.color = '#888';
    status.textContent = `${faces.length} face${faces.length === 1 ? '' : 's'} in library.`;
  }
  if (selectedFaceName && faces.some((f) => f.name === selectedFaceName)) {
    facePick.value = selectedFaceName;
    await applyFaceSelection(selectedFaceName);
  } else {
    facePick.value = '';
    if (selectedFaceName) {
      // Stale persisted selection; clear silently.
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
  } catch { /* ignore */ }

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
      // Stale: deleted between list and load. Silent fallback per brief.
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
        // G1: pass through the captured pose angles so the rebuild path
        // can construct a head mesh from the profile-left/right captures.
        angles: face.mesh3d.angles,
        // Phase H2: pass through the baked feature-image bundle so the
        // Mii flat-image renderer mounts after the canonical mesh.
        featureImages: face.mesh3d.featureImages,
      };
      // Phase D: bundle the sampled-feature payload from the saved face's
      // mesh3d into the shape `setFaceMesh3D` expects. Each field is
      // independently optional — old saves missing some/all of these
      // sampled fields fall through to procedural-face defaults.
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

facePick.addEventListener('change', () => {
  void applyFaceSelection(facePick.value);
});

// Refresh when returning to this tab — the user may have just captured a
// new face in /face-editor.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void populateFacePick();
    void populateFaceAnimPick();
  }
});

void populateFacePick();

// --- Face Anim picker (Phase 8) ---
const faceAnimPick = document.getElementById('face-anim-pick') as HTMLSelectElement | null;

async function populateFaceAnimPick(): Promise<void> {
  if (!faceAnimPick) return;
  let clips: Awaited<ReturnType<typeof listFaceAnims>> = [];
  try {
    clips = await listFaceAnims();
  } catch (err) {
    console.warn('anim-viewer: listFaceAnims failed', err);
  }
  faceAnimPick.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '(none)';
  faceAnimPick.appendChild(none);
  for (const c of clips) {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = `${c.name} (${c.frameCount}f, ${c.durationSec.toFixed(1)}s)`;
    faceAnimPick.appendChild(opt);
  }
  if (selectedFaceAnimName && clips.some((c) => c.name === selectedFaceAnimName)) {
    faceAnimPick.value = selectedFaceAnimName;
    // Re-apply on populate so a reload restores looping playback.
    void applyFaceAnim(selectedFaceAnimName);
  } else {
    faceAnimPick.value = '';
    if (selectedFaceAnimName) {
      // Stale persisted clip — clear silently.
      selectedFaceAnimName = '';
      try { localStorage.removeItem(FACE_ANIM_LS_KEY); } catch { /* ignore */ }
    }
  }
}

faceAnimPick?.addEventListener('change', () => {
  const name = faceAnimPick.value;
  if (name && !builtFaceMeshCache) {
    alert('Face anims play only on 3D-scanned faces. Pick a [3D] face above first.');
    faceAnimPick.value = selectedFaceAnimName || '';
    return;
  }
  void applyFaceAnim(name);
});

void populateFaceAnimPick();

// Phase 8.2a: "Show source video" toggle. When flipped, restart the
// active face-anim playback so the master-clock decision (wall-clock vs
// video.currentTime) is re-evaluated. Persists across reloads.
const faceAnimShowVideoCheckbox = document.getElementById(
  'face-anim-show-video',
) as HTMLInputElement | null;
if (faceAnimShowVideoCheckbox) {
  faceAnimShowVideoCheckbox.checked = faceAnimShowVideo;
  faceAnimShowVideoCheckbox.addEventListener('change', () => {
    faceAnimShowVideo = faceAnimShowVideoCheckbox.checked;
    try {
      localStorage.setItem(FACE_ANIM_SHOW_VIDEO_LS_KEY, faceAnimShowVideo ? '1' : '0');
    } catch { /* ignore quota / privacy mode */ }
    // Restart any active playback so the toggle takes effect immediately.
    if (selectedFaceAnimName) void applyFaceAnim(selectedFaceAnimName);
  });
}

// Export Player GLB — snapshots the current player mesh for inspection in Blender.
// Edits in Blender don't flow back; the procedural code rebuilds the player on every match.
document.getElementById('export-glb')?.addEventListener('click', () => {
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
});

// =============================================================================
// ANIMATION TUNING PANEL
// Context-aware sliders bound to `animConfig`. The currently selected animation
// drives which subgroups are shown. GamePlayer.animate() reads animConfig every
// tick, so mutating a field is enough — no rebuild needed.
// =============================================================================

// Map dropdown anim id → keys inside animConfig.amplitudes / animConfig.poses
// and the list of per-animation duration fields to surface.
interface AnimMapping {
  configKey: string; // key into amplitudes / poses
  durations: string[]; // per-animation duration fields
  extraConfigKeys?: string[]; // additional amplitude/pose groups to show (e.g. walk-while-dribbling)
}

const ANIM_MAP: Record<string, AnimMapping> = {
  'idle': { configKey: 'idle', durations: ['idleBob'] },
  'walk': { configKey: 'walk', durations: ['walkStride', 'walkBounce'] },
  'dribble': { configKey: 'dribbleStationary', durations: ['dribbleCycle'] },
  'dribble-walk': { configKey: 'dribble', durations: ['dribbleCycle', 'walkStride', 'walkBounce'] },
  'guard': { configKey: 'guard', durations: ['guardPulse'] },
  'steal': { configKey: 'steal', durations: ['stealDuration'] },
  'shoot': { configKey: 'shoot', durations: ['shootDuration'] },
  'jump': { configKey: 'jump', durations: ['jumpDuration'] },
  'sprint': { configKey: 'sprint', durations: ['sprintStride', 'sprintBounce'] },
  'dribble-sprint': { configKey: 'dribbleSprint', durations: ['dribbleSprintStride', 'dribbleSprintBounce', 'dribbleCycle'] },
  'jump-block': { configKey: 'jumpBlock', durations: ['jumpBlockDuration'] },
  'fall': { configKey: 'fall', durations: ['fallDuration'] },
  'dunk': { configKey: 'dunk', durations: ['dunkDuration'] },
  'pass': { configKey: 'pass', durations: ['passDuration'] },
};

// Shared cycle-frequency durations that apply across multiple animations.
const SHARED_DURATION_KEYS = ['idleBob', 'walkStride', 'walkBounce', 'backwardStride', 'backwardBounce',
  'sprintStride', 'sprintBounce', 'dribbleCycle', 'dribbleSprintStride', 'dribbleSprintBounce',
  'guardPulse', 'indicatorBob', 'possessionRingPulse'];

interface TuningSection {
  title: string;
  /** Parent object on animConfig to bind against (live, mutated in place). */
  parent: Record<string, number>;
  /** Parent object on the defaults snapshot, for "default:" labels. */
  defaultParent: Record<string, number>;
  /** Restricted to this subset of keys (if null, show all keys on parent). */
  keys: string[] | null;
  /** Which tier of `animConfig` this section targets, for shared range lookup. */
  tier: RangeTier;
  /** Sub-key under `amplitudes`/`poses` (e.g. `'jump'`); empty for durations. */
  animKey: string;
  openByDefault?: boolean;
}

function buildAnimTuningSections(animId: string): TuningSection[] {
  const mapping = ANIM_MAP[animId];
  const defaults = getAnimDefaults();
  const sections: TuningSection[] = [];

  // Shared cycle-frequency durations — always present.
  sections.push({
    title: 'Durations (shared)',
    parent: animConfig.durations as unknown as Record<string, number>,
    defaultParent: defaults.durations as unknown as Record<string, number>,
    keys: SHARED_DURATION_KEYS.slice(),
    tier: 'durations',
    animKey: '',
    openByDefault: false,
  });

  if (!mapping) return sections;

  // Per-animation duration(s)
  if (mapping.durations.length > 0) {
    sections.push({
      title: `Duration: ${animId}`,
      parent: animConfig.durations as unknown as Record<string, number>,
      defaultParent: defaults.durations as unknown as Record<string, number>,
      keys: mapping.durations.slice(),
      tier: 'durations',
      animKey: '',
      openByDefault: true,
    });
  }

  const keysToShow = [mapping.configKey, ...(mapping.extraConfigKeys ?? [])];

  // Amplitudes for this animation
  const ampRoot = animConfig.amplitudes as unknown as Record<string, Record<string, number>>;
  const ampDefRoot = defaults.amplitudes as unknown as Record<string, Record<string, number>>;
  for (const key of keysToShow) {
    const ampGroup = ampRoot[key];
    if (ampGroup && typeof ampGroup === 'object') {
      sections.push({
        title: `Amplitudes: ${key}`,
        parent: ampGroup,
        defaultParent: ampDefRoot[key],
        keys: null,
        tier: 'amplitudes',
        animKey: key,
        openByDefault: true,
      });
    }
  }

  // Poses for this animation
  const poseRoot = animConfig.poses as unknown as Record<string, Record<string, number>>;
  const poseDefRoot = defaults.poses as unknown as Record<string, Record<string, number>>;
  for (const key of keysToShow) {
    const poseGroup = poseRoot[key];
    if (poseGroup && typeof poseGroup === 'object') {
      sections.push({
        title: `Poses: ${key}`,
        parent: poseGroup,
        defaultParent: poseDefRoot[key],
        keys: null,
        tier: 'poses',
        animKey: key,
        openByDefault: false,
      });
    }
  }

  return sections;
}

function buildSlider(
  parent: Record<string, number>,
  defaultParent: Record<string, number> | undefined,
  key: string,
  tier: RangeTier,
  animKey: string,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'at-slider-row';

  const currentVal = parent[key];
  const defaultVal = defaultParent ? defaultParent[key] : currentVal;
  const path = tier === 'durations' ? [tier, key] : [tier, animKey, key];
  const range = pickSliderRange(tier, path, key, defaultVal);

  const head = document.createElement('div');
  head.className = 'at-slider-head';

  const label = document.createElement('span');
  label.className = 'at-slider-label';
  label.textContent = key;
  head.appendChild(label);

  const numeric = document.createElement('input');
  numeric.type = 'number';
  numeric.className = 'at-slider-num';
  numeric.min = String(range.min);
  numeric.max = String(range.max);
  numeric.step = String(range.step);
  numeric.value = String(currentVal);
  head.appendChild(numeric);

  row.appendChild(head);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(range.min);
  slider.max = String(range.max);
  slider.step = String(range.step);
  slider.value = String(currentVal);
  row.appendChild(slider);

  const defLabel = document.createElement('div');
  defLabel.className = 'at-slider-default';
  defLabel.textContent = `default: ${defaultVal}`;
  row.appendChild(defLabel);

  const apply = (raw: string) => {
    if (raw.trim() === '') return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    parent[key] = v;
    slider.value = String(v);
    numeric.value = String(v);
  };
  slider.addEventListener('input', () => apply(slider.value));
  numeric.addEventListener('input', () => apply(numeric.value));

  return row;
}

function rebuildAnimTuning(): void {
  const host = document.getElementById('anim-tuning');
  if (!host) return;
  host.innerHTML = '';
  const sections = buildAnimTuningSections(currentAnim);
  for (const section of sections) {
    const details = document.createElement('details');
    if (section.openByDefault) details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = section.title;
    details.appendChild(summary);

    const keys = section.keys ?? Object.keys(section.parent);
    for (const key of keys) {
      if (typeof section.parent[key] !== 'number') continue;
      details.appendChild(buildSlider(section.parent, section.defaultParent, key, section.tier, section.animKey));
    }
    persistDetails(details, detailsKey(DEVPANEL_PREFIX, currentAnim, section.title));
    host.appendChild(details);
  }
}

// "ALL CONFIGS" row — resets/exports/imports balance + level + player + anim
// together. Injected above the existing anim-only row so the domain-scoped
// buttons remain available for quick anim-only workflows.
installAllConfigsRow();

function installAllConfigsRow(): void {
  const existingRow = document.getElementById('anim-tuning-buttons');
  if (!existingRow || !existingRow.parentElement) return;
  const parent = existingRow.parentElement;

  const label = document.createElement('label');
  label.textContent = 'ALL CONFIGS';
  Object.assign(label.style, {
    fontSize: '10px',
    letterSpacing: '1.5px',
    color: '#888',
    marginTop: '4px',
  });

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '4px', marginBottom: '4px' });
  row.id = 'anim-tuning-all-buttons';

  const mkBtn = (text: string, onClick: () => void) => {
    const btn = document.createElement('div');
    btn.className = 'btn';
    btn.textContent = text;
    Object.assign(btn.style, { flex: '1', fontSize: '12px', padding: '6px' });
    btn.addEventListener('click', onClick);
    return btn;
  };

  row.appendChild(mkBtn('Reset All', () => {
    resetBalance();
    resetLevel();
    resetPlayer();
    resetAnim();
    rebuildAnimTuning();
  }));
  row.appendChild(mkBtn('Export All', () => {
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
  }));
  row.appendChild(mkBtn('Import All', () => {
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
          rebuildAnimTuning();
        } catch (err) {
          alert('Import failed: ' + (err instanceof Error ? err.message : String(err)));
        }
      });
    });
    input.click();
  }));

  parent.insertBefore(label, existingRow);
  parent.insertBefore(row, existingRow);
}

document.getElementById('anim-reset')?.addEventListener('click', () => {
  resetAnim();
  rebuildAnimTuning();
});

document.getElementById('anim-export')?.addEventListener('click', () => {
  const json = serializeAnim();
  const nav = navigator as Navigator & { clipboard?: { writeText?: (t: string) => Promise<void> } };
  const copyFallback = () => window.prompt('Copy anim JSON:', json);
  if (nav.clipboard?.writeText) {
    nav.clipboard.writeText(json).then(() => {
      alert('Animation JSON copied to clipboard.');
    }).catch(() => { copyFallback(); });
  } else {
    copyFallback();
  }
});

document.getElementById('anim-import')?.addEventListener('click', () => {
  const text = window.prompt('Paste anim JSON to import:');
  if (text == null || text.trim() === '') return;
  try {
    applyAnimJSON(text);
    rebuildAnimTuning();
  } catch (err) {
    alert('Import failed: ' + (err instanceof Error ? err.message : String(err)));
  }
});

// Initial build for the default-selected animation.
rebuildAnimTuning();

// =============================================================================
// PLAYER BODY TUNING PANEL
// Rebuilds the player mesh on every slider change while the selected animation
// continues to loop. For timed animations (shoot/dunk/fall/pass/steal/jump/
// jump-block), the timer is re-triggered after rebuild so the loop continues
// cleanly — a brief restart is acceptable per the phase 2 spec.
// =============================================================================

const BODY_TIMED_ANIMS = new Set(['shoot', 'dunk', 'fall', 'pass', 'steal', 'jump', 'jump-block']);

// Track shared numeric + color inputs so we can re-sync them after a full
// player re-roll (via position/hair change) — keeps the UI consistent.
const bodyNumericBindings: Array<{ spec: BodyNumericSpec; slider: HTMLInputElement; numeric: HTMLInputElement }> = [];
const bodyColorBindings: Array<{ spec: BodyColorSpec; picker: HTMLInputElement }> = [];

// Rebuild the player mesh from current playerConfig while preserving the
// currently selected animation. Avoids the full createPlayer() path because
// that reads position/hair from DOM — for body edits we want the same
// position/hair, we're only picking up the new body dimensions.
function rebuildPlayerForBodyEdit(): void {
  const savedAnim = currentAnim;
  const savedIsJumping = player.isJumping;
  const savedIsSprinting = player.isSprinting;

  const hairSel = document.getElementById('hair-style') as HTMLSelectElement;
  const colorEl = document.getElementById('team-color') as HTMLInputElement;
  const posSel = document.getElementById('position') as HTMLSelectElement;
  const color = parseInt(colorEl.value.replace('#', ''), 16);
  const hairId = parseInt(hairSel.value);
  const pos = (posSel.value as Position | '') || undefined;

  // Drop and dispose the prior mesh, build a fresh one.
  createPlayer(color, hairId, pos);

  // Re-apply sprint flag (dribble-sprint / sprint drive it every tick but
  // jump-block doesn't — keep the flag live across the rebuild).
  player.isSprinting = savedIsSprinting;

  // For timed animations, re-trigger the timer so the loop continues cleanly.
  // Flat-state animations (idle / walk / dribble / dribble-walk / dribble-sprint
  // / sprint / guard) resume naturally via the animate-loop switch.
  shootReleased = false;
  dunkReleased = false;
  passReleased = false;
  shootResetDelay = 0;
  shootBallFalling = false;
  shootInIdle = false;
  shootIdleTimer = 0;

  if (savedAnim === 'guard') {
    player.forceAnimState('guard');
  } else if (savedAnim === 'fall') {
    player.forceAnimState('fall');
    player.triggerFall();
  } else if (savedAnim === 'dunk') {
    player.forceAnimState('dunk');
    ball.pickup('viewer');
    ball.isInFlight = false;
    player.triggerDunk();
  } else if (savedAnim === 'shoot') {
    player.hasBall = true;
    ball.pickup('viewer');
    ball.isInFlight = false;
    player.triggerShoot();
  } else if (savedAnim === 'pass') {
    player.hasBall = true;
    ball.pickup('viewer');
    ball.isInFlight = false;
    player.triggerPass();
  } else if (savedAnim === 'steal') {
    player.triggerSteal();
  } else if (savedAnim === 'jump' || savedAnim === 'jump-block') {
    if (savedIsJumping) {
      // The jump flag is re-armed by the switch dispatch on the next tick,
      // but priming it here avoids a one-frame "idle" flash.
      player.jump();
    }
  }

  void BODY_TIMED_ANIMS; // retained for documentation; switch above handles each case explicitly.
}

function syncBodyInputsFromConfig(): void {
  for (const b of bodyNumericBindings) {
    const v = b.spec.get();
    b.slider.value = String(v);
    b.numeric.value = String(v);
  }
  for (const b of bodyColorBindings) {
    b.picker.value = numToHex(b.spec.get());
  }
}

function buildBodyNumericRow(spec: BodyNumericSpec): HTMLElement {
  const row = document.createElement('div');
  row.className = 'bt-slider-row';

  const head = document.createElement('div');
  head.className = 'bt-slider-head';

  const label = document.createElement('span');
  label.className = 'bt-slider-label';
  label.textContent = spec.label;
  head.appendChild(label);

  const numeric = document.createElement('input');
  numeric.type = 'number';
  numeric.className = 'bt-slider-num';
  numeric.min = String(spec.min);
  numeric.max = String(spec.max);
  numeric.step = String(spec.step);
  numeric.value = String(spec.get());
  head.appendChild(numeric);

  row.appendChild(head);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(spec.min);
  slider.max = String(spec.max);
  slider.step = String(spec.step);
  slider.value = String(spec.get());
  row.appendChild(slider);

  const defLabel = document.createElement('div');
  defLabel.className = 'bt-slider-default';
  defLabel.textContent = `default: ${spec.defaultValue}`;
  row.appendChild(defLabel);

  const apply = (raw: string) => {
    if (raw.trim() === '') return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    spec.set(v);
    slider.value = String(v);
    numeric.value = String(v);
    rebuildPlayerForBodyEdit();
  };
  slider.addEventListener('input', () => apply(slider.value));
  numeric.addEventListener('input', () => apply(numeric.value));

  bodyNumericBindings.push({ spec, slider, numeric });
  return row;
}

function buildBodyColorRow(spec: BodyColorSpec): HTMLElement {
  const row = document.createElement('div');
  row.className = 'bt-color-row';

  const label = document.createElement('span');
  label.className = 'bt-color-label';
  label.textContent = spec.label;
  row.appendChild(label);

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = numToHex(spec.get());
  picker.addEventListener('input', () => {
    spec.set(hexToNum(picker.value));
    rebuildPlayerForBodyEdit();
  });
  row.appendChild(picker);

  bodyColorBindings.push({ spec, picker });
  return row;
}

function buildBodySubsection(spec: BodySectionSpec, open: boolean): HTMLDetailsElement {
  const details = document.createElement('details');
  if (open) details.open = true;
  const summary = document.createElement('summary');
  summary.textContent = spec.title;
  details.appendChild(summary);

  for (const n of spec.numerics ?? []) details.appendChild(buildBodyNumericRow(n));
  for (const c of spec.colors ?? []) details.appendChild(buildBodyColorRow(c));

  persistDetails(details, detailsKey(DEVPANEL_PREFIX, 'PLAYER BODY', spec.title));
  return details;
}

function buildBodyPanel(): void {
  const host = document.getElementById('body-tuning');
  if (!host) return;
  host.innerHTML = '';
  bodyNumericBindings.length = 0;
  bodyColorBindings.length = 0;

  const root = document.createElement('details');
  root.className = 'body-root';
  root.open = true;
  const rootSummary = document.createElement('summary');
  rootSummary.textContent = 'PLAYER BODY';
  root.appendChild(rootSummary);
  persistDetails(root, detailsKey(DEVPANEL_PREFIX, 'PLAYER BODY'));

  const sections = buildBodySections();
  for (let i = 0; i < sections.length; i++) {
    // HEAD open by default (landing point), others collapsed — matches dev-overlay.
    root.appendChild(buildBodySubsection(sections[i], i === 0));
  }

  host.appendChild(root);
}

buildBodyPanel();

// Reset/Import may mutate playerConfig — the existing Reset All / Import All /
// Reset handlers already call rebuildAnimTuning() after applying. Hook a
// MutationObserver-free sync by patching the buttons we already own: after any
// click on the existing anim-tuning / all-config reset/import buttons, re-read
// body inputs from playerConfig and rebuild the mesh.
(['anim-reset', 'anim-import'] as const).forEach((id) => {
  document.getElementById(id)?.addEventListener('click', () => {
    syncBodyInputsFromConfig();
    rebuildPlayerForBodyEdit();
  });
});
const allBtnRow = document.getElementById('anim-tuning-all-buttons');
if (allBtnRow) {
  allBtnRow.addEventListener('click', () => {
    // Fires for any Reset All / Import All button click — re-sync on the next
    // tick so applyXxxJSON / resetXxx have already mutated playerConfig.
    setTimeout(() => {
      syncBodyInputsFromConfig();
      rebuildPlayerForBodyEdit();
    }, 0);
  });
}

// =============================================================================
// F4 verification-harness debug hook.
// Exposes the few escape hatches `scripts/verify-face-render.cjs` needs to
// drive this page from puppeteer:
//   - apply a face by name (bypasses the dropdown's change event flow)
//   - aim the camera at a yaw/pitch around the head (orbit-style)
//   - pump a single-blendshape value through a temporary FacePuppet so the
//     mesh visibly deforms before screenshot
// Kept tiny + idempotent so it can stay in the bundle long-term without
// risk. No-ops gracefully when the rig isn't ready / no face is mounted.
// =============================================================================
declare global {
  interface Window { __animViewerDebug?: AnimViewerDebug }
}
interface AnimViewerDebug {
  setCameraAngle(yaw: number, pitch: number, dist?: number): void;
  applyBlendshape(name: string, value: number): void;
  applyFaceByName(name: string): Promise<void>;
  resetBlendshapes(): void;
  hasMesh3D(): boolean;
  refreshFaceList(): Promise<void>;
}

// Standalone puppet used by the verification harness so blendshape pokes
// don't require an active face-anim clip. Re-created on demand because
// applyFaceSelection() / applyCachedFaceToPlayer() rebuild the underlying
// BuiltFaceMesh and the puppet caches a position-attribute reference.
let f4Puppet: FacePuppet | null = null;
function f4EnsurePuppet(): FacePuppet | null {
  if (!builtFaceMeshCache) return null;
  if (f4Puppet) return f4Puppet;
  // smooth=false so a single .apply() call lands the deformation on this frame
  // — the harness expects "set value, screenshot" without the EMA settling
  // window that interactive playback uses.
  f4Puppet = createFacePuppet(builtFaceMeshCache, { smooth: false });
  // Phase H4: prefer the keyframe mixer when present — it satisfies
  // BlendshapeSource by translating track state into ARKit scalars.
  {
    const mixer = player.getFaceMixer();
    player.setFaceProceduralBlendshapeSource(mixer ?? f4Puppet);
  }
  return f4Puppet;
}

(window as unknown as { __animViewerDebug: AnimViewerDebug }).__animViewerDebug = {
  setCameraAngle(yaw: number, pitch: number, dist?: number): void {
    // Force OrbitControls off so our manual position survives the next
    // animate() tick. autoRotate stays whatever the UI says — caller can
    // toggle the checkbox via puppeteer if it matters.
    controls.enabled = false;
    const r = dist ?? camDist;
    const target = new THREE.Vector3(0, 0.9, 0); // approx head height
    const x = r * Math.cos(pitch) * Math.sin(yaw);
    const y = target.y + r * Math.sin(pitch);
    const z = r * Math.cos(pitch) * Math.cos(yaw);
    camera.position.set(x, y, z);
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
  },
  applyBlendshape(name: string, value: number): void {
    const p = f4EnsurePuppet();
    if (!p) return;
    const frame: BlendshapeFrame = new Map([[name, value]]);
    // smooth:false puppet — one apply() lands the full deformation. Pump a
    // few extra times so any latent EMA-style consumer downstream stabilizes
    // (the procedural-face conditional features read smoothed values).
    for (let i = 0; i < 6; i++) p.apply(frame);
    player.updateFaceProcedural();
  },
  resetBlendshapes(): void {
    if (f4Puppet) {
      f4Puppet.reset();
      player.updateFaceProcedural();
    }
  },
  async applyFaceByName(name: string): Promise<void> {
    // Tear down any previous F4 puppet so it doesn't outlive the mesh it
    // was bound to (createFacePuppet caches the position attribute).
    if (f4Puppet) {
      f4Puppet.dispose();
      f4Puppet = null;
    }
    await applyFaceSelection(name);
  },
  hasMesh3D(): boolean {
    return builtFaceMeshCache !== null;
  },
  async refreshFaceList(): Promise<void> {
    await populateFacePick();
  },
};

// =============================================================================
// Unified snapshot-API adapter (window.__snapshot).
// Wraps the existing __animViewerDebug primitives so a single CLI driver
// (scripts/snapshot.cjs) can drive every dev page through the same shape.
// Additive — does NOT alter or remove __animViewerDebug; the F4 verification
// harness keeps working unchanged.
// (Imports for installSnapshotAPI / SnapshotAPI / ANIM_IDS are added at the
//  top of the file alongside the other module imports.)
// =============================================================================

// Resolve a logical target ('head' / 'torso' / 'feet' / 'hand-left' / ...)
// against the active rig. Falls back to a sensible head height when the
// named bone isn't found (player not built yet, or aliases differ).
function snapResolveTarget(t?: SnapshotCameraTarget): THREE.Vector3 {
  if (t && typeof t === 'object') return new THREE.Vector3(t.x, t.y, t.z);
  // Bone-name aliases per logical target. The rig uses kebab-case names
  // (see GamePlayer.createMesh): 'head', 'torso', 'forearm-left/right',
  // 'shoe-left/right'. Falls back to the first found.
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
  // Fallback approximations by anchor when rig isn't ready / bone missing.
  switch (t) {
    case 'feet': return new THREE.Vector3(0, 0.05, 0);
    case 'torso': return new THREE.Vector3(0, 0.9, 0);
    case 'hand-left': return new THREE.Vector3(-0.25, 1.0, 0.05);
    case 'hand-right': return new THREE.Vector3(0.25, 1.0, 0.05);
    case 'head': default: return new THREE.Vector3(0, 1.4, 0);
  }
}

function snapApplyAnimState(state: string, opts?: { freeze?: boolean }): void {
  if (!(SNAP_ANIM_IDS as readonly string[]).includes(state)) {
    // eslint-disable-next-line no-console
    console.warn(`[snapshot] unknown anim state "${state}"`);
    return;
  }
  // Drive the same code path the anim-button click uses, minus the DOM
  // active-class shuffle. Keeps shoot/dunk/pass timers + forced state
  // semantics identical.
  currentAnim = state as SnapAnimId;
  const sl = document.getElementById('state-label');
  if (sl) sl.textContent = currentAnim;
  applyHoopVisibility();
  (player as unknown as { stealTimer: number }).stealTimer = 0;
  (player as unknown as { shootTimer: number }).shootTimer = 0;
  (player as unknown as { fallTimer: number }).fallTimer = 0;
  (player as unknown as { dunkTimer: number }).dunkTimer = 0;
  (player as unknown as { passTimer: number }).passTimer = 0;
  player.isJumping = false;
  player.isSprinting = false;
  shootReleased = false;
  dunkReleased = false;
  passReleased = false;
  shootResetDelay = 0;
  shootBallFalling = false;
  shootInIdle = false;
  shootIdleTimer = 0;
  player.group.position.set(0, 0, 0);
  if (currentAnim === 'guard') player.forceAnimState('guard');
  else if (currentAnim === 'fall') player.forceAnimState('fall');
  else if (currentAnim === 'dunk') player.forceAnimState('dunk');
  else player.forceAnimState(null);
  __snapFrozen = !!opts?.freeze;
  __snapPendingSteps = 0;
}

const snapshotAPI: SnapshotAPI = {
  scene: 'anim-viewer',
  capabilities: { face: true, anim: true, beer: true, mocap: false, level: false },
  async ready(): Promise<void> {
    // The rig + canvas exist by the time this module finishes executing —
    // ready() resolves immediately. Kept async so the contract matches
    // pages where build is genuinely deferred.
  },
  async setCamera(opts: SnapshotCameraOpts): Promise<void> {
    controls.enabled = false;
    autoRotate = false;
    const target = snapResolveTarget(opts.target);
    const r = opts.dist;
    const x = target.x + r * Math.cos(opts.pitch) * Math.sin(opts.yaw);
    const y = target.y + r * Math.sin(opts.pitch);
    const z = target.z + r * Math.cos(opts.pitch) * Math.cos(opts.yaw);
    camera.position.set(x, y, z);
    controls.target.copy(target);
    camera.lookAt(target);
    controls.update();
    // One rAF settle so geometry + materials flush before capture.
    await new Promise<void>((r2) => requestAnimationFrame(() => r2()));
  },
  async capture(): Promise<string | null> {
    // The renderer is created without preserveDrawingBuffer, so toDataURL
    // can return blank pixels when called outside the same frame as
    // render. Force a synchronous render here, then attempt toDataURL —
    // CLI uses page.screenshot as the source of truth, this return value
    // is a best-effort fallback for in-browser callers.
    try {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    } catch {
      return null;
    }
  },
  async setFace(name: string): Promise<void> {
    if (f4Puppet) { f4Puppet.dispose(); f4Puppet = null; }
    await applyFaceSelection(name);
  },
  setBlendshape(name: string, value: number): void {
    const p = f4EnsurePuppet();
    if (!p) return;
    const frame: BlendshapeFrame = new Map([[name, value]]);
    for (let i = 0; i < 6; i++) p.apply(frame);
    player.updateFaceProcedural();
  },
  resetBlendshapes(): void {
    if (f4Puppet) {
      f4Puppet.reset();
      player.updateFaceProcedural();
    }
  },
  setAnimState(state: string, opts?: { freeze?: boolean }): void {
    snapApplyAnimState(state, opts);
  },
  async stepFrames(n: number): Promise<void> {
    if (!__snapFrozen) {
      // eslint-disable-next-line no-console
      console.warn('[snapshot] stepFrames called without freeze=true; ignoring');
      return;
    }
    __snapPendingSteps += Math.max(0, Math.floor(n));
    // Wait for the rAF loop to drain the queue.
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
