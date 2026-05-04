/**
 * Phase 8.5 — Nose proportions (pure landmark math).
 *
 * Three normalized ratios:
 *  - lengthRatio   : nose-tip vertical / face height
 *  - widthRatio    : ala-to-ala / face width
 *  - protrusionRatio: nose-bridge depth (Z) / face height
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export function sampleNose(
  landmarks: ReadonlyArray<NormalizedLandmark>,
  faceBbox: { left: number; top: number; right: number; bottom: number } | null,
): { lengthRatio: number; widthRatio: number; protrusionRatio: number } | null {
  if (!faceBbox) return null;
  if (!landmarks || landmarks.length < 478) return null;

  const lm1 = landmarks[1];
  const lm168 = landmarks[168];
  const lm152 = landmarks[152];
  const lm10 = landmarks[10];
  const lm294 = landmarks[294];
  const lm64 = landmarks[64];
  const lm454 = landmarks[454];
  const lm234 = landmarks[234];

  if (!lm1 || !lm168 || !lm152 || !lm10 || !lm294 || !lm64 || !lm454 || !lm234) return null;

  const faceH = lm152.y - lm10.y;
  const faceW = lm454.x - lm234.x;
  if (faceH === 0 || faceW === 0 || !Number.isFinite(faceH) || !Number.isFinite(faceW)) return null;

  const lengthRatio = (lm1.y - lm168.y) / faceH;
  const widthRatio = (lm294.x - lm64.x) / faceW;

  const z168 = (lm168 as { z?: number }).z;
  const z1 = (lm1 as { z?: number }).z;
  if (typeof z168 !== 'number' || typeof z1 !== 'number') return null;
  // Use the absolute face height as the denominator and abs() the result:
  // MediaPipe's Z-axis sign convention varies between mesh versions and
  // canonical poses (a front-facing subject's nose-tip can come out
  // either more-negative OR less-negative than the bridge depending on
  // the model build). The protrusion ratio is a *magnitude* — how far
  // the bridge stands out from the tip relative to face height — not a
  // directional signal. abs() gives us the magnitude unambiguously.
  const faceHeight = Math.max(Math.abs(faceH), 1e-6);
  const protrusionRatio = Math.abs((z168 - z1) / faceHeight);

  if (
    !Number.isFinite(lengthRatio) ||
    !Number.isFinite(widthRatio) ||
    !Number.isFinite(protrusionRatio)
  ) {
    return null;
  }

  return { lengthRatio, widthRatio, protrusionRatio };
}
