import { PowerupType, Possession, POWERUP_TIERS } from '@/core/types';
import { EventBus } from '@/core/events';

export interface PowerupOrb {
  type: PowerupType;
  position: { x: number; z: number };
}

interface ActivePowerup {
  type: PowerupType;
  remainingTime: number;
}

const POWERUP_DURATIONS: Record<PowerupType, number> = {
  'speed-burst': 5,
  'hot-hand': 10,
  'sticky-fingers': 8,
  'on-fire': 15,
  'phantom-step': 1,
  'brick-wall': 8,
  'giant-ball': 12,
  'trampoline': 10,
  'force-field': 10,
};

export function findValidSpawnPosition(
  players: { x: number; z: number }[]
): { x: number; z: number } {
  let candidate = { x: 0, z: 0 };

  for (let attempt = 0; attempt < 10; attempt++) {
    candidate = {
      x: Math.random() * 13 - 6.5,
      z: Math.random() * 24 - 12,
    };

    const tooCloseToPlayer = players.some((p) => {
      const dx = candidate.x - p.x;
      const dz = candidate.z - p.z;
      return Math.sqrt(dx * dx + dz * dz) < 2.0;
    });
    if (tooCloseToPlayer) continue;

    if (Math.abs(candidate.z) > 11) continue;

    if (Math.abs(candidate.x) < 1.8 && Math.abs(candidate.z) > 8.2) continue;

    return candidate;
  }

  return candidate;
}

export class PowerupSystem {
  activeOrb: PowerupOrb | null = null;
  private meter = 0;
  private activePowerups: Map<Possession, ActivePowerup> = new Map();
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  selectPowerup(deficit: number): PowerupType | null {
    if (deficit <= 0) return null;

    // Check tiers highest first
    for (const tierNum of [3, 2, 1]) {
      const tier = POWERUP_TIERS[tierNum];
      if (deficit >= tier.minDeficit && deficit <= tier.maxDeficit) {
        const types = tier.types;
        return types[Math.floor(Math.random() * types.length)];
      }
    }

    return null;
  }

  chargeMeter(amount: number): void {
    this.meter = Math.min(this.meter + amount, 100);
  }

  getMeter(): number {
    return this.meter;
  }

  update(deficit: number, dt: number, playerPositions: { x: number; z: number }[] = []): void {
    if (this.meter >= 100 && !this.activeOrb && deficit > 0) {
      const type = this.selectPowerup(deficit);
      if (type) {
        this.activeOrb = {
          type,
          position: findValidSpawnPosition(playerPositions),
        };
        this.meter = 0;
      }
    }
  }

  pickupOrb(team: Possession): void {
    if (!this.activeOrb) return;

    const type = this.activeOrb.type;
    this.activeOrb = null;
    this.activateForTeam(team, type);
    this.eventBus.emit('powerup', { type, team });
  }

  activateForTeam(team: Possession, type: PowerupType): void {
    // Only allow one active powerup per team at a time
    if (this.activePowerups.has(team)) return;

    const duration = POWERUP_DURATIONS[type];
    this.activePowerups.set(team, { type, remainingTime: duration });
  }

  getActiveForTeam(team: Possession): PowerupType | null {
    const active = this.activePowerups.get(team);
    return active ? active.type : null;
  }

  tick(dt: number): void {
    // Decrement active powerup timers and deactivate expired ones
    for (const [team, powerup] of this.activePowerups) {
      powerup.remainingTime -= dt;
      if (powerup.remainingTime <= 0) {
        this.activePowerups.delete(team);
      }
    }

    // Passive charge: +2 per second
    this.chargeMeter(2 * dt);
  }
}
