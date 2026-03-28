import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HapticManager } from '@/systems/haptics';

function createMockVibrationActuator() {
  return {
    playEffect: vi.fn().mockResolvedValue('complete'),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}

describe('HapticManager', () => {
  let haptics: HapticManager;
  let mockActuator: ReturnType<typeof createMockVibrationActuator>;

  beforeEach(() => {
    mockActuator = createMockVibrationActuator();
    haptics = new HapticManager();
    haptics.setVibrationActuator(mockActuator as any);
  });

  it('should fire light tap on shoot', () => {
    haptics.onShoot();
    expect(mockActuator.playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 100,
      strongMagnitude: 0.3,
      weakMagnitude: 0.3,
    });
  });

  it('should fire strong pulse on score', () => {
    haptics.onScore();
    expect(mockActuator.playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 200,
      strongMagnitude: 0.7,
      weakMagnitude: 0.7,
    });
  });

  it('should fire medium hit on block', () => {
    haptics.onBlock();
    expect(mockActuator.playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 150,
      strongMagnitude: 0.5,
      weakMagnitude: 0.5,
    });
  });

  it('should fire medium hit on steal', () => {
    haptics.onSteal();
    expect(mockActuator.playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 150,
      strongMagnitude: 0.5,
      weakMagnitude: 0.5,
    });
  });

  it('should fire first pulse on powerup pickup', () => {
    haptics.onPowerupPickup();
    expect(mockActuator.playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 100,
      strongMagnitude: 0.4,
      weakMagnitude: 0.4,
    });
  });

  it('should fire sustained buzz on foul', () => {
    haptics.onFoul();
    expect(mockActuator.playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 300,
      strongMagnitude: 0.6,
      weakMagnitude: 0.6,
    });
  });

  it('should no-op gracefully when no actuator set', () => {
    const noHaptics = new HapticManager();
    expect(() => noHaptics.onShoot()).not.toThrow();
    expect(() => noHaptics.onScore()).not.toThrow();
  });

  it('should ramp charge vibration with level', () => {
    haptics.onCharge(0.5);
    expect(mockActuator.playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 50,
      strongMagnitude: expect.closeTo(0.3, 1),
      weakMagnitude: expect.closeTo(0.3, 1),
    });
  });
});
