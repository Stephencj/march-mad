/**
 * Phase H7 — Live keyframe-clip recorder.
 *
 * Sits on top of a `FaceKeyframeMixer` and observes its `tick()`-resolved
 * track state each frame. When a track's `to` keyframe changes — meaning
 * a higher-priority driver just claimed it, or a release just popped
 * back to a lower driver, or a fresh `setTrack` came in — the recorder
 * captures a `{t, kf, durationMs, easing}` event into that track's
 * event list.
 *
 * The result is a sparse stream: most tracks emit a few events per
 * recording (maybe a dozen for the mouth across an animated session,
 * single digits for cheek). A 60-second recording typically lands
 * around 1.7 KB of JSON — vs ~270 KB for the same recording captured
 * as raw v1 frames.
 *
 * --- Transition detection algorithm ---
 *
 * Each `tick(dtMs)`:
 *   1. accumulate elapsed wall-time (for event `t` stamps).
 *   2. read the mixer's per-track resolved state (via `mixer.tick(0)` —
 *      passing 0 advances no time, just returns the current snapshot).
 *   3. compare each track's current `to` against the last seen `to`.
 *   4. on change, emit `{t: elapsedMs/1000, kf: state.to, durationMs, easing}`.
 *
 * The recorder is a pure observer — it does NOT call `mixer.tick(dtMs)`
 * itself. The host (face-mirror's animate loop, the converter loop) is
 * already advancing the mixer on its own cadence. Calling `tick(0)` on
 * the mixer just reads state without double-advancing time.
 *
 * --- Idle-blink pollution ---
 *
 * The mixer's idle-blink scheduler fires every 3-6s, claiming both eyes
 * for ~220ms. If recording captures an idle face for 30s, the resulting
 * v2 clip will contain a handful of stray eye blinks not present in the
 * user's intended performance. The face-mirror UI calls
 * `mixer.pauseIdleBlink()` while a recording is active so the captured
 * stream reflects only the source signal (live puppet, scripted).
 */
import type {
  FaceKeyframeMixer,
  FeatureTrack,
  KeyframeName,
} from './face-keyframe-anim';
import { ALL_TRACKS } from './face-keyframe-anim';
import type { FaceKeyframeClip, FaceKeyframeEvent } from './face-keyframe-clip';

export interface FaceKeyframeRecorder {
  /** Start a fresh recording. Resets internal state; the next `tick()`
   *  becomes t=0. Captures the mixer's CURRENT track state as the
   *  baseline so the first event we emit is a true transition, not a
   *  bogus "started already at rest" entry. */
  start(): void;
  /** Stop the recording and return the assembled v2 clip. Safe to call
   *  even if `start()` wasn't — returns an empty clip with the supplied
   *  metadata. */
  stop(opts: { name: string }): FaceKeyframeClip;
  /** Observe one frame of mixer state. Pass the same `dtMs` the host
   *  uses to advance the mixer — that keeps event timestamps aligned
   *  with the playback wall-clock. Calling `tick` before `start()` is
   *  a no-op. */
  tick(dtMs: number): void;
  /** True from `start()` until `stop()`. */
  readonly isRecording: boolean;
  /** Total recorded duration so far in seconds. Useful for the UI's
   *  "Recording 12.3s" indicator. */
  readonly elapsedSec: number;
}

export function createKeyframeRecorder(mixer: FaceKeyframeMixer): FaceKeyframeRecorder {
  const events = new Map<FeatureTrack, FaceKeyframeEvent[]>();
  for (const t of ALL_TRACKS) events.set(t, []);

  const lastTo = new Map<FeatureTrack, KeyframeName | null>();
  for (const t of ALL_TRACKS) lastTo.set(t, null);

  let elapsedMs = 0;
  let recording = false;

  return {
    start(): void {
      recording = true;
      elapsedMs = 0;
      for (const t of ALL_TRACKS) {
        events.set(t, []);
      }
      // Snapshot current mixer state as the "before" so we don't emit
      // a bogus event at t=0 for tracks that were already at rest.
      const states = mixer.tick(0);
      for (const t of ALL_TRACKS) {
        const s = states.get(t);
        lastTo.set(t, s ? s.to : null);
      }
    },

    tick(dtMs: number): void {
      if (!recording) return;
      elapsedMs += dtMs;
      const states = mixer.tick(0);
      for (const t of ALL_TRACKS) {
        const s = states.get(t);
        if (!s) continue;
        const prev = lastTo.get(t) ?? null;
        if (s.to !== prev) {
          events.get(t)!.push({
            t: elapsedMs / 1000,
            kf: s.to,
            durationMs: s.durationMs,
            easing: s.easing,
          });
          lastTo.set(t, s.to);
        }
      }
    },

    stop(opts): FaceKeyframeClip {
      recording = false;
      const totalDurationSec = elapsedMs / 1000;
      const tracks: Partial<Record<FeatureTrack, ReadonlyArray<FaceKeyframeEvent>>> = {};
      for (const t of ALL_TRACKS) {
        const list = events.get(t)!;
        if (list.length > 0) tracks[t] = list.slice();
      }
      return {
        __version: 2,
        name: opts.name,
        capturedAt: new Date().toISOString(),
        tracks,
        totalDurationSec,
      };
    },

    get isRecording(): boolean {
      return recording;
    },

    get elapsedSec(): number {
      return elapsedMs / 1000;
    },
  };
}
