import { describe, it, expect } from 'vitest';
import { GameSession } from '@/game/game-session';
import { EventBus } from '@/core/events';
import type { TeamData, PlayerData } from '@/core/types';

function makePlayer(id: string): PlayerData {
  return { id, name: `P${id}`, stats: { speed: 5, shooting: 5, defense: 5, passing: 5, dunkPower: 5 }, personality: 'Team Player' as any, isCustom: false };
}
function makeTeam(id: string, name: string): TeamData {
  return {
    id, name, mascot: 'T', colors: { primary: '#ff0000', secondary: '#0000ff' },
    archetype: 'Balanced' as any, seed: 8,
    players: [makePlayer(`${id}-1`), makePlayer(`${id}-2`), makePlayer(`${id}-3`), makePlayer(`${id}-4`), makePlayer(`${id}-5`)],
  };
}

describe('Direction Simulation', () => {
  it('HOME team with ball attacks toward z=+13', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1', '5v5');
    session.start();

    // Home has ball — should attack z=+13
    session.setBallHolder('h-2');
    session.matchEngine.state.possession = 'home';

    for (let i = 0; i < 120; i++) session.update(1 / 60);

    const ballHandler = session.homePlayers[1]; // h-2
    expect(ballHandler.aiTarget).not.toBeNull();
    expect(ballHandler.aiTarget!.z).toBeGreaterThan(0); // attacking toward z=+13
  });

  it('AWAY team with ball attacks toward z=-13', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1', '5v5');
    session.start();

    // Give ball to away team
    session.setBallHolder('a-1');
    session.matchEngine.state.possession = 'away';

    for (let i = 0; i < 120; i++) session.update(1 / 60);

    const ballHandler = session.awayPlayers[0]; // a-1
    expect(ballHandler.aiTarget).not.toBeNull();
    expect(ballHandler.aiTarget!.z).toBeLessThan(0); // attacking toward z=-13
  });
});
