import { describe, it, expect } from 'vitest';
import { EventBus } from '@/core/events';
import { GameSession } from '@/game/game-session';
import { generateTeams } from '@/data/teams';

describe('Freeplay AI control', () => {
  function createSession() {
    const events = new EventBus();
    const teams = generateTeams(5);
    return new GameSession(events, teams[0], teams[1], teams[0].players[0].id, '5v5');
  }

  it('should have all AI enabled by default', () => {
    const session = createSession();
    const players = session.getAllPlayers();
    for (const p of players) {
      expect(session.isAIEnabled(p.data.id)).toBe(true);
    }
  });

  it('should disable AI for a specific player', () => {
    const session = createSession();
    const players = session.getAllPlayers();
    const targetId = players[1].data.id;
    session.disableAI(targetId);
    expect(session.isAIEnabled(targetId)).toBe(false);
  });

  it('should re-enable AI for a player', () => {
    const session = createSession();
    const players = session.getAllPlayers();
    const targetId = players[1].data.id;
    session.disableAI(targetId);
    session.enableAI(targetId);
    expect(session.isAIEnabled(targetId)).toBe(true);
  });

  it('should disable AI for multiple players', () => {
    const session = createSession();
    const players = session.getAllPlayers();
    session.disableAI(players[1].data.id);
    session.disableAI(players[2].data.id);
    expect(session.isAIEnabled(players[1].data.id)).toBe(false);
    expect(session.isAIEnabled(players[2].data.id)).toBe(false);
    expect(session.isAIEnabled(players[3].data.id)).toBe(true);
  });
});
