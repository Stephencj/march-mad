export interface GameLoopConfig {
  fixedStep: number;
  update: (dt: number) => void;
  render: () => void;
  maxAccumulator?: number;
}

export class GameLoop {
  private config: Required<GameLoopConfig>;
  private accumulator = 0;
  private rafId: number | null = null;
  private lastTime = 0;
  isRunning = false;

  constructor(config: GameLoopConfig) {
    this.config = { maxAccumulator: 0.1, ...config };
  }

  tick(deltaMs: number): void {
    const deltaSec = deltaMs / 1000;
    this.accumulator += deltaSec;

    if (this.accumulator > this.config.maxAccumulator) {
      this.accumulator = this.config.maxAccumulator;
    }

    while (this.accumulator >= this.config.fixedStep) {
      this.config.update(this.config.fixedStep);
      this.accumulator -= this.config.fixedStep;
    }

    this.config.render();
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    const frame = (time: number) => {
      if (!this.isRunning) return;
      const delta = time - this.lastTime;
      this.lastTime = time;
      this.tick(delta);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
