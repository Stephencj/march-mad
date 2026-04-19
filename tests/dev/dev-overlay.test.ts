// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DevOverlay } from '@/dev/dev-overlay';
import { balanceConfig, resetBalance, getDefaults, serializeBalance } from '@/dev/balance-config';
import { levelConfig, resetLevel, getDefaults as getLevelDefaults } from '@/dev/level-config';
import { playerConfig, resetPlayer, getDefaults as getPlayerDefaults } from '@/dev/player-config';

describe('DevOverlay', () => {
  let container: HTMLElement;
  let overlay: DevOverlay;

  beforeEach(() => {
    resetBalance();
    resetLevel();
    resetPlayer();
    container = document.createElement('div');
    document.body.appendChild(container);
    overlay = new DevOverlay(container);
  });

  it('starts hidden — toggle shows it, toggle again hides it', () => {
    expect(container.children.length).toBe(0);
    overlay.toggle();
    expect(container.children.length).toBe(1);
    overlay.toggle();
    expect(container.children.length).toBe(0);
  });

  it('show is idempotent', () => {
    overlay.show();
    overlay.show();
    expect(container.children.length).toBe(1);
  });

  it('renders MATCH and SHOOTING sections with sliders', () => {
    overlay.show();
    expect(container.textContent).toContain('MATCH');
    expect(container.textContent).toContain('SHOOTING');
    expect(container.textContent).toContain('Win Score');
    expect(container.textContent).toContain('Layup Accuracy');
    const sliders = container.querySelectorAll('input[type="range"]');
    expect(sliders.length).toBeGreaterThan(0);
  });

  it('changing a slider value writes back to balanceConfig', () => {
    overlay.show();
    const winScoreNumeric = container.querySelector<HTMLInputElement>('input[data-role="numeric-Win Score"]')!;
    winScoreNumeric.value = '42';
    winScoreNumeric.dispatchEvent(new Event('input'));
    expect(balanceConfig.match.winScore).toBe(42);
  });

  it('Reset button restores defaults', () => {
    overlay.show();
    balanceConfig.match.winScore = 99;
    const resetBtn = container.querySelector<HTMLButtonElement>('button[data-action="reset"]')!;
    resetBtn.click();
    expect(balanceConfig.match.winScore).toBe(getDefaults().match.winScore);
  });

  it('Reset re-syncs slider DOM values to defaults', () => {
    overlay.show();
    const winScoreNumeric = container.querySelector<HTMLInputElement>('input[data-role="numeric-Win Score"]')!;
    winScoreNumeric.value = '42';
    winScoreNumeric.dispatchEvent(new Event('input'));
    const resetBtn = container.querySelector<HTMLButtonElement>('button[data-action="reset"]')!;
    resetBtn.click();
    expect(winScoreNumeric.value).toBe(String(getDefaults().match.winScore));
  });

  it('exports JSON that round-trips back through the config', () => {
    overlay.show();
    balanceConfig.match.winScore = 55;
    const exported = serializeBalance();
    const parsed = JSON.parse(exported);
    expect(parsed.match.winScore).toBe(55);
    expect(parsed.__version).toBeDefined();
  });

  it('hide() removes the panel and clears slider bindings', () => {
    overlay.show();
    expect(container.querySelectorAll('input[type="range"]').length).toBeGreaterThan(0);
    overlay.hide();
    expect(container.children.length).toBe(0);
    expect(container.querySelectorAll('input[type="range"]').length).toBe(0);
  });

  it('non-numeric input does not corrupt config', () => {
    overlay.show();
    const original = balanceConfig.match.winScore;
    const winScoreNumeric = container.querySelector<HTMLInputElement>('input[data-role="numeric-Win Score"]')!;
    winScoreNumeric.value = 'abc';
    winScoreNumeric.dispatchEvent(new Event('input'));
    expect(balanceConfig.match.winScore).toBe(original);
  });

  it('slider and numeric input stay in sync', () => {
    overlay.show();
    const slider = container.querySelector<HTMLInputElement>('input[data-role="slider-Layup Accuracy"]')!;
    const numeric = container.querySelector<HTMLInputElement>('input[data-role="numeric-Layup Accuracy"]')!;
    slider.value = '0.5';
    slider.dispatchEvent(new Event('input'));
    expect(numeric.value).toBe('0.5');
    expect(balanceConfig.shooting.baseAccuracy.layup).toBe(0.5);
  });

  describe('LEVEL section', () => {
    it('renders COURT and HOOP sections with sliders', () => {
      overlay.show();
      expect(container.textContent).toContain('COURT');
      expect(container.textContent).toContain('HOOP');
      expect(container.textContent).toContain('Width');
      expect(container.textContent).toContain('Rim Height');
    });

    it('a court-width edit writes to levelConfig', () => {
      overlay.show();
      const widthNumeric = container.querySelector<HTMLInputElement>('input[data-role="numeric-Width \u26a0\ufe0f"]')!;
      widthNumeric.value = '20';
      widthNumeric.dispatchEvent(new Event('input'));
      expect(levelConfig.court.width).toBe(20);
    });

    it('Reset clears balance, level, AND player configs', () => {
      overlay.show();
      balanceConfig.match.winScore = 99;
      levelConfig.court.width = 88;
      playerConfig.head.radius = 0.99;
      const resetBtn = container.querySelector<HTMLButtonElement>('button[data-action="reset"]')!;
      resetBtn.click();
      expect(balanceConfig.match.winScore).toBe(getDefaults().match.winScore);
      expect(levelConfig.court.width).toBe(getLevelDefaults().court.width);
      expect(playerConfig.head.radius).toBe(getPlayerDefaults().head.radius);
    });
  });

  describe('PLAYER section', () => {
    it('renders PLAYER section with body sliders', () => {
      overlay.show();
      expect(container.textContent).toContain('PLAYER');
      expect(container.textContent).toContain('Head Radius');
      expect(container.textContent).toContain('Torso Width');
      expect(container.textContent).toContain('Upper Arm Length');
    });

    it('a head-radius edit writes to playerConfig', () => {
      overlay.show();
      const headNumeric = container.querySelector<HTMLInputElement>('input[data-role="numeric-Head Radius"]')!;
      headNumeric.value = '0.4';
      headNumeric.dispatchEvent(new Event('input'));
      expect(playerConfig.head.radius).toBe(0.4);
    });
  });
});
