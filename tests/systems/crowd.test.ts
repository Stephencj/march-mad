import { describe, it, expect, vi } from 'vitest';
import { CrowdSystem } from '@/systems/crowd';
import { EventBus } from '@/core/events';
import { CROWD_LEVELS } from '@/core/types';

describe('CrowdSystem', () => {
  it('starts at CALM', () => {
    const bus = new EventBus();
    const crowd = new CrowdSystem(bus);
    expect(crowd.getLevel()).toBe('CALM');
    expect(crowd.intensityValue).toBe(0);
  });

  it('increases intensity on highlight events (dunk, block add intensity > 0)', () => {
    const bus = new EventBus();
    const crowd = new CrowdSystem(bus);

    crowd.onEvent({ type: 'dunk' });
    expect(crowd.intensityValue).toBeGreaterThan(0);

    const afterDunk = crowd.intensityValue;
    crowd.onEvent({ type: 'block' });
    expect(crowd.intensityValue).toBeGreaterThan(afterDunk);
  });

  it('escalates through all 5 levels to CHAOS with enough events (30 dunks)', () => {
    const bus = new EventBus();
    const crowd = new CrowdSystem(bus);

    for (let i = 0; i < 30; i++) {
      crowd.onEvent({ type: 'dunk' });
    }

    expect(crowd.getLevel()).toBe('CHAOS');
    expect(crowd.intensityValue).toBe(100);
  });

  it('decays over time with no events (peak intensity drops after 20 simulated seconds)', () => {
    const bus = new EventBus();
    const crowd = new CrowdSystem(bus);

    // Push intensity up
    for (let i = 0; i < 10; i++) {
      crowd.onEvent({ type: 'dunk' });
    }
    const peakIntensity = crowd.intensityValue;
    expect(peakIntensity).toBeGreaterThan(0);

    // Simulate 20 seconds of no events
    crowd.tick(20);

    expect(crowd.intensityValue).toBeLessThan(peakIntensity);
  });

  it('big score differential (12+) raises intensity baseline', () => {
    const bus = new EventBus();
    const crowd = new CrowdSystem(bus);

    crowd.updateScoreDiff(12);
    // After decay with a 12-point diff, the floor should be 50
    // Tick to let intensity settle toward baseline
    crowd.tick(100);

    expect(crowd.intensityValue).toBeGreaterThanOrEqual(50);
  });

  it('returns momentum modifier > 0 at high intensity', () => {
    const bus = new EventBus();
    const crowd = new CrowdSystem(bus);

    // Push to high intensity
    for (let i = 0; i < 30; i++) {
      crowd.onEvent({ type: 'dunk' });
    }

    expect(crowd.getMomentumModifier()).toBeGreaterThan(0);
  });
});
