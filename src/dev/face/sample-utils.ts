/**
 * Phase 8.5 — Shared sampling utilities.
 *
 * Common pixel-sampling primitives used by the procedural-face data pipeline
 * (skin tone, lip color, brows, beard, eyelashes, hair/hat). The pattern of
 * "load image → canvas → getImageData → outlier-rejected mean" was first
 * codified in `iris-color.ts`; this module factors the shared code out so
 * each per-feature sampler can stay small and readable.
 *
 * Design notes:
 *  - `loadImageToCanvas` returns a `SampleContext` (canvas + ctx + dims).
 *    `fullData` is intentionally null on creation — we don't allocate the
 *    full ImageData until something actually needs it. Most samplers read
 *    small rectangular regions and never touch fullData.
 *  - `sampleRect` does NOT cache a getImageData call across rect requests
 *    on purpose: the 2D-context API doesn't let us "extend" an existing
 *    ImageData, and sampling regions are small (typically 3..8 pixels per
 *    side), so the per-call cost is dominated by the JS loop, not the
 *    underlying GL upload.
 *  - `medianRGB` vs `meanRGB`: median is far more robust to a single
 *    blemish, beard-hair, or specular highlight in an otherwise-uniform
 *    region (skin patches, lips). Mean is fine when the input is already
 *    filtered (e.g. dark-pixels-only after a luma threshold, where outliers
 *    have already been trimmed).
 */

export interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface SampleContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Cached ImageData for full-image reads. Allocated lazily by the first
   *  caller that asks for it. Most samplers stick to small rectangles and
   *  never trigger this allocation. */
  fullData: ImageData | null;
}

/**
 * Load a data-URL image into a hidden 2D-context canvas at native dims.
 * Throws on load error or zero-sized image — callers wrap in try/catch.
 */
export async function loadImageToCanvas(dataUrl: string): Promise<SampleContext> {
  return new Promise<SampleContext>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w <= 0 || h <= 0) {
        reject(new Error('loadImageToCanvas: zero-sized image'));
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('loadImageToCanvas: 2D context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve({ canvas, ctx, width: w, height: h, fullData: null });
    };
    img.onerror = () => reject(new Error('loadImageToCanvas: image failed to load'));
    img.src = dataUrl;
  });
}

/**
 * Sample a rectangular region around (px, py) with the given half-extent.
 * Returns the array of {r,g,b,a} pixels (truncates at image edges; never
 * out-of-range). Returns an empty array when the region is fully outside
 * the image — caller should treat that as a sampling failure.
 */
export function sampleRect(
  ctx: SampleContext,
  px: number,
  py: number,
  halfExtent: number,
): Pixel[] {
  const x0 = Math.max(0, Math.floor(px - halfExtent));
  const y0 = Math.max(0, Math.floor(py - halfExtent));
  const x1 = Math.min(ctx.width, Math.ceil(px + halfExtent + 1));
  const y1 = Math.min(ctx.height, Math.ceil(py + halfExtent + 1));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return [];
  let imageData: ImageData;
  try {
    imageData = ctx.ctx.getImageData(x0, y0, w, h);
  } catch {
    return [];
  }
  const data = imageData.data;
  const out: Pixel[] = new Array(w * h);
  let idx = 0;
  for (let i = 0; i < data.length; i += 4) {
    out[idx++] = { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  }
  return out;
}

/**
 * Per-channel median, packed into 0xRRGGBB. Robust to single outlier
 * pixels (a stray beard hair, a specular highlight) far better than mean.
 */
export function medianRGB(pixels: Pixel[]): number {
  if (pixels.length === 0) return 0;
  const rs = new Array<number>(pixels.length);
  const gs = new Array<number>(pixels.length);
  const bs = new Array<number>(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    rs[i] = pixels[i].r;
    gs[i] = pixels[i].g;
    bs[i] = pixels[i].b;
  }
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(pixels.length / 2);
  return packColor(rs[mid], gs[mid], bs[mid]);
}

/** Per-channel mean, packed into 0xRRGGBB. */
export function meanRGB(pixels: Pixel[]): number {
  if (pixels.length === 0) return 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of pixels) {
    r += p.r;
    g += p.g;
    b += p.b;
  }
  const n = pixels.length;
  return packColor(Math.round(r / n), Math.round(g / n), Math.round(b / n));
}

/** Pack r,g,b ints (0..255) into a single 0xRRGGBB int. */
export function packColor(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/** Unpack 0xRRGGBB into r,g,b ints. */
export function unpackColor(c: number): { r: number; g: number; b: number } {
  return { r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff };
}

/**
 * Pixel luma (perceptual brightness) using ITU-R BT.601 weights. Returns
 * a value in [0..255] matching the input channel range.
 */
export function pixelLuma(p: Pixel): number {
  return 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
}

/**
 * Local variance (σ²) of luma over a pixel set. Used to distinguish
 * textured regions (beard hair, hairline wisps) from flat shadows.
 */
export function localVariance(pixels: Pixel[]): number {
  if (pixels.length === 0) return 0;
  let sum = 0;
  for (const p of pixels) sum += pixelLuma(p);
  const mean = sum / pixels.length;
  let varSum = 0;
  for (const p of pixels) {
    const d = pixelLuma(p) - mean;
    varSum += d * d;
  }
  return varSum / pixels.length;
}

/** Euclidean color distance between two packed 0xRRGGBB ints. */
export function colorDistance(a: number, b: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const dr = ar - br;
  const dg = ag - bg;
  const db = ab - bb;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Compute mean luma of a pixel set. Skips alpha-rejected pixels. */
export function meanLuma(pixels: Pixel[], alphaMin = 200): number {
  let sum = 0;
  let n = 0;
  for (const p of pixels) {
    if (p.a < alphaMin) continue;
    sum += pixelLuma(p);
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Compute a coarse image-mean luma by sampling a strided grid of pixels.
 *
 * Used in two places:
 *  - skin-tone.ts: as the relative-luma reference for patch rejection (a
 *    patch median darker than 40% of the image mean is treated as a
 *    non-skin region).
 *  - scan.ts: for live-preview lighting feedback during the scan UX.
 *    A scan whose imgMean stays below ~60 for several seconds will
 *    produce unreliable feature samples; warn the user before they
 *    record all 7 angles.
 *
 * Default stride 16 keeps the cost low (~32×32 = 1024 samples on a
 * 512×512 image), which is fine to call once per second from the scan
 * preview loop without affecting framerate.
 */
export function imageMeanLuma(ctx: SampleContext, step = 16): number {
  const samples: Pixel[] = [];
  for (let y = 0; y < ctx.height; y += step) {
    for (let x = 0; x < ctx.width; x += step) {
      const px = sampleRect(ctx, x, y, 0);
      if (px.length > 0) samples.push(px[0]);
    }
  }
  return meanLuma(samples);
}

/**
 * Centroid of an arbitrary set of normalized landmarks. Returns null if
 * any landmark is missing or non-finite.
 */
export function landmarkCentroid(
  landmarks: ReadonlyArray<{ x: number; y: number; z?: number }>,
  indices: ReadonlyArray<number>,
): { x: number; y: number } | null {
  let sx = 0;
  let sy = 0;
  for (const idx of indices) {
    const lm = landmarks[idx];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return null;
    sx += lm.x;
    sy += lm.y;
  }
  return { x: sx / indices.length, y: sy / indices.length };
}

/** Return the bottom-N% of pixels by luma. Used for "darkest 33%" style
 *  filters that pick out hair pixels from a textured patch. */
export function darkestFraction(pixels: Pixel[], fraction: number): Pixel[] {
  if (pixels.length === 0) return [];
  const sorted = pixels.slice().sort((a, b) => pixelLuma(a) - pixelLuma(b));
  const n = Math.max(1, Math.floor(pixels.length * fraction));
  return sorted.slice(0, n);
}

/** clamp helper. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Convert RGB (0..255) to HSV. Returns:
 *   h: hue in degrees [0, 360)
 *   s: saturation [0, 1]
 *   v: value [0, 1]
 *
 * Used for skin / hair filtering: skin sits in a narrow hue band (warm reds /
 * yellows) with moderate saturation, while non-skin (purple shadows, blue
 * walls, brightly-saturated chair fabric) falls outside this range.
 */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) {
      h = ((gn - bn) / d) % 6;
    } else if (max === gn) {
      h = (bn - rn) / d + 2;
    } else {
      h = (rn - gn) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

/**
 * Test whether an RGB color falls in a plausible human-skin HSV range.
 * Hue 0–50° (yellow-orange-red) OR 320–360° (warm reds, includes some
 * olive/brown tones), saturation 5–60%, value 25–95%. Tuned against the
 * captured-data bug where dark-purple background pixels (h~270°, s~7%,
 * v~17%) were leaking into the skin-tone average.
 *
 * Phase H0+: saturation floor lowered from 10% → 5%. Webcams in dim
 * indoor lighting often render skin at s≈0.07–0.12 (genuine skin pixels
 * — the user's failing scan had forehead s=0.09, cheekL s=0.07). The
 * non-skin shadow case the gate was tuned against (rgb(41,38,44),
 * h~270°, s~7%, v~17%) is still rejected by hue (out of warm window)
 * AND value (below 0.25 floor), so the saturation relaxation doesn't
 * regress that. 5% retains a meaningful chroma signal; below that we
 * really are looking at near-gray pixels which are more likely a hat
 * brim / neutral cloth than skin.
 */
export function isSkinHSV(r: number, g: number, b: number): boolean {
  const { h, s, v } = rgbToHsv(r, g, b);
  if (v < 0.25 || v > 0.95) return false;
  if (s < 0.05 || s > 0.6) return false;
  const hueOk = (h >= 0 && h <= 50) || (h >= 320 && h < 360);
  return hueOk;
}

/** Threshold (channel-mean ratio max/min) above which we treat the pixel
 *  set as having a meaningful color cast and apply the gray-world WB
 *  correction. Below this, the cast is mild enough that correcting could
 *  wash out genuine skin chroma; we leave the pixels alone. 1.3 was
 *  chosen so a healthy-skin patch (typical ratio ~1.15–1.25 due to
 *  natural red bias) is left alone, while a webcam with a blue/purple
 *  cast (rMean/bMean inverted, ratio often ≥1.4) gets corrected. */
const WB_CAST_THRESHOLD = 1.3;

/**
 * Per-channel scale factors for a gray-world white-balance correction.
 * `apply` is true when the input set's max/min channel-mean ratio
 * exceeded WB_CAST_THRESHOLD; false means the cast is mild and callers
 * should pass pixels through unchanged. Anchored on green (rScale=1
 * when no correction).
 */
export interface WhiteBalance {
  apply: boolean;
  rScale: number;
  bScale: number;
}

/**
 * Compute gray-world white-balance scale factors from a pixel set.
 *
 * Rationale: many webcams (especially in dim or color-cast lighting)
 * produce a strong blue/purple cast that hue-shifts genuine skin pixels
 * out of the warm range expected by `isSkinHSV` (0-50° or 320-360°). A
 * gray-world assumption — that the average of a SCENE-wide pixel set
 * should be neutral — pulls the channel means together so a downstream
 * skin patch retains its chroma post-correction. (Applying the WB to a
 * single uniform patch instead would just neutralize the patch to gray;
 * skin chroma is recovered ONLY when the scales come from a wider scene
 * sample.)
 *
 * The anchor channel is GREEN: skin is dominantly red→green→blue, but
 * green sits in the middle of the channel-mean ordering for both
 * normal-skin and color-cast cases, so anchoring on green minimizes the
 * luma shift the correction introduces. R and B are scaled toward G.
 */
export function computeWhiteBalance(pixels: Pixel[]): WhiteBalance {
  if (pixels.length === 0) return { apply: false, rScale: 1, bScale: 1 };
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let n = 0;
  for (const p of pixels) {
    if (p.a < 200) continue;
    rSum += p.r;
    gSum += p.g;
    bSum += p.b;
    n++;
  }
  if (n === 0) return { apply: false, rScale: 1, bScale: 1 };
  const rMean = rSum / n;
  const gMean = gSum / n;
  const bMean = bSum / n;
  const maxMean = Math.max(rMean, gMean, bMean);
  const minMean = Math.min(rMean, gMean, bMean);
  // Avoid divide-by-zero on degenerate (all-black) pixel sets.
  if (minMean <= 0) return { apply: false, rScale: 1, bScale: 1 };
  const ratio = maxMean / minMean;
  if (ratio < WB_CAST_THRESHOLD) return { apply: false, rScale: 1, bScale: 1 };
  return {
    apply: true,
    rScale: gMean / Math.max(rMean, 1e-6),
    bScale: gMean / Math.max(bMean, 1e-6),
  };
}

/**
 * Apply gray-world white-balance to a pixel set. Each channel is normalized
 * toward the channel mean of the pixel set, rebalancing color casts.
 * Only modifies pixels if the cast is severe (max channel mean / min
 * channel mean > WB_CAST_THRESHOLD); otherwise returns the input array
 * unchanged.
 *
 * NOTE for callers: applying this to a single uniform patch typically
 * makes the patch gray (since the patch's own mean IS the patch); to
 * retain skin chroma, derive scales from a SCENE-wide pixel set
 * (`computeWhiteBalance(imageGridSamples)`) and apply via
 * `applyWhiteBalanceToPixels(scales, patchPixels)` instead.
 *
 * Returns a NEW array of pixels when correction is applied; returns the
 * input reference unchanged when the cast is mild (no allocation).
 */
export function whiteBalancePixels(pixels: Pixel[]): Pixel[] {
  const wb = computeWhiteBalance(pixels);
  if (!wb.apply) return pixels;
  return applyWhiteBalanceToPixels(wb, pixels);
}

/**
 * Apply pre-computed white-balance scales to a pixel set. Each pixel's
 * R and B channels are scaled toward green and clamped to [0,255]; G and
 * alpha are passed through. When `wb.apply` is false, returns the input
 * reference unchanged (no allocation).
 */
export function applyWhiteBalanceToPixels(wb: WhiteBalance, pixels: Pixel[]): Pixel[] {
  if (!wb.apply) return pixels;
  const out: Pixel[] = new Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    const nr = Math.max(0, Math.min(255, Math.round(p.r * wb.rScale)));
    const nb = Math.max(0, Math.min(255, Math.round(p.b * wb.bScale)));
    out[i] = { r: nr, g: p.g, b: nb, a: p.a };
  }
  return out;
}

/**
 * Sample a strided grid of pixels from the full image and compute the
 * scene-wide gray-world white-balance scales. Used by the skin-tone
 * sampler so per-patch corrections preserve skin chroma. Stride 16 ≈
 * 1024 samples on a 512×512 image — enough for a stable channel mean
 * without scanning every pixel.
 */
export function computeImageWhiteBalance(ctx: SampleContext, step = 16): WhiteBalance {
  const samples: Pixel[] = [];
  for (let y = 0; y < ctx.height; y += step) {
    for (let x = 0; x < ctx.width; x += step) {
      const px = sampleRect(ctx, x, y, 0);
      if (px.length > 0 && px[0].a >= 200) samples.push(px[0]);
    }
  }
  return computeWhiteBalance(samples);
}
