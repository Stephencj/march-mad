/**
 * Phase B — Procedural face features.
 *
 * Mounts alongside the existing canonical-mesh face renderer (mesh-builder
 * produces a 478-vertex `BuiltFaceMesh`; the blendshape-puppet mutates that
 * mesh's `geometry.attributes.position` per frame). Instead of replacing the
 * canonical mesh, this module treats the mesh as a *hidden landmark anchor
 * system*: it reads the deformed landmark positions every frame and rebuilds
 * lightweight procedural geometry for major facial features — eyelids,
 * eyebrows, nose, lips.
 *
 * Phase B default: BOTH the canonical mesh AND these procedural features
 * render simultaneously, so a developer can compare them side-by-side. The
 * `window.__faceMode` global toggles which side is visible:
 *
 *   window.__faceMode = 'mesh'        // only canonical mesh
 *   window.__faceMode = 'procedural'  // only procedural features
 *   window.__faceMode = 'both'        // both (default)
 *
 * Phase D will flip the default to 'procedural' once the architecture is
 * verified.
 *
 * --- Animation strategy ---
 *
 * Each procedural feature stores a list of canonical-landmark indices. At
 * construction time we read the rest landmark positions from
 * `built.mesh.geometry.attributes.position` (a Float32Array indexed by
 * canonical landmark idx, 478 verts × 3 floats). At update time we re-read
 * the now-deformed positions and rewrite the procedural geometry's
 * `position` attribute. The blendshape-puppet's existing per-vertex
 * displacements (eyeBlinkLeft moves landmarks 159/158/etc downward, jawOpen
 * pulls the lower-lip ring down, etc.) are inherited "for free" — we never
 * see the blendshape coefficients ourselves, only the resulting positions.
 *
 * --- Performance ---
 *
 * Per-frame work per face:
 *   - 4 eyelid rebuilds (8 verts each) ≈ 32 verts
 *   - 2 brow rebuilds (10 verts each) ≈ 20 verts
 *   - 2 lip rebuilds (~22 verts each) ≈ 44 verts
 *   - Nose: static, no rebuild
 * Total ≈ 96 verts × 3 floats per face per frame. At 6 players that's <2k
 * float writes per frame — trivial.
 *
 * Module-level caches share whatever can be shared safely:
 *   - Skin-tone material per RGB color (used by eyelids + nose)
 *   - Brow material per RGB color
 *   - Lip material per RGB color
 *   - Nose geometry — single shared shape (the user's nose silhouette is
 *     not encoded anywhere yet; Phase C will add per-face sampled features)
 *
 * Geometries that DO encode the user's face shape (eyelids, brows, lips)
 * cannot be shared across players — each face has its own buffer.
 */
import * as THREE from 'three';
import type { BuiltFaceMesh } from './mesh-builder';
import type { BeardRegion } from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ProceduralFaceOptions {
  /** When false (Phase B default), procedural features are built but the
   *  canonical mesh stays visible alongside. `window.__faceMode='procedural'`
   *  flips both — canonical hides, procedural shows. Phase D flips this. */
  hideCanonical?: boolean;
}

// ---------------------------------------------------------------------------
// Phase D — sampled-feature application
// ---------------------------------------------------------------------------

/** Phase 8.5 eye-shape data — per-side openness + curve fits. The v1 D-phase
 *  consumer only uses `opennessRatio` to scale the lid strip's vertical
 *  extent at construction. Curves are accepted in the interface so callers
 *  can pre-bundle the full sampled record without losing data, but the v1
 *  builder ignores them — Phase E may add parabolic curve fitting if the
 *  openness-only proxy reads as too coarse. */
export interface EyeShapeData {
  upperCurve: [number, number, number];
  lowerCurve: [number, number, number];
  opennessRatio: number;
}

export interface ProceduralFaceFeatures {
  /** Override the default skin-tone material on eyelids + nose. */
  skinTone?: number;
  /** Lip colors (upper, lower) — replaces the dusky-red default. */
  lipColor?: { upper: number; lower: number };
  /** Brow colors — replaces dark brown default. Per side. */
  browColors?: { left: number; right: number };
  /** Brow intensity 0..1 — controls visual prominence. Faint brows render
   *  thinner; thick brows render thicker. */
  browIntensity?: { left: number; right: number };
  /** Eye-shape curve params. v1 only consumes opennessRatio — used to scale
   *  the lid strip's vertical extent at construction. Full curves stored
   *  for forward-compat. */
  eyeShape?: { left?: EyeShapeData; right?: EyeShapeData };
  /** Nose proportion ratios — scale the nose mesh on each axis (1.0 = the
   *  rest landmark layout exactly). */
  noseShape?: { lengthRatio: number; widthRatio: number; protrusionRatio: number };
  /** Phase E: eyelash detection. When `prominent === true` and a `color`
   *  is supplied, the procedural face builds two upper-lid lash strips that
   *  ride the lid mesh as children. Absent / `prominent === false` skips
   *  construction entirely (no hidden meshes). */
  eyelashes?: { prominent: boolean; color: number; confidence?: number };
  /** Phase E: per-region beard density + color. Only regions with
   *  `density > BEARD_DENSITY_THRESHOLD` (0.15) build a mesh; quieter regions
   *  skip allocation entirely. */
  beard?: Partial<Record<BeardRegion, { hairColor?: number; density: number }>>;
}

/** Phase D — extension fields that travel alongside `ProceduralFaceFeatures`
 *  but are consumed by `GamePlayer.setFaceMesh3D` (not `createProceduralFace`):
 *    - `hair`: hair-style override + color → drives `setFaceHairOverride`.
 *    - `hat`: procedural hat → drives `setFaceHat`.
 *    - `bodySkinTone`: optional override for the body skin (head sphere /
 *      neck / forearms / lower legs). When omitted falls back to
 *      `skinTone` (same value used by the procedural eyelids/nose), so a
 *      single sampled forehead patch tints face + body uniformly.
 */
export interface ProceduralFaceApplyExtension {
  hair?: {
    style: 'bald' | 'receding' | 'flat-top' | 'afro' | 'mohawk' | 'headband';
    color: number;
  };
  hat?: { type: 'cap-forward' | 'cap-backward' | 'beanie'; color: number };
  bodySkinTone?: number;
}

/** Phase D — bundle a `FaceImage.mesh3d` payload (Phase C sampler output)
 *  into the shape `setFaceMesh3D` accepts as its 5th positional arg. Each
 *  field is independently optional — old saves missing some/all of these
 *  sampled fields fall through to procedural-face defaults. Returns
 *  `undefined` when nothing on the input would change behavior, so callers
 *  can pass through cleanly without forcing a no-op apply. */
export function bundleFaceFeatures(
  mesh3d: {
    skinTone?: number;
    lipColor?: { upper: number; lower: number };
    brows?: {
      left: { color: number; intensity: number };
      right: { color: number; intensity: number };
    };
    eyeShape?: {
      left?: EyeShapeData;
      right?: EyeShapeData;
    };
    noseShape?: { lengthRatio: number; widthRatio: number; protrusionRatio: number };
    hair?: {
      style: 'bald' | 'receding' | 'flat-top' | 'afro' | 'mohawk' | 'headband';
      color: number;
    };
    hat?: { detected: true; type: 'cap-forward' | 'cap-backward' | 'beanie'; color: number };
    eyelashes?: { prominent: boolean; color: number; confidence?: number };
    beard?: Partial<Record<BeardRegion, { hairColor?: number; density: number }>>;
  } | undefined,
): (ProceduralFaceFeatures & ProceduralFaceApplyExtension) | undefined {
  if (!mesh3d) return undefined;
  const out: ProceduralFaceFeatures & ProceduralFaceApplyExtension = {};
  if (typeof mesh3d.skinTone === 'number') out.skinTone = mesh3d.skinTone;
  if (mesh3d.lipColor) out.lipColor = mesh3d.lipColor;
  if (mesh3d.brows) {
    out.browColors = { left: mesh3d.brows.left.color, right: mesh3d.brows.right.color };
    out.browIntensity = {
      left: mesh3d.brows.left.intensity,
      right: mesh3d.brows.right.intensity,
    };
  }
  if (mesh3d.eyeShape) out.eyeShape = mesh3d.eyeShape;
  if (mesh3d.noseShape) out.noseShape = mesh3d.noseShape;
  if (mesh3d.hair) out.hair = mesh3d.hair;
  if (mesh3d.hat) out.hat = { type: mesh3d.hat.type, color: mesh3d.hat.color };
  // Phase E: eyelashes only travel through when `prominent === true`. A
  // false flag is equivalent to "not detected" — the procedural face skips
  // construction either way, but threading false through wastes a feature
  // slot that could otherwise stay undefined.
  if (mesh3d.eyelashes && mesh3d.eyelashes.prominent) {
    out.eyelashes = {
      prominent: true,
      color: mesh3d.eyelashes.color,
      confidence: mesh3d.eyelashes.confidence,
    };
  }
  // Phase E: forward the beard map verbatim. Density-based filtering happens
  // inside createProceduralFace (per-region, so the cost-zero path for a
  // clean-shaven face is preserved).
  if (mesh3d.beard) out.beard = mesh3d.beard;
  // Body skin defaults to the same sampled forehead skin tone — a single
  // sampled patch should tint face + body uniformly (Phase D v1 doesn't
  // sample neck/arm patches separately).
  if (typeof mesh3d.skinTone === 'number') out.bodySkinTone = mesh3d.skinTone;
  // If every field was undefined, return undefined so the caller can skip
  // a no-op `features` argument.
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Phase E: minimal contract the procedural face uses to read smoothed
 *  blendshape coefficients (currently `jawOpen` for teeth/tongue
 *  visibility). Wider than `FacePuppet` so unit tests can supply a stub. */
export interface BlendshapeSource {
  getSmoothedValue(name: string): number;
}

export interface ProceduralFace {
  /** Container Object3D — mount this in the face-mesh-3d slot as a sibling
   *  of `built.mesh`. */
  group: THREE.Group;
  /** Per-frame: read deformed landmark positions from the canonical mesh and
   *  update procedural feature geometries. Cheap (~96 vert writes per face). */
  update(): void;
  /** Toggle visibility on the procedural side. Pair with the canonical
   *  mesh's visibility for the dev side-by-side mode. */
  setVisible(v: boolean): void;
  /** Phase E: hand the procedural face a reference to the live puppet so it
   *  can read smoothed `jawOpen` to toggle teeth/tongue visibility. Pass
   *  `null` to detach (e.g. when stopping live mirror). Without a source,
   *  the conditional features stay hidden. */
  setBlendshapeSource(src: BlendshapeSource | null): void;
  /** Dispose all per-instance geometries + materials owned by this instance.
   *  Shared module-level resources (nose geometry, color-keyed materials)
   *  survive — they're safe to keep around for the next face. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Default colors (Phase B v1 — Phase D will sample from the photo per-face)
// ---------------------------------------------------------------------------

/** Default skin tone for eyelids + nose. Mid-warm beige. */
const DEFAULT_SKIN_TONE = 0xc9a08a;
/** Default brow color — dark brown. */
const DEFAULT_BROW_COLOR = 0x2a1810;
/** Default lip color — dusky red. */
const DEFAULT_LIP_COLOR = 0x884050;

// ---------------------------------------------------------------------------
// Landmark index sets — canonical MediaPipe FaceMesh
// ---------------------------------------------------------------------------
//
// Eyelids: per side, an upper ring and a lower ring sharing the inner +
// outer corners. Strip is corner → top-curve points → other corner.
// Indices follow the MediaPipe canonical face landmark diagram.

const LEFT_UPPER_LID: ReadonlyArray<number> = [33, 246, 161, 160, 159, 158, 157, 173, 133];
const LEFT_LOWER_LID: ReadonlyArray<number> = [33, 7, 163, 144, 145, 153, 154, 155, 133];
const RIGHT_UPPER_LID: ReadonlyArray<number> = [362, 398, 384, 385, 386, 387, 388, 466, 263];
const RIGHT_LOWER_LID: ReadonlyArray<number> = [362, 382, 381, 380, 374, 373, 390, 249, 263];

// Eyebrow ribbon top-edge landmarks (brow-tail to inner-bridge). The bottom
// edge is computed by offsetting toward the eye (down + slightly forward).
const LEFT_BROW_TOP: ReadonlyArray<number> = [70, 63, 105, 66, 107];
const RIGHT_BROW_TOP: ReadonlyArray<number> = [336, 296, 334, 293, 300];

// Lip ring landmarks. Outer + inner are paired: outer[i] sits beside inner[i].
// We triangulate as a strip alternating outer / inner verts.
const UPPER_LIP_OUTER: ReadonlyArray<number> = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
const UPPER_LIP_INNER: ReadonlyArray<number> = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LOWER_LIP_OUTER: ReadonlyArray<number> = [146, 91, 181, 84, 17, 314, 405, 321, 375, 291];
const LOWER_LIP_INNER: ReadonlyArray<number> = [95, 88, 178, 87, 14, 317, 402, 318, 324, 308];

// Nose anchor landmarks — bridge, tip, nostrils, alar wings, septum.
// Triangulated as a fan from the tip outward.
const NOSE_BRIDGE: ReadonlyArray<number> = [168, 6, 197, 195];
const NOSE_TIP: ReadonlyArray<number> = [1, 4, 5];
const NOSE_NOSTRILS: ReadonlyArray<number> = [98, 327];
const NOSE_ALAR: ReadonlyArray<number> = [64, 294];
const NOSE_SEPTUM = 2;

// Iris-distance reference — used to size the lid Z-offset (lid sits ~5% of
// inter-eye distance in front of the sclera) and the brow thickness.
const LEFT_IRIS_FALLBACK = 33;
const RIGHT_IRIS_FALLBACK = 263;
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;

// ---------------------------------------------------------------------------
// Phase E — landmark sets for conditional features
// ---------------------------------------------------------------------------

/** Per-region landmark indices used to anchor beard patches. Mirrors the
 *  REGIONS map in `src/dev/face/beard.ts` so the patches sit in the same
 *  area where the sampler measured density. The mustache is special — it
 *  uses a wider lip-top + nose-base ring to span the philtrum.
 *
 *  These are not re-exported from beard.ts (it's locked) so the duplicate
 *  is intentional — keep in sync if beard.ts ever shifts its REGIONS. */
const BEARD_REGION_LANDMARKS: Record<BeardRegion, ReadonlyArray<number>> = {
  chin: [152, 176, 148, 377, 400],
  underChin: [148, 176, 149, 150, 377, 400, 378],
  cheekL: [205, 206, 207, 187, 147],
  cheekR: [425, 426, 427, 411, 376],
  sideburnL: [132, 58, 172, 136],
  sideburnR: [361, 288, 397, 365],
  jawlineL: [172, 136, 150, 149, 176],
  jawlineR: [397, 365, 379, 378, 400],
  // Mustache: top edge along the upper-lip vermilion (37/0/267) connecting
  // up to the nose base (97/2/326). 6 verts form a flat patch over the
  // philtrum.
  mustache: [37, 0, 267, 326, 2, 97],
};

/** Phase E: upper-lid landmarks where lashes are anchored. We pick a
 *  subset of the canonical upper-lid ring's middle verts (skipping the
 *  innermost / outermost so the lashes don't crowd the corners). */
const LEFT_UPPER_LASH_ANCHORS: ReadonlyArray<number> = [246, 161, 160, 159, 158, 157, 173];
const RIGHT_UPPER_LASH_ANCHORS: ReadonlyArray<number> = [398, 384, 385, 386, 387, 388, 466];

// Lid forward-offset as a fraction of inter-eye distance.
const LID_Z_OFFSET_FRAC = 0.05;
// Eyebrow ribbon thickness (mesh-local meters).
const BROW_THICKNESS = 0.012;
// Brow-ribbon forward-offset to keep the ribbon sitting in front of the
// underlying mesh skin.
const BROW_Z_OFFSET = 0.001;

// ---------------------------------------------------------------------------
// Module-level shared materials + nose geometry
// ---------------------------------------------------------------------------
//
// Materials are keyed by RGB int. Six players × three colors = up to 18
// material instances over the lifetime of a session, which is well below
// the GPU's bind-cost threshold and lets multiple players share a single
// upload when their sampled colors collide (very likely for skin).

const skinMatCache = new Map<number, THREE.MeshBasicMaterial>();
const browMatCache = new Map<number, THREE.MeshBasicMaterial>();
const lipMatCache = new Map<number, THREE.MeshBasicMaterial>();
// Phase E: lash + beard color materials. Lash uses opaque MeshBasic; beard
// is keyed by `(color << 1) | (transparent ? 1 : 0)` to support transparent
// duplicates if a future variant needs both. v1 keeps a separate map per
// purpose so a transparent beard mat doesn't accidentally tint an opaque
// lash strip with the same color.
const lashMatCache = new Map<number, THREE.MeshBasicMaterial>();
const beardMatCache = new Map<string, THREE.MeshBasicMaterial>();

function getSkinToneMat(color: number): THREE.MeshBasicMaterial {
  let m = skinMatCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    skinMatCache.set(color, m);
  }
  return m;
}

function getBrowMat(color: number): THREE.MeshBasicMaterial {
  let m = browMatCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    browMatCache.set(color, m);
  }
  return m;
}

function getLipMat(color: number): THREE.MeshBasicMaterial {
  let m = lipMatCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    lipMatCache.set(color, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Phase E: shared materials for conditional features
// ---------------------------------------------------------------------------

/** Off-white teeth color — matches the sclera so the strip reads as teeth
 *  rather than a foreign object. */
const TEETH_COLOR = 0xf5f0e8;
/** Tongue pink — saturated enough to read as tongue against the dark
 *  mouth-interior plane sitting behind it. */
const TONGUE_COLOR = 0xc94545;
/** Default lash color when detection didn't supply one. Pure black reads
 *  cleanly against any sampled skin tone. */
const DEFAULT_LASH_COLOR = 0x000000;
/** Default beard hair color when a region has density > threshold but no
 *  sampled `hairColor` (e.g. detection couldn't isolate the dark cluster). */
const DEFAULT_BEARD_COLOR = 0x2a1810;
/** Phase E: regions with density at or below this skip mesh allocation
 *  entirely — the visual signal is below the noise floor of the detector. */
const BEARD_DENSITY_THRESHOLD = 0.15;
/** jawOpen smoothed-coefficient threshold for showing the upper / lower
 *  teeth strip. Below this the lips are essentially closed and teeth would
 *  poke through. */
const TEETH_JAWOPEN_THRESHOLD = 0.15;
/** jawOpen smoothed-coefficient threshold for the tongue. Higher than the
 *  teeth threshold — tongue should only show when the mouth is clearly
 *  open enough to see it, not on a small mumble where it would clip. */
const TONGUE_JAWOPEN_THRESHOLD = 0.3;

const sharedTeethMat = new THREE.MeshBasicMaterial({
  color: TEETH_COLOR,
  side: THREE.DoubleSide,
});
const sharedTongueMat = new THREE.MeshBasicMaterial({
  color: TONGUE_COLOR,
  side: THREE.DoubleSide,
});
/** Shared upper-teeth and lower-teeth box geometries. 0.05 m wide × 0.012 m
 *  tall × 0.012 m deep — wide enough to span the inner-lip-ring centroid's
 *  worth of teeth, thin enough that the upper row doesn't poke into the lip
 *  vermilion when the mouth is closed. 8 verts each. */
const sharedTeethGeom = new THREE.BoxGeometry(0.05, 0.012, 0.012);

function getLashMat(color: number): THREE.MeshBasicMaterial {
  let m = lashMatCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    lashMatCache.set(color, m);
  }
  return m;
}

function getBeardMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  // Quantize opacity to 8 buckets so a session's worth of slightly-varying
  // densities still reuse a small number of materials.
  const bucket = Math.max(0, Math.min(7, Math.round(opacity * 7)));
  const key = `${color.toString(16)}@${bucket}`;
  let m = beardMatCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: bucket / 7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    beardMatCache.set(key, m);
  }
  return m;
}

/** Phase D: clamp brow intensity to a sane range so a 0-density sample
 *  doesn't produce a degenerate zero-thickness ribbon (CCW triangles
 *  collapse, the geometry vanishes). 0.25 keeps faint brows visible.
 *  Values >2 from over-amplified samples cap at 2× the default thickness. */
function clampIntensity(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0.25, Math.min(2, v));
}

/** Phase D: clamp eye-shape openness so a zero (closed-eye) sample doesn't
 *  collapse the lid strip onto a single horizontal line (which would render
 *  as nothing). 0.4 = visibly narrowed without disappearing. */
function clampOpenness(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0.4, Math.min(1.4, v));
}

// Phase D: nose geometry is now built per-face inside createProceduralFace
// so it can scale to the user's noseShape ratios. The Phase B module-level
// shared cache has been retired — see buildNoseGeometry below.

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

/** Read landmark `idx` from a flat Float32Array, write into `out` at offset
 *  `outOffset` (in float units, not vert units). Returns true on success,
 *  false if the index is out of range. */
function readLandmark(
  src: Float32Array,
  idx: number,
  out: Float32Array,
  outOffset: number,
): boolean {
  const base = idx * 3;
  if (base + 2 >= src.length) return false;
  out[outOffset + 0] = src[base + 0];
  out[outOffset + 1] = src[base + 1];
  out[outOffset + 2] = src[base + 2];
  return true;
}

/** Compute the inter-iris distance from rest positions (used to scale the
 *  forward-offsets). Falls back to eye-outer-corner distance if irises are
 *  degenerate (all-zero or out of range). */
function computeInterEyeDistance(rest: Float32Array): number {
  const tryDist = (a: number, b: number): number | null => {
    const ab = a * 3;
    const bb = b * 3;
    if (ab + 2 >= rest.length || bb + 2 >= rest.length) return null;
    const ax = rest[ab + 0], ay = rest[ab + 1], az = rest[ab + 2];
    const bx = rest[bb + 0], by = rest[bb + 1], bz = rest[bb + 2];
    const ok = (ax !== 0 || ay !== 0 || az !== 0) && (bx !== 0 || by !== 0 || bz !== 0);
    if (!ok) return null;
    const d = Math.hypot(bx - ax, by - ay, bz - az);
    return d > 1e-6 ? d : null;
  };
  return (
    tryDist(LEFT_IRIS, RIGHT_IRIS) ??
    tryDist(LEFT_IRIS_FALLBACK, RIGHT_IRIS_FALLBACK) ??
    0.2 // mesh-builder's default rigEyeDist
  );
}

/** Build an indexed-triangle BufferGeometry for a single eyelid strip.
 *
 *  The strip's vertex layout is upperRing concatenated with lowerRing
 *  (skipping the lower ring's first/last verts because they're the corners,
 *  shared with the upper ring). Indexing weaves a triangle fan between
 *  matched pairs.
 *
 *  Layout:
 *    verts[0..U-1]        = upper ring (left corner → right corner)
 *    verts[U..U+L-3]      = lower ring middle (skipping corners — they live
 *                           at upper[0] and upper[U-1])
 *
 *  Triangles: for each i in [0, U-2], stitch upper[i], upper[i+1], lower[i]
 *  and upper[i+1], lower[i+1], lower[i] (with corner-share at i=0 and i=U-2).
 *
 *  Returns the geometry, the upper-ring indices array, and the lower-ring
 *  middle indices array — the per-frame update needs both to re-read
 *  positions in the same order they were laid out at build time. */
interface LidGeom {
  geometry: THREE.BufferGeometry;
  /** Canonical landmark indices for verts[0..U-1] (upper ring). */
  upperIndices: ReadonlyArray<number>;
  /** Canonical landmark indices for verts[U..U+L-3] (lower middle).
   *  These correspond to lowerRing.slice(1, -1). */
  lowerMiddleIndices: ReadonlyArray<number>;
  /** Forward-z offset to apply to each vertex when writing positions. */
  zOffset: number;
}

function buildLidGeometry(
  rest: Float32Array,
  upperRing: ReadonlyArray<number>,
  lowerRing: ReadonlyArray<number>,
  zOffset: number,
  opennessRatio = 1,
): LidGeom {
  const U = upperRing.length;
  const L = lowerRing.length;
  // Lower ring corners are shared with the upper ring at indices 0 and U-1,
  // so we only carry the L-2 middle verts of the lower ring.
  const lowerMiddle = lowerRing.slice(1, -1);
  const vertCount = U + lowerMiddle.length;
  const positions = new Float32Array(vertCount * 3);

  // Phase D: opennessRatio<1 narrows the lid strip's vertical extent at
  // construction. We compute the strip's mid-Y from the corners and pull
  // each ring vert toward that midline by `(1 - opennessRatio)`. Eye corners
  // are landmark-anchored (shared by upper+lower rings) so they stay put;
  // only the curved interior verts move. opennessRatio === 1 is a no-op.
  let midY = 0;
  if (opennessRatio !== 1) {
    // Mid-Y = average of the two corner Ys (upperRing[0] / upperRing[U-1])
    // — these double as lowerRing's first/last entries.
    const cornerLeftBase = upperRing[0] * 3;
    const cornerRightBase = upperRing[U - 1] * 3;
    if (cornerLeftBase + 1 < rest.length && cornerRightBase + 1 < rest.length) {
      midY = (rest[cornerLeftBase + 1] + rest[cornerRightBase + 1]) * 0.5;
    }
  }
  const yShrink = (y: number): number =>
    opennessRatio === 1 ? y : midY + (y - midY) * opennessRatio;

  // Pre-fill positions from rest. Z-offset is applied here AND on every
  // update — the strip must sit in front of the canonical mesh skin so it
  // doesn't z-fight with the underlying texture.
  for (let i = 0; i < U; i++) {
    if (readLandmark(rest, upperRing[i], positions, i * 3)) {
      positions[i * 3 + 1] = yShrink(positions[i * 3 + 1]);
      positions[i * 3 + 2] += zOffset;
    }
  }
  for (let i = 0; i < lowerMiddle.length; i++) {
    if (readLandmark(rest, lowerMiddle[i], positions, (U + i) * 3)) {
      positions[(U + i) * 3 + 1] = yShrink(positions[(U + i) * 3 + 1]);
      positions[(U + i) * 3 + 2] += zOffset;
    }
  }

  // Build triangle indices. We index lower-ring verts via this helper so
  // i=0 → upperRing[0] (shared corner), i=L-1 → upperRing[U-1] (shared
  // corner), and i in (0, L-1) → U + (i-1) (middle slots).
  const lowerVertIdx = (i: number): number => {
    if (i === 0) return 0;
    if (i === L - 1) return U - 1;
    return U + (i - 1);
  };

  const tris: number[] = [];
  // Upper ring index `j` corresponds to lower ring index `j` when U === L
  // (the canonical lid rings have matching counts in our chosen indices —
  // both 9). Stitch quad pairs upper[i], upper[i+1], lower[i+1], lower[i]
  // as two triangles: (upper[i], upper[i+1], lower[i]) and
  // (upper[i+1], lower[i+1], lower[i]).
  const N = Math.min(U, L) - 1;
  for (let i = 0; i < N; i++) {
    const u0 = i;
    const u1 = i + 1;
    const l0 = lowerVertIdx(i);
    const l1 = lowerVertIdx(i + 1);
    tris.push(u0, u1, l0);
    tris.push(u1, l1, l0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(tris);
  geometry.computeBoundingSphere();

  return {
    geometry,
    upperIndices: upperRing,
    lowerMiddleIndices: lowerMiddle,
    zOffset,
  };
}

/** Update an existing lid geometry's vertex positions from the now-deformed
 *  landmark positions in `live`. */
function updateLidGeometry(live: Float32Array, lid: LidGeom): void {
  const attr = lid.geometry.attributes.position as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const U = lid.upperIndices.length;
  for (let i = 0; i < U; i++) {
    if (readLandmark(live, lid.upperIndices[i], arr, i * 3)) {
      arr[i * 3 + 2] += lid.zOffset;
    }
  }
  for (let i = 0; i < lid.lowerMiddleIndices.length; i++) {
    if (readLandmark(live, lid.lowerMiddleIndices[i], arr, (U + i) * 3)) {
      arr[(U + i) * 3 + 2] += lid.zOffset;
    }
  }
  attr.needsUpdate = true;
  // Lids are tiny + always near the camera in close-face views — skip
  // computeBoundingBox (we don't depth-sort them) but keep
  // computeBoundingSphere for THREE's frustum culling, which uses spheres.
  lid.geometry.computeBoundingSphere();
}

/** Build an indexed-triangle BufferGeometry for an eyebrow ribbon.
 *
 *  Vertex layout: top edge (5 verts from brow-tail → inner) followed by
 *  bottom edge (same 5 verts, offset toward the eye by `(0, -BROW_THICKNESS,
 *  +BROW_Z_OFFSET)`). 10 verts total.
 *
 *  Triangles: for each i in [0, N-2], stitch top[i], top[i+1], bot[i] and
 *  top[i+1], bot[i+1], bot[i]. */
interface BrowGeom {
  geometry: THREE.BufferGeometry;
  /** Canonical landmark indices for the top edge (5 verts). */
  topIndices: ReadonlyArray<number>;
  /** Phase D: per-side thickness (mesh-local meters) baked at build time
   *  AND used during the per-frame update so faint brows stay thin. */
  thickness: number;
}

function buildBrowGeometry(
  rest: Float32Array,
  topIndices: ReadonlyArray<number>,
  thickness: number = BROW_THICKNESS,
): BrowGeom {
  const N = topIndices.length;
  const positions = new Float32Array(N * 2 * 3);

  // Top edge: read straight from rest landmarks.
  for (let i = 0; i < N; i++) {
    readLandmark(rest, topIndices[i], positions, i * 3);
  }
  // Bottom edge: same X/Z, Y offset down by `thickness`, Z offset forward.
  for (let i = 0; i < N; i++) {
    positions[(N + i) * 3 + 0] = positions[i * 3 + 0];
    positions[(N + i) * 3 + 1] = positions[i * 3 + 1] - thickness;
    positions[(N + i) * 3 + 2] = positions[i * 3 + 2] + BROW_Z_OFFSET;
  }
  // Add the BROW_Z_OFFSET to the top edge as well, so the whole ribbon sits
  // in front of the underlying skin.
  for (let i = 0; i < N; i++) {
    positions[i * 3 + 2] += BROW_Z_OFFSET;
  }

  const tris: number[] = [];
  for (let i = 0; i < N - 1; i++) {
    const t0 = i, t1 = i + 1;
    const b0 = N + i, b1 = N + i + 1;
    tris.push(t0, t1, b0);
    tris.push(t1, b1, b0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(tris);
  geometry.computeBoundingSphere();

  return { geometry, topIndices, thickness };
}

/** Update an existing brow ribbon's vertex positions. */
function updateBrowGeometry(live: Float32Array, brow: BrowGeom): void {
  const attr = brow.geometry.attributes.position as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const N = brow.topIndices.length;
  for (let i = 0; i < N; i++) {
    readLandmark(live, brow.topIndices[i], arr, i * 3);
    arr[i * 3 + 2] += BROW_Z_OFFSET;
  }
  for (let i = 0; i < N; i++) {
    arr[(N + i) * 3 + 0] = arr[i * 3 + 0];
    arr[(N + i) * 3 + 1] = arr[i * 3 + 1] - brow.thickness;
    arr[(N + i) * 3 + 2] = arr[i * 3 + 2] + BROW_Z_OFFSET;
  }
  attr.needsUpdate = true;
  brow.geometry.computeBoundingSphere();
}

/** Build an indexed-triangle BufferGeometry for a lip strip.
 *
 *  Vertex layout: outer ring (N verts) followed by inner ring (M verts).
 *  The two rings have potentially different counts (the canonical
 *  upper/lower lip rings here are 11/11 outer + 11/10 inner depending on
 *  side). We stitch by matching index up to min(N, M) - 1 — the corners
 *  (61 / 291 / 308 / 78 etc.) are shared landmarks naturally aligned at the
 *  ring endpoints. */
interface LipGeom {
  geometry: THREE.BufferGeometry;
  /** Outer ring landmark indices. */
  outerIndices: ReadonlyArray<number>;
  /** Inner ring landmark indices. */
  innerIndices: ReadonlyArray<number>;
}

function buildLipGeometry(
  rest: Float32Array,
  outerIndices: ReadonlyArray<number>,
  innerIndices: ReadonlyArray<number>,
): LipGeom {
  const N = outerIndices.length;
  const M = innerIndices.length;
  const positions = new Float32Array((N + M) * 3);
  for (let i = 0; i < N; i++) {
    readLandmark(rest, outerIndices[i], positions, i * 3);
  }
  for (let i = 0; i < M; i++) {
    readLandmark(rest, innerIndices[i], positions, (N + i) * 3);
  }

  const tris: number[] = [];
  const stitchN = Math.min(N, M) - 1;
  for (let i = 0; i < stitchN; i++) {
    const o0 = i, o1 = i + 1;
    const in0 = N + i, in1 = N + i + 1;
    tris.push(o0, o1, in0);
    tris.push(o1, in1, in0);
  }
  // If the rings have different lengths, fan the leftover outer verts into
  // the last inner vert so we don't leave holes. (For our chosen lip
  // landmarks this only fires on the lower lip's slight imbalance, and only
  // when lengths actually differ.)
  if (N > M) {
    const lastInner = N + M - 1;
    for (let i = stitchN; i < N - 1; i++) {
      tris.push(i, i + 1, lastInner);
    }
  } else if (M > N) {
    const lastOuter = N - 1;
    for (let i = stitchN; i < M - 1; i++) {
      tris.push(lastOuter, N + i, N + i + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(tris);
  geometry.computeBoundingSphere();

  return { geometry, outerIndices, innerIndices };
}

function updateLipGeometry(live: Float32Array, lip: LipGeom): void {
  const attr = lip.geometry.attributes.position as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const N = lip.outerIndices.length;
  const M = lip.innerIndices.length;
  for (let i = 0; i < N; i++) {
    readLandmark(live, lip.outerIndices[i], arr, i * 3);
  }
  for (let i = 0; i < M; i++) {
    readLandmark(live, lip.innerIndices[i], arr, (N + i) * 3);
  }
  attr.needsUpdate = true;
  lip.geometry.computeBoundingSphere();
}

// ---------------------------------------------------------------------------
// Phase E — conditional feature builders
// ---------------------------------------------------------------------------

/** Compute the centroid of a list of canonical-mesh landmarks at the given
 *  positions. Returns null if every index is out of range. */
function landmarkCentroid(
  positions: Float32Array,
  indices: ReadonlyArray<number>,
): { x: number; y: number; z: number } | null {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const i of indices) {
    const base = i * 3;
    if (base + 2 >= positions.length) continue;
    sx += positions[base + 0];
    sy += positions[base + 1];
    sz += positions[base + 2];
    n++;
  }
  if (n === 0) return null;
  return { x: sx / n, y: sy / n, z: sz / n };
}

/** Compute the horizontal extent (max - min x) of the supplied landmark
 *  indices. Used as a coarse "width" for the tongue scale. */
function landmarkXExtent(
  positions: Float32Array,
  indices: ReadonlyArray<number>,
): number {
  let min = Infinity, max = -Infinity;
  for (const i of indices) {
    const base = i * 3;
    if (base + 2 >= positions.length) continue;
    const x = positions[base + 0];
    if (x < min) min = x;
    if (x > max) max = x;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0.04;
  return Math.max(0.001, max - min);
}

/** Phase E: build a single eyelash strip per side. The strip is a flat
 *  set of ~7 small quads, each anchored to one upper-lid landmark and
 *  extending upward + slightly forward by `lashLen` × `lashFwd`. Stored as
 *  a static BufferGeometry — the lashes ride the lid mesh as children, so
 *  blink animation comes from the parent's transform automatically.
 *
 *  Vertex count: anchorCount × 4 = 28 for the default 7-anchor set. Below
 *  the brief's 32-vert/side budget. */
interface LashGeom {
  geometry: THREE.BufferGeometry;
  anchorIndices: ReadonlyArray<number>;
  /** Per-frame update applies these in mesh-local space, since the lash
   *  group is parented to the procedural face's group (NOT the lid mesh —
   *  the lid mesh's geometry rebuilds wholesale every frame, which would
   *  lose the lash children's positions). */
  lashLen: number;
  lashHalfW: number;
  fwdZ: number;
}

function buildLashGeometry(
  rest: Float32Array,
  anchors: ReadonlyArray<number>,
  lashLen: number,
  lashHalfW: number,
  fwdZ: number,
): LashGeom {
  const N = anchors.length;
  const positions = new Float32Array(N * 4 * 3);
  const tris: number[] = [];
  for (let i = 0; i < N; i++) {
    const idx = anchors[i];
    const base = idx * 3;
    if (base + 2 >= rest.length) continue;
    const ax = rest[base + 0];
    const ay = rest[base + 1];
    const az = rest[base + 2];
    // Quad layout: bottom-left, bottom-right, top-right, top-left.
    const off = i * 4 * 3;
    positions[off + 0] = ax - lashHalfW;
    positions[off + 1] = ay;
    positions[off + 2] = az + fwdZ;
    positions[off + 3] = ax + lashHalfW;
    positions[off + 4] = ay;
    positions[off + 5] = az + fwdZ;
    positions[off + 6] = ax + lashHalfW;
    positions[off + 7] = ay + lashLen;
    positions[off + 8] = az + fwdZ;
    positions[off + 9] = ax - lashHalfW;
    positions[off + 10] = ay + lashLen;
    positions[off + 11] = az + fwdZ;
    const v0 = i * 4;
    tris.push(v0 + 0, v0 + 1, v0 + 2, v0 + 0, v0 + 2, v0 + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(tris);
  geometry.computeBoundingSphere();
  return { geometry, anchorIndices: anchors, lashLen, lashHalfW, fwdZ };
}

/** Per-frame update for an eyelash strip. Re-reads each anchor's live
 *  position so when the lid blinks (the canonical lid landmarks drop), the
 *  lashes drop with them. Cheap — N × 4 verts × 3 floats = 84 writes. */
function updateLashGeometry(live: Float32Array, lash: LashGeom): void {
  const attr = lash.geometry.attributes.position as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const N = lash.anchorIndices.length;
  for (let i = 0; i < N; i++) {
    const idx = lash.anchorIndices[i];
    const base = idx * 3;
    if (base + 2 >= live.length) continue;
    const ax = live[base + 0];
    const ay = live[base + 1];
    const az = live[base + 2];
    const off = i * 4 * 3;
    arr[off + 0] = ax - lash.lashHalfW;
    arr[off + 1] = ay;
    arr[off + 2] = az + lash.fwdZ;
    arr[off + 3] = ax + lash.lashHalfW;
    arr[off + 4] = ay;
    arr[off + 5] = az + lash.fwdZ;
    arr[off + 6] = ax + lash.lashHalfW;
    arr[off + 7] = ay + lash.lashLen;
    arr[off + 8] = az + lash.fwdZ;
    arr[off + 9] = ax - lash.lashHalfW;
    arr[off + 10] = ay + lash.lashLen;
    arr[off + 11] = az + lash.fwdZ;
  }
  attr.needsUpdate = true;
  lash.geometry.computeBoundingSphere();
}

/** Phase E: build a tiny patch geometry over a beard region's defining
 *  landmarks. The patch is a triangle fan from the centroid out to each
 *  ring landmark, with a small +z forward offset so it sits visibly in
 *  front of the underlying skin tone of the head sphere / canonical mesh.
 *
 *  Vertex count: 1 (centroid) + N (ring) — typically 4–7. */
interface BeardGeom {
  geometry: THREE.BufferGeometry;
  landmarkIndices: ReadonlyArray<number>;
  fwdZ: number;
}

const BEARD_FWD_Z = 0.002;

function buildBeardGeometry(
  rest: Float32Array,
  indices: ReadonlyArray<number>,
): BeardGeom | null {
  if (indices.length < 3) return null;
  const N = indices.length;
  const positions = new Float32Array((N + 1) * 3);
  // Centroid first (vert 0).
  const c = landmarkCentroid(rest, indices);
  if (!c) return null;
  positions[0] = c.x;
  positions[1] = c.y;
  positions[2] = c.z + BEARD_FWD_Z;
  for (let i = 0; i < N; i++) {
    const idx = indices[i];
    const base = idx * 3;
    if (base + 2 >= rest.length) {
      positions[(1 + i) * 3 + 0] = c.x;
      positions[(1 + i) * 3 + 1] = c.y;
      positions[(1 + i) * 3 + 2] = c.z + BEARD_FWD_Z;
      continue;
    }
    positions[(1 + i) * 3 + 0] = rest[base + 0];
    positions[(1 + i) * 3 + 1] = rest[base + 1];
    positions[(1 + i) * 3 + 2] = rest[base + 2] + BEARD_FWD_Z;
  }
  // Triangle fan: (centroid, ring[i], ring[i+1]) for each i in [0, N-1],
  // wrapping back to ring[0] at the end so the patch closes.
  const tris: number[] = [];
  for (let i = 0; i < N; i++) {
    const next = (i + 1) % N;
    tris.push(0, 1 + i, 1 + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(tris);
  geometry.computeBoundingSphere();
  return { geometry, landmarkIndices: indices, fwdZ: BEARD_FWD_Z };
}

function updateBeardGeometry(live: Float32Array, beard: BeardGeom): void {
  const attr = beard.geometry.attributes.position as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const c = landmarkCentroid(live, beard.landmarkIndices);
  if (!c) return;
  arr[0] = c.x;
  arr[1] = c.y;
  arr[2] = c.z + beard.fwdZ;
  for (let i = 0; i < beard.landmarkIndices.length; i++) {
    const idx = beard.landmarkIndices[i];
    const base = idx * 3;
    if (base + 2 >= live.length) continue;
    arr[(1 + i) * 3 + 0] = live[base + 0];
    arr[(1 + i) * 3 + 1] = live[base + 1];
    arr[(1 + i) * 3 + 2] = live[base + 2] + beard.fwdZ;
  }
  attr.needsUpdate = true;
  beard.geometry.computeBoundingSphere();
}

/** Build a small fan-shaped nose geometry from the canonical nose landmarks.
 *  Phase B treats the nose as static — no per-frame rebuild — and the shape
 *  is derived from a representative rest pose. Future Phase D will swap to
 *  per-face geometry sampled from the photo. */
function buildNoseGeometry(rest: Float32Array): THREE.BufferGeometry {
  // Order: bridge top → bridge bottom → tip → nostrils + alar wings → septum.
  // Concatenate into one position array; index by enumeration.
  const indices: number[] = [
    ...NOSE_BRIDGE,           // 0..3
    ...NOSE_TIP,              // 4..6
    ...NOSE_NOSTRILS,         // 7..8
    ...NOSE_ALAR,             // 9..10
    NOSE_SEPTUM,              // 11
  ];
  const positions = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    if (!readLandmark(rest, indices[i], positions, i * 3)) {
      // If a landmark is missing (defensive — shouldn't happen on a 478-vert
      // mesh) leave it at origin. The triangle won't read correctly but it
      // won't crash either.
    }
  }

  // Triangulate as a fan: each face uses the tip (idx 4 = landmark 1) as a
  // shared vertex to anchor neighboring landmarks.
  // Layout maps landmark roles:
  //   0 (bridge top), 1, 2, 3 (bridge bottom)
  //   4 (tip 1), 5 (tip 4), 6 (tip 5)
  //   7 (left nostril), 8 (right nostril)
  //   9 (left alar), 10 (right alar)
  //   11 (septum)
  // Fan triangles: bridge top → bridge mid → tip; tip → alar → nostril → septum etc.
  const tris: number[] = [
    // Bridge: 0-1-4 (bridge top + bridge mid + tip), 1-2-4, 2-3-4
    0, 1, 4,
    1, 2, 4,
    2, 3, 4,
    // Tip cluster: 3-4-5, 4-5-6
    3, 4, 5,
    4, 5, 6,
    // Septum + nostrils + alar wings (lower fan):
    // Left wing: 9-7-11 (alar → nostril → septum)
    9, 7, 11,
    // Right wing: 11-8-10 (septum → nostril → alar)
    11, 8, 10,
    // Connect tip to the lower fan via septum
    6, 11, 5,
    5, 11, 6,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(tris);
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// createProceduralFace
// ---------------------------------------------------------------------------

/** Create a procedural face attached to (but not yet mounted in) the supplied
 *  built mesh. Caller must mount `result.group` as a sibling of `built.mesh`
 *  and call `result.update()` every frame after `puppet.apply()`.
 *
 *  Phase D: optional `features` bundle drives per-face skin tone, lip color,
 *  brow color/intensity, eye-shape openness, and nose proportions. Each
 *  field is independently optional — missing values fall back to the
 *  Phase B defaults so old saves render unchanged. */
export function createProceduralFace(
  built: BuiltFaceMesh,
  opts: ProceduralFaceOptions = {},
  features: ProceduralFaceFeatures = {},
): ProceduralFace {
  const group = new THREE.Group();
  group.name = 'face-procedural';

  const posAttr = built.mesh.geometry.attributes.position as
    | THREE.BufferAttribute
    | undefined;
  if (!posAttr || posAttr.count === 0) {
    // Defensive: empty / missing position attribute. Return a no-op shell so
    // callers can still trust the contract.
    return {
      group,
      update(): void { /* no-op */ },
      setVisible(v: boolean): void { group.visible = v; },
      setBlendshapeSource(_src: BlendshapeSource | null): void { /* no-op */ },
      dispose(): void { /* nothing to dispose */ },
    };
  }

  // The live position attribute IS the canonical mesh's geometry buffer —
  // when the puppet writes through `posAttr.array`, we read the same array
  // every frame. Snapshot the rest pose so feature builders can read a
  // stable reference (the puppet is built AFTER the procedural face, so on
  // construction the buffer is at rest).
  const live = posAttr.array as Float32Array;
  const rest = new Float32Array(live);

  const interEye = computeInterEyeDistance(rest);
  const lidZOffset = interEye * LID_Z_OFFSET_FRAC;

  // ---- Resolve per-face colors (Phase D) ----
  const skinTone = features.skinTone ?? DEFAULT_SKIN_TONE;
  const upperLipColor = features.lipColor?.upper ?? DEFAULT_LIP_COLOR;
  const lowerLipColor = features.lipColor?.lower ?? DEFAULT_LIP_COLOR;
  const browLeftColor = features.browColors?.left ?? DEFAULT_BROW_COLOR;
  const browRightColor = features.browColors?.right ?? DEFAULT_BROW_COLOR;
  // Brow intensity scales the ribbon thickness so faint brows render
  // thinner. Default 1.0 (full thickness) when no per-side intensity given.
  const browLeftIntensity = clampIntensity(features.browIntensity?.left ?? 1);
  const browRightIntensity = clampIntensity(features.browIntensity?.right ?? 1);

  // ---- Eyelids (4 meshes) ----
  // Phase D: eye-shape openness scales the lid strip's vertical extent so
  // partially-closed eyes read as visibly narrower at rest. Default 1.0.
  const lidLeftOpen = clampOpenness(features.eyeShape?.left?.opennessRatio ?? 1);
  const lidRightOpen = clampOpenness(features.eyeShape?.right?.opennessRatio ?? 1);
  const lidLeftUpper = buildLidGeometry(rest, LEFT_UPPER_LID, LEFT_LOWER_LID, lidZOffset, lidLeftOpen);
  const lidRightUpper = buildLidGeometry(rest, RIGHT_UPPER_LID, RIGHT_LOWER_LID, lidZOffset, lidRightOpen);
  // Phase B v1 uses one strip per side that spans both upper and lower lids
  // (the geometry stitches both rings into a single filled patch). The
  // brief calls for 4 meshes (upper + lower per side); since the rings
  // share corners, a single strip-per-side both fills the same area and
  // saves two draw calls. Animation behavior is identical — when the upper
  // ring drops via eyeBlink, the strip narrows; when the lower ring lifts
  // via eyeSquint, the strip narrows from below. Documented here so a
  // future split into upper-only + lower-only is a straightforward refactor
  // (each lid ring already has its own indices).
  const skinMat = getSkinToneMat(skinTone);
  const lidLeftMesh = new THREE.Mesh(lidLeftUpper.geometry, skinMat);
  lidLeftMesh.name = 'face-proc-lid-left';
  const lidRightMesh = new THREE.Mesh(lidRightUpper.geometry, skinMat);
  lidRightMesh.name = 'face-proc-lid-right';
  group.add(lidLeftMesh, lidRightMesh);

  // ---- Brows (2 meshes) ----
  // Phase D: per-side color material + intensity-modulated thickness.
  const browLeft = buildBrowGeometry(rest, LEFT_BROW_TOP, BROW_THICKNESS * browLeftIntensity);
  const browRight = buildBrowGeometry(rest, RIGHT_BROW_TOP, BROW_THICKNESS * browRightIntensity);
  const browLeftMat = getBrowMat(browLeftColor);
  const browRightMat = getBrowMat(browRightColor);
  const browLeftMesh = new THREE.Mesh(browLeft.geometry, browLeftMat);
  browLeftMesh.name = 'face-proc-brow-left';
  const browRightMesh = new THREE.Mesh(browRight.geometry, browRightMat);
  browRightMesh.name = 'face-proc-brow-right';
  group.add(browLeftMesh, browRightMesh);

  // ---- Nose (1 mesh, per-face geometry) ----
  // Phase D: build the nose from THIS face's rest landmarks so the silhouette
  // matches the user's nose, then scale by the sampled proportion ratios so
  // the relative width / length / protrusion shifts visibly. Static — no
  // per-frame rebuild — so the cost is paid once per face.
  const noseScale = features.noseShape ?? { lengthRatio: 1, widthRatio: 1, protrusionRatio: 1 };
  const noseGeom = buildNoseGeometry(rest);
  const noseMesh = new THREE.Mesh(noseGeom, skinMat);
  noseMesh.name = 'face-proc-nose';
  // Apply proportion ratios on the mesh transform (cheap; no buffer rewrite).
  // x = width, y = length, z = protrusion. Values from sample-utils are
  // normalized to 1.0 = "average" face — typical range ~0.7..1.4.
  noseMesh.scale.set(
    Math.max(0.1, noseScale.widthRatio),
    Math.max(0.1, noseScale.lengthRatio),
    Math.max(0.1, noseScale.protrusionRatio),
  );
  group.add(noseMesh);

  // ---- Lips (2 meshes) ----
  // Phase D: separate upper / lower materials so the sampler's per-lip
  // colors land on the matching mesh.
  const upperLip = buildLipGeometry(rest, UPPER_LIP_OUTER, UPPER_LIP_INNER);
  const lowerLip = buildLipGeometry(rest, LOWER_LIP_OUTER, LOWER_LIP_INNER);
  const upperLipMat = getLipMat(upperLipColor);
  const lowerLipMat = getLipMat(lowerLipColor);
  const upperLipMesh = new THREE.Mesh(upperLip.geometry, upperLipMat);
  upperLipMesh.name = 'face-proc-lip-upper';
  const lowerLipMesh = new THREE.Mesh(lowerLip.geometry, lowerLipMat);
  lowerLipMesh.name = 'face-proc-lip-lower';
  group.add(upperLipMesh, lowerLipMesh);

  // ---- Phase E: teeth (always present, hidden until jawOpen > threshold) ----
  // Two flat-fronted boxes, sized so they read as "incisor strip" rather than
  // a single tooth at this scale. Upper sits inside the upper inner-lip ring
  // centroid, recessed slightly behind the lip plane. Lower is a CHILD of the
  // lower-lip mesh — when jawOpen drops the lower-lip ring, the lower teeth
  // ride along automatically.
  const upperInnerCentroid = landmarkCentroid(rest, UPPER_LIP_INNER);
  const lowerInnerCentroid = landmarkCentroid(rest, LOWER_LIP_INNER);

  const teethUpperMesh = new THREE.Mesh(sharedTeethGeom, sharedTeethMat);
  teethUpperMesh.name = 'face-proc-teeth-upper';
  if (upperInnerCentroid) {
    // Sit just BELOW the upper-lip inner ring so the visible top edge of the
    // strip aligns with the inside-of-lip line; recess by 5 mm in z so the
    // lip vermilion sits in front and we don't see teeth at rest.
    teethUpperMesh.position.set(
      upperInnerCentroid.x,
      upperInnerCentroid.y - 0.006,
      upperInnerCentroid.z - 0.005,
    );
  }
  teethUpperMesh.visible = false;
  group.add(teethUpperMesh);

  const teethLowerMesh = new THREE.Mesh(sharedTeethGeom, sharedTeethMat);
  teethLowerMesh.name = 'face-proc-teeth-lower';
  if (lowerInnerCentroid) {
    // Compute the offset RELATIVE to the lower-lip mesh's local origin
    // (which is also at canonical-mesh-local 0,0,0 — the lip mesh has no
    // transform). So mesh-local coords work directly. Sit just ABOVE the
    // lower-lip inner-ring centroid so the strip's top edge aligns with the
    // lower lip line; recess in z.
    teethLowerMesh.position.set(
      lowerInnerCentroid.x,
      lowerInnerCentroid.y + 0.006,
      lowerInnerCentroid.z - 0.005,
    );
  }
  teethLowerMesh.visible = false;
  // Parent to the lower-lip mesh so when its geometry rebuilds vertex
  // positions per frame and re-centers, the teeth follow. (Three.js doesn't
  // recompute child world positions from parent geometry deformation —
  // children inherit only the parent's transform. That's fine here: the
  // lower-lip MESH has identity transform; only its geometry's verts move.
  // So the lower teeth strip stays at the LOWER-LIP-AT-REST inner-ring
  // centroid, which is the right anchor — we don't want the strip wobbling
  // around with every speech micro-shape, only opening + closing with the
  // overall jaw drop.)
  lowerLipMesh.add(teethLowerMesh);

  // ---- Phase E: tongue (visibility-only, jawOpen > 0.3) ----
  // A small flattened sphere parented to the lower-lip mesh, sized to lip
  // width. Visible only when jaw is clearly open.
  const lipXExtent = landmarkXExtent(rest, LOWER_LIP_OUTER);
  const tongueRadius = Math.max(0.005, lipXExtent * 0.4);
  const tongueGeom = new THREE.SphereGeometry(tongueRadius, 8, 6);
  const tongueMesh = new THREE.Mesh(tongueGeom, sharedTongueMat);
  tongueMesh.name = 'face-proc-tongue';
  tongueMesh.scale.set(1.4, 0.5, 1.0);
  if (lowerInnerCentroid) {
    // Slightly above the lower-lip inner-ring centroid + slightly recessed
    // (behind the lip plane) so the tongue sits inside the mouth, not
    // outside.
    tongueMesh.position.set(
      lowerInnerCentroid.x,
      lowerInnerCentroid.y + 0.004,
      lowerInnerCentroid.z - 0.008,
    );
  }
  tongueMesh.visible = false;
  lowerLipMesh.add(tongueMesh);

  // ---- Phase E: eyelashes (only when prominent) ----
  // Built per-side, parented to the procedural-face group (NOT the lid mesh
  // — the lid mesh's geometry rebuilds wholesale every frame, and a child
  // of an Object3D inherits only the parent's transform, not its geometry
  // deformation). Per-frame we re-read the upper-lid landmark positions and
  // rewrite the lash strip's vertex buffer so the lashes ride the blink.
  let lashLeft: LashGeom | null = null;
  let lashRight: LashGeom | null = null;
  let lashLeftMesh: THREE.Mesh | null = null;
  let lashRightMesh: THREE.Mesh | null = null;
  if (features.eyelashes && features.eyelashes.prominent) {
    const lashColor = features.eyelashes.color ?? DEFAULT_LASH_COLOR;
    const lashMat = getLashMat(lashColor);
    // Lash strip dimensions: about 5 mm tall, 1 mm wide each. Sits with a
    // small forward offset (slightly in front of the lid Z-offset) so it
    // doesn't z-fight with the lid skin.
    const lashLen = 0.005;
    const lashHalfW = 0.0008;
    const lashFwdZ = lidZOffset + 0.001;
    lashLeft = buildLashGeometry(
      rest,
      LEFT_UPPER_LASH_ANCHORS,
      lashLen,
      lashHalfW,
      lashFwdZ,
    );
    lashRight = buildLashGeometry(
      rest,
      RIGHT_UPPER_LASH_ANCHORS,
      lashLen,
      lashHalfW,
      lashFwdZ,
    );
    lashLeftMesh = new THREE.Mesh(lashLeft.geometry, lashMat);
    lashLeftMesh.name = 'face-proc-lash-left';
    lashRightMesh = new THREE.Mesh(lashRight.geometry, lashMat);
    lashRightMesh.name = 'face-proc-lash-right';
    group.add(lashLeftMesh, lashRightMesh);
  }

  // ---- Phase E: beard (per-region, density-gated) ----
  // For each region with density > BEARD_DENSITY_THRESHOLD, build a small
  // triangle-fan patch from the region's defining landmarks. Material
  // opacity tracks density so denser detection reads as more solid.
  const beardGeoms: BeardGeom[] = [];
  const beardMeshes: THREE.Mesh[] = [];
  if (features.beard) {
    for (const regionKey of Object.keys(features.beard) as BeardRegion[]) {
      const data = features.beard[regionKey];
      if (!data) continue;
      if (data.density <= BEARD_DENSITY_THRESHOLD) continue;
      const indices = BEARD_REGION_LANDMARKS[regionKey];
      if (!indices) continue;
      const geom = buildBeardGeometry(rest, indices);
      if (!geom) continue;
      const color = data.hairColor ?? DEFAULT_BEARD_COLOR;
      // density * 1.5, clamped 0..1.
      const opacity = Math.max(0, Math.min(1, data.density * 1.5));
      const mat = getBeardMat(color, opacity);
      const mesh = new THREE.Mesh(geom.geometry, mat);
      mesh.name = `face-proc-beard-${regionKey}`;
      beardGeoms.push(geom);
      beardMeshes.push(mesh);
      group.add(mesh);
    }
  }

  // Track per-instance geometries for disposal. Materials are module-shared
  // (skin/brow/lip caches keyed by RGB) and survive disposal — the next
  // ProceduralFace either reuses the cached entries or adds new ones for
  // a different sampled color.
  const ownedGeometries: THREE.BufferGeometry[] = [
    lidLeftUpper.geometry,
    lidRightUpper.geometry,
    browLeft.geometry,
    browRight.geometry,
    upperLip.geometry,
    lowerLip.geometry,
    // Phase D: nose is now per-face, so we own its geometry too.
    noseGeom,
    // Phase E: tongue sphere geometry is per-face (sized by lip extent).
    tongueGeom,
  ];
  // Phase E: lash + beard geometries are per-face when present.
  if (lashLeft) ownedGeometries.push(lashLeft.geometry);
  if (lashRight) ownedGeometries.push(lashRight.geometry);
  for (const g of beardGeoms) ownedGeometries.push(g.geometry);

  // Phase B default: hideCanonical=false means BOTH render. The actual
  // visibility flip is owned by the caller (player.ts) via the
  // `__faceMode` global; we just respect the explicit `hideCanonical`
  // option if the caller set it.
  void opts.hideCanonical;

  let disposed = false;
  // Phase E: live blendshape source for conditional features (teeth/tongue
  // visibility). Set by `setBlendshapeSource`; null until the caller wires
  // a puppet in (face-mirror, anim-viewer, player-editor all do this when
  // creating the puppet). Without a source, conditional features stay
  // hidden — fail-closed.
  let blendshapeSource: BlendshapeSource | null = null;
  // Phase E: cache last-applied visibility states so we don't thrash
  // mesh.visible on every frame (write-through to Three.js dirties the
  // render-state). Toggle only on actual transitions.
  let teethVisible = false;
  let tongueVisible = false;

  return {
    group,
    update(): void {
      if (disposed) return;
      // Read the now-deformed positions from the canonical mesh's live
      // attribute. The puppet has already written through this same array
      // on the current frame's apply() call.
      const liveArr = (built.mesh.geometry.attributes.position as THREE.BufferAttribute)
        .array as Float32Array;
      updateLidGeometry(liveArr, lidLeftUpper);
      updateLidGeometry(liveArr, lidRightUpper);
      updateBrowGeometry(liveArr, browLeft);
      updateBrowGeometry(liveArr, browRight);
      updateLipGeometry(liveArr, upperLip);
      updateLipGeometry(liveArr, lowerLip);
      // Nose is static (Phase B) — no update.

      // Phase E: lashes ride the upper-lid landmarks directly. (Children of
      // the procedural-face group, not the lid mesh — lid mesh re-emits its
      // entire vertex buffer per frame, and Object3D children only inherit
      // the parent's transform, not its geometry deformation.)
      if (lashLeft) updateLashGeometry(liveArr, lashLeft);
      if (lashRight) updateLashGeometry(liveArr, lashRight);

      // Phase E: beard patches follow the canonical landmarks via direct
      // landmark reads — so jaw motion, chin drop, and overall head shape
      // shifts deform the patches in lockstep.
      for (const beardGeom of beardGeoms) {
        updateBeardGeometry(liveArr, beardGeom);
      }

      // Phase E: teeth + tongue visibility off the SMOOTHED jawOpen
      // coefficient (read via the BlendshapeSource — the puppet's EMA
      // state, NOT the raw MediaPipe output, which jitters ±0.05 even on a
      // still mouth and would flicker the strip).
      const jawOpen = blendshapeSource?.getSmoothedValue('jawOpen') ?? 0;
      const wantTeeth = jawOpen > TEETH_JAWOPEN_THRESHOLD;
      const wantTongue = jawOpen > TONGUE_JAWOPEN_THRESHOLD;
      if (wantTeeth !== teethVisible) {
        teethVisible = wantTeeth;
        teethUpperMesh.visible = wantTeeth;
        teethLowerMesh.visible = wantTeeth;
      }
      if (wantTongue !== tongueVisible) {
        tongueVisible = wantTongue;
        tongueMesh.visible = wantTongue;
      }
    },
    setVisible(v: boolean): void {
      group.visible = v;
    },
    setBlendshapeSource(src: BlendshapeSource | null): void {
      blendshapeSource = src;
      // When detaching the source, hide conditional features immediately
      // so they don't strand visible at the last-known jawOpen value when
      // a replay loop ends.
      if (!src) {
        if (teethVisible) {
          teethVisible = false;
          teethUpperMesh.visible = false;
          teethLowerMesh.visible = false;
        }
        if (tongueVisible) {
          tongueVisible = false;
          tongueMesh.visible = false;
        }
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const g of ownedGeometries) g.dispose();
      // Materials + module-shared geometries (teeth box, lash colors keyed)
      // are module-shared; do NOT dispose. Lash strips own per-instance
      // geometries, beard meshes own per-instance geometries — both already
      // tracked in ownedGeometries above.
      // Detach lash + beard meshes from the group so dispose doesn't leave
      // dangling references that hold the Three.js material cache live.
      if (lashLeftMesh) group.remove(lashLeftMesh);
      if (lashRightMesh) group.remove(lashRightMesh);
      for (const m of beardMeshes) group.remove(m);
      // Detach lower-lip children (teeth + tongue) so they don't survive
      // when the lower-lip mesh is removed.
      lowerLipMesh.remove(teethLowerMesh);
      lowerLipMesh.remove(tongueMesh);
      blendshapeSource = null;
      group.clear();
    },
  };
}
