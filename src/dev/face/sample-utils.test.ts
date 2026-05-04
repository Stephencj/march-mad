/**
 * Phase H0+ — Sample-utils tests for the white-balance helpers.
 *
 * The skin-tone sampler depends on the gray-world WB correction to
 * recover skin chroma when a webcam casts the whole frame purple/cyan.
 * These tests cover both pieces of the algorithm:
 *  - `computeWhiteBalance` derives scales from a (typically scene-wide)
 *    pixel set; mild casts produce no-op scales.
 *  - `applyWhiteBalanceToPixels` rebalances R/B toward G's mean and
 *    clamps to [0, 255]; the no-op path returns the input reference
 *    unchanged.
 * The realistic flow tested below: derive scales from a varied scene,
 * then apply them to a separate skin-pixel set so the patch retains
 * chroma (instead of collapsing to gray, which is what happens when
 * scales come from the patch itself).
 */
import { describe, it, expect } from 'vitest';
import {
  whiteBalancePixels,
  computeWhiteBalance,
  applyWhiteBalanceToPixels,
  isSkinHSV,
  rgbToHsv,
  type Pixel,
} from './sample-utils';

function pix(r: number, g: number, b: number, a = 255): Pixel {
  return { r, g, b, a };
}

describe('computeWhiteBalance', () => {
  it('returns no-op scales when channel means are already balanced', () => {
    // Mild bias (typical healthy skin: r > g > b but ratio < 1.3).
    const pixels = [
      pix(170, 150, 140),
      pix(160, 145, 135),
      pix(175, 155, 142),
    ];
    const wb = computeWhiteBalance(pixels);
    expect(wb.apply).toBe(false);
    expect(wb.rScale).toBe(1);
    expect(wb.bScale).toBe(1);
  });

  it('returns no-op on empty input', () => {
    const wb = computeWhiteBalance([]);
    expect(wb.apply).toBe(false);
  });

  it('returns no-op when minimum channel mean is zero (degenerate)', () => {
    const wb = computeWhiteBalance([pix(50, 0, 100), pix(40, 0, 80)]);
    expect(wb.apply).toBe(false);
  });

  it('returns active scales for a strong purple cast', () => {
    // rgb means ~(110, 130, 160): ratio 160/110 ≈ 1.45 > 1.3.
    const cast = [
      pix(110, 130, 160),
      pix(105, 128, 158),
      pix(115, 132, 162),
      pix(108, 129, 159),
      pix(112, 131, 161),
    ];
    const wb = computeWhiteBalance(cast);
    expect(wb.apply).toBe(true);
    // R should scale UP (rScale > 1), B should scale DOWN (bScale < 1).
    expect(wb.rScale).toBeGreaterThan(1);
    expect(wb.bScale).toBeLessThan(1);
  });

  it('skips low-alpha pixels when computing channel means', () => {
    // Three high-alpha purple pixels + one low-alpha red outlier.
    const pixels = [
      pix(110, 130, 160, 255),
      pix(108, 128, 158, 255),
      pix(112, 132, 162, 255),
      pix(255, 0, 0, 100), // ignored
    ];
    const wb = computeWhiteBalance(pixels);
    expect(wb.apply).toBe(true);
    // If the outlier weren't skipped, rMean would skew way up (~145)
    // and the cast threshold might not trigger. Since it IS skipped,
    // rMean ≈ 110, ratio ≈ 1.43, applies.
    expect(wb.rScale).toBeGreaterThan(1.1);
  });
});

describe('applyWhiteBalanceToPixels', () => {
  it('returns the input reference when wb.apply is false', () => {
    const pixels = [pix(100, 150, 200)];
    const out = applyWhiteBalanceToPixels({ apply: false, rScale: 2, bScale: 2 }, pixels);
    expect(out).toBe(pixels); // same array, no allocation
  });

  it('applies green-anchored scaling and preserves G + alpha', () => {
    const pixels = [pix(100, 150, 200, 200), pix(50, 100, 150, 255)];
    const wb = { apply: true, rScale: 1.5, bScale: 0.5 };
    const out = applyWhiteBalanceToPixels(wb, pixels);
    expect(out).not.toBe(pixels);
    expect(out[0].r).toBe(150); // 100 * 1.5
    expect(out[0].g).toBe(150); // unchanged
    expect(out[0].b).toBe(100); // 200 * 0.5
    expect(out[0].a).toBe(200); // unchanged
    expect(out[1].r).toBe(75);
    expect(out[1].g).toBe(100);
    expect(out[1].b).toBe(75);
    expect(out[1].a).toBe(255);
  });

  it('clamps corrected channels to [0, 255]', () => {
    const pixels = [pix(200, 100, 200)];
    // Aggressive scales: 200*2=400 → clamp 255; 200*0=0 → clamp 0.
    const wb = { apply: true, rScale: 2, bScale: 0 };
    const out = applyWhiteBalanceToPixels(wb, pixels);
    expect(out[0].r).toBe(255);
    expect(out[0].b).toBe(0);
  });
});

describe('isSkinHSV (Phase H0+ saturation relaxation)', () => {
  it('accepts dim-light skin with low saturation (s≈0.07)', () => {
    // Real captured failing case from the user's webcam: forehead patch
    // rgb(141, 128, 136). Pre-Phase-H0+ this was rejected (s≈0.09 < 0.10
    // floor); post-relaxation it should pass.
    expect(isSkinHSV(141, 128, 136)).toBe(true);
    // CheekL same scan: rgb(88, 82, 85), s≈0.07. Was failing; should pass.
    expect(isSkinHSV(88, 82, 85)).toBe(true);
  });

  it('still rejects the canonical purple-shadow non-skin pixel', () => {
    // The captured-data bug the original gate was tuned against:
    // rgb(41, 38, 44), h~270°, s~7%, v~17%. Should still be rejected:
    // hue is out of the warm window AND value is below 0.25 floor.
    expect(isSkinHSV(41, 38, 44)).toBe(false);
  });

  it('rejects pure-gray pixels (zero saturation)', () => {
    expect(isSkinHSV(120, 120, 120)).toBe(false);
    expect(isSkinHSV(80, 80, 80)).toBe(false);
  });

  it('still rejects clearly-non-skin saturated colors', () => {
    expect(isSkinHSV(50, 150, 180)).toBe(false); // cyan shirt
    expect(isSkinHSV(20, 100, 30)).toBe(false); // green
    expect(isSkinHSV(80, 50, 200)).toBe(false); // strong blue
  });
});

describe('whiteBalancePixels (compute + apply convenience)', () => {
  it('returns input unchanged when cast is mild', () => {
    const pixels = [pix(170, 150, 140), pix(160, 145, 135)];
    expect(whiteBalancePixels(pixels)).toBe(pixels);
  });

  it('returns a corrected copy when cast is severe', () => {
    const cast = [
      pix(110, 130, 160),
      pix(105, 128, 158),
      pix(115, 132, 162),
    ];
    const out = whiteBalancePixels(cast);
    expect(out).not.toBe(cast);
    // R should have moved up, B down — hues pushed toward warm.
    let rSumIn = 0;
    let rSumOut = 0;
    let bSumIn = 0;
    let bSumOut = 0;
    for (let i = 0; i < cast.length; i++) {
      rSumIn += cast[i].r;
      rSumOut += out[i].r;
      bSumIn += cast[i].b;
      bSumOut += out[i].b;
    }
    expect(rSumOut).toBeGreaterThan(rSumIn);
    expect(bSumOut).toBeLessThan(bSumIn);
  });

  it('recovers warm skin hue when scene-derived WB is applied to a skin patch', () => {
    // Realistic flow: a webcam tinted the WHOLE scene purple. The
    // scene-wide pixel set has channel means with a strong cast (R<G<B).
    // Skin pixels in the same scene also got pushed toward purple. Apply
    // the scene's WB scales to the skin pixels — the SAME multipliers
    // are used as for the scene mean, so per-pixel chroma is preserved.
    const scene: Pixel[] = [];
    // Simulate a 5-color "scene": gray walls + warm skin + dark hair +
    // cyan shirt. Real RGB then strong purple cast: r-=50, b+=50.
    const sceneRealColors = [
      [200, 200, 200], // wall
      [200, 200, 200],
      [180, 180, 180],
      [160, 130, 110], // skin
      [160, 130, 110],
      [160, 130, 110],
      [50, 40, 30],    // hair
      [50, 40, 30],
      [50, 150, 180],  // cyan shirt
      [50, 150, 180],
    ];
    for (const [r, g, b] of sceneRealColors) {
      scene.push(pix(Math.max(0, r - 50), g, Math.min(255, b + 50)));
    }
    const wb = computeWhiteBalance(scene);
    expect(wb.apply).toBe(true);

    // Now apply those scales to a SKIN-only patch (also cast).
    const skinPatch = [
      pix(110, 130, 160),
      pix(115, 132, 165),
      pix(108, 128, 158),
    ];
    // Pre-WB: skin pixel hue is ~220° (purple/blue), fails isSkinHSV.
    const before = rgbToHsv(skinPatch[0].r, skinPatch[0].g, skinPatch[0].b);
    expect(before.h).toBeGreaterThan(180);
    expect(isSkinHSV(skinPatch[0].r, skinPatch[0].g, skinPatch[0].b)).toBe(false);

    const corrected = applyWhiteBalanceToPixels(wb, skinPatch);
    // Post-WB: hue should land in warm range (0-50° or 320-360°)
    // because the SAME scale that pulled the SCENE mean toward neutral
    // pulls the skin pixel's R up enough to dominate B again.
    const after = rgbToHsv(corrected[0].r, corrected[0].g, corrected[0].b);
    const inWarm = (after.h >= 0 && after.h <= 50) || after.h >= 320;
    expect(inWarm).toBe(true);
    expect(isSkinHSV(corrected[0].r, corrected[0].g, corrected[0].b)).toBe(true);
  });
});
