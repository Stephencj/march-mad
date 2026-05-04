/**
 * Phase H1 — Stylized feature baker.
 *
 * Takes a scanned front-pose face (data-URL photo + 478 landmarks +
 * optional sampled colors) and produces a small bundle of stylized PNG
 * crops, one per feature. The crops are intended for the Phase H2
 * Mii-style renderer, which mounts each as a textured plane on the
 * cranium. This module does NOT render to the rig — it is bake-only.
 *
 * Pipeline per feature:
 *   1. Compute a pixel bbox from a feature-specific landmark set, padded
 *      by a per-feature factor (`paddingFactor` → expands bbox outward).
 *   2. Crop the source photo within the bbox into an offscreen canvas at
 *      the feature's target output resolution.
 *   3. Stylize:
 *        - Posterize: reduce each pixel's RGB to a small set of
 *          quantized levels (uniform per-channel quantization). Aim is
 *          "magazine illustration" not "pixel art" — palette values are
 *          intentionally generous (6–12) so banding stays subtle.
 *        - Edge enhance: 3x3 unsharp mask convolution at modest weight.
 *        - Optional alpha mask: fill the landmark contour as a polygon
 *          on a mask canvas, then `destination-in` composite to keep
 *          only feature pixels (clean stencil edges, not a rectangular
 *          sticker).
 *        - Optional color enhancement: nudge each pixel toward a sampled
 *          target (lipColor / browColor / iris) so dim/washed-out scans
 *          don't render gray.
 *   4. Output a PNG data URL + the source bbox + the 3D rest position
 *      derived from the landmark centroid (Three.js mesh-local coords).
 *
 * Coord conventions (matching mesh-builder.ts):
 *   x_three = x_mp - 0.5
 *   y_three = -(y_mp - 0.5)
 *   z_three = -z_mp
 * `center3D` and `size3D` are PRE-scale — the renderer (H2) is
 * responsible for applying any uniform mesh scale.
 */
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { FaceFeatureCrop, FeatureImagesBundle } from './types';
import {
  loadImageToCanvas,
  unpackColor,
  packColor,
  pixelLuma,
  type SampleContext,
} from './sample-utils';

// ---------------------------------------------------------------------------
// Per-feature landmark sets. Cribbed from procedural-face.ts where the same
// indices already drive geometric features.

const LEFT_EYE_INDICES: ReadonlyArray<number> = [33, 7, 163, 144, 145, 153, 154, 155, 133];
const RIGHT_EYE_INDICES: ReadonlyArray<number> = [362, 398, 384, 385, 386, 387, 388, 466, 263];
// Brow: 5-pt top arch only. The plan listed `55, 193` as "arch" anchors
// but those landmarks sit BELOW the brow line (193 is mid-face, ~y=0.37
// vs brow ~y=0.27) and drag the bbox down across the eye. The 5 top
// points alone produce a clean brow stencil; padding (+30%) handles the
// vertical span the renderer needs.
const LEFT_BROW_INDICES: ReadonlyArray<number> = [70, 63, 105, 66, 107];
const RIGHT_BROW_INDICES: ReadonlyArray<number> = [336, 296, 334, 293, 300];
const NOSE_INDICES: ReadonlyArray<number> = [168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 327];
const MOUTH_INDICES: ReadonlyArray<number> = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
];
const BEARD_INDICES: ReadonlyArray<number> = [
  234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 454,
];
const MUSTACHE_INDICES: ReadonlyArray<number> = [
  0, 267, 269, 270, 409, 291, 375, 287, 273, 335, 406, 313, 18, 17, 84, 181,
];
const HAT_ANCHOR_INDICES: ReadonlyArray<number> = [10, 109, 338];
const FACE_TOP_INDEX = 10;
const FACE_BOTTOM_INDEX = 152;

// ---------------------------------------------------------------------------
// Per-feature bake settings.

interface FeatureSpec {
  indices: ReadonlyArray<number>;
  /** Bbox padding as a fraction of bbox dimension. */
  padding: number;
  outW: number;
  outH: number;
  /** Posterization "palette size" — used to derive levels-per-channel.
   *  When `>= 32`, posterize is effectively a no-op for visible banding —
   *  small features (eyes/brows) use this to skip the chroma-quantization
   *  noise that destroys fine detail. */
  palette: number;
  /** Stencil the crop to the landmark polygon? */
  stencil: boolean;
  /** Apply unsharp-mask edge enhance? */
  edgeEnhance: boolean;
  /** HSV-style saturation boost during posterize (1.0 = no-op). */
  satBoost: number;
  /** When defined, skip baking if dark-pixel % falls below this threshold. */
  requireDarkPct?: number;
  /** Fit mode for source bbox into output canvas:
   *   - 'contain': aspect-preserve, letterbox transparent margins (default
   *     for big features that benefit from preserved aspect)
   *   - 'cover': aspect-preserve, crop overflow (best for small features
   *     where transparent margins waste pixels)
   *   - 'stretch': fill output canvas regardless of aspect (legacy) */
  fitMode?: 'contain' | 'cover' | 'stretch';
  /** Phase H2c — Alpha mask mode. When set, the baker post-processes the
   *  crop to write alpha=0 outside the feature shape:
   *   - 'polygon': fill the landmark polygon as the visible region
   *     (eyes / mouth — clean stencil edges)
   *   - 'luma-dark': pixels darker than `skinTone × 0.6` luma stay opaque,
   *     others go transparent (brows — hair-only mask)
   *   This RUNS AFTER posterize/edgeEnhance so the underlying photo pixels
   *   carry the same color treatment they had pre-mask. */
  alphaMask?: 'polygon' | 'luma-dark';
}

type FeatureName =
  | 'leftEye' | 'rightEye'
  | 'leftBrow' | 'rightBrow'
  | 'nose' | 'mouth'
  | 'beard' | 'mustache' | 'hat';

// Posterization tuning: `palette` here is interpreted by `posterize` as
// the LEVELS-PER-CHANNEL count directly (not a derived value). For big
// features (nose, mouth, beard, hat) 8–10 levels per channel produces
// the magazine-illustration look. SMALL features (eyes, brows) bypass
// posterization (`palette: 64`, effectively a no-op) — at <200×100
// pixels, quantization on the user's purple-cast white-balance flips
// mid-tones to magenta blotches and destroys iris/pupil detail.
//
// satBoost is GLOBAL on top of any target-color enhancement. We keep it
// at 1.0 (no boost) because the per-feature lipColor / browColor blend
// already does the meaningful color work; raising it amplifies chroma
// noise on skin pixels around the feature.
//
// Eye/brow output resolutions are bumped vs. the original spec (eye
// 192×144, brow 192×72) so the small source crops aren't stretched as
// hard during the bake.
const FEATURE_SPECS: Record<FeatureName, FeatureSpec> = {
  // Phase H2c: eyes/brows/mouth get alpha masks so the H2 renderer's
  // overlay planes stop rendering rectangular photo crops. fitMode flips
  // to 'contain' so the polygon mask coordinates (computed in source-bbox
  // pixel space) line up with the output canvas without 'cover' shifting
  // pixels around.
  leftEye:   { indices: LEFT_EYE_INDICES,   padding: 0.40, outW: 192, outH: 144, palette: 64, stencil: false, edgeEnhance: true,  satBoost: 1.00, fitMode: 'contain', alphaMask: 'polygon'   },
  rightEye:  { indices: RIGHT_EYE_INDICES,  padding: 0.40, outW: 192, outH: 144, palette: 64, stencil: false, edgeEnhance: true,  satBoost: 1.00, fitMode: 'contain', alphaMask: 'polygon'   },
  leftBrow:  { indices: LEFT_BROW_INDICES,  padding: 0.45, outW: 192, outH: 72,  palette: 64, stencil: false, edgeEnhance: true,  satBoost: 1.00, fitMode: 'contain', alphaMask: 'luma-dark' },
  rightBrow: { indices: RIGHT_BROW_INDICES, padding: 0.45, outW: 192, outH: 72,  palette: 64, stencil: false, edgeEnhance: true,  satBoost: 1.00, fitMode: 'contain', alphaMask: 'luma-dark' },
  nose:      { indices: NOSE_INDICES,       padding: 0.20, outW: 96,  outH: 144, palette: 10, stencil: false, edgeEnhance: true,  satBoost: 1.00, fitMode: 'contain' },
  mouth:     { indices: MOUTH_INDICES,      padding: 0.25, outW: 160, outH: 96,  palette: 10, stencil: false, edgeEnhance: true,  satBoost: 1.00, fitMode: 'contain', alphaMask: 'polygon'   },
  beard:     { indices: BEARD_INDICES,      padding: 0.15, outW: 192, outH: 128, palette: 8,  stencil: false, edgeEnhance: false, satBoost: 1.00, requireDarkPct: 12, fitMode: 'contain' },
  mustache:  { indices: MUSTACHE_INDICES,   padding: 0.15, outW: 144, outH: 64,  palette: 8,  stencil: false, edgeEnhance: false, satBoost: 1.00, requireDarkPct: 10, fitMode: 'contain' },
  // Hat output is WIDE-AND-SHORT (256×96, aspect ~2.7:1). Caps span
  // wider than they are tall in front-pose photos, and the hat bbox
  // (1.4 × faceWidth × ~1.0 × faceHeight clamped to image top) is
  // typically wider than tall too — matching aspects keeps `cover` from
  // chopping the cap into a vertical sliver. Palette is bumped to 16
  // (vs 8) so the cap's neutral-gray pixels don't get crushed into a
  // single dark band; the sampled hat color is often unreliable when
  // the brim casts a shadow on its own bowl, so we don't tint toward it.
  hat:       { indices: HAT_ANCHOR_INDICES, padding: 0.05, outW: 256, outH: 96,  palette: 16, stencil: false, edgeEnhance: false, satBoost: 1.00, fitMode: 'contain' },
};

// ---------------------------------------------------------------------------
// Public API

export interface SampledColors {
  lipColor?: number;
  browColors?: { left?: number; right?: number };
  eyeColors?: { left?: number; right?: number };
  skinTone?: number;
  hatColor?: number;
}

export interface BakeResult {
  bundle: FeatureImagesBundle;
  warnings: string[];
}

/**
 * Bake all feature crops from a front-pose photo + landmarks. Always
 * produces the six core features (eyes/brows/nose/mouth); beard/
 * mustache/hat are conditional on enough signal in the photo region.
 *
 * Throws on top-level failure (image won't load, required feature
 * degenerate). Per-optional-feature failures push onto `warnings` and
 * the feature is omitted from the returned bundle.
 */
export async function bakeFeatureImages(
  frontImageDataUrl: string,
  landmarks: NormalizedLandmark[],
  sampledColors?: SampledColors,
): Promise<BakeResult> {
  const ctx = await loadImageToCanvas(frontImageDataUrl);
  const warnings: string[] = [];

  const required: FeatureName[] = ['leftEye', 'rightEye', 'leftBrow', 'rightBrow', 'nose', 'mouth'];
  const optional: FeatureName[] = ['beard', 'mustache'];

  const crops: Partial<Record<FeatureName, FaceFeatureCrop>> = {};
  for (const name of required) {
    const c = bakeOneFeature(name, ctx, landmarks, sampledColors, warnings);
    if (!c) {
      throw new Error(
        `feature-baker: required feature "${name}" failed — landmark set degenerate or photo unreadable`,
      );
    }
    crops[name] = c;
  }
  for (const name of optional) {
    const c = bakeOneFeature(name, ctx, landmarks, sampledColors, warnings);
    if (c) crops[name] = c;
  }
  const hat = bakeHat(ctx, landmarks, sampledColors, warnings);
  if (hat) crops.hat = hat;

  // Phase H2c — composite face plate. Combines a sampled-skin-tone base
  // canvas with the nose/beard/mustache pixels alpha-composited in. The
  // renderer mounts this ONE plane in place of the per-feature
  // nose/beard/mustache planes (which read as photo rectangles).
  let facePlate: FaceFeatureCrop | null = null;
  try {
    facePlate = bakeFacePlate(ctx, landmarks, sampledColors, warnings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`facePlate: bake threw: ${msg}`);
  }

  const bundle: FeatureImagesBundle = {
    leftEye: crops.leftEye!,
    rightEye: crops.rightEye!,
    leftBrow: crops.leftBrow!,
    rightBrow: crops.rightBrow!,
    nose: crops.nose!,
    mouth: crops.mouth!,
  };
  if (crops.beard) bundle.beard = crops.beard;
  if (crops.mustache) bundle.mustache = crops.mustache;
  if (crops.hat) bundle.hat = crops.hat;
  if (facePlate) bundle.facePlate = facePlate;

  return { bundle, warnings };
}

// ---------------------------------------------------------------------------
// Per-feature bake

export function bakeOneFeature(
  name: FeatureName,
  ctx: SampleContext,
  landmarks: NormalizedLandmark[],
  sampledColors: SampledColors | undefined,
  warnings: string[],
): FaceFeatureCrop | null {
  const spec = FEATURE_SPECS[name];
  const bbox = landmarkBboxExpanded(landmarks, spec.indices, ctx.width, ctx.height, spec.padding);
  if (!bbox) {
    warnings.push(`${name}: landmark bbox failed (missing or non-finite indices)`);
    return null;
  }

  const out = document.createElement('canvas');
  out.width = spec.outW;
  out.height = spec.outH;
  const octx = out.getContext('2d', { willReadFrequently: true });
  if (!octx) {
    warnings.push(`${name}: 2D context unavailable`);
    return null;
  }
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.clearRect(0, 0, spec.outW, spec.outH);

  // Aspect-preserving fit. Three modes:
  //   - 'contain': letterbox into output (preserves all source pixels,
  //     pads transparent margins). Best for big features where margins
  //     are ok.
  //   - 'cover': crop to fill output (loses some source edges, fills
  //     the canvas). Best for small features (eyes/brows) where
  //     transparent margins would waste output pixels and the renderer
  //     wants the feature to fill the texture.
  //   - 'stretch': fill output regardless of aspect (legacy / debug).
  const fit = spec.fitMode ?? 'contain';
  const srcAspect = bbox.w / bbox.h;
  const outAspect = spec.outW / spec.outH;
  if (fit === 'stretch') {
    octx.drawImage(ctx.canvas, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, spec.outW, spec.outH);
  } else if (fit === 'cover') {
    // Crop the source bbox so its aspect matches the output. We shrink
    // either width or height of the source rect (centered) to discard
    // overflow.
    let sx = bbox.x, sy = bbox.y, sw = bbox.w, sh = bbox.h;
    if (srcAspect > outAspect) {
      // Source too wide → trim sides
      const newSw = bbox.h * outAspect;
      sx = bbox.x + (bbox.w - newSw) / 2;
      sw = newSw;
    } else if (srcAspect < outAspect) {
      // Source too tall → trim top/bottom
      const newSh = bbox.w / outAspect;
      sy = bbox.y + (bbox.h - newSh) / 2;
      sh = newSh;
    }
    octx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, spec.outW, spec.outH);
  } else {
    // 'contain' — letterbox.
    let dx = 0, dy = 0, dw = spec.outW, dh = spec.outH;
    if (srcAspect > outAspect) {
      dh = Math.round(spec.outW / srcAspect);
      dy = Math.floor((spec.outH - dh) / 2);
    } else {
      dw = Math.round(spec.outH * srcAspect);
      dx = Math.floor((spec.outW - dw) / 2);
    }
    octx.drawImage(ctx.canvas, bbox.x, bbox.y, bbox.w, bbox.h, dx, dy, dw, dh);
  }

  // Beard / mustache gates: skip baking if not enough non-skin pixels.
  if (spec.requireDarkPct !== undefined) {
    const darkPct = darkPixelPercentage(octx, spec.outW, spec.outH, sampledColors?.skinTone);
    if (darkPct < spec.requireDarkPct) {
      warnings.push(
        `${name} feature: insufficient dark pixels (${darkPct.toFixed(1)}% < ${spec.requireDarkPct}%), omitting`,
      );
      return null;
    }
  }

  const targetColor = pickEnhancementTarget(name, sampledColors);
  // Skip posterization when palette is high enough (>= 32 levels per
  // channel = 32k+ colors) — the output is visually indistinguishable
  // from "no posterize" but a target-color tint is still applied if
  // requested. Small features (eyes, brows) use this path so fine iris
  // / pupil detail survives. Big features keep low-palette posterize.
  if (spec.palette < 32) {
    posterize(octx, spec.outW, spec.outH, spec.palette, spec.satBoost, targetColor);
  } else if (targetColor !== undefined && spec.satBoost !== 1.0) {
    // Apply just the gentle color tint + sat boost without quantization.
    posterize(octx, spec.outW, spec.outH, 256, spec.satBoost, targetColor);
  } else if (targetColor !== undefined) {
    posterize(octx, spec.outW, spec.outH, 256, 1.0, targetColor);
  }
  if (spec.edgeEnhance) edgeEnhance(octx, spec.outW, spec.outH, 0.25);
  if (spec.stencil) {
    alphaMaskByContour(octx, spec.outW, spec.outH, landmarks, spec.indices, bbox, ctx.width, ctx.height);
  }

  // Phase H2c — alpha mask runs AFTER posterize/edgeEnhance so the
  // visible pixels keep their stylized color treatment but everything
  // outside the feature region is fully transparent. The H2 renderer's
  // alphaTest=0.5 cutoff treats these as cleanly cut-out features
  // without rectangle artifacts.
  if (spec.alphaMask === 'polygon') {
    applyPolygonAlphaMask(
      octx,
      spec.outW,
      spec.outH,
      landmarks,
      spec.indices,
      bbox,
      ctx.width,
      ctx.height,
      spec.fitMode ?? 'contain',
    );
  } else if (spec.alphaMask === 'luma-dark') {
    applyLumaDarkAlphaMask(octx, spec.outW, spec.outH, sampledColors?.skinTone);
  }

  return {
    dataUrl: out.toDataURL('image/png'),
    srcBbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
    center3D: landmarkCentroid3D(landmarks, spec.indices),
    size3D: landmarkSize3D(landmarks, spec.indices, spec.padding),
  };
}

/**
 * Hat is a special case — landmark anchors are forehead-top points, but
 * the hat sits ABOVE all landmarks. We build the bbox with:
 *
 *   bottom = forehead landmark 10 (top of forehead in image space)
 *   top    = bottom − 1.0 × faceHeight (clamped to y >= 0)
 *   left   = faceCenter − 0.7 × faceWidth
 *   right  = faceCenter + 0.7 × faceWidth (i.e. 1.4 × faceWidth total)
 *
 * Where faceHeight = (chin152 − forehead10).y in pixels and faceWidth =
 * (rightTemple454 − leftTemple234).x. Caps usually extend a bit past
 * the temples; 1.4× covers that.
 */
function bakeHat(
  ctx: SampleContext,
  landmarks: NormalizedLandmark[],
  sampledColors: SampledColors | undefined,
  warnings: string[],
): FaceFeatureCrop | null {
  const spec = FEATURE_SPECS.hat;
  // Warning fires only when we genuinely have no hat color to enhance
  // toward. `?? undefined` collapses null AND undefined to the same
  // case so a future `hatColor: null` doesn't bypass this check.
  const hatColor = sampledColors?.hatColor ?? undefined;
  if (hatColor === undefined) {
    warnings.push('hat: no hat color sampled — baking forehead-top region as-is (may show hair)');
  }

  const top = landmarks[FACE_TOP_INDEX];      // forehead 10
  const bottom = landmarks[FACE_BOTTOM_INDEX]; // chin 152
  const leftTemple = landmarks[234];
  const rightTemple = landmarks[454];
  if (!top || !bottom || !leftTemple || !rightTemple) {
    warnings.push('hat: anchor landmarks missing');
    return null;
  }
  const faceHeightPx = (bottom.y - top.y) * ctx.height;
  const faceWidthPx = (rightTemple.x - leftTemple.x) * ctx.width;
  if (faceHeightPx <= 0 || faceWidthPx <= 0) {
    warnings.push('hat: degenerate face dimensions');
    return null;
  }

  // Bottom of hat bbox is the forehead-top landmark itself (slight
  // overlap with hair/brow line is fine — gives the renderer a stable
  // mounting edge). Top extends up by 1.0× faceHeight, clamped to y=0
  // so we never include negative-y blank pixels.
  const yBottom = top.y * ctx.height;
  const yTop = Math.max(0, yBottom - faceHeightPx * 1.0);
  // Horizontal centerline is the forehead landmark's x; total width is
  // 1.4× faceWidth.
  const cx = top.x * ctx.width;
  const halfW = faceWidthPx * 0.7;
  let x = Math.max(0, cx - halfW);
  let w = Math.min(ctx.width - x, halfW * 2);
  const y = yTop;
  const h = yBottom - yTop;
  if (h <= 0 || w <= 0) {
    warnings.push('hat: degenerate bbox after upward expand');
    return null;
  }

  const out = document.createElement('canvas');
  out.width = spec.outW;
  out.height = spec.outH;
  const octx = out.getContext('2d', { willReadFrequently: true });
  if (!octx) {
    warnings.push('hat: 2D context unavailable');
    return null;
  }
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';

  // Use the same fit-mode plumbing as bakeOneFeature so the cap fills
  // the canvas instead of getting stretched/letterboxed weirdly.
  const fit = spec.fitMode ?? 'cover';
  const srcAspect = w / h;
  const outAspect = spec.outW / spec.outH;
  if (fit === 'cover') {
    let sx = x, sy = y, sw = w, sh = h;
    if (srcAspect > outAspect) {
      const newSw = h * outAspect;
      sx = x + (w - newSw) / 2;
      sw = newSw;
    } else if (srcAspect < outAspect) {
      const newSh = w / outAspect;
      sy = y + (h - newSh) / 2;
      sh = newSh;
    }
    octx.drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, spec.outW, spec.outH);
  } else {
    octx.drawImage(ctx.canvas, x, y, w, h, 0, 0, spec.outW, spec.outH);
  }

  // Skip target-color blend on hat — sampled hatColor often picks up
  // brim-shadow and pulls the cap toward black. Let the photo's own
  // pixels speak.
  posterize(octx, spec.outW, spec.outH, spec.palette, spec.satBoost, undefined);
  if (spec.edgeEnhance) edgeEnhance(octx, spec.outW, spec.outH, 0.4);

  // Phase H2c — alpha vignette so the rectangular hat crop fades into
  // transparency at its corners (sky/wall pixels behind the cap) and
  // along its bottom (forehead/hair feathering into the face plate
  // mounted just below). The cap occupies the upper-center of the bbox;
  // we want top center opaque, top corners transparent, bottom soft.
  applyHatVignette(octx, spec.outW, spec.outH);

  // 3D placement: centroid of anchor landmarks shifted upward in mesh-Y
  // by ~half the upExpand we applied in pixel-space.
  const anchorCenter = landmarkCentroid3D(landmarks, spec.indices);
  const upMesh = (faceHeightPx / ctx.height) * 0.5;
  const center3D = {
    x: anchorCenter.x,
    y: anchorCenter.y + upMesh,
    z: anchorCenter.z,
  };
  const size3D = landmarkSize3D(landmarks, spec.indices, 0);
  size3D.h *= 2.4;
  size3D.w *= 1.5;

  return {
    dataUrl: out.toDataURL('image/png'),
    srcBbox: { x, y, w, h },
    center3D,
    size3D,
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers

interface PixelBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Compute pixel bbox of a landmark set, expanded outward by `padding`
 * fraction. Returns null if landmarks are missing or the expanded bbox
 * is degenerate.
 */
export function landmarkBboxExpanded(
  landmarks: ReadonlyArray<NormalizedLandmark>,
  indices: ReadonlyArray<number>,
  imgW: number,
  imgH: number,
  padding: number,
): PixelBbox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of indices) {
    const lm = landmarks[i];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return null;
    const x = lm.x * imgW;
    const y = lm.y * imgH;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  let w = maxX - minX;
  let h = maxY - minY;
  if (w <= 0 || h <= 0) return null;
  const padX = w * padding;
  const padY = h * padding;
  const x = Math.max(0, Math.floor(minX - padX));
  const y = Math.max(0, Math.floor(minY - padY));
  const x2 = Math.min(imgW, Math.ceil(maxX + padX));
  const y2 = Math.min(imgH, Math.ceil(maxY + padY));
  w = x2 - x;
  h = y2 - y;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function landmarkCentroid3D(
  landmarks: ReadonlyArray<NormalizedLandmark>,
  indices: ReadonlyArray<number>,
): { x: number; y: number; z: number } {
  let sx = 0, sy = 0, sz = 0;
  let n = 0;
  for (const i of indices) {
    const lm = landmarks[i];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
    sx += lm.x - 0.5;
    sy += -(lm.y - 0.5);
    sz += -(lm.z ?? 0);
    n++;
  }
  if (n === 0) return { x: 0, y: 0, z: 0 };
  return { x: sx / n, y: sy / n, z: sz / n };
}

function landmarkSize3D(
  landmarks: ReadonlyArray<NormalizedLandmark>,
  indices: ReadonlyArray<number>,
  padding: number,
): { w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of indices) {
    const lm = landmarks[i];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
    const x = lm.x - 0.5;
    const y = -(lm.y - 0.5);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { w: 0, h: 0 };
  const w = maxX - minX;
  const h = maxY - minY;
  return { w: w * (1 + padding * 2), h: h * (1 + padding * 2) };
}

// ---------------------------------------------------------------------------
// Stylization helpers

/**
 * Posterize an image's pixels using uniform per-channel quantization,
 * optionally tinted toward `targetColor` and saturation-boosted by
 * `satBoost`. `levelsPerChannel` is the literal step count per channel
 * (e.g. 8 → ~512 colors total) — high enough to avoid 8-bit-pixel-art
 * banding while still flattening detail toward a magazine-illustration
 * look.
 *
 * Target-color blending is kept GENTLE (8%) because aggressive blends
 * combined with a saturation boost shove skin pixels past 255 in red
 * and snap them to magenta after quantization.
 */
export function posterize(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  levelsPerChannel: number,
  satBoost = 1.0,
  targetColor?: number,
): void {
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const levels = Math.max(2, Math.floor(levelsPerChannel));
  const step = 255 / (levels - 1);

  let tr = 0, tg = 0, tb = 0;
  if (targetColor !== undefined) {
    const c = unpackColor(targetColor);
    tr = c.r; tg = c.g; tb = c.b;
  }

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (targetColor !== undefined) {
      const blend = 0.08;
      r = r * (1 - blend) + tr * blend;
      g = g * (1 - blend) + tg * blend;
      b = b * (1 - blend) + tb * blend;
    }
    if (satBoost !== 1.0) {
      const mean = (r + g + b) / 3;
      r = mean + (r - mean) * satBoost;
      g = mean + (g - mean) * satBoost;
      b = mean + (b - mean) * satBoost;
    }

    r = Math.round(Math.max(0, Math.min(255, r)) / step) * step;
    g = Math.round(Math.max(0, Math.min(255, g)) / step) * step;
    b = Math.round(Math.max(0, Math.min(255, b)) / step) * step;

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
}

/** Apply a 3x3 unsharp-mask convolution. */
export function edgeEnhance(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  weight = 0.5,
): void {
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const sd = src.data;
  const dd = dst.data;
  const cw = 1 + 4 * weight;
  const nw = -weight;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        dd[idx] = sd[idx];
        dd[idx + 1] = sd[idx + 1];
        dd[idx + 2] = sd[idx + 2];
        dd[idx + 3] = sd[idx + 3];
        continue;
      }
      for (let c = 0; c < 3; c++) {
        const center = sd[idx + c];
        const up = sd[idx - w * 4 + c];
        const dn = sd[idx + w * 4 + c];
        const lf = sd[idx - 4 + c];
        const rt = sd[idx + 4 + c];
        let v = cw * center + nw * (up + dn + lf + rt);
        if (v < 0) v = 0;
        if (v > 255) v = 255;
        dd[idx + c] = v;
      }
      dd[idx + 3] = sd[idx + 3];
    }
  }
  ctx.putImageData(dst, 0, 0);
}

/**
 * Stencil the image to the polygon described by the landmark set.
 * Uses `destination-in` compositing with a polygon-filled mask canvas.
 * The mask is slightly stroked to give the cutout a soft 1px feather
 * against the bg.
 */
export function alphaMaskByContour(
  ctx: CanvasRenderingContext2D,
  outW: number,
  outH: number,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  indices: ReadonlyArray<number>,
  bbox: PixelBbox,
  imgW: number,
  imgH: number,
): void {
  const mask = document.createElement('canvas');
  mask.width = outW;
  mask.height = outH;
  const mctx = mask.getContext('2d');
  if (!mctx) return;
  mctx.clearRect(0, 0, outW, outH);
  mctx.fillStyle = '#000';
  mctx.beginPath();
  let started = false;
  for (const i of indices) {
    const lm = landmarks[i];
    if (!lm) continue;
    const px = lm.x * imgW;
    const py = lm.y * imgH;
    const ox = ((px - bbox.x) / bbox.w) * outW;
    const oy = ((py - bbox.y) / bbox.h) * outH;
    if (!started) { mctx.moveTo(ox, oy); started = true; }
    else { mctx.lineTo(ox, oy); }
  }
  mctx.closePath();
  mctx.fill();
  // 2px stroke softens the mask edge.
  mctx.strokeStyle = '#000';
  mctx.lineWidth = 2;
  mctx.stroke();

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Color enhancement helpers

function pickEnhancementTarget(
  name: FeatureName,
  sampled?: SampledColors,
): number | undefined {
  if (!sampled) return undefined;
  switch (name) {
    case 'leftEye':   return sampled.eyeColors?.left;
    case 'rightEye':  return sampled.eyeColors?.right;
    case 'leftBrow':  return sampled.browColors?.left;
    case 'rightBrow': return sampled.browColors?.right;
    case 'mouth':     return sampled.lipColor;
    case 'hat':       return sampled.hatColor;
    default:          return undefined;
  }
}

/**
 * Estimate the percentage of pixels that are "dark" relative to a
 * skin-tone reference (40% darker than skin), or absolute luma
 * threshold (80) when skin tone is unavailable.
 */
function darkPixelPercentage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  skinTone?: number,
): number {
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  let darkCount = 0;
  let total = 0;
  let threshold: number;
  if (skinTone !== undefined) {
    const c = unpackColor(skinTone);
    const skinLuma = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    threshold = skinLuma * 0.6;
  } else {
    threshold = 80;
  }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    total++;
    const luma = pixelLuma({ r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] });
    if (luma < threshold) darkCount++;
  }
  if (total === 0) return 0;
  return (darkCount / total) * 100;
}

// ---------------------------------------------------------------------------
// Phase H2c — alpha-mask helpers for individual feature crops
// ---------------------------------------------------------------------------

/**
 * Phase H2c — fill alpha=255 inside the polygon defined by `indices` (in
 * source-pixel coords, mapped to output canvas via `bbox` and `fitMode`)
 * and alpha=0 elsewhere. Used by eyes / mouth so the H2 renderer's
 * overlay planes show only the feature shape, not a rectangular crop.
 *
 * Compositing: builds a black-fill mask canvas, then `destination-in`
 * composites it onto the source. `destination-in` keeps source pixels
 * where the mask is opaque and zeroes alpha where the mask is
 * transparent — exactly the polygon stencil we want.
 */
export function applyPolygonAlphaMask(
  ctx: CanvasRenderingContext2D,
  outW: number,
  outH: number,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  indices: ReadonlyArray<number>,
  bbox: PixelBbox,
  imgW: number,
  imgH: number,
  fitMode: 'contain' | 'cover' | 'stretch',
): void {
  const mask = document.createElement('canvas');
  mask.width = outW;
  mask.height = outH;
  const mctx = mask.getContext('2d');
  if (!mctx) return;
  mctx.clearRect(0, 0, outW, outH);

  // Compute the source→output transform that the bbox→canvas drawImage
  // used. This must MATCH the fit logic in bakeOneFeature so polygon
  // points map to the same canvas locations as the image pixels did.
  const srcAspect = bbox.w / bbox.h;
  const outAspect = outW / outH;
  let scaleX: number;
  let scaleY: number;
  let offsetX: number;
  let offsetY: number;
  let srcOffsetX = bbox.x;
  let srcOffsetY = bbox.y;
  let srcW = bbox.w;
  let srcH = bbox.h;

  if (fitMode === 'stretch') {
    scaleX = outW / bbox.w;
    scaleY = outH / bbox.h;
    offsetX = 0;
    offsetY = 0;
  } else if (fitMode === 'cover') {
    if (srcAspect > outAspect) {
      const newSw = bbox.h * outAspect;
      srcOffsetX = bbox.x + (bbox.w - newSw) / 2;
      srcW = newSw;
    } else if (srcAspect < outAspect) {
      const newSh = bbox.w / outAspect;
      srcOffsetY = bbox.y + (bbox.h - newSh) / 2;
      srcH = newSh;
    }
    scaleX = outW / srcW;
    scaleY = outH / srcH;
    offsetX = 0;
    offsetY = 0;
  } else {
    // 'contain' — letterbox.
    let dw = outW, dh = outH;
    let dx = 0, dy = 0;
    if (srcAspect > outAspect) {
      dh = Math.round(outW / srcAspect);
      dy = Math.floor((outH - dh) / 2);
    } else {
      dw = Math.round(outH * srcAspect);
      dx = Math.floor((outW - dw) / 2);
    }
    scaleX = dw / bbox.w;
    scaleY = dh / bbox.h;
    offsetX = dx;
    offsetY = dy;
  }

  mctx.fillStyle = '#000';
  mctx.beginPath();
  let started = false;
  for (const i of indices) {
    const lm = landmarks[i];
    if (!lm) continue;
    const px = lm.x * imgW;
    const py = lm.y * imgH;
    const ox = (px - srcOffsetX) * scaleX + offsetX;
    const oy = (py - srcOffsetY) * scaleY + offsetY;
    if (!started) { mctx.moveTo(ox, oy); started = true; }
    else { mctx.lineTo(ox, oy); }
  }
  mctx.closePath();
  mctx.fill();

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  ctx.restore();
}

/**
 * Phase H2c — luma-threshold alpha mask for brows. Pixels darker than
 * `skinTone × 0.6` luma stay opaque; everything lighter goes fully
 * transparent. The result is an alpha-cut "brow hair stencil" inside
 * the brow bbox.
 */
export function applyLumaDarkAlphaMask(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  skinTone?: number,
): void {
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  let threshold: number;
  if (skinTone !== undefined) {
    const c = unpackColor(skinTone);
    const skinLuma = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    threshold = skinLuma * 0.6;
  } else {
    threshold = 80;
  }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const luma = pixelLuma({ r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] });
    if (luma >= threshold) {
      data[i + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Phase H2c — composite face plate
// ---------------------------------------------------------------------------

const FACE_PLATE_W = 256;
const FACE_PLATE_H = 320;
/** Skin-tone fallback when mesh3d.skinTone wasn't sampled. Mid-tan that
 *  reads as skin behind eyes/brows/mouth without screaming "wrong color." */
const FACE_PLATE_SKIN_FALLBACK = 0xc9a08a;

/**
 * Phase H2c — bake a single composite face plate covering chin → forehead.
 *
 * The plate is a 256×320 PNG with:
 *   1. Sampled (or fallback) skin tone fill as the base
 *   2. Nose region painted on with a soft radial alpha falloff
 *   3. Beard pixels (luma < skinLuma * 0.6) painted at chin/jaw
 *   4. Mustache pixels (same luma threshold) painted above upper lip
 *
 * The center3D / size3D values describe where the plate sits on the
 * face mesh — chin landmark 152 → forehead landmark 10 vertically, with
 * temple-to-temple width plus padding.
 *
 * Returns null only on degenerate inputs (missing core landmarks).
 */
export function bakeFacePlate(
  ctx: SampleContext,
  landmarks: NormalizedLandmark[],
  sampledColors: SampledColors | undefined,
  warnings: string[],
): FaceFeatureCrop | null {
  // Vertical span: forehead → chin.
  const forehead = landmarks[FACE_TOP_INDEX];
  const chin = landmarks[FACE_BOTTOM_INDEX];
  const leftTemple = landmarks[234];
  const rightTemple = landmarks[454];
  if (!forehead || !chin || !leftTemple || !rightTemple) {
    warnings.push('facePlate: anchor landmarks missing');
    return null;
  }
  // Build a generous bbox: chin (with a small below-chin pad to capture
  // beard underneath the jaw) to forehead (with a small above-forehead
  // pad), and temple-to-temple horizontally with padding.
  const faceHeightPx = (chin.y - forehead.y) * ctx.height;
  const faceWidthPx = (rightTemple.x - leftTemple.x) * ctx.width;
  if (faceHeightPx <= 0 || faceWidthPx <= 0) {
    warnings.push('facePlate: degenerate face dimensions');
    return null;
  }
  const padTop = faceHeightPx * 0.05;
  const padBottom = faceHeightPx * 0.10;
  // Phase H2c iter-2: tighter horizontal padding so the plate doesn't
  // capture ear / hair pixels at the temples — those leak into the
  // beard luma-mask (dark!) and survive the vignette feather.
  const padX = faceWidthPx * 0.02;
  const yTop = Math.max(0, forehead.y * ctx.height - padTop);
  const yBottom = Math.min(ctx.height, chin.y * ctx.height + padBottom);
  const xLeft = Math.max(0, leftTemple.x * ctx.width - padX);
  const xRight = Math.min(ctx.width, rightTemple.x * ctx.width + padX);
  const bbox: PixelBbox = {
    x: Math.floor(xLeft),
    y: Math.floor(yTop),
    w: Math.ceil(xRight - xLeft),
    h: Math.ceil(yBottom - yTop),
  };

  // Build the output canvas.
  const out = document.createElement('canvas');
  out.width = FACE_PLATE_W;
  out.height = FACE_PLATE_H;
  const octx = out.getContext('2d', { willReadFrequently: true });
  if (!octx) {
    warnings.push('facePlate: 2D context unavailable');
    return null;
  }
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';

  // 1. Skin-tone base fill.
  const skin = sampledColors?.skinTone ?? FACE_PLATE_SKIN_FALLBACK;
  const sc = unpackColor(skin);
  octx.fillStyle = `rgb(${sc.r}, ${sc.g}, ${sc.b})`;
  octx.fillRect(0, 0, FACE_PLATE_W, FACE_PLATE_H);

  // Mark the bbox-relative transform: a source pixel at (px, py) maps to
  // canvas coord ((px - bbox.x) / bbox.w * outW, ...). Useful for both
  // the nose paint and the beard/mustache landmark→canvas mappings.
  const srcToCanvas = (px: number, py: number): { x: number; y: number } => ({
    x: ((px - bbox.x) / bbox.w) * FACE_PLATE_W,
    y: ((py - bbox.y) / bbox.h) * FACE_PLATE_H,
  });

  // 2. Nose region — paint with soft radial alpha falloff. Crop the nose
  //    bbox out of the source photo onto a temp canvas, apply a radial
  //    gradient as alpha, then drawImage onto the plate.
  paintNoseOntoPlate(octx, ctx, landmarks, bbox, srcToCanvas, warnings);

  // 3. Beard region — luma-mask dark pixels onto the plate at chin/jaw.
  paintBeardOntoPlate(octx, ctx, landmarks, BEARD_INDICES, bbox, skin, warnings);

  // 4. Mustache region — same as beard but at the mustache landmark set.
  paintBeardOntoPlate(octx, ctx, landmarks, MUSTACHE_INDICES, bbox, skin, warnings);

  // 5. Soft elliptical vignette on the plate's alpha so the rectangular
  //    boundary fades into the cranium skin tone behind it. Without this
  //    the plate reads as a billboarded photograph stuck on the head;
  //    with it, the plate edges blend smoothly into the rig's skin
  //    (which has the same skinTone fill).
  applyEllipticalVignette(octx, FACE_PLATE_W, FACE_PLATE_H);

  // 3D placement: span between forehead and chin landmarks, in mesh-local
  // coords (matching landmarkCentroid3D / landmarkSize3D conventions).
  const PLATE_INDICES: ReadonlyArray<number> = [10, 152, 234, 454];
  return {
    dataUrl: out.toDataURL('image/png'),
    srcBbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
    center3D: landmarkCentroid3D(landmarks, PLATE_INDICES),
    size3D: landmarkSize3D(landmarks, PLATE_INDICES, 0.05),
  };
}

/**
 * Paint the nose photo region onto the plate canvas with a soft
 * radial-gradient alpha so the edges fade into the skin-tone base.
 */
function paintNoseOntoPlate(
  octx: CanvasRenderingContext2D,
  ctx: SampleContext,
  landmarks: NormalizedLandmark[],
  bbox: PixelBbox,
  srcToCanvas: (px: number, py: number) => { x: number; y: number },
  warnings: string[],
): void {
  const noseBbox = landmarkBboxExpanded(landmarks, NOSE_INDICES, ctx.width, ctx.height, 0.20);
  if (!noseBbox) {
    warnings.push('facePlate.nose: landmark bbox failed');
    return;
  }
  // Nose canvas-coords on the plate.
  const tl = srcToCanvas(noseBbox.x, noseBbox.y);
  const br = srcToCanvas(noseBbox.x + noseBbox.w, noseBbox.y + noseBbox.h);
  const dstX = tl.x;
  const dstY = tl.y;
  const dstW = Math.max(1, br.x - tl.x);
  const dstH = Math.max(1, br.y - tl.y);

  // Step 1: draw the nose photo region onto a tmp canvas.
  const tmp = document.createElement('canvas');
  tmp.width = Math.max(1, Math.ceil(dstW));
  tmp.height = Math.max(1, Math.ceil(dstH));
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  if (!tctx) return;
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(
    ctx.canvas,
    noseBbox.x, noseBbox.y, noseBbox.w, noseBbox.h,
    0, 0, tmp.width, tmp.height,
  );

  // Step 2: apply a radial-gradient alpha mask via destination-in so
  // the painted nose region blends smoothly into the skin-tone
  // background fill (no visible rectangular edge).
  //
  // We use the diagonal (Math.hypot) as the gradient radius so EVERY
  // corner of the rectangle hits the alpha=0 stop. With min(cxc,cyc)
  // the long sides of a non-square nose bbox would clip hard at the
  // ellipse boundary; with max(cxc,cyc) two opposite sides clip hard.
  // The diagonal lets alpha decay smoothly across the entire rect.
  //
  // Stops follow the spec: inner ~60% solid (covers nostrils + bridge),
  // outer ~40% smooth feather to transparent.
  const cxc = tmp.width / 2;
  const cyc = tmp.height / 2;
  const radius = Math.hypot(cxc, cyc);
  const grad = tctx.createRadialGradient(cxc, cyc, 0, cxc, cyc, radius);
  grad.addColorStop(0.00, 'rgba(0,0,0,1.00)');
  grad.addColorStop(0.30, 'rgba(0,0,0,1.00)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  grad.addColorStop(0.80, 'rgba(0,0,0,0.10)');
  grad.addColorStop(1.00, 'rgba(0,0,0,0.00)');
  tctx.globalCompositeOperation = 'destination-in';
  tctx.fillStyle = grad;
  tctx.fillRect(0, 0, tmp.width, tmp.height);

  // Step 3: draw the masked nose onto the plate.
  octx.drawImage(tmp, dstX, dstY, dstW, dstH);
}

/**
 * Apply a soft elliptical alpha vignette to the plate so its rectangular
 * boundary fades into transparency. The visible region is an oval that
 * fills ~85% of the canvas, with a soft ~15% feather at the edges.
 *
 * Uses a radial gradient as a destination-in mask, scaled non-uniformly
 * to make an oval (taller than wide, matching the face shape).
 */
function applyEllipticalVignette(
  octx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext('2d');
  if (!mctx) return;
  mctx.clearRect(0, 0, w, h);
  // Build a radial gradient (in unit-circle coords), then scale it to
  // an ellipse via setTransform so we can keep the gradient stops simple.
  const cx = w / 2;
  const cy = h / 2;
  // Inner solid radius: 0.55 of half-axis. Edge fade: from 0.55 → 1.0.
  const grad = mctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) / 2);
  // Generous solid region so the plate covers the area between the eye
  // anchors (±0.090m → ~0.18m wide). Fade only at the outermost 15%.
  grad.addColorStop(0.0, 'rgba(0,0,0,1.0)');
  grad.addColorStop(0.85, 'rgba(0,0,0,1.0)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0.0)');
  // Stretch the gradient across the canvas so it covers the full
  // rectangle as an ellipse.
  mctx.save();
  mctx.translate(cx, cy);
  mctx.scale(w / Math.min(w, h), h / Math.min(w, h));
  mctx.translate(-cx, -cy);
  mctx.fillStyle = grad;
  mctx.fillRect(0, 0, w, h);
  mctx.restore();

  octx.save();
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(mask, 0, 0);
  octx.restore();
}

/**
 * Phase H2c — hat-specific elliptical alpha vignette. The cap in a
 * front-pose photo sits as a centered grey dome with sky/wall pixels in
 * the top corners and the user's forehead/hair below. We want:
 *   - Top center (cap apex)        → fully opaque
 *   - Top corners (sky/wall)       → fully transparent
 *   - Sides (cap edges)            → soft falloff
 *   - Bottom (forehead/hair)       → soft alpha so the hat plane feathers
 *     into the face plate mounted underneath
 *
 * Implementation: build an ellipse mask centered at the canvas's
 * horizontal center but offset upward (top-bias) so the visible region
 * tracks the cap. Outer ~25% feathers to transparent.
 */
function applyHatVignette(
  octx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext('2d');
  if (!mctx) return;
  mctx.clearRect(0, 0, w, h);

  // Center horizontally, top-bias: cap apex sits ~40% from top of bbox.
  // We want a wide-but-short visible ellipse: cap aspect in the bbox is
  // roughly 2:1 (wide). Build a radial gradient in unit-circle space,
  // then non-uniformly scale via setTransform so the visible region
  // stretches horizontally to match cap width.
  const cx = w / 2;
  const cy = h * 0.40;
  // Base radius in unit-square space (use HALF the smaller dim so the
  // ellipse fits without overshoot; we'll then stretch via transform).
  const baseR = Math.min(w, h) / 2;
  const grad = mctx.createRadialGradient(cx, cy, 0, cx, cy, baseR);
  // Solid out to ~60% then aggressive feather to transparent. Tighter
  // than facePlate (85%) because the hat bbox has more empty corner
  // space (sky/wall pixels above the cap).
  grad.addColorStop(0.0, 'rgba(0,0,0,1.0)');
  grad.addColorStop(0.55, 'rgba(0,0,0,1.0)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0.0)');
  // Stretch horizontally so the unit circle becomes a wide ellipse
  // that hugs the cap (which spans almost the full bbox width but only
  // ~70% of the bbox height).
  mctx.save();
  mctx.translate(cx, cy);
  mctx.scale(w / Math.min(w, h), 1.4 * h / Math.min(w, h));
  mctx.translate(-cx, -cy);
  mctx.fillStyle = grad;
  mctx.fillRect(0, 0, w, h);
  mctx.restore();

  octx.save();
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(mask, 0, 0);
  octx.restore();
}

/**
 * Paint dark-luma pixels (beard / mustache hair) from a landmark-set
 * bbox onto the plate canvas. Lighter pixels stay transparent so the
 * underlying skin-tone fill shows through.
 */
function paintBeardOntoPlate(
  octx: CanvasRenderingContext2D,
  ctx: SampleContext,
  landmarks: NormalizedLandmark[],
  indices: ReadonlyArray<number>,
  plateBbox: PixelBbox,
  skinTone: number,
  warnings: string[],
): void {
  const regionBbox = landmarkBboxExpanded(landmarks, indices, ctx.width, ctx.height, 0.10);
  if (!regionBbox) {
    warnings.push('facePlate.beard/mustache: landmark bbox failed');
    return;
  }
  // Crop region from source photo into a tmp canvas at native pixel size.
  const tmp = document.createElement('canvas');
  tmp.width = regionBbox.w;
  tmp.height = regionBbox.h;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  if (!tctx) return;
  tctx.drawImage(
    ctx.canvas,
    regionBbox.x, regionBbox.y, regionBbox.w, regionBbox.h,
    0, 0, regionBbox.w, regionBbox.h,
  );

  // Luma-threshold mask — keep dark pixels (alpha=255), zero alpha
  // elsewhere. With a 1-px feather: pixels close to the threshold get
  // proportional alpha so the edge isn't a hard cutoff.
  const sc = unpackColor(skinTone);
  const skinLuma = 0.299 * sc.r + 0.587 * sc.g + 0.114 * sc.b;
  const threshold = skinLuma * 0.6;
  const featherBand = 12; // luma units of soft falloff above threshold
  const img = tctx.getImageData(0, 0, regionBbox.w, regionBbox.h);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const luma = pixelLuma({ r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] });
    if (luma <= threshold) {
      // fully opaque dark pixel — leave alpha alone
      data[i + 3] = 255;
    } else if (luma <= threshold + featherBand) {
      const t = (luma - threshold) / featherBand;
      data[i + 3] = Math.round(255 * (1 - t));
    } else {
      data[i + 3] = 0;
    }
  }
  tctx.putImageData(img, 0, 0);

  // Map region bbox → plate canvas coords and draw.
  const dstX = ((regionBbox.x - plateBbox.x) / plateBbox.w) * FACE_PLATE_W;
  const dstY = ((regionBbox.y - plateBbox.y) / plateBbox.h) * FACE_PLATE_H;
  const dstW = (regionBbox.w / plateBbox.w) * FACE_PLATE_W;
  const dstH = (regionBbox.h / plateBbox.h) * FACE_PLATE_H;
  octx.drawImage(tmp, dstX, dstY, dstW, dstH);

  // packColor reference kept so the import doesn't go stale across iterations.
  void packColor;
}
