/**
 * Phase 8.5 — Refine headShape.aspectDH using a profile-pose capture.
 *
 * The front-pose Z-coords from MediaPipe are in a relative space and
 * don't precisely capture nose-protrusion depth — they're roughly
 * proportional but the absolute scale can drift between captures. When
 * the scan flow includes a profile-left or profile-right pose, we have
 * a *true* X-axis depth measurement: nose-tip to ear-tragus distance in
 * the profile image plane.
 *
 * This module looks for the best available profile pose and recomputes
 * aspectDH from it. The caller decides whether to use it (we also report
 * the source so consumers know whether they're trusting front-Z or
 * profile-X).
 */

interface AngleEntry {
  poseName: string;
  imageDataUrl: string;
  landmarks: number[];
}

export function refineHeadShapeFromProfile(
  angles: ReadonlyArray<AngleEntry> | null | undefined,
  currentAspectDH: number,
): { aspectDH: number; aspectDHSource: 'front-z' | 'profile' } | null {
  if (!angles || angles.length === 0) return null;
  // Prefer profile-left if both are available (arbitrary — the math is
  // mirror-symmetric so either gives the same headShape ratio).
  const profile =
    angles.find((a) => a.poseName === 'profile-left') ??
    angles.find((a) => a.poseName === 'profile-right');
  if (!profile) return null;

  const lm = profile.landmarks;
  if (!lm || lm.length < 478 * 3) return null;

  // Each landmark is (x, y, z) at flat index i*3.
  const get = (idx: number): { x: number; y: number; z: number } | null => {
    const off = idx * 3;
    if (off + 2 >= lm.length) return null;
    const x = lm[off];
    const y = lm[off + 1];
    const z = lm[off + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x, y, z };
  };

  const nose = get(1);
  const earL = get(234);
  const earR = get(454);
  const chin = get(152);
  const fore = get(10);
  if (!nose || !chin || !fore) return null;
  // Profile-left shows the subject's right side → use lm234 (left ear).
  // Profile-right shows the subject's left side → use lm454 (right ear).
  // Pick whichever is further from the nose in X.
  let earX: number | null = null;
  if (earL && earR) {
    earX = Math.abs(earL.x - nose.x) > Math.abs(earR.x - nose.x) ? earL.x : earR.x;
  } else if (earL) {
    earX = earL.x;
  } else if (earR) {
    earX = earR.x;
  }
  if (earX === null) return null;

  const depthX = Math.abs(nose.x - earX);
  const heightY = Math.abs(chin.y - fore.y);
  if (heightY === 0 || !Number.isFinite(heightY)) return null;
  const aspectDH = depthX / heightY;
  if (!Number.isFinite(aspectDH) || aspectDH <= 0) return null;
  return { aspectDH, aspectDHSource: 'profile' };
}
