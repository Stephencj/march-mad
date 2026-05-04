/**
 * Phase H2 — Mii-style flat-image face renderer.
 *
 * Mounts a small THREE.Group of textured PlaneGeometry quads, one per
 * baked feature image (eyes/brows/nose/mouth + optional beard/mustache/
 * hat), at the landmark-derived rest positions in the bundle. The group
 * is intended to live inside the existing `face-mesh-3d` slot on the
 * rig, alongside the cranium ellipsoid that backs the silhouette.
 *
 * Crops live in mesh-local-RAW landmark space (x = lm.x - 0.5, etc.) per
 * the H1 baker's contract. The runtime canonical face mesh is scaled by
 * `HEAD_FACE_AREA / meshFaceHeight` (≈ 0.5 for typical scans) so it
 * fits inside the rig's head silhouette. We apply the SAME scale here
 * so the planes sit on the cranium silhouette rather than a half-meter
 * out from it.
 *
 * The caller is responsible for:
 *   1. Computing `meshScale` from the canonical face mesh's actual
 *      iris-distance vs the bundle's eye centroid distance, OR passing
 *      it in directly from a `BuiltFaceMesh` it already built.
 *   2. Mounting the returned group as a child of the slot used for the
 *      canonical 3D mesh (`face-mesh-3d`), so the slot's
 *      `irisMid` offset puts the planes on the rig's eye anchor
 *      automatically.
 *   3. Calling `dispose()` when unmounting to free the per-feature
 *      textures + materials + geometries.
 *
 * Materials: MeshBasicMaterial — the crops already encode lighting, and
 * Mii aesthetic is explicitly flat. `transparent=true`, `alphaTest=0.5`
 * to nuke the transparent-quad sort artifacts that would show up
 * between overlapping feature planes.
 *
 * No billboard. Planes face static +Z. Past ~60° head turn the planes
 * silhouette out of view — accepted as "Mii canonical" for v1; H9 adds
 * profile-pose feature crops to fill the gap.
 */
import * as THREE from 'three';
import type { FaceFeatureCrop, FeatureImagesBundle } from './types';
import { faceDecalRegistry, type DecalKey } from './face-decal-registry';

export interface MiiFaceMountOpts {
  /** Skin tone for cranium tinting (passed through to head mesh, not used
   *  here directly). */
  skinTone?: number;
  /** Whether to include the hat plane. DEFAULT FALSE — the Mii flat hat
   *  plane was a v1 stopgap; production callers mount a procedural 3D hat
   *  group via `player.setFaceHat` instead. The bake + plane code path
   *  is preserved (in case future features need a flat-hat fallback) but
   *  callers must opt-in explicitly. */
  showHat?: boolean;
  /** Whether to include the beard plane. Default false — the whole-face
   *  plate now bakes the beard photographically. Opt-in for keyframe-anim
   *  usage where per-feature variant swaps need a separate plane. */
  showBeard?: boolean;
  /** Whether to include the mustache plane. Default false. */
  showMustache?: boolean;
  /** Whether to include the per-feature eye/brow/nose/mouth overlay planes.
   *  Default false — the whole-face plate carries these photographically.
   *  Opt-in for keyframe-anim per-feature variant swaps. */
  showFeatureOverlays?: boolean;
  /** Mesh-local scale to apply to baker's center3D / size3D. Defaults to 1
   *  (raw landmark units). Real callers pass the per-face scale derived
   *  from the canonical mesh's iris-distance so the planes line up with
   *  the cranium silhouette in scaled mesh-local coords. */
  meshScale?: number;
  /** Mesh-local Z of the cranium FRONT POLE (the closest-to-camera point
   *  on the cranium ellipsoid). All features sit at or in front of this Z
   *  with a small forward bias. Defaults to 0 (no bias beyond the
   *  per-feature Z offsets baked in below). */
  craniumFrontZ?: number;
  /** Mesh-local-scaled iris midpoint of the canonical face mesh, in the
   *  same coord space the slot's `-irisMidpoint` translation operates on.
   *  When mounted as a child of the `face-mesh-3d` slot, a plane at
   *  position (0,0,0) lands at the slot's WORLD origin, which sits
   *  `-irisMidpoint` away from where the iris actually projects in the
   *  rig (the rig's `eye-left/right` sphere positions account for this
   *  offset). To put feature planes ON the rig's eye/face anchor we
   *  shift them by +irisMidpoint so the slot's own `-irisMidpoint`
   *  cancels and the plane lands at the rig anchor. Defaults to (0,0,0)
   *  for tests / non-rig callers. */
  irisMidpoint?: { x: number; y: number; z: number };
}

/** Per-feature forward (+Z) bias in METERS of mesh-local-scaled coords.
 *  All under 4 cm — visible parallax on head-turn but no
 *  sticker-floating-off-head feel. The slot itself sits at the iris
 *  plane = the cranium FRONT POLE, so positive Z = forward of the
 *  cranium surface. The Y-anchored hat sits 11 cm ABOVE the iris in
 *  slot-local Y, but the cranium ellipsoid curves backward as Y
 *  increases — by Y=0.105m the cranium surface is ~3 cm BEHIND the
 *  iris-plane Z, so the hat needs an additional ~3.5 cm forward bias
 *  to clear the cranium silhouette. Same for beard at low Y.
 *
 *  Phase H2c — facePlate sits behind every overlay plane (lowest Z),
 *  acting as the "skin canvas" the eyes/brows/mouth float in front of. */
const Z_BIAS: Record<FeatureName, number> = {
  hat:       0.020,
  facePlate: 0.005,
  beard:     0.030,
  nose:      0.020,
  mouth:     0.015,
  leftEye:   0.010,
  rightEye:  0.010,
  leftBrow:  0.012,
  rightBrow: 0.012,
  mustache:  0.018,
};

/** Target physical sizes in METERS for each feature plane.
 *
 *  The H1 baker's `size3D` field (in raw landmark units) is computed from
 *  landmark-set bboxes + padding multipliers. After `meshScale` (≈ 0.52
 *  for typical faces) it produces planes 2–5× larger than the visible
 *  feature in the source crop, because:
 *    - landmark sets like NOSE_INDICES span from the nose root (between
 *      the brows) down to the nostrils — much taller than the visible
 *      nose;
 *    - landmark sets like BEARD_INDICES walk the entire jaw silhouette
 *      from one temple to the other — much wider than a beard region;
 *    - the per-feature `padding` multiplier (`(1 + padding*2)`) is a
 *      pixel-bbox concept that further inflates raw size3D.
 *
 *  Rather than try to fix H1 (which would require re-baking) we set
 *  physical-sized planes here. The canonical-mesh-scaled face is
 *  ~0.42m tall × ~0.36m wide; these targets fit accordingly. */
const TARGET_SIZE_M: Record<FeatureName, { w: number; h: number }> = {
  // Phase H2c-fix — eye/brow overlays sit inside the face plate around
  // the iris midpoint (±~0.030m X). Sized to be visible at proper
  // anatomical proportion against the plate (which spans ~0.20m wide,
  // ~0.27m tall) so the overlays read as eye/brow without floating in
  // mostly-empty plate-skin.
  leftEye:   { w: 0.055, h: 0.030 },
  rightEye:  { w: 0.055, h: 0.030 },
  leftBrow:  { w: 0.060, h: 0.018 },
  rightBrow: { w: 0.060, h: 0.018 },
  // Nose: narrow, vertical. Bridge to nostril span ~0.075m, width ~0.045m.
  // (Skipped at render time when facePlate is present.)
  nose:      { w: 0.045, h: 0.075 },
  // Phase H2c-fix — mouth tightened to fit inside the plate.
  mouth:     { w: 0.060, h: 0.025 },
  // Beard: lower-jaw cap, wider than mouth. Width ~face-width × 0.50;
  // sits chin-and-jowls. (Skipped when facePlate is present.)
  beard:     { w: 0.160, h: 0.110 },
  // Mustache: thin band above upper lip, slightly wider than mouth.
  // (Skipped when facePlate is present.)
  mustache:  { w: 0.070, h: 0.016 },
  // Phase H2c-fix — hat sized to read as a real cap on the head rather
  // than dominating the cranium. The forward-cap (visor) crop reads as
  // a recognizable cap at this physical size; previously 0.32×0.18 was
  // visibly oversized vs the cranium silhouette.
  hat:       { w: 0.200, h: 0.100 },
  // Phase H2c-fix — facePlate sized to fit INSIDE the cranium silhouette.
  // Cranium front cap is ~0.36m wide × ~0.59m tall; face area chin-to-
  // forehead is ~0.42m. A 0.20×0.27m plate sits well inside the cranium
  // silhouette, with the elliptical vignette feathering into the cranium
  // skin tone seamlessly. The eye anchors at ±0.030m X fall well inside
  // the plate's solid (0.85 radius) region.
  facePlate: { w: 0.200, h: 0.270 },
};

/** Per-feature ANCHOR position in METERS of mesh-local-scaled coords,
 *  expressed RELATIVE to the iris midpoint (which sits on the rig's
 *  eye-anchor at world origin in the slot). The H1 baker's `center3D`
 *  is in raw (un-bbox-centered) landmark space, and re-deriving the
 *  bbox-center per face is brittle. Pinning anatomy to fixed anchors
 *  off the iris midpoint keeps the Mii feel coherent and predictable
 *  across face shapes — exactly what "Mii canonical layout" implies.
 *
 *  Y convention: +Y is up. Iris midpoint at Y=0.
 *  X convention: +X is the subject's left. Eye/brow pairs are at ±X.
 *  Z is filled in by `craniumFrontZ` + `Z_BIAS[name]`. */
const ANCHOR_OFFSET_M: Record<FeatureName, { x: number; y: number }> = {
  // Phase H2c-fix — eyes pinned to the user's actual eye region on the
  // baked plate (~±0.030m from iris midpoint). The rig's eye-left/right
  // anchor spheres are at ±0.090m, but those are anatomical anchors for
  // the procedural eye structure — the Mii overlays sit on the FLAT
  // baked plate where the user's eye pixels actually live, not the rig's
  // procedural eye-anchor points. Shift slightly above the iris midpoint
  // (+0.005m Y) so the overlay covers the lid+lash region rather than
  // straddling the iris.
  leftEye:   { x: -0.030, y:  0.005 },
  rightEye:  { x:  0.030, y:  0.005 },
  // Brows ~25mm above the eyes, same X as the eyes.
  leftBrow:  { x: -0.030, y:  0.030 },
  rightBrow: { x:  0.030, y:  0.030 },
  // Nose centered, descending below the iris midpoint by ~30mm to its
  // CENTER (so the bridge starts at ~iris and the tip ends ~65mm below).
  // Skipped at render time when facePlate is present.
  nose:      { x:  0.000, y: -0.030 },
  // Phase H2c-fix — mouth ~40mm below iris (was 75mm). The plate is
  // smaller (0.27m tall, half-height 0.135m), and the mouth photo on
  // the plate sits at roughly that offset from the iris midpoint.
  mouth:     { x:  0.000, y: -0.040 },
  // Beard chin-region: ~115mm below iris, centered. Skipped when
  // facePlate is present.
  beard:     { x:  0.000, y: -0.115 },
  // Mustache just above mouth. Skipped when facePlate is present.
  mustache:  { x:  0.000, y: -0.060 },
  // Phase H2c-fix — hat lowered to sit ON the head rather than ABOVE.
  // At y=+0.16 the smaller (0.20×0.10) hat plane spans [+0.11, +0.21]
  // — bottom edge at upper-forehead/hairline, top edge well below the
  // cranium crown (~+0.38). The cap (now forward-facing/visor) reads
  // as a cap perched on the head rather than a halo floating above.
  hat:       { x:  0.000, y:  0.160 },
  // Phase H2c-fix — facePlate centered just slightly below iris-Y so
  // the chin (-0.135 + plate-center-y) and forehead (+0.135 + center-y)
  // both fit inside the cranium silhouette. With center y = -0.020 the
  // plate spans Y ∈ [-0.155, +0.115], well inside the cranium's chin-
  // to-crown range ([-0.21, +0.38]).
  facePlate: { x:  0.000, y: -0.020 },
};

/** Per-feature renderOrder. Group is at 10; higher = drawn later =
 *  appears on top. We slot hat slightly BELOW the features so a brow
 *  whose Y overlaps a low brim still occludes correctly via the
 *  alpha-test cutout. Beard/mustache below mouth so a mouth on top
 *  reads cleanly when both overlap (mustache is small + sits above
 *  upper lip, but a low-hanging mustache still looks right behind the
 *  mouth's upper-lip pixels). */
const RENDER_ORDER: Record<FeatureName, number> = {
  // facePlate sits BELOW everything — it's the skin canvas the overlays
  // float on top of. Hat then overlays anything outside the face plate
  // (forehead/scalp). Beard/mustache overlap with facePlate but are
  // omitted from the render path entirely when facePlate is present
  // (they're already composited into the plate).
  facePlate: 7,
  hat:       8,
  beard:     9,
  mustache:  10,
  leftEye:   11,
  rightEye:  11,
  leftBrow:  11,
  rightBrow: 11,
  nose:      11,
  mouth:     11,
};

type FeatureName =
  | 'leftEye' | 'rightEye'
  | 'leftBrow' | 'rightBrow'
  | 'nose' | 'mouth'
  | 'beard' | 'mustache' | 'hat'
  | 'facePlate';

// Phase H2c-perfect: with the whole-face plate baking the user's actual
// eyes/brows/nose/mouth/mustache/beard photographically, the per-feature
// overlay planes (leftEye, rightEye, leftBrow, rightBrow, nose, mouth,
// beard, mustache) became visually redundant — they painted dark photo-
// rectangle artifacts on top of the already-correct plate. Default-mount
// only the facePlate + hat. Per-feature planes are gated behind
// `opts.showFeatureOverlays` (or per-feature flags) for future keyframe-
// anim use, where swapping expression variants per feature requires
// independent plane control.
const ORDERED_FEATURES: FeatureName[] = [
  'facePlate',
  'hat', 'beard', 'mustache',
  'nose', 'mouth',
  'leftEye', 'rightEye',
  'leftBrow', 'rightBrow',
];

/** Phase H3 — decal slot meshes added inside the face-flat-group. Each
 *  decal slot is a transparent plane with no map until the keyframer
 *  toggles one in via `setFaceDecalSlot`. v1 only the forehead slot is
 *  driven; cheekL/R remain reserved for later phases. */
export interface DecalSlots {
  forehead: THREE.Mesh;
  cheekL: THREE.Mesh;
  cheekR: THREE.Mesh;
}

export interface BuiltMiiFace {
  group: THREE.Group;
  /** Per-feature mesh, keyed by feature name. Populated only for features
   *  present in the bundle (and not gated by an `opts.show* = false`). */
  planes: Map<FeatureName, THREE.Mesh>;
  /** Phase H3 — decal slots, all start invisible with opacity 0 + no
   *  texture map. Populated by `setFaceDecalSlot`. */
  decalSlots: DecalSlots;
  /** Phase H3 — per-slot last-applied decal key. Used by the mixer-state
   *  applier to detect changes and trigger texture swaps only when the
   *  active decal actually flips (otherwise every frame would queue a
   *  redundant `faceDecalRegistry.load`). */
  lastDecalKey: { forehead: DecalKey; cheekL: DecalKey; cheekR: DecalKey };
  /** Disposable resources (textures + materials + geometries). Caller
   *  MUST call this on unmount or each face swap leaks a few hundred KB
   *  of GPU memory. */
  dispose(): void;
}

/** Per-decal-slot anchor offsets in METERS, expressed RELATIVE to the
 *  iris midpoint (matching ANCHOR_OFFSET_M's coord convention).
 *
 *  - Forehead sits +60mm above iris-mid, centered. Lands inside the
 *    upper-forehead band of the face plate (plate top = +0.115m).
 *  - Cheeks at ±50mm X, -20mm Y — landing on each cheek apex below
 *    the iris.
 *  v1 mixer only drives the forehead slot. */
const DECAL_SLOT_ANCHORS: Record<keyof DecalSlots, { x: number; y: number }> = {
  forehead: { x:  0.000, y:  0.060 },
  cheekL:   { x: -0.050, y: -0.020 },
  cheekR:   { x:  0.050, y: -0.020 },
};

/** Per-decal-slot plane sizes in METERS. Forehead is wider (vein /
 *  pain-stars are larger features); cheeks are roughly square (blush /
 *  crease-cheek). */
const DECAL_SLOT_SIZES: Record<keyof DecalSlots, { w: number; h: number }> = {
  forehead: { w: 0.060, h: 0.040 },
  cheekL:   { w: 0.040, h: 0.040 },
  cheekR:   { w: 0.040, h: 0.040 },
};

/** Forward Z bias applied to decals — slightly higher than feature
 *  planes so a decal on the forehead doesn't z-fight with a brow plane
 *  underneath it. Per design plan: decals at renderOrder=11 (atop
 *  features). */
const DECAL_Z_BIAS = 0.025;

const DECAL_RENDER_ORDER = 12;

/**
 * Build a Mii-style face group from a baked feature-images bundle.
 *
 * Asynchronous because each `dataUrl` decodes through `Image` →
 * `CanvasTexture`. Resolves once ALL textures have decoded; failed
 * decodes throw rather than silently dropping a feature (the bundle
 * said it had a left eye → if we can't render one, the face is
 * incomplete, not "almost there").
 */
export async function buildMiiFace(
  bundle: FeatureImagesBundle,
  opts: MiiFaceMountOpts = {},
): Promise<BuiltMiiFace> {
  const meshScale = opts.meshScale ?? 1;
  // showHat defaults to FALSE — the procedural 3D hat (mounted via
  // `player.setFaceHat`) supersedes the flat photo-cropped Mii hat plane.
  // Callers can still opt back in by passing `showHat: true`.
  const showHat = opts.showHat ?? false;
  const showBeard = opts.showBeard ?? false;
  const showMustache = opts.showMustache ?? false;
  const showFeatureOverlays = opts.showFeatureOverlays ?? false;

  const group = new THREE.Group();
  group.name = 'face-flat-group';
  group.renderOrder = 10;

  const planes = new Map<FeatureName, THREE.Mesh>();
  const ownedTextures: THREE.Texture[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const ownedGeometries: THREE.BufferGeometry[] = [];

  // Phase H2c — when bundle has a facePlate, the nose/beard/mustache
  // pixels are already composited into the plate. Skip those individual
  // overlay planes (they read as photo rectangles, defeating the whole
  // pivot). Old saves without facePlate fall through to the original
  // per-feature plane layout.
  const hasFacePlate = !!(bundle as Partial<Record<FeatureName, FaceFeatureCrop>>).facePlate;

  // Resolve which features to render. Required ones (eyes/brows/nose/mouth)
  // always present; conditional ones gated by both bundle presence AND
  // opts.show* flags.
  const featuresToBuild: FeatureName[] = [];
  for (const name of ORDERED_FEATURES) {
    const crop = (bundle as Partial<Record<FeatureName, FaceFeatureCrop>>)[name];
    if (!crop) continue;
    if (name === 'hat' && !showHat) continue;
    if (name === 'beard' && !showBeard) continue;
    if (name === 'mustache' && !showMustache) continue;
    // Per-feature overlay planes (leftEye/rightEye/leftBrow/rightBrow/
    // nose/mouth) gated behind showFeatureOverlays. When facePlate is
    // present, the whole-face photo bake covers these features already;
    // mounting overlay planes layers redundant photo crops on top.
    const isOverlay = name === 'leftEye' || name === 'rightEye' ||
                      name === 'leftBrow' || name === 'rightBrow' ||
                      name === 'nose' || name === 'mouth';
    if (isOverlay && !showFeatureOverlays) continue;
    // When facePlate is present, drop the individual nose/beard/mustache
    // planes — they're already in the plate.
    if (hasFacePlate && (name === 'nose' || name === 'beard' || name === 'mustache')) continue;
    featuresToBuild.push(name);
  }

  // Load all textures in parallel. Each decode races independently; we
  // await the lot so the caller sees a fully-built group on resolve
  // (no flash-of-untextured-planes).
  const decoded = await Promise.all(
    featuresToBuild.map(async (name) => {
      const crop = (bundle as Partial<Record<FeatureName, FaceFeatureCrop>>)[name]!;
      const texture = await loadTextureFromDataUrl(crop.dataUrl);
      return { name, crop, texture };
    }),
  );

  // `meshScale` is intentionally unused for sizing/positioning now — the
  // H1 size3D / center3D values are in raw (un-bbox-centered, padding-
  // inflated) landmark space and, after meshScale, render the planes
  // 2–5× larger than the visible feature and a few cm off-anchor. We use
  // the canonical anatomical anchor table + physical-meter sizes
  // instead. Reference it so the param stays in the signature for
  // forward-compat (callers may want to opt back into per-face derived
  // anchors once H1 is reworked).
  void meshScale;

  for (const { name, crop, texture } of decoded) {
    ownedTextures.push(texture);
    void crop; // crop only consumed for its dataUrl above; size3D/center3D
               // are intentionally NOT applied (see TARGET_SIZE_M comment).

    const target = TARGET_SIZE_M[name];
    const w = Math.max(1e-4, target.w);
    const h = Math.max(1e-4, target.h);
    // The facePlate gets curved to match the cranium's front-pole curvature
    // so the photographic face wraps around the head shape instead of
    // appearing as a flat billboard. From 3/4 and side angles this lets
    // the face read as part of a 3D head, not a Polaroid stuck on a sphere.
    // Other features (eyes/brows/etc when overlay-mounted) stay flat.
    let geom: THREE.BufferGeometry;
    if (name === 'facePlate') {
      // Subdivide the plane more so the curve renders smoothly.
      const plane = new THREE.PlaneGeometry(w, h, 16, 20);
      // Bend the plane vertices into a gentle dome whose center stays at
      // z=0 (closest to the camera) and edges recede to -z (toward the
      // cranium body). Curvature radius R chosen to roughly match the
      // cranium's front-pole curvature: at 0.20m wide the rim recedes
      // about 1.5cm, which approximates the head's rounding.
      const CURVE_R = 0.22;
      const pos = plane.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = -(x * x + y * y) / (2 * CURVE_R);
        pos.setZ(i, z);
      }
      pos.needsUpdate = true;
      plane.computeVertexNormals();
      geom = plane;
    } else {
      geom = new THREE.PlaneGeometry(w, h);
    }
    ownedGeometries.push(geom);

    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.5,
      depthWrite: false,
      // Stay opaque on the front face only — features face +Z and we
      // never see their backs (the cranium fills the back of the head).
      side: THREE.FrontSide,
    });
    mat.name = `face-feature-${name}-mat`;
    ownedMaterials.push(mat);

    const anchor = ANCHOR_OFFSET_M[name];
    const iris = opts.irisMidpoint ?? { x: 0, y: 0, z: 0 };
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `face-feature-${name}`;
    // Add `iris.x` and `iris.y` so the slot's own `-irisMidpoint`
    // offset cancels in X/Y and the plane lands on the rig's eye
    // anchor (where `eye-left` / `eye-right` are mounted in neck-group
    // local space). Without this the planes sit `-irisMidpoint.y`
    // (~8 cm) below the rig anchor.
    //
    // Z is shifted by `iris.z` so the plane lands on the cranium's
    // front-pole z-plane (the cranium is positioned with its front pole
    // at slot-local z = irisMid.z). Z_BIAS adds the per-feature forward
    // bias on top so features don't z-fight with the cranium silhouette.
    mesh.position.set(
      anchor.x + iris.x,
      anchor.y + iris.y,
      Z_BIAS[name] + (opts.craniumFrontZ ?? 0) + iris.z,
    );
    mesh.renderOrder = RENDER_ORDER[name];

    group.add(mesh);
    planes.set(name, mesh);
  }

  // Phase H3 — build the three decal slot meshes. All start invisible
  // with zero opacity and no map; the keyframe mixer wires textures via
  // `setFaceDecalSlot` once a composite triggers one. The materials are
  // owned per-face (so opacity tweens don't leak across players) but the
  // textures are shared via the module-level `faceDecalRegistry`.
  const iris = opts.irisMidpoint ?? { x: 0, y: 0, z: 0 };
  const decalSlots = {} as DecalSlots;
  for (const slotName of ['forehead', 'cheekL', 'cheekR'] as const) {
    const size = DECAL_SLOT_SIZES[slotName];
    const anchor = DECAL_SLOT_ANCHORS[slotName];
    const dGeom = new THREE.PlaneGeometry(size.w, size.h);
    ownedGeometries.push(dGeom);
    const dMat = new THREE.MeshBasicMaterial({
      transparent: true,
      // Lower alphaTest than feature planes (0.5) — decals are SOFT
      // overlays that need to fade in, so a 0.5 cutout would pop them
      // on at ~50% alpha. 0.1 keeps the cutout below the start of the
      // visible-fade range so the tween reads as a smooth fade-in.
      alphaTest: 0.1,
      depthWrite: false,
      opacity: 0,
      side: THREE.FrontSide,
    });
    dMat.name = `face-decal-${slotName}-mat`;
    ownedMaterials.push(dMat);
    const dMesh = new THREE.Mesh(dGeom, dMat);
    dMesh.name = `face-decal-${slotName}`;
    dMesh.position.set(
      anchor.x + iris.x,
      anchor.y + iris.y,
      DECAL_Z_BIAS + (opts.craniumFrontZ ?? 0) + iris.z,
    );
    dMesh.renderOrder = DECAL_RENDER_ORDER;
    dMesh.visible = false;
    group.add(dMesh);
    decalSlots[slotName] = dMesh;
  }

  return {
    group,
    planes,
    decalSlots,
    lastDecalKey: { forehead: 'none', cheekL: 'none', cheekR: 'none' },
    dispose() {
      for (const t of ownedTextures) t.dispose();
      for (const m of ownedMaterials) m.dispose();
      for (const g of ownedGeometries) g.dispose();
      // Detach all children so a stale reference doesn't keep the
      // (now-disposed) GPU buffers alive.
      while (group.children.length > 0) group.remove(group.children[0]);
    },
  };
}

/**
 * Phase H3 — apply (or clear) a decal texture on one of the three Mii
 * face decal slots, animating the slot's opacity to the requested value.
 *
 * - `key === 'none'`: hide the slot, clear its `.map` so nothing stays
 *   loaded, and reset opacity to 0.
 * - any other key: load via the shared `faceDecalRegistry`, swap the
 *   slot's `.map`, set `visible=true`, and set `material.opacity` to
 *   the passed value (0..1). The keyframe mixer drives the opacity
 *   ramp by passing eased-`t` values across multiple ticks.
 *
 * The texture cache is shared across players — a vein-forehead decal
 * resolves a single GPU texture even with six players angry at once.
 *
 * Throws on load failure (lets the caller decide whether to surface or
 * swallow). The registry evicts failed loads so a retry next frame
 * works.
 */
export async function setFaceDecalSlot(
  built: BuiltMiiFace,
  slot: keyof DecalSlots,
  key: DecalKey,
  opacity: number,
): Promise<void> {
  const mesh = built.decalSlots[slot];
  if (!mesh) return;
  const mat = mesh.material as THREE.MeshBasicMaterial;
  if (key === 'none') {
    // Clear: hide the slot, drop the texture reference (the texture
    // itself stays cached in the registry — no dispose here, that
    // would defeat sharing across players).
    mat.map = null;
    mat.needsUpdate = true;
    mat.opacity = 0;
    mesh.visible = false;
    return;
  }
  const texture = await faceDecalRegistry.load(key);
  if (!texture) {
    // Registry returned null — treat as "no decal" (defensive: a
    // missing PNG shouldn't crash gameplay).
    mat.map = null;
    mat.needsUpdate = true;
    mat.opacity = 0;
    mesh.visible = false;
    return;
  }
  if (mat.map !== texture) {
    mat.map = texture;
    mat.needsUpdate = true;
  }
  mat.opacity = Math.max(0, Math.min(1, opacity));
  // Hide the slot when opacity is essentially zero — keeps the alpha-
  // tested fragment shader from running for an invisible quad.
  mesh.visible = mat.opacity > 0.01;
}

/** Decode a data URL into a THREE.Texture via an HTMLImageElement.
 *  Falls back gracefully when the document/window isn't available
 *  (vitest jsdom default), throwing a typed error so tests can detect
 *  the not-supported case. */
async function loadTextureFromDataUrl(dataUrl: string): Promise<THREE.Texture> {
  if (typeof Image === 'undefined') {
    throw new Error('mii-face-renderer: HTMLImageElement unavailable (non-DOM environment)');
  }
  return new Promise<THREE.Texture>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      // Crops are aspect-correct rasters — keep default UV mapping. Disable
      // mipmaps to avoid bleed at the alpha-test cutout boundary.
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      resolve(tex);
    };
    img.onerror = (err) => {
      reject(new Error(`mii-face-renderer: failed to decode crop dataUrl: ${String(err)}`));
    };
    img.src = dataUrl;
  });
}

/**
 * Helper: derive the canonical-mesh's per-face uniform scale by
 * comparing the bundle's iris-centroid distance (in raw landmark units)
 * to the canonical mesh's iris-vertex distance (in mesh-local-scaled
 * units). Robust per-face — the mesh-builder's HEAD_FACE_AREA fit gives
 * different scales for different face heights.
 *
 * Returns 1 (no-op) when either input is degenerate; caller can pick
 * an alternative or accept that the planes will sit at raw landmark
 * scale (probably ~2× too large but still recognizable).
 */
export function deriveMeshScaleFromBundle(
  bundle: FeatureImagesBundle,
  canonicalMesh: THREE.Mesh,
): number {
  const posAttr = canonicalMesh.geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined;
  if (!posAttr) return 1;
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
  if (isDegenerate(leftIdx) || isDegenerate(rightIdx)) return 1;
  const meshDist = Math.hypot(
    arr[rightIdx * 3 + 0] - arr[leftIdx * 3 + 0],
    arr[rightIdx * 3 + 1] - arr[leftIdx * 3 + 1],
    arr[rightIdx * 3 + 2] - arr[leftIdx * 3 + 2],
  );
  const bundleDist = Math.hypot(
    bundle.rightEye.center3D.x - bundle.leftEye.center3D.x,
    bundle.rightEye.center3D.y - bundle.leftEye.center3D.y,
    bundle.rightEye.center3D.z - bundle.leftEye.center3D.z,
  );
  if (!Number.isFinite(meshDist) || !Number.isFinite(bundleDist) || bundleDist < 1e-6) return 1;
  return meshDist / bundleDist;
}
