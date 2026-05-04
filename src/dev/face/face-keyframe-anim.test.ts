/**
 * Phase H4 — Mii face keyframe mixer unit tests.
 *
 * These tests exercise the mixer's public contract:
 *  - Driver priority stack (lower-priority claim ignored when higher active)
 *  - setComposite() expands to per-track setTrack calls
 *  - releaseDriver() restores next-lower active claim (or rest)
 *  - Idle-blink scheduler fires at 3-6s jittered intervals
 *  - BlendshapeSource adapter translates track state into ARKit values
 *  - dispose() clears state
 *
 * No DOM / Three / MediaPipe dependencies — pure logic tests, fast.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createFaceKeyframeMixer,
  COMPOSITES,
  DEFAULT_DURATIONS,
  type FaceKeyframeMixer,
  type FeatureTrack,
} from './face-keyframe-anim';

describe('FaceKeyframeMixer', () => {
  let mixer: FaceKeyframeMixer;

  beforeEach(() => {
    // Deterministic Math.random for the idle-blink scheduler — tests
    // that need a known blink time stub Math.random themselves.
    vi.spyOn(Math, 'random').mockReturnValue(0); // -> next blink at 3000ms
    mixer = createFaceKeyframeMixer();
  });

  afterEach(() => {
    mixer.dispose();
    vi.restoreAllMocks();
  });

  describe('driver priority', () => {
    it('lower-priority setTrack is overridden by higher-priority claim', () => {
      // game-state claims mouth=smile-big.
      mixer.setTrack('mouth', 'smile-big', { priority: 'game-state', durationMs: 0 });
      mixer.tick(0);
      let states = mixer.tick(1000);
      expect(states.get('mouth')?.to).toBe('smile-big');

      // live-puppet (higher) claims mouth=open-wide. Should win.
      mixer.setTrack('mouth', 'open-wide', { priority: 'live-puppet', durationMs: 0 });
      states = mixer.tick(1000);
      expect(states.get('mouth')?.to).toBe('open-wide');

      // Lower-priority setTrack while higher active → no visible change.
      mixer.setTrack('mouth', 'frown', { priority: 'game-state', durationMs: 0 });
      states = mixer.tick(1000);
      expect(states.get('mouth')?.to).toBe('open-wide');
    });

    it('releaseDriver restores next-lower active claim', () => {
      mixer.setTrack('mouth', 'smile-big', { priority: 'game-state', durationMs: 0 });
      mixer.setTrack('mouth', 'open-wide', { priority: 'live-puppet', durationMs: 0 });
      mixer.tick(0);

      // Release live-puppet → mouth should restore game-state's smile-big.
      mixer.releaseDriver('live-puppet', 'mouth');
      const states = mixer.tick(1000);
      expect(states.get('mouth')?.to).toBe('smile-big');
    });

    it('release with no remaining drivers returns track to rest', () => {
      mixer.setTrack('mouth', 'smile-big', { priority: 'game-state', durationMs: 0 });
      mixer.tick(0);
      mixer.releaseDriver('game-state', 'mouth');
      const states = mixer.tick(1000);
      expect(states.get('mouth')?.to).toBe('rest');
    });

    it('release without explicit track releases all tracks for that driver', () => {
      mixer.setTrack('eye-L', 'wide', { priority: 'scripted', durationMs: 0 });
      mixer.setTrack('mouth', 'smile-big', { priority: 'scripted', durationMs: 0 });
      mixer.tick(0);
      mixer.releaseDriver('scripted');
      const states = mixer.tick(1000);
      expect(states.get('eye-L')?.to).toBe('rest');
      expect(states.get('mouth')?.to).toBe('rest');
    });
  });

  describe('setComposite', () => {
    it('expands COMPOSITES.angry to per-track keyframes', () => {
      mixer.setComposite('angry', { priority: 'scripted', durationMs: 0 });
      const states = mixer.tick(1000);

      expect(states.get('eye-L')?.to).toBe('squint');
      expect(states.get('eye-R')?.to).toBe('squint');
      expect(states.get('brow-L')?.to).toBe('furrowed');
      expect(states.get('brow-R')?.to).toBe('furrowed');
      expect(states.get('mouth')?.to).toBe('gritted-teeth');
      expect(states.get('decal-overlay')?.to).toBe('vein-forehead');
    });

    it('unknown composite is a no-op (does not throw)', () => {
      // Track starts at rest...
      mixer.tick(0);
      expect(() =>
        mixer.setComposite('this-composite-does-not-exist', { priority: 'scripted' })
      ).not.toThrow();
      const states = mixer.tick(0);
      expect(states.get('mouth')?.to).toBe('rest');
    });

    it('sets all expected tracks for joy, leaving non-listed tracks alone', () => {
      mixer.setComposite('joy', { priority: 'scripted', durationMs: 0 });
      const states = mixer.tick(1000);
      expect(states.get('cheek')?.to).toBe('squinted-L');
      expect(states.get('mouth')?.to).toBe('smile-big');
      // 'wink-left' composite has no cheek entry, so cheek shouldn't be claimed
      // by composites that don't list it. Verify by switching:
      mixer.releaseDriver('scripted');
      mixer.setComposite('wink-left', { priority: 'scripted', durationMs: 0 });
      const states2 = mixer.tick(1000);
      expect(states2.get('cheek')?.to).toBe('rest');
    });
  });

  describe('idle-blink scheduler', () => {
    it('fires a blink at 3-6s after construction', () => {
      // Math.random mocked to 0 → next blink at exactly 3000ms.
      // Tick a couple of times below the threshold — eyes should still be at rest.
      mixer.tick(100);
      mixer.tick(2800);
      const beforeStates = mixer.tick(0);
      expect(beforeStates.get('eye-L')?.to).toBe('rest');

      // Cross the 3000ms threshold → blink fires.
      const fireStates = mixer.tick(200); // total now = 3100ms
      expect(fireStates.get('eye-L')?.to).toBe('blink-full');
      expect(fireStates.get('eye-R')?.to).toBe('blink-full');

      // After 80ms close + 60ms hold + a tick, the claim is released and
      // eyes head back to rest.
      mixer.tick(80);   // close completes (t=1)
      mixer.tick(60);   // hold completes — claim released, next tick re-resolves
      mixer.tick(1);    // any tiny tick to advance through the release
      const afterStates = mixer.tick(80); // give the open transition a moment
      expect(afterStates.get('eye-L')?.to).toBe('rest');
    });

    it('next blink uses jitter range 3-6s', () => {
      // Math.random mocked to 0.5 → next blink at 3000 + 0.5*(6000-3000) = 4500ms.
      vi.restoreAllMocks();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      mixer.dispose();
      mixer = createFaceKeyframeMixer();

      // At 4499ms — blink should not have fired yet.
      mixer.tick(4499);
      let s = mixer.tick(0);
      expect(s.get('eye-L')?.to).toBe('rest');
      // At 4499 + 2 = 4501ms → blink fires.
      s = mixer.tick(2);
      expect(s.get('eye-L')?.to).toBe('blink-full');
    });

    it('pauseIdleBlink stops the scheduler from firing', () => {
      mixer.pauseIdleBlink();
      // Advance well past the 3-6s window.
      mixer.tick(10_000);
      const s = mixer.tick(0);
      expect(s.get('eye-L')?.to).toBe('rest');
    });
  });

  describe('BlendshapeSource adapter', () => {
    it('mouth open-wide → jawOpen reflects t', () => {
      mixer.setTrack('mouth', 'open-wide', {
        priority: 'live-puppet',
        durationMs: 100,
        easing: 'linear',
      });
      // At construction t=0 (just started). After 50ms (half the duration),
      // linear t = 0.5 → jawOpen = 0.5.
      mixer.tick(50);
      expect(mixer.getSmoothedValue('jawOpen')).toBeCloseTo(0.5, 2);

      // After full duration, t=1 → jawOpen = 1.
      mixer.tick(50);
      expect(mixer.getSmoothedValue('jawOpen')).toBeCloseTo(1, 2);
    });

    it('mouth open-small → jawOpen reflects t * 0.5', () => {
      mixer.setTrack('mouth', 'open-small', {
        priority: 'live-puppet',
        durationMs: 100,
        easing: 'linear',
      });
      mixer.tick(100);
      expect(mixer.getSmoothedValue('jawOpen')).toBeCloseTo(0.5, 2);
    });

    it('eye-L blink-full → eyeBlinkLeft reflects t', () => {
      mixer.setTrack('eye-L', 'blink-full', {
        priority: 'live-puppet',
        durationMs: 100,
        easing: 'linear',
      });
      mixer.tick(100);
      expect(mixer.getSmoothedValue('eyeBlinkLeft')).toBeCloseTo(1, 2);
      expect(mixer.getSmoothedValue('eyeBlinkRight')).toBeCloseTo(0, 2);
    });

    it('brow-L+R up → browInnerUp uses max of L/R', () => {
      mixer.setTrack('brow-L', 'up', {
        priority: 'live-puppet',
        durationMs: 100,
        easing: 'linear',
      });
      mixer.setTrack('brow-R', 'up', {
        priority: 'live-puppet',
        durationMs: 200,
        easing: 'linear',
      });
      mixer.tick(100);
      // L is fully there (1), R is half (0.5) → max = 1
      expect(mixer.getSmoothedValue('browInnerUp')).toBeCloseTo(1, 2);
    });

    it('unmapped names return 0', () => {
      expect(mixer.getSmoothedValue('mouthSmileLeft')).toBe(0);
      expect(mixer.getSmoothedValue('cheekPuff')).toBe(0);
      expect(mixer.getSmoothedValue('jawForward')).toBe(0);
    });
  });

  describe('default durations + decal asymmetry', () => {
    it('uses DEFAULT_DURATIONS when no durationMs given', () => {
      mixer.setTrack('brow-L', 'up', { priority: 'game-state' });
      mixer.tick(0);
      const s = mixer.tick(0).get('brow-L')!;
      expect(s.durationMs).toBe(DEFAULT_DURATIONS['brow-L']);
    });

    it('decal-overlay fade-OUT to none uses 400ms', () => {
      mixer.setTrack('decal-overlay', 'vein-forehead', {
        priority: 'scripted',
        durationMs: 0,
      });
      mixer.tick(10);
      mixer.releaseDriver('scripted');
      const s = mixer.tick(1).get('decal-overlay')!;
      // Fade-out to 'none' uses 400ms when no explicit duration on the
      // restoration path.
      expect(s.to).toBe('none');
      expect(s.durationMs).toBe(400);
    });
  });

  describe('mid-transition reseed', () => {
    it('setting a new keyframe mid-tween reseeds from current blend', () => {
      mixer.setTrack('mouth', 'open-wide', {
        priority: 'live-puppet',
        durationMs: 100,
        easing: 'linear',
      });
      mixer.tick(50); // halfway → t=0.5 toward open-wide
      // Now switch target to smile-big — `from` should reseed to encode
      // the current visually-rendered blend (rest-50%-open-wide), NOT
      // jump straight to smile-big.
      mixer.setTrack('mouth', 'smile-big', {
        priority: 'live-puppet',
        durationMs: 100,
        easing: 'linear',
      });
      const s = mixer.tick(0).get('mouth')!;
      expect(s.to).toBe('smile-big');
      expect(s.t).toBe(0); // newly started
      // jawOpen should still reflect ~half the prior open-wide pose at
      // the moment of the switch — confirms no snap to 0.
      const v = mixer.getSmoothedValue('jawOpen');
      expect(v).toBeGreaterThan(0.4);
      expect(v).toBeLessThan(0.6);
    });
  });

  describe('dispose', () => {
    it('clears state and stops responding to setTrack', () => {
      mixer.setTrack('mouth', 'open-wide', { priority: 'live-puppet', durationMs: 0 });
      mixer.dispose();
      // Calls after dispose are no-ops.
      mixer.setTrack('mouth', 'smile-big', { priority: 'live-puppet', durationMs: 0 });
      mixer.tick(100);
      // BlendshapeSource queries return 0 after dispose.
      expect(mixer.getSmoothedValue('jawOpen')).toBe(0);
    });

    it('idle-blink does not fire after dispose', () => {
      mixer.dispose();
      // Recreate a fresh mixer w/ Math.random=0 to test pre-dispose, but
      // here we just verify the dispose() path doesn't blow up on tick.
      mixer.tick(10_000);
      expect(mixer.getSmoothedValue('eyeBlinkLeft')).toBe(0);
    });
  });

  describe('static exports', () => {
    it('exposes all expected composites', () => {
      const expected = [
        'rest', 'angry', 'surprised', 'joy', 'pain', 'confused',
        'concentrating', 'wink-left', 'wink-right', 'squished',
      ];
      for (const name of expected) {
        expect(COMPOSITES[name]).toBeDefined();
      }
    });

    it('DEFAULT_DURATIONS covers every track', () => {
      const tracks: FeatureTrack[] = [
        'eye-L', 'eye-R', 'brow-L', 'brow-R',
        'mouth', 'cheek', 'decal-overlay',
      ];
      for (const t of tracks) {
        expect(DEFAULT_DURATIONS[t]).toBeGreaterThan(0);
      }
    });
  });
});
