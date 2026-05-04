/**
 * MediaPipe PoseLandmarker + getUserMedia wrapper.
 *
 * Phase 1: live preview + clip recording. The output is a `MocapClip` that
 * matches the locked schema in `./types.ts`. Retargeting / fitting happen
 * elsewhere in later phases.
 *
 * Notes on coordinate frames:
 *   - `result.landmarks[0]` are normalized image-space points (x,y in [0,1])
 *     used only for the preview overlay.
 *   - `result.worldLandmarks[0]` are world-space points in meters with the
 *     hip-midpoint origin and the +y-down / +z-toward-camera axis convention
 *     documented in `types.ts`. These are what we save.
 */
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type {
  MocapClip,
  MocapFrame,
  MocapOrientation,
  MocapTargetAnim,
  MpLandmark,
} from './types';

/** Settled on the *lite* model — fast enough for live preview on integrated
 *  GPUs and good enough for our single-subject use case. Bumping to *full*
 *  is a one-line change.
 *
 *  The bucket uses versioned paths (`/1/`), not `/latest/` — the latter 404s. */
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/** WASM bundle is vendored into `public/mocap-wasm/` (synced from
 *  `node_modules/@mediapipe/tasks-vision/wasm` by `scripts/copy-mocap-wasm.js`).
 *  Vite serves the public dir at site root, so the same path works in dev,
 *  preview, build output, and Electron file:// without a CDN round-trip. */
const WASM_URL = '/mocap-wasm';

/** MediaPipe sometimes rejects with raw `Event` objects (from script.onerror
 *  or XHR.onerror) rather than `Error` instances. `String(event)` yields the
 *  useless "[object Event]" — pull out anything useful instead. */
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

/** Visibility threshold for the four "primary" keypoints (shoulders, hips).
 *  Frames below this are dropped so the saved clip doesn't carry junk
 *  extrapolated landmarks during occlusion. */
const PRIMARY_VIS_THRESHOLD = 0.5;

/** Indices for the primary keypoints we gate frames on. Matches MP_POSE in
 *  types.ts but inlined here to avoid a runtime dependency. */
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;

export interface RecordOptions {
  duration: number; // seconds
  fps: number;
  targetAnim: MocapTargetAnim;
  orientation: MocapOrientation;
  name: string;
  /** Called every frame with elapsed seconds and frame count so the UI can
   *  show live progress. */
  onProgress?: (elapsed: number, frameCount: number) => void;
}

export interface RecordResult {
  clip: MocapClip;
  /** Frames dropped because primary keypoints fell below the visibility
   *  threshold. The UI surfaces a warning if this is high. */
  droppedFrames: number;
  /** Measured average FPS over the capture window. */
  measuredFps: number;
}

/** Per-frame preview callback — drives the skeleton overlay. */
export type PreviewCallback = (
  result: PoseLandmarkerResult,
  videoEl: HTMLVideoElement
) => void;

interface VideoFrameCallbackHandle {
  cancel: () => void;
}

/** Cross-browser per-frame loop. Prefers `requestVideoFrameCallback` so we
 *  tick exactly once per arrived video frame; falls back to
 *  `requestAnimationFrame`. */
function eachVideoFrame(
  videoEl: HTMLVideoElement,
  cb: () => void
): VideoFrameCallbackHandle {
  // requestVideoFrameCallback is non-standard but widely supported (Chromium,
  // Safari 15.4+). Cast through unknown to keep tsc happy under strict.
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

/** Convert a MediaPipe NormalizedLandmark | Landmark into our serializable
 *  MpLandmark. MediaPipe's Landmark may carry visibility on either the
 *  landmark itself or (older versions) a parallel array — we handle both. */
function toMpLandmark(
  lm: { x: number; y: number; z: number; visibility?: number },
  fallbackVisibility: number
): MpLandmark {
  return {
    x: lm.x,
    y: lm.y,
    z: lm.z,
    visibility: typeof lm.visibility === 'number' ? lm.visibility : fallbackVisibility,
  };
}

export class MocapCapture {
  private videoEl: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private landmarker: PoseLandmarker | null = null;
  private previewLoop: VideoFrameCallbackHandle | null = null;
  private previewCb: PreviewCallback | null = null;
  /** Wall-clock for MediaPipe's monotonic timestamp requirement. We hand it
   *  performance.now() values which are guaranteed to be monotonically
   *  increasing within a session. */
  private lastDetectTs = -1;
  private cameraStarted = false;
  private recording = false;
  private cancelRecord: (() => void) | null = null;

  constructor(videoEl: HTMLVideoElement) {
    this.videoEl = videoEl;
  }

  isCameraStarted(): boolean {
    return this.cameraStarted;
  }
  isRecording(): boolean {
    return this.recording;
  }

  /** Request webcam + load PoseLandmarker model. Tries GPU delegate first
   *  and falls back to CPU on init failure. Throws with a user-readable
   *  message on permission / model-download / WebGL failures. */
  async startCamera(previewCb: PreviewCallback): Promise<void> {
    if (this.cameraStarted) return;
    this.previewCb = previewCb;

    // 1. Webcam.
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

    // 2. MediaPipe pose model. GPU first, CPU fallback.
    const vision = await FilesetResolver.forVisionTasks(WASM_URL).catch((err: unknown) => {
      throw new Error(`Failed to download MediaPipe wasm from ${WASM_URL}: ${describeError(err)}`);
    });

    let gpuErr: unknown = null;
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
    } catch (err) {
      gpuErr = err;
      // GPU init can fail on machines without WebGL2 / on Linux Chromium
      // with --disable-gpu. CPU is slower but always available.
      try {
        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
      } catch (err2) {
        throw new Error(
          `Failed to initialize PoseLandmarker from ${MODEL_URL} ` +
            `(GPU: ${describeError(gpuErr)}; CPU: ${describeError(err2)})`,
        );
      }
    }

    this.cameraStarted = true;
    this.startPreviewLoop();
  }

  private startPreviewLoop(): void {
    if (!this.landmarker) return;
    this.previewLoop?.cancel();
    this.previewLoop = eachVideoFrame(this.videoEl, () => {
      if (!this.landmarker) return;
      if (this.videoEl.readyState < 2) return;
      const ts = performance.now();
      // MediaPipe rejects non-monotonic timestamps. Guard explicitly.
      if (ts <= this.lastDetectTs) return;
      this.lastDetectTs = ts;
      const result = this.landmarker.detectForVideo(this.videoEl, ts);
      this.previewCb?.(result, this.videoEl);
    });
  }

  /** Capture frames for `duration` seconds. Resolves with the assembled
   *  MocapClip plus stats. Throws if camera isn't started or another
   *  recording is in progress. */
  async record(opts: RecordOptions): Promise<RecordResult> {
    if (!this.cameraStarted || !this.landmarker) {
      throw new Error('Camera not started');
    }
    if (this.recording) {
      throw new Error('Already recording');
    }
    this.recording = true;

    const frames: MocapFrame[] = [];
    let droppedFrames = 0;
    const startTime = performance.now();
    const endTime = startTime + opts.duration * 1000;

    // Stop the preview loop and run a dedicated capture loop. We still call
    // the preview callback so the overlay keeps rendering during recording.
    this.previewLoop?.cancel();
    this.previewLoop = null;

    return new Promise<RecordResult>((resolve, reject) => {
      let stopped = false;
      const finish = () => {
        if (stopped) return;
        stopped = true;
        loop.cancel();
        this.recording = false;
        this.cancelRecord = null;
        // Resume the live preview loop.
        this.startPreviewLoop();

        const elapsed = (performance.now() - startTime) / 1000;
        const measuredFps = elapsed > 0 ? frames.length / elapsed : 0;

        const clip: MocapClip = {
          __version: 1,
          name: opts.name,
          targetAnim: opts.targetAnim,
          orientation: opts.orientation,
          fps: opts.fps,
          capturedAt: new Date().toISOString(),
          frames,
        };
        resolve({ clip, droppedFrames, measuredFps });
      };

      this.cancelRecord = () => {
        // Manual stop — finalize what we have so far.
        finish();
      };

      const loop = eachVideoFrame(this.videoEl, () => {
        if (!this.landmarker || stopped) return;
        if (this.videoEl.readyState < 2) return;
        const now = performance.now();
        if (now >= endTime) {
          finish();
          return;
        }
        if (now <= this.lastDetectTs) return;
        this.lastDetectTs = now;

        let result: PoseLandmarkerResult;
        try {
          result = this.landmarker.detectForVideo(this.videoEl, now);
        } catch (err) {
          stopped = true;
          loop.cancel();
          this.recording = false;
          this.cancelRecord = null;
          this.startPreviewLoop();
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }

        // Always call the preview cb so the overlay keeps animating.
        this.previewCb?.(result, this.videoEl);

        const world = result.worldLandmarks?.[0];
        const image = result.landmarks?.[0];
        if (!world || world.length < 33) {
          droppedFrames++;
          return;
        }

        // Visibility may live on the image-space landmark in some
        // versions and the world landmark in others. Prefer image-space
        // (it's where MediaPipe historically reports visibility) and
        // fall back to world.
        const visOf = (i: number): number => {
          const iv = image && image[i] && typeof image[i].visibility === 'number'
            ? image[i].visibility!
            : undefined;
          if (typeof iv === 'number') return iv;
          const wv = world[i] && typeof world[i].visibility === 'number'
            ? world[i].visibility!
            : undefined;
          return typeof wv === 'number' ? wv : 0;
        };

        const ls = visOf(LEFT_SHOULDER);
        const rs = visOf(RIGHT_SHOULDER);
        const lh = visOf(LEFT_HIP);
        const rh = visOf(RIGHT_HIP);
        if (
          ls < PRIMARY_VIS_THRESHOLD ||
          rs < PRIMARY_VIS_THRESHOLD ||
          lh < PRIMARY_VIS_THRESHOLD ||
          rh < PRIMARY_VIS_THRESHOLD
        ) {
          droppedFrames++;
          return;
        }

        const t = (now - startTime) / 1000;
        const worldOut: MpLandmark[] = world.map((lm, i) => toMpLandmark(lm, visOf(i)));
        const imageOut: MpLandmark[] | undefined = image
          ? image.map((lm, i) => toMpLandmark(lm, visOf(i)))
          : undefined;

        const frame: MocapFrame = imageOut
          ? { t, world: worldOut, image: imageOut }
          : { t, world: worldOut };
        frames.push(frame);
        opts.onProgress?.(t, frames.length);
      });
    });
  }

  /** Manual stop during a recording. No-op if not recording. */
  stop(): void {
    this.cancelRecord?.();
  }

  /** Tear down the webcam stream + landmarker. Call on page unload. */
  async dispose(): Promise<void> {
    this.previewLoop?.cancel();
    this.previewLoop = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
    this.cameraStarted = false;
  }
}
