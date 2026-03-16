import { CrowdLevel, CROWD_LEVELS } from '@/core/types';
import { EventBus } from '@/core/events';

const LEVEL_THRESHOLDS = [0, 20, 40, 65, 85];

const EVENT_INTENSITY: Record<string, number> = {
  score: 5,
  dunk: 15,
  block: 12,
  steal: 8,
  powerup: 10,
  'sub-in': 20,
  'consecutive-score': 8,
};

export class CrowdSystem {
  intensityValue = 0;
  private baseline = 0;
  private bus: EventBus;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  getLevel(): CrowdLevel {
    let levelIndex = 0;
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (this.intensityValue >= LEVEL_THRESHOLDS[i]) {
        levelIndex = i;
        break;
      }
    }
    return CROWD_LEVELS[levelIndex];
  }

  private getLevelIndex(): number {
    let levelIndex = 0;
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (this.intensityValue >= LEVEL_THRESHOLDS[i]) {
        levelIndex = i;
        break;
      }
    }
    return levelIndex;
  }

  onEvent(event: { type: string }): void {
    const intensity = EVENT_INTENSITY[event.type] ?? 0;
    this.intensityValue = Math.min(100, this.intensityValue + intensity);
    this.bus.emit('crowd-change', { level: this.getLevel() });
  }

  updateScoreDiff(diff: number): void {
    if (diff >= 10) {
      this.baseline = 50;
    } else if (diff >= 5) {
      this.baseline = 20;
    } else {
      this.baseline = 0;
    }
    // If current intensity is below the new baseline, raise it
    if (this.intensityValue < this.baseline) {
      this.intensityValue = this.baseline;
    }
  }

  tick(dt: number): void {
    const decayRate = 1.33;
    if (this.intensityValue > this.baseline) {
      this.intensityValue = Math.max(
        this.baseline,
        this.intensityValue - decayRate * dt,
      );
    }
  }

  getMomentumModifier(): number {
    return this.getLevelIndex() * 0.025;
  }

  getScreenShakeIntensity(): number {
    return this.getLevelIndex() * 0.2;
  }

  getCrowdAnimSpeed(): number {
    return 1 + this.getLevelIndex() * 0.3;
  }
}
