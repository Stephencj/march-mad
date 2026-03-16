// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { HUD } from '@/ui/hud';

describe('HUD', () => {
  it('renders scoreboard', () => {
    const container = document.createElement('div');
    const hud = new HUD(container);

    hud.updateScore(12, 8);

    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain('8');
  });

  it('renders clock in M:SS format', () => {
    const container = document.createElement('div');
    const hud = new HUD(container);

    hud.updateClock(125);

    expect(container.textContent).toContain('2:05');
  });

  it('renders active powerup', () => {
    const container = document.createElement('div');
    const hud = new HUD(container);

    hud.showPowerup('speed-burst', 5);

    expect(container.textContent).toContain('speed-burst');
  });

  it('renders crowd level', () => {
    const container = document.createElement('div');
    const hud = new HUD(container);

    hud.updateCrowdLevel('HYPED');

    expect(container.textContent).toContain('HYPED');
  });

  it('shows sub-in prompt', () => {
    const container = document.createElement('div');
    const hud = new HUD(container);

    hud.showSubInPrompt('pulsing');

    expect(container.textContent).toContain('SUB IN');
  });
});
