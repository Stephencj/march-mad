/**
 * MediaPipe FaceLandmarker + getUserMedia wrapper for face-image capture.
 *
 * Mirrors the patterns in `../mocap/capture.ts` (FilesetResolver, GPU→CPU
 * fallback via `describeError`, WASM vendored at `/mocap-wasm`) but uses
 * FaceLandmarker instead of PoseLandmarker.
 *
 * Phase 7: snapshot from webcam OR process uploaded still → cropped square
 * PNG data URL with optional face bounding box. No live blendshape stream
 * — Phase 8 adds that.
 */
import {
  FilesetResolver,
  FaceLandmarker,
  type FaceLandmarkerResult,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import type { FaceImage } from './types';

/** Vendored model — face_landmarker float16 v1. The bucket uses versioned
 *  paths (`/1/`); `/latest/` 404s. Same convention as mocap/capture.ts. */
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** WASM bundle is vendored into `public/mocap-wasm/` and reused by both the
 *  pose and face tasks (the Vision-Tasks WASM bundle is shared). */
const WASM_URL = '/mocap-wasm';

/** Crop-padding ratios (relative to the detected core-face bbox). Tight,
 *  because the bbox is computed from a curated 4-landmark "core face" set
 *  (forehead apex, chin, left/right cheek edges) — not the full 478-point
 *  mesh, which already wraps the head silhouette. Top has a touch more for
 *  hairline; sides are minimal (ears + sliver of context). Exported so the
 *  live overlay in face-editor.ts can stay in sync. */
export const FACE_CROP_PAD_TOP = 0.18;
export const FACE_CROP_PAD_BOTTOM = 0.08;
export const FACE_CROP_PAD_SIDES = 0.06;

/** Canonical FaceMesh landmark indices for the "core face" bbox. We use
 *  exactly four points to avoid the head-silhouette outer ring that the
 *  full landmark set traces:
 *    10  — forehead apex (top of skin face, just below hairline)
 *    152 — chin tip
 *    234 — left cheek / ear-side edge
 *    454 — right cheek / ear-side edge
 *  Exported so face-editor.ts can draw an overlay rectangle from the same
 *  source. Indices are stable in MediaPipe FaceLandmarker (478-pt mesh). */
export const CORE_FACE_LANDMARK_INDICES = {
  forehead: 10,
  chin: 152,
  left: 234,
  right: 454,
} as const;

/** MediaPipe sometimes rejects with raw `Event` objects (see mocap/capture.ts
 *  for context). Pull anything useful out instead of "[object Event]". */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const ev = err as {
      type?: string;
      message?: string;
      target?: { src?: string; responseURL?: string; status?: number };
    };
    const parts: string[] = [];
    if (ev.type) parts.push(`event=${ev.type}`);
    if (ev.message) parts.push(`msg=${ev.message}`);
    if (ev.target?.src) parts.push(`src=${ev.target.src}`);
    if (ev.target?.responseURL) parts.push(`url=${ev.target.responseURL}`);
    if (typeof ev.target?.status === 'number') parts.push(`status=${ev.target.status}`);
    if (parts.length) return parts.join(' ');
  }
  return String(err);
}

/** Per-frame preview callback — drives the bbox overlay in face-editor. */
export type FacePreviewCallback = (
  result: FaceLandmarkerResult,
  videoEl: HTMLVideoElement,
) => void;

interface VideoFrameCallbackHandle {
  cancel: () => void;
}

function eachVideoFrame(
  videoEl: HTMLVideoElement,
  cb: () => void,
): VideoFrameCallbackHandle {
  const v = videoEl as unknown as {
    requestVideoFrameCallback?: (cb: () => void) => number;
    cancelVideoFrameCallback?: (handle: number) => void;
  };
  let cancelled = false;
  if (typeof v.requestVideoFrameCallback === 'function') {
    let handle = 0;
    const tick = () => {
      if (cancelled) return;
      cb();
      handle = v.requestVideoFrameCallback!(tick);
    };
    handle = v.requestVideoFrameCallback(tick);
    return {
      cancel: () => {
        cancelled = true;
        if (typeof v.cancelVideoFrameCallback === 'function') {
          v.cancelVideoFrameCallback(handle);
        }
      },
    };
  }
  let raf = 0;
  const tick = () => {
    if (cancelled) return;
    cb();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    },
  };
}

/** Compute the "core face" bbox in 0..1 image-space coords using exactly
 *  four canonical FaceMesh indices (see CORE_FACE_LANDMARK_INDICES).
 *  Avoids the head-silhouette outer ring that the full 478-pt mesh traces.
 *  Returns null on missing/invalid landmarks. Exported so face-editor.ts
 *  can draw the same bbox in its preview overlay. */
export function coreFaceBoundingBox(
  landmarks: ReadonlyArray<NormalizedLandmark>,
): { left: number; top: number; right: number; bottom: number } | null {
  if (!landmarks || landmarks.length === 0) return null;
  const fore = landmarks[CORE_FACE_LANDMARK_INDICES.forehead];
  const chin = landmarks[CORE_FACE_LANDMARK_INDICES.chin];
  const left = landmarks[CORE_FACE_LANDMARK_INDICES.left];
  const right = landmarks[CORE_FACE_LANDMARK_INDICES.right];
  if (!fore || !chin || !left || !right) return null;
  // Be defensive — if the four points come back in a flipped configuration
  // (rare with profile faces), use min/max instead of trusting roles.
  const minX = Math.min(left.x, right.x);
  const maxX = Math.max(left.x, right.x);
  const minY = Math.min(fore.y, chin.y);
  const maxY = Math.max(fore.y, chin.y);
  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return null;
  }
  return { left: minX, top: minY, right: maxX, bottom: maxY };
}

/** Pad a 0..1 bbox by the configured top/bottom/sides ratios, then expand
 *  to a square that fits within [0,1]^2. The smaller axis grows to match the
 *  larger; when the *vertical* axis is the smaller (rare with the core-face
 *  bbox, but possible for very wide faces / profile shots), growth is split
 *  50/50 — but when the *horizontal* axis grows, the asymmetric vertical
 *  bias does NOT apply (only horizontal centering). When height grows,
 *  70% of the extra goes to the top (forehead) and 30% to the bottom — we
 *  want extra room above the forehead, not chest dragged into frame.
 *  Returns image-space pixel coords; (0,0) is top-left. */
export function padToSquarePixels(
  bbox: { left: number; top: number; right: number; bottom: number },
  imageW: number,
  imageH: number,
): { x: number; y: number; size: number } {
  // Pad in 0..1 coords.
  const w = bbox.right - bbox.left;
  const h = bbox.bottom - bbox.top;
  let left = Math.max(0, bbox.left - w * FACE_CROP_PAD_SIDES);
  let right = Math.min(1, bbox.right + w * FACE_CROP_PAD_SIDES);
  let top = Math.max(0, bbox.top - h * FACE_CROP_PAD_TOP);
  let bottom = Math.min(1, bbox.bottom + h * FACE_CROP_PAD_BOTTOM);

  // Convert to source-pixel space.
  let px = left * imageW;
  let py = top * imageH;
  let pw = (right - left) * imageW;
  let ph = (bottom - top) * imageH;

  // Squaring step. Grow the smaller axis to match the larger.
  const size = Math.max(pw, ph);

  if (ph < size) {
    // Vertical is the smaller axis — grow height. Bias growth 70% top / 30%
    // bottom so the forehead gets the extra room (rather than chest).
    const extra = size - ph;
    py = py - extra * 0.7;
    ph = size;
  } else if (pw < size) {
    // Horizontal is the smaller axis — grow width symmetrically (50/50).
    const extra = size - pw;
    px = px - extra * 0.5;
    pw = size;
  }

  // Clamp the square so it stays inside the source image (no black bars).
  // We use center-clamp on the final size to handle the case where the
  // biased shift pushed us past an edge.
  let cx = px + pw * 0.5;
  let cy = py + ph * 0.5;
  const half = size * 0.5;
  cx = Math.max(half, Math.min(imageW - half, cx));
  cy = Math.max(half, Math.min(imageH - half, cy));
  return { x: cx - half, y: cy - half, size };
}

/** Re-project a list of normalized (0..1, source-image space) landmarks into
 *  the cropped image's local 0..1 space.
 *
 *  Landmarks come from FaceLandmarker as fractions of the *source* image
 *  (e.g. 1280x720 webcam frame). The crop carves a `square` of pixel size
 *  `sSize` starting at `(sx, sy)` from the source, then upscales to a 512×512
 *  PNG. To re-project into the cropped image's [0,1] coordinate space:
 *
 *    pixelX_in_source = lm.x * sourceW
 *    pixelX_in_crop   = pixelX_in_source - sx
 *    normX_in_crop    = pixelX_in_crop / sSize     // 0..1 of the cropped image
 *
 *  Output is a flat [x0,y0,x1,y1,...] array of length 478*2 = 956. We do
 *  NOT clamp to [0,1] — landmarks just outside the crop are valid signals
 *  that the eyes/jaw extend past the visible edge, and consumers can
 *  decide whether to clamp. Landmarks more than ~10% outside indicate a
 *  truly bad crop and the consumer should treat them as a soft warning.
 */
export function landmarksToCropLocal(
  landmarks: ReadonlyArray<NormalizedLandmark>,
  sourceW: number,
  sourceH: number,
  sx: number,
  sy: number,
  sSize: number,
): number[] {
  const out: number[] = new Array(landmarks.length * 2);
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    const px = lm.x * sourceW - sx;
    const py = lm.y * sourceH - sy;
    out[i * 2] = px / sSize;
    out[i * 2 + 1] = py / sSize;
  }
  return out;
}

/** Crop a region of the source image into a new canvas and return the PNG
 *  data URL. Also returns the bbox translated into the cropped image's
 *  local 0..1 coords (so consumers can know where the eyes/mouth landed). */
export function cropToSquareDataUrl(
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  square: { x: number; y: number; size: number },
  bboxPx: { left: number; top: number; right: number; bottom: number } | null,
): { dataUrl: string; bbox: FaceImage['bbox']; sx: number; sy: number; sSize: number } {
  // Use a power-of-two-ish output size — large enough to look good projected
  // onto a 0.5m face plane at close camera distance without being wasteful.
  const OUT = 512;
  const canvas = document.createElement('canvas');
  canvas.width = OUT;
  canvas.height = OUT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  // sw/sh might exceed source bounds due to floating point — clamp to keep
  // drawImage from throwing on Safari.
  const sx = Math.max(0, Math.min(sourceW - 1, square.x));
  const sy = Math.max(0, Math.min(sourceH - 1, square.y));
  const sSize = Math.max(1, Math.min(square.size, sourceW - sx, sourceH - sy));
  ctx.drawImage(source, sx, sy, sSize, sSize, 0, 0, OUT, OUT);
  const dataUrl = canvas.toDataURL('image/png');

  let localBbox: FaceImage['bbox'] = null;
  if (bboxPx) {
    // Translate the source-pixel bbox into the cropped image's 0..1 coords.
    const left = (bboxPx.left * sourceW - sx) / sSize;
    const top = (bboxPx.top * sourceH - sy) / sSize;
    const right = (bboxPx.right * sourceW - sx) / sSize;
    const bottom = (bboxPx.bottom * sourceH - sy) / sSize;
    localBbox = {
      left: Math.max(0, Math.min(1, left)),
      top: Math.max(0, Math.min(1, top)),
      right: Math.max(0, Math.min(1, right)),
      bottom: Math.max(0, Math.min(1, bottom)),
    };
  }
  return { dataUrl, bbox: localBbox, sx, sy, sSize };
}

/** Read a File into an HTMLImageElement (waits for `.complete`). */
function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Defer revoke so the browser keeps the bitmap reachable across the
      // synchronous detect() call below.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to read image: ${describeError(err)}`));
    };
    img.src = url;
  });
}

export class FaceCapture {
  private videoEl: HTMLVideoElement;
  private stream: MediaStream | null = null;
  /** Live VIDEO-mode landmarker for the webcam preview. */
  private videoLandmarker: FaceLandmarker | null = null;
  /** Lazily-created IMAGE-mode landmarker for processing uploaded stills.
   *  Separate instance because runningMode is fixed at create-time and
   *  switching it via setOptions() is more invasive than just keeping two. */
  private imageLandmarker: FaceLandmarker | null = null;
  private vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
  private previewLoop: VideoFrameCallbackHandle | null = null;
  private previewCb: FacePreviewCallback | null = null;
  private lastDetectTs = -1;
  private cameraStarted = false;
  /** Cache the most recent VIDEO-mode result so snapshot() can pull a bbox
   *  without redoing detection (which fights the live preview's monotonic
   *  timestamp invariant). */
  private lastResult: FaceLandmarkerResult | null = null;

  constructor(videoEl: HTMLVideoElement) {
    this.videoEl = videoEl;
  }

  isCameraStarted(): boolean {
    return this.cameraStarted;
  }

  /** The bound HTMLVideoElement — the scan flow reads pixel size + draws
   *  to canvas to extract the per-pose still. Exposed so FaceScanner doesn't
   *  need to be passed videoEl independently (and risk drift if the binding
   *  ever changes). */
  getVideoElement(): HTMLVideoElement {
    return this.videoEl;
  }

  /** The underlying VIDEO-mode FaceLandmarker. Phase 7.6's FaceScanner
   *  drives detectForVideo() directly during scan mode (it needs the
   *  facialTransformationMatrixes per frame and we can't piggy-back on
   *  the preview loop's monotonic-timestamp invariant). Returns null until
   *  startCamera() has resolved. */
  getRawLandmarker(): FaceLandmarker | null {
    return this.videoLandmarker;
  }

  /** The underlying webcam MediaStream — exposed so Phase 8.2a's face-mirror
   *  recorder can wire a MediaRecorder onto the same stream FaceCapture is
   *  using to drive MediaPipe. Returns null until startCamera() has resolved
   *  (and again after dispose()). The recorder is a passive consumer; both
   *  consumers share the same tracks, so stopping the camera will stop the
   *  recorder mid-flight (we handle that via recorder.onstop). */
  getMediaStream(): MediaStream | null {
    return this.stream;
  }

  /** While the scanner is driving detectForVideo() it owns the timestamp
   *  monotonicity invariant — pause our preview-loop detect calls so the
   *  two don't fight. The scanner re-enables on stopScan. */
  pausePreviewLoop(): void {
    this.previewLoop?.cancel();
    this.previewLoop = null;
  }

  /** Resume the preview loop after a scan ends or is cancelled. No-op if
   *  the camera was torn down in between. */
  resumePreviewLoop(): void {
    if (!this.videoLandmarker) return;
    if (this.previewLoop) return;
    this.startPreviewLoop();
  }

  /** Bump the monotonic detect timestamp so the scanner's first call in
   *  scan mode doesn't collide with the preview loop's last value. The
   *  scanner calls this once before its first detectForVideo(). */
  bumpDetectTimestamp(): number {
    const ts = Math.max(this.lastDetectTs + 1, performance.now());
    this.lastDetectTs = ts;
    return ts;
  }

  /** Request webcam + load FaceLandmarker model in VIDEO mode. Tries GPU
   *  delegate first, falls back to CPU on init failure. Throws with a
   *  user-readable message on permission / model-download / WebGL failures. */
  async startCamera(previewCb: FacePreviewCallback): Promise<void> {
    if (this.cameraStarted) return;
    this.previewCb = previewCb;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Camera permission denied or unavailable: ${msg}`);
    }
    this.videoEl.srcObject = this.stream;
    await new Promise<void>((resolve) => {
      const onMeta = () => {
        this.videoEl.removeEventListener('loadedmetadata', onMeta);
        resolve();
      };
      this.videoEl.addEventListener('loadedmetadata', onMeta);
    });
    await this.videoEl.play();

    this.vision = await FilesetResolver.forVisionTasks(WASM_URL).catch((err: unknown) => {
      throw new Error(`Failed to download MediaPipe wasm from ${WASM_URL}: ${describeError(err)}`);
    });

    let gpuErr: unknown = null;
    try {
      this.videoLandmarker = await FaceLandmarker.createFromOptions(this.vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        // Phase 7.6: head-pose detection for the 3D Scan flow needs the
        // facial transformation matrix. Enabling it on every VIDEO-mode
        // session is fine — the matrix is ~64 floats per detect, no real
        // overhead, and the flat snapshot path simply ignores it.
        outputFacialTransformationMatrixes: true,
        // Phase 8: ARKit-style blendshape coefficients drive the live
        // facial-puppet path. Unlike the matrix output, blendshapes do
        // cost a touch more (the model runs a small extra head), but only
        // on frames where a face is detected — so quiescent sessions pay
        // nothing. Also enabled on the IMAGE-mode landmarker below so a
        // future "import a still and apply its expression" flow works.
        outputFaceBlendshapes: true,
      });
    } catch (err) {
      gpuErr = err;
      try {
        this.videoLandmarker = await FaceLandmarker.createFromOptions(this.vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFacialTransformationMatrixes: true,
          outputFaceBlendshapes: true,
        });
      } catch (err2) {
        throw new Error(
          `Failed to initialize FaceLandmarker from ${MODEL_URL} ` +
            `(GPU: ${describeError(gpuErr)}; CPU: ${describeError(err2)})`,
        );
      }
    }

    this.cameraStarted = true;
    this.startPreviewLoop();
  }

  private startPreviewLoop(): void {
    if (!this.videoLandmarker) return;
    this.previewLoop?.cancel();
    this.previewLoop = eachVideoFrame(this.videoEl, () => {
      if (!this.videoLandmarker) return;
      if (this.videoEl.readyState < 2) return;
      const ts = performance.now();
      if (ts <= this.lastDetectTs) return;
      this.lastDetectTs = ts;
      const result = this.videoLandmarker.detectForVideo(this.videoEl, ts);
      this.lastResult = result;
      this.previewCb?.(result, this.videoEl);
    });
  }

  /** Grab the current webcam frame, find the face bbox via FaceLandmarker,
   *  pad + crop a square region, and encode it as a PNG data URL. Throws
   *  if no face is detected — the editor surfaces this. */
  async snapshot(opts: { name: string }): Promise<FaceImage> {
    if (!this.cameraStarted || !this.videoLandmarker) {
      throw new Error('Camera not started');
    }
    if (this.videoEl.readyState < 2) {
      throw new Error('Webcam frame not ready yet — try again in a moment.');
    }

    // Reuse the most recent live result if it has a face. If not (or if
    // nothing has been detected yet because the preview just started),
    // run one fresh detect with a fresh monotonic timestamp.
    let result = this.lastResult;
    if (!result || !result.faceLandmarks || result.faceLandmarks.length === 0) {
      const ts = Math.max(this.lastDetectTs + 1, performance.now());
      this.lastDetectTs = ts;
      result = this.videoLandmarker.detectForVideo(this.videoEl, ts);
      this.lastResult = result;
    }
    const landmarks = result.faceLandmarks?.[0];
    if (!landmarks || landmarks.length === 0) {
      throw new Error('No face detected — center yourself in the frame and try again.');
    }
    const bbox = coreFaceBoundingBox(landmarks);
    if (!bbox) {
      throw new Error('No face detected — center yourself in the frame and try again.');
    }

    const w = this.videoEl.videoWidth;
    const h = this.videoEl.videoHeight;
    const square = padToSquarePixels(bbox, w, h);
    const bboxPx = {
      left: bbox.left,
      top: bbox.top,
      right: bbox.right,
      bottom: bbox.bottom,
    };
    const { dataUrl, bbox: localBbox, sx, sy, sSize } = cropToSquareDataUrl(
      this.videoEl,
      w,
      h,
      square,
      bboxPx,
    );
    // Phase 7.7: re-project the full 478-landmark set into the cropped
    // image's [0,1] coords so the runtime can build a precise face-shaped
    // alpha mask + align the face plane to the rig's eye anatomy.
    const faceLandmarks = landmarksToCropLocal(landmarks, w, h, sx, sy, sSize);
    return {
      __version: 1,
      name: opts.name,
      capturedAt: new Date().toISOString(),
      source: 'webcam',
      dataUrl,
      bbox: localBbox,
      faceLandmarks,
    };
  }

  /** Read a PNG/JPG file, run FaceLandmarker on it (IMAGE mode) and crop
   *  the same way as snapshot. If no face is detected — common for stylized
   *  AI-generated images — fall back to saving the full image as-is with
   *  `bbox: null`. The caller should surface that as a soft warning. */
  async processUpload(file: File, opts: { name: string }): Promise<FaceImage> {
    if (!this.vision) {
      // Initialize the FilesetResolver lazily so the user doesn't have to
      // start the camera before uploading a file.
      this.vision = await FilesetResolver.forVisionTasks(WASM_URL).catch((err: unknown) => {
        throw new Error(`Failed to download MediaPipe wasm from ${WASM_URL}: ${describeError(err)}`);
      });
    }
    if (!this.imageLandmarker) {
      // Spin up an IMAGE-mode landmarker. Same GPU→CPU fallback dance as
      // startCamera. Keep numFaces=1; we only need one face per image.
      let gpuErr: unknown = null;
      try {
        this.imageLandmarker = await FaceLandmarker.createFromOptions(this.vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'IMAGE',
          numFaces: 1,
          // Phase 7.6: keep matrix output enabled across both modes for
          // symmetry. The image-mode path doesn't read it today but the
          // overhead is negligible and avoids a second initialization
          // for any future "import existing photo as scan" flow.
          outputFacialTransformationMatrixes: true,
          // Phase 8: blendshapes also enabled in IMAGE mode so a static
          // photo can drive a single expression (debug aid + future "freeze
          // an expression onto a face" flow).
          outputFaceBlendshapes: true,
        });
      } catch (err) {
        gpuErr = err;
        try {
          this.imageLandmarker = await FaceLandmarker.createFromOptions(this.vision, {
            baseOptions: {
              modelAssetPath: MODEL_URL,
              delegate: 'CPU',
            },
            runningMode: 'IMAGE',
            numFaces: 1,
            outputFacialTransformationMatrixes: true,
            outputFaceBlendshapes: true,
          });
        } catch (err2) {
          throw new Error(
            `Failed to initialize FaceLandmarker from ${MODEL_URL} ` +
              `(GPU: ${describeError(gpuErr)}; CPU: ${describeError(err2)})`,
          );
        }
      }
    }

    const img = await fileToImage(file);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w === 0 || h === 0) {
      throw new Error('Image has zero dimensions — file may be corrupt.');
    }

    const result = this.imageLandmarker.detect(img);
    const landmarks = result.faceLandmarks?.[0];
    const bbox = landmarks ? coreFaceBoundingBox(landmarks) : null;

    if (bbox && landmarks) {
      const square = padToSquarePixels(bbox, w, h);
      const { dataUrl, bbox: localBbox, sx, sy, sSize } = cropToSquareDataUrl(
        img,
        w,
        h,
        square,
        bbox,
      );
      // Phase 7.7: re-project landmarks into cropped-image [0,1] coords —
      // same conversion as the webcam path. Conversion docs in
      // landmarksToCropLocal().
      const faceLandmarks = landmarksToCropLocal(landmarks, w, h, sx, sy, sSize);
      return {
        __version: 1,
        name: opts.name,
        capturedAt: new Date().toISOString(),
        source: 'upload',
        dataUrl,
        bbox: localBbox,
        faceLandmarks,
      };
    }

    // No face detected — explicit "AI-generated funny face" path. Save the
    // full image as-is, scaled into a 512x512 square (with letterboxing if
    // the source isn't square — we use the larger dimension and center).
    const OUT = 512;
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    // Cover-fit: fill the square by taking the larger dim as the source size,
    // centered on the longer axis. This crops the long axis instead of
    // letterboxing — better for face plane projection.
    const size = Math.min(w, h);
    const sx = (w - size) * 0.5;
    const sy = (h - size) * 0.5;
    ctx.drawImage(img, sx, sy, size, size, 0, 0, OUT, OUT);
    return {
      __version: 1,
      name: opts.name,
      capturedAt: new Date().toISOString(),
      source: 'upload',
      dataUrl: canvas.toDataURL('image/png'),
      bbox: null,
    };
  }

  /** Tear down the webcam stream + landmarkers. Call on page unload. */
  async dispose(): Promise<void> {
    this.previewLoop?.cancel();
    this.previewLoop = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.videoLandmarker) {
      this.videoLandmarker.close();
      this.videoLandmarker = null;
    }
    if (this.imageLandmarker) {
      this.imageLandmarker.close();
      this.imageLandmarker = null;
    }
    this.cameraStarted = false;
    this.lastResult = null;
  }
}
