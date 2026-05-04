/**
 * PoseClip → AnimConfig fragment fitter.
 *
 * Pure-function math (no DOM, no THREE.js, no I/O). Consumes a retargeted
 * `PoseClip` produced by `./retarget` and emits a JSON-serializable
 * fragment that can be merged into the live `animConfig` via
 * `applyAnimJSON()`. Only fields with evidence are emitted; missing fields
 * fall back to `getDefaults()` at runtime.
 *
 * Pipeline per `targetAnim`:
 *   - cyclic anims (walk, walk-backward, sprint, dribble, dribble-walk,
 *     dribble-sprint): autocorrelate the hip-side-asymmetry signal
 *     `hipL.x - hipR.x` to extract a fundamental period in seconds, then
 *     map to runtime cycle frequencies. Amplitudes come from peak-to-peak
 *     extents over the clip.
 *   - static anims (idle, guard): no period extraction; fields fitted
 *     from per-channel means and overall extents.
 *   - custom: never fitted; a warning is returned with an empty config.
 *
 * Runtime convention (verified against `src/game/player.ts`):
 *
 *   The runtime drives walk/sprint/etc. as:
 *
 *     const t = animTime * durations.walkStride;
 *     const stride = sin(t) * amplitudes.walk.strideAmp;
 *     position.y = pow((sin(animTime * durations.walkBounce) + 1) / 2, 0.6)
 *                  * amplitudes.walk.bounceHeight;
 *
 *   So `walkStride` is in **radians per second** (cycle period = 2π / walkStride
 *   seconds). The default 3.85 ⇒ ≈1.63 s/stride. The bounce signal is
 *   rectified `(sin+1)/2`, which produces TWO peaks per stride — hence the
 *   convention `walkBounce = 2 * walkStride` (defaults: 3.85 / 7.7).
 *
 * Unit notes for amplitudes:
 *
 *   `bodyY` is consumed in the units the retargeter produces — meters
 *   relative to the captured torso baseline. The retargeter produces world
 *   bodyY in meters; the rig's runtime expects meters too (rig torso is
 *   ~0.55m and the default `walk.bounceHeight = 0.23` is the on-rig peak
 *   height in meters). Therefore no unit conversion is necessary at
 *   fit-time — both producer and consumer agree on meters.
 *
 *   `hipL.x - hipR.x` is in radians (joint angles), so `strideAmp` derived
 *   from it is in radians, exactly matching the runtime contract
 *   (`hipR.rotation.x = stride`).
 */

import {
  type AnimConfig,
  type AnimAmplitudes,
} from '../anim-config';
import {
  type PoseClip,
  type PoseFrame,
  type MocapTargetAnim,
} from './types';

// ---------- Public surface --------------------------------------------------

export interface FitResult {
  /** A `Partial<AnimConfig>`-shaped fragment suitable for `applyAnimJSON`. */
  config: PartialAnimConfig;
  /** Plain-text warnings the editor will surface to the user. */
  warnings: string[];
  /** Diagnostic info for the editor. */
  diagnostics: FitDiagnostics;
}

export interface FitDiagnostics {
  targetAnim: MocapTargetAnim;
  frameCount: number;
  durationSec: number;
  /** Detected fundamental period in seconds (cyclic anims only). */
  detectedCyclesSec?: number;
  /**
   * 0..1: autocorrelation peak height divided by R(0). 1 = perfect
   * sinusoid, 0 = pure noise. < 0.4 is "low confidence" — the cycle
   * fields are still emitted with a warning.
   */
  confidence: number;
}

/**
 * Deeply partial AnimConfig. We only ever emit number leaves and nested
 * object containers — no arrays, no version bumps.
 */
export type PartialAnimConfig = {
  durations?: Partial<AnimConfig['durations']>;
  amplitudes?: {
    [K in keyof AnimAmplitudes]?: Partial<AnimAmplitudes[K]>;
  };
  poses?: {
    [K in keyof AnimConfig['poses']]?: Partial<AnimConfig['poses'][K]>;
  };
};

/**
 * Fit a retargeted clip to an `animConfig` fragment.
 *
 * Never throws on bad input — refuses with a warning instead. The caller
 * (the editor) shows the warnings; an empty config is a no-op merge.
 */
export function fit(clip: PoseClip): FitResult {
  const warnings: string[] = [];
  const targetAnim = clip.source.targetAnim;
  const frames = clip.frames.filter(isCleanFrame);
  const droppedNan = clip.frames.length - frames.length;
  if (droppedNan > 0) {
    warnings.push(`Dropped ${droppedNan} frame(s) with NaN/inf values.`);
  }
  const frameCount = frames.length;
  const durationSec = frameCount > 0 ? frames[frameCount - 1].t - frames[0].t : 0;

  const baseDiagnostics: FitDiagnostics = {
    targetAnim,
    frameCount,
    durationSec,
    confidence: 0,
  };

  if (durationSec < 0.5) {
    warnings.push(
      `Clip is too short (${durationSec.toFixed(2)}s); need ≥ 0.5s for any fit.`,
    );
    return { config: {}, warnings, diagnostics: baseDiagnostics };
  }

  if (targetAnim === 'custom') {
    warnings.push('Custom clips are playback-only; nothing to fit.');
    return { config: {}, warnings, diagnostics: baseDiagnostics };
  }

  switch (targetAnim) {
    case 'idle':
      return fitIdle(clip, frames, warnings, baseDiagnostics);
    case 'guard':
      return fitGuard(clip, frames, warnings, baseDiagnostics);
    case 'walk':
      return fitWalk(clip, frames, warnings, baseDiagnostics);
    case 'walk-backward':
      return fitWalkBackward(clip, frames, warnings, baseDiagnostics);
    case 'sprint':
      return fitSprint(clip, frames, warnings, baseDiagnostics);
    case 'dribble':
    case 'dribble-walk':
      return fitDribble(clip, frames, warnings, baseDiagnostics);
    case 'dribble-sprint':
      return fitDribbleSprint(clip, frames, warnings, baseDiagnostics);
    default: {
      const _exhaustive: never = targetAnim;
      void _exhaustive;
      warnings.push(`Unsupported targetAnim: ${String(targetAnim)}`);
      return { config: {}, warnings, diagnostics: baseDiagnostics };
    }
  }
}

// ---------- Per-targetAnim fitters ------------------------------------------

function fitWalk(
  clip: PoseClip,
  frames: PoseFrame[],
  warnings: string[],
  diag: FitDiagnostics,
): FitResult {
  const { durations, periodSec, confidence } = fitCyclicDurations(
    clip,
    frames,
    'walkStride',
    'walkBounce',
    warnings,
  );
  diag.detectedCyclesSec = periodSec;
  diag.confidence = confidence;

  const walk = fitWalkAmplitudes(frames);
  return {
    config: {
      ...(Object.keys(durations).length ? { durations } : {}),
      amplitudes: { walk },
    },
    warnings,
    diagnostics: diag,
  };
}

function fitWalkBackward(
  clip: PoseClip,
  frames: PoseFrame[],
  warnings: string[],
  diag: FitDiagnostics,
): FitResult {
  const { durations, periodSec, confidence } = fitCyclicDurations(
    clip,
    frames,
    'backwardStride',
    'backwardBounce',
    warnings,
  );
  diag.detectedCyclesSec = periodSec;
  diag.confidence = confidence;

  const walkBackward: Partial<AnimAmplitudes['walkBackward']> = {
    bounceHeight: peakAboveBaseline(map(frames, (f) => f.bodyY)),
    strideAmp: avgHipStrideAmp(frames),
    kneeBase: meanKneeBase(frames),
    kneeSwing: halfRange(map(frames, (f) => f.kneeL)),
    shoulderX: Math.abs(meanOf(map(frames, (f) => f.shoulderL.x))),
    shoulderZ: Math.abs(meanOf(map(frames, (f) => f.shoulderL.z))),
  };
  return {
    config: {
      ...(Object.keys(durations).length ? { durations } : {}),
      amplitudes: { walkBackward },
    },
    warnings,
    diagnostics: diag,
  };
}

function fitSprint(
  clip: PoseClip,
  frames: PoseFrame[],
  warnings: string[],
  diag: FitDiagnostics,
): FitResult {
  const { durations, periodSec, confidence } = fitCyclicDurations(
    clip,
    frames,
    'sprintStride',
    'sprintBounce',
    warnings,
  );
  diag.detectedCyclesSec = periodSec;
  diag.confidence = confidence;

  // Sprint schema differs from walk: kneeDrive replaces kneeSwing,
  // shoulderSwing replaces armSwingRatio.
  const hipAmp = avgHipStrideAmp(frames);
  const shoulderAmp = halfRange(map(frames, (f) => f.shoulderL.x));
  const sprint: Partial<AnimAmplitudes['sprint']> = {
    bounceHeight: peakAboveBaseline(map(frames, (f) => f.bodyY)),
    strideAmp: hipAmp,
    forwardLean: meanOf(map(frames, (f) => f.bodyPivot.x)),
    kneeBase: meanKneeBase(frames),
    kneeDrive: halfRange(map(frames, (f) => f.kneeL)),
    shoulderSwing: shoulderAmp,
    elbowBend: Math.abs(meanOf(map(frames, (f) => (f.elbowL + f.elbowR) / 2))),
    hipTwist: halfRange(map(frames, (f) => f.hipMeshY)),
    torsoTwist: halfRange(map(frames, (f) => f.torsoY)),
  };
  return {
    config: {
      ...(Object.keys(durations).length ? { durations } : {}),
      amplitudes: { sprint },
    },
    warnings,
    diagnostics: diag,
  };
}

function fitDribble(
  clip: PoseClip,
  frames: PoseFrame[],
  warnings: string[],
  diag: FitDiagnostics,
): FitResult {
  // Dribble uses walkStride for the legs (the runtime literally reads
  // `durations.walkStride` for dribble leg motion). We can also note the
  // dribble-arm cycle (`dribbleCycle`) from the captured ball-arm motion,
  // but that needs explicit ball-side awareness so we skip it for v1.
  const { durations, periodSec, confidence } = fitCyclicDurations(
    clip,
    frames,
    'walkStride',
    'walkBounce',
    warnings,
  );
  diag.detectedCyclesSec = periodSec;
  diag.confidence = confidence;
  warnings.push(
    'Dribble arm pump (armUpElbow/armDownElbow/shoulder*Pump) not fitted: ' +
      'requires explicit ball-side awareness. Default values retained.',
  );

  const bodyCrouch = -Math.min(0, meanOf(map(frames, (f) => f.bodyY)));
  const dribble: Partial<AnimAmplitudes['dribble']> = {
    bounceHeight: peakAboveBaseline(map(frames, (f) => f.bodyY)),
    strideAmp: avgHipStrideAmp(frames),
    kneeBase: meanKneeBase(frames),
    kneeSwing: halfRange(map(frames, (f) => f.kneeL)),
    bodyCrouch,
  };
  return {
    config: {
      ...(Object.keys(durations).length ? { durations } : {}),
      amplitudes: { dribble },
    },
    warnings,
    diagnostics: diag,
  };
}

function fitDribbleSprint(
  clip: PoseClip,
  frames: PoseFrame[],
  warnings: string[],
  diag: FitDiagnostics,
): FitResult {
  const { durations, periodSec, confidence } = fitCyclicDurations(
    clip,
    frames,
    'dribbleSprintStride',
    'dribbleSprintBounce',
    warnings,
  );
  diag.detectedCyclesSec = periodSec;
  diag.confidence = confidence;
  warnings.push(
    'Dribble-sprint arm pump (leftArmOutward & dribble arm) not fitted: ' +
      'requires ball-side awareness. Default values retained.',
  );

  const bodyCrouch = -Math.min(0, meanOf(map(frames, (f) => f.bodyY)));
  const dribbleSprint: Partial<AnimAmplitudes['dribbleSprint']> = {
    bounceHeight: peakAboveBaseline(map(frames, (f) => f.bodyY)),
    strideAmp: avgHipStrideAmp(frames),
    bodyCrouch,
    kneeBase: meanKneeBase(frames),
    kneeSwing: halfRange(map(frames, (f) => f.kneeL)),
  };
  return {
    config: {
      ...(Object.keys(durations).length ? { durations } : {}),
      amplitudes: { dribbleSprint },
    },
    warnings,
    diagnostics: diag,
  };
}

function fitIdle(
  clip: PoseClip,
  frames: PoseFrame[],
  warnings: string[],
  diag: FitDiagnostics,
): FitResult {
  // Idle has very low-amplitude motion. We try a slow autocorr on bodyY to
  // recover `idleBob`, but if it's effectively static we leave the duration
  // alone and just emit means.
  const { period, confidence, lagsTried } = autocorrPeriod(
    map(frames, (f) => f.bodyY),
    clip.fps,
    /* minPeriodSec */ 1.0,
    /* maxPeriodSec */ Math.min(durationOf(frames) / 1.5, 6),
  );
  diag.confidence = confidence;
  const durations: Partial<AnimConfig['durations']> = {};
  if (lagsTried && period > 0 && confidence >= 0.4) {
    diag.detectedCyclesSec = period;
    durations.idleBob = (2 * Math.PI) / period;
  } else if (lagsTried && period > 0) {
    diag.detectedCyclesSec = period;
    durations.idleBob = (2 * Math.PI) / period;
    warnings.push(
      `idleBob fitted with low confidence (${confidence.toFixed(2)}). Default may be preferable.`,
    );
  }

  // Mean magnitudes — knee bend and elbow bend are typically negative or
  // mid-range angles; the runtime amplitude is a magnitude scalar so we
  // take absolute values.
  const idle: Partial<AnimAmplitudes['idle']> = {
    swayHeight: halfRange(map(frames, (f) => f.bodyY)),
    kneeBend: Math.abs(meanKneeBase(frames)),
    elbowBend: Math.abs(meanOf(map(frames, (f) => (f.elbowL + f.elbowR) / 2))),
  };

  return {
    config: {
      ...(Object.keys(durations).length ? { durations } : {}),
      amplitudes: { idle },
    },
    warnings,
    diagnostics: diag,
  };
}

function fitGuard(
  _clip: PoseClip,
  frames: PoseFrame[],
  warnings: string[],
  diag: FitDiagnostics,
): FitResult {
  // Guard is essentially static. The runtime drives a `guardPulse` only on
  // the block-screen opacity, which we can't observe from joint data; we
  // leave that duration alone.
  diag.confidence = 1; // trivially confident — these are just means
  void warnings;

  // Knee bend is the runtime's `kneeBend`: positive flex (kneeLRotX > 0).
  // shoulderRaise and shoulderSpread are magnitudes (rad).
  const guard: Partial<AnimAmplitudes['guard']> = {
    forwardLean: meanOf(map(frames, (f) => f.bodyPivot.x)),
    hipSpread: Math.abs(meanOf(map(frames, (f) => (f.hipL.z - f.hipR.z) / 2))),
    kneeBend: Math.abs(meanKneeBase(frames)),
    // For arms-up guard, shoulder.x is large negative; we want the magnitude.
    shoulderRaise: Math.abs(
      meanOf(map(frames, (f) => (f.shoulderL.x + f.shoulderR.x) / 2)),
    ),
    shoulderSpread: Math.abs(
      meanOf(map(frames, (f) => (f.shoulderR.z - f.shoulderL.z) / 2)),
    ),
  };

  return {
    config: { amplitudes: { guard } },
    warnings,
    diagnostics: diag,
  };
}

// ---------- Cycle-detection helpers -----------------------------------------

/**
 * Autocorrelate a discrete signal and return the period of its strongest
 * peak in seconds, normalized confidence (peak / R(0)), and whether any
 * lags were even tried (false ⇒ clip too short for the requested band).
 *
 * `minPeriodSec` and `maxPeriodSec` bound the search. We require the clip
 * to span at least `1.5 * maxPeriodSec` so the comparison window has data.
 */
function autocorrPeriod(
  signal: number[],
  fps: number,
  minPeriodSec: number,
  maxPeriodSec: number,
): { period: number; confidence: number; lagsTried: boolean } {
  const n = signal.length;
  if (n < 4 || fps <= 0) return { period: 0, confidence: 0, lagsTried: false };

  // Subtract mean (we want autocovariance, not raw correlation, so DC bias
  // doesn't dominate).
  const mean = signal.reduce((a, b) => a + b, 0) / n;
  const centered = signal.map((s) => s - mean);

  const minLag = Math.max(2, Math.floor(minPeriodSec * fps));
  const maxLag = Math.min(n - 2, Math.floor(maxPeriodSec * fps));
  if (maxLag <= minLag) return { period: 0, confidence: 0, lagsTried: false };

  // R(0) for normalization.
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += centered[i] * centered[i];
  if (r0 === 0) return { period: 0, confidence: 0, lagsTried: true };

  // Compute R(τ) for every lag in the search window first, then pick the
  // strongest *interior local maximum*. Earlier versions used a plain
  // argmax, which on non-cyclic input picks whichever boundary lag happens
  // to have the highest correlation — yielding nonsense periods like the
  // exact minPeriod or maxPeriod. A real walk's autocorrelation has a
  // clear interior peak; if the only "best" lag is at the boundary, the
  // signal isn't periodic enough to fit, and we report confidence 0.
  const rs = new Array<number>(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0;
    for (let i = 0; i < n - lag; i++) r += centered[i] * centered[i + lag];
    // Normalize so longer lags don't get penalized just for shorter sums.
    rs[lag] = r * (n / (n - lag));
  }

  let bestLag = -1;
  let bestR = -Infinity;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (rs[lag] >= rs[lag - 1] && rs[lag] >= rs[lag + 1] && rs[lag] > bestR) {
      bestR = rs[lag];
      bestLag = lag;
    }
  }
  if (bestLag < 0) {
    // No interior local max — signal lacks clean periodicity in this band.
    return { period: 0, confidence: 0, lagsTried: true };
  }

  // Sub-sample refine via parabolic interpolation around the peak.
  const refinedLag = parabolicRefine(centered, bestLag, n);
  const period = refinedLag / fps;
  const confidence = clamp01(bestR / r0);
  return { period, confidence, lagsTried: true };
}

/** Parabolic interpolation around `lag` using neighbouring autocorr values. */
function parabolicRefine(centered: number[], lag: number, n: number): number {
  if (lag <= 1 || lag >= n - 2) return lag;
  const r = (k: number) => {
    let s = 0;
    for (let i = 0; i < n - k; i++) s += centered[i] * centered[i + k];
    return s * (n / (n - k));
  };
  const yMinus = r(lag - 1);
  const yZero = r(lag);
  const yPlus = r(lag + 1);
  const denom = yMinus - 2 * yZero + yPlus;
  if (denom === 0) return lag;
  const delta = (0.5 * (yMinus - yPlus)) / denom;
  // Clamp delta to [-1, 1] so a noisy fit can't fly off the peak.
  const clamped = Math.max(-1, Math.min(1, delta));
  return lag + clamped;
}

/**
 * Run `autocorrPeriod` on the canonical leg-cycle signal and convert the
 * detected period to runtime cycle frequencies. Empty `durations` result
 * (and a warning) for too-short clips; low-confidence still emits but
 * adds a warning.
 */
function fitCyclicDurations(
  clip: PoseClip,
  frames: PoseFrame[],
  strideKey: keyof AnimConfig['durations'],
  bounceKey: keyof AnimConfig['durations'],
  warnings: string[],
): {
  durations: Partial<AnimConfig['durations']>;
  periodSec: number | undefined;
  confidence: number;
} {
  // hipL.x − hipR.x: one cycle per stride, near-sinusoidal, robust to bias.
  const sig = map(frames, (f) => f.hipL.x - f.hipR.x);

  // Reasonable strides at 30fps: a fast sprint cycles ~0.5s, a slow walk
  // ~2.5s. We constrain to [0.3, 3.0] to catch outliers but reject DC.
  const minPeriodSec = 0.3;
  const maxPeriodSec = 3.0;

  // Need ≥ 1.5 cycles' worth of data at the longest period we'll consider.
  const dur = durationOf(frames);
  if (dur < 1.5 * minPeriodSec) {
    warnings.push(
      `Clip too short (${dur.toFixed(2)}s) to detect a cycle period; ` +
        'duration fields omitted.',
    );
    return { durations: {}, periodSec: undefined, confidence: 0 };
  }

  // Cap the search by what the clip can support: we need ≥ 1.5 cycles.
  const adjustedMax = Math.min(maxPeriodSec, dur / 1.5);
  const { period, confidence, lagsTried } = autocorrPeriod(
    sig,
    clip.fps,
    minPeriodSec,
    adjustedMax,
  );
  // Hard floor: below 0.15 the autocorrelation peak is indistinguishable
  // from noise (a clean walk runs 0.6–0.9 here). Emit nothing rather than
  // baking a noise-derived period into the output.
  const HARD_FLOOR = 0.15;
  if (!lagsTried || period <= 0 || confidence < HARD_FLOOR) {
    warnings.push(
      `No clean cycle detected (autocorr peak ${confidence.toFixed(2)} < ` +
        `${HARD_FLOOR}). The captured motion likely isn't a steady-rhythm ` +
        'gait — durations omitted, amplitudes still fitted but should be ' +
        'reviewed.',
    );
    return { durations: {}, periodSec: undefined, confidence };
  }
  if (confidence < 0.4) {
    warnings.push(
      `Low cycle-detection confidence (${confidence.toFixed(2)}); ` +
        'duration fields included but may be unreliable.',
    );
  }

  // walkStride = 2π / T (rad/sec). Bounce is rectified-sine — two peaks per
  // stride — so 2× the stride frequency.
  const stride = (2 * Math.PI) / period;
  const bounce = 2 * stride;
  const durations: Partial<AnimConfig['durations']> = {};
  durations[strideKey] = stride;
  durations[bounceKey] = bounce;
  return { durations, periodSec: period, confidence };
}

// ---------- Walk amplitude block (shared with related cyclic anims) ---------

function fitWalkAmplitudes(frames: PoseFrame[]): Partial<AnimAmplitudes['walk']> {
  // Hip stride amplitude: half of (max − min) of a single hip's sagittal
  // angle, averaged across L/R for symmetry.
  const hipAmp = avgHipStrideAmp(frames);
  // bodyY is non-negative in the captured/runtime convention (rectified sine
  // starting from a ground baseline of 0). The runtime parameter
  // `bounceHeight` is the PEAK, not the half-range, so we use the full
  // observed range above the baseline as the fit value.
  const bounceHeight = peakAboveBaseline(map(frames, (f) => f.bodyY));
  // Mean knee flex baseline (the runtime adds dynamic swing on top).
  const kneeBase = meanKneeBase(frames);
  // Per-knee swing magnitude.
  const kneeSwing = (
    halfRange(map(frames, (f) => f.kneeL)) +
    halfRange(map(frames, (f) => f.kneeR))
  ) / 2;
  // Shoulder/hip amplitude ratio. Clamp guards against tiny-hip
  // denominators producing wild ratios.
  const shoulderAmp = (
    halfRange(map(frames, (f) => f.shoulderL.x)) +
    halfRange(map(frames, (f) => f.shoulderR.x))
  ) / 2;
  const armSwingRatio = clamp(
    hipAmp > 1e-4 ? shoulderAmp / hipAmp : 0,
    0,
    2,
  );
  // Elbow baseline bend (the runtime uses this as a constant offset; the
  // per-stride bend is layered procedurally).
  const elbowBend = Math.abs(
    meanOf(map(frames, (f) => (f.elbowL + f.elbowR) / 2)),
  );
  const forwardLean = meanOf(map(frames, (f) => f.bodyPivot.x));
  const hipTwist = halfRange(map(frames, (f) => f.hipMeshY));
  const torsoTwist = halfRange(map(frames, (f) => f.torsoY));

  return {
    bounceHeight,
    strideAmp: hipAmp,
    kneeBase,
    kneeSwing,
    armSwingRatio,
    elbowBend,
    forwardLean,
    hipTwist,
    torsoTwist,
  };
}

// ---------- Shared signal helpers -------------------------------------------

function avgHipStrideAmp(frames: PoseFrame[]): number {
  const ampL = halfRange(map(frames, (f) => f.hipL.x));
  const ampR = halfRange(map(frames, (f) => f.hipR.x));
  return (ampL + ampR) / 2;
}

function meanKneeBase(frames: PoseFrame[]): number {
  return meanOf(map(frames, (f) => (f.kneeL + f.kneeR) / 2));
}

function map<T>(frames: PoseFrame[], pick: (f: PoseFrame) => T): T[] {
  const out: T[] = new Array(frames.length);
  for (let i = 0; i < frames.length; i++) out[i] = pick(frames[i]);
  return out;
}

function meanOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const x of arr) s += x;
  return s / arr.length;
}

function halfRange(arr: number[]): number {
  if (arr.length === 0) return 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of arr) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return (hi - lo) / 2;
}

/**
 * For one-sided signals (rectified bounces, etc.) the runtime parameter is
 * the peak above the baseline (≈ min). Returns max − min directly.
 */
function peakAboveBaseline(arr: number[]): number {
  if (arr.length === 0) return 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of arr) {
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return hi - lo;
}

function durationOf(frames: PoseFrame[]): number {
  if (frames.length < 2) return 0;
  return frames[frames.length - 1].t - frames[0].t;
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Reject frames containing any NaN / infinity values. */
function isCleanFrame(f: PoseFrame): boolean {
  return (
    isFiniteNum(f.t) &&
    isFiniteNum(f.bodyY) &&
    isFiniteVec3(f.bodyPivot) &&
    isFiniteNum(f.hipMeshY) &&
    isFiniteNum(f.torsoY) &&
    isFiniteVec3(f.neck) &&
    isFiniteShoulder(f.shoulderL) &&
    isFiniteShoulder(f.shoulderR) &&
    isFiniteNum(f.elbowL) &&
    isFiniteNum(f.elbowR) &&
    isFiniteShoulder(f.hipL) &&
    isFiniteShoulder(f.hipR) &&
    isFiniteNum(f.kneeL) &&
    isFiniteNum(f.kneeR)
  );
}

function isFiniteNum(x: number): boolean {
  return Number.isFinite(x);
}

function isFiniteVec3(v: { x: number; y: number; z: number }): boolean {
  return isFiniteNum(v.x) && isFiniteNum(v.y) && isFiniteNum(v.z);
}

function isFiniteShoulder(v: { x: number; z: number }): boolean {
  return isFiniteNum(v.x) && isFiniteNum(v.z);
}
