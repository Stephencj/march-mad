/**
 * Phase H6 — Game-state → keyframe-mixer driver.
 *
 * Sits between `GamePlayer.animState` transitions and the H4
 * `FaceKeyframeMixer`. Each `onAnimStateChange(state)` looks up the
 * matching `FaceAnimSequence` in `FACE_ANIM_BY_STATE` and schedules
 * its steps to fire over time at priority `'game-state'`.
 *
 * --- Priority interaction ---
 *
 * The mixer's stack is:
 *   idle-blink (0) < game-state (1) < scripted (2) < live-puppet (3)
 *
 * So when a live puppet is attached (H5), its claims at priority
 * `'live-puppet'` automatically win over anything this driver sets
 * at `'game-state'`. The driver still runs its scheduling state
 * machine — the mixer just ignores its claims while a higher driver
 * is active. As soon as the live puppet detaches, whatever
 * `'game-state'` claim is still on the stack becomes visible.
 *
 * --- Sequence playback ---
 *
 * `tick(dtMs)` advances `elapsedSec`. Every step whose `t <=
 * elapsedSec` and hasn't yet fired is dispatched as
 * `mixer.setComposite(step.composite, {priority:'game-state', durationMs})`.
 *
 * After the LAST step fires:
 *   - If `seq.hold` is set, retarget that composite (no further work
 *     until the next `onAnimStateChange`).
 *   - Else, after a 1s tail (so the eased crossfade settles), release
 *     all `'game-state'` claims so lower drivers (idle-blink) take
 *     over.
 *   - If `seq.loop` is true, restart after `loopIntervalSec` (default
 *     2s) — used for future idle-fidget face animations.
 *
 * --- detach() ---
 *
 * Releases all `'game-state'` claims and clears in-flight scheduling
 * state. Called when the parent `GamePlayer` tears down a Mii face.
 */
import type { FaceKeyframeMixer } from './face-keyframe-anim';
import { FACE_ANIM_BY_STATE, type FaceAnimSequence } from './face-anim-config';

export interface FaceGameStateDriver {
  /** Called when the player's animation state changes. Schedules the
   *  matching FaceAnimSequence to play through the mixer. */
  onAnimStateChange(state: string): void;
  /** Per-frame tick. Advances the active sequence and fires composites. */
  tick(dtMs: number): void;
  /** Stops the active sequence, releases mixer claims at priority 'game-state'. */
  detach(): void;
  /** True after detach() — exposed for tests and defensive callers. */
  readonly isAttached: boolean;
}

/** Tail (after last step) before releasing 'game-state' claims when
 *  no `hold` is configured. Lets the eased mixer crossfade settle so
 *  the eyes/brows don't snap mid-tween when releasing. */
const RELEASE_TAIL_SEC = 1.0;

/** Default loop interval when `seq.loop:true` and `loopIntervalSec` not set. */
const DEFAULT_LOOP_INTERVAL_SEC = 2.0;

interface ActiveSequence {
  state: string;
  seq: FaceAnimSequence;
  /** Index of the next step to fire (0..seq.steps.length). When equal
   *  to seq.steps.length all steps have fired and we're either
   *  holding, awaiting tail-release, or awaiting loop restart. */
  nextStepIdx: number;
  /** Wall-time elapsed since this sequence started (seconds). */
  elapsedSec: number;
  /** Time the LAST step fired (seconds since sequence start). Used to
   *  compute tail-release / loop-restart timing without re-scanning
   *  the steps array. -Infinity until the last step fires. */
  lastStepFiredAtSec: number;
  /** Phase the sequence is in once all steps have fired:
   *    'running'    = still firing steps
   *    'holding'    = hold composite retargeted; no further work
   *    'tailing'    = no hold; waiting RELEASE_TAIL_SEC before release
   *    'released'   = claims released; idle (only applies to non-loop)
   *    'loop-wait'  = waiting loopIntervalSec before restarting
   */
  phase: 'running' | 'holding' | 'tailing' | 'released' | 'loop-wait';
}

export function createFaceGameStateDriver(mixer: FaceKeyframeMixer): FaceGameStateDriver {
  let active: ActiveSequence | null = null;
  let attached = true;
  // Set of state strings we've already warned about — keeps the
  // unknown-state warning to one console.warn per state.
  const warnedUnknownStates = new Set<string>();

  /** Reset internal scheduling for a new sequence. Releases prior
   *  'game-state' claims so the new sequence starts from a clean slate
   *  (otherwise a sequence with FEWER tracks than the prior would
   *  leave stale claims on tracks the new one doesn't touch). */
  function startSequence(state: string, seq: FaceAnimSequence): void {
    if (!attached) return;
    mixer.releaseDriver('game-state');
    active = {
      state,
      seq,
      nextStepIdx: 0,
      elapsedSec: 0,
      lastStepFiredAtSec: -Infinity,
      phase: 'running',
    };
    // Fire any t=0 steps immediately (synchronously) so the very
    // first frame after `onAnimStateChange` is already showing the
    // new expression — without waiting for the next tick(). Apes
    // the same "fire on time-cross" logic the tick path uses.
    fireDueSteps();
  }

  /** Fire any pending steps whose `t` has been reached. Updates phase
   *  when the last step fires. Idempotent — safe to call repeatedly. */
  function fireDueSteps(): void {
    if (!active) return;
    const { seq } = active;
    while (active.nextStepIdx < seq.steps.length) {
      const step = seq.steps[active.nextStepIdx];
      if (step.t > active.elapsedSec) break;
      mixer.setComposite(step.composite, {
        priority: 'game-state',
        durationMs: step.durationMs,
      });
      active.lastStepFiredAtSec = step.t;
      active.nextStepIdx++;
    }
    // Transition out of 'running' once all steps have fired.
    if (active.phase === 'running' && active.nextStepIdx >= seq.steps.length) {
      if (seq.hold) {
        mixer.setComposite(seq.hold, { priority: 'game-state' });
        active.phase = 'holding';
      } else {
        active.phase = seq.loop ? 'loop-wait' : 'tailing';
      }
    }
  }

  return {
    onAnimStateChange(state: string): void {
      if (!attached) return;
      const seq = FACE_ANIM_BY_STATE[state];
      if (!seq) {
        if (!warnedUnknownStates.has(state)) {
          warnedUnknownStates.add(state);
          // eslint-disable-next-line no-console
          console.warn(`[face-game-state-driver] no FaceAnimSequence for state '${state}'`);
        }
        return;
      }
      // Same-state no-op fast-path: don't restart a sequence that's
      // already running for the same state. This lets the player
      // call `onAnimStateChange(this.animState)` every frame without
      // thrashing — though the player already only calls on change.
      if (active && active.state === state) return;
      startSequence(state, seq);
    },

    tick(dtMs: number): void {
      if (!attached || !active) return;
      const dtSec = dtMs / 1000;
      active.elapsedSec += dtSec;
      // Always try to fire pending steps first — even in 'running'.
      // The phase transition out of 'running' happens inside
      // fireDueSteps once nextStepIdx hits the end of steps.
      if (active.phase === 'running') {
        fireDueSteps();
        return;
      }
      // Post-running phases:
      if (active.phase === 'holding') {
        // No further work until next state change.
        return;
      }
      if (active.phase === 'tailing') {
        const tailEnd = active.lastStepFiredAtSec + RELEASE_TAIL_SEC;
        if (active.elapsedSec >= tailEnd) {
          mixer.releaseDriver('game-state');
          active.phase = 'released';
        }
        return;
      }
      if (active.phase === 'loop-wait') {
        const restartAt =
          active.lastStepFiredAtSec +
          (active.seq.loopIntervalSec ?? DEFAULT_LOOP_INTERVAL_SEC);
        if (active.elapsedSec >= restartAt) {
          // Restart from step 0 without re-releasing — the existing
          // claims will be overwritten by the first step's setComposite.
          active.nextStepIdx = 0;
          active.elapsedSec = 0;
          active.lastStepFiredAtSec = -Infinity;
          active.phase = 'running';
          fireDueSteps();
        }
        return;
      }
      // 'released' — nothing to do until next state change.
    },

    detach(): void {
      if (!attached) return;
      attached = false;
      active = null;
      mixer.releaseDriver('game-state');
    },

    get isAttached(): boolean {
      return attached;
    },
  };
}
