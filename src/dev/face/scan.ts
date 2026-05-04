/**
 * 3D Face Scan flow — guided multi-pose capture.
 *
 * Drives the existing FaceCapture's VIDEO-mode FaceLandmarker (pose
 * detection + landmarks + transformation matrix) through five poses,
 * holding ~600ms when the user's head is within tolerance of each target,
 * then auto-snapping a still and advancing.
 *
 * Yaw / pitch sign convention: see comments in `currentPose()` below. We
 * derive yaw and pitch from the 4x4 facial transformation matrix's rotation
 * sub-matrix. MediaPipe stores the matrix as column-major in `data[16]`,
 * meaning element index = col*4 + row. We read M[0][2], M[2][2], M[1][2]
 * (mathematical 0-indexed row, col) — for the canonical "looking at camera"
 * pose this gives yaw=0, pitch=0.
 */
import type {
  FaceLandmarker,
  FaceLandmarkerResult,
  NormalizedLandmark,
  Matrix,
} from '@mediapipe/tasks-vision';
import type { FaceCapture } from './capture';
import {
  CORE_FACE_LANDMARK_INDICES,
  coreFaceBoundingBox,
  cropToSquareDataUrl,
  padToSquarePixels,
} from './capture';

/** One of the seven poses the user steps through (Phase 7.8 added the
 *  two profile-left / profile-right captures). */
export type ScanPoseName =
  | 'front'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'profile-left'
  | 'profile-right';

/** Target pose: rotation thresholds + the user-facing instruction. */
export interface ScanTarget {
  pose: ScanPoseName;
  /** Target yaw in radians. Positive = subject's face turning to their LEFT
   *  (right side of the camera frame). See sign-convention notes below. */
  targetYaw: number;
  /** Target pitch in radians. Positive = looking DOWN (chin toward chest). */
  targetPitch: number;
  /** UI text shown in the scan overlay. */
  instruction: string;
}

/** Captured per-pose data after the user holds the target. */
export interface CapturedAngle {
  pose: ScanPoseName;
  /** Square-cropped PNG data URL of the webcam frame at capture time. */
  imageDataUrl: string;
  /** 478 normalized landmarks (raw MediaPipe NormalizedLandmark). */
  landmarks: NormalizedLandmark[];
}

export interface ScanResult {
  angles: CapturedAngle[];
}

/**
 * Per-frame callback payload. Phase 7.9 expanded this from a tiny
 * `{ holdProgress }` blob into a richer struct so the UI can render a live
 * pose-delta arrow + numeric degrees, a "no face detected" indicator, and
 * a target-icon silhouette per pose. None of these add allocations beyond
 * the single object literal already constructed per frame.
 */
export interface ScanProgressDetail {
  /** Current pose target the scanner is trying to match. */
  pose: ScanPoseName;
  /** Target yaw in radians. Positive = subject turning to their LEFT. */
  targetYaw: number;
  /** Target pitch in radians. Positive = looking DOWN. */
  targetPitch: number;
  /** Current head yaw in radians (positive = subject's left turn). Null
   *  when no face detected this frame. */
  yaw: number | null;
  /** Current head pitch in radians (positive = looking down). Null when
   *  no face detected this frame. */
  pitch: number | null;
  /** True when FaceLandmarker detected a face in this frame; lets UX show
   *  a "we can't see your face" indicator. */
  faceVisible: boolean;
  /** Tolerance for "in range" matching, in radians (varies by pose). */
  toleranceRad: number;
  /** 0..1 fraction of the hold window completed. */
  holdProgress: number;
}

export type ScanProgressCallback = (
  step: number,
  total: number,
  status: string,
  detail?: ScanProgressDetail,
) => void;

/** ±tolerance per axis to consider "within target pose", in radians. */
const POSE_TOLERANCE_RAD = 0.10; // ~5.7°
/** Phase 7.8: relax tolerance for the profile poses (±60° yaw). At extreme
 *  yaw the facial transformation matrix gets noisier, and MediaPipe's
 *  detection itself is less stable, so a tighter tolerance can stall the
 *  scan. ~8.6° is generous but still well inside "looking sideways". */
const POSE_TOLERANCE_RAD_PROFILE = 0.15;
/** How long the user must HOLD the pose within tolerance before capture. */
const HOLD_DURATION_MS = 600;
/** Yaw/pitch low-pass coefficient — small alpha means heavy smoothing. The
 *  raw matrix output flickers ~0.02 rad even on a still subject, so we
 *  smooth to keep the "in-tolerance" check from oscillating. */
const POSE_SMOOTHING_ALPHA = 0.35;

/**
 * Pose targets in scan order. Sign conventions documented in `currentPose()`.
 * Yaw 0.26 rad ≈ 15°; pitch 0.21 rad ≈ 12°. Tighter than ±15° on the
 * up/down axis because most users tilt less reliably than they rotate.
 */
export const SCAN_TARGETS: ReadonlyArray<ScanTarget> = [
  { pose: 'front', targetYaw: 0,     targetPitch: 0,     instruction: 'Look straight ahead' },
  { pose: 'left',  targetYaw: +0.26, targetPitch: 0,     instruction: 'Turn slowly to your left' },
  { pose: 'right', targetYaw: -0.26, targetPitch: 0,     instruction: 'Turn slowly to your right' },
  { pose: 'up',    targetYaw: 0,     targetPitch: -0.21, instruction: 'Tilt your head up' },
  { pose: 'down',  targetYaw: 0,     targetPitch: +0.21, instruction: 'Tilt your head down' },
  // Phase 7.8: profile captures (~±60°). Used by future multi-angle
  // texture blending; the present runtime ignores them but stores them
  // alongside the existing 5 angles for forward-compat.
  { pose: 'profile-left',  targetYaw: +1.05, targetPitch: 0, instruction: 'Turn fully to your left (profile)' },
  { pose: 'profile-right', targetYaw: -1.05, targetPitch: 0, instruction: 'Turn fully to your right (profile)' },
];

/** Read row, col from a MediaPipe Matrix. Column-major: index = col*4 + row. */
function matAt(m: Matrix, row: number, col: number): number {
  return m.data[col * m.rows + row];
}

/**
 * Extract yaw + pitch from the head-pose 4x4. Sign conventions (verified
 * empirically against a webcam):
 *   yaw   = atan2(M[0][2], M[2][2])
 *           POSITIVE when the subject turns their face to THEIR LEFT
 *           (i.e., the user's face moves toward the right side of the
 *           camera image — which, on a horizontally-mirrored preview,
 *           also feels rightward, matching natural intuition).
 *   pitch = atan2(-M[1][2], sqrt(M[0][2]^2 + M[2][2]^2))
 *           POSITIVE when the subject looks DOWN (chin toward chest).
 *
 * Why M[r][2]: column 2 of a rotation matrix is the local +Z axis of the
 * rotated frame in world coords. For a head pose, that's the direction
 * the head is "facing forward" — perfect for yaw/pitch decomposition.
 *
 * If empirical testing shows the signs are flipped on a given device /
 * webcam orientation, this is the place to flip them — keep the rest of
 * the pipeline (target deltas, tolerance checks) untouched.
 */
function yawPitchFromMatrix(m: Matrix): { yaw: number; pitch: number } {
  const m02 = matAt(m, 0, 2);
  const m12 = matAt(m, 1, 2);
  const m22 = matAt(m, 2, 2);
  const yaw = Math.atan2(m02, m22);
  const pitch = Math.atan2(-m12, Math.hypot(m02, m22));
  return { yaw, pitch };
}

/**
 * Capture the current webcam frame as a square 512x512 PNG data URL,
 * cover-fit (longer axis cropped to keep the face centered). This mirrors
 * the no-bbox fallback in capture.ts so all 5 angles look uniform.
 */
function snapshotFrameToDataUrl(video: HTMLVideoElement): {
  dataUrl: string;
  cropSize: number;
  cropX: number;
  cropY: number;
  videoW: number;
  videoH: number;
} {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w === 0 || h === 0) {
    throw new Error('snapshotFrameToDataUrl: video has zero dimensions');
  }
  const OUT = 512;
  const canvas = document.createElement('canvas');
  canvas.width = OUT;
  canvas.height = OUT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  const size = Math.min(w, h);
  const sx = (w - size) * 0.5;
  const sy = (h - size) * 0.5;
  ctx.drawImage(video, sx, sy, size, size, 0, 0, OUT, OUT);
  return {
    dataUrl: canvas.toDataURL('image/png'),
    cropSize: size,
    cropX: sx,
    cropY: sy,
    videoW: w,
    videoH: h,
  };
}

/** Minimum core-face-bbox width AND height (in normalized 0..1 source-image
 *  coords) for the bbox-driven crop to be considered valid. Below this we
 *  fall back to center-crop because the bbox is degenerate — typically a
 *  symptom of an extreme yaw where left/right cheek landmarks collapse onto
 *  one another (profile poses) or a partial face. Picked at 0.05 = ~5% of
 *  frame: a face occupying less than that is too small to be the user
 *  centered in the frame, so the bbox is not trustworthy. */
const MIN_BBOX_NORMALIZED = 0.05;

/** Maximum core-face-bbox width OR height (in normalized 0..1 source coords)
 *  for the bbox-driven crop to be considered valid. Above this, the subject
 *  is too close to the webcam — chin/forehead landmarks tend to clip past
 *  the frame edge and the resulting crop produces a face that's smaller
 *  than expected in cropped-image coords, blowing up the eye-anatomy scale
 *  in mesh-builder. 0.70 = bbox occupies more than 70% of either axis. */
const REJECT_TOO_LARGE = 0.70;

/** Visibility threshold for the 4 core-face landmarks. Note: FaceLandmarker
 *  often reports visibility=0 for ALL landmarks (the model treats face
 *  landmarks as fully present rather than scoring them individually). When
 *  every core landmark has visibility 0 we treat that as "model didn't
 *  report" and defer to the bbox-size check; if any non-zero values come
 *  back AND fall below this threshold, we treat it as low-confidence and
 *  fall back to center-crop. */
const CORE_LM_VISIBILITY_MIN = 0.5;

/** Decide whether the bbox-driven crop is safe for this frame. Returns the
 *  bbox (in 0..1 normalized source coords) when good; null to fall back to
 *  center-crop. Fallback fires when:
 *    - coreFaceBoundingBox returns null (missing landmarks).
 *    - bbox width OR height is < MIN_BBOX_NORMALIZED (degenerate — typical
 *      for extreme yaw / profile poses where cheek landmarks collapse).
 *    - any of the 4 core landmarks reports a non-zero visibility below
 *      CORE_LM_VISIBILITY_MIN (low-confidence detection).
 */
function chooseBboxOrFallback(
  lm: NormalizedLandmark[],
): { left: number; top: number; right: number; bottom: number } | null {
  const bbox = coreFaceBoundingBox(lm);
  if (!bbox) return null;
  const w = bbox.right - bbox.left;
  const h = bbox.bottom - bbox.top;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w < MIN_BBOX_NORMALIZED || h < MIN_BBOX_NORMALIZED) return null;
  // Reject when subject is too close — bbox occupying >70% of frame in
  // either axis indicates a clipped face whose downstream crop produces
  // an over-scaled mesh in mesh-builder.
  if (w > REJECT_TOO_LARGE || h > REJECT_TOO_LARGE) return null;
  // Reject when any of the 4 core landmarks fell outside the [0,1] source
  // frame — chin or forehead clipped past the edge means the bbox is
  // truncated and the resulting crop will mismatch the captured face.
  const idxs = [
    CORE_FACE_LANDMARK_INDICES.forehead,
    CORE_FACE_LANDMARK_INDICES.chin,
    CORE_FACE_LANDMARK_INDICES.left,
    CORE_FACE_LANDMARK_INDICES.right,
  ];
  for (const i of idxs) {
    const p = lm[i];
    if (!p) return null;
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
  }
  // Visibility check on the 4 core landmarks. FaceLandmarker frequently
  // returns 0 for all of them — that's the "model doesn't score" path; only
  // reject when a non-zero value is reported AND falls below threshold.
  for (const i of idxs) {
    const p = lm[i];
    if (!p) return null;
    const v = p.visibility;
    if (typeof v === 'number' && v > 0 && v < CORE_LM_VISIBILITY_MIN) {
      return null;
    }
  }
  return bbox;
}

/** Re-project MediaPipe landmarks from source-webcam coords (0..1 of the
 *  full video frame) into the center-square cropped image's coord space.
 *  Without this, mesh-builder sees inter-iris distances ~1.78× too small
 *  on a 1280×720 webcam (because x is normalized by 1280 source vs 720
 *  cropped) and produces a mesh that's wildly miscaled relative to the
 *  saved image.
 *
 *  z is normalized by the SAME unit as x in MediaPipe (image-width units),
 *  so it scales by `videoW / cropSize` along with x.
 */
function reprojectLandmarksToCrop(
  lm: NormalizedLandmark[],
  videoW: number,
  videoH: number,
  cropX: number,
  cropY: number,
  cropSize: number,
): NormalizedLandmark[] {
  return lm.map((p) => ({
    x: (p.x * videoW - cropX) / cropSize,
    y: (p.y * videoH - cropY) / cropSize,
    z: p.z * (videoW / cropSize),
    visibility: p.visibility,
  })) as NormalizedLandmark[];
}

interface VideoFrameCallbackHandle {
  cancel: () => void;
}

/** rAF-style loop that fires once per video frame (or RAF as fallback). */
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

/**
 * Multi-pose face scanner. Driven by the existing FaceCapture's webcam +
 * FaceLandmarker — we don't open a second video stream / model.
 *
 * Lifecycle:
 *   const scanner = new FaceScanner(capture);
 *   await scanner.startScan(onProgress);   // resolves when all 5 poses captured (or rejected on cancel)
 *   const result = scanner.finishScan();   // pulls the captured angles
 *   scanner.dispose();                     // re-enable preview loop, free callback
 */
export class FaceScanner {
  private capture: FaceCapture;
  private loop: VideoFrameCallbackHandle | null = null;
  private targetIndex = 0;
  private holdStartMs: number | null = null;
  private smoothedYaw: number | null = null;
  private smoothedPitch: number | null = null;
  private captured: CapturedAngle[] = [];
  private resolveScan: (() => void) | null = null;
  private rejectScan: ((err: Error) => void) | null = null;
  private progressCb: ScanProgressCallback | null = null;
  private cancelled = false;

  constructor(capture: FaceCapture) {
    this.capture = capture;
  }

  /**
   * Begin the guided 5-pose scan. Resolves after the last pose is captured.
   * Rejects if `stopScan()` is called while pending.
   */
  async startScan(onProgress: ScanProgressCallback): Promise<void> {
    if (this.loop) {
      throw new Error('FaceScanner.startScan: scan already in progress');
    }
    if (!this.capture.isCameraStarted()) {
      throw new Error('FaceScanner.startScan: camera not started');
    }
    const landmarker = this.capture.getRawLandmarker();
    if (!landmarker) {
      throw new Error('FaceScanner.startScan: FaceLandmarker not initialized');
    }
    this.targetIndex = 0;
    this.holdStartMs = null;
    this.smoothedYaw = null;
    this.smoothedPitch = null;
    this.captured = [];
    this.cancelled = false;
    this.progressCb = onProgress;

    // Take over the detect-timestamp + preview loop ownership for the
    // duration of the scan. The preview loop's bbox draw will resume after.
    this.capture.pausePreviewLoop();
    this.capture.bumpDetectTimestamp();

    const videoEl = this.capture.getVideoElement();

    return new Promise<void>((resolve, reject) => {
      this.resolveScan = resolve;
      this.rejectScan = reject;
      this.loop = eachVideoFrame(videoEl, () => this.onFrame(landmarker, videoEl));
      // Emit an initial progress tick so the overlay shows pose-1 instructions
      // before the user even moves. faceVisible=false because we haven't
      // run a detect yet — the UI will hide the no-face indicator on the
      // first real frame.
      this.emitProgress(null, false);
    });
  }

  /** Cancel the in-progress scan. The pending startScan() promise rejects. */
  stopScan(): void {
    if (!this.loop && !this.resolveScan) return;
    this.cancelled = true;
    this.cleanup();
    if (this.rejectScan) {
      const r = this.rejectScan;
      this.resolveScan = null;
      this.rejectScan = null;
      r(new Error('Scan cancelled'));
    }
  }

  /** Pull the captured angles after a successful scan. Throws if incomplete. */
  finishScan(): ScanResult {
    if (this.captured.length !== SCAN_TARGETS.length) {
      throw new Error(
        `FaceScanner.finishScan: only ${this.captured.length}/${SCAN_TARGETS.length} angles captured`,
      );
    }
    return { angles: this.captured.slice() };
  }

  /** Tear down the per-frame loop + restore the preview. Idempotent. */
  dispose(): void {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.loop) {
      this.loop.cancel();
      this.loop = null;
    }
    this.capture.resumePreviewLoop();
  }

  /** Per-frame handler — runs detect, decides whether to advance. */
  private onFrame(landmarker: FaceLandmarker, videoEl: HTMLVideoElement): void {
    if (videoEl.readyState < 2) return;
    if (this.targetIndex >= SCAN_TARGETS.length) return;

    const ts = this.capture.bumpDetectTimestamp();
    let result: FaceLandmarkerResult;
    try {
      result = landmarker.detectForVideo(videoEl, ts);
    } catch (err) {
      // Non-fatal: a single failed detect shouldn't abort the scan. Skip
      // this frame and try again next tick.
      console.warn('FaceScanner: detectForVideo threw', err);
      return;
    }

    const lm = result.faceLandmarks?.[0];
    const matrix = result.facialTransformationMatrixes?.[0];
    const target = SCAN_TARGETS[this.targetIndex];

    if (!lm || !matrix) {
      // No face / no matrix this frame — reset the hold timer so the user
      // has to re-acquire the pose before we capture.
      this.holdStartMs = null;
      this.emitProgress(null, false);
      return;
    }

    const { yaw, pitch } = yawPitchFromMatrix(matrix);

    // Low-pass to damp the per-frame jitter.
    if (this.smoothedYaw === null) this.smoothedYaw = yaw;
    else this.smoothedYaw += POSE_SMOOTHING_ALPHA * (yaw - this.smoothedYaw);
    if (this.smoothedPitch === null) this.smoothedPitch = pitch;
    else this.smoothedPitch += POSE_SMOOTHING_ALPHA * (pitch - this.smoothedPitch);

    const dy = Math.abs(this.smoothedYaw - target.targetYaw);
    const dp = Math.abs(this.smoothedPitch - target.targetPitch);
    // Profile poses use a wider tolerance — see POSE_TOLERANCE_RAD_PROFILE.
    const tol =
      target.pose === 'profile-left' || target.pose === 'profile-right'
        ? POSE_TOLERANCE_RAD_PROFILE
        : POSE_TOLERANCE_RAD;
    const inTolerance = dy <= tol && dp <= tol;

    const now = performance.now();
    if (inTolerance) {
      if (this.holdStartMs === null) this.holdStartMs = now;
      const heldFor = now - this.holdStartMs;
      if (heldFor >= HOLD_DURATION_MS) {
        // Capture this pose.
        try {
          const lmArr = lm as NormalizedLandmark[];
          const videoW = videoEl.videoWidth;
          const videoH = videoEl.videoHeight;
          // Try the bbox-driven crop first — same pipeline as the snapshot
          // path (capture.ts). When the core-face landmarks are reliable
          // and produce a non-degenerate bbox, this gives a tight head
          // crop instead of center-square (which leaves the face occupying
          // only ~25% of the saved photo on a typical room-distance shot).
          //
          // For profile-left / profile-right poses the cheek landmarks
          // collapse and chooseBboxOrFallback returns null — those poses
          // hit the center-crop path below, which is fine: they're stored
          // for future texture blending and don't need tight cropping.
          const bbox = chooseBboxOrFallback(lmArr);
          if (!bbox) {
            console.warn(
              `[scan] face-bbox rejected (size or out-of-frame). Falling back to center-crop. ` +
                `If this fires often, the user is sitting too close or moving past frame edges.`,
            );
          }
          let dataUrl: string;
          let reprojected: NormalizedLandmark[];
          if (bbox && videoW > 0 && videoH > 0) {
            const square = padToSquarePixels(bbox, videoW, videoH);
            const cropped = cropToSquareDataUrl(
              videoEl,
              videoW,
              videoH,
              square,
              null,
            );
            dataUrl = cropped.dataUrl;
            // Re-project landmarks into the cropped image's [0,1] space.
            // Use scan.ts's reprojectLandmarksToCrop so we preserve z and
            // visibility (capture.ts's landmarksToCropLocal returns a flat
            // x/y-only array — fine for the snapshot path's flat storage,
            // but the scan stores full NormalizedLandmarks).
            reprojected = reprojectLandmarksToCrop(
              lmArr,
              videoW,
              videoH,
              cropped.sx,
              cropped.sy,
              cropped.sSize,
            );
          } else {
            // Fallback: center-square crop. Used for profile poses (where
            // the bbox is degenerate) and any frame where the core-face
            // landmarks don't pass the confidence/size gate.
            const snap = snapshotFrameToDataUrl(videoEl);
            dataUrl = snap.dataUrl;
            // Re-project landmarks from raw MediaPipe (source-webcam) space
            // into the cropped image's coord space so mesh-builder + headShape
            // math match the texture content. Critical for non-square webcams
            // (e.g. 1280×720) — without this the eye-distance + face-aspect
            // measurements come out warped by the source aspect ratio.
            reprojected = reprojectLandmarksToCrop(
              lmArr,
              snap.videoW,
              snap.videoH,
              snap.cropX,
              snap.cropY,
              snap.cropSize,
            );
          }
          this.captured.push({
            pose: target.pose,
            imageDataUrl: dataUrl,
            landmarks: reprojected,
          });
        } catch (err) {
          console.warn('FaceScanner: snapshot failed', err);
          this.holdStartMs = null;
          this.emitProgress(null, true);
          return;
        }
        this.targetIndex += 1;
        this.holdStartMs = null;
        // Reset smoothing on advance — different target = different "rest"
        // value, no point dragging old values into the new tolerance window.
        this.smoothedYaw = null;
        this.smoothedPitch = null;
        if (this.targetIndex >= SCAN_TARGETS.length) {
          this.emitProgress(null, true);
          this.completeSuccess();
          return;
        }
      }
      this.emitProgress({ inTolerance, heldFor }, true);
    } else {
      // Outside tolerance — reset hold timer.
      this.holdStartMs = null;
      this.emitProgress({ inTolerance, heldFor: 0 }, true);
    }
  }

  private emitProgress(
    holdInfo: { inTolerance: boolean; heldFor: number } | null,
    faceVisible: boolean,
  ): void {
    if (!this.progressCb) return;
    const idx = Math.min(this.targetIndex, SCAN_TARGETS.length - 1);
    const target = SCAN_TARGETS[idx];
    let status: string;
    let holdProgress = 0;
    if (this.targetIndex >= SCAN_TARGETS.length) {
      status = 'Done!';
      holdProgress = 1;
    } else if (holdInfo === null) {
      status = target.instruction;
    } else if (holdInfo.inTolerance) {
      holdProgress = Math.min(1, holdInfo.heldFor / HOLD_DURATION_MS);
      status = `Hold... ${Math.ceil((HOLD_DURATION_MS - holdInfo.heldFor) / 100) / 10}s`;
    } else {
      status = target.instruction;
    }
    // Profile poses get a wider tolerance window — surface that to the UI
    // so it can render the in-range/out-of-range color band correctly.
    const toleranceRad =
      target.pose === 'profile-left' || target.pose === 'profile-right'
        ? POSE_TOLERANCE_RAD_PROFILE
        : POSE_TOLERANCE_RAD;
    this.progressCb(
      this.targetIndex,
      SCAN_TARGETS.length,
      status,
      {
        pose: target.pose,
        targetYaw: target.targetYaw,
        targetPitch: target.targetPitch,
        yaw: this.smoothedYaw,
        pitch: this.smoothedPitch,
        faceVisible,
        toleranceRad,
        holdProgress,
      },
    );
  }

  private completeSuccess(): void {
    if (this.cancelled) return;
    this.cleanup();
    if (this.resolveScan) {
      const r = this.resolveScan;
      this.resolveScan = null;
      this.rejectScan = null;
      r();
    }
  }
}
