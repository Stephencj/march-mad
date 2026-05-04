/**
 * 2D-canvas skeleton overlay for the mocap editor.
 *
 * Two callers:
 *   1. Live preview during `startCamera()` — pass the `PoseLandmarkerResult`
 *      from the capture loop along with the underlying `<video>` so we
 *      know the source aspect ratio.
 *   2. Recorded-clip playback ("Play" button) — feeds the same
 *      `landmarks: MpLandmark[]` (image-space) into `drawLandmarks`.
 *
 * The overlay <canvas> sits on top of the <video> and shares its
 * `object-fit: contain` letterboxing, so we project normalized landmarks
 * into the *contained* video rect (not the full canvas).
 */
import type { MpLandmark } from './types';

/** MediaPipe BlazePose 33-keypoint connection list. Hand-rolled to avoid
 *  pulling in `@mediapipe/drawing_utils`. Pairs are indices into the
 *  33-landmark array. */
export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // Face (light scaffolding only — we don't draw all of these).
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  // Torso.
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Left arm.
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // Right arm.
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // Left leg.
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  // Right leg.
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

/** Compute the rectangle the video occupies inside its container under
 *  `object-fit: contain`. */
function containedRect(
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number
): { x: number; y: number; w: number; h: number } {
  if (videoW <= 0 || videoH <= 0) return { x: 0, y: 0, w: containerW, h: containerH };
  const containerAspect = containerW / containerH;
  const videoAspect = videoW / videoH;
  if (videoAspect > containerAspect) {
    const w = containerW;
    const h = containerW / videoAspect;
    return { x: 0, y: (containerH - h) / 2, w, h };
  }
  const h = containerH;
  const w = containerH * videoAspect;
  return { x: (containerW - w) / 2, y: 0, w, h };
}

/** Resize the overlay canvas to its CSS box (DPR-aware). */
export function resizeOverlay(canvas: HTMLCanvasElement): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

export function clearOverlay(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export interface DrawOptions {
  /** Source video width (px) for letterbox math. Pass 0 to draw across the
   *  full canvas (used for the "Play" overlay where there's no video). */
  videoW: number;
  /** Source video height (px). */
  videoH: number;
  /** Skip landmarks below this confidence (0..1). */
  minVisibility?: number;
}

/** Draw the 33-landmark skeleton onto `canvas`. Clears first. */
export function drawLandmarks(
  canvas: HTMLCanvasElement,
  landmarks: ReadonlyArray<MpLandmark> | undefined,
  opts: DrawOptions
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks || landmarks.length === 0) return;

  const minVis = opts.minVisibility ?? 0.3;

  let rect: { x: number; y: number; w: number; h: number };
  if (opts.videoW > 0 && opts.videoH > 0) {
    rect = containedRect(canvas.width, canvas.height, opts.videoW, opts.videoH);
  } else {
    rect = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  }

  const px = (lm: MpLandmark): [number, number] => [
    rect.x + lm.x * rect.w,
    rect.y + lm.y * rect.h,
  ];

  // Bones.
  ctx.strokeStyle = '#e94560';
  ctx.lineWidth = Math.max(2, canvas.width / 480);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [a, b] of POSE_CONNECTIONS) {
    const la = landmarks[a];
    const lb = landmarks[b];
    if (!la || !lb) continue;
    if (la.visibility < minVis || lb.visibility < minVis) continue;
    const [ax, ay] = px(la);
    const [bx, by] = px(lb);
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  }
  ctx.stroke();

  // Joints.
  ctx.fillStyle = '#ffd700';
  const r = Math.max(2.5, canvas.width / 480);
  for (const lm of landmarks) {
    if (lm.visibility < minVis) continue;
    const [x, y] = px(lm);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
