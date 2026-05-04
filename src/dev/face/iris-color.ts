/**
 * Phase 8.4 — Iris color sampling for stylized-realistic player eyes.
 *
 * Given the front-pose photo + 478 face landmarks, sample a small region
 * around each iris-center landmark (468 left, 473 right) to extract a mean
 * iris color. The result is stored on the FaceImage's `mesh3d.eyeColors`
 * field at scan-accept time and read back by `GamePlayer.setFaceMesh3D` to
 * tint the per-instance iris material.
 *
 * Phase 8.5 refactor: image-load + rect-sample + color-pack helpers moved
 * into `sample-utils.ts` so they can be shared with the broader procedural-
 * face data pipeline. The public `sampleIrisColors` signature is unchanged.
 *
 * Contracts:
 *  - Returns null on any failure (image load error, landmarks off-image,
 *    canvas unavailable). Caller persists the FaceImage *without*
 *    `eyeColors` and the runtime falls back to default brown irises.
 *  - Both eyes must succeed for a non-null return; if either iris yields
 *    insufficient surviving samples, we return null rather than a half
 *    measurement. (Iris colors are visually paired; one default-brown,
 *    one sampled would look broken.)
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  type SampleContext,
  type Pixel,
  loadImageToCanvas,
  sampleRect,
  packColor,
} from './sample-utils';

/** Iris center landmark indices in the 478-point MediaPipe FaceMesh. */
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;

/** Pixel radius around each iris center to sample. Larger averages over
 *  more pixels (more robust) but pulls in surrounding sclera/skin/pupil at
 *  the edges. 5px is a tradeoff that works well at the ~256–512px capture
 *  resolutions the scan flow produces. */
const SAMPLE_RADIUS = 5;

/** Reject pixels that look like sclera (near-white) or pupil (near-black).
 *  Outlier rejection happens per-channel-min/max — anything brighter than
 *  the sclera threshold or darker than the pupil threshold is dropped. */
const SCLERA_MIN = 235; // RGB > this = white-ish, drop
const PUPIL_MAX = 25;   // RGB < this = black-ish, drop
const ALPHA_MIN = 200;  // skip nearly-transparent pixels (data URL edges)

/**
 * Compute the outlier-rejected mean iris color for one eye from a
 * pre-sampled rectangle of pixels. Returns null if too few survive.
 */
function meanIrisFromPixels(pixels: Pixel[]): number | null {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  for (const p of pixels) {
    if (p.a < ALPHA_MIN) continue;
    if (p.r >= SCLERA_MIN && p.g >= SCLERA_MIN && p.b >= SCLERA_MIN) continue;
    if (p.r <= PUPIL_MAX && p.g <= PUPIL_MAX && p.b <= PUPIL_MAX) continue;
    rSum += p.r;
    gSum += p.g;
    bSum += p.b;
    count++;
  }
  if (count < 4) return null;
  return packColor(
    Math.round(rSum / count),
    Math.round(gSum / count),
    Math.round(bSum / count),
  );
}

function sampleEye(
  ctx: SampleContext,
  cx: number,
  cy: number,
): number | null {
  const pixels = sampleRect(ctx, cx, cy, SAMPLE_RADIUS);
  if (pixels.length === 0) return null;
  return meanIrisFromPixels(pixels);
}

/**
 * Sample mean iris colors from a front-pose photo + landmarks.
 *
 * @param imageDataUrl Front-pose photo (typically the cropped face PNG).
 * @param landmarks    478 normalized landmarks in image-space [0..1].
 * @returns Packed 0xRRGGBB color per eye, or null if sampling failed.
 *
 * Note on landmark naming: MediaPipe's "left" iris (index 468) is the
 * subject's anatomical left eye, which appears on the RIGHT side of an
 * un-mirrored selfie photo. The runtime applies the result to the rig's
 * `eye-left` / `eye-right` named meshes — we keep the same naming
 * convention here (the editor's webcam preview is CSS-mirrored, but the
 * landmarks are in un-mirrored image coords, so the math just works out).
 */
export async function sampleIrisColors(
  imageDataUrl: string,
  landmarks: NormalizedLandmark[],
): Promise<{ left: number; right: number } | null> {
  if (!landmarks || landmarks.length < 478) return null;
  const lmL = landmarks[LEFT_IRIS];
  const lmR = landmarks[RIGHT_IRIS];
  if (!lmL || !lmR) return null;
  if (!Number.isFinite(lmL.x) || !Number.isFinite(lmL.y)) return null;
  if (!Number.isFinite(lmR.x) || !Number.isFinite(lmR.y)) return null;

  let ctx: SampleContext;
  try {
    ctx = await loadImageToCanvas(imageDataUrl);
  } catch {
    return null;
  }

  const lxPx = lmL.x * ctx.width;
  const lyPx = lmL.y * ctx.height;
  const rxPx = lmR.x * ctx.width;
  const ryPx = lmR.y * ctx.height;

  // Bail if either landmark is off-image (extreme yaw, mis-detection).
  if (lxPx < 0 || lxPx > ctx.width || lyPx < 0 || lyPx > ctx.height) return null;
  if (rxPx < 0 || rxPx > ctx.width || ryPx < 0 || ryPx > ctx.height) return null;

  const left = sampleEye(ctx, lxPx, lyPx);
  const right = sampleEye(ctx, rxPx, ryPx);
  if (left === null || right === null) return null;
  return { left, right };
}
