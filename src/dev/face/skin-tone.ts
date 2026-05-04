/**
 * Phase 8.5 — Skin tone sampling.
 *
 * Sample 4 well-distributed face patches (forehead, both cheeks, chin) and
 * combine surviving patches into a single skin-tone color. Per-patch
 * medians are robust to a single beard hair / blemish; rejecting patches
 * whose luma is far below the image-mean luma kills entire patches that
 * landed on a beard zone, glasses arm, or shadow edge.
 *
 * Returns per-patch values too — downstream samplers (lips, brows, beard)
 * compare against the skin tone to detect non-skin pixels, and the per-patch
 * map lets future tuning use *local* skin tone (e.g. cheek vs forehead) for
 * regions that physically blend with their nearest patch.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  type SampleContext,
  type Pixel,
  sampleRect,
  medianRGB,
  pixelLuma,
  meanLuma,
  landmarkCentroid,
  unpackColor,
  packColor,
  isSkinHSV,
} from './sample-utils';

const HALF_EXTENT = 7; // 7px half-extent → 15×15 patch

export interface SkinPatches {
  forehead: number | null;
  cheekL: number | null;
  cheekR: number | null;
  chin: number | null;
}

interface PatchSpec {
  key: keyof SkinPatches;
  indices: number[];
  /** Optional vertical offset (in normalized image coords) applied to the
   *  centroid before sampling — used for the chin patch which is offset
   *  2% downward from the chin landmark to land on actual skin (not the
   *  jaw shadow). */
  yOffset?: number;
}

const PATCHES: PatchSpec[] = [
  { key: 'forehead', indices: [9, 108, 337, 10] },
  { key: 'cheekL', indices: [234, 93, 132] },
  { key: 'cheekR', indices: [454, 323, 361] },
  { key: 'chin', indices: [152, 176, 148], yOffset: 0.02 },
];

/** Compute a coarse image-mean luma by sampling a strided grid of pixels.
 *  Used as the reference for patch rejection — a patch median darker than
 *  40% of the image mean is treated as a non-skin region. */
function imageMeanLuma(ctx: SampleContext): number {
  const STEP = 16;
  const samples: Pixel[] = [];
  for (let y = 0; y < ctx.height; y += STEP) {
    for (let x = 0; x < ctx.width; x += STEP) {
      const px = sampleRect(ctx, x, y, 0);
      if (px.length > 0) samples.push(px[0]);
    }
  }
  return meanLuma(samples);
}

/** Absolute lower-bound on patch luma. Skin under any reasonable lighting
 *  is brighter than ~50/255. Combined with the image-mean relative
 *  threshold, this catches the case where a dark-room background pulls the
 *  image mean down so far that even nearly-black pixels would survive
 *  the relative test. */
const ABSOLUTE_LUMA_FLOOR = 50;

export function sampleSkinTone(
  ctx: SampleContext,
  landmarks: ReadonlyArray<NormalizedLandmark>,
): { tone: number; patches: SkinPatches } | null {
  if (!landmarks || landmarks.length < 478) return null;

  const imgMean = imageMeanLuma(ctx);
  const lumaThreshold = 0.4 * imgMean;

  const patches: SkinPatches = {
    forehead: null,
    cheekL: null,
    cheekR: null,
    chin: null,
  };

  // Collect surviving per-channel medians so we can take a median-of-medians
  // across patches at the end (more robust than mean against a single
  // outlier patch slipping past the per-patch filters).
  const survivorR: number[] = [];
  const survivorG: number[] = [];
  const survivorB: number[] = [];

  for (const spec of PATCHES) {
    const c = landmarkCentroid(landmarks, spec.indices);
    if (!c) continue;
    const cy = c.y + (spec.yOffset ?? 0);
    const px = c.x * ctx.width;
    const py = cy * ctx.height;
    if (px < 0 || px >= ctx.width || py < 0 || py >= ctx.height) continue;

    const pixels = sampleRect(ctx, px, py, HALF_EXTENT);
    if (pixels.length < 9) continue;

    // Filter low-alpha pixels before computing the median.
    const filtered = pixels.filter((p) => p.a >= 200);
    if (filtered.length < 9) continue;

    const med = medianRGB(filtered);
    const { r, g, b } = unpackColor(med);
    const medLuma = 0.299 * r + 0.587 * g + 0.114 * b;

    // Patch-rejection: too dark vs image-mean → likely beard/shadow/hair.
    if (medLuma < lumaThreshold) continue;
    // Absolute luma floor: skin is never this dark, regardless of how
    // dark the room mean ended up.
    if (medLuma < ABSOLUTE_LUMA_FLOOR) continue;
    // HSV-based skin-color gate: rejects patches that landed on hat brims,
    // hair, or dark room background (e.g. the captured-data bug where
    // cheekR/chin sampled rgb(41,38,44) — purple, h~270°, s~7%, v~17%).
    if (!isSkinHSV(r, g, b)) continue;

    patches[spec.key] = med;
    survivorR.push(r);
    survivorG.push(g);
    survivorB.push(b);
  }

  // Require ≥2 surviving patches. With only one survivor we can't
  // distinguish a true skin patch from a single false-positive that slipped
  // through HSV+luma gates. Caller falls back to a sensible default.
  if (survivorR.length < 2) return null;

  // Pick the BRIGHTEST surviving patch (not median). Rationale: even after
  // HSV/luma gates pass a patch, it can still be partially shadowed (chin
  // under the jaw, cheek next to a beard, forehead under a hat brim). Real
  // skin in good light is the BRIGHTEST signal we sampled — picking the max
  // luma patch best approximates the user's actual non-shadowed skin tone.
  // Tested: median-of-survivors produced 0x664e5b (rgb 102,78,91) on a
  // captured scan whose true skin was rgb ~150,120,105. Brightest-of-survivors
  // returns the forehead patch (closer to true skin) instead of dragging the
  // estimate down via cheek-near-beard contamination.
  let bestI = 0;
  let bestLuma = 0;
  for (let i = 0; i < survivorR.length; i++) {
    const l = 0.299 * survivorR[i] + 0.587 * survivorG[i] + 0.114 * survivorB[i];
    if (l > bestLuma) {
      bestLuma = l;
      bestI = i;
    }
  }
  // High-quality threshold: when the BRIGHTEST surviving patch is still
  // shadowed (luma < 110), all sampled patches are unreliable. Fall back to
  // null so the rig uses its hash-derived default skin (which is a pleasant
  // mid-tan) instead of producing a darker-than-real result. This commonly
  // happens with hat-brim shadowing the forehead AND beard pixels near the
  // cheeks — no clean skin patch available. Real-light skin is ≥ 130 luma.
  if (bestLuma < 110) return null;
  const tone = packColor(survivorR[bestI], survivorG[bestI], survivorB[bestI]);
  return { tone, patches };
}
