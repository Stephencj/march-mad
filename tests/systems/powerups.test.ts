import { describe, it, expect, vi } from 'vitest';
import { PowerupSystem } from '@/systems/powerups';
import { PowerupType, POWERUP_TIERS } from '@/core/types';
import { EventBus } from '@/core/events';

describe('PowerupSystem', () => {
  it('selects tier 1 powerup for deficit 1-4', () => {
    const bus = new EventBus();
    const system = new PowerupSystem(bus);
    const tier1Types: PowerupType[] = ['speed-burst', 'hot-hand', 'sticky-fingers'];

    for (let deficit = 1; deficit <= 4; deficit++) {
      const result = system.selectPowerup(deficit);
      expect(result).not.toBeNull();
      expect(tier1Types).toContain(result);
    }
  });

  it('selects tier 2 powerup for deficit 5-9', () => {
    const bus = new EventBus();
    const system = new PowerupSystem(bus);
    const tier2Types: PowerupType[] = ['on-fire', 'phantom-step', 'brick-wall'];

    for (let deficit = 5; deficit <= 9; deficit++) {
      const result = system.selectPowerup(deficit);
      expect(result).not.toBeNull();
      expect(tier2Types).toContain(result);
    }
  });

  it('selects tier 3 powerup for deficit 10+', () => {
    const bus = new EventBus();
    const system = new PowerupSystem(bus);
    const tier3Types: PowerupType[] = ['giant-ball', 'trampoline', 'force-field'];

    for (const deficit of [10, 15, 20, 50]) {
      const result = system.selectPowerup(deficit);
      expect(result).not.toBeNull();
      expect(tier3Types).toContain(result);
    }
  });

  it('returns null when no deficit (0)', () => {
    const bus = new EventBus();
    const system = new PowerupSystem(bus);
    const result = system.selectPowerup(0);
    expect(result).toBeNull();
  });

  it('spawns powerup orb when meter reaches 100 and deficit > 0', () => {
    const bus = new EventBus();
    const system = new PowerupSystem(bus);

    // Charge meter to 100
    system.chargeMeter(100);

    // Update with a deficit
    system.update(3, 0);

    expect(system.activeOrb).not.toBeNull();
    expect(system.activeOrb!.type).toBeTruthy();
    expect(system.activeOrb!.position).toHaveProperty('x');
    expect(system.activeOrb!.position).toHaveProperty('z');
  });

  it('only allows one active powerup at a time', () => {
    const bus = new EventBus();
    const system = new PowerupSystem(bus);

    // Charge and spawn first orb
    system.chargeMeter(100);
    system.update(3, 0);
    expect(system.activeOrb).not.toBeNull();

    // Pick up the orb for home team
    system.pickupOrb('home');
    expect(system.getActiveForTeam('home')).not.toBeNull();

    // Try to activate another powerup for the same team
    system.activateForTeam('home', 'on-fire');
    // Should still have the first powerup, not the second
    // Only one active powerup per team at a time
    expect(system.getActiveForTeam('home')).not.toBe('on-fire');
  });

  it('deactivates powerup after duration expires (speed-burst=5s, simulate 6s)', () => {
    const bus = new EventBus();
    const system = new PowerupSystem(bus);

    // Activate speed-burst for home team
    // First, make sure no active powerup
    expect(system.getActiveForTeam('home')).toBeNull();

    // Force activate directly
    system.chargeMeter(100);
    system.update(1, 0);
    // We need a speed-burst specifically, so let's use activateForTeam directly
    // Clear any existing state
    if (system.activeOrb) {
      system.pickupOrb('home');
    }
    // Deactivate whatever was activated and force speed-burst
    system.tick(100); // clear any active powerup

    system.activateForTeam('home', 'speed-burst');
    expect(system.getActiveForTeam('home')).toBe('speed-burst');

    // Simulate 4 seconds - should still be active
    system.tick(4);
    expect(system.getActiveForTeam('home')).toBe('speed-burst');

    // Simulate 2 more seconds (total 6s > 5s duration) - should be deactivated
    system.tick(2);
    expect(system.getActiveForTeam('home')).toBeNull();
  });
});
