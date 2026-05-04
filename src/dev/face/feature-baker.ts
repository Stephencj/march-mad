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
  /** Posterization "palette size" — used to derive levels-per-channel. */
  palette: number;
  /** Stencil the crop to the landmark polygon? */
  stencil: boolean;
  /** Apply unsharp-mask edge enhance? */
  edgeEnhance: boolean;
  /** HSV-style saturation boost during posterize (1.0 = no-op). */
  satBoost: number;
  /** When defined, skip baking if dark-pixel % falls below this threshold. */
  requireDarkPct?: number;
}

type FeatureName =
  | 'leftEye' | 'rightEye'
  | 'leftBrow' | 'rightBrow'
  | 'nose' | 'mouth'
  | 'beard' | 'mustache' | 'hat';

// Posterization tuning: `palette` here is interpreted by `posterize` as
// the LEVELS-PER-CHANNEL count directly (not a derived value). 8 levels
// per channel = 512 colors total — visible banding without "8-bit pixel
// art" — which lands the look at the "magazine illustration" target.
// satBoost is kept gentle (1.05–1.15) because over-saturation on skin
// snaps mid-tones into magenta when combined with posterization.
const FEATURE_SPECS: Record<FeatureName, FeatureSpec> = {
  leftEye:   { indices: LEFT_EYE_INDICES,   padding: 0.40, outW: 128, outH: 96,  palette: 10, stencil: false, edgeEnhance: true,  satBoost: 1.10 },
  rightEye:  { indices: RIGHT_EYE_INDICES,  padding: 0.40, outW: 128, outH: 96,  palette: 10, stencil: false, edgeEnhance: true,  satBoost: 1.10 },
  leftBrow:  { indices: LEFT_BROW_INDICES,  padding: 0.45, outW: 144, outH: 56,  palette: 8,  stencil: false, edgeEnhance: true,  satBoost: 1.15 },
  rightBrow: { indices: RIGHT_BROW_INDICES, padding: 0.45, outW: 144, outH: 56,  palette: 8,  stencil: false, edgeEnhance: true,  satBoost: 1.15 },
  nose:      { indices: NOSE_INDICES,       padding: 0.20, outW: 96,  outH: 144, palette: 10, stencil: false, edgeEnhance: true,  satBoost: 1.05 },
  mouth:     { indices: MOUTH_INDICES,      padding: 0.25, outW: 160, outH: 96,  palette: 10, stencil: false, edgeEnhance: true,  satBoost: 1.15 },
  beard:     { indices: BEARD_INDICES,      padding: 0.15, outW: 192, outH: 128, palette: 8,  stencil: false, edgeEnhance: false, satBoost: 1.10, requireDarkPct: 12 },
  mustache:  { indices: MUSTACHE_INDICES,   padding: 0.15, outW: 144, outH: 64,  palette: 8,  stencil: false, edgeEnhance: false, satBoost: 1.05, requireDarkPct: 10 },
  hat:       { indices: HAT_ANCHOR_INDICES, padding: 0.05, outW: 192, outH: 128, palette: 8,  stencil: false, edgeEnhance: true,  satBoost: 1.05 },
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

  // Aspect-preserving "letterbox" fit: contain the source bbox inside the
  // output canvas at native aspect, then center. This avoids the 4x
  // vertical-stretch that wrecks tightly-cropped features (eyes, brows)
  // when bbox aspect != output aspect. Background stays transparent so
  // the renderer composites cleanly.
  const srcAspect = bbox.w / bbox.h;
  const outAspect = spec.outW / spec.outH;
  let dx = 0, dy = 0, dw = spec.outW, dh = spec.outH;
  if (srcAspect > outAspect) {
    dh = Math.round(spec.outW / srcAspect);
    dy = Math.floor((spec.outH - dh) / 2);
  } else {
    dw = Math.round(spec.outH * srcAspect);
    dx = Math.floor((spec.outW - dw) / 2);
  }
  octx.drawImage(ctx.canvas, bbox.x, bbox.y, bbox.w, bbox.h, dx, dy, dw, dh);

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
  posterize(octx, spec.outW, spec.outH, spec.palette, spec.satBoost, targetColor);
  if (spec.edgeEnhance) edgeEnhance(octx, spec.outW, spec.outH, 0.25);
  if (spec.stencil) {
    alphaMaskByContour(octx, spec.outW, spec.outH, landmarks, spec.indices, bbox, ctx.width, ctx.height);
  }

  return {
    dataUrl: out.toDataURL('image/png'),
    srcBbox: { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h },
    center3D: landmarkCentroid3D(landmarks, spec.indices),
    size3D: landmarkSize3D(landmarks, spec.indices, spec.padding),
  };
}

/**
 * Hat is a special case — landmark anchors are the top forehead points,
 * but the hat sits ABOVE all landmarks. We expand the bbox upward by
 * 1.2× face height so the cap lands inside the crop.
 */
function bakeHat(
  ctx: SampleContext,
  landmarks: NormalizedLandmark[],
  sampledColors: SampledColors | undefined,
  warnings: string[],
): FaceFeatureCrop | null {
  const spec = FEATURE_SPECS.hat;
  if (sampledColors?.hatColor === undefined) {
    warnings.push('hat: no hat color sampled — baking forehead-top region as-is (may show hair)');
  }

  const top = landmarks[FACE_TOP_INDEX];
  const bottom = landmarks[FACE_BOTTOM_INDEX];
  const anchorBbox = landmarkBboxExpanded(
    landmarks, spec.indices, ctx.width, ctx.height, spec.padding,
  );
  if (!top || !bottom || !anchorBbox) {
    warnings.push('hat: anchor landmarks missing');
    return null;
  }
  const faceHeightPx = (bottom.y - top.y) * ctx.height;
  const upExpand = Math.max(0, faceHeightPx * 1.2);
  let x = anchorBbox.x;
  let w = anchorBbox.w;
  // Widen horizontally — caps tend to extend past face width.
  const widen = w * 0.25;
  x = Math.max(0, x - widen);
  w = Math.min(ctx.width - x, w + widen * 2);
  const y = Math.max(0, anchorBbox.y - upExpand);
  const h = anchorBbox.y + anchorBbox.h - y;
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
  octx.drawImage(ctx.canvas, x, y, w, h, 0, 0, spec.outW, spec.outH);

  posterize(octx, spec.outW, spec.outH, spec.palette, spec.satBoost, sampledColors?.hatColor);
  if (spec.edgeEnhance) edgeEnhance(octx, spec.outW, spec.outH, 0.4);

  // 3D placement: centroid of anchor landmarks shifted upward in mesh-Y
  // by ~half the upExpand we applied in pixel-space.
  const anchorCenter = landmarkCentroid3D(landmarks, spec.indices);
  const upMesh = (faceHeightPx / ctx.height) * 0.6;
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
