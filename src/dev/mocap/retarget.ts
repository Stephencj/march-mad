/**
 * MocapClip → PoseClip retargeter.
 *
 * Pure-function math (no DOM, no THREE.js, no I/O). For each MediaPipe world
 * frame this builds a per-frame body coordinate frame (up / right / forward)
 * and decomposes limb segments into the joint rotations expected by the
 * dad-bod rig in `src/game/player.ts`.
 *
 * Sign conventions (all matching the locked contract in `./types.ts` and the
 * runtime in `GamePlayer.animate()`):
 *
 *   - `bodyPivot.x`  positive → forward lean (torso `up` tilts toward body
 *                    `forward` = world +z for a front-facing subject)
 *   - `bodyPivot.y`  positive → yaw (Three.js Y rotation; takes neutral +x
 *                    "right" axis toward -z)
 *   - `bodyPivot.z`  positive → roll (subject leans toward subject's left,
 *                    i.e. body `up` tilts toward `-right`)
 *   - `hipMeshY`     positive → pelvis twisted so the right hip is "behind"
 *                    relative to body forward (the shoulder counter-twist
 *                    `torsoY` then has the opposite sign during a walk)
 *   - `torsoY`       same yaw convention as `hipMeshY`, applied to shoulders
 *   - `neck.x`       positive → head pitches forward (toward body `forward`)
 *   - `neck.y`       positive → head yaws to subject's left
 *   - `neck.z`       set to 0 (single-camera roll from NOSE alone is too
 *                    noisy; estimating it would require LEFT_EAR/RIGHT_EAR)
 *   - `shoulder.x`   positive → forward arm swing (matches walk anim where
 *                    `shoulderL.rotation.x = stride * armSwingRatio` puts
 *                    the left arm forward when stride > 0)
 *   - `shoulder.z`   signed angle of the upper arm out of the body's
 *                    sagittal plane, measured toward body `+right`. So
 *                    `shoulderL.z` is **negative** when the left arm is
 *                    raised laterally and `shoulderR.z` is **positive** when
 *                    the right arm is raised laterally — exactly matching
 *                    the rig's guard pose (`shoulderL.z = -0.4`,
 *                    `shoulderR.z = +0.4`). The contract's "raised laterally
 *                    = positive" wording is interpreted as a magnitude
 *                    statement; the sign is mirrored by side to match the
 *                    rig.
 *   - `elbow`        in [0, π], 0 = arm straight, π = fully folded
 *                    (computed as `angle(elbow-shoulder, wrist-elbow)` —
 *                    the locked contract's `π − angle(...)` doc-comment
 *                    is inverted; see `flexAngle` for the derivation)
 *   - `hip.x`        positive → knee forward of hip (sagittal lift) — same
 *                    convention as the runtime walk (`hipR.rotation.x =
 *                    stride` makes the right knee swing forward when
 *                    stride > 0).
 *   - `hip.z`        same lateral convention as `shoulder.z` (mirrored by
 *                    side).
 *   - `knee`         in [0, π], 0 = leg straight, π = fully folded
 *
 * Visibility gating: any landmark with `visibility < VIS_THRESHOLD` causes
 * the dependent joint(s) to hold the previous frame's value. The very first
 * frame falls back to a neutral pose if anything is occluded.
 */

import {
  MP_POSE,
  type MocapClip,
  type MocapFrame,
  type MpLandmark,
  type PoseClip,
  type PoseFrame,
  type RetargetCalibration,
} from './types';

// ---------- 3D vector helpers (plain {x,y,z}; no class) -----------------

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

function normalize(a: Vec3): Vec3 {
  const l = length(a);
  if (l < 1e-9) return v(0, 0, 0);
  return scale(a, 1 / l);
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return scale(add(a, b), 0.5);
}

/** Project `a` onto the plane whose normal is the unit vector `n`. */
function projectOntoPlane(a: Vec3, n: Vec3): Vec3 {
  return sub(a, scale(n, dot(a, n)));
}

/** Angle between two vectors, robust to numerical drift in acos. */
function angleBetween(a: Vec3, b: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const c = dot(a, b) / (la * lb);
  // Clamp before acos — `dot/|a||b|` can drift slightly outside [-1, 1].
  if (c >= 1) return 0;
  if (c <= -1) return Math.PI;
  return Math.acos(c);
}

// ---------- MediaPipe → world-frame conversion ---------------------------

/**
 * Convert a MediaPipe BlazePose world landmark into the Three.js convention.
 *
 * MediaPipe BlazePose world axes (verified empirically against PoseLandmarker
 * output for camera-facing subjects):
 *   +x → subject's right
 *   +y → DOWN (gravity)
 *   +z → AWAY from camera (out the subject's back when facing camera)
 *
 * Three.js uses +y up, +z toward camera, so both y and z flip. (An earlier
 * version of this file flipped only y because the docstring guessed MediaPipe
 * +z = toward camera; that produced a consistent ~25° backward-lean error
 * and arm/leg signals projected into the wrong half of the sagittal plane.)
 */
function lmToVec(l: MpLandmark): Vec3 {
  return { x: l.x, y: -l.y, z: -l.z };
}

// ---------- Body frame ---------------------------------------------------

interface BodyFrame {
  origin: Vec3; // hip midpoint (in Three.js coords; always ≈ (0,0,0) since
  // MediaPipe world landmarks are hip-centered by definition)
  up: Vec3; // hip-mid → shoulder-mid, normalized
  right: Vec3; // mean of pelvis & shoulder lateral axes, projected to be ⟂ up
  forward: Vec3; // right × up
  /**
   * Distance from hip-mid down to the *lower* of the two ankles (always
   * positive, in meters). This is the bounce signal: as the subject's hip
   * rises, the planted foot stays put so the gap grows. Replaces the
   * earlier (always-zero) hip-Y signal — MediaPipe's hip-centered world
   * coords pin `hipMid.y` to 0 every frame, so it has no bounce content.
   */
  footDistance: number;
  /** `shoulderMid - hipMid` length for the frame; used for clip-wide scale. */
  torsoLen: number;
}

function buildBodyFrame(
  leftHip: Vec3,
  rightHip: Vec3,
  leftShoulder: Vec3,
  rightShoulder: Vec3,
  leftAnkle: Vec3,
  rightAnkle: Vec3,
): BodyFrame {
  const hipMid = midpoint(leftHip, rightHip);
  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const up = normalize(sub(shoulderMid, hipMid));
  // The trunk's lateral axis is the **average** of the pelvis lateral axis
  // and the shoulder lateral axis. This matters because in a walk the
  // pelvis and shoulders counter-rotate around the spine: defining `right`
  // off the pelvis alone would make `hipMeshY` always zero (it's the same
  // axis we'd be subtracting). The mean represents the trunk's overall
  // yaw, and `hipMeshY` / `torsoY` are then the per-girdle deltas from it.
  const pelvisLat = sub(rightHip, leftHip);
  const shoulderLat = sub(rightShoulder, leftShoulder);
  const lateralRaw = add(
    normalize(projectOntoPlane(pelvisLat, up)),
    normalize(projectOntoPlane(shoulderLat, up)),
  );
  const right = normalize(lateralRaw);
  // forward = right × up gives a right-handed forward vector that for a
  // front-facing subject (right ≈ +x, up ≈ +y) yields forward ≈ +z, which
  // matches the Three.js +z = "toward camera" convention.
  const forward = normalize(cross(right, up));
  // Lower ankle = whichever foot is currently planted (lower y in Three.js
  // means closer to ground). footDistance = how far below hip-mid that foot
  // sits. Hip-mid is at origin, so this is just `-lowerAnkle.y`.
  const lowerAnkleY = Math.min(leftAnkle.y, rightAnkle.y);
  const footDistance = hipMid.y - lowerAnkleY; // both in Three.js +y up
  return {
    origin: hipMid,
    up,
    right,
    forward,
    footDistance,
    torsoLen: length(sub(shoulderMid, hipMid)),
  };
}

// ---------- Per-joint extractors -----------------------------------------

/**
 * Sagittal swing of an arm/leg segment. Positive = segment swings toward
 * body `forward` (i.e. forward swing for arms, knee-forward-of-hip for
 * legs). `seg` need not be unit length.
 */
function sagittalSwing(seg: Vec3, frame: BodyFrame): number {
  // Project onto the sagittal plane (the plane containing `up` and
  // `forward`, i.e. the plane whose normal is `right`).
  const sagittal = projectOntoPlane(seg, frame.right);
  // Measure angle from -up toward +forward.
  const fwd = dot(sagittal, frame.forward);
  const upComp = dot(sagittal, frame.up);
  // If the segment is purely lateral (e.g. T-pose arm), the sagittal
  // projection is degenerate and the swing angle is ill-defined. Default
  // to 0 rather than letting `atan2(±0, ±0)` produce ±π.
  if (Math.abs(fwd) < 1e-9 && Math.abs(upComp) < 1e-9) return 0;
  return Math.atan2(fwd, -upComp);
}

/**
 * Lateral spread out of the sagittal plane, measured toward body `+right`.
 * Returns the *signed* lateral angle; the caller decides what "spread"
 * means for left vs right limbs (the rig's signs are mirrored, see file
 * header).
 */
function lateralSpread(seg: Vec3, frame: BodyFrame): number {
  const lateral = dot(seg, frame.right);
  const sagittal = projectOntoPlane(seg, frame.right);
  const sagLen = length(sagittal);
  return Math.atan2(lateral, sagLen);
}

/**
 * Flex angle for a 2-segment chain (shoulder→elbow→wrist or
 * hip→knee→ankle). Returns 0 for a straight limb and π for a fully
 * folded one.
 *
 * The interior anatomical angle at the joint is the angle between
 * (proximal-MID) and (distal-MID), both originating at the joint:
 *   interior = angle(prox - mid, dist - mid)
 *   flex     = π − interior
 *
 * Substituting `prox - mid = -(mid - prox)` and using
 * `angle(-a, b) = π − angle(a, b)`, this simplifies to
 *   flex = angle(mid - prox, dist - mid)
 *
 * which is what we compute. (The contract doc-comment writes this as
 * `π − angle(upper, lower)`; that wording is the inverse of what's
 * intended — the test suite is the ground truth and asserts
 * `kneeL ≈ 0` for a straight leg and `kneeL ≈ π/2` for a 90° fold.)
 */
function flexAngle(prox: Vec3, mid: Vec3, dist: Vec3): number {
  const upper = sub(mid, prox);
  const lower = sub(dist, mid);
  return angleBetween(upper, lower);
}

/** Yaw of a vector projected on the world XZ plane, in Three.js Y-rotation
 *  sign convention: positive Y rotation takes +x toward -z. So a vector
 *  pointing along +x has yaw 0, and a vector along -z has yaw +π/2. */
function yawXZ(vec: Vec3): number {
  return -Math.atan2(vec.z, vec.x);
}

// ---------- Visibility ---------------------------------------------------

const VIS_THRESHOLD = 0.3;

/** Indices of landmarks that gate each joint. If any of these are below
 *  `VIS_THRESHOLD` for a given frame, the gated value is held over. */
const GATING = {
  body: [
    MP_POSE.LEFT_HIP,
    MP_POSE.RIGHT_HIP,
    MP_POSE.LEFT_SHOULDER,
    MP_POSE.RIGHT_SHOULDER,
  ] as const,
  shoulderL: [MP_POSE.LEFT_SHOULDER, MP_POSE.LEFT_ELBOW] as const,
  shoulderR: [MP_POSE.RIGHT_SHOULDER, MP_POSE.RIGHT_ELBOW] as const,
  elbowL: [
    MP_POSE.LEFT_SHOULDER,
    MP_POSE.LEFT_ELBOW,
    MP_POSE.LEFT_WRIST,
  ] as const,
  elbowR: [
    MP_POSE.RIGHT_SHOULDER,
    MP_POSE.RIGHT_ELBOW,
    MP_POSE.RIGHT_WRIST,
  ] as const,
  hipL: [MP_POSE.LEFT_HIP, MP_POSE.LEFT_KNEE] as const,
  hipR: [MP_POSE.RIGHT_HIP, MP_POSE.RIGHT_KNEE] as const,
  kneeL: [MP_POSE.LEFT_HIP, MP_POSE.LEFT_KNEE, MP_POSE.LEFT_ANKLE] as const,
  kneeR: [MP_POSE.RIGHT_HIP, MP_POSE.RIGHT_KNEE, MP_POSE.RIGHT_ANKLE] as const,
  neck: [
    MP_POSE.NOSE,
    MP_POSE.LEFT_SHOULDER,
    MP_POSE.RIGHT_SHOULDER,
  ] as const,
};

function allVisible(world: MpLandmark[], indices: readonly number[]): boolean {
  for (const i of indices) {
    if (!world[i] || world[i].visibility < VIS_THRESHOLD) return false;
  }
  return true;
}

// ---------- Neutral pose (fallback for first frame) ----------------------

function neutralPose(t: number): PoseFrame {
  return {
    t,
    bodyY: 0,
    bodyPivot: { x: 0, y: 0, z: 0 },
    hipMeshY: 0,
    torsoY: 0,
    neck: { x: 0, y: 0, z: 0 },
    shoulderL: { x: 0, z: 0 },
    shoulderR: { x: 0, z: 0 },
    elbowL: 0,
    elbowR: 0,
    hipL: { x: 0, z: 0 },
    hipR: { x: 0, z: 0 },
    kneeL: 0,
    kneeR: 0,
  };
}

// ---------- Per-frame retarget (no visibility / no held values yet) ------

/**
 * Internal: compute joint values for one frame, given a pre-built body
 * frame and the world landmarks. Visibility gating is layered on top by
 * `retarget()`.
 */
function computeJoints(world: Vec3[], frame: BodyFrame): Omit<PoseFrame, 't' | 'bodyY'> {
  const leftShoulder = world[MP_POSE.LEFT_SHOULDER];
  const rightShoulder = world[MP_POSE.RIGHT_SHOULDER];
  const leftElbow = world[MP_POSE.LEFT_ELBOW];
  const rightElbow = world[MP_POSE.RIGHT_ELBOW];
  const leftWrist = world[MP_POSE.LEFT_WRIST];
  const rightWrist = world[MP_POSE.RIGHT_WRIST];
  const leftHip = world[MP_POSE.LEFT_HIP];
  const rightHip = world[MP_POSE.RIGHT_HIP];
  const leftKnee = world[MP_POSE.LEFT_KNEE];
  const rightKnee = world[MP_POSE.RIGHT_KNEE];
  const leftAnkle = world[MP_POSE.LEFT_ANKLE];
  const rightAnkle = world[MP_POSE.RIGHT_ANKLE];
  const nose = world[MP_POSE.NOSE];

  // ----- bodyPivot -----
  // bodyPivot.x: forward lean — angle of body `up` from world +Y, in the
  // sagittal plane (Y-Z). Positive when up tilts toward +z (forward lean).
  const bodyPivotX = Math.atan2(frame.up.z, frame.up.y);
  // bodyPivot.y: torso yaw — angle of `right` projected on world XZ plane
  // vs world +x (Three.js Y-rotation convention: positive takes +x → -z).
  const bodyPivotY = yawXZ(frame.right);
  // bodyPivot.z: side tilt (roll). Angle of `up` from world +Y in the
  // X-Y plane. Positive when up tilts toward -x (subject leans to their
  // left, i.e. `right` axis tips up). Documented as small/unreliable.
  const bodyPivotZ = Math.atan2(-frame.up.x, frame.up.y);

  // ----- hipMeshY / torsoY -----
  // pelvis vector: subject-right-hip MINUS subject-left-hip; this points
  // along `+right` in the neutral (un-twisted) pose. Its yaw in the world
  // XZ plane minus the body's overall yaw is the residual pelvic twist.
  const pelvisVec = sub(rightHip, leftHip);
  const pelvisYaw = yawXZ(pelvisVec);
  // Wrap residual to (-π, π].
  const hipMeshY = wrapPi(pelvisYaw - bodyPivotY);
  const shoulderVec = sub(rightShoulder, leftShoulder);
  const shoulderYaw = yawXZ(shoulderVec);
  const torsoY = wrapPi(shoulderYaw - bodyPivotY);

  // ----- neck -----
  // Head direction: shoulder midpoint → nose, expressed in body frame.
  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const headDir = sub(nose, shoulderMid);
  const hRight = dot(headDir, frame.right);
  const hUp = dot(headDir, frame.up);
  const hFwd = dot(headDir, frame.forward);
  // neck.x: pitch — angle from body `up` toward body `forward`. Positive
  // when the nose is forward of the neck (head tilted forward).
  const neckX = Math.atan2(hFwd, hUp);
  // neck.y: yaw — angle from body `up` toward `-right`. Positive when
  // the nose is to subject's left (body `-right` direction). Sign chosen
  // so a left head-turn matches the rig's positive Y rotation.
  const neckY = Math.atan2(-hRight, hUp);
  // neck.z: roll — needs ear landmarks (LEFT_EAR / RIGHT_EAR) to estimate
  // reliably. Single-camera estimates from NOSE alone are too noisy, so
  // we leave it at zero. Documented in file header.
  const neckZ = 0;

  // ----- Shoulders -----
  const armDirL = sub(leftElbow, leftShoulder);
  const armDirR = sub(rightElbow, rightShoulder);
  const shoulderLX = sagittalSwing(armDirL, frame);
  const shoulderRX = sagittalSwing(armDirR, frame);
  const shoulderLZ = lateralSpread(armDirL, frame); // negative when left arm spreads out
  const shoulderRZ = lateralSpread(armDirR, frame); // positive when right arm spreads out

  // ----- Elbows -----
  const elbowL = flexAngle(leftShoulder, leftElbow, leftWrist);
  const elbowR = flexAngle(rightShoulder, rightElbow, rightWrist);

  // ----- Hips (sagittal lift / lateral spread of upper leg) -----
  const legDirL = sub(leftKnee, leftHip);
  const legDirR = sub(rightKnee, rightHip);
  const hipLX = sagittalSwing(legDirL, frame);
  const hipRX = sagittalSwing(legDirR, frame);
  const hipLZ = lateralSpread(legDirL, frame); // negative when left leg abducts outward
  const hipRZ = lateralSpread(legDirR, frame); // positive when right leg abducts outward

  // ----- Knees -----
  const kneeL = flexAngle(leftHip, leftKnee, leftAnkle);
  const kneeR = flexAngle(rightHip, rightKnee, rightAnkle);

  return {
    bodyPivot: { x: bodyPivotX, y: bodyPivotY, z: bodyPivotZ },
    hipMeshY,
    torsoY,
    neck: { x: neckX, y: neckY, z: neckZ },
    shoulderL: { x: shoulderLX, z: shoulderLZ },
    shoulderR: { x: shoulderRX, z: shoulderRZ },
    elbowL,
    elbowR,
    hipL: { x: hipLX, z: hipLZ },
    hipR: { x: hipRX, z: hipRZ },
    kneeL,
    kneeR,
  };
}

/** Wrap an angle into (-π, π]. */
function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

// ---------- Public entry point ------------------------------------------

/**
 * Retarget a raw MediaPipe `MocapClip` into a `PoseClip` of dad-bod rig
 * joint rotations.
 *
 * Pure: no side effects, no I/O, no THREE.js / DOM imports. The returned
 * object owns all of its arrays (no aliasing of the input).
 */
export function retarget(clip: MocapClip): PoseClip {
  const n = clip.frames.length;

  // ---- Pass 1: build body frames + collect torso lengths and hip-Y ----
  // We need the median hip-Y over the whole clip to define a per-clip
  // baseline for `bodyY` (the bounce signal), and the mean torso length
  // for normalization / `PoseClip.torsoLength`.
  type FrameWork = {
    body: BodyFrame | null;
    worldVecs: Vec3[];
    bodyVisible: boolean;
  };
  const work: FrameWork[] = [];
  const torsoLengths: number[] = [];
  const footDistances: number[] = [];

  for (let i = 0; i < n; i++) {
    const f = clip.frames[i];
    const worldVecs = f.world.map(lmToVec);
    const bodyVisible = allVisible(f.world, GATING.body);
    let body: BodyFrame | null = null;
    // Need ankles to compute footDistance (the bounce signal). If they're
    // occluded, fall back to skipping bounce contribution for this frame.
    const anklesVisible =
      f.world[MP_POSE.LEFT_ANKLE] != null &&
      f.world[MP_POSE.RIGHT_ANKLE] != null &&
      f.world[MP_POSE.LEFT_ANKLE].visibility >= VIS_THRESHOLD &&
      f.world[MP_POSE.RIGHT_ANKLE].visibility >= VIS_THRESHOLD;
    if (bodyVisible) {
      body = buildBodyFrame(
        worldVecs[MP_POSE.LEFT_HIP],
        worldVecs[MP_POSE.RIGHT_HIP],
        worldVecs[MP_POSE.LEFT_SHOULDER],
        worldVecs[MP_POSE.RIGHT_SHOULDER],
        worldVecs[MP_POSE.LEFT_ANKLE],
        worldVecs[MP_POSE.RIGHT_ANKLE],
      );
      if (body.torsoLen > 1e-6) torsoLengths.push(body.torsoLen);
      if (anklesVisible) footDistances.push(body.footDistance);
    }
    work.push({ body, worldVecs, bodyVisible });
  }

  const torsoLength =
    torsoLengths.length > 0
      ? torsoLengths.reduce((a, b) => a + b, 0) / torsoLengths.length
      : 0;
  const baselineFootDistance = footDistances.length > 0 ? median(footDistances) : 0;

  // ---- Pass 2: per-frame joint extraction with visibility hold-over ----
  const out: PoseFrame[] = [];
  let prev: PoseFrame | null = null;

  for (let i = 0; i < n; i++) {
    const f = clip.frames[i];
    const w = work[i];
    const fallback: PoseFrame = prev ?? neutralPose(f.t);

    // If the body frame itself can't be built, hold the entire previous
    // frame's joints (or use neutral).
    if (!w.body || !w.bodyVisible) {
      const held: PoseFrame = {
        ...fallback,
        t: f.t,
      };
      out.push(held);
      prev = held;
      continue;
    }

    const joints = computeJoints(w.worldVecs, w.body);

    // bodyY: vertical hip displacement, in meters, relative to clip baseline.
    // We can't read it off `hipMid.y` directly (MediaPipe pins hip-mid at
    // origin every frame), so we use the gap between hip and the lower foot
    // as a proxy: when the hip rises, the planted foot stays put, so the
    // gap grows. Sign: positive = hip is higher than baseline.
    const bodyY = w.body.footDistance - baselineFootDistance;

    // Visibility gating per-joint. Anything occluded → hold previous.
    const world = f.world;
    const shoulderLOK = allVisible(world, GATING.shoulderL);
    const shoulderROK = allVisible(world, GATING.shoulderR);
    const elbowLOK = allVisible(world, GATING.elbowL);
    const elbowROK = allVisible(world, GATING.elbowR);
    const hipLOK = allVisible(world, GATING.hipL);
    const hipROK = allVisible(world, GATING.hipR);
    const kneeLOK = allVisible(world, GATING.kneeL);
    const kneeROK = allVisible(world, GATING.kneeR);
    const neckOK = allVisible(world, GATING.neck);

    const pose: PoseFrame = {
      t: f.t,
      bodyY,
      bodyPivot: { ...joints.bodyPivot },
      hipMeshY: joints.hipMeshY,
      torsoY: joints.torsoY,
      neck: neckOK ? { ...joints.neck } : { ...fallback.neck },
      shoulderL: shoulderLOK
        ? { ...joints.shoulderL }
        : { ...fallback.shoulderL },
      shoulderR: shoulderROK
        ? { ...joints.shoulderR }
        : { ...fallback.shoulderR },
      elbowL: elbowLOK ? joints.elbowL : fallback.elbowL,
      elbowR: elbowROK ? joints.elbowR : fallback.elbowR,
      hipL: hipLOK ? { ...joints.hipL } : { ...fallback.hipL },
      hipR: hipROK ? { ...joints.hipR } : { ...fallback.hipR },
      kneeL: kneeLOK ? joints.kneeL : fallback.kneeL,
      kneeR: kneeROK ? joints.kneeR : fallback.kneeR,
    };

    out.push(pose);
    prev = pose;
  }

  // ---- Pass 2.5: light low-pass to suppress MediaPipe Lite's per-frame
  //                jitter (typically 1–2 frame outliers up to ~0.4 rad).
  // Symmetric one-pole EMA, applied forward then backward to keep zero
  // phase lag on cyclic content. α=0.5 gives a corner of ~fps/8 Hz —
  // smooths frame-scale jitter while preserving stride-scale (~1 Hz)
  // motion. Knees and elbows benefit most; orientation joints already get
  // a smoothing benefit from the median baselining below.
  if (out.length >= 3) {
    const ALPHA = 0.5;
    const fields: Array<(p: PoseFrame, get: boolean, val?: number) => number> = [
      (p, g, v) => (g ? p.bodyY : ((p.bodyY = v!), 0)),
      (p, g, v) => (g ? p.bodyPivot.x : ((p.bodyPivot.x = v!), 0)),
      (p, g, v) => (g ? p.bodyPivot.y : ((p.bodyPivot.y = v!), 0)),
      (p, g, v) => (g ? p.bodyPivot.z : ((p.bodyPivot.z = v!), 0)),
      (p, g, v) => (g ? p.hipMeshY : ((p.hipMeshY = v!), 0)),
      (p, g, v) => (g ? p.torsoY : ((p.torsoY = v!), 0)),
      (p, g, v) => (g ? p.neck.x : ((p.neck.x = v!), 0)),
      (p, g, v) => (g ? p.neck.y : ((p.neck.y = v!), 0)),
      (p, g, v) => (g ? p.shoulderL.x : ((p.shoulderL.x = v!), 0)),
      (p, g, v) => (g ? p.shoulderL.z : ((p.shoulderL.z = v!), 0)),
      (p, g, v) => (g ? p.shoulderR.x : ((p.shoulderR.x = v!), 0)),
      (p, g, v) => (g ? p.shoulderR.z : ((p.shoulderR.z = v!), 0)),
      (p, g, v) => (g ? p.elbowL : ((p.elbowL = v!), 0)),
      (p, g, v) => (g ? p.elbowR : ((p.elbowR = v!), 0)),
      (p, g, v) => (g ? p.hipL.x : ((p.hipL.x = v!), 0)),
      (p, g, v) => (g ? p.hipL.z : ((p.hipL.z = v!), 0)),
      (p, g, v) => (g ? p.hipR.x : ((p.hipR.x = v!), 0)),
      (p, g, v) => (g ? p.hipR.z : ((p.hipR.z = v!), 0)),
      (p, g, v) => (g ? p.kneeL : ((p.kneeL = v!), 0)),
      (p, g, v) => (g ? p.kneeR : ((p.kneeR = v!), 0)),
    ];
    for (const acc of fields) {
      // Forward pass.
      let s = acc(out[0], true);
      for (let i = 1; i < out.length; i++) {
        s = ALPHA * acc(out[i], true) + (1 - ALPHA) * s;
        acc(out[i], false, s);
      }
      // Backward pass.
      s = acc(out[out.length - 1], true);
      for (let i = out.length - 2; i >= 0; i--) {
        s = ALPHA * acc(out[i], true) + (1 - ALPHA) * s;
        acc(out[i], false, s);
      }
    }
  }

  // ---- Pass 3: per-clip baseline subtraction for cyclic animations ----
  // BlazePose's canonical body frame puts the shoulder ball joints slightly
  // forward of the hips, so a subject standing perfectly upright still shows
  // ~25° forward lean when measured this way. Likewise the user's posture
  // and any camera misalignment leak constant biases into bodyPivot/yaw,
  // hipMeshY, torsoY, shoulder, hip, and neck. For cyclic animations we
  // care about *deviations* from the subject's neutral pose during the
  // cycle, not the absolute pose, so subtracting the per-clip median for
  // each orientation joint isolates the cyclic content.
  //
  // Static target anims (idle/guard/custom) need the absolute pose to flow
  // into `poses.idle` / `amplitudes.guard.shoulderRaise` etc., so we skip
  // baseline subtraction for those.
  //
  // We never baseline-subtract: bodyY (already relative to its own median),
  // elbowL/elbowR/kneeL/kneeR (their mean *is* the meaningful animation
  // parameter — kneeBase, elbowBend).
  if (CYCLIC_ANIMS.has(clip.targetAnim) && out.length > 0) {
    const med = (pick: (p: PoseFrame) => number): number =>
      median(out.map(pick));

    const bp = {
      x: med((p) => p.bodyPivot.x),
      y: med((p) => p.bodyPivot.y),
      z: med((p) => p.bodyPivot.z),
    };
    const hipMeshYBase = med((p) => p.hipMeshY);
    const torsoYBase = med((p) => p.torsoY);
    const neckBase = {
      x: med((p) => p.neck.x),
      y: med((p) => p.neck.y),
      z: med((p) => p.neck.z),
    };
    const shoulderLBase = { x: med((p) => p.shoulderL.x), z: med((p) => p.shoulderL.z) };
    const shoulderRBase = { x: med((p) => p.shoulderR.x), z: med((p) => p.shoulderR.z) };
    const hipLBase = { x: med((p) => p.hipL.x), z: med((p) => p.hipL.z) };
    const hipRBase = { x: med((p) => p.hipR.x), z: med((p) => p.hipR.z) };

    for (const p of out) {
      p.bodyPivot.x -= bp.x;
      p.bodyPivot.y -= bp.y;
      p.bodyPivot.z -= bp.z;
      p.hipMeshY -= hipMeshYBase;
      p.torsoY -= torsoYBase;
      p.neck.x -= neckBase.x;
      p.neck.y -= neckBase.y;
      p.neck.z -= neckBase.z;
      p.shoulderL.x -= shoulderLBase.x;
      p.shoulderL.z -= shoulderLBase.z;
      p.shoulderR.x -= shoulderRBase.x;
      p.shoulderR.z -= shoulderRBase.z;
      p.hipL.x -= hipLBase.x;
      p.hipL.z -= hipLBase.z;
      p.hipR.x -= hipRBase.x;
      p.hipR.z -= hipRBase.z;
    }
  }

  return {
    __version: 1,
    source: {
      name: clip.name,
      targetAnim: clip.targetAnim,
      orientation: clip.orientation,
    },
    fps: clip.fps,
    torsoLength,
    frames: out,
  };
}

/** Animations whose meaningful signal is the cyclic *deviation* from a
 *  neutral pose (the per-clip median is treated as that neutral and
 *  subtracted). Static animations (idle/guard/custom) are absent — for them
 *  the absolute pose is the parameter we want to capture. */
const CYCLIC_ANIMS: ReadonlySet<MocapClip['targetAnim']> = new Set([
  'walk',
  'walk-backward',
  'sprint',
  'dribble',
  'dribble-walk',
  'dribble-sprint',
]);

/** Median of a non-empty array (does not mutate input). */
function median(xs: number[]): number {
  const sorted = xs.slice().sort((a, b) => a - b);
  const m = sorted.length;
  if (m === 0) return 0;
  if (m % 2 === 1) return sorted[(m - 1) / 2];
  return 0.5 * (sorted[m / 2 - 1] + sorted[m / 2]);
}

// ---------- Live (single-frame, calibration-based) retarget --------------

/**
 * No-op calibration baseline: every orientation joint zeroed, foot/torso
 * lengths zero. `retargetFrame(lm, NEUTRAL_CALIBRATION)` returns absolute
 * frame data with no subtraction (and a meaningless `bodyY` — the caller
 * is responsible for knowing they're getting raw values).
 */
export const NEUTRAL_CALIBRATION: RetargetCalibration = {
  bodyPivot: { x: 0, y: 0, z: 0 },
  hipMeshY: 0,
  torsoY: 0,
  neck: { x: 0, y: 0, z: 0 },
  shoulderL: { x: 0, z: 0 },
  shoulderR: { x: 0, z: 0 },
  hipL: { x: 0, z: 0 },
  hipR: { x: 0, z: 0 },
  footDistance: 0,
  torsoLength: 0,
};

/**
 * Snapshot the current pose as the calibration baseline used by
 * `retargetFrame`. Returns `null` when any of the gating-body landmarks
 * (LEFT/RIGHT shoulder + hip) or either ankle fall below `VIS_THRESHOLD` —
 * the caller should ask the user to reposition and try again.
 *
 * Records only the joints that the cyclic-clip path baselines: bodyPivot,
 * hipMeshY, torsoY, neck, shoulderL/R, hipL/R. Elbow/knee flex and
 * `bodyY` are not captured here because they're not biases — flex is the
 * meaningful animation signal, and `bodyY` is computed live from
 * `footDistance - cal.footDistance`.
 */
export function makeCalibration(
  landmarks: MpLandmark[],
): RetargetCalibration | null {
  if (!allVisible(landmarks, GATING.body)) return null;
  const leftAnkle = landmarks[MP_POSE.LEFT_ANKLE];
  const rightAnkle = landmarks[MP_POSE.RIGHT_ANKLE];
  if (
    !leftAnkle ||
    !rightAnkle ||
    leftAnkle.visibility < VIS_THRESHOLD ||
    rightAnkle.visibility < VIS_THRESHOLD
  ) {
    return null;
  }
  const worldVecs = landmarks.map(lmToVec);
  const body = buildBodyFrame(
    worldVecs[MP_POSE.LEFT_HIP],
    worldVecs[MP_POSE.RIGHT_HIP],
    worldVecs[MP_POSE.LEFT_SHOULDER],
    worldVecs[MP_POSE.RIGHT_SHOULDER],
    worldVecs[MP_POSE.LEFT_ANKLE],
    worldVecs[MP_POSE.RIGHT_ANKLE],
  );
  const joints = computeJoints(worldVecs, body);
  return {
    bodyPivot: { ...joints.bodyPivot },
    hipMeshY: joints.hipMeshY,
    torsoY: joints.torsoY,
    neck: { ...joints.neck },
    shoulderL: { ...joints.shoulderL },
    shoulderR: { ...joints.shoulderR },
    hipL: { ...joints.hipL },
    hipR: { ...joints.hipR },
    footDistance: body.footDistance,
    torsoLength: body.torsoLen,
  };
}

/**
 * Single-frame retarget for live (VTuber-style) mirroring. Builds the body
 * frame, runs `computeJoints`, subtracts the calibration's baseline from
 * each orientation joint inline, and returns a `PoseFrame` with `t = 0`.
 *
 * - `bodyY = body.footDistance - cal.footDistance`. With
 *   `NEUTRAL_CALIBRATION` (footDistance = 0) this equals the raw
 *   foot-to-hip distance, which is meaningless on its own; the caller is
 *   expected to use a real calibration before applying `bodyY`.
 * - Elbow/knee flex are absolute (no calibration subtraction) — they're
 *   meaningful animation values, not biases.
 * - Per-joint visibility hold-over is the caller's job in live mode (just
 *   keep the previous frame around). This function only gates on
 *   `GATING.body`: if the four shoulder/hip landmarks aren't all visible,
 *   we can't build a body frame at all, so we return `null`.
 */
export function retargetFrame(
  landmarks: MpLandmark[],
  cal: RetargetCalibration,
): PoseFrame | null {
  if (!allVisible(landmarks, GATING.body)) return null;
  const worldVecs = landmarks.map(lmToVec);
  const body = buildBodyFrame(
    worldVecs[MP_POSE.LEFT_HIP],
    worldVecs[MP_POSE.RIGHT_HIP],
    worldVecs[MP_POSE.LEFT_SHOULDER],
    worldVecs[MP_POSE.RIGHT_SHOULDER],
    worldVecs[MP_POSE.LEFT_ANKLE],
    worldVecs[MP_POSE.RIGHT_ANKLE],
  );
  const j = computeJoints(worldVecs, body);
  return {
    t: 0,
    bodyY: body.footDistance - cal.footDistance,
    bodyPivot: {
      x: j.bodyPivot.x - cal.bodyPivot.x,
      y: j.bodyPivot.y - cal.bodyPivot.y,
      z: j.bodyPivot.z - cal.bodyPivot.z,
    },
    hipMeshY: j.hipMeshY - cal.hipMeshY,
    torsoY: j.torsoY - cal.torsoY,
    neck: {
      x: j.neck.x - cal.neck.x,
      y: j.neck.y - cal.neck.y,
      z: j.neck.z - cal.neck.z,
    },
    shoulderL: {
      x: j.shoulderL.x - cal.shoulderL.x,
      z: j.shoulderL.z - cal.shoulderL.z,
    },
    shoulderR: {
      x: j.shoulderR.x - cal.shoulderR.x,
      z: j.shoulderR.z - cal.shoulderR.z,
    },
    elbowL: j.elbowL,
    elbowR: j.elbowR,
    hipL: {
      x: j.hipL.x - cal.hipL.x,
      z: j.hipL.z - cal.hipL.z,
    },
    hipR: {
      x: j.hipR.x - cal.hipR.x,
      z: j.hipR.z - cal.hipR.z,
    },
    kneeL: j.kneeL,
    kneeR: j.kneeR,
  };
}
