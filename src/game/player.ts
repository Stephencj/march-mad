import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PlayerData } from '@/core/types';
import { POSITION_SCALES } from '@/core/types';
import { playerConfig } from '@/dev/player-config';
import { animConfig } from '@/dev/anim-config';
import {
  createProceduralFace,
  type BlendshapeSource,
  type ProceduralFace,
  type ProceduralFaceFeatures,
} from '@/dev/face/procedural-face';
import type { BuiltFaceMesh } from '@/dev/face/mesh-builder';
import type { BuiltHeadMesh } from '@/dev/face/head-mesh-builder';
import { buildHat, disposeHat, type HatType } from '@/dev/face/hat-geometry';

/**
 * Hair style types for Bobblehead Ballers.
 * Each player gets a deterministic style based on their ID hash.
 */
type HairStyle = 'bald' | 'receding' | 'flat-top' | 'afro' | 'mohawk' | 'headband';

// =============================================================================
// PHASE B / D — Face-mode dev toggle
// -----------------------------------------------------------------------------
// `window.__faceMode` flips between the canonical photo-textured mesh and
// the procedural-feature overlay. Phase D flipped the default from 'both'
// to 'procedural' — the canonical photo-textured mesh hides at startup and
// only the procedurally-built eyelids/brows/nose/lips render. Devs can
// flip back from DevTools:
//
//   window.__faceMode = 'mesh'        // only canonical photo-textured mesh
//   window.__faceMode = 'procedural'  // only procedural features (default)
//   window.__faceMode = 'both'        // both (Phase B compare mode)
//
// Then re-mount a face (face dropdown change) to apply, or call
// `applyFaceMode(player)` directly on a known instance.
// =============================================================================

declare global {
  interface Window {
    __faceMode?: 'mesh' | 'procedural' | 'both';
    /** G3: DevTools toggle for the beer-hand left-arm lock. Mirrors
     *  `animConfig.poses.beerHold.enabled`. Set in DevTools to flip the
     *  lock off without rebuilding. */
    __beerHoldEnabled?: boolean;
  }
}

/** Apply the current `window.__faceMode` to a player's mounted faces. Safe
 *  to call before either side is mounted — missing pieces are skipped.
 *  Phase D: default flipped from 'both' to 'procedural' — the canonical
 *  mesh hides by default. */
function applyFaceMode(player: GamePlayer): void {
  const mode =
    typeof window !== 'undefined' ? (window.__faceMode ?? 'procedural') : 'procedural';
  const built = player.getFaceMesh3D();
  if (built) built.visible = mode !== 'procedural';
  if (player.faceProcedural) player.faceProcedural.setVisible(mode !== 'mesh');
  // G1 — in 'mesh' mode, hide the head-mesh-group's back/sides/ears so
  // the canonical front face renders alone (matching legacy mesh-only
  // mode). In 'procedural' or 'both', show the full head mesh.
  for (const extra of player.getHeadMeshExtras()) {
    extra.visible = mode !== 'mesh';
  }
}

/**
 * Phase F6 — read the inter-iris midpoint from a built face mesh's geometry.
 * `setFaceMesh3D` accepts a bare `THREE.Mesh` (not the full `BuiltFaceMesh`),
 * so we re-derive the iris midpoint from the position attribute on mount.
 *
 * The mesh-builder centers + height-fits the geometry, leaving irises at
 * whatever mesh-local position the user's face proportions imply (typically
 * a few cm above + slightly in front of origin). Callers position the
 * mount slot by `-irisMid` so the user's eyes land on the rig's eye anchor.
 *
 * Falls back to eye-outer-corners (33/263) when iris vertices are missing
 * or zero (very old saves; subset-landmark tests). Returns origin when
 * the geometry has no usable position attribute.
 */
function readIrisMidpointFromMesh(mesh: THREE.Mesh): { x: number; y: number; z: number } {
  const posAttr = mesh.geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined;
  if (!posAttr) return { x: 0, y: 0, z: 0 };
  const arr = posAttr.array as Float32Array;
  const LEFT_IRIS = 468;
  const RIGHT_IRIS = 473;
  const LEFT_EYE_OUTER = 33;
  const RIGHT_EYE_OUTER = 263;
  const isDegenerate = (idx: number): boolean => {
    const base = idx * 3;
    if (base + 2 >= arr.length) return true;
    const x = arr[base + 0];
    const y = arr[base + 1];
    const z = arr[base + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return true;
    if (x === 0 && y === 0 && z === 0) return true;
    return false;
  };
  const leftIdx = isDegenerate(LEFT_IRIS) ? LEFT_EYE_OUTER : LEFT_IRIS;
  const rightIdx = isDegenerate(RIGHT_IRIS) ? RIGHT_EYE_OUTER : RIGHT_IRIS;
  if (isDegenerate(leftIdx) || isDegenerate(rightIdx)) {
    return { x: 0, y: 0, z: 0 };
  }
  const lx = arr[leftIdx * 3 + 0];
  const ly = arr[leftIdx * 3 + 1];
  const lz = arr[leftIdx * 3 + 2];
  const rx = arr[rightIdx * 3 + 0];
  const ry = arr[rightIdx * 3 + 1];
  const rz = arr[rightIdx * 3 + 2];
  return { x: (lx + rx) * 0.5, y: (ly + ry) * 0.5, z: (lz + rz) * 0.5 };
}

/**
 * Weighted distribution — this is middle-aged-dad pickup-league, so
 * chrome-dome-and-horseshoe combined dominate. Ordered: pick a random
 * integer in [0, total), find the bucket whose cumulative weight contains it.
 */
const HAIR_STYLE_WEIGHTS: Array<{ style: HairStyle; weight: number }> = [
  { style: 'bald',     weight: 40 },
  { style: 'receding', weight: 25 },
  { style: 'flat-top', weight: 15 },
  { style: 'afro',     weight: 5  },
  { style: 'mohawk',   weight: 5  },
  { style: 'headband', weight: 10 },
];
const HAIR_STYLE_TOTAL_WEIGHT = HAIR_STYLE_WEIGHTS.reduce((a, b) => a + b.weight, 0);

function pickHairStyleFromHash(h: number): HairStyle {
  const pick = h % HAIR_STYLE_TOTAL_WEIGHT;
  let cumulative = 0;
  for (const entry of HAIR_STYLE_WEIGHTS) {
    cumulative += entry.weight;
    if (pick < cumulative) return entry.style;
  }
  return HAIR_STYLE_WEIGHTS[HAIR_STYLE_WEIGHTS.length - 1].style;
}

/**
 * Simple hash function to derive a deterministic number from a player ID.
 */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Pick a skin tone that varies slightly per player for visual diversity.
 */
function skinToneFromHash(h: number): number {
  const tones = [0xd4956a, 0xc68642, 0x8d5524, 0xf1c27d, 0xe0ac69, 0xa57045];
  return tones[h % tones.length];
}

/**
 * Pick a hair color that varies per player.
 */
function hairColorFromHash(h: number): number {
  // Middle-aged palette: browns + blacks mixed with grays, salt-and-pepper,
  // and full gray/white for the older guys. Gray variants weighted ~1/3.
  const colors = [
    0x2a1a0a, 0x1a1a1a, 0x4a3728, 0x0a0a0a, 0x3b2314, 0x5c3a1e, // darks
    0x6b5a4a, 0x8a7a6a,                                          // salt-and-pepper
    0xb8b0a8, 0xdad2c8, 0xe8e0d8,                                // gray to near-white
  ];
  return colors[h % colors.length];
}

// =============================================================================
// SHARED EYE GEOMETRIES & MATERIALS (Phase 8.4)
// -----------------------------------------------------------------------------
// All players on a court share the same eye geometry + non-iris materials at
// the GPU level. Cached at module scope so up to ~6 simultaneous players cost
// one upload per resource instead of N. Per-player variation lives only on
// the iris MeshBasicMaterial's `color` (each player gets its own iris
// material instance so we can `.color.setHex(...)` without affecting others).
//
// Sphere segment counts (12, 8) are deliberately low — these are tiny meshes
// rendered at face-of-bobblehead scale; higher tessellation just burns
// fragment shader work without visible improvement. Circle segments (20, 12)
// match the same "looks round at the rendered size" target.
// =============================================================================

let sharedScleraGeom: THREE.SphereGeometry | null = null;
let sharedIrisGeom: THREE.CircleGeometry | null = null;
let sharedPupilGeom: THREE.CircleGeometry | null = null;
let sharedScleraMat: THREE.MeshBasicMaterial | null = null;
let sharedPupilMat: THREE.MeshBasicMaterial | null = null;

/** Default fallback iris color (brown) used when no `eyeColors` is provided
 *  — old saves, AI-generated uploads where landmarks failed, or default
 *  players. Picked to read as a believable iris under the rig's lighting. */
const DEFAULT_IRIS_COLOR = 0x6b4a2a;

function getScleraGeom(radius: number): THREE.SphereGeometry {
  // The radius is fixed (cfg.head.eyeRadius) for every player at module
  // load — caching on first call is safe. If the config changes between
  // calls (it doesn't; player-config.ts is a frozen object), the cached
  // geometry would silently lock in the first radius — accepted tradeoff.
  if (!sharedScleraGeom) {
    sharedScleraGeom = new THREE.SphereGeometry(radius, 12, 8);
  }
  return sharedScleraGeom;
}

function getIrisGeom(radius: number): THREE.CircleGeometry {
  if (!sharedIrisGeom) {
    sharedIrisGeom = new THREE.CircleGeometry(radius, 20);
  }
  return sharedIrisGeom;
}

function getPupilGeom(radius: number): THREE.CircleGeometry {
  if (!sharedPupilGeom) {
    sharedPupilGeom = new THREE.CircleGeometry(radius, 12);
  }
  return sharedPupilGeom;
}

// =============================================================================
// G2 — older-fat-guy body shape (pecs / butt / love handles / shoulder slopes)
// -----------------------------------------------------------------------------
// One sphere geometry per body part is cached at module scope and shared
// across every player. The radius is read from playerConfig.body.* on first
// call and locked in for the lifetime of the process — same accepted-tradeoff
// pattern as `getScleraGeom`. If players edit the config sliders the cached
// geometry won't update; users have to reload to pick up new radii. Per-player
// variation lives only in the mesh's `scale` (hash-derived sag/size factors).
// =============================================================================
let sharedPecGeom: THREE.SphereGeometry | null = null;
let sharedButtGeom: THREE.SphereGeometry | null = null;
let sharedLoveHandleGeom: THREE.SphereGeometry | null = null;
let sharedShoulderSlopeGeom: THREE.SphereGeometry | null = null;

function getPecGeom(radius: number): THREE.SphereGeometry {
  if (!sharedPecGeom) sharedPecGeom = new THREE.SphereGeometry(radius, 10, 8);
  return sharedPecGeom;
}

function getButtGeom(radius: number): THREE.SphereGeometry {
  if (!sharedButtGeom) sharedButtGeom = new THREE.SphereGeometry(radius, 12, 10);
  return sharedButtGeom;
}

function getLoveHandleGeom(radius: number): THREE.SphereGeometry {
  if (!sharedLoveHandleGeom) sharedLoveHandleGeom = new THREE.SphereGeometry(radius, 10, 8);
  return sharedLoveHandleGeom;
}

function getShoulderSlopeGeom(radius: number): THREE.SphereGeometry {
  if (!sharedShoulderSlopeGeom) sharedShoulderSlopeGeom = new THREE.SphereGeometry(radius, 8, 6);
  return sharedShoulderSlopeGeom;
}

function getSharedScleraMat(): THREE.MeshBasicMaterial {
  if (!sharedScleraMat) {
    // Slightly cream off-white — pure 0xffffff reads as inhumanly bright
    // alongside the photographed face texture; 0xf5f0e8 picks up the
    // ambient warmth without looking yellow.
    sharedScleraMat = new THREE.MeshBasicMaterial({ color: 0xf5f0e8 });
  }
  return sharedScleraMat;
}

function getSharedPupilMat(): THREE.MeshBasicMaterial {
  if (!sharedPupilMat) {
    sharedPupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  }
  return sharedPupilMat;
}

/**
 * Lazily-built procedural alphaMap for the face plane. A 128×128 RGBA
 * texture with a smooth radial gradient — full alpha within the inner
 * 70% radius, smoothly fading to 0 at the corners. Multiplied with the
 * face image's color so the captured photo shows as a face-shaped patch
 * instead of a sharp rectangle with background bleeding in at the corners.
 * Generated once and reused across every player's face plane.
 */
let faceAlphaMapCache: THREE.DataTexture | null = null;
function getFaceAlphaMap(): THREE.DataTexture {
  if (faceAlphaMapCache) return faceAlphaMapCache;
  const SIZE = 128;
  const data = new Uint8Array(SIZE * SIZE * 4);
  // Radial fade: alpha=1 within r ≤ 0.42 of UV center, fades smoothly to
  // 0 at r=0.50. The 0.42 inner-radius keeps the eyes/mouth/nose region
  // fully opaque on a face-filled-frame capture; the soft falloff hides
  // background corners (chair/wall) without a hard circular cookie-cutter
  // edge that would also crop ear/jaw at extreme angles.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x + 0.5) / SIZE - 0.5;
      const dy = (y + 0.5) / SIZE - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      const t = Math.max(0, Math.min(1, (0.5 - r) / 0.08));
      // Smoothstep for nicer falloff than linear.
      const a = t * t * (3 - 2 * t);
      const idx = (y * SIZE + x) * 4;
      data[idx + 0] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.needsUpdate = true;
  faceAlphaMapCache = tex;
  return tex;
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Phase 7.7 — landmark-driven face-shaped alpha mask.
 *
 * Canonical MediaPipe FaceMesh indices for the lower-face silhouette, going
 * from the right ear-line under the chin and back up the left ear-line.
 * Verified against the 478-vertex tasks-vision model.
 */
const JAW_SILHOUETTE_INDICES: ReadonlyArray<number> = [
  127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152,
  377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356,
];

/**
 * Upper-face contour going right-temple → forehead apex → left-temple.
 * MediaPipe doesn't provide a clean "upper-face" ring like it does for the
 * jaw, so we approximate using the eyebrow-tops + forehead apex. Combined
 * with the jaw silhouette (reversed, since this contour walks the opposite
 * direction) this closes a polygon that covers the whole face.
 */
const FOREHEAD_CONTOUR_INDICES: ReadonlyArray<number> = [
  10, 109, 67, 103, 54, 21, 162, 127,
];

/**
 * Eye-center landmark indices. The 478-landmark variant has irises at
 * 468-477 (5 per eye); the iris CENTER is the first vertex of each ring,
 * 468 (left) and 473 (right). Falls back to the eye outer-corner indices
 * (33, 263) if the iris vertices are missing or NaN — defensive against
 * older saves or partial detections, though in practice both modes always
 * return all 478 points.
 */
const LEFT_EYE_IRIS = 468;
const RIGHT_EYE_IRIS = 473;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;

/**
 * Build a per-face alpha mask from saved landmarks. The mask is drawn as a
 * single closed polygon: jaw silhouette (right ear → chin → left ear) ∪
 * reversed forehead contour (left temple → forehead → right temple), filled
 * white, then a small Gaussian blur for soft edges that hide the polygon's
 * straight-line approximation between landmark vertices.
 *
 * Coordinate handling: landmarks are in cropped-image [0,1] space (top-left
 * origin, y-down). The face plane's UVs use [0,1] with v=0 at the BOTTOM.
 * THREE.TextureLoader auto-flips PNG textures to match, and we draw the
 * mask in image-space (v-down) so the result lines up with the texture
 * after Three.js's flip — i.e. don't manually flip y here.
 *
 * Returns null if landmarks are malformed (insufficient data); caller falls
 * back to the shared radial-gradient mask.
 */
function buildLandmarkAlphaMask(faceLandmarks: number[]): THREE.CanvasTexture | null {
  if (!faceLandmarks || faceLandmarks.length < 956) return null;
  const SIZE = 256;
  // Prefer regular HTMLCanvasElement here — OffscreenCanvas avoids document
  // overhead but its 2D context is unavailable in some environments (Safari
  // pre-16.4) and CanvasTexture handles HTMLCanvas just fine.
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Clear to fully transparent. The polygon below paints the kept region.
  ctx.clearRect(0, 0, SIZE, SIZE);

  // Build the mask polygon: jaw silhouette + reversed forehead contour.
  const path = (indices: ReadonlyArray<number>, reversed: boolean) => {
    const range = reversed
      ? [...indices].reverse()
      : indices;
    for (let i = 0; i < range.length; i++) {
      const idx = range[i];
      const x = faceLandmarks[idx * 2] * SIZE;
      const y = faceLandmarks[idx * 2 + 1] * SIZE;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  // Soft edges: filter='blur(...)' applies to subsequent draws. Using a
  // moderate blur (4px) hides the straight-line segments between landmarks
  // and gives the mask a natural feathered edge. Browsers without
  // ctx.filter support fall through silently — the hard-edged polygon is
  // still passable if not great.
  ctx.filter = 'blur(4px)';
  ctx.fillStyle = 'white';
  ctx.beginPath();
  path(JAW_SILHOUETTE_INDICES, false);
  path(FOREHEAD_CONTOUR_INDICES, true);
  ctx.closePath();
  ctx.fill();
  ctx.filter = 'none';

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Read a landmark's normalized (0..1) x,y from the flat array, with iris
 * → outer-corner fallback. Returns null if both candidates are missing/NaN.
 */
function readLandmarkXY(
  faceLandmarks: number[],
  primaryIdx: number,
  fallbackIdx: number,
): { x: number; y: number } | null {
  const p = primaryIdx * 2;
  const px = faceLandmarks[p];
  const py = faceLandmarks[p + 1];
  if (Number.isFinite(px) && Number.isFinite(py)) {
    return { x: px, y: py };
  }
  const f = fallbackIdx * 2;
  const fx = faceLandmarks[f];
  const fy = faceLandmarks[f + 1];
  if (Number.isFinite(fx) && Number.isFinite(fy)) {
    return { x: fx, y: fy };
  }
  return null;
}

/**
 * Phase 8.4 — build an eye container with both the legacy simple-sphere
 * (visible by default; matches the rest of the cartoon rig when no face
 * image is applied) and the stylized-realistic structure (sclera + iris
 * + pupil; toggled visible by `setFaceMesh3D` when a 3D face is mounted).
 *
 * The container is a THREE.Group so `setFaceMesh3D` can flip visibility
 * per child without a full rig rebuild. Each eye contributes 4 meshes (1
 * simple + 1 sclera + 1 iris + 1 pupil), but only 1 simple OR 3 realistic
 * are visible at any given time — Three.js skips invisible meshes during
 * draw, so the effective draw cost is the same 1 mesh per eye as before.
 *
 * The iris material is per-instance (cloned via `new THREE.MeshBasicMaterial`)
 * so `setFaceMesh3D` can recolor each player without affecting siblings.
 * Sclera + pupil materials are shared at the module level.
 */
function buildEye(side: 'left' | 'right', eyeRadius: number): THREE.Group {
  const group = new THREE.Group();
  group.name = `eye-${side}`;
  // Position is set by the caller (createMesh) — leaving the group at the
  // origin lets all child meshes use simple local offsets.

  // (1) Simple black sphere — visible by default. Matches the prior cartoon
  //     look for default players + the flat-image face path. Uses a fresh
  //     MeshStandardMaterial (lit) like the previous implementation; sharing
  //     the sclera *geometry* is fine, the material is tiny.
  const simple = new THREE.Mesh(
    getScleraGeom(eyeRadius),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a }),
  );
  simple.name = `eye-${side}-simple`;
  group.add(simple);

  // (2) Realistic structure — initially hidden; setFaceMesh3D toggles.
  const realistic = new THREE.Group();
  realistic.name = `eye-${side}-realistic`;
  realistic.visible = false;

  const sclera = new THREE.Mesh(getScleraGeom(eyeRadius), getSharedScleraMat());
  sclera.name = `eye-${side}-sclera`;
  realistic.add(sclera);

  // Iris disc — placed on the front of the sclera, just outside the sphere
  // surface so there's no z-fighting. ~60% of the eye-radius gives a
  // proportional iris that fills the visible eye opening without spilling
  // onto the sclera edges (which would clip when the eyelid blink-closes).
  const irisRadius = eyeRadius * 0.6;
  const iris = new THREE.Mesh(
    getIrisGeom(irisRadius),
    // PER-INSTANCE iris material — cloned per-player so setFaceMesh3D can
    // recolor without affecting other players sharing the rig.
    new THREE.MeshBasicMaterial({ color: DEFAULT_IRIS_COLOR }),
  );
  iris.position.z = eyeRadius * 0.95; // just outside the sphere's front pole
  iris.name = `eye-${side}-iris`;
  realistic.add(iris);

  // Pupil — small black dot at iris center. Tiny z-bias above the iris
  // to prevent z-fighting between the two coplanar discs.
  const pupilRadius = irisRadius * 0.45;
  const pupil = new THREE.Mesh(getPupilGeom(pupilRadius), getSharedPupilMat());
  pupil.position.z = iris.position.z + 0.0005;
  pupil.name = `eye-${side}-pupil`;
  realistic.add(pupil);

  group.add(realistic);
  return group;
}

export class GamePlayer {
  static courtBoundsZ: [number, number] = [-6.5, 6.5]; // default half court

  group: THREE.Group;
  data: PlayerData;
  hasBall = false;
  aiTarget: THREE.Vector3 | null = null;
  // Low-pass-filtered version of the current aiTarget, used by AI movement to
  // damp input-jitter feedback (human stick wiggle -> ball pos wiggle -> zone
  // defense target wiggle -> visible AI jitter). Populated from game-session
  // just before each moveToward() call on AI players.
  smoothedAiTarget: THREE.Vector3 | null = null;
  isHumanControlled = false;
  aiMovementState: 'holding' | 'moving' | 'reacting' = 'holding';
  aiHoldTimer = 0; // seconds remaining in hold state

  private stats = { points: 0, assists: 0, turnovers: 0 };
  private moveSpeed: number;
  animTime = 0;
  private lastMoving = false;
  velocity = new THREE.Vector3();
  private prevPosition = new THREE.Vector3();
  private animState: 'idle' | 'walk' | 'sprint' | 'dribble' | 'dribble-sprint' | 'guard' | 'steal' | 'shoot' | 'jump' | 'jump-block' | 'fall' | 'dunk' | 'pass' = 'idle';
  private prevAnimState: string = 'idle';
  private hairRestY: number | undefined;
  private stateTransitionTimer = 0;
  private readonly STATE_BLEND_DURATION = 0.12;
  private lastShoulderL = 0;
  private lastShoulderR = 0;
  private stealTimer = 0;
  private shootTimer = 0;
  private jumpTimer = 0;
  private jumpHeight = 0;
  isJumping = false;
  isSprinting = false;
  isCharging = false;
  chargeTimer = 0;
  stamina = 1.0;
  isExhausted = false;
  isGuarding = false;
  isBlocking = false;
  guardTimer = 0;
  private fallTimer = 0;
  dunkTimer = 0;
  dunkTarget: { x: number; z: number } | null = null;
  private passTimer = 0;
  dribblePhase = 0; // 0-1, exposed for ball sync
  // Sticky flag for forward-vs-backward walk animation. Hysteretic to avoid
  // per-frame flicker when facing direction and move direction are nearly
  // perpendicular. Updated in animate() before the walk anim branch reads it.
  isMovingBackwards = false;

  /**
   * 0 = normal dad, 1 = fully transformed college-athlete mutant.
   * Game-session sets this per-frame based on match.isMutant + elapsed
   * time since the buff activated. Player.applyMutantTransform() consumes
   * it and scales the mesh. Mutation scale layers on top of POSITION_SCALES
   * — we capture the base scale in the constructor so we can compose.
   */
  mutantFactor = 0;
  private baseScale = new THREE.Vector3(1, 1, 1);

  /** Cached THREE.Texture for the currently-applied face image. Lives on
   *  the instance so swapping faces can dispose the prior texture and
   *  prevent GPU memory leaks. Null when default eye-spheres are showing. */
  private faceTexture: THREE.Texture | null = null;

  /** Phase 7.7: per-face landmark-driven alpha mask. When non-null, the
   *  current face was applied with `faceLandmarks` and the material's
   *  `alphaMap` points at this CanvasTexture. Disposed on every swap (and
   *  on `setFaceImage(null)`) to avoid GPU leaks. The shared radial-fade
   *  alpha-map cache (`getFaceAlphaMap()`) is used as the fallback when
   *  this is null. */
  private faceAlphaMask: THREE.CanvasTexture | null = null;

  /** Cached resources for the currently-applied 3D face mesh (if any).
   *  Tracked separately from `faceTexture` so the two paths (flat image
   *  vs. 3D mesh) can be cleanly toggled — applying one always clears
   *  the other. Null when no 3D mesh is mounted. */
  private faceMesh3D: THREE.Mesh | null = null;
  private faceMesh3DTexture: THREE.Texture | null = null;
  /** Phase 8.2b: dark "mouth interior" plane mounted as a sibling of the
   *  face mesh. Shows through the inner-mouth hole left by
   *  `getInnerMouthTrianglesFiltered` when the lips part. Owned alongside
   *  the face mesh — disposed on the same swap/clear path. */
  private faceMouthInterior: THREE.Mesh | null = null;
  /** Phase 7.8: per-face head proportions (W/H, D/H ratios) inferred at
   *  scan time. When non-null, the head sphere's scale is overridden to
   *  approximate the user's actual head shape; the mesh-builder's
   *  eye-anatomy alignment puts the eyes on the rig anchor, but the
   *  spherical head silhouette behind the mesh otherwise stays default
   *  (1, 1, headDepthScale). Cleared (back to default sphere scale) on
   *  setFaceMesh3D(null). */
  private faceMesh3DHeadShape: { aspectWH: number; aspectDH: number } | null = null;
  /** Phase 8.4: per-face iris colors (packed 0xRRGGBB) sampled from the
   *  front-pose photo at scan time. Cached so player-rebuild paths can
   *  re-apply the same colors without an IDB round trip. Null when no
   *  3D face is mounted or the active face had no sampled colors. */
  private faceEyeColors: { left: number; right: number } | null = null;

  /** Phase B: procedural face features (eyelids, brows, nose, lips) mounted
   *  as a sibling of the canonical mesh in the `face-mesh-3d` slot. Built
   *  alongside the canonical mesh on every `setFaceProcedural(built)` call;
   *  disposed alongside it via `clearFaceMesh3DInternal()`.
   *
   *  Per-frame contract: callers MUST invoke `updateFaceProcedural()` after
   *  every `puppet.apply(frame)` so the procedural geometry tracks the
   *  deformed canonical landmarks. Otherwise the procedural face stays at
   *  rest while the canonical mesh visibly animates. */
  faceProcedural: ProceduralFace | null = null;

  /** Phase D: original head/body skin material captured at construction so
   *  setFaceMesh3D's body-skin recolor path can restore the rig's
   *  hash-derived skin tone when the face is cleared. Body skin parts
   *  (head sphere, neck, forearms, lower legs) all share the same
   *  MeshStandardMaterial instance — recoloring `.color` on this single
   *  material recolors all six meshes at once.
   *
   *  Note: body skin tone leaks across players if the same player rebuilds —
   *  handled by the per-player `setFaceMesh3D` re-application in
   *  `applyCachedFaceToPlayer` (existing pattern in anim-viewer / player-editor).
   *  Cached here so we have a stable reference to the material whose
   *  `.color` we mutate, not a clone. */
  private bodySkinMat: THREE.MeshStandardMaterial | null = null;
  /** Phase D: hash-derived skin color captured at construction. Used to
   *  restore the body skin material when the face is cleared. */
  private bodySkinDefaultColor: number = 0xc9a08a;

  /** Phase D: current procedural hat group (cap-forward / cap-backward /
   *  beanie). Mounted on neckGroup as a sibling of the hair sub-mesh. The
   *  hair sub-mesh is hidden while a hat is present and re-shown when
   *  cleared. Disposed via `setFaceHat(null)` and on every `setFaceMesh3D`
   *  swap path. */
  private faceHat: THREE.Group | null = null;
  /** Phase D: cached hash-derived hair pieces so the override path can
   *  revert to the rig's default hair when called with null. We store the
   *  default style + color rather than the geometry so a re-build is
   *  cheap and avoids leftover-material lifecycle pitfalls. */
  private defaultHairStyle: HairStyle = 'bald';
  private defaultHairColor: number = 0x000000;
  /** Phase D: cached features bundle from the most recent setFaceMesh3D
   *  call — used so applyCachedFaceToPlayer-style rebuild paths in
   *  anim-viewer / player-editor can pass the same features through to
   *  the new mesh without re-loading from IDB. */
  private faceFeaturesCache: ProceduralFaceFeatures | null = null;

  /** G1 — when a `BuiltHeadMesh` is mounted via setFaceMesh3D, the
   *  rig's default sphere head is hidden and this group (which contains
   *  the front face mesh + side panels + back hemisphere + ears) is
   *  mounted in the face-mesh-3d slot. Tracked here so clearFaceMesh3DInternal
   *  can re-show the head sphere and dispose the head extras' geometries
   *  + material on every swap. Null when no head mesh is mounted (older
   *  saves, or AI uploads without profile poses). */
  private faceHeadMeshGroup: THREE.Group | null = null;
  private faceHeadMeshExtras: THREE.Mesh[] = [];
  /** G1 — original eye-sphere positions captured at construction so
   *  setFaceMesh3D can reposition the eye spheres to match the head mesh's
   *  iris-midpoint and clearFaceMesh3DInternal can restore them. */
  private defaultEyeLeftPos: THREE.Vector3 | null = null;
  private defaultEyeRightPos: THREE.Vector3 | null = null;

  constructor(data: PlayerData, position: THREE.Vector3, teamColor: number) {
    this.data = data;
    this.moveSpeed = 2 + data.stats.speed * 0.35; // 2.35 to 5.5 m/s — deliberate, not frantic
    this.group = this.createMesh(teamColor);
    this.group.position.copy(position);
    this.prevPosition.copy(position);
    this.group.name = `player-${data.id}`;

    if (data.position) {
      const scales = POSITION_SCALES[data.position];
      this.group.scale.set(scales.body, scales.height, scales.body);
    }
    this.baseScale.copy(this.group.scale);
  }

  /**
   * Called each frame from game-session when this player is the mutant.
   * `factor` is a 0..1 progress value (the 0.5s transformation ramp + hold
   * at 1 while active + ramp back to 0 on expire). Applies the
   * "college-athlete self" look: bigger overall + proportional emphasis.
   */
  applyMutantTransform(factor: number): void {
    this.mutantFactor = factor;
    // Overall scale: 1.0 baseline → 1.6 peak, biased toward Y (taller) and X (wider)
    const mul = 1 + factor * 0.6;
    this.group.scale.set(
      this.baseScale.x * mul,
      this.baseScale.y * (1 + factor * 0.75), // extra height
      this.baseScale.z * mul,
    );
  }

  /**
   * Apply (or clear) a captured face image as a texture on the head's
   * face-plane. When a face is set the eye-spheres are hidden and the
   * face-plane becomes visible; when cleared, the eye-spheres come back.
   *
   * Only called on Face-picker change in player-editor / anim-viewer (and
   * once at construction time if the host page wants to seed it). NOT
   * called per-frame — that would thrash the GPU upload queue.
   *
   * Phase 7.7: when `faceLandmarks` is provided (cropped-image-local 0..1
   * coords, length 956), we build a face-shaped alpha mask from the
   * MediaPipe jaw silhouette + forehead contour and translate/scale the
   * face plane so the image's eye-midpoint lands on the rig's eye anatomy.
   * When omitted (old saves, AI-generated uploads with no detected face)
   * we fall back to the original radial-fade + centered-plane behavior.
   *
   * @param dataUrl PNG/JPG data URL from the face library (or null to clear).
   * @param faceLandmarks Optional 478*2 flat array of landmark x,y in
   *                      cropped-image [0,1] coords. See `FaceImage.faceLandmarks`.
   */
  setFaceImage(dataUrl: string | null, faceLandmarks?: number[]): void {
    const facePlane = this.group.getObjectByName('face-plane') as
      | THREE.Mesh
      | undefined;
    // Phase 8.4: eye-left / eye-right are now Groups (simple-sphere child +
    // realistic child). The flat-image path doesn't touch the iris colors
    // — it just makes the whole eye Group visible (which leaves the
    // realistic-child still hidden via its own .visible = false from
    // construction or the prior setFaceMesh3D clear path).
    const eyeLeft = this.group.getObjectByName('eye-left') as THREE.Group | undefined;
    const eyeRight = this.group.getObjectByName('eye-right') as THREE.Group | undefined;
    if (!facePlane) return;
    const mat = facePlane.material as THREE.MeshBasicMaterial;
    const cfg = playerConfig;

    // Setting a flat face image is mutually exclusive with the 3D mesh —
    // clear any active mesh so we don't double-render. Phase 7.6.
    this.clearFaceMesh3DInternal();

    // Always dispose the previous texture before replacing — otherwise we
    // leak GPU memory on every face swap.
    if (this.faceTexture) {
      this.faceTexture.dispose();
      this.faceTexture = null;
      mat.map = null;
    }
    // Same dance for the per-face alpha mask. We dispose unconditionally
    // here; if the next branch wants one it builds a fresh CanvasTexture.
    if (this.faceAlphaMask) {
      this.faceAlphaMask.dispose();
      this.faceAlphaMask = null;
    }

    if (!dataUrl) {
      facePlane.visible = false;
      // Restore default plane transform on clear (in case the previous
      // face shifted it via landmarks). The shared radial alpha-map is
      // re-attached so subsequent face applies that lack landmarks fall
      // through to the legacy path with a valid mask.
      facePlane.position.set(0, cfg.head.eyeOffsetY, cfg.head.facePlaneZ);
      facePlane.scale.set(1, 1, 1);
      mat.alphaMap = getFaceAlphaMap();
      mat.needsUpdate = true;
      if (eyeLeft) eyeLeft.visible = true;
      if (eyeRight) eyeRight.visible = true;
      const head = this.group.getObjectByName('head') as THREE.Mesh | undefined;
      if (head) head.visible = true;
      return;
    }

    // Phase 7.7 branch: when we have landmarks, build a face-shaped alpha
    // mask + transform the plane to align eyes with the rig's eye anatomy.
    // The alpha mask is built BEFORE the texture finishes loading, so the
    // first rendered frame already has correct silhouette + transform —
    // no flash of square photo while the PNG bytes decode.
    let landmarkMask: THREE.CanvasTexture | null = null;
    if (faceLandmarks && faceLandmarks.length === 956) {
      landmarkMask = buildLandmarkAlphaMask(faceLandmarks);
    }
    if (landmarkMask) {
      this.faceAlphaMask = landmarkMask;
      mat.alphaMap = landmarkMask;
      this.applyLandmarkPlaneTransform(facePlane, faceLandmarks!);
    } else {
      // Fallback path — radial fade + centered plane.
      mat.alphaMap = getFaceAlphaMap();
      facePlane.position.set(0, cfg.head.eyeOffsetY, cfg.head.facePlaneZ);
      facePlane.scale.set(1, 1, 1);
    }

    const loader = new THREE.TextureLoader();
    const tex = loader.load(dataUrl, () => {
      // Texture finished loading — kick the material so the next render
      // picks it up. The plane is already visible at this point so the
      // user sees the swap as soon as the bytes arrive (data URLs decode
      // synchronously enough that this is effectively immediate).
      mat.needsUpdate = true;
    });
    // Color management: the captured PNG was rendered in sRGB by the
    // canvas that produced it; matching colorSpace keeps skin tones from
    // looking washed out under the standard lighting.
    tex.colorSpace = THREE.SRGBColorSpace;
    this.faceTexture = tex;
    mat.map = tex;
    mat.transparent = true;
    mat.needsUpdate = true;

    facePlane.visible = true;
    if (eyeLeft) eyeLeft.visible = false;
    if (eyeRight) eyeRight.visible = false;
    // Hide the head sphere too — the face plane is the head's front from now
    // on. Without this, the sphere pokes out around the plane edges (head
    // diameter 0.56 vs default plane 0.5) and reads as "big round head with
    // a small face on it". Hair stays — anchored to neck-group, not head.
    const head = this.group.getObjectByName('head') as THREE.Mesh | undefined;
    if (head) head.visible = false;
  }

  /**
   * Phase 7.7 — translate + scale the face plane so the photo's eye-midpoint
   * lands at the rig's eye anatomy `(0, eyeOffsetY, facePlaneZ)` in
   * neck-group local space, and the photo's eye distance matches the rig's
   * `2 × eyeOffsetX`.
   *
   * Inputs are in cropped-image [0,1] (top-left origin, y-down):
   *   - left iris (468) → (lx, ly), right iris (473) → (rx, ry)
   *   - image-space midpoint: (emx, emy) = ((lx+rx)/2, (ly+ry)/2)
   *   - image-space eye distance: eyeDistImg = hypot(rx-lx, ry-ly)
   *
   * Coordinate-system bridge (image → plane-local):
   *   - The PlaneGeometry has UV (0,0) at its (-size/2, -size/2) corner.
   *   - THREE.TextureLoader sets `flipY = true` by default, so texture
   *     UV (0,0) corresponds to the BOTTOM row of the source image.
   *     image y_img → texture v = 1 - y_img/H.
   *   - UV (u,v) → plane local ((u-0.5)*size, (v-0.5)*size).
   *   - Therefore image (emx, emy) → plane local
   *       midLocalX = (emx - 0.5) * planeSize    (x same direction)
   *       midLocalY = (0.5 - emy) * planeSize    (y FLIPPED — image y-down → plane y-up)
   *
   * Scale: rig eye-distance is 2*eyeOffsetX. After scaling the plane by `s`
   * the photo's on-rig eye-distance becomes eyeDistImg * planeSize * s.
   * Solve for s: s = (2*eyeOffsetX) / (eyeDistImg * planeSize).
   *
   * Translation: after scaling, the eye-midpoint sits at
   *   (s * midLocalX, s * midLocalY) in plane parent-local coords.
   * To pin it to the rig's eye anchor (0, eyeOffsetY), translate the plane
   * to (-s * midLocalX, eyeOffsetY - s * midLocalY).
   *
   * Sanity clamps: scale clamped to [0.5, 2.5]. Outside that range the
   * input is suspect (face fills <20% or >100% of the crop) — clamp +
   * console.warn rather than producing absurd geometry.
   */
  private applyLandmarkPlaneTransform(
    facePlane: THREE.Mesh,
    faceLandmarks: number[],
  ): void {
    const cfg = playerConfig;
    const left = readLandmarkXY(faceLandmarks, LEFT_EYE_IRIS, LEFT_EYE_OUTER);
    const right = readLandmarkXY(faceLandmarks, RIGHT_EYE_IRIS, RIGHT_EYE_OUTER);
    if (!left || !right) {
      // Can't compute anatomy alignment — leave the plane at defaults.
      facePlane.position.set(0, cfg.head.eyeOffsetY, cfg.head.facePlaneZ);
      facePlane.scale.set(1, 1, 1);
      return;
    }

    const emx = (left.x + right.x) * 0.5;
    const emy = (left.y + right.y) * 0.5;
    const eyeDistImg = Math.hypot(right.x - left.x, right.y - left.y);
    if (!(eyeDistImg > 0)) {
      facePlane.position.set(0, cfg.head.eyeOffsetY, cfg.head.facePlaneZ);
      facePlane.scale.set(1, 1, 1);
      return;
    }

    const planeSize = cfg.head.facePlaneSize;
    const rigEyeDist = 2 * cfg.head.eyeOffsetX;

    // Scale: how much we have to grow the plane so its on-photo eye distance
    // matches the rig's eye spacing. After scaling, the photo's eye-distance
    // in world units = eyeDistImg * planeSize * scale.
    let scale = rigEyeDist / (eyeDistImg * planeSize);
    if (!Number.isFinite(scale)) scale = 1;
    if (scale < 0.5 || scale > 2.5) {
      console.warn(
        `[face] computed face-plane scale ${scale.toFixed(3)} out of [0.5, 2.5] — clamping. ` +
          `eyeDistImg=${eyeDistImg.toFixed(3)}, planeSize=${planeSize}, rigEyeDist=${rigEyeDist}`,
      );
      scale = Math.max(0.5, Math.min(2.5, scale));
    }

    // Plane-local eye-midpoint position (origin at plane center, y-up). The
    // photo y is top-down, so flip with (0.5 - emy). The photo x lines up
    // with plane +x as drawn (TextureLoader's default flipY=true means UV v
    // is bottom-up; UV u is left-to-right same as image x).
    const midLocalX = (emx - 0.5) * planeSize;
    const midLocalY = (0.5 - emy) * planeSize;

    // After scaling, the local offset becomes scale * midLocalX/Y in
    // neck-group coords. To put midLocal at (0, eyeOffsetY), translate the
    // plane center to (-scale*midLocalX, eyeOffsetY - scale*midLocalY).
    const planeX = -scale * midLocalX;
    const planeY = cfg.head.eyeOffsetY - scale * midLocalY;
    facePlane.position.set(planeX, planeY, cfg.head.facePlaneZ);
    facePlane.scale.set(scale, scale, 1);
  }

  /**
   * Apply (or clear) a captured 3D face mesh. When a mesh is set the
   * eye-spheres AND the flat face-plane are hidden, and the supplied mesh
   * is mounted as the only child of the `face-mesh-3d` slot inside
   * `neckGroup`. When cleared, the eye-spheres come back (matching
   * `setFaceImage(null)`'s behavior).
   *
   * Mutual exclusion: applying a 3D mesh clears any flat face image, and
   * vice versa. Caller passes ownership of the mesh — disposal of the
   * mesh's geometry/material/texture happens here on next swap or clear.
   *
   * Only called on Face-picker change in player-editor / anim-viewer (and
   * once at construction time if the host page wants to seed it). NOT
   * called per-frame.
   *
   * Phase 7.8: `headShape` (optional) carries face proportions inferred
   * from the front-pose landmarks at scan time (`aspectWH` = width/height,
   * `aspectDH` = depth/height). When provided, the head sphere is rescaled
   * to approximate the user's actual head shape so the silhouette behind /
   * around the mesh (visible from non-front angles) reads as the right
   * person. The head sphere stays VISIBLE (in contrast to Phase 7.6 which
   * hid it) so the player's head has substance from any angle.
   */
  setFaceMesh3D(
    mesh: THREE.Mesh | null,
    headShape?: { aspectWH: number; aspectDH: number },
    mouthInteriorOrEyeColors?: THREE.Mesh | null | { left: number; right: number },
    maybeEyeColors?: { left: number; right: number },
    features?: ProceduralFaceFeatures,
    headMeshBuilt?: BuiltHeadMesh | null,
  ): void {
    // Phase 8.4 — back-compat shim: the prior 3-arg signature was
    // `(mesh, headShape, mouthInterior)`. The new 4-arg shape is
    // `(mesh, headShape, mouthInterior, eyeColors)`. Existing call sites
    // (anim-viewer, player-editor) pass `mouthInterior` in slot 3 and
    // — after this PR — `eyeColors` in slot 4. To keep the signature
    // simple we detect which form was passed: if slot-3 is a plain object
    // with numeric `left`/`right` it's the eyeColors form; otherwise it's
    // mouthInterior (THREE.Mesh, null, or undefined).
    //
    // Phase D adds `features` as the 5th positional arg — sampled values
    // for the procedural face's skin/lip/brow/eye/nose, plus optional
    // `hair` / `hat` / `bodySkinTone` extensions consumed inside this
    // method. Old callers pass `undefined` and procedural features fall
    // back to defaults.
    let mouthInterior: THREE.Mesh | null = null;
    let eyeColors: { left: number; right: number } | undefined;
    if (
      mouthInteriorOrEyeColors &&
      typeof mouthInteriorOrEyeColors === 'object' &&
      !(mouthInteriorOrEyeColors as THREE.Object3D).isObject3D &&
      typeof (mouthInteriorOrEyeColors as { left?: unknown }).left === 'number'
    ) {
      eyeColors = mouthInteriorOrEyeColors as { left: number; right: number };
    } else {
      mouthInterior = (mouthInteriorOrEyeColors as THREE.Mesh | null | undefined) ?? null;
      eyeColors = maybeEyeColors;
    }

    const slot = this.group.getObjectByName('face-mesh-3d') as
      | THREE.Group
      | undefined;
    if (!slot) return;
    const facePlane = this.group.getObjectByName('face-plane') as
      | THREE.Mesh
      | undefined;
    const eyeLeft = this.group.getObjectByName('eye-left') as THREE.Group | undefined;
    const eyeRight = this.group.getObjectByName('eye-right') as THREE.Group | undefined;
    const cfg = playerConfig;
    const head = this.group.getObjectByName('head') as THREE.Mesh | undefined;

    // Dispose the prior mesh, if any.
    this.clearFaceMesh3DInternal();

    if (!mesh) {
      // Restore default appearance (simple-sphere eyes + invisible face-plane).
      // Phase 8.4 — also revert the realistic eye structure: hide the
      // sclera/iris/pupil group, show the simple sphere. The iris material's
      // color stays as it was (the next setFaceMesh3D apply will re-set it),
      // which is fine because the realistic Group is hidden anyway.
      // Note: head sphere visibility is no longer toggled (Phase 7.8 — it
      // stays visible so non-front angles read correctly), but its scale
      // must reset to the default `(1, 1, headDepthScale)` in case a prior
      // face provided a `headShape` override.
      this.toggleEyeRealistic(false);
      if (eyeLeft) eyeLeft.visible = true;
      if (eyeRight) eyeRight.visible = true;
      if (facePlane) facePlane.visible = false;
      if (head) {
        head.scale.set(1, 1, cfg.head.headDepthScale);
        // G1 — re-show the head sphere if the prior face mounted a head
        // mesh (which had hidden the sphere).
        head.visible = true;
      }
      // G1 — restore default eye-sphere positions in case the prior face
      // had repositioned them to align with its iris-midpoint.
      if (eyeLeft && this.defaultEyeLeftPos) eyeLeft.position.copy(this.defaultEyeLeftPos);
      if (eyeRight && this.defaultEyeRightPos) eyeRight.position.copy(this.defaultEyeRightPos);
      // Phase F6 — restore the slot's default position so a subsequent
      // mount that DOESN'T re-set it (e.g. from a different code path)
      // doesn't inherit the prior face's iris-aligned offset.
      slot.position.set(0, cfg.head.eyeOffsetY, cfg.head.eyeOffsetZ);
      this.faceMesh3DHeadShape = null;
      this.faceEyeColors = null;
      // Phase D: clear any sampled-feature side effects on the body /
      // accessories. Resets body skin material to the rig's hash-derived
      // color, drops any hat, and reverts any hair-style override.
      this.restoreBodySkinMaterial();
      this.setFaceHat(null);
      this.setFaceHairOverride(null, null);
      this.faceFeaturesCache = null;
      return;
    }

    // Clear any flat face image still cached so we don't render two
    // overlapping faces. Disposes the previous flat texture and the
    // Phase 7.7 per-face alpha mask if one was active.
    if (this.faceTexture) {
      this.faceTexture.dispose();
      this.faceTexture = null;
      if (facePlane) {
        const mat = facePlane.material as THREE.MeshBasicMaterial;
        mat.map = null;
        mat.needsUpdate = true;
      }
    }
    if (this.faceAlphaMask) {
      this.faceAlphaMask.dispose();
      this.faceAlphaMask = null;
      if (facePlane) {
        const mat = facePlane.material as THREE.MeshBasicMaterial;
        mat.alphaMap = getFaceAlphaMap();
        mat.needsUpdate = true;
      }
    }

    // Track the mesh for disposal on the next swap. Texture is discovered
    // from the material so the caller doesn't have to pass it separately.
    this.faceMesh3D = mesh;
    const matMesh = mesh.material as THREE.MeshBasicMaterial;
    this.faceMesh3DTexture = matMesh.map ?? null;

    // Phase F6 — position the slot so the mesh's iris-midpoint lands on the
    // rig's eye-anatomy anchor `(0, eyeOffsetY, eyeOffsetZ)`. The mesh is
    // height-fit (forehead-to-chin = HEAD_FACE_AREA) so its irises are no
    // longer guaranteed to be at mesh-local origin — typical post-fit iris
    // midpoint is ~(0, +0.07, +0.03) (eyes sit slightly above + in front of
    // the bbox center because there's more forehead/cranium above the eyes
    // than chin below). We offset the slot by `-irisMidpoint` so eyes land
    // on the rig anchor; the rest of the face (lips, nose, brows, jaw) hangs
    // below/around naturally and fits inside the head sphere.
    //
    // The eye-spheres remain at fixed `(±eyeOffsetX, eyeOffsetY, eyeOffsetZ)`.
    // For users whose face proportions differ from rig spec, the procedural
    // mesh's eye openings may sit a few mm off the eye-spheres — acceptable
    // for v1; the alternative (forcing every face to rig spec) made the
    // entire face fail to fit the head.
    const irisMid = readIrisMidpointFromMesh(mesh);
    slot.position.set(
      0 - irisMid.x,
      cfg.head.eyeOffsetY - irisMid.y,
      cfg.head.eyeOffsetZ - irisMid.z,
    );

    // G1 — when a `BuiltHeadMesh` is provided AND its head-mesh build
    // succeeded, mount the WHOLE head group (which includes the front
    // face mesh + side panels + back hemisphere + ears) into the slot
    // and HIDE the rig's default head sphere. The head group's children
    // are already in mesh-local coords; the slot's iris-aligned offset
    // handles world placement. Otherwise (no head mesh, or
    // headMeshSuccess=false), mount the front face mesh directly and
    // leave the head sphere visible (legacy behavior).
    const useHeadMesh =
      !!headMeshBuilt && headMeshBuilt.headMeshSuccess && !!headMeshBuilt.headMesh;
    if (useHeadMesh) {
      // The head group already contains `mesh` (the front face) and may
      // contain `mouthInterior` if buildHeadMesh added it. Mount the
      // group as the sole slot child.
      this.faceHeadMeshGroup = headMeshBuilt!.headMesh;
      this.faceHeadMeshExtras = headMeshBuilt!.headExtras ?? [];
      slot.add(headMeshBuilt!.headMesh);
      // The mouth interior was added to the head group in buildHeadMesh
      // — track it so disposal still flows through faceMouthInterior.
      if (mouthInterior) {
        this.faceMouthInterior = mouthInterior;
      }
      if (head) head.visible = false;
    } else {
      slot.add(mesh);
      // Phase 8.2b: mount the dark mouth-interior plane (if provided) as a
      // SIBLING of the face mesh inside the same slot. Its position is in
      // mesh-local coords (set by buildFaceMesh) — the slot's own transform
      // handles world placement. Disposed alongside the face mesh.
      if (mouthInterior) {
        this.faceMouthInterior = mouthInterior;
        slot.add(mouthInterior);
      }
    }
    // Phase 8.3: keep the eye structures VISIBLE behind the mesh. The
    // canonical FaceMesh tessellation doesn't include the iris (468–477) in
    // its edge graph, so the 3-cycle topology builder produces no triangles
    // for the iris area — the mesh has natural eye-shaped HOLES at the
    // eyelid rings. Without something behind, the user sees through the
    // head into the scene (the "cutout, no eyes" bug).
    //
    // Phase 8.4: swap from the simple black sphere to the stylized-realistic
    // sclera/iris/pupil structure when a 3D face is applied. The simple
    // sphere reads as freaky black blobs through the photo-textured eye
    // openings; the realistic structure reads as actual eyes with the
    // sampled iris color. Both share the eye Group's position so they land
    // exactly under the mesh's eye holes.
    this.toggleEyeRealistic(true);
    if (eyeColors) {
      this.applyEyeColors(eyeColors);
      this.faceEyeColors = { left: eyeColors.left, right: eyeColors.right };
    } else {
      // Reset to default brown so the previous face's iris color doesn't
      // leak into a new face that has no `eyeColors` (older save, AI
      // upload, face-mirror's 3-arg call). Without this, swapping from a
      // green-eyed face to a no-color face would show green irises on a
      // person who isn't green-eyed — a subtle visual leak.
      this.applyEyeColors({ left: DEFAULT_IRIS_COLOR, right: DEFAULT_IRIS_COLOR });
      this.faceEyeColors = null;
    }
    if (eyeLeft) eyeLeft.visible = true;
    if (eyeRight) eyeRight.visible = true;
    if (facePlane) facePlane.visible = false;
    // Phase 7.8: keep the head sphere VISIBLE behind the mesh (legacy
    // path). The mesh covers the front/3-quarter silhouette by being
    // slightly larger; the sphere fills the back/side silhouette so the
    // head reads as solid from any angle. Per-face `headShape` (if
    // provided) scales the sphere's W/H/D ratios to approximate the
    // user's actual head.
    //
    // G1: when `useHeadMesh` is true, the head sphere is HIDDEN (the
    // head-mesh-group provides the back/side silhouette as real
    // geometry instead). We skip the scale logic in that branch since
    // the sphere is invisible anyway, and rely on
    // clearFaceMesh3DInternal to restore visibility on the next clear.
    if (head) {
      this.faceMesh3DHeadShape = headShape ?? null;
      if (useHeadMesh) {
        // Hidden — leave scale alone (set to defaults by clear-path).
        head.visible = false;
        head.scale.set(1, 1, cfg.head.headDepthScale);
      } else if (headShape) {
        // x,y,z = aspectWH, 1, aspectDH × headDepthScale. The depth-scale
        // multiplier preserves the existing front-back squash slider so a
        // user who tuned `headDepthScale` to taste keeps that on top of
        // the per-face depth ratio.
        head.scale.set(
          headShape.aspectWH,
          1,
          headShape.aspectDH * cfg.head.headDepthScale,
        );
      } else {
        // No per-face shape — restore the rig default. (1, 1, headDepthScale).
        head.scale.set(1, 1, cfg.head.headDepthScale);
      }
    }

    // G1 — when a head mesh is mounted, reposition the eye spheres so
    // their X aligns with the user's actual iris-X distance (read from
    // the face-mesh's iris vertices, post-fit). This kills the
    // iris-X-mismatch where stock-rig eye-spheres sat at fixed
    // ±eyeOffsetX while the user's actual irises landed at slightly
    // different X positions. The slot's own offset handles Y/Z; only X
    // varies per-face.
    if (useHeadMesh && eyeLeft && eyeRight) {
      // Read both iris vertex X positions (post-fit, mesh-local).
      const posAttr = mesh.geometry.getAttribute('position') as
        | THREE.BufferAttribute
        | undefined;
      if (posAttr) {
        const arr = posAttr.array as Float32Array;
        const LEFT_IRIS_VERT = 468;
        const RIGHT_IRIS_VERT = 473;
        const lx = arr[LEFT_IRIS_VERT * 3 + 0];
        const rx = arr[RIGHT_IRIS_VERT * 3 + 0];
        if (Number.isFinite(lx) && Number.isFinite(rx) && Math.abs(rx - lx) > 0.01) {
          // Slot's transform: x_world = x_local - irisMid.x + 0
          // So an iris at mesh-local lx ends up at world x = lx - irisMid.x.
          // We want the eye-sphere's parent (neckGroup) X to match.
          // The eye-spheres are children of neckGroup (same parent as
          // the slot), so eye.position.x = lx - irisMid.x lines them up.
          eyeLeft.position.x = lx - irisMid.x;
          eyeRight.position.x = rx - irisMid.x;
          // Y/Z: we want eyes at irisMidpoint.y/z in neckGroup space.
          // Slot is at (cfg.head.eyeOffsetY - irisMid.y, ...) and the
          // mesh's iris vertices land at mesh-local (lx, ly, lz). After
          // slot-translate they land at (lx - irisMid.x,
          // ly + cfg.head.eyeOffsetY - irisMid.y, lz + cfg.head.eyeOffsetZ - irisMid.z).
          // For the eye-midpoint (irisMid.y in mesh-local) that simplifies
          // to (0 mid-x, cfg.head.eyeOffsetY, cfg.head.eyeOffsetZ).
          // Per-eye Y/Z: the eyes track the user's iris Y/Z, not just
          // the midpoint, so use ly/lz directly.
          const ly = arr[LEFT_IRIS_VERT * 3 + 1];
          const lz = arr[LEFT_IRIS_VERT * 3 + 2];
          const ry = arr[RIGHT_IRIS_VERT * 3 + 1];
          const rz = arr[RIGHT_IRIS_VERT * 3 + 2];
          if (Number.isFinite(ly) && Number.isFinite(lz)) {
            eyeLeft.position.y = ly + (cfg.head.eyeOffsetY - irisMid.y);
            eyeLeft.position.z = lz + (cfg.head.eyeOffsetZ - irisMid.z);
          }
          if (Number.isFinite(ry) && Number.isFinite(rz)) {
            eyeRight.position.y = ry + (cfg.head.eyeOffsetY - irisMid.y);
            eyeRight.position.z = rz + (cfg.head.eyeOffsetZ - irisMid.z);
          }
        }
      }
    }

    // Phase D — apply sampled features beyond the canonical mesh's eye
    // colors / head shape. The procedural-face overlay (mounted by
    // setFaceProcedural after this returns) reads the same `features`
    // bundle from this cache so its eyelids/brows/lips/nose pick up the
    // sampled values when applyCachedFaceToPlayer rebuilds.
    this.faceFeaturesCache = features ?? null;
    // Recolor body skin (head sphere, neck, forearms, lower legs) so the
    // visible-behind-the-mesh silhouette matches the user's skin tone.
    // Falls back to the rig's hash-derived default when no skinTone arrived.
    const featuresExt = features as
      | (ProceduralFaceFeatures & {
          hair?: { style: HairStyle; color: number } | null;
          hat?: { type: HatType; color: number } | null;
          bodySkinTone?: number;
        })
      | undefined;
    const bodySkin = featuresExt?.bodySkinTone ?? features?.skinTone;
    if (typeof bodySkin === 'number') {
      this.applyBodySkinTone(bodySkin);
    } else {
      this.restoreBodySkinMaterial();
    }
    // Apply hair-style override (or revert) and hat. Hat takes precedence —
    // when a hat is detected we hide the hair sub-mesh regardless of the
    // hair payload (defensive: per Phase C convention `hair` is null when
    // `hat` is set, but we treat hat-presence as authoritative here).
    if (featuresExt?.hair) {
      this.setFaceHairOverride(featuresExt.hair.style, featuresExt.hair.color);
    } else {
      this.setFaceHairOverride(null, null);
    }
    if (featuresExt?.hat) {
      this.setFaceHat(featuresExt.hat);
    } else {
      this.setFaceHat(null);
    }
  }

  /**
   * Phase 8.4 — toggle between the simple-sphere and realistic eye
   * structures on both sides. `true` = show realistic (sclera/iris/pupil),
   * hide the simple black sphere. `false` = show simple, hide realistic.
   *
   * Both structures live as siblings under each `eye-${side}` Group; we
   * just flip `visible` on the relevant child. Three.js skips invisible
   * meshes during draw, so this has zero per-frame cost.
   */
  private toggleEyeRealistic(showRealistic: boolean): void {
    for (const side of ['left', 'right'] as const) {
      const simple = this.group.getObjectByName(`eye-${side}-simple`);
      const realistic = this.group.getObjectByName(`eye-${side}-realistic`);
      if (simple) simple.visible = !showRealistic;
      if (realistic) realistic.visible = showRealistic;
    }
  }

  /**
   * Phase 8.4 — apply per-eye iris colors. Each iris mesh has its own
   * MeshBasicMaterial (cloned at construction in `buildEye`) so we can
   * mutate `.color.setHex(...)` per player without touching shared
   * sclera/pupil materials or other players' irises.
   */
  private applyEyeColors(eyeColors: { left: number; right: number }): void {
    for (const side of ['left', 'right'] as const) {
      const iris = this.group.getObjectByName(`eye-${side}-iris`) as THREE.Mesh | undefined;
      if (!iris) continue;
      const mat = iris.material as THREE.MeshBasicMaterial;
      mat.color.setHex(eyeColors[side]);
      mat.needsUpdate = true;
    }
  }

  /**
   * Phase D — recolor the body skin material (head sphere, neck, forearms,
   * lower legs) to match the sampled forehead skin tone. All six body
   * skin meshes share `this.bodySkinMat`, so mutating `.color` once
   * updates every mesh — no per-mesh traversal needed.
   *
   * Body skin tone leaks across players if the SAME player rebuilds
   * (the underlying material is the same instance), but the per-player
   * `setFaceMesh3D` re-application path in `applyCachedFaceToPlayer`
   * (anim-viewer / player-editor / face-mirror) re-pushes the color on
   * every rebuild, so in practice the cache stays correct.
   */
  private applyBodySkinTone(color: number): void {
    if (!this.bodySkinMat) return;
    this.bodySkinMat.color.setHex(color);
    this.bodySkinMat.needsUpdate = true;
  }

  /**
   * Phase D — restore the body skin material to the rig's hash-derived
   * default color. Called from `setFaceMesh3D(null)` and the apply-path
   * when no `skinTone` was sampled (so a previous face's skin doesn't
   * leak onto a face with no sampled tone).
   */
  private restoreBodySkinMaterial(): void {
    if (!this.bodySkinMat) return;
    this.bodySkinMat.color.setHex(this.bodySkinDefaultColor);
    this.bodySkinMat.needsUpdate = true;
  }

  /**
   * Phase D — replace the player's hair sub-mesh with one built from a
   * sampled style + color (overrides the hash-derived default). Pass
   * `null` (for both args) to revert to the hash-derived default — used
   * when a face is cleared or its sampled hair payload is absent.
   *
   * Implementation mirrors the body slider rebuild pattern: the existing
   * `hair` child of `neckGroup` is removed + disposed, a fresh hair
   * Object3D is created via `createHair`, and tagged with the same
   * `name='hair'` so subsequent calls find it.
   *
   * Hat presence (see `setFaceHat`) hides the hair regardless of the
   * override — the hat-mounted player has no visible hair until the hat
   * is cleared.
   */
  setFaceHairOverride(style: HairStyle | null, color: number | null): void {
    const neckGroup = this.group.getObjectByName('neck-group') as
      | THREE.Group
      | undefined;
    if (!neckGroup) return;
    const prev = neckGroup.getObjectByName('hair') as THREE.Object3D | undefined;
    if (prev) {
      neckGroup.remove(prev);
      // Dispose any per-mesh resources owned by the prior hair sub-mesh.
      prev.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) (mat as THREE.Material).dispose();
        }
      });
    }
    const useStyle = style ?? this.defaultHairStyle;
    const useColor = color ?? this.defaultHairColor;
    const hair = this.createHair(useStyle, useColor);
    hair.name = 'hair';
    neckGroup.add(hair);
    // If a hat is currently mounted, the hair must remain hidden — hat
    // takes precedence (defensive against re-applying hair after a hat
    // was set, e.g. an edit-flow that rebuilds in a different order).
    if (this.faceHat) hair.visible = false;
  }

  /**
   * Phase D — mount (or clear) a procedural hat on `neckGroup`. When set,
   * the existing hair sub-mesh is hidden so the hat doesn't sit on top
   * of overlapping hair geometry. When cleared, the hair sub-mesh is
   * re-shown (its geometry survives — we only flipped `visible`).
   *
   * The hat geometry is built procedurally (see `hat-geometry.ts`) so
   * GPU cost is comparable to a hair sub-mesh: 1–2 small primitives,
   * one MeshStandardMaterial. Disposed on every swap and on `null`.
   */
  setFaceHat(hat: { type: HatType; color: number } | null): void {
    const neckGroup = this.group.getObjectByName('neck-group') as
      | THREE.Group
      | undefined;
    if (!neckGroup) return;
    // Tear down any prior hat unconditionally — even when the new hat
    // matches the old, building fresh keeps the lifecycle uniform with
    // the rest of the face-feature paths.
    if (this.faceHat) {
      neckGroup.remove(this.faceHat);
      disposeHat(this.faceHat);
      this.faceHat = null;
    }
    const hair = neckGroup.getObjectByName('hair') as THREE.Object3D | undefined;
    if (!hat) {
      // No hat — re-show the hair sub-mesh so the rig falls back to its
      // (default or override) hairstyle.
      if (hair) hair.visible = true;
      return;
    }
    this.faceHat = buildHat(hat.type, hat.color);
    neckGroup.add(this.faceHat);
    // Hide the hair sub-mesh so the hat sits cleanly on the head sphere.
    if (hair) hair.visible = false;
  }

  /**
   * Phase 8: expose the currently-mounted 3D face mesh so the live blendshape
   * puppet (in face-mirror.ts) can wrap it. Returns null when no 3D face is
   * applied (the player is showing default eye-spheres or a flat face image).
   *
   * The puppet mutates the geometry's `position` attribute in place — owned
   * by the mesh, which is owned by this player. Disposal still flows through
   * `setFaceMesh3D(null)`; the puppet's own `dispose()` only restores rest
   * positions and drops its caches, it does NOT free the mesh.
   */
  getFaceMesh3D(): THREE.Mesh | null {
    return this.faceMesh3D;
  }

  /** G1 — expose the head mesh's extras (back/sides/ears) so the
   *  visibility-toggle path (`window.__faceMode`) can hide/show them.
   *  Returns an empty array when no head mesh is mounted. */
  getHeadMeshExtras(): ReadonlyArray<THREE.Mesh> {
    return this.faceHeadMeshExtras;
  }

  /**
   * Phase B — mount (or clear) a procedural-face overlay built from the
   * supplied `BuiltFaceMesh`. The procedural face mounts as a SIBLING of
   * the canonical mesh in the `face-mesh-3d` slot; both render together
   * by default so a developer can compare them. The `window.__faceMode`
   * global toggle (read by `applyFaceMode`) flips visibility.
   *
   * Call this AFTER `setFaceMesh3D(...)` — the canonical mesh must already
   * be mounted so the procedural face can read its position attribute as
   * a landmark anchor system. Pass `null` (or omit the BuiltFaceMesh) to
   * clear without re-creating.
   *
   * Caller still owns the BuiltFaceMesh's geometry/texture/mesh — those are
   * managed by `setFaceMesh3D`. This method only adds the procedural sibling
   * group and tracks it for disposal.
   */
  setFaceProcedural(built: BuiltFaceMesh | null): void {
    // Dispose any prior procedural face on every call — the canonical mesh
    // it referenced may have been replaced.
    if (this.faceProcedural) {
      const slot = this.group.getObjectByName('face-mesh-3d') as THREE.Group | undefined;
      if (slot) slot.remove(this.faceProcedural.group);
      this.faceProcedural.dispose();
      this.faceProcedural = null;
    }
    if (!built) return;
    const slot = this.group.getObjectByName('face-mesh-3d') as THREE.Group | undefined;
    if (!slot) return;
    // Phase D: pass the cached sampled features so the procedural face's
    // skin/lip/brow/eye/nose features pick up the per-face values. When
    // setFaceMesh3D was called without features (old saves, AI uploads),
    // the cache is null and createProceduralFace falls back to defaults.
    this.faceProcedural = createProceduralFace(
      built,
      undefined,
      this.faceFeaturesCache ?? undefined,
    );
    slot.add(this.faceProcedural.group);
    applyFaceMode(this);
  }

  /**
   * Phase B — call every frame AFTER `puppet.apply(frame)` to refresh the
   * procedural face's geometry from the now-deformed canonical landmarks.
   * Cheap (~96 vertex writes per face); no-op when no procedural face is
   * mounted. MUST be called by every loop that drives the puppet
   * (face-mirror live + replay, anim-viewer face-anim replay, player-editor
   * face-anim replay) — otherwise the procedural overlay stays at rest
   * while the canonical mesh animates.
   */
  updateFaceProcedural(): void {
    this.faceProcedural?.update();
  }

  /**
   * Phase E — wire (or unwire) the live blendshape puppet so the procedural
   * face's conditional features (teeth, tongue) can read smoothed `jawOpen`
   * to toggle visibility. Call right after `createFacePuppet` succeeds, and
   * pass `null` when the puppet is disposed/detached so conditional features
   * hide rather than freeze at the last-applied state.
   */
  setFaceProceduralBlendshapeSource(src: BlendshapeSource | null): void {
    this.faceProcedural?.setBlendshapeSource(src);
  }

  /** Shared cleanup for the 3D mesh slot. Disposes geometry, material, and
   *  texture of the previous mesh (if any), and removes it from the slot.
   *  Also restores the head sphere's scale to the rig default (Phase 7.8 —
   *  per-face headShape may have stretched it) and reverts the eye structure
   *  back to the simple black sphere (Phase 8.4 — realistic eyes are only
   *  shown while a 3D mesh is mounted). */
  private clearFaceMesh3DInternal(): void {
    // Phase B: tear down the procedural face overlay first — it holds a
    // reference to the canonical mesh's geometry buffer (only used during
    // update(), but disposing in this order keeps the lifecycle clean).
    if (this.faceProcedural) {
      const slot = this.group.getObjectByName('face-mesh-3d') as THREE.Group | undefined;
      if (slot) slot.remove(this.faceProcedural.group);
      this.faceProcedural.dispose();
      this.faceProcedural = null;
    }
    if (this.faceMesh3DHeadShape) {
      const head = this.group.getObjectByName('head') as THREE.Mesh | undefined;
      if (head) {
        const cfg = playerConfig;
        head.scale.set(1, 1, cfg.head.headDepthScale);
      }
      this.faceMesh3DHeadShape = null;
    }
    if (!this.faceMesh3D) return;
    // Phase 8.4 — flip back to the simple-sphere eyes whenever the 3D mesh
    // is torn down. Catches both the explicit `setFaceMesh3D(null)` clear
    // path and the `setFaceImage(...)` path (which calls this internal
    // helper before mounting the flat texture, leaving us in default-eye
    // territory). The setFaceMesh3D(null) branch ALSO calls
    // toggleEyeRealistic(false) explicitly, but that path runs before this
    // helper's early-return check is reached when faceMesh3D is null —
    // doing it twice is idempotent.
    this.toggleEyeRealistic(false);
    this.faceEyeColors = null;
    const slot = this.group.getObjectByName('face-mesh-3d') as
      | THREE.Group
      | undefined;
    // G1 — when a head mesh group was mounted, the face mesh lives
    // INSIDE the group (not directly under the slot). Remove the group
    // from the slot, then dispose its extras (side panels, back, ears)
    // before disposing the face mesh + mouth interior.
    if (this.faceHeadMeshGroup) {
      if (slot) slot.remove(this.faceHeadMeshGroup);
      // Dispose the back/sides/ears geometries. The shared skin material
      // is referenced by all of them — dispose once after the loop.
      let sharedSkinMat: THREE.Material | null = null;
      for (const extra of this.faceHeadMeshExtras) {
        // Detach from group too (defensive — group is already detached
        // from the scene, but child geometries still need explicit
        // disposal).
        extra.geometry.dispose();
        const m = extra.material as THREE.Material | THREE.Material[];
        if (!Array.isArray(m)) {
          if (m && !sharedSkinMat) sharedSkinMat = m;
        }
      }
      if (sharedSkinMat) sharedSkinMat.dispose();
      this.faceHeadMeshExtras = [];
      // Re-show the rig's head sphere (it was hidden when the head
      // mesh mounted).
      const head = this.group.getObjectByName('head') as THREE.Mesh | undefined;
      if (head) {
        head.visible = true;
        const cfg = playerConfig;
        head.scale.set(1, 1, cfg.head.headDepthScale);
      }
      // Restore default eye-sphere positions (the apply path may have
      // moved them to align with the head mesh's iris-X).
      const eyeLeft = this.group.getObjectByName('eye-left') as THREE.Group | undefined;
      const eyeRight = this.group.getObjectByName('eye-right') as THREE.Group | undefined;
      if (eyeLeft && this.defaultEyeLeftPos) eyeLeft.position.copy(this.defaultEyeLeftPos);
      if (eyeRight && this.defaultEyeRightPos) eyeRight.position.copy(this.defaultEyeRightPos);
      this.faceHeadMeshGroup = null;
    } else if (slot) {
      slot.remove(this.faceMesh3D);
    }
    this.faceMesh3D.geometry.dispose();
    const mat = this.faceMesh3D.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose();
    } else {
      mat.dispose();
    }
    if (this.faceMesh3DTexture) {
      this.faceMesh3DTexture.dispose();
      this.faceMesh3DTexture = null;
    }
    this.faceMesh3D = null;
    // Phase 8.2b: dispose the mouth-interior sibling alongside the face
    // mesh. Owns its own (small, untextured) geometry + MeshBasicMaterial.
    // G1: when the mouth interior was added to the head group (not the
    // slot directly), it's already detached via the group-removal above
    // — we just dispose its geometry/material.
    if (this.faceMouthInterior) {
      if (slot && this.faceMouthInterior.parent === slot) {
        slot.remove(this.faceMouthInterior);
      }
      this.faceMouthInterior.geometry.dispose();
      const mmat = this.faceMouthInterior.material as
        | THREE.Material
        | THREE.Material[];
      if (Array.isArray(mmat)) {
        for (const m of mmat) m.dispose();
      } else {
        mmat.dispose();
      }
      this.faceMouthInterior = null;
    }
    // Phase D — also tear down any procedural hat + revert the body skin
    // material on every clear path (setFaceMesh3D(null) and the mutual-
    // exclusion path from setFaceImage). The setFaceMesh3D null branch
    // calls these too; doing it here additionally is idempotent and
    // catches the setFaceImage flow.
    if (this.faceHat) {
      const neckGroup = this.group.getObjectByName('neck-group') as
        | THREE.Group
        | undefined;
      if (neckGroup) neckGroup.remove(this.faceHat);
      disposeHat(this.faceHat);
      this.faceHat = null;
      // Re-show the hash-derived hair sub-mesh (which the hat was hiding).
      const hair = this.group.getObjectByName('hair') as THREE.Object3D | undefined;
      if (hair) hair.visible = true;
    }
    this.restoreBodySkinMaterial();
    // Drop the cached features so a subsequent procedural rebuild starts
    // with defaults (a stale features bundle would otherwise leak from
    // the cleared face onto the next default render).
    this.faceFeaturesCache = null;
  }

  private createMesh(color: number): THREE.Group {
    const group = new THREE.Group();
    const h = hashId(this.data.id);
    const skinColor = skinToneFromHash(h);
    const hairColor = hairColorFromHash(h);

    // G2: hash-derived per-player variation for pec sag + butt size. Computed
    // once at construction (not per-frame); applied as a multiplier on the
    // mesh's scale only. Different bytes of the hash drive different
    // dimensions so they're independent — a player can have flat pecs and a
    // big butt or vice versa.
    const pecSagFactor = 0.7 + (h % 100) / 100 * 0.6;          // [0.7, 1.3]
    const buttSizeFactor = 0.85 + ((h >> 8) % 100) / 100 * 0.4; // [0.85, 1.25]

    // ---- Skin material (shared across head, neck, forearms, lower legs) ----
    // Phase D: cached on the instance so `setFaceMesh3D` can mutate `.color`
    // when a sampled `skinTone` arrives, and `clearFaceMesh3DInternal()` can
    // restore the hash-derived default. Mutating `.color` on a single
    // shared material recolors every mesh that references it (six body
    // parts) at zero GPU cost.
    const skinMat = new THREE.MeshStandardMaterial({ color: skinColor });
    this.bodySkinMat = skinMat;
    this.bodySkinDefaultColor = skinColor;
    const jerseyMat = new THREE.MeshStandardMaterial({ color });

    // ========== BODY PIVOT (root joint at hip height) ==========
    const bodyPivot = new THREE.Group();
    bodyPivot.position.set(0, 0.78, 0);
    bodyPivot.name = 'body-pivot';
    group.add(bodyPivot);

    // ========== TORSO (relative to body-pivot) ==========
    // G2: RoundedBoxGeometry replaces the prior boxy BoxGeometry — softens
    // the silhouette so the torso reads as a soft middle-aged trunk rather
    // than a cardboard rectangle. Same apparent dimensions; corner radius is
    // a small fraction of the smallest side. 4 segments per side gives
    // smooth-enough corners at typical render distance without bloating
    // vertex count.
    const cfg = playerConfig;
    const torsoMinDim = Math.min(cfg.body.torsoWidth, cfg.body.torsoHeight, cfg.body.torsoDepth);
    const torsoCornerRadius = torsoMinDim * 0.25;
    const torso = new THREE.Mesh(
      new RoundedBoxGeometry(
        cfg.body.torsoWidth,
        cfg.body.torsoHeight,
        cfg.body.torsoDepth,
        4,
        torsoCornerRadius,
      ),
      jerseyMat,
    );
    torso.position.set(0, 0.2, 0);
    torso.name = 'torso';
    bodyPivot.add(torso);

    // ========== BEER BELLY ==========
    // An ellipsoid bulging out the front of the torso. Same jersey material so
    // it reads as "huge gut under the shirt" rather than exposed skin. Lives
    // on body-pivot so squash/stretch (jump anticipation, dunk land) inherits.
    const bellyGeo = new THREE.SphereGeometry(cfg.body.bellyRadius, 16, 12);
    const belly = new THREE.Mesh(bellyGeo, jerseyMat);
    belly.position.set(0, cfg.body.bellyY, cfg.body.bellyZ);
    belly.scale.set(1, cfg.body.bellyScaleY, cfg.body.bellyScaleZ);
    belly.name = 'belly';
    bodyPivot.add(belly);

    // ========== G2: SAGGING BELLY LOWER LOBE ==========
    // A second smaller belly sphere below the existing one — old men's
    // bellies hang low and sag. Reuses the same `bellyGeo` (cached at
    // module scope by the upper belly above) and only varies via scale.
    const bellyLower = new THREE.Mesh(bellyGeo, jerseyMat);
    bellyLower.position.set(0, cfg.body.bellyLowerY, cfg.body.bellyLowerZ);
    bellyLower.scale.set(
      cfg.body.bellyLowerScaleX,
      cfg.body.bellyLowerScaleY,
      cfg.body.bellyLowerScaleZ,
    );
    bellyLower.name = 'belly-lower';
    bodyPivot.add(bellyLower);

    // ========== G2: PEC MOUNDS ==========
    // Soft pec mounds, mirrored at ±pecOffsetX. Hash-derived sag factor varies
    // the vertical scale per player so some are flat and others noticeably
    // saggy. Same jersey material — under the shirt, no exposed skin.
    const pecGeo = getPecGeom(cfg.body.pecRadius);
    const pecLeft = new THREE.Mesh(pecGeo, jerseyMat);
    pecLeft.position.set(-cfg.body.pecOffsetX, cfg.body.pecY, cfg.body.pecZ);
    pecLeft.scale.set(1, cfg.body.pecScaleY * pecSagFactor, cfg.body.pecScaleZ);
    pecLeft.name = 'pec-left';
    bodyPivot.add(pecLeft);

    const pecRight = new THREE.Mesh(pecGeo, jerseyMat);
    pecRight.position.set(cfg.body.pecOffsetX, cfg.body.pecY, cfg.body.pecZ);
    pecRight.scale.set(1, cfg.body.pecScaleY * pecSagFactor, cfg.body.pecScaleZ);
    pecRight.name = 'pec-right';
    bodyPivot.add(pecRight);

    // ========== G2: LOVE HANDLES ==========
    // Ellipsoid bulges on the lower-side torso, half-buried in the hip area.
    // Mirrored at ±loveHandleOffsetX. Same jersey material.
    const loveHandleGeo = getLoveHandleGeom(cfg.body.loveHandleRadius);
    const loveHandleLeft = new THREE.Mesh(loveHandleGeo, jerseyMat);
    loveHandleLeft.position.set(-cfg.body.loveHandleOffsetX, cfg.body.loveHandleY, 0);
    loveHandleLeft.scale.set(
      cfg.body.loveHandleScaleX,
      cfg.body.loveHandleScaleY,
      cfg.body.loveHandleScaleZ,
    );
    loveHandleLeft.name = 'love-handle-left';
    bodyPivot.add(loveHandleLeft);

    const loveHandleRight = new THREE.Mesh(loveHandleGeo, jerseyMat);
    loveHandleRight.position.set(cfg.body.loveHandleOffsetX, cfg.body.loveHandleY, 0);
    loveHandleRight.scale.set(
      cfg.body.loveHandleScaleX,
      cfg.body.loveHandleScaleY,
      cfg.body.loveHandleScaleZ,
    );
    loveHandleRight.name = 'love-handle-right';
    bodyPivot.add(loveHandleRight);

    // ========== G2: BIG ASS ==========
    // Squashed sphere on the back of the hips. Hash-varied X-scale per
    // player (0.85–1.25) so some dads have bigger butts than others. Same
    // jersey material — covered by shorts.
    const buttGeo = getButtGeom(cfg.body.buttRadius);
    const butt = new THREE.Mesh(buttGeo, jerseyMat);
    butt.position.set(0, cfg.body.buttY, cfg.body.buttZ);
    butt.scale.set(
      cfg.body.buttScaleX * buttSizeFactor,
      cfg.body.buttScaleY,
      cfg.body.buttScaleZ,
    );
    butt.name = 'butt';
    bodyPivot.add(butt);

    // ========== NECK GROUP (at top of torso) ==========
    const neckGroup = new THREE.Group();
    neckGroup.position.set(0, 0.4, 0);
    neckGroup.name = 'neck-group';
    bodyPivot.add(neckGroup);

    // Neck mesh inside neck group
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.15, 4), skinMat);
    neck.position.set(0, 0.075, 0);
    neck.name = 'neck';
    neckGroup.add(neck);

    // Head on top of neck. Z-squash the sphere so the front of the head
    // is flatter — the face-plane (sibling of head, not a child, so it
    // doesn't inherit this scale) can then sit flush against the skin
    // across its full width without the sphere poking out around the
    // edges. Eyes are also siblings, so their positions are unaffected.
    const head = new THREE.Mesh(new THREE.SphereGeometry(cfg.head.radius, 8, 6), skinMat);
    head.position.set(0, cfg.head.positionY, 0);
    head.scale.z = cfg.head.headDepthScale;
    head.name = 'head';
    neckGroup.add(head);

    // Eyes on head (relative to neck group). Phase 8.4 — each `eye-${side}`
    // is now a Group containing a simple-sphere child (visible by default)
    // plus a hidden realistic sclera/iris/pupil child that `setFaceMesh3D`
    // toggles on. See `buildEye` for the structure rationale.
    const eyeLeft = buildEye('left', cfg.head.eyeRadius);
    eyeLeft.position.set(-cfg.head.eyeOffsetX, cfg.head.eyeOffsetY, cfg.head.eyeOffsetZ);
    neckGroup.add(eyeLeft);
    const eyeRight = buildEye('right', cfg.head.eyeRadius);
    eyeRight.position.set(cfg.head.eyeOffsetX, cfg.head.eyeOffsetY, cfg.head.eyeOffsetZ);
    neckGroup.add(eyeRight);
    // G1: cache default eye positions so setFaceMesh3D can move them to
    // align with the head-mesh's irisMidpoint (when a head mesh is
    // mounted), and clearFaceMesh3DInternal can restore them on clear.
    this.defaultEyeLeftPos = eyeLeft.position.clone();
    this.defaultEyeRightPos = eyeRight.position.clone();

    // Face plane — flat textured quad sitting just past the front of the
    // head sphere. Hidden by default; setFaceImage() loads a texture into
    // its material and toggles visibility (and hides the eye-spheres).
    // DoubleSide so the face stays visible even when the player rotates
    // 180° (e.g. turning to face the hoop while we orbit-cam them).
    //
    // alphaMap: a procedural radial-gradient texture (full-opacity in the
    // center, fading to transparent at the corners) so the captured photo
    // doesn't show as a sharp rectangle with background bleeding in at the
    // corners. The face image fills the center; chair/wall corners fade out.
    const faceMat = new THREE.MeshBasicMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      alphaMap: getFaceAlphaMap(),
    });
    const facePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(cfg.head.facePlaneSize, cfg.head.facePlaneSize),
      faceMat,
    );
    facePlane.position.set(0, cfg.head.eyeOffsetY, cfg.head.facePlaneZ);
    facePlane.visible = false;
    facePlane.name = 'face-plane';
    neckGroup.add(facePlane);

    // Phase 7.6: empty slot for the 3D face mesh produced by the Face
    // Editor's Scan flow. setFaceMesh3D() mounts the user's mesh as the
    // sole child of this group and hides the eye-spheres + face-plane;
    // setFaceImage() conversely clears this group and unhides them.
    //
    // Phase 7.8: slot Z is `eyeOffsetZ` (the rig's eye-anatomy Z), NOT
    // `facePlaneZ`. The mesh-builder centers the mesh on its eye-midpoint
    // in mesh-local coords, so anchoring this slot at the rig's eye-Z
    // puts the user's eyes precisely on the rig's eye anchor. Y also uses
    // `eyeOffsetY` (was already correct; eye anatomy Y).
    const faceMesh3DSlot = new THREE.Group();
    faceMesh3DSlot.position.set(0, cfg.head.eyeOffsetY, cfg.head.eyeOffsetZ);
    faceMesh3DSlot.name = 'face-mesh-3d';
    neckGroup.add(faceMesh3DSlot);

    // ========== HAIR (added to neckGroup) ==========
    // hairOverride (0..5) maps to the style list in HAIR_STYLE_WEIGHTS order;
    // otherwise the weighted distribution picks a style from the hash.
    const hairOverride = (this.data as any).hairOverride as number | undefined;
    const style = hairOverride !== undefined
      ? (HAIR_STYLE_WEIGHTS[hairOverride % HAIR_STYLE_WEIGHTS.length].style)
      : pickHairStyleFromHash(h);
    // Phase D: remember the hash-derived defaults so `setFaceHairOverride(null)`
    // can revert to them after a sampled-style override is cleared.
    this.defaultHairStyle = style;
    this.defaultHairColor = hairColor;
    const hair = this.createHair(style, hairColor);
    hair.name = 'hair';
    neckGroup.add(hair);

    // ========== BROAD SHOULDERS (connecting torso to arms) ==========
    // Shoulder cap meshes to bridge torso to arm joints
    const shoulderCapGeo = new THREE.SphereGeometry(cfg.body.shoulderCapRadius, 6, 4);
    const shoulderCapLeft = new THREE.Mesh(shoulderCapGeo, jerseyMat);
    shoulderCapLeft.position.set(-0.16, cfg.body.shoulderCapY, 0);
    shoulderCapLeft.name = 'shoulder-cap-left';
    bodyPivot.add(shoulderCapLeft);

    const shoulderCapRight = new THREE.Mesh(shoulderCapGeo, jerseyMat);
    shoulderCapRight.position.set(0.16, cfg.body.shoulderCapY, 0);
    shoulderCapRight.name = 'shoulder-cap-right';
    bodyPivot.add(shoulderCapRight);

    // ========== G2: SLOPED SHOULDERS ==========
    // Replaces the prior boxy `shoulder-bar` mesh. Two ellipsoid wedges that
    // taper from the neck out to the shoulder caps, like sloping trapezius
    // muscles. Each is a sphere geometry scaled non-uniformly along X (extends
    // outward), Y (squashed vertically), and Z (slightly less depth) to bridge
    // smoothly between the neck and the shoulder caps.
    const shoulderSlopeGeo = getShoulderSlopeGeom(cfg.body.shoulderSlopeRadius);
    const shoulderSlopeLeft = new THREE.Mesh(shoulderSlopeGeo, jerseyMat);
    shoulderSlopeLeft.position.set(
      -cfg.body.shoulderSlopeOffsetX,
      cfg.body.shoulderSlopeY,
      0,
    );
    shoulderSlopeLeft.scale.set(
      cfg.body.shoulderSlopeScaleX,
      cfg.body.shoulderSlopeScaleY,
      cfg.body.shoulderSlopeScaleZ,
    );
    shoulderSlopeLeft.name = 'shoulder-slope-left';
    bodyPivot.add(shoulderSlopeLeft);

    const shoulderSlopeRight = new THREE.Mesh(shoulderSlopeGeo, jerseyMat);
    shoulderSlopeRight.position.set(
      cfg.body.shoulderSlopeOffsetX,
      cfg.body.shoulderSlopeY,
      0,
    );
    shoulderSlopeRight.scale.set(
      cfg.body.shoulderSlopeScaleX,
      cfg.body.shoulderSlopeScaleY,
      cfg.body.shoulderSlopeScaleZ,
    );
    shoulderSlopeRight.name = 'shoulder-slope-right';
    bodyPivot.add(shoulderSlopeRight);

    // Shoulder joint groups
    const shoulderLeft = new THREE.Group();
    shoulderLeft.position.set(-0.2, 0.35, 0); // slightly wider to sit on caps
    shoulderLeft.name = 'shoulder-left';
    bodyPivot.add(shoulderLeft);

    const shoulderRight = new THREE.Group();
    shoulderRight.position.set(0.2, 0.35, 0);
    shoulderRight.name = 'shoulder-right';
    bodyPivot.add(shoulderRight);

    // Upper arms (hang down from shoulder)
    const armGeo = new THREE.CylinderGeometry(
      cfg.limbs.upperArmRadiusTop, cfg.limbs.upperArmRadiusBottom, cfg.limbs.upperArmLength, 4,
    );
    const upperArmLeft = new THREE.Mesh(armGeo, jerseyMat);
    upperArmLeft.position.set(0, -0.14, 0);
    upperArmLeft.name = 'upper-arm-left';
    shoulderLeft.add(upperArmLeft);

    const upperArmRight = new THREE.Mesh(armGeo, jerseyMat);
    upperArmRight.position.set(0, -0.14, 0);
    upperArmRight.name = 'upper-arm-right';
    shoulderRight.add(upperArmRight);

    // Elbows (groups at end of upper arm)
    const elbowLeft = new THREE.Group();
    elbowLeft.position.set(0, -0.14, 0);
    elbowLeft.name = 'elbow-left';
    upperArmLeft.add(elbowLeft);

    const elbowRight = new THREE.Group();
    elbowRight.position.set(0, -0.14, 0);
    elbowRight.name = 'elbow-right';
    upperArmRight.add(elbowRight);

    // Forearms
    const forearmGeo = new THREE.CylinderGeometry(
      cfg.limbs.forearmRadiusTop, cfg.limbs.forearmRadiusBottom, cfg.limbs.forearmLength, 4,
    );
    const forearmLeft = new THREE.Mesh(forearmGeo, skinMat);
    forearmLeft.position.set(0, -0.11, 0);
    forearmLeft.name = 'forearm-left';
    elbowLeft.add(forearmLeft);

    // ========== BEER (off-hand accessory) ==========
    // Every player gets a beer in their non-dribble (left) hand. It hides
    // while they're on the ground (knockdown = spilled beer), comes back
    // once they're upright. Also hidden during the `guard` stance so the
    // arms-up defensive pose doesn't look like they're waving a drink.
    const beerCanBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.16, 14),
      new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.75, roughness: 0.3 }),
    );
    const beerLabel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.057, 0.057, 0.08, 14),
      new THREE.MeshStandardMaterial({ color: 0xf59f2d }), // amber label
    );
    const beer = new THREE.Group();
    beer.add(beerCanBody);
    beer.add(beerLabel);
    // G4 — orient the can so its cylindrical axis is WORLD-VERTICAL when
    // the player is in the locked beerHold pose. Without compensation
    // the can's Y-axis (default cylinder axis) inherits the elbow's
    // bent-forward rotation (elbow.x = -1.4 rad in beerHold) and the can
    // ends up lying horizontally pointing forward — looks like the hand
    // is gripping the top of an upended can. Rotating the beer group by
    // +1.4 around X cancels the elbow's bend so the cylinder stays
    // vertical and the hand wraps around the SIDE of the can. Slight Z
    // rotation kept for a casual wrist-cock outward.
    //
    // Position: just past the fist along the forearm. With the elbow
    // bent up (forearm pointing forward), -Y in elbow-local space is
    // FORWARD in world; +Z in elbow-local is UP. We want the can to sit
    // a bit forward of the elbow (past the hand) and slightly DOWN from
    // the hand center so the hand wraps the upper side of the can. In
    // elbow-local that's negative Y (forward) and a small Z offset for
    // the can to rest on the side of the palm rather than poking
    // through it.
    beer.rotation.x = 1.4; // cancel elbow.x = -1.4 → cylinder vertical
    beer.rotation.z = 0.15; // slight wrist cock outward
    beer.position.set(-0.05, -0.24, -0.04);
    beer.name = 'beer';
    elbowLeft.add(beer);

    const forearmRight = new THREE.Mesh(forearmGeo, skinMat);
    forearmRight.position.set(0, -0.11, 0);
    forearmRight.name = 'forearm-right';
    elbowRight.add(forearmRight);

    // ========== HIP/GROIN (bridges torso bottom to leg tops) ==========
    const hipGeo = new THREE.BoxGeometry(cfg.body.hipWidth, cfg.body.hipHeight, cfg.body.hipDepth);
    const hipMesh = new THREE.Mesh(hipGeo, jerseyMat); // same color as jersey
    hipMesh.position.set(0, cfg.body.hipMeshY, 0);
    hipMesh.name = 'hip-mesh';
    bodyPivot.add(hipMesh);

    // ========== HIPS (groups at hip joints, relative to body-pivot at y=0) ==========
    const hipLeft = new THREE.Group();
    hipLeft.position.set(-0.08, 0, 0);
    hipLeft.name = 'hip-left';
    bodyPivot.add(hipLeft);

    const hipRight = new THREE.Group();
    hipRight.position.set(0.08, 0, 0);
    hipRight.name = 'hip-right';
    bodyPivot.add(hipRight);

    // Upper legs (hang down from hips)
    const upperLegGeo = new THREE.CylinderGeometry(
      cfg.limbs.upperLegRadiusTop, cfg.limbs.upperLegRadiusBottom, cfg.limbs.upperLegLength, 5,
    );
    const upperLegLeft = new THREE.Mesh(upperLegGeo, jerseyMat);
    upperLegLeft.position.set(0, -0.175, 0);
    upperLegLeft.name = 'upper-leg-left';
    hipLeft.add(upperLegLeft);

    const upperLegRight = new THREE.Mesh(upperLegGeo, jerseyMat);
    upperLegRight.position.set(0, -0.175, 0);
    upperLegRight.name = 'upper-leg-right';
    hipRight.add(upperLegRight);

    // Knees (groups at bottom of upper leg)
    const kneeLeft = new THREE.Group();
    kneeLeft.position.set(0, -0.175, 0);
    kneeLeft.name = 'knee-left';
    upperLegLeft.add(kneeLeft);

    const kneeRight = new THREE.Group();
    kneeRight.position.set(0, -0.175, 0);
    kneeRight.name = 'knee-right';
    upperLegRight.add(kneeRight);

    // Lower legs (hang from knees)
    const lowerLegGeo = new THREE.CylinderGeometry(
      cfg.limbs.lowerLegRadiusTop, cfg.limbs.lowerLegRadiusBottom, cfg.limbs.lowerLegLength, 5,
    );
    const lowerLegLeft = new THREE.Mesh(lowerLegGeo, skinMat);
    lowerLegLeft.position.set(0, -0.175, 0);
    lowerLegLeft.name = 'lower-leg-left';
    kneeLeft.add(lowerLegLeft);

    const lowerLegRight = new THREE.Mesh(lowerLegGeo, skinMat);
    lowerLegRight.position.set(0, -0.175, 0);
    lowerLegRight.name = 'lower-leg-right';
    kneeRight.add(lowerLegRight);

    // Ankles (groups at bottom of lower leg)
    const ankleLeft = new THREE.Group();
    ankleLeft.position.set(0, -0.175, 0);
    ankleLeft.name = 'ankle-left';
    lowerLegLeft.add(ankleLeft);

    const ankleRight = new THREE.Group();
    ankleRight.position.set(0, -0.175, 0);
    ankleRight.name = 'ankle-right';
    lowerLegRight.add(ankleRight);

    // Shoes
    const shoeGeo = new THREE.BoxGeometry(cfg.shoes.width, cfg.shoes.height, cfg.shoes.depth);
    const shoeMat = new THREE.MeshStandardMaterial({ color: cfg.shoes.color });
    const shoeLeft = new THREE.Mesh(shoeGeo, shoeMat);
    shoeLeft.position.set(0, cfg.shoes.offsetY, cfg.shoes.offsetZ);
    shoeLeft.name = 'shoe-left';
    ankleLeft.add(shoeLeft);

    const shoeRight = new THREE.Mesh(shoeGeo, shoeMat);
    shoeRight.position.set(0, cfg.shoes.offsetY, cfg.shoes.offsetZ);
    shoeRight.name = 'shoe-right';
    ankleRight.add(shoeRight);

    // ========== POSSESSION RING (direct child of group, not body-pivot) ==========
    const ringGeo = new THREE.TorusGeometry(0.35, 0.04, 6, 16);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0xffd700,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.8,
    });
    const possessionRing = new THREE.Mesh(ringGeo, ringMat);
    possessionRing.rotation.x = -Math.PI / 2; // lay flat
    possessionRing.position.set(0, 0.02, 0);
    possessionRing.visible = false;
    possessionRing.name = 'possession-ring';
    group.add(possessionRing);

    // ========== PLAYER INDICATOR (direct child of group, not body-pivot) ==========
    const indicator = this.createPlayerIndicator();
    indicator.name = 'player-indicator';
    indicator.visible = false;
    group.add(indicator);

    return group;
  }

  /**
   * Create a hair mesh based on the chosen style.
   */
  private createHair(style: HairStyle, hairColor: number): THREE.Object3D {
    const hairMat = new THREE.MeshStandardMaterial({ color: hairColor });
    const h = playerConfig.hair;

    // Hair positions relative to neckGroup.
    // Head center at y=0.35, head top at ~0.63, eyes at y=0.39 z=0.24 (front).
    // Hair should sit ON TOP and BEHIND the head, never covering the eyes.
    switch (style) {
      case 'bald': {
        // No hair at all — return an empty group so the mesh anchor exists
        // but contributes nothing visible. Skin shows through.
        return new THREE.Group();
      }

      case 'receding': {
        // Horseshoe: three tufts placed at the sides and back of the head,
        // with the top crown and forehead bare. Each tuft is a flattened
        // sphere that clings to the head at ear-to-nape level.
        const group = new THREE.Group();
        const headR = playerConfig.head.radius;
        const tuftY = playerConfig.head.positionY - headR * 0.15; // just below ear level
        const ringR = headR * 0.9; // how far out from center
        const tuftGeo = new THREE.SphereGeometry(headR * 0.35, 8, 6);
        // Left side
        const tuftL = new THREE.Mesh(tuftGeo, hairMat);
        tuftL.position.set(-ringR, tuftY, 0);
        tuftL.scale.set(0.6, 0.7, 1.0); // hug the head — flat, tall-ish, front-back stretch
        group.add(tuftL);
        // Right side
        const tuftR = new THREE.Mesh(tuftGeo, hairMat);
        tuftR.position.set(ringR, tuftY, 0);
        tuftR.scale.set(0.6, 0.7, 1.0);
        group.add(tuftR);
        // Back (covers nape + crown-back)
        const tuftB = new THREE.Mesh(tuftGeo, hairMat);
        tuftB.position.set(0, tuftY + headR * 0.05, -ringR);
        tuftB.scale.set(1.4, 0.6, 0.6); // wide across the back
        group.add(tuftB);
        return group;
      }

      case 'flat-top': {
        const geo = new THREE.BoxGeometry(h.flatTopWidth, h.flatTopHeight, h.flatTopDepth);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, h.flatTopY, h.flatTopZ);
        return mesh;
      }

      case 'afro': {
        const geo = new THREE.SphereGeometry(h.afroRadius, 8, 6);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, h.afroY, h.afroZ);
        return mesh;
      }

      case 'mohawk': {
        const geo = new THREE.BoxGeometry(h.mohawkWidth, h.mohawkHeight, h.mohawkDepth);
        const mesh = new THREE.Mesh(geo, hairMat);
        mesh.position.set(0, h.mohawkY, h.mohawkZ);
        return mesh;
      }

      case 'headband': {
        const geo = new THREE.CylinderGeometry(h.headbandRadius, h.headbandRadius, h.headbandThickness, 16, 1, true);
        const mat = new THREE.MeshStandardMaterial({ color: h.headbandColor, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, h.headbandY, 0);
        return mesh;
      }
    }
  }

  /**
   * Create a downward-pointing chevron/triangle indicator above the player's head.
   * Bright green (0x00ff88) so it's always visible.
   */
  private createPlayerIndicator(): THREE.Mesh {
    const shape = new THREE.Shape();
    // Downward-pointing triangle
    shape.moveTo(0, 0);
    shape.lineTo(0.1, 0.15);
    shape.lineTo(-0.1, 0.15);
    shape.lineTo(0, 0);

    const geo = new THREE.ShapeGeometry(shape);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // Position above the head (above hair), rotated to face camera
    mesh.position.set(0, 2.25, 0);
    mesh.rotation.x = -0.3; // slight tilt toward camera
    return mesh;
  }

  /**
   * Main animation method. Call every frame with delta time.
   *
   * Handles:
   * - Dribbling arm animation when holding ball
   * - Running arm swing when moving without ball
   * - Walk cycle leg animation when moving
   * - Possession ring pulsing
   * - Player indicator visibility
   */
  animate(dt: number): void {
    this.animTime += dt;
    const isMoving = this.velocity.lengthSq() > 0.01;

    // Guard timer
    if (this.isGuarding) {
      this.guardTimer -= dt;
      if (this.guardTimer <= 0) {
        this.isGuarding = false;
        this.guardTimer = 0;
        // Hide block-screen mesh if it exists
        const blockScreen = this.group.getObjectByName('block-screen');
        if (blockScreen) blockScreen.visible = false;
      }
    }

    // Clear blocking flag on landing
    if (this.isBlocking && !this.isJumping) {
      this.isBlocking = false;
    }

    // Determine animation state (forced state overrides auto-detection)
    if (this.forcedAnimState) {
      this.animState = this.forcedAnimState as typeof this.animState;
      // Still tick timers even when forced
      if (this.stealTimer > 0) this.stealTimer -= dt;
      if (this.shootTimer > 0) this.shootTimer -= dt;
      if (this.fallTimer > 0) this.fallTimer -= dt;
      if (this.dunkTimer > 0) this.dunkTimer -= dt;
      if (this.passTimer > 0) this.passTimer -= dt;
    } else if (this.fallTimer > 0) {
      this.animState = 'fall';
      this.fallTimer -= dt;
    } else if (this.dunkTimer > 0) {
      this.animState = 'dunk';
      this.dunkTimer -= dt;
    } else if (this.isJumping && !this.hasBall) {
      this.animState = 'jump-block'; // jumping without ball = blocking attempt
    } else if (this.isJumping) {
      this.animState = 'jump';
    } else if (this.stealTimer > 0) {
      this.animState = 'steal';
      this.stealTimer -= dt;
    } else if (this.shootTimer > 0) {
      this.animState = 'shoot';
      this.shootTimer -= dt;
    } else if (this.passTimer > 0) {
      this.animState = 'pass';
      this.passTimer -= dt;
    } else if (this.hasBall && isMoving && this.isSprinting) {
      this.animState = 'dribble-sprint';
    } else if (this.hasBall) {
      this.animState = 'dribble';
    } else if (isMoving && this.isSprinting) {
      this.animState = 'sprint';
    } else if (isMoving) {
      this.animState = 'walk';
    } else if (this.isGuarding) {
      this.animState = 'guard';
    } else {
      this.animState = 'idle';
    }

    // Get joint references (nested hierarchy — getObjectByName searches recursively)
    const bodyPivot = this.group.getObjectByName('body-pivot')!;
    const hipL = this.group.getObjectByName('hip-left')!;
    const hipR = this.group.getObjectByName('hip-right')!;
    const kneeL = this.group.getObjectByName('knee-left')!;
    const kneeR = this.group.getObjectByName('knee-right')!;
    const shoulderL = this.group.getObjectByName('shoulder-left')!;
    const shoulderR = this.group.getObjectByName('shoulder-right')!;
    const elbowL = this.group.getObjectByName('elbow-left')!;
    const elbowR = this.group.getObjectByName('elbow-right')!;

    // Detect state changes for transition blending
    if (this.animState !== this.prevAnimState) {
      this.lastShoulderL = shoulderL.rotation.x;
      this.lastShoulderR = shoulderR.rotation.x;
      this.stateTransitionTimer = this.STATE_BLEND_DURATION;
      this.prevAnimState = this.animState;
    }
    if (this.stateTransitionTimer > 0) {
      this.stateTransitionTimer -= dt;
    }

    // Possession ring pulse
    const ring = this.group.getObjectByName('possession-ring');
    if (ring) {
      ring.visible = this.isHumanControlled;
      if (this.hasBall) {
        const pulse = 1 + Math.sin(this.animTime * animConfig.durations.possessionRingPulse) * 0.15;
        ring.scale.set(pulse, 1, pulse);
      }
    }

    // Player indicator bob
    const indicator = this.group.getObjectByName('player-indicator');
    if (indicator) {
      indicator.visible = this.isHumanControlled;
      if (this.isHumanControlled) {
        indicator.position.y = 2.25 + Math.sin(this.animTime * animConfig.durations.indicatorBob) * 0.08;
      }
    }

    // Beer visibility — spills on knockdown (fall), hidden during guard
    // (arms-up pose would have the beer up in the air, awkward).
    const beer = this.group.getObjectByName('beer');
    if (beer) {
      beer.visible = this.fallTimer <= 0 && !this.isGuarding;
    }

    if (isMoving) {
      const facingDir = new THREE.Vector3(0, 0, 1);
      facingDir.applyQuaternion(this.group.quaternion);
      facingDir.y = 0;
      facingDir.normalize();
      const moveDir = this.velocity.clone();
      moveDir.y = 0;
      moveDir.normalize();
      const dot = facingDir.dot(moveDir);
      // Hysteresis: once true, require dot > -0.1 to clear; once false,
      // require dot < -0.5 to set. Keeps the walk-anim branch stable when
      // facing wobbles (e.g. AI smooth-lerp while moving).
      if (this.isMovingBackwards) {
        if (dot > -0.1) this.isMovingBackwards = false;
      } else {
        if (dot < -0.5) this.isMovingBackwards = true;
      }
    } else {
      this.isMovingBackwards = false;
    }
    const isMovingBackwards = this.isMovingBackwards;

    switch (this.animState) {
      case 'idle': {
        // Gentle breathing/sway
        const p = animConfig.poses.idle;
        bodyPivot.rotation.x = p.bodyPivotRotX;
        bodyPivot.scale.set(1, 1, 1);
        hipL.rotation.x = p.hipLRotX;
        hipR.rotation.x = p.hipRRotX;
        kneeL.rotation.x = p.kneeLRotX;
        kneeR.rotation.x = p.kneeRRotX;
        shoulderL.rotation.x = p.shoulderLRotX;
        shoulderR.rotation.x = p.shoulderRRotX;
        elbowL.rotation.x = p.elbowLRotX;
        elbowR.rotation.x = p.elbowRRotX;
        // Gentle idle bob
        this.group.position.y = Math.sin(this.animTime * animConfig.durations.idleBob) * animConfig.amplitudes.idle.swayHeight;
        break;
      }

      case 'walk': {
        if (isMovingBackwards) {
          // BACKWARDS SHUFFLE: slower, shorter strides, defensive stance
          const t = this.animTime * animConfig.durations.backwardStride;
          const bounceT = this.animTime * animConfig.durations.backwardBounce;
          const bouncePhase = (Math.sin(bounceT) + 1) / 2;
          this.group.position.y = Math.pow(bouncePhase, 0.6) * animConfig.amplitudes.walkBackward.bounceHeight;

          const pb = animConfig.poses.walkBackward;
          bodyPivot.rotation.x = pb.bodyPivotRotX;
          bodyPivot.scale.set(1, 1, 1);

          const strideRaw = Math.sin(t);
          const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * animConfig.amplitudes.walkBackward.strideAmp;

          hipL.rotation.x = -stride;
          hipR.rotation.x = stride;
          kneeL.rotation.x = animConfig.amplitudes.walkBackward.kneeBase + Math.max(0, stride) * animConfig.amplitudes.walkBackward.kneeSwing;
          kneeR.rotation.x = animConfig.amplitudes.walkBackward.kneeBase + Math.max(0, -stride) * animConfig.amplitudes.walkBackward.kneeSwing;

          // Arms in defensive ready position
          shoulderL.rotation.x = pb.shoulderLRotX;
          shoulderL.rotation.z = pb.shoulderLRotZ;
          shoulderR.rotation.x = pb.shoulderRRotX;
          shoulderR.rotation.z = pb.shoulderRRotZ;
          elbowL.rotation.x = pb.elbowLRotX;
          elbowR.rotation.x = pb.elbowRRotX;
          break;
        }

        // Bouncy stride — faster pace, subtler bounce
        const t = this.animTime * animConfig.durations.walkStride;
        const bounceT = this.animTime * animConfig.durations.walkBounce;
        const bouncePhase = (Math.sin(bounceT) + 1) / 2;
        this.group.position.y = Math.pow(bouncePhase, 0.6) * animConfig.amplitudes.walk.bounceHeight;

        // Squash-stretch on body pivot
        const pw = animConfig.poses.walk;
        const squashStretch = bouncePhase; // 0 = ground contact, 1 = peak
        bodyPivot.scale.set(
          1 + (1 - squashStretch) * pw.squashStretchAmount,   // wider at ground
          1 - (1 - squashStretch) * pw.squashStretchAmount + squashStretch * pw.squashStretchAmount, // shorter at ground, taller at peak
          1 + (1 - squashStretch) * pw.squashStretchAmount    // wider at ground
        );

        // Forward lean
        bodyPivot.rotation.x = pw.bodyPivotRotX;

        // Leg stride — floaty power curve
        const strideRaw = Math.sin(t);
        const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * animConfig.amplitudes.walk.strideAmp;

        hipL.rotation.x = -stride; // negative = forward swing
        hipR.rotation.x = stride;

        // Knee bend: more when leg is back (pushing off)
        kneeL.rotation.x = animConfig.amplitudes.walk.kneeBase + Math.max(0, stride) * animConfig.amplitudes.walk.kneeSwing;
        kneeR.rotation.x = animConfig.amplitudes.walk.kneeBase + Math.max(0, -stride) * animConfig.amplitudes.walk.kneeSwing;

        // Arms swing opposite to their OPPOSITE legs
        shoulderL.rotation.x = stride * animConfig.amplitudes.walk.armSwingRatio;
        shoulderR.rotation.x = -stride * animConfig.amplitudes.walk.armSwingRatio;
        elbowL.rotation.x = -animConfig.amplitudes.walk.elbowBend - Math.max(0, stride) * animConfig.amplitudes.walk.elbowBend;
        elbowR.rotation.x = -animConfig.amplitudes.walk.elbowBend - Math.max(0, -stride) * animConfig.amplitudes.walk.elbowBend;

        // Torso/hip counter-rotation for natural walk
        const torso = this.group.getObjectByName('torso');
        const hipMeshNode = this.group.getObjectByName('hip-mesh');
        if (torso && hipMeshNode) {
          // Hips twist WITH the leading leg, torso twists OPPOSITE
          hipMeshNode.rotation.y = stride * animConfig.amplitudes.walk.hipTwist;
          torso.rotation.y = -stride * animConfig.amplitudes.walk.torsoTwist;
        }
        break;
      }

      case 'dribble': {
        const t = this.animTime * animConfig.durations.walkStride; // match walk speed

        // Compute dribble phase (0-1 cycle) — same speed for all modes
        const dribbleSpeed = animConfig.durations.dribbleCycle; // Hz — cycles per second
        this.dribblePhase = (this.animTime * dribbleSpeed) % 1;

        // Arm synced with ball phase
        const armPhase = (this.dribblePhase + 0.75) % 1;
        let elbowBend: number;
        let shoulderPump: number;
        if (armPhase < 0.45) {
          // Arm up — ball in hand
          elbowBend = -0.5;
          shoulderPump = -0.2; // shoulder back (arm up/back)
        } else if (armPhase < 0.6) {
          // Arm pushes down — ball releasing
          const t = (armPhase - 0.45) / 0.15;
          elbowBend = -0.5 - t * 0.6; // -0.5 to -1.1
          shoulderPump = -0.2 - t * 0.4; // -0.2 to -0.6
        } else if (armPhase < 0.8) {
          // Arm at bottom — ball at floor
          elbowBend = -1.1;
          shoulderPump = -0.6; // shoulder most forward (arm reaching down)
        } else {
          // Arm returns up — ball rising
          const t = (armPhase - 0.8) / 0.2;
          elbowBend = -1.1 + t * 0.6; // -1.1 to -0.5
          shoulderPump = -0.6 + t * 0.4; // -0.6 to -0.2
        }

        const pd = animConfig.poses.dribble;
        const pds = animConfig.poses.dribbleStationary;
        if (this.velocity.lengthSq() > 0.01) {
          // Moving with ball — walk legs + phase-based dribble arm
          const bounceT = this.animTime * animConfig.durations.walkBounce; // match walk double-bounce
          const bouncePhase = (Math.sin(bounceT) + 1) / 2;
          this.group.position.y = Math.pow(bouncePhase, 0.6) * animConfig.amplitudes.dribble.bounceHeight;

          // Squash-stretch on body pivot (subtle)
          const squashStretch = bouncePhase;
          bodyPivot.scale.set(
            1 + (1 - squashStretch) * pd.squashStretchAmount,
            1 - (1 - squashStretch) * pd.squashStretchAmount + squashStretch * pd.squashStretchAmount,
            1 + (1 - squashStretch) * pd.squashStretchAmount
          );

          bodyPivot.rotation.x = pd.bodyPivotRotX;

          const strideRaw = Math.sin(t);
          const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * animConfig.amplitudes.dribble.strideAmp;
          hipL.rotation.x = -stride;
          hipR.rotation.x = stride;
          kneeL.rotation.x = animConfig.amplitudes.dribble.kneeBase + Math.max(0, stride) * animConfig.amplitudes.dribble.kneeSwing;
          kneeR.rotation.x = animConfig.amplitudes.dribble.kneeBase + Math.max(0, -stride) * animConfig.amplitudes.dribble.kneeSwing;

          // Dribble arm (right): phase-based with shoulder pump
          shoulderR.rotation.x = shoulderPump;
          elbowR.rotation.x = elbowBend;

          // Torso/hip counter-rotation for natural walk
          const torso = this.group.getObjectByName('torso');
          const hipMeshNode = this.group.getObjectByName('hip-mesh');
          if (torso && hipMeshNode) {
            hipMeshNode.rotation.y = stride * pd.hipTwistFactor;
            torso.rotation.y = -stride * pd.torsoTwistFactor;
          }
        } else {
          // Stationary dribble
          this.group.position.y = Math.sin(this.animTime * animConfig.durations.idleBob) * animConfig.amplitudes.idle.swayHeight;
          bodyPivot.scale.set(1, 1, 1);
          bodyPivot.rotation.x = pds.bodyPivotRotX;
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
          kneeL.rotation.x = pds.kneeBase;
          kneeR.rotation.x = pds.kneeBase;

          // Dribble arm (right): phase-based with shoulder pump
          shoulderR.rotation.x = shoulderPump;
          elbowR.rotation.x = elbowBend;
        }

        // Balance arm (left): OUT to the side, not tucked in
        // LEFT shoulder: NEGATIVE rotation.z = arm goes OUTWARD (away from body)
        shoulderL.rotation.x = pd.leftArmShoulderX;
        shoulderL.rotation.z = pd.leftArmShoulderZ;
        elbowL.rotation.x = pd.leftArmElbow;
        break;
      }

      case 'guard': {
        // Low defensive stance with arms UP HIGH to block
        const pg = animConfig.poses.guard;
        bodyPivot.scale.set(1, 1, 1);
        bodyPivot.rotation.x = pg.bodyPivotRotX;
        hipL.rotation.x = pg.hipLRotX;
        hipR.rotation.x = pg.hipRRotX;
        kneeL.rotation.x = pg.kneeLRotX;
        kneeR.rotation.x = pg.kneeRRotX;

        // Arms STRAIGHT UP to block — maximum reach
        shoulderL.rotation.x = pg.shoulderLRotX;
        shoulderL.rotation.z = pg.shoulderLRotZ;
        shoulderR.rotation.x = pg.shoulderRRotX;
        shoulderR.rotation.z = pg.shoulderRRotZ;
        elbowL.rotation.x = pg.elbowLRotX;
        elbowR.rotation.x = pg.elbowRRotX;

        this.group.position.y = pg.stanceDropY;

        // Show/create block screen (semi-transparent plane in front)
        let screen = this.group.getObjectByName('block-screen');
        if (!screen) {
          const screenGeo = new THREE.PlaneGeometry(1.2, 1.5);
          const screenMat = new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.15,
            side: THREE.DoubleSide,
          });
          screen = new THREE.Mesh(screenGeo, screenMat);
          screen.name = 'block-screen';
          screen.position.set(0, 1.2, 0.5); // in front of player, chest height
          this.group.add(screen);
        }
        screen.visible = true;
        // Pulse the screen opacity
        const screenMat = (screen as THREE.Mesh).material as THREE.MeshBasicMaterial;
        screenMat.opacity = animConfig.amplitudes.guard.blockOpacityMin + Math.sin(this.animTime * animConfig.durations.guardPulse) * animConfig.amplitudes.guard.blockOpacitySwing;
        break;
      }

      case 'steal': {
        // SIDE SWIPE: arm pulls back to side, pauses, quick sweep across
        // Now with guard-like crouch throughout
        const stealDuration = animConfig.durations.stealDuration;
        const progress = 1 - (this.stealTimer / stealDuration);

        // Phase 1 (0-0.2): Wind back — arm pulls to the right side
        // Phase 2 (0.2-0.55): Pause — held back, arm grows, anticipation
        // Phase 3 (0.55-0.85): Quick swipe — arm sweeps across low
        // Phase 4 (0.85-1.0): Recovery

        const forearmR = this.group.getObjectByName('forearm-right');
        let forearmScale = 1;

        const pst = animConfig.poses.steal;
        // Lower stance like guard
        this.group.position.y = pst.stanceDropY;

        if (progress < 0.2) {
          const wind = progress / 0.2;
          bodyPivot.rotation.x = pst.windBodyPivotRotX;
          shoulderR.rotation.x = pst.windShoulderRRotX * wind;
          shoulderR.rotation.z = pst.windShoulderRRotZ * wind;
          elbowR.rotation.x = pst.windElbowRRotX * wind;
          forearmScale = 1 + wind * 0.4;
          bodyPivot.rotation.y = pst.windBodyRotY * wind;
          bodyPivot.scale.set(pst.windSquashX, pst.windSquashY, pst.windSquashX);
        } else if (progress < 0.55) {
          // HOLD: cocked back, big forearm, dramatic pause
          bodyPivot.rotation.x = pst.holdBodyPivotRotX;
          shoulderR.rotation.x = pst.holdShoulderRRotX;
          shoulderR.rotation.z = pst.holdShoulderRRotZ;
          elbowR.rotation.x = pst.holdElbowRRotX;
          forearmScale = 1.6;
          bodyPivot.rotation.y = pst.holdBodyRotY;
          bodyPivot.scale.set(pst.holdSquashX, pst.holdSquashY, pst.holdSquashX);
        } else if (progress < 0.85) {
          // SWIPE: quick sweep from right to left, low
          bodyPivot.rotation.x = pst.swipeBodyPivotRotX;
          const swipe = (progress - 0.55) / 0.3;
          shoulderR.rotation.x = pst.swipeShoulderRXBase + swipe * pst.swipeShoulderRXSwing;
          shoulderR.rotation.z = pst.swipeShoulderRZBase + swipe * pst.swipeShoulderRZSwing;
          elbowR.rotation.x = pst.swipeElbowRXBase + swipe * pst.swipeElbowRXSwing;
          forearmScale = 1.6 - swipe * 0.4;
          bodyPivot.rotation.y = pst.swipeBodyRotYBase + swipe * pst.swipeBodyRotYSwing;
          // Stretch horizontally as the arm sweeps
          const stretchX = 1.06 - swipe * 0.06 + Math.sin(swipe * Math.PI) * 0.1;
          const squashY = 0.94 + swipe * 0.06 - Math.sin(swipe * Math.PI) * 0.08;
          bodyPivot.scale.set(stretchX, squashY, 1);
        } else {
          // Recovery
          const recover = (progress - 0.85) / 0.15;
          bodyPivot.rotation.x = pst.holdBodyPivotRotX * (1 - recover);
          shoulderR.rotation.x = -0.6 + recover * 0.6;
          shoulderR.rotation.z = -0.8 + recover * 0.8;
          elbowR.rotation.x = -0.2 + recover * 0.1;
          forearmScale = 1.2 - recover * 0.2;
          bodyPivot.rotation.y = -0.3 + recover * 0.3;
          bodyPivot.scale.set(
            1 + (1 - recover) * 0.04,
            1 - (1 - recover) * 0.04,
            1
          );
          this.group.position.y = pst.stanceDropY * (1 - recover);
        }

        if (forearmR) {
          forearmR.scale.set(forearmScale, forearmScale, forearmScale);
          if (this.stealTimer <= 0) forearmR.scale.set(1, 1, 1);
        }

        // Left arm relaxed at side
        shoulderL.rotation.x = pst.shoulderLRotX;
        elbowL.rotation.x = pst.elbowLRotX;

        // Deep crouched stance like guard
        hipL.rotation.x = pst.hipLRotX;
        hipR.rotation.x = pst.hipRRotX;
        kneeL.rotation.x = pst.kneeLRotX;
        kneeR.rotation.x = pst.kneeRRotX;
        break;
      }

      case 'shoot': {
        // Basketball shot: snap ball up to shooting position, release, arms back down
        // Phase 1 (0-0.15): Snap hands up together — ball in right hand (back), left guides (side)
        // Phase 2 (0.15-0.4): Quick release — right arm extends up, left peels away
        // Phase 3 (0.4-1.0): Follow through and arms back down
        bodyPivot.scale.set(1, 1, 1);
        const shootDuration = animConfig.durations.shootDuration;
        const progress = 1 - (this.shootTimer / shootDuration); // 0 to 1

        const psh = animConfig.poses.shoot;
        const hopHeight = animConfig.amplitudes.shoot.hopHeight;
        // Slight hop during shot — quick up, brief hang, land
        let shootHeight: number;
        if (progress < 0.15) {
          shootHeight = 0;
        } else if (progress < 0.25) {
          const rise = (progress - 0.15) / 0.1;
          shootHeight = rise * hopHeight;
        } else if (progress < 0.4) {
          shootHeight = hopHeight;
        } else if (progress < 0.55) {
          const descend = (progress - 0.4) / 0.15;
          shootHeight = hopHeight * (1 - descend);
        } else {
          shootHeight = 0;
        }
        this.group.position.y = shootHeight;

        if (progress < 0.15) {
          // SNAP: hands come up together to shooting position
          const snap = progress / 0.15;
          shoulderR.rotation.x = psh.snapShoulderR * snap;
          shoulderR.rotation.z = psh.snapShoulderRZ * snap;
          elbowR.rotation.x = psh.snapElbowR * snap;
          shoulderL.rotation.x = psh.snapShoulderL * snap;
          shoulderL.rotation.z = psh.snapShoulderLZ * snap;
          elbowL.rotation.x = psh.snapElbowL * snap;
          bodyPivot.rotation.x = psh.snapBodyPivotRotX;
          kneeL.rotation.x = psh.snapKneeBend * (progress / 0.15);
          kneeR.rotation.x = psh.snapKneeBend * (progress / 0.15);
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
        } else if (progress < 0.25) {
          // RISE: arms continue, legs extend
          const rise = (progress - 0.15) / 0.1;
          const subRelease = (progress - 0.15) / 0.25;
          shoulderR.rotation.x = psh.snapShoulderR - subRelease * 0.8;
          shoulderR.rotation.z = psh.snapShoulderRZ;
          elbowR.rotation.x = psh.snapElbowR + subRelease * 1.0;
          shoulderL.rotation.x = psh.snapShoulderL + subRelease * 1.0;
          shoulderL.rotation.z = psh.snapShoulderLZ - subRelease * 0.3;
          elbowL.rotation.x = psh.snapElbowL + subRelease * 0.5;
          bodyPivot.rotation.x = psh.snapBodyPivotRotX - subRelease * 0.15;
          kneeL.rotation.x = psh.snapKneeBend * (1 - rise);
          kneeR.rotation.x = psh.snapKneeBend * (1 - rise);
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
        } else if (progress < 0.4) {
          // HANG TIME + RELEASE: right arm extends up, left peels away
          const subRelease = (progress - 0.15) / 0.25;
          shoulderR.rotation.x = psh.snapShoulderR - subRelease * 0.8;
          shoulderR.rotation.z = psh.snapShoulderRZ;
          elbowR.rotation.x = psh.snapElbowR + subRelease * 1.0;
          shoulderL.rotation.x = psh.snapShoulderL + subRelease * 1.0;
          shoulderL.rotation.z = psh.snapShoulderLZ - subRelease * 0.3;
          elbowL.rotation.x = psh.snapElbowL + subRelease * 0.5;
          bodyPivot.rotation.x = psh.snapBodyPivotRotX - subRelease * 0.15;
          kneeL.rotation.x = psh.hangKnee;
          kneeR.rotation.x = psh.hangKnee;
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
        } else if (progress < 0.55) {
          // COMING DOWN: start recovery
          const descend = (progress - 0.4) / 0.15;
          const recover = (progress - 0.4) / 0.6;
          shoulderR.rotation.x = psh.releaseShoulderR + recover * 2.6;
          shoulderR.rotation.z = psh.snapShoulderRZ * (1 - recover);
          elbowR.rotation.x = psh.releaseElbowR + recover * 0.1;
          shoulderL.rotation.x = psh.releaseShoulderL + recover * 0.6;
          shoulderL.rotation.z = psh.releaseShoulderLZ + recover * 0.6;
          elbowL.rotation.x = psh.releaseElbowL + recover * 0.2;
          bodyPivot.rotation.x = psh.releaseBodyPivotRotX + recover * 0.1;
          const land = descend;
          hipR.rotation.x = psh.landHipR * land;
          hipL.rotation.x = psh.landHipL * land;
          kneeR.rotation.x = psh.landKneeR * land;
          kneeL.rotation.x = psh.landKneeL * land;
        } else {
          // RECOVER: on ground, arms come back down to sides
          const recover = (progress - 0.4) / 0.6;
          shoulderR.rotation.x = psh.releaseShoulderR + recover * 2.6;
          shoulderR.rotation.z = psh.snapShoulderRZ * (1 - recover);
          elbowR.rotation.x = psh.releaseElbowR + recover * 0.1;
          shoulderL.rotation.x = psh.releaseShoulderL + recover * 0.6;
          shoulderL.rotation.z = psh.releaseShoulderLZ + recover * 0.6;
          elbowL.rotation.x = psh.releaseElbowL + recover * 0.2;
          bodyPivot.rotation.x = psh.releaseBodyPivotRotX + recover * 0.1;
          if (progress >= 0.55) {
            const land = (progress - 0.55) / 0.45;
            hipR.rotation.x = psh.recoverHipR;
            hipL.rotation.x = psh.recoverHipL;
            kneeR.rotation.x = psh.recoverKneeR * (1 - land * 0.7);
            kneeL.rotation.x = psh.recoverKneeL * (1 - land * 0.5);
          } else {
            hipR.rotation.x = psh.landHipR;
            hipL.rotation.x = psh.landHipL;
            kneeR.rotation.x = psh.landKneeR;
            kneeL.rotation.x = psh.landKneeL;
          }
        }

        // Torso/hip twist during shot
        const torsoNode = this.group.getObjectByName('torso');
        const hipMeshNode = this.group.getObjectByName('hip-mesh');
        if (torsoNode && hipMeshNode) {
          if (progress < 0.15) {
            const snap = progress / 0.15;
            hipMeshNode.rotation.y = psh.hipTwistSnap * snap;
            torsoNode.rotation.y = psh.torsoTwistSnap * snap;
          } else if (progress < 0.4) {
            const release = (progress - 0.15) / 0.25;
            hipMeshNode.rotation.y = psh.hipTwistSnap + release * psh.hipTwistRelease;
            torsoNode.rotation.y = psh.torsoTwistSnap + release * psh.torsoTwistRelease;
          } else {
            const recover = (progress - 0.4) / 0.6;
            hipMeshNode.rotation.y = -psh.hipTwistSnap * (1 - recover);
            torsoNode.rotation.y = -psh.torsoTwistSnap * (1 - recover);
          }
        }
        break;
      }

      case 'jump': {
        bodyPivot.scale.set(1, 1, 1);
        this.jumpTimer -= dt;
        const jumpDuration = animConfig.durations.jumpDuration;
        const progress = 1 - (this.jumpTimer / jumpDuration);

        // Parabolic height
        this.jumpHeight = Math.sin(progress * Math.PI) * animConfig.amplitudes.jump.apexHeight;
        this.group.position.y = this.jumpHeight;

        const pj = animConfig.poses.jump;
        if (progress < 0.15) {
          // WIND-UP: deep crouch, arms pull down gathering energy
          const crouch = progress / 0.15;
          bodyPivot.rotation.x = pj.crouchBodyPivotRotX * crouch;
          kneeL.rotation.x = pj.crouchKnee * crouch;
          kneeR.rotation.x = pj.crouchKnee * crouch;
          hipL.rotation.x = pj.crouchHip * crouch;
          hipR.rotation.x = pj.crouchHip * crouch;
          shoulderL.rotation.x = pj.crouchShoulder * crouch;
          shoulderR.rotation.x = pj.crouchShoulder * crouch;
          elbowL.rotation.x = pj.crouchElbow * crouch;
          elbowR.rotation.x = pj.crouchElbow * crouch;
        } else if (progress < 0.3) {
          // LAUNCH: explosive extension
          const launch = (progress - 0.15) / 0.15;
          bodyPivot.rotation.x = pj.crouchBodyPivotRotX - launch * 0.35;
          kneeL.rotation.x = pj.crouchKnee * (1 - launch);
          kneeR.rotation.x = pj.crouchKnee * (1 - launch);
          hipL.rotation.x = pj.crouchHip * (1 - launch);
          hipR.rotation.x = pj.crouchHip * (1 - launch);
          shoulderR.rotation.x = pj.crouchShoulder - launch * pj.launchShoulderR;
          elbowR.rotation.x = pj.crouchElbow + launch * pj.launchElbowRDelta;
          shoulderL.rotation.x = pj.crouchShoulder - launch * pj.launchShoulderL;
          shoulderL.rotation.z = -launch * pj.launchShoulderLZ;
          elbowL.rotation.x = pj.crouchElbow + launch * pj.launchElbowLDelta;
        } else if (progress < 0.7) {
          // HANG TIME: peak — iconic basketball pose
          bodyPivot.rotation.x = pj.hangBodyPivotRotX;
          kneeL.rotation.x = pj.hangKneeL;
          kneeR.rotation.x = pj.hangKneeR;
          hipL.rotation.x = pj.hangHipL;
          hipR.rotation.x = pj.hangHipR;
          shoulderR.rotation.x = pj.hangShoulderR;
          elbowR.rotation.x = pj.hangElbowR;
          shoulderL.rotation.x = pj.hangShoulderL;
          shoulderL.rotation.z = pj.hangShoulderLZ;
          elbowL.rotation.x = pj.hangElbowL;
        } else if (progress < 0.85) {
          // DESCENT: start tucking
          const tuck = (progress - 0.7) / 0.15;
          bodyPivot.rotation.x = pj.hangBodyPivotRotX + tuck * pj.descentBodyLeanDelta;
          shoulderR.rotation.x = pj.hangShoulderR + tuck * pj.descentShoulderRDelta;
          elbowR.rotation.x = pj.hangElbowR - tuck * 0.2;
          shoulderL.rotation.x = pj.hangShoulderL + tuck * 0.3;
          shoulderL.rotation.z = pj.hangShoulderLZ + tuck * 0.3;
          elbowL.rotation.x = pj.hangElbowL;
          kneeL.rotation.x = pj.hangKneeL + tuck * pj.descentKneeDelta;
          kneeR.rotation.x = pj.hangKneeR + tuck * pj.descentKneeDelta;
          hipL.rotation.x = pj.hangHipL + tuck * 0.1;
          hipR.rotation.x = pj.hangHipR - tuck * 0.1;
        } else {
          // LAND: deep absorb
          const land = (progress - 0.85) / 0.15;
          bodyPivot.rotation.x = pj.landBodyPivotRotX + land * 0.15;
          kneeL.rotation.x = pj.landKneeLBase + land * 0.4;
          kneeR.rotation.x = pj.landKneeRBase + land * 0.4;
          hipL.rotation.x = pj.landHipL;
          hipR.rotation.x = pj.landHipR;
          shoulderR.rotation.x = pj.landShoulderR + land * 1.1;
          shoulderL.rotation.x = pj.landShoulderL + land * 0.1;
          elbowR.rotation.x = pj.landElbowR + land * 0.2;
          elbowL.rotation.x = pj.landElbowL + land * 0.1;
          shoulderL.rotation.z = 0;
        }

        // Torso/hip twist during jump
        {
          const torsoNode = this.group.getObjectByName('torso');
          const hipMeshNode = this.group.getObjectByName('hip-mesh');
          if (torsoNode && hipMeshNode) {
            if (progress < 0.3) {
              // Launch — twist from crouch
              const launch = progress / 0.3;
              hipMeshNode.rotation.y = pj.hipTwistLaunch * launch;
              torsoNode.rotation.y = pj.torsoTwistLaunch * launch;
            } else if (progress < 0.7) {
              // Hang — slight twist held
              hipMeshNode.rotation.y = pj.hipTwistLaunch;
              torsoNode.rotation.y = pj.torsoTwistLaunch;
            } else {
              // Land — untwist
              const land = (progress - 0.7) / 0.3;
              hipMeshNode.rotation.y = pj.hipTwistLaunch * (1 - land);
              torsoNode.rotation.y = pj.torsoTwistLaunch * (1 - land);
            }
          }
        }

        if (this.jumpTimer <= 0) {
          this.isJumping = false;
          this.jumpTimer = 0;
          this.group.position.y = 0;
        }
        break;
      }

      case 'sprint': {
        const t = this.animTime * animConfig.durations.sprintStride;
        const bounceT = this.animTime * animConfig.durations.sprintBounce;
        const bouncePhase = (Math.sin(bounceT) + 1) / 2;
        this.group.position.y = Math.pow(bouncePhase, 0.6) * animConfig.amplitudes.sprint.bounceHeight;

        const ps = animConfig.poses.sprint;
        const squashStretch = bouncePhase;
        bodyPivot.scale.set(
          1 + (1 - squashStretch) * ps.squashStretchAmount,
          1 - (1 - squashStretch) * ps.squashStretchAmount + squashStretch * ps.squashStretchAmount,
          1 + (1 - squashStretch) * ps.squashStretchAmount
        );

        bodyPivot.rotation.x = ps.bodyPivotRotX;

        const strideRaw = Math.sin(t);
        const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * animConfig.amplitudes.sprint.strideAmp;

        hipL.rotation.x = -stride;
        hipR.rotation.x = stride;
        kneeL.rotation.x = animConfig.amplitudes.sprint.kneeBase + Math.max(0, stride) * animConfig.amplitudes.sprint.kneeDrive;
        kneeR.rotation.x = animConfig.amplitudes.sprint.kneeBase + Math.max(0, -stride) * animConfig.amplitudes.sprint.kneeDrive;

        // Arms pump hard — elbows tight, fists driving
        shoulderL.rotation.x = stride * animConfig.amplitudes.sprint.shoulderSwing;
        shoulderR.rotation.x = -stride * animConfig.amplitudes.sprint.shoulderSwing;
        elbowL.rotation.x = -animConfig.amplitudes.sprint.elbowBend;
        elbowR.rotation.x = -animConfig.amplitudes.sprint.elbowBend;

        const torso = this.group.getObjectByName('torso');
        const hipMeshNode = this.group.getObjectByName('hip-mesh');
        if (torso && hipMeshNode) {
          hipMeshNode.rotation.y = stride * animConfig.amplitudes.sprint.hipTwist;
          torso.rotation.y = -stride * animConfig.amplitudes.sprint.torsoTwist;
        }
        break;
      }

      case 'dribble-sprint': {
        const t = this.animTime * animConfig.durations.dribbleSprintStride;
        const bounceT = this.animTime * animConfig.durations.dribbleSprintBounce;
        const bouncePhase = (Math.sin(bounceT) + 1) / 2;
        this.group.position.y = Math.pow(bouncePhase, 0.6) * animConfig.amplitudes.dribbleSprint.bounceHeight;

        const pds2 = animConfig.poses.dribbleSprint;
        const squashStretch = bouncePhase;
        bodyPivot.scale.set(
          1 + (1 - squashStretch) * pds2.squashStretchAmount,
          1 - (1 - squashStretch) * pds2.squashStretchAmount + squashStretch * pds2.squashStretchAmount,
          1 + (1 - squashStretch) * pds2.squashStretchAmount
        );

        bodyPivot.rotation.x = pds2.bodyPivotRotX;

        const strideRaw = Math.sin(t);
        const stride = Math.sign(strideRaw) * Math.pow(Math.abs(strideRaw), 0.7) * animConfig.amplitudes.dribbleSprint.strideAmp;

        hipL.rotation.x = -stride;
        hipR.rotation.x = stride;
        kneeL.rotation.x = animConfig.amplitudes.dribbleSprint.kneeBase + Math.max(0, stride) * animConfig.amplitudes.dribbleSprint.kneeSwing;
        kneeR.rotation.x = animConfig.amplitudes.dribbleSprint.kneeBase + Math.max(0, -stride) * animConfig.amplitudes.dribbleSprint.kneeSwing;

        // Compute dribble phase (0-1 cycle) — same speed as all dribble modes
        const dribbleSpeed = animConfig.durations.dribbleCycle; // Hz — cycles per second
        this.dribblePhase = (this.animTime * dribbleSpeed) % 1;

        // Arm synced with ball phase
        const armPhase = (this.dribblePhase + 0.75) % 1;
        let elbowBend: number;
        let shoulderPump: number;
        if (armPhase < 0.45) {
          // Arm up — ball in hand
          elbowBend = -0.5;
          shoulderPump = -0.2; // shoulder back (arm up/back)
        } else if (armPhase < 0.6) {
          // Arm pushes down — ball releasing
          const t = (armPhase - 0.45) / 0.15;
          elbowBend = -0.5 - t * 0.6; // -0.5 to -1.1
          shoulderPump = -0.2 - t * 0.4; // -0.2 to -0.6
        } else if (armPhase < 0.8) {
          // Arm at bottom — ball at floor
          elbowBend = -1.1;
          shoulderPump = -0.6; // shoulder most forward (arm reaching down)
        } else {
          // Arm returns up — ball rising
          const t = (armPhase - 0.8) / 0.2;
          elbowBend = -1.1 + t * 0.6; // -1.1 to -0.5
          shoulderPump = -0.6 + t * 0.4; // -0.6 to -0.2
        }

        // Right arm dribbles — phase-based with shoulder pump
        shoulderR.rotation.x = shoulderPump;
        elbowR.rotation.x = elbowBend;

        // Left arm pumps with stride
        shoulderL.rotation.x = stride * 0.5;
        shoulderL.rotation.z = pds2.leftArmShoulderZ;
        elbowL.rotation.x = pds2.leftArmElbow;

        const torso = this.group.getObjectByName('torso');
        const hipMeshNode = this.group.getObjectByName('hip-mesh');
        if (torso && hipMeshNode) {
          hipMeshNode.rotation.y = stride * pds2.hipTwistFactor;
          torso.rotation.y = -stride * pds2.torsoTwistFactor;
        }
        break;
      }

      case 'jump-block': {
        bodyPivot.scale.set(1, 1, 1);
        this.jumpTimer -= dt;
        const jumpDuration = animConfig.durations.jumpBlockDuration;
        const progress = 1 - (this.jumpTimer / jumpDuration);

        this.jumpHeight = Math.sin(progress * Math.PI) * animConfig.amplitudes.jumpBlock.apexHeight;
        this.group.position.y = this.jumpHeight;

        const pjb = animConfig.poses.jumpBlock;
        if (progress < 0.15) {
          // Crouch
          const crouch = progress / 0.15;
          bodyPivot.rotation.x = pjb.crouchBodyPivotRotX * crouch;
          kneeL.rotation.x = pjb.crouchKnee * crouch;
          kneeR.rotation.x = pjb.crouchKnee * crouch;
          hipL.rotation.x = pjb.crouchHip * crouch;
          hipR.rotation.x = pjb.crouchHip * crouch;
          shoulderL.rotation.x = pjb.crouchShoulder * crouch;
          shoulderR.rotation.x = pjb.crouchShoulder * crouch;
          elbowL.rotation.x = pjb.crouchElbow * crouch;
          elbowR.rotation.x = pjb.crouchElbow * crouch;
        } else if (progress < 0.3) {
          // Launch — BOTH arms shoot up
          const launch = (progress - 0.15) / 0.15;
          bodyPivot.rotation.x = pjb.crouchBodyPivotRotX - launch * 0.25;
          kneeL.rotation.x = pjb.crouchKnee * (1 - launch);
          kneeR.rotation.x = pjb.crouchKnee * (1 - launch);
          hipL.rotation.x = pjb.crouchHip * (1 - launch);
          hipR.rotation.x = pjb.crouchHip * (1 - launch);
          shoulderL.rotation.x = pjb.crouchShoulder - launch * pjb.launchShoulder;
          shoulderR.rotation.x = pjb.crouchShoulder - launch * pjb.launchShoulder;
          shoulderL.rotation.z = -launch * pjb.launchShoulderSpread;
          shoulderR.rotation.z = launch * pjb.launchShoulderSpread;
          elbowL.rotation.x = pjb.crouchElbow + launch * pjb.launchElbowDelta;
          elbowR.rotation.x = pjb.crouchElbow + launch * pjb.launchElbowDelta;
        } else if (progress < 0.7) {
          // Hang time — both arms up, wide spread like a wall
          bodyPivot.rotation.x = pjb.hangBodyPivotRotX;
          kneeL.rotation.x = pjb.hangKneeL;
          kneeR.rotation.x = pjb.hangKneeR;
          hipL.rotation.x = 0;
          hipR.rotation.x = 0;
          shoulderL.rotation.x = pjb.hangShoulderL;
          shoulderR.rotation.x = pjb.hangShoulderR;
          shoulderL.rotation.z = pjb.hangShoulderLZ;
          shoulderR.rotation.z = pjb.hangShoulderRZ;
          elbowL.rotation.x = pjb.hangElbowL;
          elbowR.rotation.x = pjb.hangElbowR;
        } else {
          // Land
          const land = (progress - 0.7) / 0.3;
          bodyPivot.rotation.x = pjb.hangBodyPivotRotX + land * 0.15;
          kneeL.rotation.x = pjb.hangKneeL + land * 0.5;
          kneeR.rotation.x = pjb.hangKneeR + land * 0.5;
          shoulderL.rotation.x = pjb.hangShoulderL + land * 2.6;
          shoulderR.rotation.x = pjb.hangShoulderR + land * 2.6;
          shoulderL.rotation.z = pjb.hangShoulderLZ + land * 0.4;
          shoulderR.rotation.z = pjb.hangShoulderRZ - land * 0.4;
          elbowL.rotation.x = pjb.hangElbowL;
          elbowR.rotation.x = pjb.hangElbowR;
        }

        // Torso/hip twist during jump-block (same as jump)
        {
          const torsoNode = this.group.getObjectByName('torso');
          const hipMeshNode = this.group.getObjectByName('hip-mesh');
          if (torsoNode && hipMeshNode) {
            if (progress < 0.3) {
              const launch = progress / 0.3;
              hipMeshNode.rotation.y = pjb.hipTwistLaunch * launch;
              torsoNode.rotation.y = pjb.torsoTwistLaunch * launch;
            } else if (progress < 0.7) {
              hipMeshNode.rotation.y = pjb.hipTwistLaunch;
              torsoNode.rotation.y = pjb.torsoTwistLaunch;
            } else {
              const land = (progress - 0.7) / 0.3;
              hipMeshNode.rotation.y = pjb.hipTwistLaunch * (1 - land);
              torsoNode.rotation.y = pjb.torsoTwistLaunch * (1 - land);
            }
          }
        }

        if (this.jumpTimer <= 0) {
          this.isJumping = false;
          this.jumpTimer = 0;
          this.group.position.y = 0;
        }
        break;
      }

      case 'fall': {
        bodyPivot.scale.set(1, 1, 1);
        const fallDuration = animConfig.durations.fallDuration;
        const progress = 1 - (this.fallTimer / fallDuration);

        const pf = animConfig.poses.fall;
        if (progress < 0.4) {
          // Stagger back
          const stagger = progress / 0.4;
          bodyPivot.rotation.x = pf.staggerBodyPivotRotX * stagger;
          bodyPivot.rotation.z = pf.staggerBodyPivotRotZ * stagger;
          this.group.position.y = 0;
          // Arms flail
          shoulderL.rotation.x = pf.staggerShoulderLRotX * stagger;
          shoulderL.rotation.z = pf.staggerShoulderLRotZ * stagger;
          shoulderR.rotation.x = pf.staggerShoulderRRotX * stagger;
          shoulderR.rotation.z = pf.staggerShoulderRRotZ * stagger;
          elbowL.rotation.x = pf.staggerElbowL;
          elbowR.rotation.x = pf.staggerElbowR;
          // Legs buckle
          kneeL.rotation.x = pf.staggerKneeL * stagger;
          kneeR.rotation.x = pf.staggerKneeR * stagger;
          hipL.rotation.x = pf.staggerHipL * stagger;
          hipR.rotation.x = pf.staggerHipR * stagger;
        } else if (progress < 0.7) {
          // Hit the ground
          const ground = (progress - 0.4) / 0.3;
          bodyPivot.rotation.x = pf.staggerBodyPivotRotX + ground * pf.groundBodyPivotRotX;
          bodyPivot.rotation.z = pf.staggerBodyPivotRotZ;
          this.group.position.y = ground * pf.groundPosY;
          shoulderL.rotation.x = pf.staggerShoulderLRotX + ground * pf.groundShoulderLRotX;
          shoulderL.rotation.z = pf.staggerShoulderLRotZ + ground * pf.groundShoulderLRotZ;
          shoulderR.rotation.x = pf.staggerShoulderRRotX;
          shoulderR.rotation.z = pf.staggerShoulderRRotZ + ground * pf.groundShoulderRRotZ;
          elbowL.rotation.x = pf.groundElbowL;
          elbowR.rotation.x = pf.groundElbowR;
          kneeL.rotation.x = pf.staggerKneeL + ground * pf.groundKneeL;
          kneeR.rotation.x = pf.groundKneeR;
        } else {
          // Lying on ground
          bodyPivot.rotation.x = pf.lyingBodyPivotRotX;
          bodyPivot.rotation.z = pf.lyingBodyPivotRotZ;
          this.group.position.y = pf.lyingPosY;
          shoulderL.rotation.x = pf.lyingShoulderL;
          shoulderL.rotation.z = pf.lyingShoulderLZ;
          shoulderR.rotation.x = pf.lyingShoulderR;
          shoulderR.rotation.z = pf.lyingShoulderRZ;
          elbowL.rotation.x = pf.lyingElbowL;
          elbowR.rotation.x = pf.lyingElbowR;
          kneeL.rotation.x = pf.lyingKneeL;
          kneeR.rotation.x = pf.lyingKneeR;
        }

        if (this.fallTimer <= 0) {
          this.fallTimer = 0;
          this.group.position.y = 0;
        }
        break;
      }

      case 'dunk': {
        bodyPivot.scale.set(1, 1, 1);
        const dunkDuration = animConfig.durations.dunkDuration;
        const progress = 1 - (this.dunkTimer / dunkDuration);

        // Height curve — feet at apexHeight means hand reaches ~3.2 (rim height).
        // Phase boundaries (0.15/0.45/0.65/0.85) are structural timing ratios
        // shared across the dunk state's pose code; only the apex height varies.
        const dunkApex = animConfig.amplitudes.dunk.apexHeight;
        let height: number;
        if (progress < 0.15) {
          height = (progress / 0.15) * dunkApex; // quick rise
        } else if (progress < 0.45) {
          height = dunkApex; // hang at peak (includes slam)
        } else if (progress < 0.65) {
          height = dunkApex; // still at rim height during hang
        } else if (progress < 0.85) {
          const drop = (progress - 0.65) / 0.2;
          height = dunkApex * (1 - drop); // drop to ground
        } else {
          height = 0; // on ground
        }
        this.group.position.y = height;

        // Reset arm scale for non-rim-hang phases
        {
          const upperArmR = this.group.getObjectByName('upper-arm-right');
          const forearmR = this.group.getObjectByName('forearm-right');
          if (progress < 0.45 || progress >= 0.65) {
            if (upperArmR) upperArmR.scale.set(1, 1, 1);
            if (forearmR) forearmR.scale.set(1, 1, 1);
          }
        }

        const pdk = animConfig.poses.dunk;
        if (progress < 0.15) {
          // RISE: crouch extends, legs start spreading, arms bring ball up
          const rise = progress / 0.15;
          bodyPivot.rotation.x = pdk.riseBodyPivotRotX * (1 - rise);
          kneeL.rotation.x = pdk.riseKneeLStart * (1 - rise) + pdk.riseKneeLEnd * rise;
          kneeR.rotation.x = pdk.riseKneeRStart * (1 - rise) + pdk.riseKneeREnd * rise;
          hipL.rotation.x = pdk.riseHipL * rise;
          hipR.rotation.x = pdk.riseHipR * rise;
          hipL.rotation.z = pdk.riseHipLZ * rise;
          hipR.rotation.z = pdk.riseHipRZ * rise;
          shoulderR.rotation.x = rise * pdk.riseShoulderR;
          shoulderL.rotation.x = rise * pdk.riseShoulderL;
          elbowR.rotation.x = pdk.riseElbowR * (1 - rise);
          elbowL.rotation.x = pdk.riseElbowL * (1 - rise);
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
        } else if (progress < 0.35) {
          // HANG TIME: MJ pose — RIGHT arm stretches UP with ball, getting bigger
          const hangT = (progress - 0.15) / 0.2;
          bodyPivot.rotation.x = pdk.hangBodyPivotRotX;
          shoulderR.rotation.x = pdk.hangShoulderRBase + hangT * pdk.hangShoulderROffset;
          elbowR.rotation.x = pdk.hangElbowR;
          shoulderL.rotation.x = pdk.hangShoulderL;
          shoulderL.rotation.z = pdk.hangShoulderLZ;
          elbowL.rotation.x = pdk.hangElbowL;
          shoulderR.rotation.z = 0;
          const armScale = 1 + hangT * animConfig.amplitudes.dunk.armScalePeak;
          const upperArmR = this.group.getObjectByName('upper-arm-right');
          const forearmR = this.group.getObjectByName('forearm-right');
          if (upperArmR) upperArmR.scale.set(armScale, armScale * animConfig.amplitudes.dunk.armThickness, armScale);
          if (forearmR) forearmR.scale.set(armScale * animConfig.amplitudes.dunk.armThickness, armScale * 1.2, armScale * animConfig.amplitudes.dunk.armThickness);
          kneeL.rotation.x = pdk.hangKneeL;
          kneeR.rotation.x = pdk.hangKneeR;
          hipL.rotation.x = pdk.hangHipL;
          hipR.rotation.x = pdk.hangHipR;
          hipL.rotation.z = pdk.hangHipLZ;
          hipR.rotation.z = pdk.hangHipRZ;
        } else if (progress < 0.45) {
          // SLAM: arms drive down, body curls forward
          const slam = (progress - 0.35) / 0.1;
          bodyPivot.rotation.x = pdk.slamBodyPivotRotXBase + slam * pdk.slamBodyPivotRotXSwing;
          shoulderR.rotation.x = pdk.slamShoulderRBase + slam * pdk.slamShoulderRSwing;
          shoulderL.rotation.x = pdk.slamShoulderLBase + slam * pdk.slamShoulderLSwing;
          elbowR.rotation.x = pdk.slamElbowRBase + slam * pdk.slamElbowRSwing;
          elbowL.rotation.x = pdk.slamElbowLBase + slam * pdk.slamElbowLSwing;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          kneeL.rotation.x = pdk.slamKneeLBase + slam * pdk.slamKneeLSwing;
          kneeR.rotation.x = pdk.slamKneeRBase + slam * pdk.slamKneeRSwing;
          hipL.rotation.x = pdk.slamHipLBase + slam * pdk.slamHipLSwing;
          hipR.rotation.x = pdk.slamHipRBase + slam * pdk.slamHipRSwing;
          hipL.rotation.z = pdk.hangHipLZ * (1 - slam);
          hipR.rotation.z = pdk.hangHipRZ * (1 - slam);
        } else if (progress < 0.65) {
          // RIM HANG: one arm up (hanging on rim), legs dangle, slight sway
          shoulderR.rotation.x = pdk.rimHangShoulderR;
          elbowR.rotation.x = pdk.rimHangElbowR;
          shoulderL.rotation.x = pdk.rimHangShoulderL;
          elbowL.rotation.x = pdk.rimHangElbowL;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          kneeL.rotation.x = pdk.rimHangKneeL;
          kneeR.rotation.x = pdk.rimHangKneeR;
          hipL.rotation.x = pdk.rimHangHipL;
          hipR.rotation.x = pdk.rimHangHipR;
          hipL.rotation.z = 0;
          hipR.rotation.z = 0;
          bodyPivot.rotation.x = 0;
          const sway = (progress - 0.45) / 0.2;
          bodyPivot.rotation.z = Math.sin(sway * Math.PI * 2) * pdk.rimHangSwayAmp;

          const upperArmR = this.group.getObjectByName('upper-arm-right');
          const forearmR = this.group.getObjectByName('forearm-right');
          if (upperArmR) upperArmR.scale.set(animConfig.amplitudes.dunk.rimHangArmScaleU, animConfig.amplitudes.dunk.rimHangArmScaleF, animConfig.amplitudes.dunk.rimHangArmScaleU);
          if (forearmR) forearmR.scale.set(animConfig.amplitudes.dunk.rimHangArmScaleF, animConfig.amplitudes.dunk.rimHangArmScaleF + 0.1, animConfig.amplitudes.dunk.rimHangArmScaleF);
        } else if (progress < 0.85) {
          // DROP FROM RIM: fall to ground
          const drop = (progress - 0.65) / 0.2;
          bodyPivot.rotation.x = pdk.dropBodyPivotRotXFactor * drop;
          bodyPivot.rotation.z = 0;
          shoulderR.rotation.x = pdk.dropShoulderRFrom + drop * pdk.dropShoulderRDelta;
          shoulderL.rotation.x = pdk.dropShoulderLFrom + drop * pdk.dropShoulderLDelta;
          elbowR.rotation.x = pdk.dropElbowRFrom + drop * pdk.dropElbowRDelta;
          elbowL.rotation.x = pdk.dropElbowLFrom + drop * pdk.dropElbowLDelta;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          kneeL.rotation.x = pdk.dropKneeLFrom + drop * pdk.dropKneeLDelta;
          kneeR.rotation.x = pdk.dropKneeRFrom + drop * pdk.dropKneeRDelta;
          hipL.rotation.x = pdk.rimHangHipL;
          hipR.rotation.x = pdk.rimHangHipR;
          hipL.rotation.z = 0;
          hipR.rotation.z = 0;
        } else {
          // DRAMATIC LANDING: deep knee bend, right foot forward, left behind, slowly stand
          const land = (progress - 0.85) / 0.15;
          bodyPivot.rotation.x = pdk.landBodyPivotRotX * (1 - land);
          bodyPivot.rotation.z = 0;
          hipR.rotation.x = pdk.landHipR;
          hipL.rotation.x = pdk.landHipL;
          kneeR.rotation.x = pdk.landKneeR * (1 - land * 0.5);
          kneeL.rotation.x = pdk.landKneeL * (1 - land * 0.5);
          shoulderR.rotation.x = pdk.landShoulderR;
          shoulderL.rotation.x = pdk.landShoulderL;
          elbowR.rotation.x = pdk.landElbowR;
          elbowL.rotation.x = pdk.landElbowL;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          hipL.rotation.z = 0;
          hipR.rotation.z = 0;
        }

        // Torso/hip twist during dunk — bigger twist for drama
        {
          const torsoNode = this.group.getObjectByName('torso');
          const hipMeshNode = this.group.getObjectByName('hip-mesh');
          if (torsoNode && hipMeshNode) {
            const hipTw = animConfig.amplitudes.dunk.hipTwist;
            const torsoTw = animConfig.amplitudes.dunk.torsoTwist;
            const slamThru = animConfig.amplitudes.dunk.slamTwistThrough;
            if (progress < 0.15) {
              const rise = progress / 0.15;
              hipMeshNode.rotation.y = hipTw * rise;
              torsoNode.rotation.y = -torsoTw * rise;
            } else if (progress < 0.35) {
              hipMeshNode.rotation.y = hipTw;
              torsoNode.rotation.y = -torsoTw;
            } else if (progress < 0.45) {
              const slam = (progress - 0.35) / 0.1;
              hipMeshNode.rotation.y = hipTw - slam * slamThru;
              torsoNode.rotation.y = -torsoTw + slam * (slamThru - 0.15);
            } else if (progress < 0.65) {
              hipMeshNode.rotation.y = -(hipTw + slamThru - hipTw); // -0.3 at defaults
              torsoNode.rotation.y = torsoTw + 0.05; // 0.2 at defaults
            } else {
              const recover = progress < 0.85 ? (progress - 0.65) / 0.2 : 1;
              hipMeshNode.rotation.y = -0.3 * (1 - recover);
              torsoNode.rotation.y = 0.2 * (1 - recover);
            }
          }
        }

        // Move toward hoop during rise and hang phases (progress < 0.45)
        if (this.dunkTarget && progress < 0.45) {
          const dx = this.dunkTarget.x - this.group.position.x;
          const dz = this.dunkTarget.z - this.group.position.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > animConfig.amplitudes.dunk.approachDist) {
            const speed = animConfig.amplitudes.dunk.approachSpeed; // fast lunge
            const step = Math.min(speed * dt, dist);
            this.group.position.x += (dx / dist) * step;
            this.group.position.z += (dz / dist) * step;
            // Face the hoop
            this.group.rotation.y = Math.atan2(dx, dz);
          }
        }

        if (this.dunkTimer <= 0) {
          this.dunkTimer = 0;
          this.group.position.y = 0;
          this.dunkTarget = null;
        }
        break;
      }

      case 'pass': {
        bodyPivot.scale.set(1, 1, 1);
        const passDuration = animConfig.durations.passDuration;
        const progress = 1 - (this.passTimer / passDuration);

        const pp = animConfig.poses.pass;
        if (progress < 0.25) {
          // PULL IN: both hands come together at chest, pull ball toward body
          const pull = progress / 0.25;
          shoulderR.rotation.x = pp.pullShoulderR * pull;
          shoulderL.rotation.x = pp.pullShoulderL * pull;
          shoulderR.rotation.z = pp.pullShoulderRZ * pull;
          shoulderL.rotation.z = pp.pullShoulderLZ * pull;
          elbowR.rotation.x = pp.pullElbowR * pull;
          elbowL.rotation.x = pp.pullElbowL * pull;
          bodyPivot.rotation.x = pp.pullBodyPivotRotX * pull;
        } else if (progress < 0.5) {
          // THROW: both arms thrust forward together, extending
          const push = (progress - 0.25) / 0.25;
          shoulderR.rotation.x = pp.pullShoulderR + push * pp.throwShoulderR;
          shoulderL.rotation.x = pp.pullShoulderL + push * pp.throwShoulderL;
          shoulderR.rotation.z = pp.pullShoulderRZ + push * pp.throwShoulderRZ;
          shoulderL.rotation.z = pp.pullShoulderLZ + push * pp.throwShoulderLZ;
          elbowR.rotation.x = pp.pullElbowR + push * pp.throwElbowR;
          elbowL.rotation.x = pp.pullElbowL + push * pp.throwElbowL;
          bodyPivot.rotation.x = pp.pullBodyPivotRotX + push * pp.throwBodyPivotRotX;
          hipR.rotation.x = pp.throwHipR * push;
          kneeR.rotation.x = pp.throwKneeR * push;
        } else {
          // FOLLOW THROUGH: arms stay extended briefly, then return
          const recover = (progress - 0.5) / 0.5;
          shoulderR.rotation.x = pp.ftShoulderRBase + recover * pp.ftShoulderRSwing;
          shoulderL.rotation.x = pp.ftShoulderLBase + recover * pp.ftShoulderLSwing;
          shoulderR.rotation.z = 0;
          shoulderL.rotation.z = 0;
          elbowR.rotation.x = -0.1;
          elbowL.rotation.x = -0.1;
          bodyPivot.rotation.x = pp.ftBodyPivotRotX * (1 - recover);
          hipR.rotation.x = pp.ftHipR * (1 - recover);
          kneeR.rotation.x = pp.ftKneeR * (1 - recover);
        }
        hipL.rotation.x = pp.hipL;
        kneeL.rotation.x = pp.kneeL;
        break;
      }
    }

    // Hide block screen when not guarding
    if (this.animState !== 'guard') {
      const screen = this.group.getObjectByName('block-screen');
      if (screen) screen.visible = false;
    }

    // Reset shoulder Z rotation if not in dribble/guard/steal/jump/jump-block/dunk/dribble-sprint/fall/pass
    if (this.animState !== 'dribble' && this.animState !== 'guard' && this.animState !== 'steal' && this.animState !== 'jump' && this.animState !== 'jump-block' && this.animState !== 'dunk' && this.animState !== 'dribble-sprint' && this.animState !== 'fall' && this.animState !== 'pass') {
      shoulderL.rotation.z = 0;
      shoulderR.rotation.z = 0;
    }

    // Reset body twist if not stealing
    if (this.animState !== 'steal') {
      bodyPivot.rotation.y = 0;
    }

    // Reset body tilt if not falling or dunking
    if (this.animState !== 'fall' && this.animState !== 'dunk') {
      bodyPivot.rotation.z = 0;
    }

    // Reset forearm scale if not stealing and not dunking
    if (this.animState !== 'steal' && this.animState !== 'dunk') {
      const forearmR = this.group.getObjectByName('forearm-right');
      if (forearmR) forearmR.scale.set(1, 1, 1);
    }

    // Reset upper arm scale if not dunking
    if (this.animState !== 'dunk') {
      const upperArmR = this.group.getObjectByName('upper-arm-right');
      if (upperArmR) upperArmR.scale.set(1, 1, 1);
    }

    // Reset hip Z spread if not dunking
    if (this.animState !== 'dunk') {
      hipL.rotation.z = 0;
      hipR.rotation.z = 0;
    }

    // Reset torso/hip twist for non-locomotion states (exclude states that handle their own twist)
    if (this.animState !== 'walk' && this.animState !== 'sprint' && this.animState !== 'dribble' && this.animState !== 'dribble-sprint' && this.animState !== 'shoot' && this.animState !== 'jump' && this.animState !== 'jump-block' && this.animState !== 'dunk') {
      const torsoNode = this.group.getObjectByName('torso');
      const hipMeshNode = this.group.getObjectByName('hip-mesh');
      if (torsoNode) torsoNode.rotation.y = 0;
      if (hipMeshNode) hipMeshNode.rotation.y = 0;
    }

    // State transition blending (anticipation + follow-through)
    if (this.stateTransitionTimer > 0) {
      const blend = smoothstep(1 - this.stateTransitionTimer / this.STATE_BLEND_DURATION);
      shoulderL.rotation.x = this.lastShoulderL + (shoulderL.rotation.x - this.lastShoulderL) * blend;
      shoulderR.rotation.x = this.lastShoulderR + (shoulderR.rotation.x - this.lastShoulderR) * blend;
    }

    // ── G3: Beer-hand (left arm) lock ────────────────────────────────────
    // Hold the left arm at a fixed pose so the beer doesn't swing during
    // walk/run/dribble/pass. Positioned AFTER the per-state switch, AFTER
    // the post-switch Z-reset, AND AFTER the state-transition blend so the
    // lock has the final word — nothing later in animate() touches the
    // left shoulder/elbow rotations.
    //
    // Note on transition blend: `lastShoulderL` was captured at the top of
    // animate() BEFORE this block ran, so transitioning INTO a locked state
    // lerps from prev-state's swing into the lock value. Since both the
    // pre-blend and post-blend values are then overwritten by the lock,
    // the lerp is effectively a no-op for left shoulder X — desirable
    // (no flicker; the lock simply pins the arm immediately).
    //
    // The bodyPivot rotation rotates the entire upper body INCLUDING the
    // locked arm, so the beer leans with the body lean (correct anatomy:
    // beer doesn't swing relative to torso).
    //
    // dribble + pass are intentionally NOT exempt: dribble per user request
    // (locked even while dribbling); pass because the right arm throws and
    // the left should keep holding the beer.
    const bh = animConfig.poses.beerHold;
    // DevTools override: window.__beerHoldEnabled, when defined, wins.
    const lockEnabled =
      typeof window !== 'undefined' && typeof window.__beerHoldEnabled === 'boolean'
        ? window.__beerHoldEnabled
        : bh.enabled;
    if (lockEnabled && !bh.exemptStates.includes(this.animState)) {
      shoulderL.rotation.set(bh.shoulderX, 0, bh.shoulderZ);
      elbowL.rotation.set(bh.elbow, 0, 0);
    }

    // Secondary motion: head counter-rotates slightly against body lean
    const neckGroup = this.group.getObjectByName('neck-group');
    if (neckGroup) {
      if (isMoving) {
        neckGroup.rotation.x = -bodyPivot.rotation.x * 0.3;
      } else {
        neckGroup.rotation.x = 0;
      }
    }

    // Hair bounce with slight delay from body (use stored rest position, never accumulate)
    const hair = this.group.getObjectByName('hair');
    if (hair) {
      if (this.hairRestY === undefined) this.hairRestY = hair.position.y;
      if (isMoving) {
        // Tiny bounce synced with walk — hair is attached to the head, minimal independent motion
        hair.position.y = this.hairRestY + Math.sin(this.animTime * 10 - 0.4) * 0.008;
      } else {
        hair.position.y = this.hairRestY;
      }
    }

    this.lastMoving = isMoving;
  }

  private forcedAnimState: string | null = null;

  forceAnimState(state: 'idle' | 'walk' | 'sprint' | 'dribble' | 'dribble-sprint' | 'guard' | 'steal' | 'shoot' | 'jump' | 'jump-block' | 'fall' | 'dunk' | 'pass' | null): void {
    this.forcedAnimState = state;
  }

  triggerSteal(): void {
    this.stealTimer = 0.6; // longer for wind-up + pause + swipe
  }

  triggerShoot(): void {
    this.shootTimer = 0.4;
  }

  triggerGuard(): void {
    this.isGuarding = true;
    this.guardTimer = 1.0;
    this.animState = 'guard';
    this.animTime = 0;
  }

  triggerFall(): void {
    this.fallTimer = 0.8;
  }

  triggerDunk(target?: { x: number; z: number }): void {
    this.dunkTimer = 1.2; // longer for hang + dramatic landing
    this.dunkTarget = target ?? null;
  }

  get isDunking(): boolean {
    return this.dunkTimer > 0;
  }

  triggerPass(): void {
    this.passTimer = 0.35;
  }

  jump(): void {
    if (this.isJumping) return;
    this.isJumping = true;
    this.jumpTimer = 0.6;
    this.jumpHeight = 0;
  }

  moveToward(target: THREE.Vector3, dt: number): void {
    const direction = new THREE.Vector3().subVectors(target, this.group.position);
    direction.y = 0;
    const distance = direction.length();
    if (distance < 0.1) {
      this.velocity.set(0, 0, 0);
      this.animate(dt);
      return;
    }

    direction.normalize();
    const step = this.moveSpeed * dt;
    const actualStep = Math.min(step, distance);
    this.velocity.copy(direction).multiplyScalar(actualStep / dt);
    this.group.position.addScaledVector(direction, actualStep);

    // Clamp to court bounds (same as moveByInput)
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -7, 7);
    this.group.position.z = THREE.MathUtils.clamp(
      this.group.position.z,
      GamePlayer.courtBoundsZ[0],
      GamePlayer.courtBoundsZ[1]
    );

    if (this.isHumanControlled) {
      // Human stays instant-turn for responsive feel.
      const angle = Math.atan2(direction.x, direction.z);
      this.group.rotation.y = angle;
    }
    // AI rotation is owned by GameSession.updateAIFacing() which lerps smoothly.
    // Skipping the instant-snap write here avoids fighting that lerp (which
    // otherwise produces per-frame rotation flicker when the AI target moves).

    this.animate(dt);
  }

  recordStat(stat: 'points' | 'assists' | 'turnovers', value: number): void {
    this.stats[stat] += value;
  }

  get performanceScore(): number {
    return this.stats.points + this.stats.assists - this.stats.turnovers;
  }

  resetStats(): void {
    this.stats = { points: 0, assists: 0, turnovers: 0 };
  }

  giveBall(): void {
    this.hasBall = true;
  }

  loseBall(): void {
    this.hasBall = false;
  }

  moveByInput(inputX: number, inputZ: number, dt: number): void {
    if (inputX === 0 && inputZ === 0) {
      this.velocity.set(0, 0, 0);
      this.animate(dt);
      return;
    }
    const direction = new THREE.Vector3(inputX, 0, inputZ).normalize();
    const speed = this.isSprinting ? this.moveSpeed * 2.0 : this.moveSpeed;
    const step = speed * dt;
    this.velocity.copy(direction).multiplyScalar(step / dt);
    this.group.position.addScaledVector(direction, step);

    // Clamp to court bounds
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -7, 7);
    this.group.position.z = THREE.MathUtils.clamp(
      this.group.position.z,
      GamePlayer.courtBoundsZ[0],
      GamePlayer.courtBoundsZ[1]
    );

    // Face movement direction
    const angle = Math.atan2(direction.x, direction.z);
    this.group.rotation.y = angle;

    this.animate(dt);
  }

  distanceTo(point: THREE.Vector3): number {
    const dx = this.group.position.x - point.x;
    const dz = this.group.position.z - point.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }
}
