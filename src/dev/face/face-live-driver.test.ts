/**
 * Phase H5 — FaceLiveDriver unit tests.
 *
 * Exercises the puppet→mixer translation:
 *  - Mapping table coverage (jawOpen, smile sums, frown, pucker, brow furrow,
 *    asymmetric smirk, cheek)
 *  - Hysteresis: must beat previous winner by >= margin to flip
 *  - detach() releases all live-puppet claims
 *
 * Uses a stub BlendshapeSource (canned values) and a recording stub mixer
 * (just captures every setTrack / releaseDriver call). No DOM / Three.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createFaceLiveDriver } from './face-live-driver';
import type {
  FaceKeyframeMixer,
  FeatureTrack,
  KeyframeName,
  DriverPriority,
  TrackState,
} from './face-keyframe-anim';
import type { BlendshapeSource } from './procedural-face';

interface SetTrackCall {
  track: FeatureTrack;
  kf: KeyframeName;
  priority: DriverPriority;
  durationMs?: number;
}

/** Stub mixer that records every setTrack + releaseDriver call so tests
 *  can assert exactly what claims the driver places. We only implement
 *  the bits the driver touches. */
function createStubMixer(): {
  mixer: FaceKeyframeMixer;
  setTrackCalls: SetTrackCall[];
  releasedTracks: { priority: DriverPriority; track?: FeatureTrack }[];
  /** Currently-claimed kf per track at priority 'live-puppet'. */
  liveTracks: Map<FeatureTrack, KeyframeName>;
  reset(): void;
} {
  const setTrackCalls: SetTrackCall[] = [];
  const releasedTracks: { priority: DriverPriority; track?: FeatureTrack }[] = [];
  const liveTracks = new Map<FeatureTrack, KeyframeName>();
  const mixer: FaceKeyframeMixer = {
    setTrack(track, kf, opts) {
      setTrackCalls.push({ track, kf, priority: opts.priority, durationMs: opts.durationMs });
      if (opts.priority === 'live-puppet') {
        liveTracks.set(track, kf);
      }
    },
    setComposite() { /* no-op for these tests */ },
    releaseDriver(priority, track) {
      releasedTracks.push({ priority, track });
      if (priority === 'live-puppet') {
        if (track) liveTracks.delete(track);
        else liveTracks.clear();
      }
    },
    tick(): ReadonlyMap<FeatureTrack, TrackState> { return new Map(); },
    pauseIdleBlink() {},
    resumeIdleBlink() {},
    dispose() {},
    getSmoothedValue() { return 0; },
  };
  return {
    mixer,
    setTrackCalls,
    releasedTracks,
    liveTracks,
    reset(): void {
      setTrackCalls.length = 0;
      releasedTracks.length = 0;
    },
  };
}

/** Stub BlendshapeSource backed by a plain Map. */
function createStubSource(values: Record<string, number> = {}): {
  source: BlendshapeSource;
  set(name: string, v: number): void;
  clear(): void;
} {
  const map = new Map<string, number>(Object.entries(values));
  return {
    source: {
      getSmoothedValue(name: string): number {
        return map.get(name) ?? 0;
      },
    },
    set(name, v): void {
      map.set(name, v);
    },
    clear(): void {
      map.clear();
    },
  };
}

describe('FaceLiveDriver', () => {
  let stub: ReturnType<typeof createStubMixer>;
  let src: ReturnType<typeof createStubSource>;

  beforeEach(() => {
    stub = createStubMixer();
    src = createStubSource();
  });

  describe('mapping table', () => {
    it('jawOpen=0.7 → mouth open-wide at priority live-puppet, durationMs:0', () => {
      src.set('jawOpen', 0.7);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      const mouthCalls = stub.setTrackCalls.filter((c) => c.track === 'mouth');
      expect(mouthCalls.length).toBe(1);
      expect(mouthCalls[0].kf).toBe('open-wide');
      expect(mouthCalls[0].priority).toBe('live-puppet');
      expect(mouthCalls[0].durationMs).toBe(0);
    });

    it('jawOpen=0.3 → mouth open-small (under 0.4 cutoff)', () => {
      src.set('jawOpen', 0.3);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      const mouthCalls = stub.setTrackCalls.filter((c) => c.track === 'mouth');
      expect(mouthCalls[0].kf).toBe('open-small');
    });

    it('smile sum 0.4 → mouth smile-small; sum 0.6 → smile-big', () => {
      src.set('mouthSmileLeft', 0.2);
      src.set('mouthSmileRight', 0.2); // sum=0.4 < 0.5
      let driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      expect(stub.setTrackCalls.find((c) => c.track === 'mouth')?.kf).toBe('smile-small');

      stub.reset();
      src.set('mouthSmileLeft', 0.3);
      src.set('mouthSmileRight', 0.3); // sum=0.6 >= 0.5
      driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      expect(stub.setTrackCalls.find((c) => c.track === 'mouth')?.kf).toBe('smile-big');
    });

    it('mouthFrownLeft+Right → mouth frown', () => {
      src.set('mouthFrownLeft', 0.4);
      src.set('mouthFrownRight', 0.4);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      expect(stub.setTrackCalls.find((c) => c.track === 'mouth')?.kf).toBe('frown');
    });

    it('mouthPucker → mouth pucker', () => {
      src.set('mouthPucker', 0.7);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      expect(stub.setTrackCalls.find((c) => c.track === 'mouth')?.kf).toBe('pucker');
    });

    it('mouthPress sum >= 0.5 → mouth gritted-teeth', () => {
      src.set('mouthPressLeft', 0.3);
      src.set('mouthPressRight', 0.3); // sum=0.6
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      expect(stub.setTrackCalls.find((c) => c.track === 'mouth')?.kf).toBe('gritted-teeth');
    });

    it('asymmetric smile (diff >= 0.3) → mouth asymmetric-smirk', () => {
      // mouthSmileLeft=0.5, mouthSmileRight=0.1 → diff=0.4 >= 0.3
      // smile sum=0.6 (smile-big @ t=0.3) vs asymmetric-smirk @ t=0.4.
      // smirk wins on t.
      src.set('mouthSmileLeft', 0.5);
      src.set('mouthSmileRight', 0.1);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      expect(stub.setTrackCalls.find((c) => c.track === 'mouth')?.kf).toBe('asymmetric-smirk');
    });

    it('both browDownLeft/Right=0.5 promotes both brow tracks to furrowed', () => {
      // sum=1.0, well above 0.4 promote threshold.
      // Per-side `down` candidate t=0.5; furrowed candidate t=sum*0.5=0.5.
      // Hysteresis tie at first claim → top sort picks first; furrowed
      // is added last so equal-t test depends on stable sort. Bump down
      // a hair so furrowed is the strict winner.
      src.set('browDownLeft', 0.5);
      src.set('browDownRight', 0.5);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      const browLCalls = stub.setTrackCalls.filter((c) => c.track === 'brow-L');
      const browRCalls = stub.setTrackCalls.filter((c) => c.track === 'brow-R');
      // Both brows should land on furrowed (tied with `down` → sort.)
      // Accept either 'furrowed' (preferred) or 'down' as long as both
      // sides agree — but the design table says furrowed should win at
      // sum=1.0 because the average is the same as down per-side and
      // furrowed is added last in the candidate list. Validate that at
      // least the call lands as 'furrowed' on both sides for this
      // explicit-promote test.
      expect(browLCalls[0].kf).toBe('furrowed');
      expect(browRCalls[0].kf).toBe('furrowed');
    });

    it('cheekPuff → cheek puffed', () => {
      src.set('cheekPuff', 0.6);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      expect(stub.setTrackCalls.find((c) => c.track === 'cheek')?.kf).toBe('puffed');
    });

    it('eyeBlinkLeft → eye-L blink-full', () => {
      src.set('eyeBlinkLeft', 0.8);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      const eye = stub.setTrackCalls.find((c) => c.track === 'eye-L');
      expect(eye?.kf).toBe('blink-full');
      // No eye-R claim because eyeBlinkRight is unset.
      expect(stub.setTrackCalls.find((c) => c.track === 'eye-R')).toBeUndefined();
    });

    it('values below RELEASE_THRESHOLD release the track claim', () => {
      // First frame: jawOpen=0.7 → mouth open-wide claim.
      src.set('jawOpen', 0.7);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      expect(stub.liveTracks.get('mouth')).toBe('open-wide');

      // Drop jawOpen to 0.02 (below RELEASE_THRESHOLD=0.05). Should
      // release the mouth claim entirely.
      stub.reset();
      src.set('jawOpen', 0.02);
      driver.tick();
      const mouthRelease = stub.releasedTracks.find(
        (r) => r.priority === 'live-puppet' && r.track === 'mouth',
      );
      expect(mouthRelease).toBeDefined();
    });
  });

  describe('hysteresis', () => {
    it('jawOpen=0.5 then mouthPucker=0.55 does NOT flip (margin 0.05 < 0.1)', () => {
      // First frame: jawOpen=0.5 wins → mouth=open-wide.
      src.set('jawOpen', 0.5);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      expect(stub.liveTracks.get('mouth')).toBe('open-wide');

      // Second frame: jawOpen drops to 0.5, mouthPucker=0.55. Diff=0.05 < 0.1.
      // Sticky-winner keeps open-wide.
      stub.reset();
      src.set('jawOpen', 0.5);
      src.set('mouthPucker', 0.55);
      driver.tick();
      // jawOpen=0.5 → still open-wide candidate at t=0.5.
      // pucker at t=0.55. Margin 0.05 < hysteresis 0.1 → stick with prev.
      expect(stub.liveTracks.get('mouth')).toBe('open-wide');
    });

    it('jawOpen=0.5 then mouthPucker=0.65 SHOULD flip (margin 0.15 >= 0.1)', () => {
      src.set('jawOpen', 0.5);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      expect(stub.liveTracks.get('mouth')).toBe('open-wide');

      stub.reset();
      src.set('jawOpen', 0.5);
      src.set('mouthPucker', 0.65);
      driver.tick();
      // pucker beats prev (open-wide @ 0.5) by 0.15 >= 0.1 → flip.
      expect(stub.liveTracks.get('mouth')).toBe('pucker');
    });

    it('previous winner kf no longer in candidate set: take the top', () => {
      // First frame: pucker wins.
      src.set('mouthPucker', 0.6);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      expect(stub.liveTracks.get('mouth')).toBe('pucker');

      // Next frame: pucker drops below threshold; jawOpen now drives.
      // pucker isn't in the candidate set this frame, so hysteresis
      // doesn't apply — top candidate (open-wide) wins immediately.
      stub.reset();
      src.set('mouthPucker', 0); // drops from candidate set entirely
      src.set('jawOpen', 0.45);
      driver.tick();
      expect(stub.liveTracks.get('mouth')).toBe('open-wide');
    });
  });

  describe('detach', () => {
    it('detach() releases all live-puppet claims', () => {
      src.set('jawOpen', 0.7);
      src.set('eyeBlinkLeft', 0.8);
      src.set('cheekPuff', 0.6);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      expect(driver.isActive).toBe(true);
      // Sanity: claims are present.
      expect(stub.liveTracks.get('mouth')).toBe('open-wide');
      expect(stub.liveTracks.get('eye-L')).toBe('blink-full');
      expect(stub.liveTracks.get('cheek')).toBe('puffed');

      stub.reset();
      driver.detach();
      expect(driver.isActive).toBe(false);
      // Should have called releaseDriver('live-puppet') (no track arg →
      // release across all tracks).
      const fullRelease = stub.releasedTracks.find(
        (r) => r.priority === 'live-puppet' && r.track === undefined,
      );
      expect(fullRelease).toBeDefined();
      // And the mixer's live-track view is empty.
      expect(stub.liveTracks.size).toBe(0);

      // tick() after detach() is a no-op.
      stub.reset();
      driver.tick();
      expect(stub.setTrackCalls.length).toBe(0);
    });
  });

  describe('non-Inf / NaN handling', () => {
    it('NaN coefficients are treated as 0 (no claims placed)', () => {
      src.set('jawOpen', Number.NaN);
      const driver = createFaceLiveDriver(stub.mixer, src.source);
      driver.tick();
      // jawOpen NaN → clamp01 returns 0 → no candidate above release
      // threshold → no setTrack call for mouth.
      expect(stub.setTrackCalls.find((c) => c.track === 'mouth')).toBeUndefined();
    });
  });
});
