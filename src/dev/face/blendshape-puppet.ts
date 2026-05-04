/**
 * Live blendshape puppet for the canonical 478-vertex MediaPipe FaceMesh.
 *
 * Given a `BuiltFaceMesh` (from `mesh-builder.ts`) and a stream of MediaPipe
 * ARKit-style blendshape coefficients, this module mutates the geometry's
 * `position` attribute per-frame so the user's expression visibly drives the
 * 3D mesh.
 *
 * --- Strategy ---
 *
 * Pre-compute, at construction time, a `Map<BlendshapeName, Float32Array>`
 * of *displacement vectors*. Each Float32Array is 478×3 floats: the per-vertex
 * `(dx, dy, dz)` that fully-realized expression #k contributes when its
 * coefficient is 1.0. The displacements are hand-tuned around a small set of
 * "anchor" landmark indices with a Gaussian falloff into surrounding vertices,
 * so motion looks smooth rather than picking up only the named landmarks.
 *
 * Per frame:
 *
 *     for each vertex i:
 *         pos[i] = restPos[i] + Σ ( smoothed[k] * displacement[k][i] )
 *
 * Smoothing: each blendshape coefficient is run through an EMA
 * (`smoothed += alpha * (raw - smoothed)`) with `alpha = 0.45`. MediaPipe's
 * raw output flickers ±0.05 even on a still face, which reads as twitchy
 * jitter on the mesh. Alpha 0.45 cuts that to barely visible while still
 * tracking real expression onsets within ~3 frames at 30fps.
 *
 * Coordinate-space note: the mesh-builder converts MediaPipe landmarks
 * (image-space, y-down, z=image-width units) to Three.js space
 *   x_three = x_mp - 0.5, y_three = -(y_mp - 0.5), z_three = -z_mp
 * and then re-centers + scales so the inter-iris distance equals
 * `rigEyeDist`. The displacement tables below are tuned in **mesh-local
 * space (post-scale)** — i.e. directly in Three.js units — so they can be
 * added to `restPos` without further coordinate gymnastics. Magnitudes
 * assume `rigEyeDist ≈ 0.2 m` (the rig default). If a future rig used a
 * radically different eye distance, displacements would need to scale with
 * `rigEyeDist / 0.2` — left as a future enhancement.
 *
 * --- Bound on motion ---
 *
 * MediaPipe blendshape coefficients are clamped to [0, 1]. Per-vertex
 * displacement magnitudes are capped at ~0.05 m for the largest single
 * expression (jaw drop). With ~45 supported blendshapes — many mutually
 * exclusive (smile vs frown, blink vs wide, look-up vs look-down) — the
 * worst-case combined motion at any single vertex stays under ~0.09 m
 * (estimated by hand-summing the heaviest overlap clusters: chin tip,
 * mouth corner, lip-ring center). Phase 8.1.1 amplification raised mouth
 * corner / brow / eyelid magnitudes ~1.5–2.3× — pre-amplification worst
 * case was ~6 cm at landmark 61 (mouth corner: smile dy 0.018 + dx 0.012
 * + frown dy 0.018 + lower-down splat + dimple, etc., partial overlap);
 * post-amplification it's ~9 cm there. Still well inside the head sphere's
 * ~0.16 m radius and the brief's 0.20 m hard ceiling. No runaway scaling
 * possible.
 */
import type { BuiltFaceMesh } from './mesh-builder';

/** ARKit-style blendshape names. MediaPipe's FaceLandmarker emits these in
 *  `result.faceBlendshapes[0].categories[i].categoryName`. We accept any
 *  string — names not in the supported table below are silently ignored, so
 *  a future MediaPipe model that adds new shapes won't break the puppet. */
export type BlendshapeName = string;

/** Map of name → coefficient (0..1) for one frame. */
export type BlendshapeFrame = Map<BlendshapeName, number>;

/** Construction options. */
export interface FacePuppetOptions {
  /** Disable EMA smoothing on `apply()` — useful when replaying a clip whose
   *  frames were already smoothed at record time, or when running unit tests
   *  that need deterministic single-frame output. Default: true. */
  smooth?: boolean;
  /** EMA blend factor (`smoothed += alpha * (raw - smoothed)`). Higher =
   *  more responsive, more jitter. Default 0.45 gives ~3-frame settling at
   *  30fps with very little visible jitter. */
  smoothingAlpha?: number;
}

export interface FacePuppet {
  /** Apply a frame of blendshapes to the mesh, mutating its geometry. */
  apply(frame: BlendshapeFrame): void;
  /** Restore the mesh to its rest pose (the geometry as it was at puppet
   *  construction time). Also resets internal smoothing state. */
  reset(): void;
  /** Drop owned data (rest-position copy, displacement cache, smoothing map).
   *  After dispose, all methods become no-ops; calling apply() will throw to
   *  surface the misuse rather than silently doing nothing. */
  dispose(): void;
  /** Phase E: read the current EMA-smoothed coefficient for a blendshape,
   *  e.g. `getSmoothedValue('jawOpen')`. Returns 0 when the shape has never
   *  been seen (lazy-init means a never-fired shape isn't in the map). The
   *  procedural-face's conditional features (teeth/tongue visibility) read
   *  from this so they react to the SAME stable signal that drove the
   *  per-vertex displacement on the current frame — not the raw, jittery
   *  MediaPipe coefficient. */
  getSmoothedValue(name: string): number;
}

// ---------------------------------------------------------------------------
// Vertex displacement table
// ---------------------------------------------------------------------------
//
// Each entry maps a blendshape name to a list of (anchorIdx, dx, dy, dz)
// tuples. At build time we splat each anchor's displacement onto its
// neighbors using a Gaussian falloff over `FALLOFF_RADIUS` mesh-local units.
// All magnitudes are tuned for a mesh whose inter-iris distance ≈ 0.2 m.
//
// Indexing follows the canonical MediaPipe FaceMesh — see the diagram at
// https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/images/mediapipe_face_landmark_fullsize.png
// Key landmarks referenced below:
//   10  forehead apex     33  left eye outer    133 left eye inner
//   263 right eye outer   362 right eye inner
//   468 left iris center  473 right iris center
//   61  left mouth corner 291 right mouth corner
//   13  upper lip center  14  lower lip center
//   152 chin tip          70/63/105/66 left brow ring
//   336/296/334/293 right brow ring
//   107 left brow inner   336 right brow inner
//   159/145/153 left upper/lower eyelid
//   386/374/380 right upper/lower eyelid
//
// Magnitudes deliberately conservative — visible motion is the win, not
// anatomical perfection. A user can tell their face is being mirrored
// without the mesh distorting absurdly when MediaPipe over-fires.

/** Falloff radius for Gaussian smearing of an anchor displacement onto its
 *  ring of neighbors. In mesh-local units after the eye-anatomy scale —
 *  0.05 ≈ 1/4 of the inter-iris distance, about the radius of an eye socket
 *  or the half-width of the mouth. */
const FALLOFF_RADIUS = 0.05;

interface Anchor {
  /** Vertex index in the canonical 478-mesh. */
  idx: number;
  /** Displacement at coefficient = 1.0, in mesh-local units (Three.js space). */
  dx: number;
  dy: number;
  dz: number;
}

/**
 * Hand-tuned anchor displacements per supported ARKit blendshape.
 *
 * These were chosen for visual impact + low risk of going off the rails.
 * Magnitudes aim for "clearly visible" rather than "anatomically tracked" —
 * a 25% jaw drop should look like a clear mouth-open, not a subtle hint.
 */
const BLENDSHAPE_ANCHORS: Record<string, Anchor[]> = {
  // Lower jaw drops + chin moves down. Magnitude tuned so a coefficient of
  // 1.0 produces a ~5cm chin drop, which on a 20cm-tall face reads as a
  // wide-open yawn. Lower-lip ring also drops to keep the mouth shape coherent.
  jawOpen: [
    // Chin/jaw silhouette — biggest motion at the chin tip, fading toward jaw line.
    { idx: 152, dx: 0, dy: -0.050, dz: 0 }, // chin tip
    { idx: 148, dx: 0, dy: -0.045, dz: 0 },
    { idx: 377, dx: 0, dy: -0.045, dz: 0 },
    { idx: 176, dx: 0, dy: -0.040, dz: 0 },
    { idx: 400, dx: 0, dy: -0.040, dz: 0 },
    { idx: 149, dx: 0, dy: -0.035, dz: 0 },
    { idx: 378, dx: 0, dy: -0.035, dz: 0 },
    { idx: 150, dx: 0, dy: -0.030, dz: 0 },
    { idx: 379, dx: 0, dy: -0.030, dz: 0 },
    { idx: 136, dx: 0, dy: -0.025, dz: 0 },
    { idx: 365, dx: 0, dy: -0.025, dz: 0 },
    { idx: 172, dx: 0, dy: -0.020, dz: 0 },
    { idx: 397, dx: 0, dy: -0.020, dz: 0 },
    // Lower lip ring — drops with the jaw. Slightly less than the chin so
    // the lip-to-chin distance doesn't grow absurdly.
    { idx: 14,  dx: 0, dy: -0.045, dz: 0 }, // lower lip center // Phase 8.1.1: ↑ from -0.030
    { idx: 87,  dx: 0, dy: -0.042, dz: 0 }, // Phase 8.1.1: ↑ from -0.028
    { idx: 317, dx: 0, dy: -0.042, dz: 0 }, // Phase 8.1.1: ↑ from -0.028
    { idx: 88,  dx: 0, dy: -0.038, dz: 0 }, // Phase 8.1.1: ↑ from -0.025
    { idx: 318, dx: 0, dy: -0.038, dz: 0 }, // Phase 8.1.1: ↑ from -0.025
    { idx: 178, dx: 0, dy: -0.033, dz: 0 }, // Phase 8.1.1: ↑ from -0.022
    { idx: 402, dx: 0, dy: -0.033, dz: 0 }, // Phase 8.1.1: ↑ from -0.022
    { idx: 95,  dx: 0, dy: -0.030, dz: 0 }, // Phase 8.1.1: ↑ from -0.020
    { idx: 324, dx: 0, dy: -0.030, dz: 0 }, // Phase 8.1.1: ↑ from -0.020
  ],
  // Left mouth corner pulls up + slightly outward. ~2.8 cm of upward motion
  // (Phase 8.1.1 amplification) makes the smile read clearly even at
  // moderate coefficients without distorting the cheek.
  mouthSmileLeft: [
    { idx: 61, dx: -0.018, dy: +0.028, dz: 0 }, // left mouth corner // Phase 8.1.1: ↑ from dx -0.012, dy +0.018
    { idx: 78, dx: -0.012, dy: +0.019, dz: 0 }, // Phase 8.1.1: ↑ from dx -0.008, dy +0.012
    { idx: 191, dx: -0.009, dy: +0.016, dz: 0 }, // Phase 8.1.1: ↑ from dx -0.006, dy +0.010
    { idx: 76, dx: -0.008, dy: +0.012, dz: 0 }, // Phase 8.1.1: ↑ from dx -0.005, dy +0.008
  ],
  // Right corner — mirror of the left.
  mouthSmileRight: [
    { idx: 291, dx: +0.018, dy: +0.028, dz: 0 }, // Phase 8.1.1: ↑ from dx +0.012, dy +0.018
    { idx: 308, dx: +0.012, dy: +0.019, dz: 0 }, // Phase 8.1.1: ↑ from dx +0.008, dy +0.012
    { idx: 415, dx: +0.009, dy: +0.016, dz: 0 }, // Phase 8.1.1: ↑ from dx +0.006, dy +0.010
    { idx: 306, dx: +0.008, dy: +0.012, dz: 0 }, // Phase 8.1.1: ↑ from dx +0.005, dy +0.008
  ],
  // Frown — corners pull DOWN + slightly inward. Same magnitude as smile
  // (in the opposite direction) for visual symmetry.
  mouthFrownLeft: [
    { idx: 61, dx: 0, dy: -0.028, dz: 0 }, // Phase 8.1.1: ↑ from -0.018
    { idx: 78, dx: 0, dy: -0.019, dz: 0 }, // Phase 8.1.1: ↑ from -0.012
    { idx: 191, dx: 0, dy: -0.016, dz: 0 }, // Phase 8.1.1: ↑ from -0.010
  ],
  mouthFrownRight: [
    { idx: 291, dx: 0, dy: -0.028, dz: 0 }, // Phase 8.1.1: ↑ from -0.018
    { idx: 308, dx: 0, dy: -0.019, dz: 0 }, // Phase 8.1.1: ↑ from -0.012
    { idx: 415, dx: 0, dy: -0.016, dz: 0 }, // Phase 8.1.1: ↑ from -0.010
  ],
  // Eye blink — upper eyelid moves DOWN to meet the lower eyelid. ~0.012 m
  // is roughly the eye opening height, so coef=1.0 reads as a full closure.
  // Multiple verts on the upper-eyelid ring all drop together.
  eyeBlinkLeft: [
    { idx: 159, dx: 0, dy: -0.012, dz: 0 }, // upper eyelid center
    { idx: 158, dx: 0, dy: -0.011, dz: 0 },
    { idx: 160, dx: 0, dy: -0.011, dz: 0 },
    { idx: 161, dx: 0, dy: -0.009, dz: 0 },
    { idx: 157, dx: 0, dy: -0.009, dz: 0 },
    // Lower eyelid lifts a touch (real eye blink does both, though upper
    // dominates) — 1/3 of the upper magnitude.
    { idx: 145, dx: 0, dy: +0.004, dz: 0 },
    { idx: 144, dx: 0, dy: +0.003, dz: 0 },
    { idx: 153, dx: 0, dy: +0.003, dz: 0 },
  ],
  eyeBlinkRight: [
    { idx: 386, dx: 0, dy: -0.012, dz: 0 }, // upper eyelid center (right)
    { idx: 385, dx: 0, dy: -0.011, dz: 0 },
    { idx: 387, dx: 0, dy: -0.011, dz: 0 },
    { idx: 388, dx: 0, dy: -0.009, dz: 0 },
    { idx: 384, dx: 0, dy: -0.009, dz: 0 },
    { idx: 374, dx: 0, dy: +0.004, dz: 0 },
    { idx: 373, dx: 0, dy: +0.003, dz: 0 },
    { idx: 380, dx: 0, dy: +0.003, dz: 0 },
  ],
  // Inner brows lift — ~1cm rise. Splats outward to the rest of the brow ring.
  browInnerUp: [
    { idx: 107, dx: 0, dy: +0.022, dz: 0 }, // left brow inner // Phase 8.1.1: ↑ from +0.010
    { idx: 336, dx: 0, dy: +0.022, dz: 0 }, // right brow inner // Phase 8.1.1: ↑ from +0.010
    { idx: 9,   dx: 0, dy: +0.018, dz: 0 }, // glabella (between brows) // Phase 8.1.1: ↑ from +0.008
    { idx: 55,  dx: 0, dy: +0.013, dz: 0 }, // Phase 8.1.1: ↑ from +0.006
    { idx: 285, dx: 0, dy: +0.013, dz: 0 }, // Phase 8.1.1: ↑ from +0.006
  ],
  // Left brow lowers — furrowed concentration look.
  browDownLeft: [
    { idx: 70,  dx: 0, dy: -0.016, dz: 0 }, // Phase 8.1.1: ↑ from -0.008
    { idx: 63,  dx: 0, dy: -0.020, dz: 0 }, // Phase 8.1.1: ↑ from -0.010
    { idx: 105, dx: 0, dy: -0.020, dz: 0 }, // Phase 8.1.1: ↑ from -0.010
    { idx: 66,  dx: 0, dy: -0.016, dz: 0 }, // Phase 8.1.1: ↑ from -0.008
    { idx: 107, dx: 0, dy: -0.012, dz: 0 }, // Phase 8.1.1: ↑ from -0.006
  ],
  browDownRight: [
    { idx: 296, dx: 0, dy: -0.016, dz: 0 }, // Phase 8.1.1: ↑ from -0.008
    { idx: 334, dx: 0, dy: -0.020, dz: 0 }, // Phase 8.1.1: ↑ from -0.010
    { idx: 293, dx: 0, dy: -0.020, dz: 0 }, // Phase 8.1.1: ↑ from -0.010
    { idx: 300, dx: 0, dy: -0.016, dz: 0 }, // Phase 8.1.1: ↑ from -0.008
    { idx: 336, dx: 0, dy: -0.012, dz: 0 }, // Phase 8.1.1: ↑ from -0.006
  ],

  // ───────────────────────────── Mouth (pucker / funnel) ─────────────────────────────
  // Lip ring contracts horizontally toward the mouth-center-x (≈0). Originally
  // displacement = (0 - vx)*0.6 capped to ±0.012; Phase 8.1.1 raised the clamp
  // to ±0.022 so the pucker reads clearly. Pre-baked here for each named
  // lip-ring vertex at its rest-x, so the constant table is a straight lookup
  // at apply time. Per-vertex motion derived offline from the canonical
  // FaceMesh's rest x: outer/inner upper + lower lip rings + corners.
  // Magnitudes ≤ 0.022 m (post-amplification).
  // Note: dx sign points toward x=0 (the mouth-center). Verts on the
  // subject's left have positive dx; verts on the subject's right negative.
  // No vertical or z motion — pure horizontal contraction.
  mouthPucker: [
    // Upper lip outer ring (left-of-center first, then right) // Phase 8.1.1: clamp ↑ from 0.012 to 0.022 (all entries scaled ~1.83×)
    { idx: 191, dx: +0.018, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from +0.010
    { idx: 80,  dx: +0.015, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from +0.008
    { idx: 81,  dx: +0.009, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from +0.005
    { idx: 82,  dx: +0.004, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from +0.002
    { idx: 13,  dx:  0.000, dy: 0, dz: 0 }, // dead center; weight via falloff
    { idx: 312, dx: -0.004, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from -0.002
    { idx: 311, dx: -0.009, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from -0.005
    { idx: 310, dx: -0.015, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from -0.008
    { idx: 415, dx: -0.018, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from -0.010
    // Upper lip inner ring + lower lip outer ring (shared verts)
    { idx: 78,  dx: +0.022, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from +0.012
    { idx: 95,  dx: +0.018, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from +0.010
    { idx: 88,  dx: +0.015, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from +0.008
    { idx: 178, dx: +0.009, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from +0.005
    { idx: 87,  dx: +0.004, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from +0.002
    { idx: 14,  dx:  0.000, dy: 0, dz: 0 },
    { idx: 317, dx: -0.004, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from -0.002
    { idx: 402, dx: -0.009, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from -0.005
    { idx: 318, dx: -0.015, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from -0.008
    { idx: 324, dx: -0.018, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from -0.010
    { idx: 308, dx: -0.022, dy: 0, dz: 0 }, // Phase 8.1.1: ↑ from -0.012
    // Mouth corners pull hardest toward center
    { idx: 61,  dx: +0.022, dy: 0, dz: 0 }, // left corner → +x toward 0 // Phase 8.1.1: ↑ from +0.012
    { idx: 291, dx: -0.022, dy: 0, dz: 0 }, // right corner → -x toward 0 // Phase 8.1.1: ↑ from -0.012
  ],
  // Funnel = pucker (horizontal contraction) PLUS lip ring pushed forward (+z)
  // so the mouth forms a tube. Phase 8.1.1: dz raised from +0.008 to +0.012
  // and dx clamp matched to pucker's new ±0.022.
  mouthFunnel: [
    // Mirror of mouthPucker dx, plus a uniform +z push.
    // Phase 8.1.1: clamp ↑ from 0.012 to 0.022 (matched to pucker), dz ↑ from +0.008 to +0.012.
    { idx: 191, dx: +0.018, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx +0.010, dz +0.008
    { idx: 80,  dx: +0.015, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx +0.008, dz +0.008
    { idx: 81,  dx: +0.009, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx +0.005, dz +0.008
    { idx: 82,  dx: +0.004, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx +0.002, dz +0.008
    { idx: 13,  dx:  0.000, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ dz from +0.008
    { idx: 312, dx: -0.004, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx -0.002, dz +0.008
    { idx: 311, dx: -0.009, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx -0.005, dz +0.008
    { idx: 310, dx: -0.015, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx -0.008, dz +0.008
    { idx: 415, dx: -0.018, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx -0.010, dz +0.008
    { idx: 78,  dx: +0.022, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx +0.012, dz +0.008
    { idx: 95,  dx: +0.018, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx +0.010, dz +0.008
    { idx: 88,  dx: +0.015, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx +0.008, dz +0.008
    { idx: 178, dx: +0.009, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx +0.005, dz +0.008
    { idx: 87,  dx: +0.004, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx +0.002, dz +0.008
    { idx: 14,  dx:  0.000, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ dz from +0.008
    { idx: 317, dx: -0.004, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx -0.002, dz +0.008
    { idx: 402, dx: -0.009, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx -0.005, dz +0.008
    { idx: 318, dx: -0.015, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx -0.008, dz +0.008
    { idx: 324, dx: -0.018, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx -0.010, dz +0.008
    { idx: 308, dx: -0.022, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx -0.012, dz +0.008
    { idx: 61,  dx: +0.022, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx +0.012, dz +0.008
    { idx: 291, dx: -0.022, dy: 0, dz: +0.012 }, // Phase 8.1.1: ↑ from dx -0.012, dz +0.008
  ],

  // ───────────────────────────── Mouth shrug (lip purse / pout) ─────────────────────────────
  // Lower lip protrudes upward + slightly forward (pout). +y +0.008, +z +0.005.
  // Phase 8.1.1: peak ↑ from (dy +0.008, dz +0.005) to (dy +0.014, dz +0.009) (~1.75×).
  mouthShrugLower: [
    { idx: 14,  dx: 0, dy: +0.014, dz: +0.009 }, // lower lip center // Phase 8.1.1: ↑ from dy +0.008, dz +0.005
    { idx: 87,  dx: 0, dy: +0.012, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.007, dz +0.005
    { idx: 317, dx: 0, dy: +0.012, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.007, dz +0.005
    { idx: 88,  dx: 0, dy: +0.011, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.006, dz +0.005
    { idx: 318, dx: 0, dy: +0.011, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.006, dz +0.005
    { idx: 178, dx: 0, dy: +0.009, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.005, dz +0.005
    { idx: 402, dx: 0, dy: +0.009, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.005, dz +0.005
    { idx: 95,  dx: 0, dy: +0.007, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.004, dz +0.005
    { idx: 324, dx: 0, dy: +0.007, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.004, dz +0.005
  ],
  // Upper lip protrudes upward + slightly forward (lip purse). Phase 8.1.1: peak ↑ to dy +0.014, dz +0.009.
  mouthShrugUpper: [
    { idx: 13,  dx: 0, dy: +0.014, dz: +0.009 }, // upper lip center // Phase 8.1.1: ↑ from dy +0.008, dz +0.005
    { idx: 82,  dx: 0, dy: +0.012, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.007, dz +0.005
    { idx: 312, dx: 0, dy: +0.012, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.007, dz +0.005
    { idx: 81,  dx: 0, dy: +0.011, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.006, dz +0.005
    { idx: 311, dx: 0, dy: +0.011, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.006, dz +0.005
    { idx: 80,  dx: 0, dy: +0.009, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.005, dz +0.005
    { idx: 310, dx: 0, dy: +0.009, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.005, dz +0.005
    { idx: 191, dx: 0, dy: +0.007, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.004, dz +0.005
    { idx: 415, dx: 0, dy: +0.007, dz: +0.009 }, // Phase 8.1.1: ↑ from dy +0.004, dz +0.005
  ],

  // ───────────────────────────── Brow outer-up ─────────────────────────────
  // Outermost brow points lift. Smaller-than-inner-brow span (only 2 anchors)
  // because the outer brow is more localized.
  browOuterUpLeft: [
    { idx: 70, dx: 0, dy: +0.024, dz: 0 }, // outer-most left brow // Phase 8.1.1: ↑ from +0.012
    { idx: 63, dx: 0, dy: +0.020, dz: 0 }, // Phase 8.1.1: ↑ from +0.010
  ],
  browOuterUpRight: [
    { idx: 296, dx: 0, dy: +0.024, dz: 0 }, // outer-most right brow // Phase 8.1.1: ↑ from +0.012
    { idx: 293, dx: 0, dy: +0.020, dz: 0 }, // Phase 8.1.1: ↑ from +0.010
  ],

  // ───────────────────────────── Eye squint (lower-lid lift) ─────────────────────────────
  // Lower eyelid raises slightly — preserves a slit (different from blink).
  // Magnitude smaller than blink and only the LOWER lid moves.
  eyeSquintLeft: [
    { idx: 145, dx: 0, dy: +0.012, dz: 0 }, // lower lid center // Phase 8.1.1: ↑ from +0.006
    { idx: 144, dx: 0, dy: +0.010, dz: 0 }, // Phase 8.1.1: ↑ from +0.005
    { idx: 153, dx: 0, dy: +0.010, dz: 0 }, // Phase 8.1.1: ↑ from +0.005
    { idx: 154, dx: 0, dy: +0.008, dz: 0 }, // Phase 8.1.1: ↑ from +0.004
    { idx: 155, dx: 0, dy: +0.006, dz: 0 }, // Phase 8.1.1: ↑ from +0.003
  ],
  eyeSquintRight: [
    { idx: 374, dx: 0, dy: +0.012, dz: 0 }, // Phase 8.1.1: ↑ from +0.006
    { idx: 373, dx: 0, dy: +0.010, dz: 0 }, // Phase 8.1.1: ↑ from +0.005
    { idx: 380, dx: 0, dy: +0.010, dz: 0 }, // Phase 8.1.1: ↑ from +0.005
    { idx: 381, dx: 0, dy: +0.008, dz: 0 }, // Phase 8.1.1: ↑ from +0.004
    { idx: 382, dx: 0, dy: +0.006, dz: 0 }, // Phase 8.1.1: ↑ from +0.003
  ],

  // ───────────────────────────── Eye wide (upper-lid lift) ─────────────────────────────
  // Opposite of blink: upper eyelid raises ABOVE rest, opening the eye wider.
  eyeWideLeft: [
    { idx: 159, dx: 0, dy: +0.014, dz: 0 }, // Phase 8.1.1: ↑ from +0.006
    { idx: 158, dx: 0, dy: +0.012, dz: 0 }, // Phase 8.1.1: ↑ from +0.005
    { idx: 160, dx: 0, dy: +0.012, dz: 0 }, // Phase 8.1.1: ↑ from +0.005
    { idx: 161, dx: 0, dy: +0.009, dz: 0 }, // Phase 8.1.1: ↑ from +0.004
  ],
  eyeWideRight: [
    { idx: 386, dx: 0, dy: +0.014, dz: 0 }, // Phase 8.1.1: ↑ from +0.006
    { idx: 385, dx: 0, dy: +0.012, dz: 0 }, // Phase 8.1.1: ↑ from +0.005
    { idx: 387, dx: 0, dy: +0.012, dz: 0 }, // Phase 8.1.1: ↑ from +0.005
    { idx: 388, dx: 0, dy: +0.009, dz: 0 }, // Phase 8.1.1: ↑ from +0.004
  ],

  // ───────────────────────────── Mouth upper-up (sneer) ─────────────────────────────
  // Just the half-side of upper lip lifts (left-of-center for *Left, etc.).
  // Excludes the very-central verts (82, 13) which would belong to both sides.
  mouthUpperUpLeft: [
    { idx: 191, dx: 0, dy: +0.020, dz: 0 }, // Phase 8.1.1: ↑ from +0.012
    { idx: 80,  dx: 0, dy: +0.017, dz: 0 }, // Phase 8.1.1: ↑ from +0.010
    { idx: 81,  dx: 0, dy: +0.013, dz: 0 }, // Phase 8.1.1: ↑ from +0.008
  ],
  mouthUpperUpRight: [
    { idx: 415, dx: 0, dy: +0.020, dz: 0 }, // Phase 8.1.1: ↑ from +0.012
    { idx: 310, dx: 0, dy: +0.017, dz: 0 }, // Phase 8.1.1: ↑ from +0.010
    { idx: 311, dx: 0, dy: +0.013, dz: 0 }, // Phase 8.1.1: ↑ from +0.008
  ],

  // ───────────────────────────── Mouth lower-down (frown corner stretch) ─────────────────────────────
  // Half-side lower lip pulls down. Excludes central verts (87, 14, 317).
  mouthLowerDownLeft: [
    { idx: 95,  dx: 0, dy: -0.018, dz: 0 }, // Phase 8.1.1: ↑ from -0.010
    { idx: 88,  dx: 0, dy: -0.016, dz: 0 }, // Phase 8.1.1: ↑ from -0.009
    { idx: 178, dx: 0, dy: -0.013, dz: 0 }, // Phase 8.1.1: ↑ from -0.007
  ],
  mouthLowerDownRight: [
    { idx: 324, dx: 0, dy: -0.018, dz: 0 }, // Phase 8.1.1: ↑ from -0.010
    { idx: 318, dx: 0, dy: -0.016, dz: 0 }, // Phase 8.1.1: ↑ from -0.009
    { idx: 402, dx: 0, dy: -0.013, dz: 0 }, // Phase 8.1.1: ↑ from -0.007
  ],

  // ───────────────────────────── Mouth dimple ─────────────────────────────
  // Mouth corner pulls toward cheek (sideways/back). Subtle (~0.005 m).
  // For *Left: corner moves to subject-left (-x) toward cheek.
  mouthDimpleLeft: [
    { idx: 61, dx: -0.005, dy: +0.001, dz: 0 }, // left corner toward left cheek
    { idx: 78, dx: -0.003, dy: +0.001, dz: 0 },
  ],
  mouthDimpleRight: [
    { idx: 291, dx: +0.005, dy: +0.001, dz: 0 },
    { idx: 308, dx: +0.003, dy: +0.001, dz: 0 },
  ],

  // ───────────────────────────── Mouth roll (lips disappear inward) ─────────────────────────────
  // Upper lip rolls inward toward mouth interior: -y + +z (down and back-into-mouth).
  mouthRollUpper: [
    { idx: 13,  dx: 0, dy: -0.005, dz: +0.005 },
    { idx: 82,  dx: 0, dy: -0.004, dz: +0.004 },
    { idx: 312, dx: 0, dy: -0.004, dz: +0.004 },
    { idx: 81,  dx: 0, dy: -0.003, dz: +0.003 },
    { idx: 311, dx: 0, dy: -0.003, dz: +0.003 },
  ],
  // Lower lip rolls inward: +y + +z.
  mouthRollLower: [
    { idx: 14,  dx: 0, dy: +0.005, dz: +0.005 },
    { idx: 87,  dx: 0, dy: +0.004, dz: +0.004 },
    { idx: 317, dx: 0, dy: +0.004, dz: +0.004 },
    { idx: 88,  dx: 0, dy: +0.003, dz: +0.003 },
    { idx: 318, dx: 0, dy: +0.003, dz: +0.003 },
  ],

  // ───────────────────────────── Mouth press (corner squeeze inward) ─────────────────────────────
  // Mouth corner moves horizontally toward center (~5 mm).
  mouthPressLeft: [
    { idx: 61, dx: +0.005, dy: 0, dz: 0 }, // toward x=0
  ],
  mouthPressRight: [
    { idx: 291, dx: -0.005, dy: 0, dz: 0 },
  ],

  // ───────────────────────────── Mouth close ─────────────────────────────
  // Lip rings move toward each other vertically (~5 mm each). Subtle —
  // counters the rest gap when the rig has slightly-parted lips.
  mouthClose: [
    // Upper lip ring drops
    { idx: 13,  dx: 0, dy: -0.005, dz: 0 },
    { idx: 82,  dx: 0, dy: -0.004, dz: 0 },
    { idx: 312, dx: 0, dy: -0.004, dz: 0 },
    { idx: 81,  dx: 0, dy: -0.003, dz: 0 },
    { idx: 311, dx: 0, dy: -0.003, dz: 0 },
    // Lower lip ring rises
    { idx: 14,  dx: 0, dy: +0.005, dz: 0 },
    { idx: 87,  dx: 0, dy: +0.004, dz: 0 },
    { idx: 317, dx: 0, dy: +0.004, dz: 0 },
    { idx: 88,  dx: 0, dy: +0.003, dz: 0 },
    { idx: 318, dx: 0, dy: +0.003, dz: 0 },
  ],

  // ───────────────────────────── Eye gaze (iris-only) ─────────────────────────────
  // These shift only the iris vertex group. They're flagged in
  // BLENDSHAPE_NO_FALLOFF below so the Gaussian splat is suppressed and
  // surrounding eyelid verts aren't dragged along — the eye gaze should
  // look like the iris sliding inside a still eyelid, not the whole eye
  // socket warping.
  // Magnitudes: ±0.005 m for up/down/in/out per the brief.
  // Iris ring indices: left = 468–472, right = 473–477.
  eyeLookUpLeft: [
    { idx: 468, dx: 0, dy: +0.005, dz: 0 }, // left iris center
    { idx: 469, dx: 0, dy: +0.005, dz: 0 },
    { idx: 470, dx: 0, dy: +0.005, dz: 0 },
    { idx: 471, dx: 0, dy: +0.005, dz: 0 },
    { idx: 472, dx: 0, dy: +0.005, dz: 0 },
  ],
  eyeLookUpRight: [
    { idx: 473, dx: 0, dy: +0.005, dz: 0 },
    { idx: 474, dx: 0, dy: +0.005, dz: 0 },
    { idx: 475, dx: 0, dy: +0.005, dz: 0 },
    { idx: 476, dx: 0, dy: +0.005, dz: 0 },
    { idx: 477, dx: 0, dy: +0.005, dz: 0 },
  ],
  eyeLookDownLeft: [
    { idx: 468, dx: 0, dy: -0.005, dz: 0 },
    { idx: 469, dx: 0, dy: -0.005, dz: 0 },
    { idx: 470, dx: 0, dy: -0.005, dz: 0 },
    { idx: 471, dx: 0, dy: -0.005, dz: 0 },
    { idx: 472, dx: 0, dy: -0.005, dz: 0 },
  ],
  eyeLookDownRight: [
    { idx: 473, dx: 0, dy: -0.005, dz: 0 },
    { idx: 474, dx: 0, dy: -0.005, dz: 0 },
    { idx: 475, dx: 0, dy: -0.005, dz: 0 },
    { idx: 476, dx: 0, dy: -0.005, dz: 0 },
    { idx: 477, dx: 0, dy: -0.005, dz: 0 },
  ],
  // LookIn = toward the nose. For LEFT iris, nose is at +x (subject's right
  // of the left eye), so dx=+0.005. For RIGHT iris, nose is at -x.
  eyeLookInLeft: [
    { idx: 468, dx: +0.005, dy: 0, dz: 0 },
    { idx: 469, dx: +0.005, dy: 0, dz: 0 },
    { idx: 470, dx: +0.005, dy: 0, dz: 0 },
    { idx: 471, dx: +0.005, dy: 0, dz: 0 },
    { idx: 472, dx: +0.005, dy: 0, dz: 0 },
  ],
  eyeLookInRight: [
    { idx: 473, dx: -0.005, dy: 0, dz: 0 },
    { idx: 474, dx: -0.005, dy: 0, dz: 0 },
    { idx: 475, dx: -0.005, dy: 0, dz: 0 },
    { idx: 476, dx: -0.005, dy: 0, dz: 0 },
    { idx: 477, dx: -0.005, dy: 0, dz: 0 },
  ],
  // LookOut = toward the ear (away from nose). Mirror of LookIn.
  eyeLookOutLeft: [
    { idx: 468, dx: -0.005, dy: 0, dz: 0 },
    { idx: 469, dx: -0.005, dy: 0, dz: 0 },
    { idx: 470, dx: -0.005, dy: 0, dz: 0 },
    { idx: 471, dx: -0.005, dy: 0, dz: 0 },
    { idx: 472, dx: -0.005, dy: 0, dz: 0 },
  ],
  eyeLookOutRight: [
    { idx: 473, dx: +0.005, dy: 0, dz: 0 },
    { idx: 474, dx: +0.005, dy: 0, dz: 0 },
    { idx: 475, dx: +0.005, dy: 0, dz: 0 },
    { idx: 476, dx: +0.005, dy: 0, dz: 0 },
    { idx: 477, dx: +0.005, dy: 0, dz: 0 },
  ],

  // ───────────────────────────── Jaw direction ─────────────────────────────
  // Jaw silhouette (the same chin/jaw landmark cluster used by jawOpen) shifts
  // as a unit. Magnitudes per brief: +z 0.012 forward, ±x 0.010 lateral.
  jawForward: [
    { idx: 152, dx: 0, dy: 0, dz: +0.012 }, // chin tip
    { idx: 148, dx: 0, dy: 0, dz: +0.011 },
    { idx: 377, dx: 0, dy: 0, dz: +0.011 },
    { idx: 176, dx: 0, dy: 0, dz: +0.010 },
    { idx: 400, dx: 0, dy: 0, dz: +0.010 },
    { idx: 149, dx: 0, dy: 0, dz: +0.009 },
    { idx: 378, dx: 0, dy: 0, dz: +0.009 },
    { idx: 150, dx: 0, dy: 0, dz: +0.008 },
    { idx: 379, dx: 0, dy: 0, dz: +0.008 },
  ],
  jawLeft: [
    // jaw shifts to subject's left (-x)
    { idx: 152, dx: -0.010, dy: 0, dz: 0 },
    { idx: 148, dx: -0.010, dy: 0, dz: 0 },
    { idx: 377, dx: -0.010, dy: 0, dz: 0 },
    { idx: 176, dx: -0.009, dy: 0, dz: 0 },
    { idx: 400, dx: -0.009, dy: 0, dz: 0 },
    { idx: 149, dx: -0.008, dy: 0, dz: 0 },
    { idx: 378, dx: -0.008, dy: 0, dz: 0 },
    { idx: 150, dx: -0.007, dy: 0, dz: 0 },
    { idx: 379, dx: -0.007, dy: 0, dz: 0 },
  ],
  jawRight: [
    // jaw shifts to subject's right (+x)
    { idx: 152, dx: +0.010, dy: 0, dz: 0 },
    { idx: 148, dx: +0.010, dy: 0, dz: 0 },
    { idx: 377, dx: +0.010, dy: 0, dz: 0 },
    { idx: 176, dx: +0.009, dy: 0, dz: 0 },
    { idx: 400, dx: +0.009, dy: 0, dz: 0 },
    { idx: 149, dx: +0.008, dy: 0, dz: 0 },
    { idx: 378, dx: +0.008, dy: 0, dz: 0 },
    { idx: 150, dx: +0.007, dy: 0, dz: 0 },
    { idx: 379, dx: +0.007, dy: 0, dz: 0 },
  ],

  // ───────────────────────────── Cheek ─────────────────────────────
  // Cheek puff: both cheeks balloon outward. Left cheek (50) -x, right (280) +x.
  cheekPuff: [
    { idx: 50,  dx: -0.008, dy: 0, dz: +0.003 }, // left cheek puff outward + slight forward
    { idx: 280, dx: +0.008, dy: 0, dz: +0.003 }, // right cheek puff outward
    { idx: 101, dx: -0.005, dy: 0, dz: +0.002 }, // left cheek upper
    { idx: 330, dx: +0.005, dy: 0, dz: +0.002 }, // right cheek upper
  ],
  // Cheek squint: cheek raises ("apple") on the side. +y motion.
  cheekSquintLeft: [
    { idx: 50,  dx: 0, dy: +0.005, dz: 0 },
    { idx: 101, dx: 0, dy: +0.004, dz: 0 },
    { idx: 205, dx: 0, dy: +0.004, dz: 0 },
  ],
  cheekSquintRight: [
    { idx: 280, dx: 0, dy: +0.005, dz: 0 },
    { idx: 330, dx: 0, dy: +0.004, dz: 0 },
    { idx: 425, dx: 0, dy: +0.004, dz: 0 },
  ],
};

/**
 * Set of blendshape names whose anchor displacements should be applied
 * WITHOUT the Gaussian falloff splat. Used for iris-only motion (eye gaze)
 * where the iris vertex group must move as a rigid unit and not drag the
 * surrounding eyelid landmarks. The iris ring (468–477) sits geometrically
 * inside the eye opening, well within FALLOFF_RADIUS of upper-lid verts
 * like 159 / 386, so without this guard the eyelids would slide with the
 * iris and the whole eye would warp instead of just the gaze direction
 * shifting.
 */
const BLENDSHAPE_NO_FALLOFF: ReadonlySet<string> = new Set([
  'eyeLookUpLeft',
  'eyeLookUpRight',
  'eyeLookDownLeft',
  'eyeLookDownRight',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
]);

/**
 * Build the per-blendshape displacement tables from the anchor list +
 * Gaussian falloff. Result is a `Map<name, Float32Array(478*3)>` we can
 * sum into during apply().
 *
 * Why pre-bake: per-frame we want the inner loop to be a tight 478×K
 * vector add, not a quadratic scan over neighbor distances. The anchor
 * count is small (~25 max), but a falloff over the full 478 verts at
 * 30fps × 10 blendshapes would be 143k distance computations per frame
 * — easy to avoid by paying the cost once at construction.
 */
function buildDisplacementTables(
  restPositions: Float32Array,
  vertexCount: number,
): Map<string, Float32Array> {
  const tables = new Map<string, Float32Array>();
  // Precompute squared falloff radius so the per-neighbor check is one mul.
  const r2 = FALLOFF_RADIUS * FALLOFF_RADIUS;
  // Gaussian sigma — chosen so contribution at FALLOFF_RADIUS is ~0.04
  // (essentially zero), with a smooth bell. sigma = radius / 1.8 gives
  // exp(-(r/sigma)^2 / 2) ≈ 0.20 at r=radius — a tunable falloff with
  // visible-but-soft contribution at the edge.
  const sigma = FALLOFF_RADIUS / 1.8;
  const sigma2 = sigma * sigma;

  for (const [name, anchors] of Object.entries(BLENDSHAPE_ANCHORS)) {
    const buf = new Float32Array(vertexCount * 3);
    const noFalloff = BLENDSHAPE_NO_FALLOFF.has(name);

    for (const anchor of anchors) {
      if (anchor.idx >= vertexCount) continue;

      // Anchor itself contributes the full displacement.
      buf[anchor.idx * 3 + 0] += anchor.dx;
      buf[anchor.idx * 3 + 1] += anchor.dy;
      buf[anchor.idx * 3 + 2] += anchor.dz;

      // Skip the Gaussian splat for iris-only / rigid-group blendshapes.
      // (See BLENDSHAPE_NO_FALLOFF — keeps eyelid verts still while the iris moves.)
      if (noFalloff) continue;

      const ax = restPositions[anchor.idx * 3 + 0];
      const ay = restPositions[anchor.idx * 3 + 1];
      const az = restPositions[anchor.idx * 3 + 2];

      // Splat onto neighbors via Gaussian falloff. The distance test in
      // squared space cheaply rejects the ~95% of vertices outside r.
      for (let i = 0; i < vertexCount; i++) {
        if (i === anchor.idx) continue;
        const px = restPositions[i * 3 + 0];
        const py = restPositions[i * 3 + 1];
        const pz = restPositions[i * 3 + 2];
        const dx = px - ax;
        const dy = py - ay;
        const dz = pz - az;
        const dist2 = dx * dx + dy * dy + dz * dz;
        if (dist2 > r2) continue;
        // Smooth falloff: gaussian at the squared distance.
        const w = Math.exp(-dist2 / (2 * sigma2));
        buf[i * 3 + 0] += anchor.dx * w;
        buf[i * 3 + 1] += anchor.dy * w;
        buf[i * 3 + 2] += anchor.dz * w;
      }
    }

    tables.set(name, buf);
  }

  return tables;
}

/**
 * Create a `FacePuppet` bound to the given mesh.
 *
 * Snapshots the rest position via `new Float32Array(src)` (deep copy — NOT
 * a reference to the live attribute) so `reset()` and per-frame `apply()`
 * can recompute
 * `pos = rest + Σ weighted_disp` without drift. The displacement tables
 * are baked once and reused for every frame; they're cheap memory
 * (10 × 478 × 3 × 4 = ~60KB) and avoid quadratic per-frame work.
 */
export function createFacePuppet(
  mesh: BuiltFaceMesh,
  options: FacePuppetOptions = {},
): FacePuppet {
  const smooth = options.smooth ?? true;
  const alpha = options.smoothingAlpha ?? 0.45;

  const posAttr = mesh.geometry.attributes.position as
    | { array: Float32Array; count: number }
    | undefined;
  if (!posAttr) {
    throw new Error('createFacePuppet: mesh has no position attribute');
  }
  // DEEP COPY of the rest pose. Without slice() we'd hold a reference to
  // the live attribute and the first apply() would corrupt the source data.
  const restPositions = new Float32Array(posAttr.array);
  const vertexCount = posAttr.count;

  // Pre-bake displacement tables. Cost: ~5ms one-time for 10 blendshapes ×
  // 478 verts.
  const displacementTables = buildDisplacementTables(restPositions, vertexCount);

  // Smoothing state: per-blendshape EMA-filtered coefficient. Lazy-init so
  // we don't carry 52 zeros for shapes that never fire.
  const smoothed = new Map<string, number>();

  // Working buffer for apply() — same Float32Array we mutate in place on
  // the geometry attribute. Allocated once.
  const liveArray = posAttr.array;
  let disposed = false;

  return {
    apply(frame: BlendshapeFrame): void {
      if (disposed) {
        throw new Error('FacePuppet.apply: already disposed');
      }

      // Update smoothing state. Iterate over *all* blendshapes the frame
      // mentions so brand-new keys get initialized on first appearance.
      // We DON'T iterate over the previously-seen-but-now-absent keys —
      // they keep their last value, which means a momentary detection
      // gap holds the expression instead of snapping to neutral. That
      // matches the "MediaPipe blendshapes not detected this frame: skip
      // the apply" intent — the caller already gates on faceBlendshapes
      // existing, so absent keys here mean "this expression isn't firing
      // right now", and an EMA decay toward zero is the right behavior.
      if (smooth) {
        // Collect the union of "names already smoothed" and "names in this
        // frame" so dropped-from-frame names decay toward zero gracefully.
        for (const [name, raw] of frame) {
          const prev = smoothed.get(name) ?? 0;
          smoothed.set(name, prev + alpha * (raw - prev));
        }
        // Decay any previously-active blendshape that wasn't in this frame
        // — same as treating its raw value as 0. Otherwise stale shapes
        // would freeze the mesh in old expressions.
        for (const [name, prev] of smoothed) {
          if (!frame.has(name)) {
            smoothed.set(name, prev + alpha * (0 - prev));
          }
        }
      } else {
        smoothed.clear();
        for (const [name, raw] of frame) smoothed.set(name, raw);
      }

      // Compute pos = rest + Σ (smoothed[k] * disp[k]) into the live array.
      // Start by copying rest into live — the mutate loop adds offsets on top.
      liveArray.set(restPositions);
      for (const [name, coef] of smoothed) {
        if (!Number.isFinite(coef) || Math.abs(coef) < 1e-4) continue;
        const disp = displacementTables.get(name);
        if (!disp) continue; // Unsupported blendshape — silently ignore.
        // Inner loop: 478 × 3 = 1434 fused-multiply-adds. At 30fps × 10
        // shapes this is ~430k ops/sec, negligible.
        for (let i = 0; i < liveArray.length; i++) {
          liveArray[i] += coef * disp[i];
        }
      }
      (posAttr as unknown as { needsUpdate: boolean }).needsUpdate = true;
      // Recompute normals so lighting shifts with the deformation. We use
      // MeshBasicMaterial which ignores normals, but a future pipeline
      // swapping in MeshStandardMaterial would expect this — and the cost
      // is negligible for 478 verts.
      mesh.geometry.computeVertexNormals();
    },

    reset(): void {
      if (disposed) return;
      liveArray.set(restPositions);
      (posAttr as unknown as { needsUpdate: boolean }).needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      smoothed.clear();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      smoothed.clear();
      displacementTables.clear();
      // Note: we do NOT dispose the geometry/material here — the mesh is
      // owned by the caller (player rig / scene). Restoring rest position
      // first ensures the mesh isn't left in a half-deformed state if it
      // remains in the scene after dispose.
      liveArray.set(restPositions);
      (posAttr as unknown as { needsUpdate: boolean }).needsUpdate = true;
    },

    getSmoothedValue(name: string): number {
      if (disposed) return 0;
      return smoothed.get(name) ?? 0;
    },
  };
}
