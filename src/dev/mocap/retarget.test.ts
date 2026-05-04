/**
 * Unit tests for the MocapClip → PoseClip retargeter.
 *
 * Hand-built clips use **MediaPipe BlazePose world coordinates** (the input
 * format): origin at hip midpoint, +x = subject's right, +y = DOWN,
 * +z = AWAY from camera (out the subject's back when facing camera). So
 * "knee forward" of hip = knee.z is *negative* in this frame.
 *
 * For single-frame math-sanity tests we set `targetAnim: 'idle'`, which
 * skips the per-clip median baselining `retarget()` applies for cyclic
 * animations (walk/sprint/dribble). Otherwise a one-frame clip's median
 * equals its only value, and every baseline-subtracted joint reads zero.
 */

import { describe, it, expect } from 'vitest';
import {
  MP_POSE,
  type MocapClip,
  type MocapFrame,
  type MpLandmark,
  type MpLandmarkName,
} from './types';
import {
  retarget,
  retargetFrame,
  makeCalibration,
  NEUTRAL_CALIBRATION,
} from './retarget';

// ---------- Construction helpers -----------------------------------------

/** Make an all-visible landmark in MediaPipe world coords. */
function lm(x: number, y: number, z: number, visibility = 1): MpLandmark {
  return { x, y, z, visibility };
}

type LmOverride = Partial<Record<MpLandmarkName, MpLandmark>>;

/**
 * A "neutral upright" set of 33 landmarks, in MediaPipe world coords. The
 * subject stands facing the camera (+z), arms at sides, head up. Heights
 * are stored as **+y down** to match the input convention. Hip midpoint is
 * at origin (0, 0, 0) by construction.
 */
function neutralLandmarks(): MpLandmark[] {
  // Vertical positions in MediaPipe (+y = down). Subject is upright, so
  // shoulders / head are above hips → negative y values.
  const HIP_Y = 0;
  const SHOULDER_Y = -0.5;
  const ELBOW_Y = -0.25;
  const WRIST_Y = 0.0; // arms hang to hip level
  const KNEE_Y = 0.5;
  const ANKLE_Y = 1.0;
  const HEAD_Y = -0.7;
  const NOSE_Y = -0.7;

  const out: MpLandmark[] = new Array(33);
  for (let i = 0; i < 33; i++) out[i] = lm(0, 0, 0, 1);

  out[MP_POSE.NOSE] = lm(0, NOSE_Y, 0.05);
  out[MP_POSE.LEFT_EYE_INNER] = lm(-0.02, NOSE_Y - 0.02, 0.05);
  out[MP_POSE.LEFT_EYE] = lm(-0.04, NOSE_Y - 0.02, 0.05);
  out[MP_POSE.LEFT_EYE_OUTER] = lm(-0.06, NOSE_Y - 0.02, 0.05);
  out[MP_POSE.RIGHT_EYE_INNER] = lm(0.02, NOSE_Y - 0.02, 0.05);
  out[MP_POSE.RIGHT_EYE] = lm(0.04, NOSE_Y - 0.02, 0.05);
  out[MP_POSE.RIGHT_EYE_OUTER] = lm(0.06, NOSE_Y - 0.02, 0.05);
  out[MP_POSE.LEFT_EAR] = lm(-0.08, HEAD_Y, 0);
  out[MP_POSE.RIGHT_EAR] = lm(0.08, HEAD_Y, 0);
  out[MP_POSE.MOUTH_LEFT] = lm(-0.03, NOSE_Y + 0.04, 0.04);
  out[MP_POSE.MOUTH_RIGHT] = lm(0.03, NOSE_Y + 0.04, 0.04);

  out[MP_POSE.LEFT_SHOULDER] = lm(-0.2, SHOULDER_Y, 0);
  out[MP_POSE.RIGHT_SHOULDER] = lm(0.2, SHOULDER_Y, 0);

  // Arms hang at the sides: elbow & wrist directly below shoulder.
  out[MP_POSE.LEFT_ELBOW] = lm(-0.2, ELBOW_Y, 0);
  out[MP_POSE.RIGHT_ELBOW] = lm(0.2, ELBOW_Y, 0);
  out[MP_POSE.LEFT_WRIST] = lm(-0.2, WRIST_Y, 0);
  out[MP_POSE.RIGHT_WRIST] = lm(0.2, WRIST_Y, 0);

  // Hands (pinky/index/thumb) — colocated with wrist for our purposes.
  out[MP_POSE.LEFT_PINKY] = lm(-0.22, WRIST_Y + 0.05, 0);
  out[MP_POSE.RIGHT_PINKY] = lm(0.22, WRIST_Y + 0.05, 0);
  out[MP_POSE.LEFT_INDEX] = lm(-0.18, WRIST_Y + 0.05, 0);
  out[MP_POSE.RIGHT_INDEX] = lm(0.18, WRIST_Y + 0.05, 0);
  out[MP_POSE.LEFT_THUMB] = lm(-0.2, WRIST_Y + 0.05, 0.02);
  out[MP_POSE.RIGHT_THUMB] = lm(0.2, WRIST_Y + 0.05, 0.02);

  out[MP_POSE.LEFT_HIP] = lm(-0.1, HIP_Y, 0);
  out[MP_POSE.RIGHT_HIP] = lm(0.1, HIP_Y, 0);

  // Legs straight down: knee & ankle below hip.
  out[MP_POSE.LEFT_KNEE] = lm(-0.1, KNEE_Y, 0);
  out[MP_POSE.RIGHT_KNEE] = lm(0.1, KNEE_Y, 0);
  out[MP_POSE.LEFT_ANKLE] = lm(-0.1, ANKLE_Y, 0);
  out[MP_POSE.RIGHT_ANKLE] = lm(0.1, ANKLE_Y, 0);

  out[MP_POSE.LEFT_HEEL] = lm(-0.1, ANKLE_Y + 0.02, -0.05);
  out[MP_POSE.RIGHT_HEEL] = lm(0.1, ANKLE_Y + 0.02, -0.05);
  out[MP_POSE.LEFT_FOOT_INDEX] = lm(-0.1, ANKLE_Y + 0.02, 0.1);
  out[MP_POSE.RIGHT_FOOT_INDEX] = lm(0.1, ANKLE_Y + 0.02, 0.1);

  return out;
}

/** Apply a sparse set of landmark overrides to a fresh neutral pose. */
function pose(overrides: LmOverride): MpLandmark[] {
  const out = neutralLandmarks();
  for (const [name, val] of Object.entries(overrides) as [
    MpLandmarkName,
    MpLandmark,
  ][]) {
    out[MP_POSE[name]] = val;
  }
  return out;
}

/** Build a MocapClip from an array of (time, landmarks) pairs. */
function mkClip(
  framesOfLandmarks: Array<{ t: number; world: MpLandmark[] }>,
  opts: Partial<Pick<MocapClip, 'name' | 'targetAnim' | 'orientation' | 'fps'>> = {},
): MocapClip {
  return {
    __version: 1,
    name: opts.name ?? 'test-clip',
    targetAnim: opts.targetAnim ?? 'walk',
    orientation: opts.orientation ?? 'front',
    fps: opts.fps ?? 30,
    capturedAt: '2026-04-29T00:00:00.000Z',
    frames: framesOfLandmarks.map<MocapFrame>(({ t, world }) => ({ t, world })),
  };
}

// ---------- Tests --------------------------------------------------------

describe('retarget — output frame count, fps, source metadata', () => {
  it('preserves frame count, fps, and source fields', () => {
    const clip = mkClip(
      [
        { t: 0, world: neutralLandmarks() },
        { t: 1 / 30, world: neutralLandmarks() },
        { t: 2 / 30, world: neutralLandmarks() },
      ],
      { name: 'walk-side-2026-04-29-1', targetAnim: 'sprint', orientation: 'side', fps: 60 },
    );
    const out = retarget(clip);
    expect(out.frames.length).toBe(clip.frames.length);
    expect(out.fps).toBe(clip.fps);
    expect(out.source.name).toBe('walk-side-2026-04-29-1');
    expect(out.source.targetAnim).toBe('sprint');
    expect(out.source.orientation).toBe('side');
    expect(out.__version).toBe(1);
    expect(out.frames[0].t).toBe(0);
    expect(out.frames[2].t).toBeCloseTo(2 / 30, 6);
  });

  it('reports a sane torsoLength (≈ shoulder→hip distance)', () => {
    const clip = mkClip([{ t: 0, world: neutralLandmarks() }]);
    const out = retarget(clip);
    // Neutral pose has shoulder-mid at y=-0.5 and hip-mid at y=0; after
    // y-flip the torso length is 0.5 m.
    expect(out.torsoLength).toBeCloseTo(0.5, 3);
  });
});

describe('retarget — anatomical bounds and no NaNs', () => {
  it('produces no NaNs and joints stay in-range across a synthesized clip', () => {
    // Six varied frames: neutral, T-pose, knee-bent, lean-forward, twist,
    // arm-up.
    const tPose = pose({
      LEFT_ELBOW: lm(-0.5, -0.5, 0),
      RIGHT_ELBOW: lm(0.5, -0.5, 0),
      LEFT_WRIST: lm(-0.8, -0.5, 0),
      RIGHT_WRIST: lm(0.8, -0.5, 0),
    });
    const kneeBent = pose({
      LEFT_KNEE: lm(-0.1, 0, 0.5),
      LEFT_ANKLE: lm(-0.1, 0.5, 0.5),
    });
    const lean = pose({
      LEFT_SHOULDER: lm(-0.2, -0.45, 0.2),
      RIGHT_SHOULDER: lm(0.2, -0.45, 0.2),
    });
    const twist = pose({
      LEFT_HIP: lm(-0.1, 0, -0.05),
      RIGHT_HIP: lm(0.1, 0, 0.05),
      LEFT_SHOULDER: lm(-0.2, -0.5, 0.05),
      RIGHT_SHOULDER: lm(0.2, -0.5, -0.05),
    });
    const armsUp = pose({
      LEFT_ELBOW: lm(-0.2, -1.0, 0),
      RIGHT_ELBOW: lm(0.2, -1.0, 0),
      LEFT_WRIST: lm(-0.2, -1.3, 0),
      RIGHT_WRIST: lm(0.2, -1.3, 0),
    });

    const clip = mkClip([
      { t: 0, world: neutralLandmarks() },
      { t: 0.1, world: tPose },
      { t: 0.2, world: kneeBent },
      { t: 0.3, world: lean },
      { t: 0.4, world: twist },
      { t: 0.5, world: armsUp },
    ]);
    const out = retarget(clip);

    for (const f of out.frames) {
      // No NaNs anywhere.
      const all = [
        f.bodyY,
        f.bodyPivot.x,
        f.bodyPivot.y,
        f.bodyPivot.z,
        f.hipMeshY,
        f.torsoY,
        f.neck.x,
        f.neck.y,
        f.neck.z,
        f.shoulderL.x,
        f.shoulderL.z,
        f.shoulderR.x,
        f.shoulderR.z,
        f.elbowL,
        f.elbowR,
        f.hipL.x,
        f.hipL.z,
        f.hipR.x,
        f.hipR.z,
        f.kneeL,
        f.kneeR,
      ];
      for (const v of all) {
        expect(Number.isFinite(v)).toBe(true);
      }

      // Anatomical bounds.
      expect(f.kneeL).toBeGreaterThanOrEqual(0);
      expect(f.kneeL).toBeLessThanOrEqual(Math.PI);
      expect(f.kneeR).toBeGreaterThanOrEqual(0);
      expect(f.kneeR).toBeLessThanOrEqual(Math.PI);
      expect(f.elbowL).toBeGreaterThanOrEqual(0);
      expect(f.elbowL).toBeLessThanOrEqual(Math.PI);
      expect(f.elbowR).toBeGreaterThanOrEqual(0);
      expect(f.elbowR).toBeLessThanOrEqual(Math.PI);
      expect(f.shoulderL.x).toBeGreaterThanOrEqual(-Math.PI);
      expect(f.shoulderL.x).toBeLessThanOrEqual(Math.PI);
      expect(f.shoulderR.x).toBeGreaterThanOrEqual(-Math.PI);
      expect(f.shoulderR.x).toBeLessThanOrEqual(Math.PI);
    }
  });
});

describe('retarget — T-pose symmetry', () => {
  it('mirrors L/R shoulders and hips, with elbows and knees ≈ 0', () => {
    const tPose = pose({
      LEFT_ELBOW: lm(-0.5, -0.5, 0),
      RIGHT_ELBOW: lm(0.5, -0.5, 0),
      LEFT_WRIST: lm(-0.8, -0.5, 0),
      RIGHT_WRIST: lm(0.8, -0.5, 0),
    });
    const clip = mkClip([{ t: 0, world: tPose }], { targetAnim: 'idle' });
    const f = retarget(clip).frames[0];

    // Sagittal swing of arm should be ≈ 0 in T-pose (arm out laterally,
    // not forward or back).
    expect(f.shoulderL.x).toBeCloseTo(0, 5);
    expect(f.shoulderR.x).toBeCloseTo(0, 5);
    // Lateral spread is mirrored: left negative, right positive (matches
    // rig's guard pose convention `shoulderL.z = -0.4`, `shoulderR.z = +0.4`).
    expect(f.shoulderL.z).toBeLessThan(0);
    expect(f.shoulderR.z).toBeGreaterThan(0);
    expect(f.shoulderL.z).toBeCloseTo(-f.shoulderR.z, 5);

    // Hips in neutral standing pose (legs straight down, no spread).
    expect(f.hipL.x).toBeCloseTo(0, 5);
    expect(f.hipR.x).toBeCloseTo(0, 5);
    expect(f.hipL.z).toBeCloseTo(-f.hipR.z, 5);

    // Elbows and knees straight.
    expect(f.elbowL).toBeCloseTo(0, 5);
    expect(f.elbowR).toBeCloseTo(0, 5);
    expect(f.kneeL).toBeCloseTo(0, 5);
    expect(f.kneeR).toBeCloseTo(0, 5);
  });
});

describe('retarget — knee flex 90°', () => {
  it('produces kneeL ≈ π/2 when the left thigh is forward and shin is down', () => {
    // Sitting-style fold: thigh horizontal forward (knee in front of hip
    // at the same height as the hip), shin vertical down (ankle below
    // knee). MediaPipe +y is down.
    const sit = pose({
      LEFT_HIP: lm(-0.1, 0, 0),
      LEFT_KNEE: lm(-0.1, 0, 0.5), // forward of hip, same y
      LEFT_ANKLE: lm(-0.1, 0.5, 0.5), // below knee, same forward
    });
    const clip = mkClip([{ t: 0, world: sit }]);
    const f = retarget(clip).frames[0];
    expect(f.kneeL).toBeCloseTo(Math.PI / 2, 4);
  });
});

describe('retarget — forward lean', () => {
  it('bodyPivot.x is positive when the shoulder midpoint is pushed forward', () => {
    // Hip-mid stays at origin; shoulder-mid moves forward in z. MediaPipe
    // +z = AWAY from camera, so "forward of hip" (toward camera) means a
    // *negative* z. After lmToVec's z-flip this becomes +z in Three.js.
    const lean = pose({
      LEFT_SHOULDER: lm(-0.2, -0.45, -0.25),
      RIGHT_SHOULDER: lm(0.2, -0.45, -0.25),
    });
    const clip = mkClip([{ t: 0, world: lean }], { targetAnim: 'idle' });
    const f = retarget(clip).frames[0];
    expect(f.bodyPivot.x).toBeGreaterThan(0.05);
  });

  it('bodyPivot.x ≈ 0 in a neutral upright pose', () => {
    const clip = mkClip([{ t: 0, world: neutralLandmarks() }], { targetAnim: 'idle' });
    const f = retarget(clip).frames[0];
    expect(Math.abs(f.bodyPivot.x)).toBeLessThan(1e-5);
  });
});

describe('retarget — walk-style counter-rotation', () => {
  it('hipMeshY and torsoY have opposite signs at a "right-hip-forward + left-shoulder-forward" frame', () => {
    // Frame 1: right hip pushed forward, left hip pushed back; shoulders
    // counter-rotated (left shoulder forward, right shoulder back).
    const f1 = pose({
      LEFT_HIP: lm(-0.1, 0, -0.05),
      RIGHT_HIP: lm(0.1, 0, 0.05),
      LEFT_SHOULDER: lm(-0.2, -0.5, 0.05),
      RIGHT_SHOULDER: lm(0.2, -0.5, -0.05),
    });
    // Frame 3: mirror — left hip forward, right shoulder forward.
    const f3 = pose({
      LEFT_HIP: lm(-0.1, 0, 0.05),
      RIGHT_HIP: lm(0.1, 0, -0.05),
      LEFT_SHOULDER: lm(-0.2, -0.5, -0.05),
      RIGHT_SHOULDER: lm(0.2, -0.5, 0.05),
    });
    const clip = mkClip([
      { t: 0, world: f1 },
      { t: 0.05, world: neutralLandmarks() },
      { t: 0.1, world: f3 },
    ]);
    const out = retarget(clip);
    const a = out.frames[0];
    const c = out.frames[2];

    // Counter-rotation: hipMeshY and torsoY are opposite-signed at f1.
    expect(Math.sign(a.hipMeshY)).not.toBe(0);
    expect(Math.sign(a.torsoY)).not.toBe(0);
    expect(Math.sign(a.hipMeshY)).toBe(-Math.sign(a.torsoY));

    // Magnitudes should be in the rig's typical range — walk's hipTwist
    // amplitude is 0.2 rad, our synthetic deltas are ~0.45 rad which
    // corresponds to a generous walk swing. Just sanity-check
    // we're well under π/2.
    expect(Math.abs(a.hipMeshY)).toBeLessThan(Math.PI / 2);
    expect(Math.abs(a.torsoY)).toBeLessThan(Math.PI / 2);

    // Frame 3 mirrors frame 1.
    expect(Math.sign(c.hipMeshY)).toBe(-Math.sign(a.hipMeshY));
    expect(Math.sign(c.torsoY)).toBe(-Math.sign(a.torsoY));
  });
});

describe('retarget — visibility gating', () => {
  it("holds the previous frame's value when a key landmark drops below 0.3", () => {
    const f0 = pose({
      LEFT_KNEE: lm(-0.1, 0, 0.5),
      LEFT_ANKLE: lm(-0.1, 0.5, 0.5),
    });
    // Frame 1: same as f0 but LEFT_ANKLE has visibility 0.1 — should hold
    // f0's kneeL value rather than emit garbage.
    const f1 = neutralLandmarks();
    f1[MP_POSE.LEFT_KNEE] = lm(-0.1, 0, 0.5);
    f1[MP_POSE.LEFT_ANKLE] = lm(-0.1, 0.5, 0.5, 0.1); // occluded
    const clip = mkClip([
      { t: 0, world: f0 },
      { t: 0.05, world: f1 },
    ]);
    const out = retarget(clip);
    expect(out.frames[1].kneeL).toBeCloseTo(out.frames[0].kneeL, 6);
    expect(Number.isFinite(out.frames[1].kneeL)).toBe(true);
  });

  it('does not emit NaNs even if the very first frame has occlusion', () => {
    const occluded = neutralLandmarks();
    occluded[MP_POSE.LEFT_ANKLE] = lm(0, 0, 0, 0.0); // fully occluded
    const clip = mkClip([{ t: 0, world: occluded }]);
    const out = retarget(clip);
    for (const v of [out.frames[0].kneeL, out.frames[0].kneeR]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('retarget — sign sanity (hip / shoulder forward swing)', () => {
  it('hipR.x > 0 when the right knee is forward of the right hip', () => {
    const w = neutralLandmarks();
    // "Forward" = toward camera = negative z in MediaPipe world coords.
    w[MP_POSE.RIGHT_KNEE] = lm(0.1, 0.4, -0.3);
    const clip = mkClip([{ t: 0, world: w }], { targetAnim: 'idle' });
    const f = retarget(clip).frames[0];
    expect(f.hipR.x).toBeGreaterThan(0.1);
  });

  it('shoulderL.x > 0 when the left elbow is forward of the left shoulder', () => {
    const w = neutralLandmarks();
    w[MP_POSE.LEFT_ELBOW] = lm(-0.2, -0.25, -0.3);
    w[MP_POSE.LEFT_WRIST] = lm(-0.2, 0, -0.3);
    const clip = mkClip([{ t: 0, world: w }], { targetAnim: 'idle' });
    const f = retarget(clip).frames[0];
    expect(f.shoulderL.x).toBeGreaterThan(0.1);
  });
});

// ---------- Live (single-frame, calibration-based) retarget --------------

describe('NEUTRAL_CALIBRATION', () => {
  it('is all zeros (joints, footDistance, torsoLength)', () => {
    expect(NEUTRAL_CALIBRATION.bodyPivot).toEqual({ x: 0, y: 0, z: 0 });
    expect(NEUTRAL_CALIBRATION.hipMeshY).toBe(0);
    expect(NEUTRAL_CALIBRATION.torsoY).toBe(0);
    expect(NEUTRAL_CALIBRATION.neck).toEqual({ x: 0, y: 0, z: 0 });
    expect(NEUTRAL_CALIBRATION.shoulderL).toEqual({ x: 0, z: 0 });
    expect(NEUTRAL_CALIBRATION.shoulderR).toEqual({ x: 0, z: 0 });
    expect(NEUTRAL_CALIBRATION.hipL).toEqual({ x: 0, z: 0 });
    expect(NEUTRAL_CALIBRATION.hipR).toEqual({ x: 0, z: 0 });
    expect(NEUTRAL_CALIBRATION.footDistance).toBe(0);
    expect(NEUTRAL_CALIBRATION.torsoLength).toBe(0);
  });
});

describe('makeCalibration', () => {
  it('returns non-null with sane footDistance / torsoLength on a neutral upright pose', () => {
    const cal = makeCalibration(neutralLandmarks());
    expect(cal).not.toBeNull();
    if (!cal) throw new Error('cal was null');
    // ANKLE_Y = 1.0, HIP_Y = 0 → footDistance = 1.0 (after y-flip both are
    // mirrored about origin, hip-mid stays at 0 and lower ankle sits at -1).
    expect(cal.footDistance).toBeCloseTo(1.0, 6);
    // SHOULDER_Y = -0.5, HIP_Y = 0 → torsoLength = 0.5.
    expect(cal.torsoLength).toBeCloseTo(0.5, 6);
  });

  it('returns null when LEFT_SHOULDER visibility is 0', () => {
    const w = neutralLandmarks();
    w[MP_POSE.LEFT_SHOULDER] = lm(-0.2, -0.5, 0, 0.0);
    expect(makeCalibration(w)).toBeNull();
  });
});

describe('retargetFrame', () => {
  it('matches retarget()-of-1-frame on a neutral pose with NEUTRAL_CALIBRATION (idle, no median)', () => {
    const neutral = neutralLandmarks();
    const live = retargetFrame(neutral, NEUTRAL_CALIBRATION);
    expect(live).not.toBeNull();
    if (!live) throw new Error('live frame was null');
    const recorded = retarget(
      mkClip([{ t: 0, world: neutral }], { targetAnim: 'idle' }),
    ).frames[0];

    const eps = 1e-9;
    expect(live.t).toBeCloseTo(recorded.t, 12);
    // bodyY differs (NEUTRAL_CAL has footDistance=0, so live = raw
    // footDistance ≈ 1.0; recorded subtracts its own baseline ≈ 1.0).
    // The contract says elbow/knee + orientation joints match.
    expect(Math.abs(live.bodyPivot.x - recorded.bodyPivot.x)).toBeLessThan(eps);
    expect(Math.abs(live.bodyPivot.y - recorded.bodyPivot.y)).toBeLessThan(eps);
    expect(Math.abs(live.bodyPivot.z - recorded.bodyPivot.z)).toBeLessThan(eps);
    expect(Math.abs(live.hipMeshY - recorded.hipMeshY)).toBeLessThan(eps);
    expect(Math.abs(live.torsoY - recorded.torsoY)).toBeLessThan(eps);
    expect(Math.abs(live.neck.x - recorded.neck.x)).toBeLessThan(eps);
    expect(Math.abs(live.neck.y - recorded.neck.y)).toBeLessThan(eps);
    expect(Math.abs(live.neck.z - recorded.neck.z)).toBeLessThan(eps);
    expect(Math.abs(live.shoulderL.x - recorded.shoulderL.x)).toBeLessThan(eps);
    expect(Math.abs(live.shoulderL.z - recorded.shoulderL.z)).toBeLessThan(eps);
    expect(Math.abs(live.shoulderR.x - recorded.shoulderR.x)).toBeLessThan(eps);
    expect(Math.abs(live.shoulderR.z - recorded.shoulderR.z)).toBeLessThan(eps);
    expect(Math.abs(live.elbowL - recorded.elbowL)).toBeLessThan(eps);
    expect(Math.abs(live.elbowR - recorded.elbowR)).toBeLessThan(eps);
    expect(Math.abs(live.hipL.x - recorded.hipL.x)).toBeLessThan(eps);
    expect(Math.abs(live.hipL.z - recorded.hipL.z)).toBeLessThan(eps);
    expect(Math.abs(live.hipR.x - recorded.hipR.x)).toBeLessThan(eps);
    expect(Math.abs(live.hipR.z - recorded.hipR.z)).toBeLessThan(eps);
    expect(Math.abs(live.kneeL - recorded.kneeL)).toBeLessThan(eps);
    expect(Math.abs(live.kneeR - recorded.kneeR)).toBeLessThan(eps);
  });

  it('captures forward lean as bodyPivot.x > 0 when calibrated against an upright baseline', () => {
    const neutral = neutralLandmarks();
    const cal = makeCalibration(neutral);
    expect(cal).not.toBeNull();
    if (!cal) throw new Error('cal was null');
    // Same forward-lean as the existing forward-lean test: shoulders
    // pushed toward the camera (negative MediaPipe z = +z in Three.js).
    const leaned = pose({
      LEFT_SHOULDER: lm(-0.2, -0.45, -0.25),
      RIGHT_SHOULDER: lm(0.2, -0.45, -0.25),
    });
    const f = retargetFrame(leaned, cal);
    expect(f).not.toBeNull();
    if (!f) throw new Error('frame was null');
    expect(f.bodyPivot.x).toBeGreaterThan(0.05);
  });

  it('produces ≈ all-zero orientation joints when the live frame matches the calibration pose', () => {
    const neutral = neutralLandmarks();
    const cal = makeCalibration(neutral);
    expect(cal).not.toBeNull();
    if (!cal) throw new Error('cal was null');
    const f = retargetFrame(neutral, cal);
    expect(f).not.toBeNull();
    if (!f) throw new Error('frame was null');
    const eps = 1e-9;
    expect(Math.abs(f.bodyPivot.x)).toBeLessThan(eps);
    expect(Math.abs(f.bodyPivot.y)).toBeLessThan(eps);
    expect(Math.abs(f.bodyPivot.z)).toBeLessThan(eps);
    expect(Math.abs(f.hipMeshY)).toBeLessThan(eps);
    expect(Math.abs(f.torsoY)).toBeLessThan(eps);
    expect(Math.abs(f.neck.x)).toBeLessThan(eps);
    expect(Math.abs(f.neck.y)).toBeLessThan(eps);
    expect(Math.abs(f.neck.z)).toBeLessThan(eps);
    expect(Math.abs(f.shoulderL.x)).toBeLessThan(eps);
    expect(Math.abs(f.shoulderL.z)).toBeLessThan(eps);
    expect(Math.abs(f.shoulderR.x)).toBeLessThan(eps);
    expect(Math.abs(f.shoulderR.z)).toBeLessThan(eps);
    expect(Math.abs(f.hipL.x)).toBeLessThan(eps);
    expect(Math.abs(f.hipL.z)).toBeLessThan(eps);
    expect(Math.abs(f.hipR.x)).toBeLessThan(eps);
    expect(Math.abs(f.hipR.z)).toBeLessThan(eps);
    // bodyY = footDistance_now - footDistance_cal = 0 (same pose).
    expect(Math.abs(f.bodyY)).toBeLessThan(eps);
  });

  it('returns null when shoulders / hips are occluded', () => {
    const w = neutralLandmarks();
    w[MP_POSE.LEFT_SHOULDER] = lm(-0.2, -0.5, 0, 0.0);
    w[MP_POSE.RIGHT_HIP] = lm(0.1, 0, 0, 0.1);
    expect(retargetFrame(w, NEUTRAL_CALIBRATION)).toBeNull();
  });

  it('always returns a PoseFrame with t === 0', () => {
    const f1 = retargetFrame(neutralLandmarks(), NEUTRAL_CALIBRATION);
    expect(f1).not.toBeNull();
    if (!f1) throw new Error('f1 was null');
    expect(f1.t).toBe(0);

    const cal = makeCalibration(neutralLandmarks());
    if (!cal) throw new Error('cal was null');
    const tPose = pose({
      LEFT_ELBOW: lm(-0.5, -0.5, 0),
      RIGHT_ELBOW: lm(0.5, -0.5, 0),
      LEFT_WRIST: lm(-0.8, -0.5, 0),
      RIGHT_WRIST: lm(0.8, -0.5, 0),
    });
    const f2 = retargetFrame(tPose, cal);
    expect(f2).not.toBeNull();
    if (!f2) throw new Error('f2 was null');
    expect(f2.t).toBe(0);
  });
});
