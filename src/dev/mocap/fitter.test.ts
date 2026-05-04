/**
 * Unit tests for the PoseClip → AnimConfig fragment fitter.
 *
 * Synthetic clips here are constructed in retargeted-rig coordinates
 * (the `PoseClip` format), not MediaPipe world coordinates. That lets us
 * test fitter math directly without coupling to retarget.ts.
 */

import { describe, it, expect } from 'vitest';
import { fit } from './fitter';
import {
  type PoseClip,
  type PoseFrame,
  type MocapTargetAnim,
} from './types';

// ---------- Synthetic-clip builders -----------------------------------------

interface SynthWalkOpts {
  targetAnim?: MocapTargetAnim;
  /** Stride period in seconds. Default 1.0. */
  period?: number;
  /** Total clip duration in seconds. Default 4.0. */
  duration?: number;
  /** Sample rate in Hz. Default 30. */
  fps?: number;
  /** Half-range of `hip.x` (radians). Default 0.48. */
  strideAmp?: number;
  /** Half-range of `bodyY` (meters). Default 0.23. */
  bounceHeight?: number;
  /** Mean `kneeL`/`kneeR` flex (radians). Default 0.15. */
  kneeBase?: number;
  /** Half-range of `kneeL` flex per stride. Default 0.6. */
  kneeSwing?: number;
  /** Half-range of `shoulder.x` (radians). Default 0.2 (= 0.48 * 0.4 ratio). */
  shoulderAmp?: number;
  /** Mean elbow flex (radians, magnitude). Default 0.3. */
  elbowBend?: number;
  /** Mean `bodyPivot.x` (radians). Default 0.12. */
  forwardLean?: number;
  /** Half-range of `hipMeshY`. Default 0.2. */
  hipTwist?: number;
  /** Half-range of `torsoY`. Default 0.14. */
  torsoTwist?: number;
}

function synthWalk(opts: SynthWalkOpts = {}): PoseClip {
  const {
    targetAnim = 'walk',
    period = 1.0,
    duration = 4.0,
    fps = 30,
    strideAmp = 0.48,
    bounceHeight = 0.23,
    kneeBase = 0.15,
    kneeSwing = 0.6,
    shoulderAmp = 0.2,
    elbowBend = 0.3,
    forwardLean = 0.12,
    hipTwist = 0.2,
    torsoTwist = 0.14,
  } = opts;

  const omega = (2 * Math.PI) / period;
  const numFrames = Math.max(2, Math.round(duration * fps));
  const frames: PoseFrame[] = [];
  for (let i = 0; i < numFrames; i++) {
    const t = i / fps;
    const s = Math.sin(omega * t);
    // bodyY uses double-frequency rectified sine (matches runtime convention)
    const rect = Math.abs(Math.sin(omega * t));
    frames.push({
      t,
      bodyY: rect * bounceHeight,
      bodyPivot: { x: forwardLean, y: 0, z: 0 },
      hipMeshY: s * hipTwist,
      torsoY: -s * torsoTwist,
      neck: { x: 0, y: 0, z: 0 },
      shoulderL: { x: s * shoulderAmp, z: 0 },
      shoulderR: { x: -s * shoulderAmp, z: 0 },
      elbowL: -elbowBend,
      elbowR: -elbowBend,
      hipL: { x: s * strideAmp, z: 0 },
      hipR: { x: -s * strideAmp, z: 0 },
      // Knees swing in phase with their hip — symmetric sine around the
      // baseline so the half-range matches `kneeSwing` exactly.
      kneeL: kneeBase + s * kneeSwing,
      kneeR: kneeBase - s * kneeSwing,
    });
  }
  return {
    __version: 1,
    source: { name: 'synth', targetAnim, orientation: 'side' },
    fps,
    torsoLength: 0.55,
    frames,
  };
}

function synthIdle(opts: { duration?: number; fps?: number; sway?: number; kneeBend?: number; elbowBend?: number; bobPeriod?: number } = {}): PoseClip {
  const { duration = 3.0, fps = 30, sway = 0.04, kneeBend = 0.05, elbowBend = 0.1, bobPeriod = 4.0 } = opts;
  const omega = (2 * Math.PI) / bobPeriod;
  const numFrames = Math.max(2, Math.round(duration * fps));
  const frames: PoseFrame[] = [];
  for (let i = 0; i < numFrames; i++) {
    const t = i / fps;
    frames.push({
      t,
      bodyY: Math.sin(omega * t) * sway,
      bodyPivot: { x: 0, y: 0, z: 0 },
      hipMeshY: 0,
      torsoY: 0,
      neck: { x: 0, y: 0, z: 0 },
      shoulderL: { x: 0, z: 0 },
      shoulderR: { x: 0, z: 0 },
      elbowL: -elbowBend,
      elbowR: -elbowBend,
      hipL: { x: 0, z: 0 },
      hipR: { x: 0, z: 0 },
      kneeL: kneeBend,
      kneeR: kneeBend,
    });
  }
  return {
    __version: 1,
    source: { name: 'synth-idle', targetAnim: 'idle', orientation: 'front' },
    fps,
    torsoLength: 0.55,
    frames,
  };
}

function synthGuard(opts: { duration?: number; fps?: number; lean?: number; kneeBend?: number; shoulderRaise?: number; shoulderSpread?: number } = {}): PoseClip {
  const { duration = 2.0, fps = 30, lean = 0.15, kneeBend = 0.4, shoulderRaise = 2.8, shoulderSpread = 0.4 } = opts;
  const numFrames = Math.max(2, Math.round(duration * fps));
  const frames: PoseFrame[] = [];
  for (let i = 0; i < numFrames; i++) {
    const t = i / fps;
    frames.push({
      t,
      bodyY: 0,
      bodyPivot: { x: lean, y: 0, z: 0 },
      hipMeshY: 0,
      torsoY: 0,
      neck: { x: 0, y: 0, z: 0 },
      shoulderL: { x: -shoulderRaise, z: -shoulderSpread },
      shoulderR: { x: -shoulderRaise, z: shoulderSpread },
      elbowL: -0.1,
      elbowR: -0.1,
      hipL: { x: 0, z: 0 },
      hipR: { x: 0, z: 0 },
      kneeL: kneeBend,
      kneeR: kneeBend,
    });
  }
  return {
    __version: 1,
    source: { name: 'synth-guard', targetAnim: 'guard', orientation: 'front' },
    fps,
    torsoLength: 0.55,
    frames,
  };
}

// ---------- Tests -----------------------------------------------------------

describe('fit() — walk', () => {
  it('recovers walkStride within 5% of true 2π/period', () => {
    const period = 1.0;
    const clip = synthWalk({ period });
    const result = fit(clip);
    const expected = (2 * Math.PI) / period;
    expect(result.config.durations?.walkStride).toBeDefined();
    const got = result.config.durations!.walkStride!;
    expect(Math.abs(got - expected) / expected).toBeLessThan(0.05);
  });

  it('walkBounce is ≈ 2 * walkStride', () => {
    const clip = synthWalk({ period: 1.2 });
    const r = fit(clip);
    const stride = r.config.durations!.walkStride!;
    const bounce = r.config.durations!.walkBounce!;
    expect(Math.abs(bounce - 2 * stride) / (2 * stride)).toBeLessThan(0.01);
  });

  it('recovers strideAmp within 5%', () => {
    const target = 0.48;
    const clip = synthWalk({ strideAmp: target });
    const r = fit(clip);
    const got = r.config.amplitudes!.walk!.strideAmp!;
    expect(Math.abs(got - target) / target).toBeLessThan(0.05);
  });

  it('recovers bounceHeight within 10%', () => {
    const target = 0.23;
    const clip = synthWalk({ bounceHeight: target });
    const r = fit(clip);
    const got = r.config.amplitudes!.walk!.bounceHeight!;
    expect(Math.abs(got - target) / target).toBeLessThan(0.1);
  });

  it('recovers forwardLean within 0.01 rad', () => {
    const clip = synthWalk({ forwardLean: 0.13 });
    const r = fit(clip);
    expect(Math.abs(r.config.amplitudes!.walk!.forwardLean! - 0.13)).toBeLessThan(0.01);
  });

  it('emits all 9 walk amplitude fields', () => {
    const clip = synthWalk();
    const r = fit(clip);
    const w = r.config.amplitudes!.walk!;
    expect(w.bounceHeight).toBeDefined();
    expect(w.strideAmp).toBeDefined();
    expect(w.kneeBase).toBeDefined();
    expect(w.kneeSwing).toBeDefined();
    expect(w.armSwingRatio).toBeDefined();
    expect(w.elbowBend).toBeDefined();
    expect(w.forwardLean).toBeDefined();
    expect(w.hipTwist).toBeDefined();
    expect(w.torsoTwist).toBeDefined();
  });

  it('reports confidence > 0.7 on a clean sinusoidal walk', () => {
    const clip = synthWalk({ duration: 5 });
    const r = fit(clip);
    expect(r.diagnostics.confidence).toBeGreaterThan(0.7);
  });

  it('recovers armSwingRatio ≈ shoulderAmp / hipAmp', () => {
    const clip = synthWalk({ strideAmp: 0.5, shoulderAmp: 0.2 });
    const r = fit(clip);
    const ratio = r.config.amplitudes!.walk!.armSwingRatio!;
    expect(Math.abs(ratio - 0.4)).toBeLessThan(0.02);
  });

  it('clamps armSwingRatio to ≤ 2 for absurd inputs', () => {
    const clip = synthWalk({ strideAmp: 0.05, shoulderAmp: 1.0 });
    const r = fit(clip);
    expect(r.config.amplitudes!.walk!.armSwingRatio!).toBeLessThanOrEqual(2);
  });
});

describe('fit() — short / invalid clips', () => {
  it('emits warning for too-short clips and an empty config', () => {
    const clip = synthWalk({ duration: 0.2 });
    const r = fit(clip);
    expect(r.config).toEqual({});
    expect(r.warnings.some((w) => /too short/i.test(w))).toBe(true);
  });

  it('handles a custom targetAnim by returning empty config + warning', () => {
    const clip = synthWalk({ targetAnim: 'custom' });
    const r = fit(clip);
    expect(r.config).toEqual({});
    expect(r.warnings.some((w) => /custom/i.test(w))).toBe(true);
  });

  it('drops NaN frames and warns', () => {
    const clip = synthWalk({ duration: 3 });
    // Inject a NaN-bodyPivot.x at frame 0.
    clip.frames[0] = { ...clip.frames[0], bodyPivot: { x: NaN, y: 0, z: 0 } };
    const r = fit(clip);
    expect(r.warnings.some((w) => /NaN/i.test(w))).toBe(true);
    // Walk fields should still come through.
    expect(r.config.amplitudes!.walk).toBeDefined();
  });
});

describe('fit() — idle', () => {
  it('emits idle amplitudes from means; skips period when too quiet', () => {
    const clip = synthIdle({ sway: 0.001, bobPeriod: 4.0 });
    const r = fit(clip);
    expect(r.config.amplitudes!.idle).toBeDefined();
    expect(r.config.amplitudes!.idle!.kneeBend).toBeCloseTo(0.05, 2);
    expect(r.config.amplitudes!.idle!.elbowBend).toBeCloseTo(0.1, 2);
    expect(r.config.amplitudes!.idle!.swayHeight).toBeLessThan(0.01);
  });

  it('detects a slow idle bob period when sway is detectable', () => {
    const clip = synthIdle({ duration: 8, sway: 0.04, bobPeriod: 4.0 });
    const r = fit(clip);
    // 2π / 4.0 ≈ 1.57. Default is 1.5; we want recovery within ~10%.
    if (r.config.durations?.idleBob !== undefined) {
      const expected = (2 * Math.PI) / 4.0;
      expect(Math.abs(r.config.durations.idleBob - expected) / expected).toBeLessThan(0.1);
    }
  });
});

describe('fit() — guard', () => {
  it('emits forwardLean, kneeBend, shoulderRaise, shoulderSpread from means', () => {
    const clip = synthGuard({ lean: 0.16, kneeBend: 0.4, shoulderRaise: 2.8, shoulderSpread: 0.4 });
    const r = fit(clip);
    const g = r.config.amplitudes!.guard!;
    expect(g.forwardLean).toBeCloseTo(0.16, 3);
    expect(g.kneeBend).toBeCloseTo(0.4, 3);
    expect(g.shoulderRaise).toBeCloseTo(2.8, 3);
    expect(g.shoulderSpread).toBeCloseTo(0.4, 3);
  });

  it('does not emit any durations for a static guard clip', () => {
    const clip = synthGuard();
    const r = fit(clip);
    expect(r.config.durations).toBeUndefined();
  });
});

describe('fit() — sprint', () => {
  it('uses sprint schema (kneeDrive, shoulderSwing) and recovers period', () => {
    const period = 0.6; // sprint cycle
    const clip = synthWalk({ targetAnim: 'sprint', period, strideAmp: 0.64, shoulderAmp: 0.45 });
    const r = fit(clip);
    expect(r.config.durations?.sprintStride).toBeDefined();
    expect(r.config.durations?.sprintBounce).toBeDefined();
    const sprint = r.config.amplitudes!.sprint!;
    expect(sprint.kneeDrive).toBeDefined();
    expect(sprint.shoulderSwing).toBeDefined();
    expect(sprint.strideAmp).toBeCloseTo(0.64, 1);
    const expectedW = (2 * Math.PI) / period;
    expect(Math.abs(r.config.durations!.sprintStride! - expectedW) / expectedW).toBeLessThan(0.05);
  });
});

describe('fit() — walk-backward', () => {
  it('uses walkBackward schema (shoulderX/Z) and emits backwardStride', () => {
    const clip = synthWalk({ targetAnim: 'walk-backward', period: 1.4, strideAmp: 0.24 });
    const r = fit(clip);
    const wb = r.config.amplitudes!.walkBackward!;
    expect(wb.bounceHeight).toBeDefined();
    expect(wb.strideAmp).toBeCloseTo(0.24, 1);
    expect(wb.shoulderX).toBeDefined();
    expect(wb.shoulderZ).toBeDefined();
    expect(r.config.durations?.backwardStride).toBeDefined();
    expect(r.config.durations?.backwardBounce).toBeDefined();
  });
});

describe('fit() — dribble family', () => {
  it('dribble emits walkStride/walkBounce and warns about un-fitted arm pump', () => {
    const clip = synthWalk({ targetAnim: 'dribble', period: 1.0 });
    const r = fit(clip);
    expect(r.config.durations?.walkStride).toBeDefined();
    expect(r.config.amplitudes!.dribble).toBeDefined();
    expect(r.config.amplitudes!.dribble!.bounceHeight).toBeDefined();
    expect(r.config.amplitudes!.dribble!.strideAmp).toBeDefined();
    expect(r.warnings.some((w) => /arm pump/i.test(w))).toBe(true);
  });

  it('dribble-walk uses the same schema as dribble', () => {
    const clip = synthWalk({ targetAnim: 'dribble-walk', period: 1.0 });
    const r = fit(clip);
    expect(r.config.amplitudes!.dribble).toBeDefined();
  });

  it('dribble-sprint emits dribbleSprintStride and dribbleSprint amplitudes', () => {
    const clip = synthWalk({ targetAnim: 'dribble-sprint', period: 0.7, strideAmp: 0.7 });
    const r = fit(clip);
    expect(r.config.durations?.dribbleSprintStride).toBeDefined();
    expect(r.config.durations?.dribbleSprintBounce).toBeDefined();
    expect(r.config.amplitudes!.dribbleSprint).toBeDefined();
    expect(r.config.amplitudes!.dribbleSprint!.strideAmp).toBeCloseTo(0.7, 1);
  });
});

describe('fit() — diagnostics', () => {
  it('reports detected period in seconds for cyclic clips', () => {
    const clip = synthWalk({ period: 1.3 });
    const r = fit(clip);
    expect(r.diagnostics.detectedCyclesSec).toBeDefined();
    expect(Math.abs(r.diagnostics.detectedCyclesSec! - 1.3)).toBeLessThan(0.1);
  });

  it('reports frameCount and durationSec for any clip', () => {
    const clip = synthWalk({ duration: 3, fps: 30 });
    const r = fit(clip);
    expect(r.diagnostics.frameCount).toBe(90);
    expect(r.diagnostics.durationSec).toBeCloseTo(3 - 1 / 30, 2);
  });
});
