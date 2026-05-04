/**
 * Phase 8.5 — Beard / facial-hair detection per region.
 *
 * For each of 9 facial-hair zones, sample an 8×8 patch and decide:
 *   1. Is the mean luma noticeably darker than skin? (Δluma > 15)
 *   2. Is there texture (σ² > 12)? Flat shadows fail this.
 * Both conditions ⇒ "hair signal". Per-pixel evaluation drives a density
 * fraction (how much of the 64-pixel patch passed both criteria).
 *
 * The mustache region is special — it's a rectangle between lip-top and
 * nose-base rather than an 8x8 around a centroid, because the strip is
 * naturally wide-and-short.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  type SampleContext,
  type Pixel,
  sampleRect,
  meanRGB,
  packColor,
  unpackColor,
  pixelLuma,
  localVariance,
  landmarkCentroid,
  darkestFraction,
  rgbToHsv,
} from './sample-utils';
import type { BeardRegion } from './types';

const PATCH_HALF = 4; // 8×8

interface BeardData {
  hairColor?: number;
  density: number;
}

const REGIONS: Record<Exclude<BeardRegion, 'mustache'>, number[]> = {
  chin: [152, 176, 148, 377, 400],
  underChin: [148, 176, 149, 150],
  cheekL: [205, 206, 207],
  cheekR: [425, 426, 427],
  sideburnL: [132, 58, 172],
  sideburnR: [361, 288, 397],
  jawlineL: [172, 136, 150],
  jawlineR: [397, 365, 379],
};

const MUSTACHE_LIP_TOP = [0, 267, 37];
const MUSTACHE_NOSE_BASE = [2, 326, 97];

const LUMA_DARKER_THAN_SKIN = 15;
const VARIANCE_THRESHOLD = 12;
/** Density values above this are almost certainly background patches the
 *  centroid landed outside the actual face — real beard never reaches
 *  100% in any region. We cap at this and only retain the region if a
 *  legitimate hairColor was also extracted. */
const DENSITY_CAP = 0.85;
/** Real beard hair is desaturated brown/black/grey/silver. Anything above
 *  this saturation is more likely chair fabric, wall paint, or other
 *  background bleed than actual hair. */
const HAIR_MAX_SATURATION = 0.4;

function detectInPatch(
  pixels: Pixel[],
  skinLuma: number,
): BeardData {
  if (pixels.length === 0) return { density: 0 };

  // Per-pixel "is this hair?" — count fraction.
  let hairCount = 0;
  for (const p of pixels) {
    if (p.a < 200) continue;
    if (skinLuma - pixelLuma(p) > LUMA_DARKER_THAN_SKIN) hairCount++;
  }
  const rawDensity = pixels.length > 0 ? hairCount / pixels.length : 0;

  // Compute mean luma + variance to decide if it's a *textured* darker patch.
  const variance = localVariance(pixels);
  let lumaSum = 0;
  let lumaN = 0;
  for (const p of pixels) {
    if (p.a < 200) continue;
    lumaSum += pixelLuma(p);
    lumaN++;
  }
  const meanLuma = lumaN > 0 ? lumaSum / lumaN : 0;
  const isHairSignal = skinLuma - meanLuma > LUMA_DARKER_THAN_SKIN && variance > VARIANCE_THRESHOLD;

  if (!isHairSignal) {
    // No hair signal — without a validated hairColor we can't trust the
    // density either. Force to 0 so consumers don't render phantom beard.
    return { density: 0 };
  }

  // Hair color = mean of darkest 25% pixels in the patch.
  const dark = darkestFraction(pixels.filter((p) => p.a >= 200), 0.25);
  const hairColor = dark.length > 0 ? meanRGB(dark) : undefined;

  // If we couldn't extract a hairColor, the patch can't be validated —
  // force density to 0 so consumers don't trust it. (Equivalent: a
  // textured-darker patch *without* a hairColor was likely background
  // bleed past the face mask.)
  if (hairColor === undefined) return { density: 0 };

  // Reject hair colors that are too saturated — real hair is desaturated.
  // A saturated color here means we sampled chair upholstery, wall paint,
  // or similar background, not actual facial hair.
  const { r, g, b } = unpackColor(hairColor);
  const { s } = rgbToHsv(r, g, b);
  if (s > HAIR_MAX_SATURATION) return { density: 0 };

  // Sanity ceiling on density — anything above 0.95 is almost certainly
  // background (real beard isn't 100% dense). We cap survivors at 0.85
  // so the consumer doesn't blow out the visual.
  const density = Math.min(rawDensity, DENSITY_CAP);
  return { hairColor, density };
}

function emptyResult(): Record<BeardRegion, BeardData> {
  return {
    chin: { density: 0 },
    underChin: { density: 0 },
    mustache: { density: 0 },
    cheekL: { density: 0 },
    cheekR: { density: 0 },
    sideburnL: { density: 0 },
    sideburnR: { density: 0 },
    jawlineL: { density: 0 },
    jawlineR: { density: 0 },
  };
}

export function sampleBeard(
  ctx: SampleContext,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  skinTone: number | null,
): Record<BeardRegion, BeardData> | null {
  if (skinTone === null || skinTone === undefined) return null;
  if (!landmarks || landmarks.length < 478) return null;

  const skin = unpackColor(skinTone);
  const skinLuma = 0.299 * skin.r + 0.587 * skin.g + 0.114 * skin.b;

  const result = emptyResult();

  // Per-centroid regions.
  for (const key of Object.keys(REGIONS) as Array<keyof typeof REGIONS>) {
    const indices = REGIONS[key];
    const c = landmarkCentroid(landmarks, indices);
    if (!c) continue;
    const px = c.x * ctx.width;
    const py = c.y * ctx.height;
    if (px < 0 || px >= ctx.width || py < 0 || py >= ctx.height) continue;
    const pixels = sampleRect(ctx, px, py, PATCH_HALF);
    if (pixels.length < 9) continue;
    result[key] = detectInPatch(pixels, skinLuma);
  }

  // Mustache: rectangle between lip-top y and nose-base y, x spanning
  // the lip-top range.
  const lipTop = landmarkCentroid(landmarks, MUSTACHE_LIP_TOP);
  const noseBase = landmarkCentroid(landmarks, MUSTACHE_NOSE_BASE);
  if (lipTop && noseBase) {
    const yTop = Math.min(lipTop.y, noseBase.y);
    const yBot = Math.max(lipTop.y, noseBase.y);
    // Use x from the outer lip-top landmarks for horizontal span.
    const lmL = landmarks[37];
    const lmR = landmarks[267];
    if (lmL && lmR && Number.isFinite(lmL.x) && Number.isFinite(lmR.x)) {
      const xL = Math.min(lmL.x, lmR.x) * ctx.width;
      const xR = Math.max(lmL.x, lmR.x) * ctx.width;
      const yT = yTop * ctx.height;
      const yB = yBot * ctx.height;
      const x0 = Math.max(0, Math.floor(xL));
      const y0 = Math.max(0, Math.floor(yT));
      const x1 = Math.min(ctx.width, Math.ceil(xR + 1));
      const y1 = Math.min(ctx.height, Math.ceil(yB + 1));
      const w = x1 - x0;
      const h = y1 - y0;
      if (w > 0 && h > 0) {
        try {
          const data = ctx.ctx.getImageData(x0, y0, w, h).data;
          const pixels: Pixel[] = new Array(w * h);
          let idx = 0;
          for (let i = 0; i < data.length; i += 4) {
            pixels[idx++] = { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
          }
          if (pixels.length >= 9) {
            result.mustache = detectInPatch(pixels, skinLuma);
          }
        } catch {
          // canvas read failure → leave mustache density at 0
        }
      }
    }
  }

  return result;
}
