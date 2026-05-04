/**
 * Phase H6 — Game-state → face-expression sequence table.
 *
 * Maps each `GamePlayer.animState` value to a `FaceAnimSequence`: a
 * timed list of composite keyframes that the H6 game-state driver
 * fires through the H4 keyframe mixer at priority `'game-state'`.
 *
 * --- Key naming ---
 *
 * `GamePlayer.animState` uses HYPHENATED forms (`'dribble-sprint'`,
 * `'jump-block'`) at runtime. `AnimConfig.poses` uses CAMEL-CASE keys
 * (`dribbleSprint`, `jumpBlock`). We index this table by the runtime
 * (hyphenated) form, then validate at module-init that every key in
 * the table either matches an `AnimConfig.poses` key (translated to
 * the hyphenated form) OR is one of the always-present runtime keys
 * (`'idle'`, `'walk'`, etc. that already align). Unknown keys would
 * never be triggered by the player and are dropped with a one-shot
 * warning so a typo here surfaces in dev console.
 *
 * --- Sequence semantics ---
 *
 * Each step has a time `t` (seconds from sequence start) and a
 * `composite` keyframe name (must exist in `COMPOSITES` from the H4
 * mixer). Steps fire in order; a step at `t=0` fires immediately on
 * `onAnimStateChange()`. After the final step, if `hold` is set the
 * driver retargets that composite as the resting expression; without
 * `hold` the driver releases its 'game-state' claims after a short
 * tail so lower-priority drivers (idle-blink) regain control.
 *
 * `loop:true` makes the sequence restart after the last step (with a
 * configurable interval) — currently used for none of the v1 entries
 * but supported for future idle-fidget face animations.
 */
import { COMPOSITES, type KeyframeName } from './face-keyframe-anim';
import { animConfig } from '../anim-config';

export interface FaceAnimStep {
  /** Seconds from sequence start. */
  t: number;
  /** Composite keyframe to set. Must exist in `COMPOSITES`. */
  composite: KeyframeName;
  /** Override crossfade duration (ms). Defaults to per-track defaults. */
  durationMs?: number;
}

export interface FaceAnimSequence {
  steps: ReadonlyArray<FaceAnimStep>;
  /** Composite to settle on after the last step. Defaults to releasing
   *  all 'game-state' claims (so the face falls back to lower drivers
   *  / idle-blink). When set, the driver retargets this composite
   *  AFTER firing the last step. */
  hold?: KeyframeName;
  /** Loop the sequence (e.g. for idle face fidgets). Default false. */
  loop?: boolean;
  /** When `loop:true`, seconds between the last step firing and the
   *  next iteration's first step. Default 2s. */
  loopIntervalSec?: number;
}

/**
 * The raw table — indexed by the runtime `animState` strings the
 * player emits. Keys NOT in `AnimConfig.poses` (after hyphen→camel
 * translation) are validated at module-init and dropped from the
 * effective table with a console warning.
 */
const RAW_FACE_ANIM_BY_STATE: Readonly<Record<string, FaceAnimSequence>> = Object.freeze({
  idle:               { steps: [{ t: 0, composite: 'rest' }] },
  walk:               { steps: [{ t: 0, composite: 'rest' }] },
  walkBackward:       { steps: [{ t: 0, composite: 'concentrating' }] },
  dribble:            { steps: [{ t: 0, composite: 'concentrating' }] },
  dribbleStationary:  { steps: [{ t: 0, composite: 'concentrating' }] },
  sprint:             { steps: [{ t: 0, composite: 'concentrating' }] },
  // Player.animState uses 'dribble-sprint' (hyphenated). AnimConfig.poses
  // uses 'dribbleSprint'. Both forms map to the same sequence.
  'dribble-sprint':   { steps: [{ t: 0, composite: 'concentrating' }] },
  dribbleSprint:      { steps: [{ t: 0, composite: 'concentrating' }] },
  guard:              { steps: [{ t: 0, composite: 'angry' }] },
  steal:              { steps: [{ t: 0, composite: 'concentrating' }, { t: 0.4, composite: 'joy' }] },
  shoot:              { steps: [{ t: 0, composite: 'concentrating' }, { t: 0.35, composite: 'rest' }] },
  jump:               { steps: [{ t: 0, composite: 'surprised' }] },
  // Player.animState uses 'jump-block' (hyphenated). AnimConfig.poses
  // uses 'jumpBlock'. Both forms map to the same sequence.
  'jump-block':       { steps: [{ t: 0, composite: 'angry' }] },
  jumpBlock:          { steps: [{ t: 0, composite: 'angry' }] },
  fall:               {
    steps: [
      { t: 0, composite: 'pain' },
      { t: 0.6, composite: 'confused' },
    ],
    hold: 'rest',
  },
  dunk:               {
    steps: [
      { t: 0, composite: 'concentrating' },
      { t: 0.45, composite: 'angry' },
      { t: 0.85, composite: 'joy' },
    ],
    hold: 'rest',
  },
  pass:               { steps: [{ t: 0, composite: 'concentrating' }, { t: 0.2, composite: 'rest' }] },
  beerHold:           { steps: [{ t: 0, composite: 'rest' }] },
});

/**
 * Translate a runtime `animState` (hyphenated) to its `AnimConfig.poses`
 * key (camelCase). E.g. `'dribble-sprint'` → `'dribbleSprint'`.
 */
function hyphenToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Validate the raw table against `animConfig.poses` and the H4
 * COMPOSITES recipe map. Returns the filtered effective table; any
 * dropped keys are reported via `console.warn` (one-shot — module
 * init runs once).
 */
function buildEffectiveTable(): Readonly<Record<string, FaceAnimSequence>> {
  const poses = animConfig.poses as unknown as Record<string, unknown>;
  const validPoseKeys = new Set<string>(Object.keys(poses));
  const out: Record<string, FaceAnimSequence> = {};
  const dropped: string[] = [];
  for (const key of Object.keys(RAW_FACE_ANIM_BY_STATE)) {
    // Accept the key if either:
    //   - it's already an AnimConfig.poses key (camelCase)
    //   - its hyphen→camel translation is an AnimConfig.poses key
    //     (covers 'dribble-sprint' → 'dribbleSprint', etc.)
    const camel = hyphenToCamel(key);
    const isPoseKey = validPoseKeys.has(key) || validPoseKeys.has(camel);
    if (!isPoseKey) {
      dropped.push(key);
      continue;
    }
    // Validate every step's composite exists in COMPOSITES.
    const seq = RAW_FACE_ANIM_BY_STATE[key];
    let allCompositesValid = true;
    for (const step of seq.steps) {
      if (!(step.composite in COMPOSITES)) {
        dropped.push(`${key} (unknown composite '${step.composite}')`);
        allCompositesValid = false;
        break;
      }
    }
    if (seq.hold && !(seq.hold in COMPOSITES)) {
      dropped.push(`${key} (unknown hold composite '${seq.hold}')`);
      allCompositesValid = false;
    }
    if (!allCompositesValid) continue;
    out[key] = seq;
  }
  if (dropped.length > 0) {
    // One-time warning at module-init; not a per-frame log.
    // eslint-disable-next-line no-console
    console.warn(
      '[face-anim-config] dropped sequence keys (no matching AnimConfig.poses entry or unknown composite):',
      dropped,
    );
  }
  return Object.freeze(out);
}

/**
 * The validated, effective sequence table — indexed by `animState`
 * strings. Lookups for unknown states return `undefined`, which the
 * driver treats as "ignore + log warning once".
 */
export const FACE_ANIM_BY_STATE: Readonly<Record<string, FaceAnimSequence>> =
  buildEffectiveTable();
