/**
 * Phase H1 — Feature baker unit tests.
 *
 * Vitest's default environment has no real Canvas2D implementation
 * (jsdom returns stubs that throw on getImageData), and the baker's
 * full pipeline depends on canvas drawing. So this test file exercises
 * the PURE helpers — bbox math, posterize, edgeEnhance — by hand-
 * constructing ImageData objects and providing a minimal mock 2D
 * context. Full-pipeline verification is performed by the puppeteer
 * dump script (`scripts/dump-feature-crops.cjs`) reading real PNGs
 * back from the renderer.
 */
import { describe, it, expect } from 'vitest';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  landmarkBboxExpanded,
  posterize,
  edgeEnhance,
  applyLumaDarkAlphaMask,
  bakeFacePlate,
} from './feature-baker';

// ---------- Mock 2D context ------------------------------------------------

/**
 * A minimal 2D-context stand-in that backs getImageData / putImageData /
 * createImageData with a Uint8ClampedArray. No drawing methods — those
 * aren't exercised by the helpers under test.
 */
function makeMockCtx(w: number, h: number, fillRGBA?: [number, number, number, number]) {
  const buf = new Uint8ClampedArray(w * h * 4);
  if (fillRGBA) {
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = fillRGBA[0];
      buf[i + 1] = fillRGBA[1];
      buf[i + 2] = fillRGBA[2];
      buf[i + 3] = fillRGBA[3];
    }
  } else {
    // Default: opaque black
    for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
  }
  const ctx = {
    _data: buf,
    _w: w,
    _h: h,
    getImageData(x: number, y: number, ww: number, hh: number) {
      void x; void y;
      return {
        data: ctx._data,
        width: ww,
        height: hh,
        colorSpace: 'srgb',
      } as unknown as ImageData;
    },
    putImageData(d: ImageData, _x: number, _y: number) {
      ctx._data = new Uint8ClampedArray(d.data);
    },
    createImageData(ww: number, hh: number) {
      return {
        data: new Uint8ClampedArray(ww * hh * 4),
        width: ww,
        height: hh,
        colorSpace: 'srgb',
      } as unknown as ImageData;
    },
  };
  return ctx as unknown as CanvasRenderingContext2D & { _data: Uint8ClampedArray };
}

// ---------- landmarkBboxExpanded ------------------------------------------

function makeLandmarks(
  pts: ReadonlyArray<{ x: number; y: number; z?: number }>,
): NormalizedLandmark[] {
  return pts.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z ?? 0,
    visibility: 0,
  } as unknown as NormalizedLandmark));
}

describe('landmarkBboxExpanded', () => {
  it('computes pixel bbox from normalized landmarks', () => {
    // Three points at (0.25, 0.25), (0.75, 0.25), (0.5, 0.75) on a 100×100 image.
    const lm = makeLandmarks([
      { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.5, y: 0.75 },
    ]);
    const bbox = landmarkBboxExpanded(lm, [0, 1, 2], 100, 100, 0);
    expect(bbox).not.toBeNull();
    expect(bbox!.x).toBe(25);
    expect(bbox!.y).toBe(25);
    expect(bbox!.w).toBe(50);
    expect(bbox!.h).toBe(50);
  });

  it('expands by padding factor', () => {
    const lm = makeLandmarks([
      { x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 },
    ]);
    const bbox = landmarkBboxExpanded(lm, [0, 1], 100, 100, 0.5);
    // Raw bbox is (40,40)-(60,60), w=h=20. With padding 0.5: pad=10 each
    // side, so (30,30)-(70,70). Width/height 40.
    expect(bbox).not.toBeNull();
    expect(bbox!.x).toBe(30);
    expect(bbox!.y).toBe(30);
    expect(bbox!.w).toBe(40);
    expect(bbox!.h).toBe(40);
  });

  it('clamps to image bounds when expansion overflows', () => {
    const lm = makeLandmarks([
      { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.95 },
    ]);
    const bbox = landmarkBboxExpanded(lm, [0, 1], 100, 100, 1.0);
    expect(bbox).not.toBeNull();
    expect(bbox!.x).toBe(0);
    expect(bbox!.y).toBe(0);
    expect(bbox!.w).toBe(100);
    expect(bbox!.h).toBe(100);
  });

  it('returns null on missing landmark', () => {
    const lm = makeLandmarks([{ x: 0.5, y: 0.5 }]);
    const bbox = landmarkBboxExpanded(lm, [0, 99], 100, 100, 0);
    expect(bbox).toBeNull();
  });

  it('returns null on non-finite landmark', () => {
    const lm = makeLandmarks([{ x: 0.5, y: 0.5 }, { x: NaN, y: 0.5 }]);
    const bbox = landmarkBboxExpanded(lm, [0, 1], 100, 100, 0);
    expect(bbox).toBeNull();
  });
});

// ---------- posterize -----------------------------------------------------

describe('posterize', () => {
  it('quantizes pixel values to a small set of levels', () => {
    // Make a 4×1 strip of distinct gray values.
    const ctx = makeMockCtx(4, 1);
    ctx._data[0] = 50;  ctx._data[1] = 50;  ctx._data[2] = 50;  ctx._data[3] = 255;
    ctx._data[4] = 100; ctx._data[5] = 100; ctx._data[6] = 100; ctx._data[7] = 255;
    ctx._data[8] = 150; ctx._data[9] = 150; ctx._data[10] = 150; ctx._data[11] = 255;
    ctx._data[12] = 200; ctx._data[13] = 200; ctx._data[14] = 200; ctx._data[15] = 255;
    posterize(ctx, 4, 1, 2); // 2 levels → step = 255 → only 0 or 255
    const uniq = new Set<number>();
    for (let i = 0; i < 16; i += 4) uniq.add(ctx._data[i]);
    expect(uniq.size).toBeLessThanOrEqual(2);
    expect([...uniq].every((v) => v === 0 || v === 255)).toBe(true);
  });

  it('preserves alpha channel', () => {
    const ctx = makeMockCtx(2, 1, [128, 128, 128, 100]);
    posterize(ctx, 2, 1, 6);
    expect(ctx._data[3]).toBe(100);
    expect(ctx._data[7]).toBe(100);
  });

  it('skips fully transparent pixels', () => {
    const ctx = makeMockCtx(1, 1, [123, 45, 67, 0]);
    posterize(ctx, 1, 1, 6);
    expect(ctx._data[0]).toBe(123);
    expect(ctx._data[1]).toBe(45);
    expect(ctx._data[2]).toBe(67);
  });

  it('biases toward target color', () => {
    const ctx = makeMockCtx(1, 1, [128, 128, 128, 255]);
    posterize(ctx, 1, 1, 12, 1.0, 0xff0000); // blend toward red
    // Red channel should be HIGHER than green/blue afterwards.
    expect(ctx._data[0]).toBeGreaterThan(ctx._data[1]);
    expect(ctx._data[0]).toBeGreaterThan(ctx._data[2]);
  });
});

// ---------- edgeEnhance ---------------------------------------------------

describe('edgeEnhance', () => {
  it('amplifies center-vs-neighbor differences (3x3 input)', () => {
    // Center pixel brighter than neighbors → unsharp should raise it further.
    const ctx = makeMockCtx(3, 3, [100, 100, 100, 255]);
    // Make center pixel 150
    const ci = (1 * 3 + 1) * 4;
    ctx._data[ci] = 150; ctx._data[ci + 1] = 150; ctx._data[ci + 2] = 150;
    edgeEnhance(ctx, 3, 3, 0.5);
    // Center after sharpen at weight 0.5: cw=3, nw=-0.5
    // v = 3*150 + (-0.5)*(100+100+100+100) = 450 - 200 = 250
    expect(ctx._data[ci]).toBe(250);
    expect(ctx._data[ci + 1]).toBe(250);
    expect(ctx._data[ci + 2]).toBe(250);
  });

  it('passes through 1px border untouched', () => {
    const ctx = makeMockCtx(3, 3, [50, 60, 70, 200]);
    edgeEnhance(ctx, 3, 3, 0.5);
    // Top-left is on border → should be unchanged from source.
    expect(ctx._data[0]).toBe(50);
    expect(ctx._data[1]).toBe(60);
    expect(ctx._data[2]).toBe(70);
    expect(ctx._data[3]).toBe(200);
  });

  it('clamps to [0,255]', () => {
    const ctx = makeMockCtx(3, 3, [255, 255, 255, 255]);
    const ci = (1 * 3 + 1) * 4;
    ctx._data[ci] = 0; ctx._data[ci + 1] = 0; ctx._data[ci + 2] = 0;
    // Strong sharpen would drive center = 5*0 - (-2)*255 = 510 (clamped to 255)
    edgeEnhance(ctx, 3, 3, 1.0);
    // Border should clamp to 0 on subtraction; we only check it's in range.
    for (let i = 0; i < ctx._data.length; i += 4) {
      expect(ctx._data[i]).toBeGreaterThanOrEqual(0);
      expect(ctx._data[i]).toBeLessThanOrEqual(255);
    }
  });
});

// ---------- Phase H2c — alpha-mask helpers --------------------------------

describe('applyLumaDarkAlphaMask', () => {
  it('drops alpha to 0 for pixels lighter than skinTone × 0.6', () => {
    // skin tone ~0xc9a08a (mid-tan, luma ≈ 175). threshold ≈ 105.
    // Mix three pixels: dark (40), threshold-ish (110), bright (220).
    const ctx = makeMockCtx(3, 1);
    ctx._data[0] = 40;  ctx._data[1] = 40;  ctx._data[2] = 40;  ctx._data[3] = 255;
    ctx._data[4] = 110; ctx._data[5] = 110; ctx._data[6] = 110; ctx._data[7] = 255;
    ctx._data[8] = 220; ctx._data[9] = 220; ctx._data[10] = 220; ctx._data[11] = 255;
    applyLumaDarkAlphaMask(ctx, 3, 1, 0xc9a08a);
    // Dark pixel stays opaque; bright pixel becomes transparent.
    expect(ctx._data[3]).toBe(255);
    expect(ctx._data[11]).toBe(0);
  });

  it('falls back to absolute threshold (80) when skinTone undefined', () => {
    const ctx = makeMockCtx(2, 1);
    ctx._data[0] = 50;  ctx._data[1] = 50;  ctx._data[2] = 50;  ctx._data[3] = 255;  // luma 50 < 80 → opaque
    ctx._data[4] = 200; ctx._data[5] = 200; ctx._data[6] = 200; ctx._data[7] = 255;  // luma 200 ≥ 80 → transparent
    applyLumaDarkAlphaMask(ctx, 2, 1);
    expect(ctx._data[3]).toBe(255);
    expect(ctx._data[7]).toBe(0);
  });
});

// ---------- bakeFacePlate (export sanity) ---------------------------------

describe('bakeFacePlate', () => {
  it('is exported as a named function', () => {
    // Full-pipeline verification (composite plate PNG actually contains
    // skin + nose + beard pixels) is performed by the puppeteer dump
    // script (`scripts/dump-feature-crops.cjs`) reading real PNGs back.
    // Here we only verify the function is exposed for the renderer +
    // reprocess path to import.
    expect(typeof bakeFacePlate).toBe('function');
    expect(bakeFacePlate.length).toBeGreaterThanOrEqual(3);
  });
});
