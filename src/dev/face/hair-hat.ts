/**
 * Phase 8.5 — Hair + hat detection (combined module).
 *
 * Sample a 32×8 grid of 3×3 patches across a band above the forehead.
 * Each cell is classified as: skin / candidate-for-hat / candidate-for-hair
 * / background. Then the spatial distribution of hat-positive cells decides
 * "is there a hat?". If a hat is detected, hair is suppressed (hats hide
 * hair). Otherwise the hair distribution is matched against 6 canonical
 * styles.
 *
 * Heuristics here are deliberately simple — Phase D consumes the classified
 * style + dominant color and renders procedural geometry; sub-cell precision
 * isn't useful, but robustness against bad lighting is.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import {
  type SampleContext,
  type Pixel,
  meanRGB,
  packColor,
  unpackColor,
  pixelLuma,
  localVariance,
  colorDistance,
} from './sample-utils';

const GRID_W = 32;
const GRID_H = 8;
const CELL_HALF = 1; // 3×3 patch

const SKIN_COLOR_DIST = 30;
const SKIN_LUMA_FACTOR = 0.8;
const HAT_SATURATION = 0.35;
const HAIR_LUMA_DELTA = 30;
const HAIR_VARIANCE = 10;

type CellKind = 'skin' | 'hat' | 'hair' | 'background' | 'skip';

interface CellInfo {
  kind: CellKind;
  meanColor: number;
  luma: number;
}

export type HairStyle =
  | 'bald'
  | 'receding'
  | 'flat-top'
  | 'afro'
  | 'mohawk'
  | 'headband';

export type HatType = 'cap-forward' | 'cap-backward' | 'beanie';

export interface HairData {
  style: HairStyle;
  color: number;
}

export interface HatData {
  detected: true;
  type: HatType;
  color: number;
}

function readCell(
  ctx: SampleContext,
  cx: number,
  cy: number,
): { pixels: Pixel[]; allInBounds: boolean } {
  const x0 = Math.floor(cx - CELL_HALF);
  const y0 = Math.floor(cy - CELL_HALF);
  const x1 = Math.ceil(cx + CELL_HALF + 1);
  const y1 = Math.ceil(cy + CELL_HALF + 1);
  const inBounds = x0 >= 0 && y0 >= 0 && x1 <= ctx.width && y1 <= ctx.height;
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(ctx.width, x1);
  const cy1 = Math.min(ctx.height, y1);
  const w = cx1 - cx0;
  const h = cy1 - cy0;
  if (w <= 0 || h <= 0) return { pixels: [], allInBounds: false };
  try {
    const data = ctx.ctx.getImageData(cx0, cy0, w, h).data;
    const pixels: Pixel[] = new Array(w * h);
    let i = 0;
    for (let p = 0; p < data.length; p += 4) {
      pixels[i++] = { r: data[p], g: data[p + 1], b: data[p + 2], a: data[p + 3] };
    }
    return { pixels, allInBounds: inBounds };
  } catch {
    return { pixels: [], allInBounds: false };
  }
}

function classifyCell(
  pixels: Pixel[],
  skinTone: number,
  skinLuma: number,
): CellInfo {
  if (pixels.length === 0) {
    return { kind: 'skip', meanColor: 0, luma: 0 };
  }
  let meanA = 0;
  for (const p of pixels) meanA += p.a;
  meanA /= pixels.length;
  if (meanA < 200) return { kind: 'skip', meanColor: 0, luma: 0 };

  let r = 0, g = 0, b = 0;
  for (const p of pixels) {
    r += p.r;
    g += p.g;
    b += p.b;
  }
  const mr = Math.round(r / pixels.length);
  const mg = Math.round(g / pixels.length);
  const mb = Math.round(b / pixels.length);
  const mean = packColor(mr, mg, mb);
  const luma = 0.299 * mr + 0.587 * mg + 0.114 * mb;

  // Skin detection.
  if (
    colorDistance(mean, skinTone) < SKIN_COLOR_DIST &&
    luma > skinLuma * SKIN_LUMA_FACTOR
  ) {
    return { kind: 'skin', meanColor: mean, luma };
  }

  const max = Math.max(mr, mg, mb);
  const min = Math.min(mr, mg, mb);
  const sat = max > 0 ? (max - min) / max : 0;

  if (sat > HAT_SATURATION) {
    return { kind: 'hat', meanColor: mean, luma };
  }

  const variance = localVariance(pixels);
  if (luma < skinLuma - HAIR_LUMA_DELTA && variance > HAIR_VARIANCE) {
    return { kind: 'hair', meanColor: mean, luma };
  }

  return { kind: 'background', meanColor: mean, luma };
}

function classifyHat(
  cells: CellInfo[][],
): { detected: false } | { detected: true; type: HatType } {
  // Look for >50% of grid columns with a hat-positive cell at the same row.
  let bestRow = -1;
  let bestCount = 0;
  for (let row = 0; row < GRID_H; row++) {
    let cnt = 0;
    for (let col = 0; col < GRID_W; col++) {
      if (cells[col][row].kind === 'hat') cnt++;
    }
    if (cnt > bestCount) {
      bestCount = cnt;
      bestRow = row;
    }
  }
  if (bestCount / GRID_W <= 0.5) return { detected: false };

  // Hat type:
  //  - beanie: hat-positive across many rows (vertical real estate)
  //  - cap-forward: hat-positive on a sharp horizontal band, with a slight
  //    extension below (brim) detected as hat-positive cells in lower rows.
  //  - cap-backward: hat band low on forehead (high row index in our grid,
  //    which is forehead-down → hair-up; so "low on forehead" = bottom of
  //    band = highest row index near 7), no clear lower extension.
  let totalHat = 0;
  let rowsWithHat = 0;
  for (let row = 0; row < GRID_H; row++) {
    let cnt = 0;
    for (let col = 0; col < GRID_W; col++) {
      if (cells[col][row].kind === 'hat') cnt++;
    }
    totalHat += cnt;
    if (cnt > GRID_W * 0.3) rowsWithHat++;
  }

  if (rowsWithHat >= 4) return { detected: true, type: 'beanie' };

  // Distinguish cap-forward vs cap-backward by where the hat band sits.
  // Our band runs from above-forehead (row 0) to right above eyebrows
  // (row 7). Cap-forward has its band high (rows 0–2) with brim
  // extending down into rows 3–5. Cap-backward sits low (rows 4–7) with
  // little above.
  let topHat = 0;
  let botHat = 0;
  for (let col = 0; col < GRID_W; col++) {
    for (let row = 0; row < 4; row++) {
      if (cells[col][row].kind === 'hat') topHat++;
    }
    for (let row = 4; row < GRID_H; row++) {
      if (cells[col][row].kind === 'hat') botHat++;
    }
  }
  if (topHat > botHat) return { detected: true, type: 'cap-forward' };
  return { detected: true, type: 'cap-backward' };
}

function classifyHair(cells: CellInfo[][]): HairStyle {
  // Compute per-region hair-positive fractions.
  const colCount = (col: number): number => {
    let c = 0;
    for (let row = 0; row < GRID_H; row++) {
      if (cells[col][row].kind === 'hair') c++;
    }
    return c;
  };
  const rowCount = (row: number): number => {
    let c = 0;
    for (let col = 0; col < GRID_W; col++) {
      if (cells[col][row].kind === 'hair') c++;
    }
    return c;
  };

  let totalHair = 0;
  for (let col = 0; col < GRID_W; col++) totalHair += colCount(col);

  const totalCells = GRID_W * GRID_H;

  // Center 50%: cols 8..23
  let centerHair = 0;
  for (let col = 8; col < 24; col++) centerHair += colCount(col);
  const centerFrac = centerHair / (16 * GRID_H);

  // Left 25%: cols 0..7, Right 25%: cols 24..31.
  let leftHair = 0;
  let rightHair = 0;
  for (let col = 0; col < 8; col++) leftHair += colCount(col);
  for (let col = 24; col < GRID_W; col++) rightHair += colCount(col);
  const leftFrac = leftHair / (8 * GRID_H);
  const rightFrac = rightHair / (8 * GRID_H);

  // Center 30%: cols 11..20
  let cMidHair = 0;
  for (let col = 11; col < 21; col++) cMidHair += colCount(col);
  const cMidFrac = cMidHair / (10 * GRID_H);
  let sideHair = 0;
  for (let col = 0; col < 11; col++) sideHair += colCount(col);
  for (let col = 21; col < GRID_W; col++) sideHair += colCount(col);
  const sideFrac = sideHair / (21 * GRID_H);

  // bald
  if (centerFrac < 0.10) return 'bald';

  // mohawk: center 30% strong, sides weak.
  if (cMidFrac > 0.4 && sideFrac < 0.15) return 'mohawk';

  // receding (M-shape): left & right strong, center weak.
  if (leftFrac > 0.3 && rightFrac > 0.3 && centerFrac < 0.2) return 'receding';

  // headband: 1-2 rows of hair-positive sandwiched by skin/background.
  let hairRowCount = 0;
  let firstHairRow = -1;
  let lastHairRow = -1;
  for (let row = 0; row < GRID_H; row++) {
    const rc = rowCount(row);
    if (rc > GRID_W * 0.5) {
      hairRowCount++;
      if (firstHairRow < 0) firstHairRow = row;
      lastHairRow = row;
    }
  }
  if (hairRowCount >= 1 && hairRowCount <= 2 && firstHairRow > 0 && lastHairRow < GRID_H - 1) {
    // confirm above + below are mostly skin/bg
    const above = rowCount(firstHairRow - 1);
    const below = rowCount(lastHairRow + 1);
    if (above < GRID_W * 0.3 && below < GRID_W * 0.3) {
      return 'headband';
    }
  }

  // flat-top: dense hair across the top row.
  if (rowCount(0) > GRID_W * 0.7 && totalHair / totalCells > 0.4) {
    return 'flat-top';
  }

  // afro: dense across all rows.
  let denseRows = 0;
  for (let row = 0; row < GRID_H; row++) {
    if (rowCount(row) > GRID_W * 0.5) denseRows++;
  }
  if (denseRows >= 5) return 'afro';

  // No clear match → fall back to bald.
  return 'bald';
}

function meanColorOfKind(cells: CellInfo[][], kind: CellKind): number {
  let r = 0, g = 0, b = 0, n = 0;
  for (let col = 0; col < GRID_W; col++) {
    for (let row = 0; row < GRID_H; row++) {
      if (cells[col][row].kind !== kind) continue;
      const c = unpackColor(cells[col][row].meanColor);
      r += c.r;
      g += c.g;
      b += c.b;
      n++;
    }
  }
  if (n === 0) return packColor(0, 0, 0);
  return packColor(Math.round(r / n), Math.round(g / n), Math.round(b / n));
}

export function detectHairAndHat(
  ctx: SampleContext,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  faceBbox: { left: number; top: number; right: number; bottom: number } | null,
  skinTone: number | null,
): { hair?: HairData; hat?: HatData } {
  if (skinTone === null || skinTone === undefined) return {};
  if (!faceBbox) return {};
  if (!landmarks || landmarks.length < 478) return {};

  const lm10 = landmarks[10];
  const lm103 = landmarks[103];
  const lm332 = landmarks[332];
  if (!lm10 || !lm103 || !lm332) return {};

  // Band y from (lm10.y - 0.10) to (lm10.y - 0.02), x from lm103.x to lm332.x.
  const yTopN = lm10.y - 0.10;
  const yBotN = lm10.y - 0.02;
  const xLeftN = Math.min(lm103.x, lm332.x);
  const xRightN = Math.max(lm103.x, lm332.x);

  // Bound check — fully off-image → bail.
  if (yBotN <= 0 || xLeftN >= 1 || xRightN <= 0) return {};

  const yT = Math.max(0, yTopN) * ctx.height;
  const yB = Math.min(1, yBotN) * ctx.height;
  const xL = Math.max(0, xLeftN) * ctx.width;
  const xR = Math.min(1, xRightN) * ctx.width;
  if (yB - yT < GRID_H || xR - xL < GRID_W) return {};

  const skin = unpackColor(skinTone);
  const skinLuma = 0.299 * skin.r + 0.587 * skin.g + 0.114 * skin.b;

  // Build cells[col][row] grid.
  const cells: CellInfo[][] = new Array(GRID_W);
  for (let col = 0; col < GRID_W; col++) {
    cells[col] = new Array(GRID_H);
    for (let row = 0; row < GRID_H; row++) {
      const cx = xL + ((col + 0.5) / GRID_W) * (xR - xL);
      const cy = yT + ((row + 0.5) / GRID_H) * (yB - yT);
      // Bound the cell read to image edges; skip cells that fully fall out.
      if (cx < 0 || cx >= ctx.width || cy < 0 || cy >= ctx.height) {
        cells[col][row] = { kind: 'skip', meanColor: 0, luma: 0 };
        continue;
      }
      const { pixels } = readCell(ctx, cx, cy);
      cells[col][row] = classifyCell(pixels, skinTone, skinLuma);
    }
  }

  const hatVerdict = classifyHat(cells);
  if (hatVerdict.detected) {
    const color = meanColorOfKind(cells, 'hat');
    return {
      hat: { detected: true, type: hatVerdict.type, color },
    };
  }

  // No hat → classify hair style + sample color from hair-positive cells.
  const style = classifyHair(cells);
  const color = meanColorOfKind(cells, 'hair');
  return { hair: { style, color } };
}
