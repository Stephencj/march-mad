import { describe, it, expect, beforeEach } from 'vitest';
import { InputManager } from '@/game/input-manager';

describe('InputManager', () => {
  let manager: InputManager;

  beforeEach(() => {
    manager = new InputManager();
  });

  describe('merge priority', () => {
    it('should return zero joystick with no input', () => {
      const input = manager.getInput();
      expect(input.joystick.x).toBe(0);
      expect(input.joystick.y).toBe(0);
    });

    it('should combine sprinting from keyboard or gamepad', () => {
      const input = manager.getInput();
      expect(input.sprinting).toBe(false);
    });
  });

  describe('lastUsedDevice', () => {
    it('should default to keyboard', () => {
      expect(manager.lastUsedDevice).toBe('keyboard');
    });
  });

  describe('controller type', () => {
    it('should return null when no gamepad connected', () => {
      expect(manager.getControllerType()).toBeNull();
    });
  });

  describe('checkPause', () => {
    it('should return false when no pause pressed', () => {
      expect(manager.checkPause()).toBe(false);
    });
  });
});
