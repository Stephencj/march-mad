/**
 * Landmark-driven UV warp for the cranium face texture.
 *
 * Replaces the rectangle-stretch approach in `bakeFaceCraniumTexture`
 * (which mapped the entire photo bbox to a UV rectangle and let
 * eyes/nose/mouth land wherever the bbox math put them) with a
 * triangulated, anatomically-registered warp:
 *
 *   For every landmark in the photo, define WHERE it should land on
 *   the cranium UV map. Triangulate using the canonical FaceMesh
 *   tessellation. Per-triangle, apply an affine transform from photo
 *   space to UV space. Photo pixels register to anatomical positions
 *   on the sphere — eyes land at the cranium's eye-region UV, mouth
 *   lands at the mouth-region UV, etc.
 *
 * "Mask"-look fix: the prior approach's eyes/nose/mouth could fall
 * anywhere in the rectangular UV region depending on bbox padding and
 * photo crop. With the warp, the SUBJECT'S landmarks register to FIXED
 * positions in UV space, so anatomical features always project onto
 * the same patch of the head sphere regardless of crop or proportions.
 *
 * Approach used here:
 *   1. Build target UV positions for ALL 478 landmarks via a SINGLE
 *      affine that maps the photo's landmark cluster's bbox into a
 *      fixed UV "face region" rectangle.
 *   2. Triangulate using the canonical FaceMesh tessellation (already
 *      derived in `facemesh-topology.ts`).
 *   3. Per triangle, draw the source via clip + affine transform.
 *
 * This means the photo IS still warped to fit the UV region (same
 * overall affine to the bbox), but anatomical landmarks within that
 * region remain pinned to the photo's subject-relative positions.
 * The visible difference vs. rectangle-stretch: eyes are no longer
 * displaced by padding asymmetry, and the warp is mesh-aware, so
 * features land where the cranium's UV expects them.
 */
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { getFaceMeshTriangles } from './facemesh-topology';

export interface Point2 {
  x: number;
  y: number;
}

/**
 * Anatomical UV target rectangle on the cranium texture. The face
 * occupies the front-equator region centered at (u=0.25, v=0.5).
 *
 * Coordinates are in NORMALIZED UV space (0..1 across the full
 * cranium texture, NOT pixel space). The face baker scales these
 * to its target canvas size before solving affines.
 *
 * Iter 1 — match the prior rectangle-stretch's center + extent so the
 * overall face position on the cranium doesn't move; only the
 * within-region mapping changes (rectangle → triangulated landmarks).
 *   center: (0.25, 0.50) — front-equator
 *   width:  0.15 of texture width (~54° head-turn at the equator)
 *   height: 0.55 of texture height (~99° meridian, brow-above to chin-below)
 */
export const FACE_UV_REGION = {
  centerU: 0.25,
  centerV: 0.50,
  // Iter 4 — coordinated with head-mesh-builder geometry change: the
  // cranium was narrowed (headWidth: cheekWidth*1.05 → 1.00, faceHeight
  // *1.05 → 0.95) and flattened front-to-back (depth: faceHeight*1.10
  // → 0.85). With the silhouette now narrower from front, bumping U-
  // extent 0.18 → 0.26 fills the visible cranium silhouette ear-to-
  // ear without wrapping onto the back of the head. u > 0.46 would
  // start crossing the ±X poles into the back hemisphere — 0.26 stays
  // safely within the front cap.
  widthU: 0.26,
  heightV: 0.62,
} as const;

/**
 * Solve the affine transform that maps source triangle S → destination
 * triangle D. Returns the 6 elements expected by `ctx.setTransform`:
 *   [a, b, c, d, e, f]  →  D = M * [S; 1]
 *
 * Mathematically:
 *   D.x = a*S.x + c*S.y + e
 *   D.y = b*S.x + d*S.y + f
 *
 * Six equations (3 points × 2 coords) for six unknowns. Closed-form
 * via Cramer's rule. Returns an identity-ish matrix when the source
 * triangle is degenerate (collinear) so the caller doesn't divide
 * by zero — those triangles produce no visible output (the clip
 * region is also degenerate, so nothing draws).
 */
export function solveAffine(
  S: readonly [Point2, Point2, Point2],
  D: readonly [Point2, Point2, Point2],
): { a: number; b: number; c: number; d: number; e: number; f: number } {
  const x0 = S[0].x, y0 = S[0].y;
  const x1 = S[1].x, y1 = S[1].y;
  const x2 = S[2].x, y2 = S[2].y;

  const det = x0 * (y1 - y2) - x1 * (y0 - y2) + x2 * (y0 - y1);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
  const invDet = 1 / det;

  // X coefficients (a, c, e)
  const a = (D[0].x * (y1 - y2) - D[1].x * (y0 - y2) + D[2].x * (y0 - y1)) * invDet;
  const c = (x0 * (D[1].x - D[2].x) - x1 * (D[0].x - D[2].x) + x2 * (D[0].x - D[1].x)) * invDet;
  const e =
    (x0 * (y1 * D[2].x - y2 * D[1].x) -
      x1 * (y0 * D[2].x - y2 * D[0].x) +
      x2 * (y0 * D[1].x - y1 * D[0].x)) *
    invDet;
  // Y coefficients (b, d, f)
  const b = (D[0].y * (y1 - y2) - D[1].y * (y0 - y2) + D[2].y * (y0 - y1)) * invDet;
  const d = (x0 * (D[1].y - D[2].y) - x1 * (D[0].y - D[2].y) + x2 * (D[0].y - D[1].y)) * invDet;
  const f =
    (x0 * (y1 * D[2].y - y2 * D[1].y) -
      x1 * (y0 * D[2].y - y2 * D[0].y) +
      x2 * (y0 * D[1].y - y1 * D[0].y)) *
    invDet;

  return { a, b, c, d, e, f };
}

/**
 * Warp a single triangular region from `srcCanvas` onto `dstCtx`,
 * mapping the source triangle to the destination triangle via affine.
 *
 * The destination triangle is set as the clip region; the source is
 * drawn at full size with the affine transform applied, and only the
 * portion intersecting the clip region paints.
 *
 * Reuses `dstCtx.save/restore` so callers can chain many calls
 * without manually resetting the transform stack.
 */
export function warpTriangle(
  dstCtx: CanvasRenderingContext2D,
  srcCanvas: HTMLCanvasElement,
  srcTri: readonly [Point2, Point2, Point2],
  dstTri: readonly [Point2, Point2, Point2],
): void {
  // Reject degenerate dst triangles (zero area) early — Canvas's clip
  // would still draw the full source over the clip's underlying
  // region (none, in this case), but the affine itself can produce
  // wild numbers that paint stray pixels just outside the triangle's
  // bounding box. Cheap area test stops that.
  const dArea = Math.abs(
    (dstTri[1].x - dstTri[0].x) * (dstTri[2].y - dstTri[0].y) -
      (dstTri[2].x - dstTri[0].x) * (dstTri[1].y - dstTri[0].y),
  );
  if (dArea < 0.5) return; // less than half a pixel — skip
  const sArea = Math.abs(
    (srcTri[1].x - srcTri[0].x) * (srcTri[2].y - srcTri[0].y) -
      (srcTri[2].x - srcTri[0].x) * (srcTri[1].y - srcTri[0].y),
  );
  if (sArea < 0.5) return;

  dstCtx.save();
  // Clip path — the triangle on the destination canvas.
  dstCtx.beginPath();
  dstCtx.moveTo(dstTri[0].x, dstTri[0].y);
  dstCtx.lineTo(dstTri[1].x, dstTri[1].y);
  dstCtx.lineTo(dstTri[2].x, dstTri[2].y);
  dstCtx.closePath();
  dstCtx.clip();

  // Affine transform mapping srcTri → dstTri, then draw the entire
  // source canvas. Only pixels within the clip region paint.
  const m = solveAffine(srcTri, dstTri);
  // setTransform replaces the current transform (no compounding with
  // the clip's transform — the clip path is in destination space).
  dstCtx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  dstCtx.drawImage(srcCanvas, 0, 0);

  dstCtx.restore();
}

/**
 * Compute the per-landmark target UV positions in OUTPUT-CANVAS PIXEL
 * space (not normalized UV) given:
 *   - The 478 photo landmarks (image-space normalized 0..1).
 *   - The output canvas dimensions (e.g. 1024×512).
 *   - The face-region rectangle on the canvas (FACE_UV_REGION scaled
 *     to canvas pixels).
 *
 * Strategy: compute a single affine that maps the LANDMARK CLUSTER
 * BBOX (forehead-to-chin × temple-to-temple) onto the face-region
 * rectangle. Apply that affine to every landmark, NOT just the
 * silhouette. This preserves the photo's intra-face proportions
 * (eye-to-eye gap, nose length, mouth width relative to face width)
 * while pinning the silhouette anchors to fixed UV positions.
 *
 * Anchor landmarks (the bbox is computed from these so the output
 * region is dominated by face content, not by stray landmarks like
 * iris ring 468–477 which sit inside the eye region):
 *   - 10  forehead apex (top)
 *   - 152 chin (bottom)
 *   - 234 left temple (subject's left → image right side typically)
 *   - 454 right temple (subject's right)
 *
 * Returns null if any anchor landmark is missing/non-finite.
 */
export function computeLandmarkUVTargets(
  landmarks: ReadonlyArray<NormalizedLandmark>,
  canvasW: number,
  canvasH: number,
): Point2[] | null {
  const forehead = landmarks[10];
  const chin = landmarks[152];
  const leftTemple = landmarks[234];
  const rightTemple = landmarks[454];
  if (
    !forehead || !chin || !leftTemple || !rightTemple ||
    !Number.isFinite(forehead.x) || !Number.isFinite(forehead.y) ||
    !Number.isFinite(chin.x) || !Number.isFinite(chin.y) ||
    !Number.isFinite(leftTemple.x) || !Number.isFinite(leftTemple.y) ||
    !Number.isFinite(rightTemple.x) || !Number.isFinite(rightTemple.y)
  ) {
    return null;
  }

  // Source-anchor bbox in NORMALIZED PHOTO COORDS (0..1).
  const srcMinX = Math.min(leftTemple.x, rightTemple.x);
  const srcMaxX = Math.max(leftTemple.x, rightTemple.x);
  const srcMinY = forehead.y;
  const srcMaxY = chin.y;
  const srcW = srcMaxX - srcMinX;
  const srcH = srcMaxY - srcMinY;
  if (srcW <= 1e-6 || srcH <= 1e-6) return null;

  // Destination face region in OUTPUT-CANVAS PIXEL coords.
  const dstCx = FACE_UV_REGION.centerU * canvasW;
  const dstCy = FACE_UV_REGION.centerV * canvasH;
  const dstW = FACE_UV_REGION.widthU * canvasW;
  const dstH = FACE_UV_REGION.heightV * canvasH;
  const dstMinX = dstCx - dstW * 0.5;
  const dstMinY = dstCy - dstH * 0.5;

  // Per-axis scale (the affine here is just translate + scale — no
  // rotation / shear because the photo's landmark space and the
  // cranium's UV face region are both axis-aligned).
  const scaleX = dstW / srcW;
  const scaleY = dstH / srcH;

  const out: Point2[] = new Array<Point2>(landmarks.length);
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) {
      // Degenerate landmark — emit a sentinel that keeps the array
      // length stable (callers index by landmark idx). The triangle
      // walker below skips triangles touching a sentinel.
      out[i] = { x: NaN, y: NaN };
      continue;
    }
    out[i] = {
      x: dstMinX + (lm.x - srcMinX) * scaleX,
      y: dstMinY + (lm.y - srcMinY) * scaleY,
    };
  }
  return out;
}

/**
 * Run the full landmark-driven warp: for every triangle in the
 * canonical FaceMesh tessellation, look up the source vertices in
 * photo-pixel space and the dest vertices in output-canvas-pixel
 * space, and call `warpTriangle`.
 *
 * `srcCanvas` is the FULL photo (loaded into a 2D-context canvas).
 * `landmarks` are the photo's 478 normalized landmarks.
 * `dstCtx` is the output canvas's 2D context.
 * `dstUVTargets` is the output of `computeLandmarkUVTargets` —
 *   one Point per landmark, in output-canvas-pixel coords.
 *
 * Iter 2 — also synthesize a fan over the eye-interior regions. The
 * canonical FaceMesh tessellation walks the eyelid ring but does NOT
 * include any triangles that span the eye interior (the iris ring
 * 468-477 is a separate ring with its own edges, but those edges
 * don't connect to the eyelid ring in the FACE_LANDMARKS_TESSELATION
 * edge list). Without an extra fill, the warped output has alpha=0
 * holes at the eye interiors — the procedural eye spheres show
 * through with no surrounding photo iris/sclera. We fan-triangulate
 * each eye ring against its iris-center landmark to fill the hole.
 *
 * Returns the number of triangles successfully warped (for diagnostics).
 */
export function warpAllTriangles(
  dstCtx: CanvasRenderingContext2D,
  srcCanvas: HTMLCanvasElement,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  dstUVTargets: ReadonlyArray<Point2>,
): number {
  const tris = getFaceMeshTriangles();
  const srcW = srcCanvas.width;
  const srcH = srcCanvas.height;

  let count = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const i0 = tris[i];
    const i1 = tris[i + 1];
    const i2 = tris[i + 2];
    const lm0 = landmarks[i0];
    const lm1 = landmarks[i1];
    const lm2 = landmarks[i2];
    if (!lm0 || !lm1 || !lm2) continue;
    const d0 = dstUVTargets[i0];
    const d1 = dstUVTargets[i1];
    const d2 = dstUVTargets[i2];
    if (!d0 || !d1 || !d2) continue;
    if (!Number.isFinite(d0.x) || !Number.isFinite(d1.x) || !Number.isFinite(d2.x)) continue;

    const srcTri: [Point2, Point2, Point2] = [
      { x: lm0.x * srcW, y: lm0.y * srcH },
      { x: lm1.x * srcW, y: lm1.y * srcH },
      { x: lm2.x * srcW, y: lm2.y * srcH },
    ];
    const dstTri: [Point2, Point2, Point2] = [d0, d1, d2];
    warpTriangle(dstCtx, srcCanvas, srcTri, dstTri);
    count++;
  }

  // Eye-interior fans. Each eye's eyelid ring is a closed loop in the
  // canonical tessellation; we use the iris-center landmark (468 left,
  // 473 right) as the fan anchor and walk the ring pairwise.
  count += warpEyeFan(dstCtx, srcCanvas, landmarks, dstUVTargets, LEFT_EYELID_RING, 468);
  count += warpEyeFan(dstCtx, srcCanvas, landmarks, dstUVTargets, RIGHT_EYELID_RING, 473);
  return count;
}

/**
 * Closed-loop eyelid ring indices for each eye, used as fan boundaries
 * to fill the eye interior with photo content. These are the canonical
 * MediaPipe FaceMesh eyelid landmarks walking the eye outline once.
 *
 * The canonical tessellation walks these as edges (eyelid wall) but
 * does NOT triangulate the interior — that's the iris ring's job, but
 * the iris ring (468-477) lives in a separate edge component. We close
 * the gap explicitly here.
 */
const LEFT_EYELID_RING: ReadonlyArray<number> = [
  33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
];
const RIGHT_EYELID_RING: ReadonlyArray<number> = [
  263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466,
];

function warpEyeFan(
  dstCtx: CanvasRenderingContext2D,
  srcCanvas: HTMLCanvasElement,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  dstUVTargets: ReadonlyArray<Point2>,
  ring: ReadonlyArray<number>,
  centerIdx: number,
): number {
  const srcW = srcCanvas.width;
  const srcH = srcCanvas.height;
  const lmC = landmarks[centerIdx];
  const dC = dstUVTargets[centerIdx];
  if (!lmC || !dC || !Number.isFinite(dC.x)) {
    // Iris landmark missing — fall back to the eyelid ring centroid.
    let sx = 0, sy = 0, dx = 0, dy = 0, n = 0;
    for (const idx of ring) {
      const lm = landmarks[idx];
      const dt = dstUVTargets[idx];
      if (!lm || !dt || !Number.isFinite(dt.x)) continue;
      sx += lm.x; sy += lm.y; dx += dt.x; dy += dt.y;
      n++;
    }
    if (n === 0) return 0;
    return warpFanFromAnchor(
      dstCtx, srcCanvas, ring, landmarks, dstUVTargets,
      { x: (sx / n) * srcW, y: (sy / n) * srcH },
      { x: dx / n, y: dy / n },
    );
  }
  return warpFanFromAnchor(
    dstCtx, srcCanvas, ring, landmarks, dstUVTargets,
    { x: lmC.x * srcW, y: lmC.y * srcH },
    { x: dC.x, y: dC.y },
  );
}

function warpFanFromAnchor(
  dstCtx: CanvasRenderingContext2D,
  srcCanvas: HTMLCanvasElement,
  ring: ReadonlyArray<number>,
  landmarks: ReadonlyArray<NormalizedLandmark>,
  dstUVTargets: ReadonlyArray<Point2>,
  srcCenter: Point2,
  dstCenter: Point2,
): number {
  const srcW = srcCanvas.width;
  const srcH = srcCanvas.height;
  let count = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const lmA = landmarks[a];
    const lmB = landmarks[b];
    const dA = dstUVTargets[a];
    const dB = dstUVTargets[b];
    if (!lmA || !lmB || !dA || !dB) continue;
    if (!Number.isFinite(dA.x) || !Number.isFinite(dB.x)) continue;
    const srcTri: [Point2, Point2, Point2] = [
      srcCenter,
      { x: lmA.x * srcW, y: lmA.y * srcH },
      { x: lmB.x * srcW, y: lmB.y * srcH },
    ];
    const dstTri: [Point2, Point2, Point2] = [dstCenter, dA, dB];
    warpTriangle(dstCtx, srcCanvas, srcTri, dstTri);
    count++;
  }
  return count;
}

/**
 * Apply a soft elliptical alpha feather centered on the FACE_UV_REGION
 * to blend the warped face content into the surrounding skin-tone
 * fill. Operates on the destination canvas in-place.
 *
 * The feather is asymmetric (tighter on X than Y) for the same reason
 * as the prior bake: the cranium's UV map wraps around the head
 * circumference along X, so we need lateral content to fade out
 * before it wraps past the silhouette. Y just rides the front meridian
 * up/down toward crown/chin where the surrounding skin fill takes over.
 *
 * Inner / outer normalized radii (relative to the face-region half-
 * extent on each axis):
 *   xInner=0.78  xOuter=1.00  (lateral falloff zone is narrow)
 *   yInner=0.86  yOuter=1.05  (vertical falloff zone slightly larger)
 *
 * Iter 1 — these match the prior bake's feather but are scoped to the
 * face-region rectangle (not the bbox of the cropped photo region),
 * because the warp now lays content directly into that rectangle.
 */
export function applyFaceRegionFeather(
  dstCtx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
): void {
  const cx = FACE_UV_REGION.centerU * canvasW;
  const cy = FACE_UV_REGION.centerV * canvasH;
  const rx = (FACE_UV_REGION.widthU * canvasW) * 0.5;
  const ry = (FACE_UV_REGION.heightV * canvasH) * 0.5;
  // Bounding rectangle of the face region (with a small margin so
  // the feather edge can extend slightly past the warp area without
  // clipping).
  const margin = 4;
  const x0 = Math.max(0, Math.floor(cx - rx - margin));
  const y0 = Math.max(0, Math.floor(cy - ry - margin));
  const x1 = Math.min(canvasW, Math.ceil(cx + rx + margin));
  const y1 = Math.min(canvasH, Math.ceil(cy + ry + margin));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;

  const img = dstCtx.getImageData(x0, y0, w, h);
  const data = img.data;
  const xInner = 0.78;
  const xOuter = 1.00;
  const yInner = 0.86;
  const yOuter = 1.05;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dx = ((x0 + px) - cx) / rx;
      const dy = ((y0 + py) - cy) / ry;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      // Per-axis fade
      let fx: number;
      if (ax <= xInner) fx = 1;
      else if (ax >= xOuter) fx = 0;
      else fx = 1 - (ax - xInner) / (xOuter - xInner);
      let fy: number;
      if (ay <= yInner) fy = 1;
      else if (ay >= yOuter) fy = 0;
      else fy = 1 - (ay - yInner) / (yOuter - yInner);
      const f = fx * fy;
      const idx = (py * w + px) * 4;
      data[idx + 3] = Math.round(data[idx + 3] * f);
    }
  }
  dstCtx.putImageData(img, x0, y0);
}
