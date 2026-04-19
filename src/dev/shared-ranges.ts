/**
 * Shared range-picking heuristic for animation-tuning sliders.
 *
 * Used by both the dev overlay's ANIMATION section (`src/dev/dev-overlay.ts`)
 * and the anim-viewer page's per-animation tuning panel
 * (`src/anim-viewer.ts`). Consolidating the heuristic here ensures both
 * editors expose identical bounds/steps for every field in `animConfig`.
 *
 * The three tiers of `animConfig` each have their own classification:
 *   - `durations`: fixed state durations (seconds) vs cycle-frequency
 *     multipliers (unitless, large)
 *   - `amplitudes`: per-animation principal knobs (heights, swings,
 *     opacities, timing fractions, squash/stretch factors, etc.)
 *   - `poses`: endpoint bone transforms (rotations in radians, positional
 *     Y offsets, squash/stretch factors, swing/delta/offset amplitudes,
 *     and factor/ratio/amount knobs)
 *
 * Where the two editors previously disagreed, this module uses the
 * *superset* range (widest of the two) so that nothing tightens — any
 * value either editor previously accepted is still accepted here.
 */

export interface SliderRange {
  min: number;
  max: number;
  step: number;
}

export type RangeTier = 'durations' | 'amplitudes' | 'poses';

/** Cycle-frequency duration keys — multipliers applied to `animTime`.
 * These typically have large values (e.g. walkStride=5, sprintBounce=16). */
const CYCLE_DURATION_KEYS = new Set<string>([
  'idleBob',
  'walkStride',
  'walkBounce',
  'backwardStride',
  'backwardBounce',
  'sprintStride',
  'sprintBounce',
  'dribbleCycle',
  'dribbleSprintStride',
  'dribbleSprintBounce',
  'guardPulse',
  'indicatorBob',
  'possessionRingPulse',
]);

/**
 * Pick the `{min, max, step}` for a slider on an animation-config field.
 *
 * @param tier  Top-level tier of `animConfig` (`durations` | `amplitudes` | `poses`).
 * @param path  Full dotted path (e.g. `['amplitudes', 'jump', 'apexHeight']`).
 * @param key   Final field name (last element of `path`).
 * @param value Current value, used only as a fallback for rotation fields
 *              whose default already exceeds the nominal ±π bound.
 */
export function pickSliderRange(
  tier: RangeTier,
  path: string[],
  key: string,
  value: number,
): SliderRange {
  if (tier === 'durations') {
    return pickDurationRange(key);
  }
  if (tier === 'amplitudes') {
    return pickAmplitudeRange(path, key);
  }
  return pickPoseRange(key, value);
}

function pickDurationRange(key: string): SliderRange {
  // Fixed state durations (seconds) — `xxxDuration`
  if (/Duration$/.test(key)) {
    return { min: 0.05, max: 3.0, step: 0.01 };
  }
  // Cycle frequency multipliers — larger range, wider than either original
  // (dev-overlay min 0.5, anim-viewer min 0.1 → use 0.1 as the superset min).
  if (CYCLE_DURATION_KEYS.has(key)) {
    return { min: 0.1, max: 30, step: 0.1 };
  }
  // Unknown duration field — fall back to cycle-multiplier semantics
  // (matches dev-overlay's previous catch-all for the `durations` tier).
  return { min: 0.1, max: 30, step: 0.1 };
}

function pickAmplitudeRange(path: string[], key: string): SliderRange {
  const anim = path.length >= 3 ? path[1] : '';
  const lower = key.toLowerCase();

  // --- Opacity knobs: [0, 1] -----------------------------------------------
  // Explicit regex covers both min and swing variants; previously
  // dev-overlay tested `blockOpacityMin`/`blockOpacitySwing` exactly, while
  // anim-viewer used `.includes('opacity')`. Unified via regex.
  if (/opacity/i.test(key)) {
    return { min: 0, max: 1, step: 0.01 };
  }

  // --- Dunk-specific approach knobs ---------------------------------------
  // dev-overlay used `[0, 20, 0.5]`; anim-viewer used `[1, 20, 0.5]`.
  // Superset: `[0, 20, 0.5]` (wider on the low end).
  if (anim === 'dunk' && key === 'approachSpeed') {
    return { min: 0, max: 20, step: 0.5 };
  }
  if (anim === 'dunk' && key === 'approachDist') {
    return { min: 0, max: 3, step: 0.05 };
  }

  // --- Dunk timing fractions: [0, 1] --------------------------------------
  // Phase-timing normalized values. dev-overlay matched `/(Start|Time)$/`
  // scoped to dunk; anim-viewer listed each field explicitly. Keep the
  // dunk-scoped regex plus anim-viewer's explicit field list for safety.
  if (anim === 'dunk' && /(Start|Time)$/.test(key)) {
    return { min: 0, max: 1, step: 0.01 };
  }
  if (key === 'riseTime' || key === 'hangStart' || key === 'dropStart' || key === 'landStart') {
    return { min: 0, max: 1, step: 0.01 };
  }

  // --- Apex-style "how high" knobs ----------------------------------------
  // dev-overlay `[0, 5, 0.05]` vs anim-viewer `[-3, 3, 0.01]`.
  // Superset: `[-3, 5, 0.05]` (both bounds widened, step kept at 0.05).
  if (/^apex/i.test(key) || key === 'hopHeight' || key === 'groundDrop') {
    return { min: -3, max: 5, step: 0.05 };
  }

  // --- Bounce / stride / knee-swing / bob ---------------------------------
  // dev-overlay `[0, 2, 0.01]` vs anim-viewer `[-3, 3, 0.01]` → superset `[-3, 3, 0.01]`.
  if (key === 'bounceHeight' || key === 'strideAmp' || key === 'kneeSwing' || key === 'bob') {
    return { min: -3, max: 3, step: 0.01 };
  }

  // --- Compression / squash-stretch / scale / thickness factors -----------
  // dev-overlay `[0.5, 2.0, 0.01]` vs anim-viewer `[0.3, 2.5, 0.01]` →
  // superset `[0.3, 2.5, 0.01]`.
  if (
    /^compression/i.test(key) ||
    /^armScale/i.test(key) ||
    /^armThickness/i.test(key) ||
    /rimHangArmScale/i.test(key) ||
    lower.includes('squash') ||
    lower.includes('stretch') ||
    lower.includes('scale') ||
    lower.includes('compression') ||
    lower.includes('thickness')
  ) {
    return { min: 0.3, max: 2.5, step: 0.01 };
  }

  // --- Heights / apex / lateral / drop / bob / bounce / stride / amp ------
  // anim-viewer's positional-magnitude catch-all.
  if (
    lower.includes('height') ||
    lower.includes('apex') ||
    lower.includes('lateral') ||
    lower.includes('drop') ||
    lower.includes('bob') ||
    lower.includes('bounce') ||
    lower.includes('stride') ||
    lower.includes('amp')
  ) {
    return { min: -3, max: 3, step: 0.01 };
  }

  // --- Ratio / factor fields: [-2, 2] -------------------------------------
  if (lower.includes('ratio') || lower.includes('factor')) {
    return { min: -2, max: 2, step: 0.01 };
  }

  // --- Default amplitude --------------------------------------------------
  // dev-overlay `[0, 3, 0.01]` vs anim-viewer `[-3, 3, 0.01]` →
  // superset `[-3, 3, 0.01]`.
  return { min: -3, max: 3, step: 0.01 };
}

function pickPoseRange(key: string, value: number): SliderRange {
  // Positional Y offsets — keep named fields plus anim-viewer's widened bounds.
  // dev-overlay `[-2, 2, 0.01]` vs anim-viewer `[-3, 3, 0.01]` → superset `[-3, 3, 0.01]`.
  if (/PosY$/i.test(key) || key === 'stanceDropY') {
    return { min: -3, max: 3, step: 0.01 };
  }

  // Squash/stretch / compression factors — widen to anim-viewer's `[0.3, 2.5]`.
  if (/Squash/i.test(key) || /squashStretch/i.test(key) || /Compression/i.test(key)) {
    return { min: 0.3, max: 2.5, step: 0.01 };
  }

  // Swing amplitudes on pose fields (sin/cos coefficients — radians-ish).
  // dev-overlay `[-3.2, 3.2, 0.01]` vs anim-viewer `[-3, 3, 0.01]` →
  // superset `[-3.2, 3.2, 0.01]`.
  if (/Swing$/.test(key) || /Delta$/.test(key) || /Offset$/.test(key)) {
    return { min: -3.2, max: 3.2, step: 0.01 };
  }

  // Factor / Amount / Amp / Ratio pose fields — bounded magnitude.
  if (/Factor$/.test(key) || /Amount$/.test(key) || /Amp$/.test(key) || /Ratio$/.test(key)) {
    return { min: -2, max: 2, step: 0.01 };
  }

  // Default pose field: rotation in radians (roughly ±π). Widen if the
  // current default already exceeds the nominal ±π bound (anim-viewer's
  // safety fallback).
  const absDef = Math.abs(value);
  if (absDef > 3.1) {
    const bound = Math.ceil(absDef * 1.25 * 100) / 100;
    return { min: -bound, max: bound, step: 0.01 };
  }
  return { min: -3.2, max: 3.2, step: 0.01 };
}
