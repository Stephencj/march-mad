/**
 * Phase H5 — Live MediaPipe puppet → keyframe mixer driver.
 *
 * Sits between a `FacePuppet` (or any `BlendshapeSource`) and the
 * `FaceKeyframeMixer`. Each `tick()` reads the current EMA-smoothed
 * blendshape coefficients and translates them into per-track keyframe
 * claims at priority `'live-puppet'` per Section 4 of the design plan.
 *
 * --- Strategy ---
 *
 * Per track we evaluate every candidate (kf, t) the source might map
 * to, then pick a winner with hysteresis: the previous winner wins
 * unless a new candidate beats it by `hysteresis` (default 0.1). When
 * the winning t is below `RELEASE_THRESHOLD` (0.05) we release the
 * 'live-puppet' claim entirely so lower-priority drivers (game-state,
 * idle-blink) take over.
 *
 * Live puppet skips easing — `FacePuppet`'s α=0.45 EMA already
 * smooths the input — so every `setTrack` uses `durationMs:0`. The
 * raw smoothed coefficient itself drives `t`, frame-to-frame.
 *
 * --- Composite-style brow furrow ---
 *
 * When `browDownLeft + browDownRight ≥ 0.4` we promote BOTH brow
 * tracks to `furrowed` (composite-style) per the design plan. That
 * outranks the per-side `down` candidate.
 *
 * --- Asymmetric smirk ---
 *
 * `abs(mouthSmileLeft − mouthSmileRight) ≥ 0.3` is the trigger for
 * `asymmetric-smirk` on the mouth track. Its t is the absolute diff
 * itself, capped at 1.
 *
 * --- Look direction (deferred) ---
 *
 * The plan's Section 4 maps `eyeLookUpLeft − eyeLookDownLeft` to
 * `look-up`/`look-down` keyframes, and `eyeLookInLeft − eyeLookOutLeft`
 * to `look-in`/`look-out`. v1 ships none of those keyframe textures
 * yet (only `rest`, `blink-full`, `squint`, `wide` exist for eyes),
 * so the look-direction mapping is left as a TODO for K4.
 */
import type { FaceKeyframeMixer, FeatureTrack, KeyframeName } from './face-keyframe-anim';
import type { BlendshapeSource } from './procedural-face';

export interface LiveDriverOptions {
  /** Hysteresis margin — winning keyframe must beat runner-up by this
   *  much to flip. Default 0.1. */
  hysteresis?: number;
  /** Override per-track (optional). For tuning. */
  tunings?: Partial<Record<FeatureTrack, { hysteresis?: number }>>;
}

export interface FaceLiveDriver {
  /** Read source values + apply mapping table + claim mixer tracks at
   *  priority 'live-puppet'. Idempotent — safe to call every frame. */
  tick(): void;
  /** Releases all live-puppet claims so the mixer falls back to lower-
   *  priority drivers. */
  detach(): void;
  /** Whether the driver is currently active. False after `detach()`. */
  readonly isActive: boolean;
}

/** Below this t the driver releases its claim instead of holding the
 *  track at `kf` with near-zero weight. Lets lower-priority drivers
 *  (game-state, idle-blink) take over when the user's face is at rest. */
const RELEASE_THRESHOLD = 0.05;

/** Threshold for the brow furrow promote path:
 *  `browDownLeft + browDownRight ≥ 0.4` → both brows go to `furrowed`. */
const BROW_FURROW_SUM_THRESHOLD = 0.4;

/** Threshold for the asymmetric smirk path:
 *  `abs(mouthSmileLeft − mouthSmileRight) ≥ 0.3` → `asymmetric-smirk`. */
const SMIRK_DIFF_THRESHOLD = 0.3;

/** Threshold for `mouthPress*` sum to fire `gritted-teeth`. */
const PRESS_SUM_THRESHOLD = 0.5;

/** Below this jawOpen value the open-mouth keyframe is `open-small`
 *  (not `open-wide`). */
const JAW_OPEN_SMALL_CUTOFF = 0.4;

/** Below this smile-sum value the smile keyframe is `smile-small`
 *  (not `smile-big`). */
const SMILE_SUM_SMALL_CUTOFF = 0.5;

/** Per-track candidate the mapping table generates each frame. */
interface Candidate {
  kf: KeyframeName;
  /** 0..1 — strength of the candidate after the table mapping. The
   *  candidate with the highest `t` wins (with hysteresis). */
  t: number;
}

/** Per-track previous winner — stored across ticks to enable
 *  hysteresis. `null` = no winner active (claim released). */
interface PreviousWinner {
  kf: KeyframeName;
  t: number;
}

/**
 * Create a live-puppet driver that translates `source` blendshape
 * coefficients into mixer track claims each frame.
 *
 * @param mixer  the H4 keyframe mixer to drive.
 * @param source the BlendshapeSource (typically a FacePuppet whose
 *               getSmoothedValue() reads the EMA-smoothed coefficient).
 * @param opts   tuning options.
 */
export function createFaceLiveDriver(
  mixer: FaceKeyframeMixer,
  source: BlendshapeSource,
  opts: LiveDriverOptions = {},
): FaceLiveDriver {
  const defaultHysteresis = opts.hysteresis ?? 0.1;
  const tunings = opts.tunings ?? {};
  let active = true;

  // Track-by-track previous winner. `null` means "claim released" — the
  // next non-null candidate restarts the hysteresis test from scratch.
  const previousWinner = new Map<FeatureTrack, PreviousWinner | null>();
  for (const t of ALL_TRACKS) previousWinner.set(t, null);

  function hysteresisFor(track: FeatureTrack): number {
    return tunings[track]?.hysteresis ?? defaultHysteresis;
  }

  /** Pick winner among `candidates` with hysteresis vs the previous
   *  winner stored on the track. Returns null when no candidate
   *  exceeds RELEASE_THRESHOLD. */
  function pickWinner(track: FeatureTrack, candidates: readonly Candidate[]): Candidate | null {
    // Filter out any candidate below the release threshold up front —
    // they don't get to compete (and a previous-winner-with-tiny-t
    // shouldn't keep a track claimed when the user's face is neutral).
    const live = candidates.filter((c) => c.t >= RELEASE_THRESHOLD);
    if (live.length === 0) return null;

    // Sort descending by t. Strongest candidate first.
    live.sort((a, b) => b.t - a.t);
    const top = live[0];
    const prev = previousWinner.get(track);
    if (!prev) return top;

    // If the previous winner is still in the candidate set, hysteresis
    // applies: top must beat prev by `margin` to flip. Otherwise just
    // take the top candidate (prev's keyframe isn't a candidate this
    // frame, so we have nothing to be sticky toward).
    const margin = hysteresisFor(track);
    if (top.kf === prev.kf) return top;
    const prevCandidate = live.find((c) => c.kf === prev.kf);
    if (!prevCandidate) return top;
    if (top.t - prevCandidate.t < margin) return prevCandidate;
    return top;
  }

  /** Apply a winner (or release) to the mixer for one track. Updates
   *  the previousWinner store accordingly. */
  function applyWinner(track: FeatureTrack, winner: Candidate | null): void {
    if (!winner) {
      // Release the live-puppet claim if we previously held one. The
      // mixer falls back to whatever lower-priority driver is active
      // (or 'rest' if none).
      if (previousWinner.get(track)) {
        mixer.releaseDriver('live-puppet', track);
        previousWinner.set(track, null);
      }
      return;
    }
    // Live-puppet claims use durationMs:0 — the puppet's EMA already
    // smooths the input; an additional easing tween would compound
    // the lag. The mixer interprets durationMs:0 as "snap to t=1".
    // The candidate's `t` (0..1) lives separately in our hysteresis
    // bookkeeping; the mixer side simply tracks "the live driver
    // wants kf X right now".
    mixer.setTrack(track, winner.kf, { priority: 'live-puppet', durationMs: 0 });
    previousWinner.set(track, { kf: winner.kf, t: winner.t });
  }

  // -------------------------------------------------------------------
  // Per-track mapping helpers
  // -------------------------------------------------------------------

  /** Eye track (left or right). `side` = 'L' | 'R'. */
  function buildEyeCandidates(side: 'L' | 'R'): Candidate[] {
    const blink = source.getSmoothedValue(side === 'L' ? 'eyeBlinkLeft' : 'eyeBlinkRight');
    const squint = source.getSmoothedValue(side === 'L' ? 'eyeSquintLeft' : 'eyeSquintRight');
    const wide = source.getSmoothedValue(side === 'L' ? 'eyeWideLeft' : 'eyeWideRight');
    // Look direction (look-up / look-down / look-in / look-out) is
    // deferred until the corresponding keyframe textures land — the
    // current Mii face has only rest / blink-full / squint / wide.
    // TODO(K4): add look-up/down/in/out candidates from
    //   eyeLookUpLeft − eyeLookDownLeft, eyeLookInLeft − eyeLookOutLeft.
    return [
      { kf: 'blink-full', t: clamp01(blink) },
      { kf: 'squint', t: clamp01(squint) },
      { kf: 'wide', t: clamp01(wide) },
    ];
  }

  /** Brow track (left or right). Special-case: when both browDown* are
   *  high enough we promote BOTH brows to 'furrowed' (composite-style)
   *  per Section 4 of the design plan — the per-side `down` candidate
   *  is suppressed in that case so the promotion is unambiguous. */
  function buildBrowCandidates(side: 'L' | 'R', browDownSum: number): Candidate[] {
    const innerUp = source.getSmoothedValue('browInnerUp');
    const down = source.getSmoothedValue(side === 'L' ? 'browDownLeft' : 'browDownRight');
    const outerUp = source.getSmoothedValue(side === 'L' ? 'browOuterUpLeft' : 'browOuterUpRight');
    const promoteFurrowed = browDownSum >= BROW_FURROW_SUM_THRESHOLD;
    const candidates: Candidate[] = [
      { kf: 'up', t: clamp01(innerUp) },
      { kf: 'raised-outer', t: clamp01(outerUp) },
    ];
    // When the sum threshold is met, BOTH brow tracks promote to
    // 'furrowed' and the per-side 'down' candidate drops out — an
    // intentional composite-style override so a hard furrow reads
    // as one expression instead of two independent brow-down poses.
    if (promoteFurrowed) {
      candidates.push({ kf: 'furrowed', t: clamp01(browDownSum * 0.5) });
    } else {
      candidates.push({ kf: 'down', t: clamp01(down) });
    }
    return candidates;
  }

  /** Mouth track (winner-take-all from a wide pool). */
  function buildMouthCandidates(): Candidate[] {
    const smileL = source.getSmoothedValue('mouthSmileLeft');
    const smileR = source.getSmoothedValue('mouthSmileRight');
    const frownL = source.getSmoothedValue('mouthFrownLeft');
    const frownR = source.getSmoothedValue('mouthFrownRight');
    const jawOpen = source.getSmoothedValue('jawOpen');
    const pucker = source.getSmoothedValue('mouthPucker');
    const pressL = source.getSmoothedValue('mouthPressLeft');
    const pressR = source.getSmoothedValue('mouthPressRight');

    const smileSum = smileL + smileR;
    const frownSum = frownL + frownR;
    const pressSum = pressL + pressR;
    const smileDiff = Math.abs(smileL - smileR);

    const candidates: Candidate[] = [];

    // Smile (big or small based on sum)
    if (smileSum > 0) {
      const smileT = clamp01(smileSum * 0.5);
      const kf: KeyframeName = smileSum < SMILE_SUM_SMALL_CUTOFF ? 'smile-small' : 'smile-big';
      candidates.push({ kf, t: smileT });
    }
    // Frown
    if (frownSum > 0) {
      candidates.push({ kf: 'frown', t: clamp01(frownSum * 0.5) });
    }
    // Jaw open (wide or small)
    if (jawOpen > 0) {
      const kf: KeyframeName = jawOpen < JAW_OPEN_SMALL_CUTOFF ? 'open-small' : 'open-wide';
      candidates.push({ kf, t: clamp01(jawOpen) });
    }
    // Pucker
    if (pucker > 0) {
      candidates.push({ kf: 'pucker', t: clamp01(pucker) });
    }
    // Gritted teeth — only fires once the press sum crosses threshold.
    if (pressSum >= PRESS_SUM_THRESHOLD) {
      candidates.push({ kf: 'gritted-teeth', t: clamp01(pressSum * 0.5) });
    }
    // Asymmetric smirk — fires only when the L/R smile diff is large
    // enough that the smile is visibly lopsided.
    if (smileDiff >= SMIRK_DIFF_THRESHOLD) {
      candidates.push({ kf: 'asymmetric-smirk', t: clamp01(smileDiff) });
    }
    return candidates;
  }

  /** Cheek track. */
  function buildCheekCandidates(): Candidate[] {
    const puff = source.getSmoothedValue('cheekPuff');
    const sqL = source.getSmoothedValue('cheekSquintLeft');
    const sqR = source.getSmoothedValue('cheekSquintRight');
    return [
      { kf: 'puffed', t: clamp01(puff) },
      { kf: 'squinted-L', t: clamp01(sqL) },
      { kf: 'squinted-R', t: clamp01(sqR) },
    ];
  }

  return {
    tick(): void {
      if (!active) return;

      // Pre-compute browDown sum so both brow tracks see the same value
      // for the furrow-promote check. (Otherwise floating-point ordering
      // could disagree between L and R at the threshold boundary.)
      const browDownSum =
        clamp01(source.getSmoothedValue('browDownLeft')) +
        clamp01(source.getSmoothedValue('browDownRight'));

      const eyeL = pickWinner('eye-L', buildEyeCandidates('L'));
      applyWinner('eye-L', eyeL);
      const eyeR = pickWinner('eye-R', buildEyeCandidates('R'));
      applyWinner('eye-R', eyeR);

      const browL = pickWinner('brow-L', buildBrowCandidates('L', browDownSum));
      applyWinner('brow-L', browL);
      const browR = pickWinner('brow-R', buildBrowCandidates('R', browDownSum));
      applyWinner('brow-R', browR);

      const mouth = pickWinner('mouth', buildMouthCandidates());
      applyWinner('mouth', mouth);

      const cheek = pickWinner('cheek', buildCheekCandidates());
      applyWinner('cheek', cheek);
      // decal-overlay is NOT driven by live puppet — that's owned by
      // game-state (`vein-forehead` from the angry composite, etc.).
    },

    detach(): void {
      if (!active) return;
      active = false;
      mixer.releaseDriver('live-puppet');
      for (const t of ALL_TRACKS) previousWinner.set(t, null);
    },

    get isActive(): boolean {
      return active;
    },
  };
}

const ALL_TRACKS: readonly FeatureTrack[] = [
  'eye-L', 'eye-R',
  'brow-L', 'brow-R',
  'mouth', 'cheek',
] as const;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
