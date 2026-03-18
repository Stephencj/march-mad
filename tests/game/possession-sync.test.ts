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

describe('Possession Authority', () => {
  it('updates possession when opposing team picks up loose ball', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1', '5v5');
    session.start();
    expect(session.matchEngine.state.possession).toBe('home');

    // Ball becomes loose
    session.homePlayers[0].loseBall();
    session.ball.release();
    session.ball.mesh.position.set(0, 1, 0);
    session.ball.velocity.set(0, 0, 0);

    // Move away player close to ball
    session.awayPlayers[0].group.position.set(0, 0, 0.5);
    session.update(1 / 60);

    expect(session.matchEngine.state.possession).toBe('away');
  });

  it('auto-corrects possession desync every frame', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1', '5v5');
    session.start();

    // Create intentional desync
    session.setBallHolder('a-2');
    session.matchEngine.state.possession = 'home'; // WRONG

    session.update(1 / 60);
    expect(session.matchEngine.state.possession).toBe('away');
  });

  it('auto-switches human control on rebound pickup', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1', '5v5');
    session.start();

    // Ball becomes loose
    session.homePlayers[0].loseBall();
    session.ball.release();
    session.ball.mesh.position.set(0, 1, 0);
    session.ball.velocity.set(0, 0, 0);

    // Move h-3 (not the human h-1) close to ball
    session.homePlayers[2].group.position.set(0, 0, 0.5);
    // Move everyone else far away
    session.homePlayers[0].group.position.set(10, 0, 10);
    session.homePlayers[1].group.position.set(10, 0, -10);
    session.homePlayers[3].group.position.set(-10, 0, 10);
    session.homePlayers[4].group.position.set(-10, 0, -10);
    for (const p of session.awayPlayers) p.group.position.set(10, 0, 5);

    session.update(1 / 60);

    // Human control should have switched to h-3
    expect(session.getHumanPlayer().data.id).toBe('h-3');
  });

  it('ball handler targets correct attack hoop after possession change', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1', '5v5');
    session.start();

    session.setBallHolder('a-1');
    session.matchEngine.state.possession = 'away';
    session.awayPlayers[0].group.position.set(0, 0, 0);

    for (let i = 0; i < 60; i++) session.update(1 / 60);

    // Away attacks z=-13
    expect(session.awayPlayers[0].aiTarget!.z).toBeLessThan(0);
  });

  it('shot clock violation gives ball to correct team via event', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1', '5v5');
    session.start();

    // Force shot clock to expire
    session.matchEngine.state.shotClockSeconds = 0.01;
    session.matchEngine.state.possession = 'home';
    session.update(0.02); // tick past shot clock

    // Away should now have possession (home violated)
    expect(session.matchEngine.state.possession).toBe('away');
  });
});
