import { describe, it, expect, vi } from 'vitest';
import { GameStateMachine, type StateTransition } from '@/core/state-machine';
import type { AppState } from '@/core/types';

describe('GameStateMachine', () => {
  const validTransitions: StateTransition[] = [
    { from: 'MainMenu', to: 'PlayerCreation' },
    { from: 'MainMenu', to: 'TournamentSelect' },
    { from: 'PlayerCreation', to: 'MainMenu' },
    { from: 'TournamentSelect', to: 'DraftPhase' },
    { from: 'DraftPhase', to: 'BracketView' },
    { from: 'BracketView', to: 'YourGame' },
    { from: 'BracketView', to: 'Spectating' },
    { from: 'YourGame', to: 'PostGame' },
    { from: 'Spectating', to: 'BettingOverlay' },
    { from: 'Spectating', to: 'BracketView' },
    { from: 'Spectating', to: 'SubInCinematic' },
    { from: 'BettingOverlay', to: 'Spectating' },
    { from: 'SubInCinematic', to: 'YourGame' },
    { from: 'PostGame', to: 'BracketView' },
    { from: 'PostGame', to: 'TournamentEnd' },
    { from: 'TournamentEnd', to: 'MainMenu' },
  ];

  it('starts in MainMenu state', () => {
    const sm = new GameStateMachine(validTransitions);
    expect(sm.current).toBe('MainMenu');
  });

  it('transitions to valid state', () => {
    const sm = new GameStateMachine(validTransitions);
    const result = sm.transition('TournamentSelect');
    expect(result).toBe(true);
    expect(sm.current).toBe('TournamentSelect');
  });

  it('rejects invalid transition', () => {
    const sm = new GameStateMachine(validTransitions);
    const result = sm.transition('YourGame');
    expect(result).toBe(false);
    expect(sm.current).toBe('MainMenu');
  });

  it('fires onEnter and onExit callbacks', () => {
    const onExit = vi.fn();
    const onEnter = vi.fn();
    const sm = new GameStateMachine(validTransitions);
    sm.onExit('MainMenu', onExit);
    sm.onEnter('TournamentSelect', onEnter);
    sm.transition('TournamentSelect');
    expect(onExit).toHaveBeenCalledWith('MainMenu', 'TournamentSelect');
    expect(onEnter).toHaveBeenCalledWith('MainMenu', 'TournamentSelect');
  });

  it('supports full game flow path', () => {
    const sm = new GameStateMachine(validTransitions);
    expect(sm.transition('TournamentSelect')).toBe(true);
    expect(sm.transition('DraftPhase')).toBe(true);
    expect(sm.transition('BracketView')).toBe(true);
    expect(sm.transition('YourGame')).toBe(true);
    expect(sm.transition('PostGame')).toBe(true);
    expect(sm.transition('BracketView')).toBe(true);
    expect(sm.transition('Spectating')).toBe(true);
    expect(sm.transition('BettingOverlay')).toBe(true);
    expect(sm.transition('Spectating')).toBe(true);
    expect(sm.transition('SubInCinematic')).toBe(true);
    expect(sm.transition('YourGame')).toBe(true);
    expect(sm.transition('PostGame')).toBe(true);
    expect(sm.transition('TournamentEnd')).toBe(true);
    expect(sm.transition('MainMenu')).toBe(true);
  });
});
