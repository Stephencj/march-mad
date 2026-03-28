import { describe, it, expect, vi } from 'vitest';
import { PowerupSystem, findValidSpawnPosition } from '@/systems/powerups';
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

  describe('spawn bounds', () => {
    it('should spawn orbs within court bounds', () => {
      const system = new PowerupSystem(new EventBus());
      // Force meter full
      system.chargeMeter(100);

      for (let i = 0; i < 100; i++) {
        system.update(5, 0);
        if (system.activeOrb) {
          const { x, z } = system.activeOrb.position;
          expect(x).toBeGreaterThanOrEqual(-6.5);
          expect(x).toBeLessThanOrEqual(6.5);
          expect(z).toBeGreaterThanOrEqual(-12);
          expect(z).toBeLessThanOrEqual(12);
          // Reset for next iteration
          system.activeOrb = null;
          system.chargeMeter(100);
        }
      }
    });
  });

  describe('findValidSpawnPosition', () => {
    it('should not spawn within 2.0 units of any player', () => {
      const players = [{ x: 0, z: 0 }];
      for (let i = 0; i < 50; i++) {
        const pos = findValidSpawnPosition(players);
        const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
        expect(dist).toBeGreaterThanOrEqual(2.0);
      }
    });

    it('should not spawn within 3.0 units of hoops (|z| > 11)', () => {
      for (let i = 0; i < 50; i++) {
        const pos = findValidSpawnPosition([]);
        if (Math.abs(pos.z) > 11) {
          expect(Math.abs(pos.z)).toBeLessThanOrEqual(11);
        }
      }
    });

    it('should not spawn inside paint area', () => {
      for (let i = 0; i < 50; i++) {
        const pos = findValidSpawnPosition([]);
        const inPaint = Math.abs(pos.x) < 1.8 && Math.abs(pos.z) > 8.2;
        expect(inPaint).toBe(false);
      }
    });

    it('should always return a position within court bounds', () => {
      const players = [];
      for (let px = -6; px <= 6; px += 2) {
        for (let pz = -10; pz <= 10; pz += 2) {
          players.push({ x: px, z: pz });
        }
      }
      const pos = findValidSpawnPosition(players);
      expect(pos.x).toBeGreaterThanOrEqual(-6.5);
      expect(pos.x).toBeLessThanOrEqual(6.5);
      expect(pos.z).toBeGreaterThanOrEqual(-12);
      expect(pos.z).toBeLessThanOrEqual(12);
    });
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
