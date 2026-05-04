/**
 * Phase H7 — Compact v2 keyframe-clip format.
 *
 * v1 (`FaceAnimClip`) stores per-frame ARKit blendshape coefficients —
 * dense in time, sparse per frame. A 60s recording is roughly 1800 frames
 * × ~6 active keys × ~25 bytes = ~270 KB JSON.
 *
 * v2 (`FaceKeyframeClip`) instead stores ONLY the keyframe transitions
 * each track underwent during the recording. Most expressions hold for
 * hundreds of milliseconds — recording a single `{t, kf}` event per
 * transition collapses thousands of mostly-redundant coefficient frames
 * into a handful of events. A 60s clip is roughly 1.7 KB — two orders
 * of magnitude smaller.
 *
 * The two formats are stored side-by-side (separate IDB object stores).
 * v1 stays untouched — no migration risk on existing recordings.
 *
 * --- v1 → v2 conversion ---
 *
 * Replay the v1 clip through the FacePuppet → FaceLiveDriver → mixer
 * pipeline, observing each `mixer.tick()` output and emitting an event
 * whenever a track's `to` keyframe changes. The result is the same
 * sequence of expressions a fresh recording would have captured.
 */
import type {
  FaceKeyframeMixer,
  FeatureTrack,
  KeyframeName,
  TrackState,
} from './face-keyframe-anim';
import { ALL_TRACKS } from './face-keyframe-anim';
import type { FaceAnimClip } from './face-anim-clip';

/** Single keyframe transition event. `t` is seconds from clip start. */
export interface FaceKeyframeEvent {
  /** Seconds from clip start. */
  t: number;
  /** Keyframe name the track transitions TO at time `t`. */
  kf: KeyframeName;
  /** Tween duration in ms; if absent, replay uses the mixer's default
   *  per-track duration (e.g. 80 for eyes, 220 for mouth). */
  durationMs?: number;
  /** Easing curve; if absent, replay uses 'easeOut' (the mixer default). */
  easing?: TrackState['easing'];
}

export interface FaceKeyframeClip {
  __version: 2;
  /** Author-supplied name. Doubles as the IDB key — uniqueness enforced
   *  by the editor (overwrite confirm). */
  name: string;
  /** ISO timestamp of when the recording was finished. */
  capturedAt: string;
  /** Per-track event lists — sparse. Most tracks have a few transitions
   *  during a recording; many have zero (e.g. cheek often stays at rest).
   *  Within a track the events are sorted by `t` ascending. */
  tracks: Partial<Record<FeatureTrack, ReadonlyArray<FaceKeyframeEvent>>>;
  /** Total duration of the clip in seconds — drives replay's "we're done"
   *  check even when no track has an event at the very end. */
  totalDurationSec: number;
}

/** Lightweight metadata returned by `listKeyframeClips()`. Mirrors
 *  `FaceAnimMeta` so the face-mirror UI can render either format
 *  with the same row layout. */
export interface FaceKeyframeMeta {
  name: string;
  capturedAt: string;
  /** Total events across all tracks — proxy for "complexity" the way
   *  frameCount is a proxy for v1 clips. */
  eventCount: number;
  durationSec: number;
}

/** Validator for JSON imports — keeps junk out of IDB. */
export function isFaceKeyframeClip(v: unknown): v is FaceKeyframeClip {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.__version !== 2) return false;
  if (typeof o.name !== 'string' || o.name.length === 0) return false;
  if (typeof o.capturedAt !== 'string') return false;
  if (
    typeof o.totalDurationSec !== 'number' ||
    !Number.isFinite(o.totalDurationSec) ||
    o.totalDurationSec < 0
  ) {
    return false;
  }
  if (typeof o.tracks !== 'object' || o.tracks === null) return false;
  const tracks = o.tracks as Record<string, unknown>;
  for (const trackName of Object.keys(tracks)) {
    const events = tracks[trackName];
    if (!Array.isArray(events)) return false;
    for (const ev of events) {
      if (typeof ev !== 'object' || ev === null) return false;
      const e = ev as Record<string, unknown>;
      if (typeof e.t !== 'number' || !Number.isFinite(e.t)) return false;
      if (typeof e.kf !== 'string') return false;
      if (
        e.durationMs !== undefined &&
        (typeof e.durationMs !== 'number' || !Number.isFinite(e.durationMs))
      ) {
        return false;
      }
      if (
        e.easing !== undefined &&
        e.easing !== 'linear' &&
        e.easing !== 'easeOut' &&
        e.easing !== 'easeInOut'
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Replay a v1 clip through a FacePuppet + FaceLiveDriver + mixer
 * pipeline, recording the resulting per-track keyframe transitions.
 *
 * The puppet/driver/mixer wiring is provided by the caller — this
 * keeps the converter independent of THREE.js (so unit tests can mock
 * the puppet with a simple `getSmoothedValue` reader). For the
 * face-mirror UI path, the caller spins up the same components used
 * for live mirror: a FacePuppet bound to a 3D face mesh + a
 * FaceLiveDriver wired to a fresh mixer.
 *
 * @param v1       The source v1 clip.
 * @param mixer    A keyframe mixer the converter observes via tick().
 * @param applyFrame  Callback that lets the caller feed one frame
 *                 through the puppet (`puppet.apply(frame)`) before
 *                 the converter calls `mixer.tick()` again.
 * @param liveDriverTick  Callback the caller supplies to drive their
 *                 FaceLiveDriver each frame (after applyFrame).
 * @returns        A v2 clip whose `tracks` contain the captured events.
 */
export function convertV1ToV2(
  v1: FaceAnimClip,
  mixer: FaceKeyframeMixer,
  applyFrame: (sparse: Record<string, number>) => void,
  liveDriverTick: () => void,
  opts: { name?: string } = {},
): FaceKeyframeClip {
  // Pause idle-blink so the random scheduler doesn't pollute the
  // captured event stream — we want the conversion to reflect the
  // recorded expressions, not a fresh mixer's blink interjections.
  mixer.pauseIdleBlink();

  const recorder = createKeyframeRecorderInternal(mixer);
  recorder.start();

  const dtMs = v1.fps > 0 ? 1000 / v1.fps : 1000 / 30;
  for (let i = 0; i < v1.frames.length; i++) {
    applyFrame(v1.frames[i]);
    liveDriverTick();
    mixer.tick(dtMs);
    recorder.tick(dtMs);
  }

  const totalDurationSec = v1.fps > 0 ? v1.frames.length / v1.fps : 0;
  const clip = recorder.finalize({
    name: opts.name ?? `${v1.name}-v2`,
    totalDurationSec,
  });

  mixer.resumeIdleBlink();
  return clip;
}

/**
 * Internal: a recorder that observes mixer state each frame and emits
 * an event whenever a track's `to` changes. Public-facing recorder
 * lives in `face-keyframe-recorder.ts` — this internal variant is what
 * `convertV1ToV2` uses so the two share the same change-detection
 * algorithm without a circular import.
 */
interface InternalRecorder {
  start(): void;
  tick(dtMs: number): void;
  finalize(opts: { name: string; totalDurationSec: number }): FaceKeyframeClip;
}

function createKeyframeRecorderInternal(mixer: FaceKeyframeMixer): InternalRecorder {
  const events = new Map<FeatureTrack, FaceKeyframeEvent[]>();
  for (const t of ALL_TRACKS) events.set(t, []);

  /** Last seen `to` per track. We emit on change. Initialized lazily on
   *  start() so we don't pre-populate with stale state. */
  const lastTo = new Map<FeatureTrack, KeyframeName | null>();

  let elapsedMs = 0;
  let started = false;

  return {
    start(): void {
      started = true;
      elapsedMs = 0;
      for (const t of ALL_TRACKS) {
        events.set(t, []);
        // Read the mixer's current state so the FIRST change we see
        // is correctly compared against "what was already showing"
        // rather than always emitting at t=0 for tracks already at rest.
        const states = mixer.tick(0);
        const s = states.get(t);
        lastTo.set(t, s ? s.to : null);
      }
    },

    tick(dtMs: number): void {
      if (!started) return;
      elapsedMs += dtMs;
      // Read current per-track resolved state. We DON'T tick the mixer
      // here — the caller (live recorder hook OR converter loop) is
      // responsible for advancing time. This keeps the recorder a pure
      // observer that doesn't double-advance the mixer's internal clock.
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

    finalize(opts): FaceKeyframeClip {
      // Drop tracks with zero events from the output to keep the JSON
      // tiny — the replay path treats absence as "track stayed at rest
      // the whole time", which is exactly what zero events means.
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
        totalDurationSec: opts.totalDurationSec,
      };
    },
  };
}

/**
 * Replay a v2 clip into a mixer at priority 'scripted'. Schedules each
 * event by accumulating wall-time via `tick(dtMs)`. Returns a runner
 * the caller drives one frame at a time (mirrors the v1 replay loop's
 * cadence so the existing animation harness can handle both formats).
 */
export interface FaceKeyframeReplay {
  /** Advance replay by dt ms; fires any events whose `t` is now past.
   *  Returns true while replay is still active, false once done. */
  tick(dtMs: number): boolean;
  /** Tear down — releases the 'scripted' driver claims so lower drivers
   *  (game-state, idle-blink) take back over. Idempotent. */
  stop(): void;
  readonly isPlaying: boolean;
}

export function createV2ClipReplay(
  mixer: FaceKeyframeMixer,
  clip: FaceKeyframeClip,
): FaceKeyframeReplay {
  // Build a flat list of pending events sorted by time. We mutate it
  // by shifting heads as we fire — simpler than per-track cursors
  // because we only ever care about "next event" globally.
  interface PendingEvent {
    track: FeatureTrack;
    event: FaceKeyframeEvent;
  }
  const pending: PendingEvent[] = [];
  for (const trackName of Object.keys(clip.tracks) as FeatureTrack[]) {
    const list = clip.tracks[trackName];
    if (!list) continue;
    for (const ev of list) pending.push({ track: trackName, event: ev });
  }
  pending.sort((a, b) => a.event.t - b.event.t);

  const totalSec = clip.totalDurationSec;
  let elapsedSec = 0;
  let cursor = 0;
  let stopped = false;

  // Snapshot which tracks the clip touches — we release just those at
  // stop() so we don't yank claims from unrelated drivers (idle-blink,
  // game-state) that happen to be claiming tracks the clip never touched.
  const touchedTracks = new Set<FeatureTrack>();
  for (const p of pending) touchedTracks.add(p.track);

  return {
    tick(dtMs: number): boolean {
      if (stopped) return false;
      elapsedSec += dtMs / 1000;
      while (cursor < pending.length && pending[cursor].event.t <= elapsedSec) {
        const { track, event } = pending[cursor];
        mixer.setTrack(track, event.kf, {
          priority: 'scripted',
          durationMs: event.durationMs,
          easing: event.easing,
        });
        cursor++;
      }
      // Done when we've fired every event AND we've reached the end of
      // the recording's wall-clock duration (so a final `kf:'rest'`
      // event at e.g. t=58s still has 2s to play out before stop).
      if (cursor >= pending.length && elapsedSec >= totalSec) {
        return false;
      }
      return true;
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const t of touchedTracks) {
        mixer.releaseDriver('scripted', t);
      }
    },
    get isPlaying(): boolean {
      return !stopped && (cursor < pending.length || elapsedSec < totalSec);
    },
  };
}
