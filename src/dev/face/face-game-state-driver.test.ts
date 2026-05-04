/**
 * Phase H6 — FaceGameStateDriver unit tests.
 *
 * Exercises the game-state → mixer translation:
 *   - onAnimStateChange schedules the matching FaceAnimSequence
 *   - tick(dtMs) fires each step on time-cross at priority 'game-state'
 *   - hold composite settles after last step
 *   - tail-release after last step when no hold
 *   - unknown state warns once + no-ops
 *   - detach releases all 'game-state' claims
 *   - live-puppet (priority 3) wins over game-state (priority 1) at the
 *     mixer level — verified using the real H4 mixer.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFaceGameStateDriver } from './face-game-state-driver';
import { createFaceKeyframeMixer } from './face-keyframe-anim';
import type {
  FaceKeyframeMixer,
  FeatureTrack,
  KeyframeName,
  DriverPriority,
  TrackState,
} from './face-keyframe-anim';

interface SetCompositeCall {
  name: KeyframeName;
  priority: DriverPriority;
  durationMs?: number;
}

interface SetTrackCall {
  track: FeatureTrack;
  kf: KeyframeName;
  priority: DriverPriority;
  durationMs?: number;
}

/** Stub mixer that records every setComposite + releaseDriver call. */
function createStubMixer(): {
  mixer: FaceKeyframeMixer;
  setCompositeCalls: SetCompositeCall[];
  setTrackCalls: SetTrackCall[];
  releasedCalls: { priority: DriverPriority; track?: FeatureTrack }[];
  reset(): void;
} {
  const setCompositeCalls: SetCompositeCall[] = [];
  const setTrackCalls: SetTrackCall[] = [];
  const releasedCalls: { priority: DriverPriority; track?: FeatureTrack }[] = [];
  const mixer: FaceKeyframeMixer = {
    setTrack(track, kf, opts): void {
      setTrackCalls.push({ track, kf, priority: opts.priority, durationMs: opts.durationMs });
    },
    setComposite(name, opts): void {
      setCompositeCalls.push({ name, priority: opts.priority, durationMs: opts.durationMs });
    },
    releaseDriver(priority, track): void {
      releasedCalls.push({ priority, track });
    },
    tick(): ReadonlyMap<FeatureTrack, TrackState> { return new Map(); },
    pauseIdleBlink(): void {},
    resumeIdleBlink(): void {},
    dispose(): void {},
    getSmoothedValue(): number { return 0; },
  };
  return {
    mixer,
    setCompositeCalls,
    setTrackCalls,
    releasedCalls,
    reset(): void {
      setCompositeCalls.length = 0;
      setTrackCalls.length = 0;
      releasedCalls.length = 0;
    },
  };
}

describe('FaceGameStateDriver', () => {
  let stub: ReturnType<typeof createStubMixer>;

  beforeEach(() => {
    stub = createStubMixer();
  });

  it("onAnimStateChange('idle') sets composite 'rest' at priority 'game-state'", () => {
    const driver = createFaceGameStateDriver(stub.mixer);
    driver.onAnimStateChange('idle');
    // The startSequence path releases 'game-state' first, then fires t=0.
    expect(stub.releasedCalls).toContainEqual({ priority: 'game-state', track: undefined });
    expect(stub.setCompositeCalls).toContainEqual({
      name: 'rest',
      priority: 'game-state',
      durationMs: undefined,
    });
  });

  it("onAnimStateChange('dunk') fires concentrating @ t=0, then angry @ t=0.45 after tick(450), then joy @ t=0.85 after tick(400)", () => {
    const driver = createFaceGameStateDriver(stub.mixer);
    driver.onAnimStateChange('dunk');
    // t=0 step fires synchronously.
    const compositesAtT0 = stub.setCompositeCalls
      .filter((c) => c.priority === 'game-state')
      .map((c) => c.name);
    expect(compositesAtT0).toEqual(['concentrating']);

    // Advance past t=0.45 (the angry step).
    stub.reset();
    driver.tick(450);
    const compositesAt450 = stub.setCompositeCalls
      .filter((c) => c.priority === 'game-state')
      .map((c) => c.name);
    expect(compositesAt450).toEqual(['angry']);

    // Advance another 400ms → 850ms total → fires the t=0.85 joy step.
    // The fall-through in fireDueSteps then transitions to 'holding'
    // (dunk has hold:'rest'), retargeting 'rest' as the resting comp.
    stub.reset();
    driver.tick(400);
    const compositesAt850 = stub.setCompositeCalls
      .filter((c) => c.priority === 'game-state')
      .map((c) => c.name);
    // Expect 'joy' first (the t=0.85 step), THEN 'rest' (from the
    // hold transition that fires synchronously after the last step).
    expect(compositesAt850).toEqual(['joy', 'rest']);
  });

  it('unknown state logs warning + no-ops', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const driver = createFaceGameStateDriver(stub.mixer);
    driver.onAnimStateChange('not-a-real-state');
    expect(warnSpy).toHaveBeenCalled();
    // No setComposite / no release — totally inert.
    expect(stub.setCompositeCalls).toHaveLength(0);
    expect(stub.releasedCalls).toHaveLength(0);
    // Calling again with the SAME unknown state should NOT re-warn.
    warnSpy.mockClear();
    driver.onAnimStateChange('not-a-real-state');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('detach() releases all game-state claims', () => {
    const driver = createFaceGameStateDriver(stub.mixer);
    driver.onAnimStateChange('guard');
    expect(driver.isAttached).toBe(true);
    stub.reset();
    driver.detach();
    expect(driver.isAttached).toBe(false);
    expect(stub.releasedCalls).toContainEqual({ priority: 'game-state', track: undefined });
    // After detach, further calls are inert.
    stub.reset();
    driver.onAnimStateChange('dunk');
    driver.tick(1000);
    expect(stub.setCompositeCalls).toHaveLength(0);
  });

  it('after sequence with no hold, releases game-state claims after RELEASE_TAIL_SEC', () => {
    // 'walk' has a single t=0 step and no hold — it should tail-release.
    const driver = createFaceGameStateDriver(stub.mixer);
    driver.onAnimStateChange('walk');
    stub.reset();
    // Tail = 1.0s after the last step (which fired at t=0). 999ms not yet.
    driver.tick(999);
    expect(stub.releasedCalls).toHaveLength(0);
    // Crossing the 1s boundary releases.
    driver.tick(2);
    expect(stub.releasedCalls).toContainEqual({
      priority: 'game-state',
      track: undefined,
    });
  });

  it("'fall' sequence fires pain @ t=0, confused @ t=0.6, then 'rest' from hold", () => {
    const driver = createFaceGameStateDriver(stub.mixer);
    driver.onAnimStateChange('fall');
    expect(stub.setCompositeCalls.map((c) => c.name)).toEqual(['pain']);
    stub.reset();
    driver.tick(600);
    // Both 'confused' (t=0.6 step) and 'rest' (hold transition) fire.
    expect(stub.setCompositeCalls.map((c) => c.name)).toEqual(['confused', 'rest']);
  });

  it('same state called twice does not restart sequence', () => {
    const driver = createFaceGameStateDriver(stub.mixer);
    driver.onAnimStateChange('guard');
    stub.reset();
    driver.onAnimStateChange('guard');
    expect(stub.setCompositeCalls).toHaveLength(0);
    expect(stub.releasedCalls).toHaveLength(0);
  });

  it("changing to a new state restarts: releases 'game-state' then fires the new t=0 step", () => {
    const driver = createFaceGameStateDriver(stub.mixer);
    driver.onAnimStateChange('idle');
    stub.reset();
    driver.onAnimStateChange('guard');
    expect(stub.releasedCalls).toContainEqual({ priority: 'game-state', track: undefined });
    expect(stub.setCompositeCalls.map((c) => c.name)).toEqual(['angry']);
  });

  describe('priority interaction with live-puppet (real mixer)', () => {
    it('live-puppet claim wins over game-state on the same track', () => {
      // Use the REAL H4 mixer to verify the priority stack actually
      // resolves live-puppet > game-state.
      const mixer = createFaceKeyframeMixer();
      const driver = createFaceGameStateDriver(mixer);
      // Game-state: angry → mouth='gritted-teeth'.
      driver.onAnimStateChange('guard');
      // Live-puppet sets mouth='smile-big' — priority 3 wins over 1.
      mixer.setTrack('mouth', 'smile-big', {
        priority: 'live-puppet',
        durationMs: 0,
      });
      // Tick to settle the transition.
      mixer.tick(50);
      const states = mixer.tick(500);
      const mouth = states.get('mouth')!;
      // The visible target should be smile-big (live-puppet wins).
      expect(mouth.to).toBe('smile-big');
    });

    it('after live-puppet release, game-state claim becomes visible', () => {
      const mixer = createFaceKeyframeMixer();
      const driver = createFaceGameStateDriver(mixer);
      driver.onAnimStateChange('guard'); // angry → mouth='gritted-teeth'
      mixer.setTrack('mouth', 'smile-big', { priority: 'live-puppet', durationMs: 0 });
      mixer.tick(50);
      // Now release live-puppet — game-state's gritted-teeth claim
      // should pop back as the visible target.
      mixer.releaseDriver('live-puppet', 'mouth');
      const states = mixer.tick(50);
      const mouth = states.get('mouth')!;
      expect(mouth.to).toBe('gritted-teeth');
    });
  });
});
