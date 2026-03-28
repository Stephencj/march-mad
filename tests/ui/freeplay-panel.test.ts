// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FreeplayPanel } from '@/ui/freeplay-panel';

interface MockPlayer { id: string; name: string; position: string; team: 'home' | 'away'; }

describe('FreeplayPanel', () => {
  let container: HTMLElement;
  let panel: FreeplayPanel;
  let onToggle: ReturnType<typeof vi.fn>;
  const players: MockPlayer[] = [
    { id: 'h1', name: 'Player 1', position: 'PG', team: 'home' },
    { id: 'h2', name: 'Player 2', position: 'SG', team: 'home' },
    { id: 'a1', name: 'Opp 1', position: 'PG', team: 'away' },
    { id: 'a2', name: 'Opp 2', position: 'SG', team: 'away' },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    onToggle = vi.fn();
    panel = new FreeplayPanel(container, onToggle);
    panel.setup(players, 'h1');
  });

  it('should render toggle rows for non-human players', () => {
    const rows = container.querySelectorAll('[data-player-id]');
    expect(rows.length).toBe(3);
  });

  it('should call onToggle when clicking a player toggle', () => {
    const toggle = container.querySelector('[data-player-id="h2"] button') as HTMLButtonElement;
    toggle?.click();
    expect(onToggle).toHaveBeenCalledWith('h2', false);
  });

  it('should render bulk toggles', () => {
    const bulkBtns = container.querySelectorAll('[data-bulk]');
    expect(bulkBtns.length).toBe(2);
  });

  it('should toggle visibility', () => {
    panel.show();
    expect(panel.visible).toBe(true);
    panel.hide();
    expect(panel.visible).toBe(false);
  });

  it('should toggle all teammates', () => {
    const btn = container.querySelector('[data-bulk="teammates"]') as HTMLButtonElement;
    btn?.click();
    expect(onToggle).toHaveBeenCalledWith('h2', false);
  });

  it('should toggle all opponents', () => {
    const btn = container.querySelector('[data-bulk="opponents"]') as HTMLButtonElement;
    btn?.click();
    expect(onToggle).toHaveBeenCalledWith('a1', false);
    expect(onToggle).toHaveBeenCalledWith('a2', false);
  });
});
