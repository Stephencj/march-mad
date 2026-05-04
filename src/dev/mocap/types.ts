/**
 * Shared types for the mocap pipeline:
 *   webcam → MediaPipe PoseLandmarker → MocapClip → retarget → PoseClip
 *           → direct playback (AnimLoop) and/or procedural fitter (animConfig)
 *
 * MocapClip = raw MediaPipe landmarks per frame (JSON-serializable; the
 *             portable on-disk format).
 * PoseClip  = retargeted joint rotations matching the dad-bod rig in
 *             src/game/player.ts (~20 rotation joints, mostly 1-DOF).
 *
 * The pipeline currently targets cyclic / pose-based animations only —
 * idle, walk, walk-backward, sprint, dribble*, guard. Multi-phase timed
 * actions (shoot, jump, jump-block, dunk, fall, pass) are hand-authored
 * in the existing anim-config and are out of scope.
 */

/** Names for the 33 MediaPipe PoseLandmarker landmarks (BlazePose). */
export const MP_POSE = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export type MpLandmarkName = keyof typeof MP_POSE;

export interface MpLandmark {
  x: number;
  y: number;
  z: number;
  /** MediaPipe visibility/confidence in [0, 1]. */
  visibility: number;
}

/**
 * Animations the mocap pipeline currently targets. Multi-phase timed actions
 * (shoot/jump/jump-block/dunk/fall/pass) are intentionally absent — they're
 * hand-authored in anim-config and don't lend themselves to mocap fitting.
 */
export type MocapTargetAnim =
  | 'idle'
  | 'walk'
  | 'walk-backward'
  | 'sprint'
  | 'dribble'
  | 'dribble-walk'
  | 'dribble-sprint'
  | 'guard'
  | 'custom';

/** Capture orientation hint. The fitter uses this to warn when a side-on
 *  clip is being used to drive a front-on animation (or vice versa) since
 *  single-camera Z accuracy degrades for limbs moving toward/away from
 *  the camera. */
export type MocapOrientation = 'side' | 'front' | 'three-quarter';

export interface MocapFrame {
  /** Seconds since clip start (frame 0 has t=0). */
  t: number;
  /**
   * 33 landmarks in MediaPipe **world** coordinates (meters; origin at hip
   * midpoint, unstable absolute scale across sessions). Length === 33;
   * index by MP_POSE.* constants.
   *
   * MediaPipe world axis convention:
   *   +x → subject's right
   *   +y → down
   *   +z → toward camera
   * Three.js convention is +y up, so retargeting must flip y.
   */
  world: MpLandmark[];
  /**
   * Optional 33 normalized image-space landmarks (x,y in [0,1]; z relative
   * depth). Useful only for the preview overlay; retargeting ignores this.
   */
  image?: MpLandmark[];
}

/** A recorded clip ready to retarget. JSON-serializable; saved to IndexedDB
 *  by the editor and exportable via file download. */
export interface MocapClip {
  __version: 1;
  /** Author-supplied name (e.g. 'walk-side-2026-04-29-1'). */
  name: string;
  targetAnim: MocapTargetAnim;
  orientation: MocapOrientation;
  /** Target capture rate; actual per-frame timestamps live in `frames[i].t`. */
  fps: number;
  /** ISO 8601 capture timestamp. */
  capturedAt: string;
  frames: MocapFrame[];
}

/**
 * Per-frame joint rotations for the dad-bod rig in src/game/player.ts.
 * All rotations in radians. Sign conventions follow the existing animate()
 * loop:
 *   - hip.x / knee positive  → forward swing / flex
 *   - shoulder.x positive    → forward arm swing
 *   - elbow positive         → flex (forearm toward biceps)
 *   - body-pivot.x positive  → forward lean
 */
export interface PoseFrame {
  t: number;
  /** Vertical displacement of body-pivot above its base (meters; 0 = neutral
   *  pose height, positive = up). Drives bounce / squash-stretch. */
  bodyY: number;
  /** body-pivot rotation (lean / yaw / tilt). */
  bodyPivot: { x: number; y: number; z: number };
  /** Pelvis twist (applied to hip-mesh.rotation.y). */
  hipMeshY: number;
  /** Shoulder counter-twist (applied to torso.rotation.y). */
  torsoY: number;
  /** neck-group rotation (head pitch/yaw/roll). */
  neck: { x: number; y: number; z: number };
  /** Shoulder rotations (x = sagittal swing, z = lateral spread/raise). */
  shoulderL: { x: number; z: number };
  shoulderR: { x: number; z: number };
  /** Elbow flex (rotation.x). */
  elbowL: number;
  elbowR: number;
  /** Hip rotations (x = sagittal lift, z = lateral spread). */
  hipL: { x: number; z: number };
  hipR: { x: number; z: number };
  /** Knee flex (rotation.x). */
  kneeL: number;
  kneeR: number;
}

/**
 * Per-clip / per-session baseline subtracted from each live frame's
 * orientation joints. Captured once when the user holds a neutral pose
 * (`makeCalibration`) and applied every frame thereafter (`retargetFrame`).
 *
 * Mirrors the per-clip median subtraction that recorded-mode `retarget()`
 * applies internally for cyclic anims — but for a streaming use case where
 * the median can't be known up front. Only orientation joints are
 * subtracted; `elbow`/`knee` flex stay absolute (they're meaningful
 * animation values, not biases) and `bodyY` is computed as a delta off
 * the calibration's `footDistance` directly.
 *
 * `NEUTRAL_CALIBRATION` (all zeros + zero footDistance) is the no-op
 * baseline; `retargetFrame(lm, NEUTRAL_CALIBRATION)` returns absolute
 * joint angles without any subtraction.
 */
export interface RetargetCalibration {
  bodyPivot: { x: number; y: number; z: number };
  hipMeshY: number;
  torsoY: number;
  neck: { x: number; y: number; z: number };
  shoulderL: { x: number; z: number };
  shoulderR: { x: number; z: number };
  hipL: { x: number; z: number };
  hipR: { x: number; z: number };
  /** Foot-to-hip distance (meters) at calibration time; subtracted from
   *  current frame's distance to give `bodyY`. */
  footDistance: number;
  /** Torso length (meters) at calibration time, exposed so the live caller
   *  can scale `bodyY` to the rig's torso when applying. */
  torsoLength: number;
}

/** Retargeted clip ready to feed into AnimLoop (direct playback) or the
 *  procedural fitter. */
export interface PoseClip {
  __version: 1;
  source: {
    name: string;
    targetAnim: MocapTargetAnim;
    orientation: MocapOrientation;
  };
  fps: number;
  /**
   * Reference torso length used to normalize world coords (meters).
   * Defined as the average shoulder-midpoint → hip-midpoint distance over
   * the visible portion of the clip.
   */
  torsoLength: number;
  frames: PoseFrame[];
}
