/**
 * Phase 8.5 — Eye-shape parametric fit.
 *
 * For each eye, fit a quadratic y = a*x² + b*x + c to the upper and lower
 * lid landmark rings (in face-local coords), and report an "openness ratio"
 * = vertical distance between mean-upper and mean-lower / face height.
 *
 * Fit is closed-form least-squares (normal equations, 3×3 system, hand-
 * inverted). No numeric library needed; if the determinant comes out NaN
 * or zero the side is omitted.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

const LEFT_UPPER = [159, 158, 160, 161, 157, 173];
const LEFT_LOWER = [145, 144, 153, 154, 155, 163];
const RIGHT_UPPER = [386, 385, 384, 398, 387, 388];
const RIGHT_LOWER = [374, 373, 380, 381, 382, 390];

interface SidePoints {
  upper: Array<[number, number]>;
  lower: Array<[number, number]>;
}

interface EyeShapeSide {
  upperCurve: [number, number, number];
  lowerCurve: [number, number, number];
  opennessRatio: number;
}

function toFaceLocal(
  landmarks: ReadonlyArray<NormalizedLandmark>,
  indices: ReadonlyArray<number>,
  bbox: { left: number; top: number; right: number; bottom: number },
): Array<[number, number]> | null {
  const w = bbox.right - bbox.left;
  const h = bbox.bottom - bbox.top;
  if (w <= 0 || h <= 0) return null;
  const out: Array<[number, number]> = [];
  for (const idx of indices) {
    const lm = landmarks[idx];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return null;
    out.push([(lm.x - bbox.left) / w, (lm.y - bbox.top) / h]);
  }
  return out;
}

/**
 * Fit y = a*x² + b*x + c via the normal equations of least-squares.
 * X^T X is a 3×3 symmetric positive-semidefinite matrix; we invert it
 * using cofactors. Returns null on near-singular system.
 */
function fitQuadratic(pts: ReadonlyArray<[number, number]>): [number, number, number] | null {
  if (pts.length < 3) return null;
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let ty = 0, txy = 0, tx2y = 0;
  for (const [x, y] of pts) {
    const x2 = x * x;
    s0 += 1;
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    ty += y;
    txy += x * y;
    tx2y += x2 * y;
  }
  // Matrix A = [[s4, s3, s2], [s3, s2, s1], [s2, s1, s0]],  b = [tx2y, txy, ty].
  // Solve A * [a, b, c]^T = b.
  const det =
    s4 * (s2 * s0 - s1 * s1) -
    s3 * (s3 * s0 - s1 * s2) +
    s2 * (s3 * s1 - s2 * s2);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;

  const inv00 = (s2 * s0 - s1 * s1) / det;
  const inv01 = -(s3 * s0 - s1 * s2) / det;
  const inv02 = (s3 * s1 - s2 * s2) / det;
  const inv10 = -(s3 * s0 - s2 * s1) / det;
  const inv11 = (s4 * s0 - s2 * s2) / det;
  const inv12 = -(s4 * s1 - s2 * s3) / det;
  const inv20 = (s3 * s1 - s2 * s2) / det;
  const inv21 = -(s4 * s1 - s2 * s3) / det;
  const inv22 = (s4 * s2 - s3 * s3) / det;

  const a = inv00 * tx2y + inv01 * txy + inv02 * ty;
  const b = inv10 * tx2y + inv11 * txy + inv12 * ty;
  const c = inv20 * tx2y + inv21 * txy + inv22 * ty;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
  return [a, b, c];
}

function meanY(pts: ReadonlyArray<[number, number]>): number {
  let s = 0;
  for (const [, y] of pts) s += y;
  return pts.length > 0 ? s / pts.length : 0;
}

function fitSide(
  landmarks: ReadonlyArray<NormalizedLandmark>,
  upperIdx: ReadonlyArray<number>,
  lowerIdx: ReadonlyArray<number>,
  bbox: { left: number; top: number; right: number; bottom: number },
): EyeShapeSide | null {
  const upper = toFaceLocal(landmarks, upperIdx, bbox);
  const lower = toFaceLocal(landmarks, lowerIdx, bbox);
  if (!upper || !lower) return null;
  const uc = fitQuadratic(upper);
  const lc = fitQuadratic(lower);
  if (!uc || !lc) return null;
  const openness = meanY(lower) - meanY(upper); // already face-local (already / faceHeight)
  return { upperCurve: uc, lowerCurve: lc, opennessRatio: openness };
}

export function sampleEyeShape(
  landmarks: ReadonlyArray<NormalizedLandmark>,
  faceBbox: { left: number; top: number; right: number; bottom: number } | null,
): { left?: EyeShapeSide; right?: EyeShapeSide } | null {
  if (!faceBbox) return null;
  if (!landmarks || landmarks.length < 478) return null;
  const left = fitSide(landmarks, LEFT_UPPER, LEFT_LOWER, faceBbox);
  const right = fitSide(landmarks, RIGHT_UPPER, RIGHT_LOWER, faceBbox);
  if (!left && !right) return null;
  const out: { left?: EyeShapeSide; right?: EyeShapeSide } = {};
  if (left) out.left = left;
  if (right) out.right = right;
  return out;
}
