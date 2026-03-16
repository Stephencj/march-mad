import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameLoop } from '@/core/game-loop';

// Mock browser APIs not available in Node
vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number);
vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));

describe('GameLoop', () => {
  it('calls update with fixed timestep', () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = new GameLoop({ fixedStep: 1 / 60, update, render });
    loop.tick(16.67);
    expect(update).toHaveBeenCalledWith(1 / 60);
    expect(render).toHaveBeenCalledOnce();
  });

  it('accumulates time for multiple fixed steps in one frame', () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = new GameLoop({ fixedStep: 1 / 60, update, render });
    loop.tick(50);
    expect(update).toHaveBeenCalledTimes(3);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('caps accumulated time to prevent spiral of death', () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = new GameLoop({ fixedStep: 1 / 60, update, render, maxAccumulator: 0.1 });
    loop.tick(500);
    expect(update.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('tracks running state', () => {
    const loop = new GameLoop({ fixedStep: 1 / 60, update: vi.fn(), render: vi.fn() });
    expect(loop.isRunning).toBe(false);
    loop.start();
    expect(loop.isRunning).toBe(true);
    loop.stop();
    expect(loop.isRunning).toBe(false);
  });
});
