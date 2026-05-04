/**
 * Phase 8.5 — Lip color sampling (separate upper / lower).
 *
 * The procedural-face rig draws upper + lower lips as distinct meshes, and
 * they're often visibly different colors (lower lip catches more light;
 * lip-line shadow tints the upper). We sample each ring independently
 * across 6 landmarks (3×3 patch each) and reject pixels too close to skin
 * tone (mustache stubble bleed) or specular-highlight bright (saliva).
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  type SampleContext,
  type Pixel,
  sampleRect,
  meanRGB,
  packColor,
  colorDistance,
  pixelLuma,
} from './sample-utils';

const PATCH_HALF = 3; // 3px half-extent → 7×7 patch

const UPPER_INDICES = [0, 37, 267, 11, 302, 72];
const LOWER_INDICES = [17, 84, 314, 181, 405, 14];

const SKIN_DISTANCE_REJECT = 25;
const SPECULAR_LUMA = 245;

function gatherRing(
  ctx: SampleContext,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  indices: ReadonlyArray<number>,
  skinTone: number,
): Pixel[] {
  const out: Pixel[] = [];
  for (const idx of indices) {
    const lm = landmarks[idx];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
    const px = lm.x * ctx.width;
    const py = lm.y * ctx.height;
    if (px < 0 || px >= ctx.width || py < 0 || py >= ctx.height) continue;
    const pixels = sampleRect(ctx, px, py, PATCH_HALF);
    for (const p of pixels) {
      if (p.a < 200) continue;
      const c = packColor(p.r, p.g, p.b);
      if (colorDistance(c, skinTone) < SKIN_DISTANCE_REJECT) continue;
      if (pixelLuma(p) > SPECULAR_LUMA) continue;
      out.push(p);
    }
  }
  return out;
}

export function sampleLipColor(
  ctx: SampleContext,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  skinTone: number,
): { upper: number; lower: number } | null {
  if (!landmarks || landmarks.length < 478) return null;
  const upperPx = gatherRing(ctx, landmarks, UPPER_INDICES, skinTone);
  const lowerPx = gatherRing(ctx, landmarks, LOWER_INDICES, skinTone);
  if (upperPx.length < 4 || lowerPx.length < 4) return null;
  return { upper: meanRGB(upperPx), lower: meanRGB(lowerPx) };
}
