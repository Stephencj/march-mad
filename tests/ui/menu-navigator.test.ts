// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MenuNavigator } from '@/ui/menu-navigator';

function createButtons(count: number): HTMLButtonElement[] {
  return Array.from({ length: count }, (_, i) => {
    const btn = document.createElement('button');
    btn.textContent = `Button ${i}`;
    return btn;
  });
}

describe('MenuNavigator', () => {
  let nav: MenuNavigator;

  beforeEach(() => {
    nav = new MenuNavigator();
  });

  describe('focus cycling', () => {
    it('should focus first item on register', () => {
      const btns = createButtons(3);
      nav.register(btns);
      expect(nav.focusedIndex).toBe(0);
      expect(btns[0].classList.contains('menu-focused')).toBe(true);
    });

    it('should move focus down', () => {
      const btns = createButtons(3);
      nav.register(btns);
      nav.navigate('down');
      expect(nav.focusedIndex).toBe(1);
      expect(btns[1].classList.contains('menu-focused')).toBe(true);
      expect(btns[0].classList.contains('menu-focused')).toBe(false);
    });

    it('should wrap around at bottom', () => {
      const btns = createButtons(3);
      nav.register(btns);
      nav.navigate('down');
      nav.navigate('down');
      nav.navigate('down');
      expect(nav.focusedIndex).toBe(0);
    });

    it('should wrap around at top', () => {
      const btns = createButtons(3);
      nav.register(btns);
      nav.navigate('up');
      expect(nav.focusedIndex).toBe(2);
    });
  });

  describe('grid navigation', () => {
    it('should move right in grid mode', () => {
      const btns = createButtons(6);
      nav.register(btns, 3);
      nav.navigate('right');
      expect(nav.focusedIndex).toBe(1);
    });

    it('should move down a row in grid mode', () => {
      const btns = createButtons(6);
      nav.register(btns, 3);
      nav.navigate('down');
      expect(nav.focusedIndex).toBe(3);
    });
  });

  describe('selection', () => {
    it('should trigger click on focused item', () => {
      const btns = createButtons(3);
      const clickHandler = vi.fn();
      btns[0].addEventListener('click', clickHandler);
      nav.register(btns);
      nav.select();
      expect(clickHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('back handler', () => {
    it('should call back handler', () => {
      const backFn = vi.fn();
      nav.register(createButtons(2));
      nav.setBackHandler(backFn);
      nav.back();
      expect(backFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('should deactivate on clear', () => {
      nav.register(createButtons(3));
      expect(nav.active).toBe(true);
      nav.clear();
      expect(nav.active).toBe(false);
    });
  });
});
