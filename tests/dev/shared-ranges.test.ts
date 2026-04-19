import { describe, it, expect } from 'vitest';
import { pickSliderRange } from '@/dev/shared-ranges';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r(
  tier: 'durations' | 'amplitudes' | 'poses',
  path: string[],
  key: string,
  value = 0,
) {
  return pickSliderRange(tier, path, key, value);
}

describe('pickSliderRange — divergent-case audit from F1/anim-viewer', () => {
  it('dunk.approachSpeed widens low bound to 0 (F1=0, viewer=1 → 0)', () => {
    expect(r('amplitudes', ['amplitudes', 'dunk', 'approachSpeed'], 'approachSpeed'))
      .toEqual({ min: 0, max: 20, step: 0.5 });
  });

  it('apex* / hopHeight / groundDrop → superset [-3, 5, 0.05]', () => {
    expect(r('amplitudes', ['amplitudes', 'jump', 'apexHeight'], 'apexHeight'))
      .toEqual({ min: -3, max: 5, step: 0.05 });
    expect(r('amplitudes', ['amplitudes', 'jumpBlock', 'apexHeight'], 'apexHeight'))
      .toEqual({ min: -3, max: 5, step: 0.05 });
    expect(r('amplitudes', ['amplitudes', 'dunk', 'apexHeight'], 'apexHeight'))
      .toEqual({ min: -3, max: 5, step: 0.05 });
    expect(r('amplitudes', ['amplitudes', 'shoot', 'hopHeight'], 'hopHeight'))
      .toEqual({ min: -3, max: 5, step: 0.05 });
    expect(r('amplitudes', ['amplitudes', 'fall', 'groundDrop'], 'groundDrop'))
      .toEqual({ min: -3, max: 5, step: 0.05 });
  });

  it('bounceHeight / strideAmp / kneeSwing / bob → superset [-3, 3, 0.01]', () => {
    expect(r('amplitudes', ['amplitudes', 'walk', 'bounceHeight'], 'bounceHeight'))
      .toEqual({ min: -3, max: 3, step: 0.01 });
    expect(r('amplitudes', ['amplitudes', 'walk', 'strideAmp'], 'strideAmp'))
      .toEqual({ min: -3, max: 3, step: 0.01 });
    expect(r('amplitudes', ['amplitudes', 'walk', 'kneeSwing'], 'kneeSwing'))
      .toEqual({ min: -3, max: 3, step: 0.01 });
    expect(r('amplitudes', ['amplitudes', 'dribbleStationary', 'bob'], 'bob'))
      .toEqual({ min: -3, max: 3, step: 0.01 });
  });

  it('scale/compression/armScale/squash → superset [0.3, 2.5, 0.01]', () => {
    expect(r('amplitudes', ['amplitudes', 'dunk', 'armScalePeak'], 'armScalePeak'))
      .toEqual({ min: 0.3, max: 2.5, step: 0.01 });
    expect(r('amplitudes', ['amplitudes', 'dunk', 'rimHangArmScaleU'], 'rimHangArmScaleU'))
      .toEqual({ min: 0.3, max: 2.5, step: 0.01 });
    expect(r('amplitudes', ['amplitudes', 'dunk', 'armThickness'], 'armThickness'))
      .toEqual({ min: 0.3, max: 2.5, step: 0.01 });
    expect(r('amplitudes', ['amplitudes', 'steal', 'compressionX'], 'compressionX'))
      .toEqual({ min: 0.3, max: 2.5, step: 0.01 });
  });

  it('default amplitude knob → superset [-3, 3, 0.01] (not [0, 3])', () => {
    // A field that doesn't match any special rule → default branch.
    expect(r('amplitudes', ['amplitudes', 'pass', 'throwLean'], 'throwLean'))
      .toEqual({ min: -3, max: 3, step: 0.01 });
    expect(r('amplitudes', ['amplitudes', 'jump', 'crouchLean'], 'crouchLean'))
      .toEqual({ min: -3, max: 3, step: 0.01 });
  });

  it('PosY / stanceDropY → superset [-3, 3, 0.01]', () => {
    expect(r('poses', ['poses', 'guard', 'stanceDropY'], 'stanceDropY'))
      .toEqual({ min: -3, max: 3, step: 0.01 });
    expect(r('poses', ['poses', 'jump', 'apexPosY'], 'apexPosY'))
      .toEqual({ min: -3, max: 3, step: 0.01 });
  });

  it('Swing/Delta/Offset pose fields → superset [-3.2, 3.2, 0.01]', () => {
    expect(r('poses', ['poses', 'walk', 'shoulderSwing'], 'shoulderSwing'))
      .toEqual({ min: -3.2, max: 3.2, step: 0.01 });
    expect(r('poses', ['poses', 'shoot', 'releaseDelta'], 'releaseDelta'))
      .toEqual({ min: -3.2, max: 3.2, step: 0.01 });
    expect(r('poses', ['poses', 'jump', 'elbowOffset'], 'elbowOffset'))
      .toEqual({ min: -3.2, max: 3.2, step: 0.01 });
  });

  it('cycle-multiplier durations → min widens to 0.1 (F1=0.5, viewer=0.1 → 0.1)', () => {
    expect(r('durations', ['durations', 'walkStride'], 'walkStride'))
      .toEqual({ min: 0.1, max: 30, step: 0.1 });
    expect(r('durations', ['durations', 'sprintBounce'], 'sprintBounce'))
      .toEqual({ min: 0.1, max: 30, step: 0.1 });
    expect(r('durations', ['durations', 'idleBob'], 'idleBob'))
      .toEqual({ min: 0.1, max: 30, step: 0.1 });
  });

  it('blockOpacityMin / blockOpacitySwing → explicit regex covers both', () => {
    expect(r('amplitudes', ['amplitudes', 'guard', 'blockOpacityMin'], 'blockOpacityMin'))
      .toEqual({ min: 0, max: 1, step: 0.01 });
    expect(r('amplitudes', ['amplitudes', 'guard', 'blockOpacitySwing'], 'blockOpacitySwing'))
      .toEqual({ min: 0, max: 1, step: 0.01 });
  });
});

describe('pickSliderRange — per-rule-class coverage', () => {
  // --- Durations ------------------------------------------------------------

  it('duration: fixed state durations match /Duration$/', () => {
    expect(r('durations', ['durations', 'shootDuration'], 'shootDuration'))
      .toEqual({ min: 0.05, max: 3.0, step: 0.01 });
    expect(r('durations', ['durations', 'jumpDuration'], 'jumpDuration'))
      .toEqual({ min: 0.05, max: 3.0, step: 0.01 });
    expect(r('durations', ['durations', 'stealDuration'], 'stealDuration'))
      .toEqual({ min: 0.05, max: 3.0, step: 0.01 });
    expect(r('durations', ['durations', 'dunkDuration'], 'dunkDuration'))
      .toEqual({ min: 0.05, max: 3.0, step: 0.01 });
  });

  it('duration: cycle multiplier keys use [0.1, 30, 0.1]', () => {
    for (const k of [
      'walkStride', 'walkBounce', 'sprintStride', 'sprintBounce',
      'dribbleCycle', 'guardPulse', 'indicatorBob', 'possessionRingPulse',
      'backwardStride', 'backwardBounce', 'dribbleSprintStride', 'dribbleSprintBounce',
    ]) {
      expect(r('durations', ['durations', k], k)).toEqual({ min: 0.1, max: 30, step: 0.1 });
    }
  });

  // --- Amplitudes: apex / bounce / scale / opacity / timing / default -------

  it('amplitude: apex-class uses [-3, 5, 0.05]', () => {
    for (const k of ['apexHeight', 'hopHeight', 'groundDrop']) {
      expect(r('amplitudes', ['amplitudes', 'x', k], k))
        .toEqual({ min: -3, max: 5, step: 0.05 });
    }
  });

  it('amplitude: bounce-class uses [-3, 3, 0.01]', () => {
    for (const k of ['bounceHeight', 'strideAmp', 'kneeSwing', 'bob']) {
      expect(r('amplitudes', ['amplitudes', 'x', k], k))
        .toEqual({ min: -3, max: 3, step: 0.01 });
    }
  });

  it('amplitude: scale-class uses [0.3, 2.5, 0.01]', () => {
    for (const k of [
      'armScalePeak', 'armThickness', 'rimHangArmScaleU', 'rimHangArmScaleF',
      'compressionX', 'compressionY',
      // anim-viewer's .includes-based fallback on squash/stretch/scale/thickness
      'windSquashX', 'swipeSquashV', 'swipeStretchH',
    ]) {
      expect(r('amplitudes', ['amplitudes', 'x', k], k))
        .toEqual({ min: 0.3, max: 2.5, step: 0.01 });
    }
  });

  it('amplitude: opacity-class uses [0, 1, 0.01]', () => {
    for (const k of ['blockOpacityMin', 'blockOpacitySwing']) {
      expect(r('amplitudes', ['amplitudes', 'guard', k], k))
        .toEqual({ min: 0, max: 1, step: 0.01 });
    }
  });

  it('amplitude: dunk timing fractions use [0, 1, 0.01]', () => {
    for (const k of ['riseTime', 'hangStart', 'dropStart', 'landStart']) {
      expect(r('amplitudes', ['amplitudes', 'dunk', k], k))
        .toEqual({ min: 0, max: 1, step: 0.01 });
    }
  });

  it('amplitude: approachDist uses [0, 3, 0.05]', () => {
    expect(r('amplitudes', ['amplitudes', 'dunk', 'approachDist'], 'approachDist'))
      .toEqual({ min: 0, max: 3, step: 0.05 });
  });

  it('amplitude: positional-magnitude catch-all (height/lateral/drop) uses [-3, 3, 0.01]', () => {
    // These are caught by anim-viewer's `.includes('height'|'lateral'|'drop'|...)` branch.
    for (const k of ['launchLeftLateral', 'backLean']) {
      expect(r('amplitudes', ['amplitudes', 'x', k], k))
        .toEqual({ min: -3, max: 3, step: 0.01 });
    }
  });

  it('amplitude: default branch uses [-3, 3, 0.01] for unclassified fields', () => {
    for (const k of ['crouchKnee', 'throwLean', 'mjHipL', 'slamLean']) {
      expect(r('amplitudes', ['amplitudes', 'x', k], k))
        .toEqual({ min: -3, max: 3, step: 0.01 });
    }
  });

  // --- Poses: rotations / positional / swings / factors --------------------

  it('pose: default rotation fields use [-3.2, 3.2, 0.01]', () => {
    for (const k of ['bodyPivotRotX', 'kneeLRotX', 'shoulderRRotZ', 'elbowLRotX']) {
      expect(r('poses', ['poses', 'idle', k], k, 0))
        .toEqual({ min: -3.2, max: 3.2, step: 0.01 });
    }
  });

  it('pose: positional Y offsets use [-3, 3, 0.01]', () => {
    expect(r('poses', ['poses', 'guard', 'stanceDropY'], 'stanceDropY'))
      .toEqual({ min: -3, max: 3, step: 0.01 });
    expect(r('poses', ['poses', 'jump', 'apexPosY'], 'apexPosY'))
      .toEqual({ min: -3, max: 3, step: 0.01 });
  });

  it('pose: squash/stretch/compression factors use [0.3, 2.5, 0.01]', () => {
    for (const k of ['squashStretchAmount', 'windSquashX', 'holdCompressionY', 'bounceSquashAmount']) {
      expect(r('poses', ['poses', 'walk', k], k))
        .toEqual({ min: 0.3, max: 2.5, step: 0.01 });
    }
  });

  it('pose: Swing/Delta/Offset pose fields use [-3.2, 3.2, 0.01]', () => {
    for (const k of ['shoulderSwing', 'elbowDelta', 'kneeOffset']) {
      expect(r('poses', ['poses', 'walk', k], k))
        .toEqual({ min: -3.2, max: 3.2, step: 0.01 });
    }
  });

  it('pose: Factor/Amount/Amp/Ratio fields use [-2, 2, 0.01]', () => {
    for (const k of ['hipTwistFactor', 'torsoTwistFactor', 'bounceSquashAmount', 'someAmp', 'guideRatio']) {
      // squashStretchAmount / bounceSquashAmount match the Squash rule first → skip those
      if (/Squash/i.test(k)) continue;
      expect(r('poses', ['poses', 'walk', k], k))
        .toEqual({ min: -2, max: 2, step: 0.01 });
    }
  });

  it('pose: rotation fallback widens bounds when default exceeds ±π', () => {
    // value 4.0 → bound = ceil(4 * 1.25 * 100) / 100 = 5.00
    const out = r('poses', ['poses', 'dunk', 'slamTwistThrough'], 'slamTwistThrough', 4.0);
    expect(out).toEqual({ min: -5, max: 5, step: 0.01 });
  });
});
