/**
 * Phase 8.5 — Brow color/intensity + brow shape sampling.
 *
 * Two exports:
 *   - sampleBrowProminence: pixel-sampled color + intensity per side. The
 *     "intensity" is a 0..1 measure of how dark the brow is vs surrounding
 *     skin (faint blonde ≈ 0.05, thick black ≈ 0.6). Phase D will use this
 *     to pick brow opacity / mesh darkness.
 *   - sampleBrowShape: pure landmark math. 5 sample points along the upper
 *     edge of each brow, in face-local 0..1 coords (normalized against the
 *     core-face bbox). Phase D feeds this to the procedural-brow geometry
 *     to capture arch shape.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  type SampleContext,
  type Pixel,
  sampleRect,
  meanRGB,
  packColor,
  pixelLuma,
  unpackColor,
  darkestFraction,
  clamp01,
} from './sample-utils';

const PATCH_HALF = 5; // 5px half-extent → 11×11 patch

const LEFT_PROMINENCE = [65, 105, 66];
const RIGHT_PROMINENCE = [295, 334, 296];

const LEFT_SHAPE = [70, 63, 105, 66, 107]; // tail-to-bridge order
const RIGHT_SHAPE = [336, 296, 334, 293, 300];

interface BrowSide {
  color: number;
  intensity: number;
}

function sampleSide(
  ctx: SampleContext,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  indices: ReadonlyArray<number>,
  skinTone: number,
): BrowSide | null {
  const all: Pixel[] = [];
  for (const idx of indices) {
    const lm = landmarks[idx];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
    const px = lm.x * ctx.width;
    const py = lm.y * ctx.height;
    if (px < 0 || px >= ctx.width || py < 0 || py >= ctx.height) continue;
    const pixels = sampleRect(ctx, px, py, PATCH_HALF);
    for (const p of pixels) if (p.a >= 200) all.push(p);
  }
  if (all.length < 9) return null;

  // Lowest-luma 33% = brow hair pixels (skin pixels in the patch are
  // brighter, brow hairs darker).
  const dark = darkestFraction(all, 0.33);
  if (dark.length === 0) return null;
  const color = meanRGB(dark);
  const browLuma = unpackColor(color);
  const browL = 0.299 * browLuma.r + 0.587 * browLuma.g + 0.114 * browLuma.b;

  const skin = unpackColor(skinTone);
  const skinL = 0.299 * skin.r + 0.587 * skin.g + 0.114 * skin.b;

  const intensity = skinL > 0 ? clamp01((skinL - browL) / skinL) : 0;
  return { color, intensity };
}

export function sampleBrowProminence(
  ctx: SampleContext,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  skinTone: number | null,
): { left: BrowSide; right: BrowSide } | null {
  if (skinTone === null || skinTone === undefined) return null;
  if (!landmarks || landmarks.length < 478) return null;
  const left = sampleSide(ctx, landmarks, LEFT_PROMINENCE, skinTone);
  const right = sampleSide(ctx, landmarks, RIGHT_PROMINENCE, skinTone);
  if (!left || !right) return null;
  return { left, right };
}

/**
 * Convert landmarks to face-local [0..1] coords using the core-face bbox.
 */
function toFaceLocal(
  landmarks: ReadonlyArray<NormalizedLandmark>,
  indices: ReadonlyArray<number>,
  faceBbox: { left: number; top: number; right: number; bottom: number },
): Array<[number, number]> | null {
  const w = faceBbox.right - faceBbox.left;
  const h = faceBbox.bottom - faceBbox.top;
  if (w <= 0 || h <= 0) return null;
  const out: Array<[number, number]> = [];
  for (const idx of indices) {
    const lm = landmarks[idx];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return null;
    const fx = (lm.x - faceBbox.left) / w;
    const fy = (lm.y - faceBbox.top) / h;
    out.push([fx, fy]);
  }
  return out;
}

export function sampleBrowShape(
  landmarks: ReadonlyArray<NormalizedLandmark>,
  faceBbox: { left: number; top: number; right: number; bottom: number } | null,
): { left: Array<[number, number]>; right: Array<[number, number]> } | null {
  if (!faceBbox) return null;
  if (!landmarks || landmarks.length < 478) return null;
  const left = toFaceLocal(landmarks, LEFT_SHAPE, faceBbox);
  const right = toFaceLocal(landmarks, RIGHT_SHAPE, faceBbox);
  if (!left || !right) return null;
  return { left, right };
}
