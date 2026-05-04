/**
 * G1 — Build a coherent head MESH from captured 3D scan data.
 *
 * Replaces the dad-bod head sphere (`SphereGeometry(cfg.head.radius, 8, 6)`)
 * with a single visual head built from:
 *
 *   1. Front face — the canonical 478-vertex height-fit mesh from
 *      `buildFaceMesh` (already textured with the front-pose photo). Sits
 *      slightly forward of the cranium so it occludes the front of the
 *      ellipsoid, hiding the seam.
 *   2. Cranium — ONE full skin-toned ellipsoid sized to encompass the
 *      whole head (face + crown + back-of-skull + sides). Sized from the
 *      profile-derived headDepth and the front mesh's chin-to-forehead
 *      height. The front face mesh sits IN FRONT of this ellipsoid (small
 *      Z-bias forward), and the ellipsoid's silhouette wraps around the
 *      face on every other axis — no separate side panels or back
 *      hemisphere needed (G1.v2: dropped because their seams looked like
 *      a pancake from 3/4 view).
 *   3. Geometric ears — small extruded ellipsoids positioned at temple
 *      level, offset BACKWARD from the cheek landmarks so they sit on the
 *      side of the cranium rather than poking out of the cheek plane.
 *
 * Why this matters: prior to G1 the rig had a sphere head + a separate flat
 * face mesh anchored at the eye-anatomy slot. The two didn't share geometry,
 * so from a 3-quarter view the face features looked like floating pieces
 * NEXT to the sphere head, not part of it. The head-mesh produces one
 * coherent silhouette that the face features integrate into.
 *
 * G1.v2 — first version of the head mesh shipped with no crown
 * (ellipsoid stopped at the brow line) and flat side panels that read as a
 * pancake. v2 replaces back-hemisphere + side panels with a single full
 * ellipsoid that includes the crown above the brow line.
 *
 * Coordinate spaces:
 *   - MediaPipe landmark space (image-relative): x∈[0,1] L→R, y∈[0,1] top→down,
 *     z = relative depth (negative is closer to camera).
 *   - Three.js mesh-local space (matches `buildFaceMesh` output):
 *       x_three = x_mp - 0.5      (centered, +x = subject's left)
 *       y_three = -(y_mp - 0.5)    (+y = up)
 *       z_three = -z_mp           (+z = forward, toward camera in front pose)
 *
 * For PROFILE poses the camera looks along the head-X axis, so the profile
 * image's X-axis encodes head DEPTH (Z in front-pose mesh-local) and the
 * profile's Y-axis still encodes head HEIGHT. We extract that depth signal
 * and re-emit it on mesh-local Z.
 */
import * as THREE from 'three';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { buildFaceMesh, type BuiltFaceMesh, type BuildFaceMeshOptions } from './mesh-builder';

/** Default skin tone used for back/sides/ears when no sampled tone is
 *  available. Mid-tan that reads as plausible for most users; matches the
 *  rig's hash-derived fallback bands but doesn't try to mimic any specific
 *  hash. The caller is expected to pass the sampled `bodySkinTone` /
 *  `skinTone` whenever it has one. */
const DEFAULT_SKIN_TONE = 0xc9a08a;

/** Canonical jaw silhouette indices (provided by the G1 brief; cross-checked
 *  against the canonical 478-vertex MediaPipe FaceMesh). Walks from the
 *  subject's right ear-line under the chin and back up to the left ear-line. */
const JAW_SILHOUETTE_INDICES: ReadonlyArray<number> = [
  127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152,
  377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356,
];

/** A subset of landmark indices that, in a profile pose, lie roughly on the
 *  silhouette curve from chin → temple → forehead apex. Used to sample the
 *  profile's Y-extent and depth-extent for the side ring. We use indices
 *  that are stable across both profile orientations; MediaPipe always emits
 *  all 478 vertices regardless of pose, but their image-space accuracy
 *  drops away from the visible side.
 *
 *  Concretely: chin (152) → lower jaw (148/149) → cheek/mid-side (123/132)
 *  → temple (162/127) → forehead apex (10). The ordering is bottom-up so
 *  the resulting ring walks the silhouette in a consistent direction. */
const PROFILE_SILHOUETTE_INDICES: ReadonlyArray<number> = [
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10,
];

/** Face-oval indices, used as a SECONDARY ring source so the side mesh has
 *  enough vertices to read as a continuous side surface and not a thin
 *  strip. Mirrored on the other side via X-negation when only one profile
 *  is available. */
const FOREHEAD_FORWARD_INDICES: ReadonlyArray<number> = [
  10, 109, 67, 103, 54, 21, 162, 127,
];

export interface BuiltHeadMesh extends BuiltFaceMesh {
  /** The complete head as a `THREE.Group` (named `head-mesh-group`)
   *  containing the front face mesh, side panels, back hemisphere, and ears.
   *  When mounted by `setFaceMesh3D`, this REPLACES the rig's head sphere
   *  (which gets `head.visible = false`). The group lives in mesh-local
   *  coords; the slot's offset translates the irisMidpoint onto the rig's
   *  eye anchor (same convention as `BuiltFaceMesh.mesh`). */
  headMesh: THREE.Group;
  /** Whether the head mesh was successfully built. False = caller should
   *  fall back to the existing sphere-head + flat front-face path. The
   *  `BuiltFaceMesh` portion is still valid in either case. */
  headMeshSuccess: boolean;
  /** When `headMeshSuccess` is true, the side-panel + back + ears meshes
   *  are listed here so the visibility-toggle path
   *  (`window.__faceMode === 'mesh'` hides them) and disposal can find
   *  them without traversing the group. */
  headExtras: THREE.Mesh[];
}

export interface BuildHeadMeshOptions extends BuildFaceMeshOptions {
  /** Skin tone for back/sides/ears. Default `DEFAULT_SKIN_TONE`. */
  skinTone?: number;
  /** Whether to include geometric ears. Default true. */
  ears?: boolean;
}

/** Convert a flat landmark array `[x0,y0,z0,...]` into mesh-local Three.js
 *  coords (the conversion `buildFaceMesh` performs on the front pose).
 *  Returns a `Float32Array` of length `count*3` with `[x,y,z,...]`. */
function toMeshLocalFlat(flat: ReadonlyArray<number>, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const off = i * 3;
    if (off + 2 >= flat.length) continue;
    const x = flat[off];
    const y = flat[off + 1];
    const z = flat[off + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    out[off + 0] = x - 0.5;
    out[off + 1] = -(y - 0.5);
    out[off + 2] = -z;
  }
  return out;
}

/** Read [x,y,z] from a Float32Array of mesh-local coords. Returns null if
 *  the slot is degenerate / out of range. */
function readVec3(
  arr: Float32Array,
  idx: number,
): { x: number; y: number; z: number } | null {
  const base = idx * 3;
  if (base + 2 >= arr.length) return null;
  const x = arr[base + 0];
  const y = arr[base + 1];
  const z = arr[base + 2];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  if (x === 0 && y === 0 && z === 0) return null;
  return { x, y, z };
}

interface ProfileAlignment {
  /** Mesh-local mesh-X-coord of the profile's "near side" (the side facing
   *  the camera). For profile-left this is +X; for profile-right -X. */
  sideSign: 1 | -1;
  /** Y-scale factor applied so chin-to-forehead distance in the profile
   *  matches the front mesh's chin-to-forehead distance (`HEAD_FACE_AREA`
   *  = 0.42m). */
  yScale: number;
  /** Y-translation applied AFTER scaling so the profile's chin lands on the
   *  front mesh's chin Y. */
  yShift: number;
  /** A measure of how far back (in mesh-local +Z when sideSign=+1, or -Z
   *  when sideSign=-1) the back-of-head extends past the cheek. Equal to
   *  `(noseTipZAfter - earBackZAfter)` so a positive value means the ear
   *  sits BEHIND the nose. Used to size the back hemisphere. */
  headDepth: number;
  /** Mesh-local Y of the chin in the FRONT mesh's space (the alignment
   *  target). */
  chinY: number;
  /** Mesh-local Y of the forehead apex in the FRONT mesh's space. */
  foreheadY: number;
  /** Aligned profile silhouette ring, mesh-local coords (one Vector3 per
   *  PROFILE_SILHOUETTE_INDICES entry). Z is the head-depth axis with the
   *  camera-facing side at +Z*sideSign. Some entries may be null when the
   *  source landmark is degenerate — caller filters before triangulating. */
  silhouette: Array<THREE.Vector3 | null>;
  /** Mesh-local +Z extent of the back-of-head past the chin's Z = 0
   *  midline. Equal to `max(0, |earBackZAfter|)` after re-orienting Z. */
  backZ: number;
}

/** Compute profile alignment: how to scale + translate a profile pose's
 *  landmarks into the same mesh-local space the front mesh occupies, AND
 *  re-orient the profile's image-X onto the front mesh's Z (head-depth).
 *
 *  Returns null when profile data is degenerate. */
function alignProfile(
  profileFlat: ReadonlyArray<number>,
  poseName: 'profile-left' | 'profile-right',
  frontChinY: number,
  frontForeheadY: number,
): ProfileAlignment | null {
  if (profileFlat.length < 478 * 3) return null;
  const VCOUNT = 478;
  const local = toMeshLocalFlat(profileFlat, VCOUNT);

  const chin = readVec3(local, 152);
  const fore = readVec3(local, 10);
  if (!chin || !fore) return null;

  // Profile-pose Y range (chin to forehead). In mesh-local space, +y is up,
  // so forehead.y > chin.y for a non-tilted profile.
  const profileYRange = fore.y - chin.y;
  const frontYRange = frontForeheadY - frontChinY;
  if (Math.abs(profileYRange) < 0.05 * Math.abs(frontYRange) || profileYRange === 0) {
    // Degenerate — chin and forehead Y too close. Almost certainly a bad
    // landmark detection on the profile.
    return null;
  }

  // Y-scale aligns the profile's chin-to-forehead extent to the front
  // mesh's same extent. yShift then puts the profile's chin on the front
  // mesh's chin Y (post-scale).
  const yScale = frontYRange / profileYRange;
  const yShift = frontChinY - chin.y * yScale;

  // The profile pose's image-X is the head-DEPTH axis. In mesh-local terms
  // (after the front-pose conversion of `toMeshLocalFlat`), the profile's
  // own x (`local[*+0]`) is meaningless — the camera looked along the
  // head's X axis, so the X coord in the profile only encodes which side
  // of the head a landmark lies on, not lateral position. We RE-INTERPRET
  // it as Z.
  //
  // Direction:
  //   - profile-left: subject turned to their left → camera sees subject's
  //     RIGHT side. The image's +x (left→right when viewing) maps to
  //     subject's BACK→FRONT, so a higher x ≈ more forward. We want
  //     +Z = forward in mesh-local, so set sign so depthZ = +(x - 0.5)*scale.
  //   - profile-right: subject turned right → camera sees subject's LEFT
  //     side. The image's +x maps to subject's FRONT→BACK, so the sign
  //     flips: depthZ = -(x - 0.5)*scale.
  //
  // We compute this empirically: nose (1) should land at maximum +Z
  // (front-most). If the raw signed nose.x indicates otherwise, flip.
  const noseRaw = readVec3(local, 1);
  if (!noseRaw) return null;

  // Side sign indicates which side of the head the side ring lives on.
  // profile-left → subject's RIGHT side visible → side ring at -X (subject's
  // right is rig -X if the subject faces the camera in front-pose).
  // profile-right → subject's LEFT side visible → side ring at +X.
  // Note: we do NOT use sideSign to position the side ring's X yet; we
  // place sides at full-width X derived from the FRONT mesh's cheek
  // landmark widths, then mirror to the other side. sideSign here is just
  // metadata for the caller.
  const sideSign: 1 | -1 = poseName === 'profile-right' ? 1 : -1;

  // Determine the depth-axis flip via the nose: nose-tip should be the
  // most "forward" point in profile, so its depth should be MAX. After
  // applying yScale + yShift, we still need to express the X coord as a
  // depth. Use the full profile X-extent as the depth scale: the image's
  // X spread covers the head's depth, so map:
  //   depthZ(idx) = (local[idx].x - midX) * depthScale * depthSign
  // where midX is the mid-of-extent and depthScale chosen so the profile's
  // own X-extent in landmark-units maps to roughly the same as the front
  // mesh's *Y* extent (so depth ≈ height in scale).
  let xMin = Infinity, xMax = -Infinity;
  for (const idx of PROFILE_SILHOUETTE_INDICES) {
    const v = readVec3(local, idx);
    if (!v) continue;
    if (v.x < xMin) xMin = v.x;
    if (v.x > xMax) xMax = v.x;
  }
  // Also sample the ear tragus (234/454) and forehead/temple to stretch
  // the X range to cover the back of the head. The silhouette indices
  // capture chin/temple but the back of the head isn't in the canonical
  // landmark set — we estimate it from the ear position by extending past.
  const earSubjectsLeft = readVec3(local, 234);
  const earSubjectsRight = readVec3(local, 454);
  if (earSubjectsLeft) { if (earSubjectsLeft.x < xMin) xMin = earSubjectsLeft.x; if (earSubjectsLeft.x > xMax) xMax = earSubjectsLeft.x; }
  if (earSubjectsRight) { if (earSubjectsRight.x < xMin) xMin = earSubjectsRight.x; if (earSubjectsRight.x > xMax) xMax = earSubjectsRight.x; }
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMax - xMin < 1e-6) return null;
  const xMid = (xMin + xMax) * 0.5;

  // Depth scale: map the profile's full X-extent to a head depth that's
  // proportional to the front mesh's height. A typical head is ~0.85x as
  // deep as it is tall, so depthScale = (0.85 * frontYRange) / (xMax - xMin).
  // This produces realistic head depths even if the profile pose was
  // captured at a slightly different scale than the front pose.
  const targetHeadDepth = 0.85 * Math.abs(frontYRange);
  const depthScale = targetHeadDepth / (xMax - xMin);

  // Direction: nose-tip should be MAX +Z. If applying our default mapping
  //   z = (x - xMid) * depthScale
  // makes the nose come out negative, we flip the sign.
  let depthSign: 1 | -1 = 1;
  const noseDepthRaw = (noseRaw.x - xMid) * depthScale;
  // Compare to ear depth: ear is BEHIND the nose, so |earDepth - noseDepth|
  // should be roughly the head depth, with nose more positive.
  const earX =
    earSubjectsLeft && earSubjectsRight
      ? (Math.abs(earSubjectsLeft.x - noseRaw.x) > Math.abs(earSubjectsRight.x - noseRaw.x)
          ? earSubjectsLeft.x
          : earSubjectsRight.x)
      : earSubjectsLeft?.x ?? earSubjectsRight?.x ?? null;
  if (earX !== null) {
    const earDepthRaw = (earX - xMid) * depthScale;
    if (noseDepthRaw < earDepthRaw) depthSign = -1;
  } else {
    // Fallback: profile-left captures subject's right side; in MediaPipe
    // image coords the subject's nose is typically on the LEFT of the
    // image (lower x) for a profile-left pose, so a negative depthSign
    // gives nose=+Z. The reverse for profile-right.
    depthSign = poseName === 'profile-left' ? -1 : 1;
  }

  // Build the silhouette ring in mesh-local coords. Each entry's X stays
  // 0 (we'll position rings at fixed X from the front mesh's cheek width
  // later) — we only output Y and Z here, with X to be filled by the
  // caller. We DO emit a Vector3 with x=0 for now and let the caller
  // overwrite x.
  const silhouette: Array<THREE.Vector3 | null> = [];
  for (const idx of PROFILE_SILHOUETTE_INDICES) {
    const v = readVec3(local, idx);
    if (!v) {
      silhouette.push(null);
      continue;
    }
    const z = (v.x - xMid) * depthScale * depthSign;
    const y = v.y * yScale + yShift;
    silhouette.push(new THREE.Vector3(0, y, z));
  }

  // Headdepth from the alignment: nose-tip at +depth, ear-back at -depth.
  // We use targetHeadDepth as a conservative estimate.
  const headDepth = targetHeadDepth;
  // Back-of-head extent past Z=0: half the head depth (the front face
  // already extends ~half-head-depth in front of Z=0, so the back covers
  // the other half).
  const backZ = targetHeadDepth * 0.5;

  return {
    sideSign,
    yScale,
    yShift,
    headDepth,
    chinY: frontChinY,
    foreheadY: frontForeheadY,
    silhouette,
    backZ,
  };
}

/** Read the front-mesh's chin (152) and forehead apex (10) Y-coords. The
 *  front mesh is height-fit to `HEAD_FACE_AREA = 0.42m`, so chin ≈ -0.21
 *  and forehead ≈ +0.21 in mesh-local space. */
function readFrontMeshYExtents(built: BuiltFaceMesh): {
  chinY: number;
  foreheadY: number;
  cheekHalfWidth: number;
} | null {
  const posAttr = built.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!posAttr) return null;
  const arr = posAttr.array as Float32Array;
  const chin = readVec3(arr, 152);
  const fore = readVec3(arr, 10);
  if (!chin || !fore) return null;
  // Cheek width: distance from cheek-left (234) to cheek-right (454) on
  // the front mesh, divided by 2 = half-width (the X-position of each
  // side ring).
  const cheekL = readVec3(arr, 234);
  const cheekR = readVec3(arr, 454);
  let halfWidth = 0.18; // sensible default if cheek landmarks missing
  if (cheekL && cheekR) {
    halfWidth = Math.abs(cheekR.x - cheekL.x) * 0.5;
    if (!Number.isFinite(halfWidth) || halfWidth < 0.05) halfWidth = 0.18;
  }
  return { chinY: chin.y, foreheadY: fore.y, cheekHalfWidth: halfWidth };
}

/** Build the cranium — ONE full skin-toned ellipsoid that encompasses
 *  the whole head: face plane, sides, back-of-skull, and CROWN above the
 *  brow line. The textured front face mesh sits in front of this
 *  ellipsoid (small Z-bias) and occludes its front-facing portion, so
 *  the user sees: front face → (around the silhouette) the cranium skin
 *  curving into the back of the head.
 *
 *  This replaces the v1 architecture of (back-hemisphere + 2 side
 *  panels), which read as a flat-sided pancake from 3/4 view because
 *  the side panels were 2-column strips at fixed X.
 *
 *  Sizing (drives the human-head-shape silhouette):
 *    width   = 0.95 × face-height  (head is slightly narrower than tall)
 *    height  = 1.40 × face-height  (~40% crown above brow line)
 *    depth   = 1.15 × face-height  (head is deeper than face is tall)
 *
 *  Y-center: face midpoint shifted UP by 20% of face-height so the
 *  ellipsoid extends roughly chin-level → forehead+0.5×face-height
 *  (the crown sits well above the brow line).
 *
 *  Z-center: -0.30 × face-height — most of the head is BEHIND the front
 *  face plane (the face is the front ~30-40% of the head's depth). */
function buildCraniumEllipsoid(
  frontChinY: number,
  frontForeheadY: number,
  cheekHalfWidth: number,
  profileHeadDepth: number,
  material: THREE.Material,
  irisMidpoint: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): THREE.Mesh {
  const faceHeight = Math.abs(frontForeheadY - frontChinY);
  // Width: prefer the cheek-derived width, but clamp to a sane fraction
  // of face-height so a degenerate cheek read can't squash the cranium.
  const cheekWidth = Math.max(cheekHalfWidth * 2, faceHeight * 0.75);
  const headWidth = Math.min(cheekWidth * 1.05, faceHeight * 1.05);
  const headHeight = faceHeight * 1.40; // 40% crown above the brow
  // Depth: prefer profile-derived headDepth (= 0.85 × faceHeight from
  // alignProfile), inflated to 1.15× faceHeight for crown rear bulge,
  // clamped to a sane minimum so the head never looks paper-thin.
  const headDepth = Math.max(profileHeadDepth * 1.35, faceHeight * 1.10);

  const faceMidY = (frontChinY + frontForeheadY) * 0.5;
  // Crown bias: shift the ellipsoid Y-center UP so 60% of its height is
  // above face midpoint. With headHeight = 1.4 × faceHeight, that puts:
  //   - bottom edge ≈ chin level (faceMidY - 0.7×faceHeight = chinY - 0.2×faceHeight)
  //   - top edge ≈ forehead + 0.5×faceHeight (the crown)
  const cy = faceMidY + faceHeight * 0.20;
  // G4 — Z-center: position the cranium so its FRONT POLE sits at the
  // face plane (z ≈ 0), with the front-most procedural features
  // (eyelids forward-shifted by lidZOffset, nose tip at z ≈ +0.04..+0.05)
  // sitting JUST IN FRONT of the cranium's front surface. The cranium
  // therefore wraps the head silhouette correctly in 3/4 and profile
  // views — its forward-facing surface coincides with the face plane,
  // so face features and cranium project to the same screen position
  // rather than the features floating off-center because the cranium
  // mass was pushed too far back.
  //
  // The earlier formula (`cz = -headDepth/2 - faceHeight*0.05`) put the
  // cranium's front pole at z ≈ -0.02m and its center at z ≈ -0.26m, so
  // from 3/4 view the cranium silhouette projected several centimeters
  // BEHIND where the face features actually live, producing the visible
  // gap between cranium ellipsoid and face features.
  //
  // G5 — push the cranium FORWARD by the iris-midpoint Z so the front
  // pole lines up with the iris plane (the same plane the slot uses to
  // anchor face features into rig-world space). Without this shift, the
  // cranium front pole is at mesh-local z=0 while the irises sit at
  // mesh-local z ≈ +0.03..+0.04 — so from a profile view the eyes/lips/
  // nose stick OUT of the cranium silhouette by ~3-4cm. Aligning the
  // front pole with the iris z keeps features ON the cranium surface in
  // both 3/4 and profile views, which is what the brief asks for.
  //   cz + headDepth/2 = irisMidpoint.z   =>   cz = -headDepth/2 + irisMidpoint.z
  const cz = -(headDepth * 0.5) + irisMidpoint.z;

  // G5 — X-center: align the cranium's centerline with the iris-midpoint
  // X so the slot's `-irisMidpoint.x` translation cancels out and the
  // cranium silhouette sits over the eye-anchor world X (= 0). Without
  // this, the cranium ends up offset by `-irisMidpoint.x` in world space
  // (typically a few mm — within the brief's <1cm "leave it" threshold,
  // but cheap to set right). Y is intentionally left at the cranium's
  // mid-skull anchor (cy, well above iris) — matching iris-Y would put
  // the cranium center at eye-level rather than mid-skull, making the
  // skull silhouette sit too low.
  const cx = irisMidpoint.x;
  // Use a SphereGeometry with sufficient segments to read as a smooth
  // cranium. 24 longitudinal × 16 latitudinal = 384 verts, ~720 tris —
  // light enough that mounting one per player isn't a draw-call concern.
  const sphere = new THREE.SphereGeometry(0.5, 24, 16);
  const mesh = new THREE.Mesh(sphere, material);
  mesh.position.set(cx, cy, cz);
  // Per-axis scale on the unit-radius sphere.
  mesh.scale.set(headWidth, headHeight, headDepth);
  mesh.name = 'head-cranium';
  // Render BEFORE the textured front face so the face wins the depth
  // ties along the seam where the face mesh's silhouette edge sits
  // ~exactly on the ellipsoid's surface.
  mesh.renderOrder = -1;
  return mesh;
}

/** Build a small ellipsoid ear positioned at temple level on the SIDE of
 *  the cranium (not poking out of the front face plane).
 *
 *  G1.v2 — moved ears BACK from the cheek (which is on the front face
 *  plane) to the side of the cranium. The cheek landmark gives the
 *  starting X/Y; we offset Z backward by ~50% of the head-depth so the
 *  ear sits on the side of the head between the face plane and the back
 *  of the skull. Y is shifted up to ~ear-canal level (between the mouth
 *  and the eyes, ~70% from chin to forehead). */
function buildEar(
  cheekX: number,
  cheekY: number,
  cheekZ: number,
  side: 'left' | 'right',
  faceHeight: number,
  chinY: number,
  foreheadY: number,
  material: THREE.Material,
): THREE.Mesh {
  // 0.030 m base radius (vs 0.025 in v1). Slightly larger so the ear
  // reads at distance.
  const geo = new THREE.SphereGeometry(0.030, 8, 6);
  const mesh = new THREE.Mesh(geo, material);
  // Vertical lobe shape — narrow X (against the head), tall Y, thin Z.
  // X 0.5 keeps the ear flush against the cranium silhouette without
  // poking out 2cm; Y 1.2 makes the ear taller than wide; Z 0.4 is a
  // thin ear-shaped lobe.
  mesh.scale.set(0.5, 1.2, 0.4);
  // Position: lateral X stays at cheek X (no extra outward offset — the
  // ellipsoid is wide enough that the ear sits flush against its side).
  // Y at ~70% from chin to forehead (between mouth and eyes — ear canal
  // height).
  const earY = chinY + (foreheadY - chinY) * 0.70;
  // Z behind the cheek by ~25% of faceHeight — the ear sits roughly
  // halfway between the cheek (front face plane, z≈0) and the back of
  // the cranium. The cheek landmark's own Z (cheekZ) is already a small
  // negative value; stack on extra rearward offset.
  const earZ = cheekZ - faceHeight * 0.25;
  mesh.position.set(cheekX, earY, earZ);
  mesh.name = `head-ear-${side}`;
  return mesh;
}

/**
 * Build the complete head mesh from front + profile landmarks.
 *
 * Returns a `BuiltHeadMesh` carrying both the existing `BuiltFaceMesh`
 * fields (so callers can still mount the front face directly) AND the new
 * `headMesh` group + `headMeshSuccess` flag. When `headMeshSuccess` is
 * false, only the front face mesh is usable; caller should fall back to
 * the rig's existing head sphere.
 */
export function buildHeadMesh(
  frontLandmarks: ReadonlyArray<NormalizedLandmark>,
  profileLeftLandmarks: ReadonlyArray<NormalizedLandmark> | null,
  profileRightLandmarks: ReadonlyArray<NormalizedLandmark> | null,
  frontImageDataUrl: string,
  opts: BuildHeadMeshOptions = {},
): BuiltHeadMesh {
  // Always build the front face first — it's the "fallback" return value
  // when profile data is missing.
  const frontBuilt = buildFaceMesh(frontLandmarks, frontImageDataUrl, opts);

  // Container Group that the caller mounts onto neckGroup. The front face
  // mesh is the FIRST child; back/sides/ears are siblings, all in
  // mesh-local coords.
  const headGroup = new THREE.Group();
  headGroup.name = 'head-mesh-group';

  // Phase F6 — re-attach the front face mesh as the first child of the
  // head group. The caller mounts headGroup at the slot's iris-aligned
  // position; the front mesh stays in its mesh-local position (the slot
  // offset already lines its irises up with the rig anchor).
  // We DON'T re-parent here — we leave the BuiltFaceMesh's `mesh` field
  // pointing to the same THREE.Mesh, and rely on `setFaceMesh3D` to
  // optionally not mount it under the slot directly (mounting under
  // headGroup instead). To keep callers that DON'T see headGroup
  // working, we attach the front mesh as a child of headGroup AFTER
  // a reparent: the caller chooses which to attach.
  // For simplicity we attach the front mesh AND the mouth interior here.
  headGroup.add(frontBuilt.mesh);
  if (frontBuilt.mouthInterior) headGroup.add(frontBuilt.mouthInterior);

  // Default failure return — keep the BuiltFaceMesh fields intact, but
  // the headGroup only holds the front mesh + mouth interior. Caller
  // sees headMeshSuccess=false and falls back.
  const failReturn: BuiltHeadMesh = {
    ...frontBuilt,
    headMesh: headGroup,
    headMeshSuccess: false,
    headExtras: [],
  };

  if (!profileLeftLandmarks && !profileRightLandmarks) {
    return failReturn;
  }
  if (frontLandmarks.length < 478) return failReturn;

  // Read the FRONT mesh's chin/forehead/cheek anchors (post-scale,
  // post-center, in mesh-local coords).
  const frontExtents = readFrontMeshYExtents(frontBuilt);
  if (!frontExtents) return failReturn;
  const { chinY, foreheadY, cheekHalfWidth } = frontExtents;

  const wantEars = opts.ears !== false;
  const skinTone = typeof opts.skinTone === 'number' ? opts.skinTone : DEFAULT_SKIN_TONE;
  const skinMat = new THREE.MeshBasicMaterial({
    color: skinTone,
    side: THREE.DoubleSide,
  });
  skinMat.name = 'head-skin-mat';

  // Convert profile landmarks to flat number arrays for the alignment fn.
  // `landmarks` from MediaPipe are NormalizedLandmark[]; we need [x0,y0,z0,...].
  const flatten = (lms: ReadonlyArray<NormalizedLandmark>): number[] => {
    const out: number[] = [];
    for (let i = 0; i < lms.length; i++) {
      out.push(lms[i].x, lms[i].y, lms[i].z);
    }
    return out;
  };

  // Try profile-left first; fall back to profile-right.
  let leftAlign: ProfileAlignment | null = null;
  let rightAlign: ProfileAlignment | null = null;
  if (profileLeftLandmarks && profileLeftLandmarks.length >= 478) {
    leftAlign = alignProfile(flatten(profileLeftLandmarks), 'profile-left', chinY, foreheadY);
  }
  if (profileRightLandmarks && profileRightLandmarks.length >= 478) {
    rightAlign = alignProfile(flatten(profileRightLandmarks), 'profile-right', chinY, foreheadY);
  }
  if (!leftAlign && !rightAlign) return failReturn;

  const extras: THREE.Mesh[] = [];

  // G1.v2 — single full cranium ellipsoid replacing back-hemisphere +
  // side panels. Sized from the front mesh height + the profile-derived
  // headDepth (averaged across available profiles).
  const profileHeadDepth =
    leftAlign && rightAlign
      ? (leftAlign.headDepth + rightAlign.headDepth) * 0.5
      : (leftAlign ?? rightAlign)!.headDepth;
  const cranium = buildCraniumEllipsoid(
    chinY,
    foreheadY,
    cheekHalfWidth,
    profileHeadDepth,
    skinMat,
    // G5 — pass the iris midpoint so the cranium's center X aligns with
    // it AND its front pole sits at the iris z plane (rather than the
    // mesh-local origin which is the bbox center, ~3-4cm BEHIND the
    // irises). Cancels the residual feature-vs-cranium gap visible from
    // 3/4 and profile views.
    frontBuilt.irisMidpoint,
  );
  headGroup.add(cranium);
  extras.push(cranium);

  // The cranium's front pole sits ~0.05×faceHeight BEHIND the face
  // plane (see cz computation in buildCraniumEllipsoid), so the front
  // face mesh and the eye structures (mounted at z≈0 as siblings of the
  // mesh on the rig group) stay un-occluded. No Z-shift on the face
  // mesh needed — the cranium sits behind it by construction.
  const faceHeight = Math.abs(foreheadY - chinY);

  // Build geometric ears positioned at temple level on the SIDE of the
  // cranium (G1.v2 — not poking out of the cheek/face plane as in v1).
  if (wantEars) {
    const posAttr = frontBuilt.geometry.getAttribute('position') as
      | THREE.BufferAttribute
      | undefined;
    if (posAttr) {
      const arr = posAttr.array as Float32Array;
      const cheekL = readVec3(arr, 234);
      const cheekR = readVec3(arr, 454);
      // Convention: 234 is on the SUBJECT's left (rig +X actually depends
      // on the front-pose mesh convention). We follow the canonical
      // MediaPipe naming: 234 is the LEFT cheek (subject's left = +X
      // in this codebase's mesh-local convention). 454 is RIGHT cheek (-X).
      // For ear placement we don't need to be precise about side
      // labeling — just use the SIGN of cheek.x to decide.
      if (cheekL) {
        const earSide: 'left' | 'right' = cheekL.x < 0 ? 'right' : 'left';
        const ear = buildEar(
          cheekL.x, cheekL.y, cheekL.z, earSide,
          faceHeight, chinY, foreheadY, skinMat,
        );
        headGroup.add(ear);
        extras.push(ear);
      }
      if (cheekR) {
        const earSide: 'left' | 'right' = cheekR.x < 0 ? 'right' : 'left';
        const ear = buildEar(
          cheekR.x, cheekR.y, cheekR.z, earSide,
          faceHeight, chinY, foreheadY, skinMat,
        );
        headGroup.add(ear);
        extras.push(ear);
      }
    }
  }

  return {
    ...frontBuilt,
    headMesh: headGroup,
    headMeshSuccess: true,
    headExtras: extras,
  };
}

/** Convenience: build a head mesh from a saved `FaceImage.mesh3d` payload.
 *  Caller resolves `mesh3d.angles` to find profile poses; this helper picks
 *  the relevant entries and wires up `buildHeadMesh`. */
export function buildHeadMeshFromAngles(
  frontLandmarks: ReadonlyArray<NormalizedLandmark>,
  angles: ReadonlyArray<{
    poseName: string;
    imageDataUrl: string;
    landmarks: number[];
  }> | null | undefined,
  frontImageDataUrl: string,
  opts: BuildHeadMeshOptions = {},
): BuiltHeadMesh {
  const flatToLandmarks = (flat: number[]): NormalizedLandmark[] => {
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
  };
  let leftLM: NormalizedLandmark[] | null = null;
  let rightLM: NormalizedLandmark[] | null = null;
  if (angles) {
    for (const a of angles) {
      if (a.poseName === 'profile-left' && Array.isArray(a.landmarks)) {
        leftLM = flatToLandmarks(a.landmarks);
      } else if (a.poseName === 'profile-right' && Array.isArray(a.landmarks)) {
        rightLM = flatToLandmarks(a.landmarks);
      }
    }
  }
  return buildHeadMesh(frontLandmarks, leftLM, rightLM, frontImageDataUrl, opts);
}
