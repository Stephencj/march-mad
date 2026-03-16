import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '@/core/events';

describe('EventBus', () => {
  it('calls listeners when event is emitted', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('score', handler);
    bus.emit('score', { team: 'home', points: 2 });
    expect(handler).toHaveBeenCalledWith({ team: 'home', points: 2 });
  });

  it('supports multiple listeners for same event', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('score', h1);
    bus.on('score', h2);
    bus.emit('score', { team: 'away', points: 1 });
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('removes listener with off()', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('score', handler);
    bus.off('score', handler);
    bus.emit('score', { team: 'home', points: 3 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('once() fires only one time', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('score', handler);
    bus.emit('score', { points: 1 });
    bus.emit('score', { points: 2 });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not throw when emitting event with no listeners', () => {
    const bus = new EventBus();
    expect(() => bus.emit('nonexistent', {})).not.toThrow();
  });
});
