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
  sampleRect,
  medianRGB,
  landmarkCentroid,
  unpackColor,
  packColor,
  isSkinHSV,
  imageMeanLuma,
  computeImageWhiteBalance,
  applyWhiteBalanceToPixels,
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

/** Absolute lower-bound on patch luma. Skin under any reasonable lighting
 *  is brighter than ~40/255 — even darkly-lit skin (deep shadow on a fair
 *  face, well-lit dark skin) sits above this. Combined with the image-mean
 *  relative threshold, this catches the case where a dark-room background
 *  pulls the image mean down so far that even nearly-black pixels would
 *  survive the relative test. Lowered from 50 → 40 (Task 2): genuine
 *  dimly-lit skin can sit at 45–50 luma; rejecting it costs us the only
 *  data we have for the user's tone. 40 is still well above genuinely-
 *  black non-skin (chair fabric, room shadow). */
const ABSOLUTE_LUMA_FLOOR = 40;

/** Below this image-mean luma we treat the scan as low-light AND/OR
 *  off-white-balance and accept a single HSV-passing patch rather than
 *  returning null. Rationale: clean indoor lighting yields imgMean ≥ 100,
 *  often 130+; dim or color-cast scans drop into 50–95 and frequently
 *  produce only ONE HSV-pass patch (the others get rejected for hue rotated
 *  toward blue/purple by the white-balance error). Better to render with
 *  the one good cheek's tone than fall back to default mid-tan. */
const LOW_LIGHT_IMG_MEAN_THRESHOLD = 100;

/** Result of skin-tone sampling. */
export interface SkinToneResult {
  tone: number;
  patches: SkinPatches;
  /** True when the result came from the low-light fallback path (only one
   *  patch survived HSV+luma gates and imgMean was below
   *  LOW_LIGHT_IMG_MEAN_THRESHOLD). Downstream UI / reprocess can flag the
   *  result for review — the tone is plausible but came from a single
   *  cheek and may be biased by local shadowing. */
  samplerLowLightWarning: boolean;
}

export function sampleSkinTone(
  ctx: SampleContext,
  landmarks: ReadonlyArray<NormalizedLandmark>,
): SkinToneResult | null {
  if (!landmarks || landmarks.length < 478) return null;

  const imgMean = imageMeanLuma(ctx);
  const lumaThreshold = 0.4 * imgMean;

  // Phase H0+ — Compute the SCENE-wide white-balance correction once.
  // Many webcams in dim or color-cast lighting produce a strong blue/
  // purple tint that hue-shifts skin pixels out of `isSkinHSV`'s warm
  // range, killing every patch. We sample a strided grid over the whole
  // image to derive gray-world scales (R/B → green's mean) and apply
  // them to each patch's pixels before HSV gating. Critical: scales come
  // from the WHOLE IMAGE, not the patch — applying gray-world to a single
  // uniform patch just converts it to neutral gray, defeating the purpose.
  // When the image's channel-mean ratio is below WB_CAST_THRESHOLD the
  // helper returns `apply: false` and the patch pixels pass through
  // unchanged (no-op for normal-balanced webcams).
  const wb = computeImageWhiteBalance(ctx);

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

    // Apply the SCENE-wide WB correction (computed once above) to each
    // patch. When `wb.apply` is false, this is a reference pass-through —
    // no allocation, no per-pixel math. When the cast was severe (the
    // user's purple-cast webcam), the corrected pixels have R/B rebalanced
    // toward G's mean, pulling skin pixels back into `isSkinHSV`'s warm
    // hue range so the patch survives the gate.
    const wbFiltered = applyWhiteBalanceToPixels(wb, filtered);

    const med = medianRGB(wbFiltered);
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

  // Require ≥1 surviving patch. With only one survivor we still accept
  // the result IF the image is low-light or has an off-white-balance cast
  // (imgMean < LOW_LIGHT_IMG_MEAN_THRESHOLD) — see Task 2 rationale on the
  // constant. Under those conditions, several patches typically get HSV-
  // rejected for false hue rotation (purple cast → h~270°), and rejecting
  // the whole scan because only one survived costs us all skin-tone data
  // for the rig. The remaining checks (HSV gate already passed, absolute
  // luma floor already passed, brightest-luma threshold below) are still
  // applied — we're loosening the survivor count, not the per-patch gates.
  if (survivorR.length === 0) return null;
  const isLowLight = imgMean < LOW_LIGHT_IMG_MEAN_THRESHOLD;
  if (survivorR.length < 2 && !isLowLight) return null;

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
  // Brightest-patch luma threshold: when the BRIGHTEST surviving patch is
  // still shadowed below this floor, the data is too unreliable to trust.
  // Lowered from 110 → 90 (Task 2): luma 90 still rejects clearly-shadowed
  // pixels (cheek under a beard, forehead under a hat brim, etc.) but
  // accepts dimly-lit clean skin. Real well-lit skin sits at 130+ luma;
  // 90–110 is the band where dim indoor lighting clips an otherwise-fine
  // sample. Better to render with a slightly-dim tone than fall back to
  // the default mid-tan, which often looks worse on darker complexions.
  if (bestLuma < 90) return null;
  const tone = packColor(survivorR[bestI], survivorG[bestI], survivorB[bestI]);
  // Flag the result when we came through the single-survivor path so
  // callers can surface a "review the scan" hint to the user.
  const samplerLowLightWarning = survivorR.length < 2;
  return { tone, patches, samplerLowLightWarning };
}
