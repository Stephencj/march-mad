/**
 * Phase 8.5 — Eyelash detection.
 *
 * Sample a thin strip just above each upper lid (offset upward by 1.5% of
 * face height). Mean-luma vs skin gives a "darkness score"; if both eyes
 * pass the threshold AND alpha is solid, we mark eyelashes "prominent".
 *
 * Confidence is bumped when one or both profile views also confirm dark
 * pixels in the same anatomical region — this rules out false positives
 * from face-paint / heavy eyeliner that would only read in the front view.
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
  meanLuma,
  darkestFraction,
} from './sample-utils';

const LEFT_UPPER = [159, 158, 160];
const RIGHT_UPPER = [386, 385, 384];
const STRIP_OFFSET = 0.015; // 1.5% of face height upward
const PATCH_W_HALF = 1; // 3 px wide
const PATCH_H_HALF = 0; // 1 px tall (per landmark) → 3×1
const DARKNESS_THRESHOLD = 0.35;

function gatherStrip(
  ctx: SampleContext,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  indices: ReadonlyArray<number>,
  faceHeight: number,
): Pixel[] {
  const out: Pixel[] = [];
  const offsetPx = STRIP_OFFSET * faceHeight * ctx.height;
  for (const idx of indices) {
    const lm = landmarks[idx];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
    const px = lm.x * ctx.width;
    const py = lm.y * ctx.height - offsetPx;
    if (px < 0 || px >= ctx.width || py < 0 || py >= ctx.height) continue;
    // Sample a 3×1 patch (PATCH_W_HALF=1, PATCH_H_HALF=0).
    const x0 = Math.max(0, Math.floor(px - PATCH_W_HALF));
    const x1 = Math.min(ctx.width, Math.ceil(px + PATCH_W_HALF + 1));
    const y0 = Math.max(0, Math.floor(py));
    const y1 = Math.min(ctx.height, y0 + 1);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) continue;
    try {
      const data = ctx.ctx.getImageData(x0, y0, w, h).data;
      for (let i = 0; i < data.length; i += 4) {
        out.push({ r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] });
      }
    } catch {
      // skip
    }
  }
  return out;
}

function darknessScore(
  pixels: Pixel[],
  skinLuma: number,
): number {
  if (pixels.length === 0) return 0;
  const stripLuma = meanLuma(pixels);
  if (skinLuma <= 0) return 0;
  return (skinLuma - stripLuma) / skinLuma;
}

function profileConfirms(
  ctx: SampleContext | undefined,
  landmarks: ReadonlyArray<NormalizedLandmark> | null,
  indices: ReadonlyArray<number>,
  faceHeight: number,
  skinLuma: number,
): boolean {
  if (!ctx || !landmarks) return false;
  const px = gatherStrip(ctx, landmarks, indices, faceHeight);
  if (px.length === 0) return false;
  const filtered = px.filter((p) => p.a >= 200);
  if (filtered.length === 0) return false;
  return darknessScore(filtered, skinLuma) > DARKNESS_THRESHOLD;
}

export interface EyelashOptions {
  profileLeftCtx?: SampleContext;
  profileLeftLandmarks?: ReadonlyArray<NormalizedLandmark> | null;
  profileRightCtx?: SampleContext;
  profileRightLandmarks?: ReadonlyArray<NormalizedLandmark> | null;
}

export function sampleEyelashes(
  ctx: SampleContext,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  faceBbox: { left: number; top: number; right: number; bottom: number } | null,
  skinTone: number | null,
  opts: EyelashOptions = {},
): { prominent: boolean; color: number; confidence: number } | null {
  if (skinTone === null || skinTone === undefined) return null;
  if (!faceBbox) return null;
  if (!landmarks || landmarks.length < 478) return null;

  const skin = unpackColor(skinTone);
  const skinLuma = 0.299 * skin.r + 0.587 * skin.g + 0.114 * skin.b;
  const faceHeight = faceBbox.bottom - faceBbox.top;
  if (faceHeight <= 0) return null;

  const leftPx = gatherStrip(ctx, landmarks, LEFT_UPPER, faceHeight);
  const rightPx = gatherStrip(ctx, landmarks, RIGHT_UPPER, faceHeight);
  const allFront = leftPx.concat(rightPx).filter((p) => p.a >= 200);
  if (allFront.length === 0) return null;

  const meanA = allFront.reduce((s, p) => s + p.a, 0) / allFront.length;
  const score = darknessScore(allFront, skinLuma);
  const frontProminent = score > DARKNESS_THRESHOLD && meanA > 200;

  // Color from the dark bin only.
  const dark = darkestFraction(allFront, 0.33);
  const color = dark.length > 0 ? meanRGB(dark) : packColor(0, 0, 0);

  const profileLeftHit = profileConfirms(
    opts.profileLeftCtx,
    opts.profileLeftLandmarks ?? null,
    LEFT_UPPER,
    faceHeight,
    skinLuma,
  );
  const profileRightHit = profileConfirms(
    opts.profileRightCtx,
    opts.profileRightLandmarks ?? null,
    RIGHT_UPPER,
    faceHeight,
    skinLuma,
  );

  let confidence: number;
  if (frontProminent && (profileLeftHit || profileRightHit)) {
    confidence = profileLeftHit && profileRightHit ? 1.0 : 0.7;
  } else if (frontProminent) {
    confidence = 0.3;
  } else {
    confidence = 0.0;
  }

  return { prominent: frontProminent, color, confidence };
}
