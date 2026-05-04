/**
 * Build a 3D Three.js mesh from a single MediaPipe FaceLandmarker capture.
 *
 * Inputs: 478 normalized landmarks (image-space x∈[0,1], y∈[0,1], z relative
 * depth) + the front-pose photo as a data URL. Output: a `THREE.Mesh` with
 * a tessellated `BufferGeometry`, a UV-mapped sRGB texture, and a
 * `MeshBasicMaterial` (no lighting — the photo carries shading already).
 *
 * Coordinate-space conversion (MediaPipe → Three.js):
 *   x_three = x_mp - 0.5         (center on origin)
 *   y_three = -(y_mp - 0.5)      (Y is top-down in image space, +up in Three)
 *   z_three = -z_mp              (MediaPipe -z = closer to camera; Three +z = toward camera)
 *
 * The resulting mesh's "front" (eyes/nose) faces +z in Three.js space, which
 * matches the dad-bod head's existing forward direction (the existing
 * face-plane sits at +cfg.head.facePlaneZ).
 */
import * as THREE from 'three';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  getInnerMouthTrianglesFiltered,
  INNER_LIP_RING_INDICES,
} from './facemesh-topology';

export interface BuildFaceMeshOptions {
  /** @deprecated Phase 7.8 — the mesh was briefly sized by eye-anatomy (see
   *  `rigEyeDist` below). Phase F6 reverted to height-based fitting because
   *  the iris-anatomy lock made the mesh ~0.5 m tall in mesh-local coords,
   *  which dropped the chin below the head sphere (lips ended up at chest).
   *  Both options remain on the interface for source-compat with callers
   *  that pass them, but neither is read by `buildFaceMesh` any more. */
  targetHeight?: number;
  /** @deprecated Phase F6 — see `targetHeight`. The mesh is now sized so
   *  forehead-to-chin matches `HEAD_FACE_AREA` (0.42 m), which fits the
   *  head sphere's face zone with small margins. The actual iris distance
   *  after scaling is whatever the user's face proportions imply (typical
   *  0.16–0.22 m), exposed on `BuiltFaceMesh.irisMidpoint`. */
  rigEyeDist?: number;
}

/** Phase F6 — target face height (forehead-to-chin) in mesh-local meters.
 *  Covers the head sphere's face area: chin lands at neck-y ≈ 0.12,
 *  forehead at neck-y ≈ 0.54 (small margins above/below the head's
 *  vertical extent so the mesh doesn't poke through the top of the skull
 *  or below the jaw silhouette). The mesh is scaled uniformly so its
 *  raw forehead-to-chin extent maps to this value. */
const HEAD_FACE_AREA = 0.42;
/** Phase F6 — sanity bounds on the height-fit scale. A face whose raw
 *  bbox-y extent falls outside these bounds is almost certainly the
 *  result of degenerate landmarks (very narrow / very tall normalized
 *  capture) — clamping prevents a runaway mesh that explodes the rig.
 *
 *  Real captures land in `S ≈ 0.5` (typical raw face height ~0.8). The
 *  bounds are intentionally loose around that — a 2× squash from a
 *  bad scan is recoverable; a 5× explosion is not. */
const SCALE_MIN = 0.4;
const SCALE_MAX = 2.0;

export interface BuiltFaceMesh {
  geometry: THREE.BufferGeometry;
  texture: THREE.Texture;
  mesh: THREE.Mesh;
  /** A dark plane positioned just behind the lip plane. Becomes visible
   *  through the inner-mouth hole (left after filtering inner-mouth tris)
   *  when the lips part (jawOpen / mouthShrug etc.). Mounted alongside
   *  the face mesh; has no animation of its own — just a static dark
   *  surface that the lip ring opens around. */
  mouthInterior: THREE.Mesh;
  /** The bounding-box scale applied to the raw landmark space → output mesh.
   *  Useful for debugging (preview canvas can re-derive a fitted camera distance). */
  scale: number;
  /** The translation applied to center the mesh on origin (in raw-landmark
   *  units, BEFORE the scale). Exposed so callers that want to layer their
   *  own transforms can replicate the centering. */
  centerOffset: THREE.Vector3;
  /** Phase F6 — the inter-iris midpoint position in the mesh's final local
   *  coordinate space (post-scale, post-center). Callers that mount the
   *  mesh inside a rig slot use this to align the user's eyes with the
   *  rig's eye anatomy: position the slot at `(rig.eyeAnatomy.x,y,z)`
   *  and offset the mesh by `-irisMidpoint` so the irises land on the
   *  rig anchor. Y/Z are typically slightly above/in-front of origin
   *  because the bbox-center ≠ iris-midpoint for a real face (more
   *  forehead above the eyes than chin below). */
  irisMidpoint: { x: number; y: number; z: number };
}

/**
 * Build the face mesh from one set of front-pose landmarks + the matching
 * photo. Always returns a fresh geometry/texture/mesh — caller owns disposal.
 *
 * @param landmarks 478 normalized landmarks (front pose).
 * @param imageDataUrl PNG/JPEG data URL of the front photo. Used as the texture.
 * @param opts See `BuildFaceMeshOptions`.
 */
export function buildFaceMesh(
  landmarks: ReadonlyArray<NormalizedLandmark>,
  imageDataUrl: string,
  opts: BuildFaceMeshOptions = {},
): BuiltFaceMesh {
  // Both `targetHeight` and `rigEyeDist` retained for type-compat but
  // unused — see option docstrings.
  void opts.targetHeight;
  void opts.rigEyeDist;

  if (!landmarks || landmarks.length === 0) {
    throw new Error('buildFaceMesh: empty landmark array');
  }
  // The canonical mesh has 478 vertices. We don't strictly require all 478
  // (e.g. for tests we might pass a subset), but the tessellation will skip
  // any triangle whose indices fall outside the supplied count.
  const VCOUNT = landmarks.length;

  // ---- Vertices (raw, MediaPipe → Three.js conversion) ----
  // First pass: convert into a flat Float32Array of [x0,y0,z0,x1,y1,z1,...].
  const positions = new Float32Array(VCOUNT * 3);
  for (let i = 0; i < VCOUNT; i++) {
    const lm = landmarks[i];
    positions[i * 3 + 0] = lm.x - 0.5;
    positions[i * 3 + 1] = -(lm.y - 0.5);
    positions[i * 3 + 2] = -lm.z;
  }

  // ---- Phase F6: face-height fit (replaces eye-anatomy lock) ----
  //
  // Why we abandoned the eye-anatomy lock:
  //   The Phase 7.8 implementation set `S = rigEyeDist / D3` so the mesh's
  //   inter-iris distance landed on the rig's 0.2 m eye anchor exactly.
  //   But a real face's forehead-to-chin extent is ~5× the iris distance,
  //   so this scale produced a ~0.5 m mesh in mesh-local coords — far
  //   taller than the rig's head sphere can contain. After mounting at
  //   the rig's eye-anatomy slot the chin landed at neck-y ≈ -0.1, BELOW
  //   the head sphere's bottom (≈ 0.04). Lips/brows/nose/eyelids inherited
  //   the misalignment via the procedural-face landmark reads → "Mr.
  //   Potato Head pieces floating around" (lips at chest, eyelids past
  //   the head silhouette as ears, brows above the head).
  //
  // The new contract:
  //   The mesh's forehead-to-chin extent is fit to `HEAD_FACE_AREA`
  //   (0.42 m), which fits inside the head sphere with small margins.
  //   Inter-iris distance becomes a derived quantity — a narrow-faced
  //   user's eyes land ~0.18 m apart, a wide-faced user's ~0.22 m. The
  //   rig's eye-spheres remain at the fixed `(±eyeOffsetX, …)` rig
  //   position — they no longer sit exactly under every user's irises.
  //   For v1 the small mismatch is acceptable (a few mm of offset); the
  //   alternative (forcing every user's eyes onto the rig anchor) made
  //   the entire face unusable.
  //
  //   `irisMidpoint` on the returned BuiltFaceMesh tells callers where
  //   the eyes ended up so they can position the mount slot to align
  //   irises with the rig's eye anatomy.
  let xmin = Infinity, xmax = -Infinity;
  let ymin = Infinity, ymax = -Infinity;
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 0; i < VCOUNT; i++) {
    const x = positions[i * 3 + 0];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x === 0 && y === 0 && z === 0) continue;
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
    if (z < zmin) zmin = z;
    if (z > zmax) zmax = z;
  }
  // Center on the bbox center — this puts the mesh's geometric centroid
  // on origin in mesh-local space. Iris midpoint is computed AFTER
  // centering + scaling so callers can mount with eyes-on-anchor.
  const cx = Number.isFinite(xmin) && Number.isFinite(xmax) ? (xmin + xmax) * 0.5 : 0;
  const cy = Number.isFinite(ymin) && Number.isFinite(ymax) ? (ymin + ymax) * 0.5 : 0;
  const cz = Number.isFinite(zmin) && Number.isFinite(zmax) ? (zmin + zmax) * 0.5 : 0;
  // Forehead-to-chin extent in raw (post-coord-conversion, pre-scale)
  // landmark space. For a typical front-pose capture this lands ~0.6–0.85.
  const meshFaceHeight = Number.isFinite(ymin) && Number.isFinite(ymax)
    ? ymax - ymin
    : 0;
  let scale = meshFaceHeight > 1e-6 ? HEAD_FACE_AREA / meshFaceHeight : 1;
  if (!Number.isFinite(scale)) scale = 1;
  const Sclamped = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale));
  if (Sclamped !== scale) {
    console.warn(
      `[mesh-builder] scale clamped: raw S=${scale.toFixed(3)} → ${Sclamped.toFixed(3)}. ` +
        `Out-of-range usually means degenerate landmarks (raw face height ` +
        `${meshFaceHeight.toFixed(3)} far from typical 0.6–0.85).`,
    );
    scale = Sclamped;
  }
  for (let i = 0; i < VCOUNT; i++) {
    positions[i * 3 + 0] = (positions[i * 3 + 0] - cx) * scale;
    positions[i * 3 + 1] = (positions[i * 3 + 1] - cy) * scale;
    positions[i * 3 + 2] = (positions[i * 3 + 2] - cz) * scale;
  }

  // ---- Iris midpoint (post-scale, post-center) ----
  // Read AFTER centering + scaling so callers see the actual mesh-local
  // position the irises ended up at. Falls back to eye-outer corners
  // (33/263) if the iris vertices are missing or zero (e.g. test subsets).
  const LEFT_IRIS = 468;
  const RIGHT_IRIS = 473;
  const LEFT_EYE_OUTER = 33;
  const RIGHT_EYE_OUTER = 263;
  const isDegenerate = (idx: number): boolean => {
    if (idx * 3 + 2 >= positions.length) return true;
    const x = positions[idx * 3 + 0];
    const y = positions[idx * 3 + 1];
    const z = positions[idx * 3 + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return true;
    if (x === 0 && y === 0 && z === 0) return true;
    return false;
  };
  const leftIdx = isDegenerate(LEFT_IRIS) ? LEFT_EYE_OUTER : LEFT_IRIS;
  const rightIdx = isDegenerate(RIGHT_IRIS) ? RIGHT_EYE_OUTER : RIGHT_IRIS;
  const irisMidpoint = {
    x:
      (positions[leftIdx * 3 + 0] + positions[rightIdx * 3 + 0]) * 0.5,
    y:
      (positions[leftIdx * 3 + 1] + positions[rightIdx * 3 + 1]) * 0.5,
    z:
      (positions[leftIdx * 3 + 2] + positions[rightIdx * 3 + 2]) * 0.5,
  };
  if (!Number.isFinite(irisMidpoint.x)) irisMidpoint.x = 0;
  if (!Number.isFinite(irisMidpoint.y)) irisMidpoint.y = 0;
  if (!Number.isFinite(irisMidpoint.z)) irisMidpoint.z = 0;

  // ---- UVs ----
  // Image-space coords with V flipped — THREE.TextureLoader puts (0,0) at
  // the top-left of the image, but UV space puts (0,0) at bottom-left, so
  // V = 1 - y maps the texture right-side-up onto the mesh.
  const uvs = new Float32Array(VCOUNT * 2);
  for (let i = 0; i < VCOUNT; i++) {
    uvs[i * 2 + 0] = landmarks[i].x;
    uvs[i * 2 + 1] = 1 - landmarks[i].y;
  }

  // ---- Indices (triangles from the canonical tesselation) ----
  // Use the filtered list — triangles whose three vertices are ALL in the
  // inner-lip ring are removed so the mouth is no longer a closed shell.
  // This opens a hole through which the dark `mouthInterior` plane (built
  // below) shows when `jawOpen` deforms the lower-lip ring downward.
  const tris = getInnerMouthTrianglesFiltered();

  // ---- Geometry ----
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (tris.length > 0) {
    geometry.setIndex(new THREE.BufferAttribute(tris, 1));
  }
  geometry.computeVertexNormals();

  // ---- Texture ----
  const loader = new THREE.TextureLoader();
  const texture = loader.load(imageDataUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  // The data URL decodes near-instant, but tag the texture so any code that
  // disposes it later can recognize it as ours.
  texture.name = 'face-mesh-3d-texture';

  // ---- Material + Mesh ----
  // MeshBasicMaterial: the photo already encodes the lighting from the
  // capture environment, so re-lighting it via MeshStandardMaterial would
  // double-light. DoubleSide because the canonical FaceMesh tessellation
  // doesn't enforce a consistent winding order across the whole face;
  // forcing a side would let some triangles render invisibly.
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    // No `transparent: true` — the topology is closed and self-occluding,
    // so transparency would just trip the depth-sort (and washes out the
    // texture from behind the mesh).
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'face-mesh-3d';

  // ---- Mouth interior plane ----
  // A static, near-black plane positioned just behind the lip plane so that
  // when the lips part (the `jawOpen` blendshape pulls the lower inner-lip
  // ring down) the hole left by `getInnerMouthTrianglesFiltered` reveals
  // dark instead of stretching skin or showing the back of the head. The
  // plane lives in mesh-local coordinates (same space as the face mesh's
  // vertices after centering + scaling), so it inherits world placement
  // from whatever parent the BuiltFaceMesh is mounted to.
  let mouthMinX = Infinity,
    mouthMaxX = -Infinity;
  let mouthMinY = Infinity,
    mouthMaxY = -Infinity;
  let mouthSumX = 0,
    mouthSumY = 0,
    mouthSumZ = 0,
    mouthCount = 0;
  for (const idx of INNER_LIP_RING_INDICES) {
    if (idx * 3 + 2 >= positions.length) continue;
    const px = positions[idx * 3 + 0];
    const py = positions[idx * 3 + 1];
    const pz = positions[idx * 3 + 2];
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
    if (px < mouthMinX) mouthMinX = px;
    if (px > mouthMaxX) mouthMaxX = px;
    if (py < mouthMinY) mouthMinY = py;
    if (py > mouthMaxY) mouthMaxY = py;
    mouthSumX += px;
    mouthSumY += py;
    mouthSumZ += pz;
    mouthCount++;
  }
  // Fallback if for some reason the ring is empty (degenerate landmarks).
  // A tiny invisible plane placed at the origin keeps the type contract
  // intact without rendering anything noticeable.
  let mouthWidth = 0.05;
  let mouthHeight = 0.03;
  let mouthCx = 0,
    mouthCy = 0,
    mouthCz = 0;
  if (mouthCount > 0 && Number.isFinite(mouthMinX) && Number.isFinite(mouthMinY)) {
    const w = mouthMaxX - mouthMinX;
    const h = mouthMaxY - mouthMinY;
    // Slightly larger than the hole so it stays visible through any
    // reasonable jaw-open displacement, but small enough not to bleed past
    // the cheeks. 1.4× horizontal, 1.8× vertical (the lower lip travels
    // farther vertically than the corners spread horizontally).
    mouthWidth = Math.max(0.01, w * 1.4);
    mouthHeight = Math.max(0.01, h * 1.8);
    mouthCx = mouthSumX / mouthCount;
    mouthCy = mouthSumY / mouthCount;
    mouthCz = mouthSumZ / mouthCount;
  }
  const mouthGeometry = new THREE.PlaneGeometry(mouthWidth, mouthHeight);
  const mouthMaterial = new THREE.MeshBasicMaterial({
    color: 0x0a0a0a,
    side: THREE.DoubleSide,
  });
  const mouthInterior = new THREE.Mesh(mouthGeometry, mouthMaterial);
  mouthInterior.name = 'face-mouth-interior';
  // Position at the inner-lip ring's centroid, with a small recess (~5 mm
  // in mesh-local units, which after scaling lands roughly at the
  // millimeter scale) so the dark plane sits just behind the lip surface
  // rather than co-planar (which would z-fight) or so far back that it
  // pokes through the back of the head from non-front angles.
  mouthInterior.position.set(mouthCx, mouthCy, mouthCz - 0.005);

  return {
    geometry,
    texture,
    mesh,
    mouthInterior,
    scale,
    centerOffset: new THREE.Vector3(cx, cy, cz),
    irisMidpoint,
  };
}

/**
 * Convert a flat-stored landmark array (the format used in `FaceImage.mesh3d`
 * and `FaceImage.mesh3d.angles[].landmarks`) back into the array-of-objects
 * shape MediaPipe natively returns. Helper for callers that loaded a
 * persisted mesh3d entry from IDB.
 */
export function unflattenLandmarks(flat: number[]): NormalizedLandmark[] {
  if (flat.length % 3 !== 0) {
    throw new Error(
      `unflattenLandmarks: flat array length ${flat.length} not divisible by 3`,
    );
  }
  const out: NormalizedLandmark[] = [];
  for (let i = 0; i < flat.length; i += 3) {
    out.push({
      x: flat[i],
      y: flat[i + 1],
      z: flat[i + 2],
      visibility: 0,
    } as unknown as NormalizedLandmark);
  }
  return out;
}

/**
 * Flatten an array of NormalizedLandmark into [x0,y0,z0,x1,y1,z1,...] for
 * persistence. Keeps the .x/.y/.z fields and drops .visibility/.presence
 * (we don't use them in the 3D path).
 */
export function flattenLandmarks(
  landmarks: ReadonlyArray<NormalizedLandmark>,
): number[] {
  const out = new Array<number>(landmarks.length * 3);
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    out[i * 3 + 0] = lm.x;
    out[i * 3 + 1] = lm.y;
    out[i * 3 + 2] = lm.z;
  }
  return out;
}

/**
 * Convenience wrapper for the IDB-load path. Reads a persisted `FaceImage`
 * with `mesh3d` populated and rebuilds the mesh. Caller still owns disposal.
 */
export function buildFaceMeshFromStored(
  vertices: number[],
  uvs: number[],
  imageDataUrl: string,
  opts: BuildFaceMeshOptions = {},
): BuiltFaceMesh {
  // The stored vertices are already in raw MediaPipe landmark space (0..1
  // with Y top-down) — we treat them as pseudo-landmarks so buildFaceMesh's
  // single coord-conversion path remains the source of truth.
  if (vertices.length % 3 !== 0) {
    throw new Error('buildFaceMeshFromStored: vertices length not divisible by 3');
  }
  if (uvs.length * 3 !== vertices.length * 2) {
    throw new Error(
      `buildFaceMeshFromStored: uvs/vertices count mismatch ` +
        `(uvs=${uvs.length}, vertices=${vertices.length})`,
    );
  }
  const lm: NormalizedLandmark[] = [];
  for (let i = 0; i < vertices.length; i += 3) {
    lm.push({
      x: vertices[i],
      y: vertices[i + 1],
      z: vertices[i + 2],
      visibility: 0,
    } as unknown as NormalizedLandmark);
  }
  return buildFaceMesh(lm, imageDataUrl, opts);
}
