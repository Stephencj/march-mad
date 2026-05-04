/**
 * Phase H7 — v2 keyframe-clip schema, recorder, and converter tests.
 *
 * Covers:
 *  - schema validator (round-trip JSON, reject junk)
 *  - recorder captures transitions correctly
 *  - v1→v2 converter produces expected event stream from a known v1 clip
 *  - v2 replay drives the mixer at 'scripted' priority
 *
 * IDB CRUD is covered separately (face-anim-store.test.ts isn't in this
 * repo today; the keyframe store mirrors the same shape and is exercised
 * through the integration path in face-mirror — adding a fake-IDB suite
 * here would just duplicate Vitest's plumbing without testing logic).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isFaceKeyframeClip,
  convertV1ToV2,
  createV2ClipReplay,
  type FaceKeyframeClip,
} from './face-keyframe-clip';
import { createKeyframeRecorder } from './face-keyframe-recorder';
import { createFaceKeyframeMixer } from './face-keyframe-anim';
import type { FaceAnimClip } from './face-anim-clip';

beforeEach(() => {
  // Pin idle-blink timer well past any test's recording window so the
  // scheduler doesn't inject random eye blinks into the captured stream.
  // Math.random() = 0 → next blink at +3000ms (the floor of the 3-6s
  // jitter range), and we're explicitly pausing it on the recorder
  // anyway, but this keeps fallthrough deterministic.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isFaceKeyframeClip', () => {
  it('accepts a well-formed v2 clip', () => {
    const clip: FaceKeyframeClip = {
      __version: 2,
      name: 'test-clip',
      capturedAt: new Date().toISOString(),
      tracks: {
        mouth: [{ t: 0.5, kf: 'smile-big', durationMs: 220, easing: 'easeOut' }],
      },
      totalDurationSec: 1.0,
    };
    expect(isFaceKeyframeClip(clip)).toBe(true);
  });

  it('rejects v1 clips', () => {
    expect(isFaceKeyframeClip({ __version: 1, name: 'x' })).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(isFaceKeyframeClip({ __version: 2, name: 'x' })).toBe(false);
    expect(isFaceKeyframeClip({ __version: 2, name: 'x', capturedAt: 'now' })).toBe(false);
  });

  it('rejects invalid event shapes', () => {
    expect(
      isFaceKeyframeClip({
        __version: 2,
        name: 'x',
        capturedAt: 'now',
        totalDurationSec: 1,
        tracks: { mouth: [{ t: 0, kf: 'smile' }, { t: 'bad', kf: 'smile' }] },
      }),
    ).toBe(false);
    expect(
      isFaceKeyframeClip({
        __version: 2,
        name: 'x',
        capturedAt: 'now',
        totalDurationSec: 1,
        tracks: { mouth: [{ t: 0, kf: 'smile', easing: 'bogus' }] },
      }),
    ).toBe(false);
  });

  it('round-trips through JSON.parse(JSON.stringify(...))', () => {
    const clip: FaceKeyframeClip = {
      __version: 2,
      name: 'round-trip',
      capturedAt: '2026-05-03T12:34:56.789Z',
      tracks: {
        'eye-L': [{ t: 0.1, kf: 'blink-full' }, { t: 0.2, kf: 'rest' }],
        'eye-R': [{ t: 0.1, kf: 'blink-full' }, { t: 0.2, kf: 'rest' }],
        mouth: [{ t: 0.5, kf: 'smile-big', durationMs: 350, easing: 'easeInOut' }],
      },
      totalDurationSec: 2.0,
    };
    const reparsed = JSON.parse(JSON.stringify(clip));
    expect(isFaceKeyframeClip(reparsed)).toBe(true);
    expect(reparsed).toEqual(clip);
  });
});

describe('createKeyframeRecorder', () => {
  it('captures transitions when tracks change', () => {
    const mixer = createFaceKeyframeMixer();
    mixer.pauseIdleBlink();
    const recorder = createKeyframeRecorder(mixer);
    recorder.start();

    // No changes → no events.
    mixer.tick(100);
    recorder.tick(100);

    // mouth -> smile-big at t≈0.1s
    mixer.setTrack('mouth', 'smile-big', { priority: 'scripted', durationMs: 0 });
    mixer.tick(100);
    recorder.tick(100);

    // mouth -> open-wide at t≈0.2s
    mixer.setTrack('mouth', 'open-wide', { priority: 'scripted', durationMs: 0 });
    mixer.tick(100);
    recorder.tick(100);

    // Release scripted → mouth returns to rest at t≈0.3s
    mixer.releaseDriver('scripted', 'mouth');
    mixer.tick(100);
    recorder.tick(100);

    const clip = recorder.stop({ name: 'test' });
    expect(clip.__version).toBe(2);
    expect(clip.name).toBe('test');
    const mouthEvents = clip.tracks.mouth ?? [];
    expect(mouthEvents.length).toBe(3);
    expect(mouthEvents[0].kf).toBe('smile-big');
    expect(mouthEvents[1].kf).toBe('open-wide');
    expect(mouthEvents[2].kf).toBe('rest');
    // Tracks that never moved off rest are absent from the output.
    expect(clip.tracks['cheek']).toBeUndefined();
    expect(clip.totalDurationSec).toBeGreaterThanOrEqual(0.4 - 1e-6);

    mixer.dispose();
  });

  it('does not emit events for tracks that stayed at rest', () => {
    const mixer = createFaceKeyframeMixer();
    mixer.pauseIdleBlink();
    const recorder = createKeyframeRecorder(mixer);
    recorder.start();
    for (let i = 0; i < 10; i++) {
      mixer.tick(50);
      recorder.tick(50);
    }
    const clip = recorder.stop({ name: 'idle' });
    expect(Object.keys(clip.tracks)).toHaveLength(0);
    mixer.dispose();
  });

  it('does not capture events before start()', () => {
    const mixer = createFaceKeyframeMixer();
    mixer.pauseIdleBlink();
    const recorder = createKeyframeRecorder(mixer);
    mixer.setTrack('mouth', 'smile-big', { priority: 'scripted', durationMs: 0 });
    mixer.tick(100);
    recorder.tick(100); // no-op — recording not started
    recorder.start();
    mixer.tick(100);
    recorder.tick(100);
    const clip = recorder.stop({ name: 'late-start' });
    // smile-big was the existing state at start() — no new transition
    // from rest, so no event.
    expect(clip.tracks.mouth).toBeUndefined();
    mixer.dispose();
  });
});

describe('convertV1ToV2', () => {
  it('replays a v1 clip through a fake puppet and emits events', async () => {
    // Build a v1 clip whose frames simulate the user smiling for the
    // first half then opening their mouth wide for the second half.
    const frames: Array<Record<string, number>> = [];
    for (let i = 0; i < 30; i++) {
      frames.push({ mouthSmileLeft: 0.7, mouthSmileRight: 0.7 });
    }
    for (let i = 0; i < 30; i++) {
      frames.push({ jawOpen: 0.8 });
    }
    const v1: FaceAnimClip = {
      __version: 1,
      name: 'smile-then-open',
      capturedAt: new Date().toISOString(),
      fps: 30,
      frames,
    };

    // Fake puppet: stores last-applied frame, returns coefficients on
    // getSmoothedValue. Mirrors the real FacePuppet's contract for the
    // narrow surface the live driver reads.
    const lastFrame: Record<string, number> = {};
    const puppet = {
      getSmoothedValue(name: string): number {
        return lastFrame[name] ?? 0;
      },
    };
    const applyFrame = (sparse: Record<string, number>) => {
      // Reset before applying — frames are sparse, so a key absent
      // from this frame should read as 0 (matches FacePuppet behavior
      // for frames that omit a previously-active blendshape).
      for (const k of Object.keys(lastFrame)) delete lastFrame[k];
      for (const k of Object.keys(sparse)) lastFrame[k] = sparse[k];
    };

    const mixer = createFaceKeyframeMixer();

    // Spin up a live driver wired to our fake puppet so the mixer's
    // mouth track flips between smile-big and open-wide as the v1
    // frames change. (Deferred import so we don't pull MediaPipe types
    // into the test boot path.)
    const { createFaceLiveDriver } = await import('./face-live-driver');
    const liveDriver = createFaceLiveDriver(mixer, puppet);
    const liveDriverTick = () => liveDriver.tick();

    const v2 = convertV1ToV2(v1, mixer, applyFrame, liveDriverTick, {
      name: 'smile-then-open-v2',
    });

    expect(v2.__version).toBe(2);
    expect(v2.name).toBe('smile-then-open-v2');
    expect(v2.totalDurationSec).toBeCloseTo(60 / 30, 5);

    // mouth track should have at least two events: a smile transition
    // somewhere in the first half, then an open-wide somewhere later.
    const mouth = v2.tracks.mouth ?? [];
    expect(mouth.length).toBeGreaterThanOrEqual(2);
    const kinds = mouth.map((e) => e.kf);
    expect(kinds).toContain('smile-big');
    expect(kinds).toContain('open-wide');

    mixer.dispose();
  });
});

describe('createV2ClipReplay', () => {
  it('drives the mixer at scripted priority for each event', () => {
    const mixer = createFaceKeyframeMixer();
    mixer.pauseIdleBlink();

    const clip: FaceKeyframeClip = {
      __version: 2,
      name: 'replay-test',
      capturedAt: 'now',
      tracks: {
        mouth: [
          { t: 0.1, kf: 'smile-big', durationMs: 0 },
          { t: 0.5, kf: 'open-wide', durationMs: 0 },
        ],
      },
      totalDurationSec: 1.0,
    };

    const replay = createV2ClipReplay(mixer, clip);
    // t=0 → no event yet
    replay.tick(0);
    mixer.tick(0);
    expect(mixer.tick(0).get('mouth')?.to).toBe('rest');

    // t=0.15 → first event fires
    replay.tick(150);
    mixer.tick(150);
    expect(mixer.tick(0).get('mouth')?.to).toBe('smile-big');

    // t=0.6 → second event fires
    replay.tick(450);
    mixer.tick(450);
    expect(mixer.tick(0).get('mouth')?.to).toBe('open-wide');

    // After totalDuration (1.0s elapsed from start) replay reports done
    replay.tick(500);
    mixer.tick(500);
    expect(replay.tick(0)).toBe(false);

    replay.stop();
    // After stop the scripted claim is released → mouth back to rest.
    const final = mixer.tick(1000);
    expect(final.get('mouth')?.to).toBe('rest');

    mixer.dispose();
  });
});
