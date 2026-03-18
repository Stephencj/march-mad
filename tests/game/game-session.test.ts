import { describe, it, expect, vi } from 'vitest';
import { GameSession } from '@/game/game-session';
import { EventBus } from '@/core/events';
import { createDefaultPlayerStats } from '@/core/types';
import type { TeamData, PlayerData } from '@/core/types';
import * as THREE from 'three';

function makePlayer(id: string, personality: string = 'Team Player'): PlayerData {
  return { id, name: `Player ${id}`, stats: createDefaultPlayerStats(), personality: personality as any, isCustom: false };
}

function makeTeam(id: string, name: string, archetype: string = 'Balanced'): TeamData {
  return {
    id, name, mascot: 'Test', colors: { primary: '#ff0000', secondary: '#0000ff' },
    archetype: archetype as any, seed: 8,
    players: [makePlayer(`${id}-1`), makePlayer(`${id}-2`), makePlayer(`${id}-3`)],
  };
}

describe('GameSession', () => {
  it('initializes with 6 players on court', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    expect(session.homePlayers).toHaveLength(3);
    expect(session.awayPlayers).toHaveLength(3);
  });

  it('gives ball to a home player at start', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    const holders = [...session.homePlayers, ...session.awayPlayers].filter(p => p.hasBall);
    expect(holders).toHaveLength(1);
  });

  it('human player moves with input', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    const humanPlayer = session.getHumanPlayer();
    const startX = humanPlayer.position.x;
    session.processInput({ joystick: { x: 1, y: 0 }, gesture: null }, 1 / 60);
    expect(humanPlayer.position.x).toBeGreaterThan(startX);
  });

  it('ball follows the holder each frame', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    const holder = session.getAllPlayers().find(p => p.hasBall)!;
    session.update(1 / 60);
    // Ball should be near the holder
    const dist = session.ball.mesh.position.distanceTo(holder.position);
    expect(dist).toBeLessThan(2);
  });

  it('AI players move each frame', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    const aiPlayer = session.homePlayers.find(p => p.data.id !== 'h-1')!;
    const startPos = aiPlayer.position.clone();
    // Run enough frames for AI to make decisions and move
    for (let i = 0; i < 60; i++) session.update(1 / 60);
    const moved = startPos.distanceTo(aiPlayer.position) > 0.01;
    expect(moved).toBe(true);
  });

  it('swipe-up gesture triggers a shot when human has ball', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    // Give ball to human
    session.setBallHolder('h-1');
    session.processInput({
      joystick: { x: 0, y: 0 },
      gesture: { type: 'swipe-up', power: 0.8, direction: { x: 0, y: -1 } },
    }, 1 / 60);
    expect(session.ball.isInFlight).toBe(true);
  });

  it('returns current camera target based on possession', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    const target = session.getCameraInfo();
    expect(target.mode).toBeDefined();
    expect(target.trackPosition).toBeDefined();
  });

  it('provides game over data', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    session.handleMadeShot('home', 'three-pointer');
    const data = session.getGameOverData();
    expect(data.homeScore).toBe(2);
    expect(data.humanTeam).toBe('home');
    expect(data.xpEarned).toBeGreaterThan(0);
  });

  it('detects made shot and updates score', () => {
    const events = new EventBus();
    const scoreHandler = vi.fn();
    events.on('score', scoreHandler);
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();
    // Manually trigger a made shot scenario
    session.handleMadeShot('home', 'three-pointer');
    expect(scoreHandler).toHaveBeenCalled();
  });

  it('camera-relative input: camera facing -Z, joystick Y=-1 moves player in -Z', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
    session.start();

    // Create a camera looking down -Z (default orientation)
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 10, 15);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    session.setCameraRef(cam);

    const humanPlayer = session.getHumanPlayer();
    const startZ = humanPlayer.position.z;
    // Joystick Y=-1 (push forward on stick) should move player in -Z (into the screen / toward hoop)
    session.processInput({ joystick: { x: 0, y: -1 }, gesture: null }, 1 / 60);
    expect(humanPlayer.position.z).toBeLessThan(startZ);
  });
});

describe('GameSession - 5v5 mode', () => {
  function makeTeam5(id: string): TeamData {
    return {
      id, name: `Team ${id}`, mascot: 'Test',
      colors: { primary: '#ff0000', secondary: '#0000ff' },
      archetype: 'Balanced' as any, seed: 8,
      players: [
        makePlayer(`${id}-1`), makePlayer(`${id}-2`), makePlayer(`${id}-3`),
        makePlayer(`${id}-4`), makePlayer(`${id}-5`),
      ],
    };
  }

  it('initializes with 10 players in 5v5', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam5('h'), makeTeam5('a'), 'h-1', '5v5');
    expect(session.homePlayers).toHaveLength(5);
    expect(session.awayPlayers).toHaveLength(5);
  });

  it('home team always attacks hoopAway (z=+13)', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam5('h'), makeTeam5('a'), 'h-1', '5v5');
    expect(session.getTeamAttackHoop('home').z).toBeCloseTo(13, 0);
    expect(session.getTeamDefendHoop('home').z).toBeCloseTo(-13, 0);
  });

  it('away team always attacks hoopHome (z=-13)', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam5('h'), makeTeam5('a'), 'h-1', '5v5');
    expect(session.getTeamAttackHoop('away').z).toBeCloseTo(-13, 0);
    expect(session.getTeamDefendHoop('away').z).toBeCloseTo(13, 0);
  });

  it('after score, hoops do NOT swap', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam5('h'), makeTeam5('a'), 'h-1', '5v5');
    session.start();
    const homeAttackZ = session.getTeamAttackHoop('home').z;
    const awayAttackZ = session.getTeamAttackHoop('away').z;
    session.handleMadeShot('home', 'three-pointer');
    // Hoops should NOT change after a score
    expect(session.getTeamAttackHoop('home').z).toBeCloseTo(homeAttackZ, 0);
    expect(session.getTeamAttackHoop('away').z).toBeCloseTo(awayAttackZ, 0);
  });

  it('keeps human control stable on defense (no auto-switch)', () => {
    const events = new EventBus();
    const session = new GameSession(events, makeTeam5('h'), makeTeam5('a'), 'h-1', '5v5');
    session.start();
    session.setBallHolder('a-1');
    session.matchEngine.state.possession = 'away';
    // Move h-3 very close to a-1
    session.homePlayers[2].group.position.copy(session.awayPlayers[0].group.position);
    session.update(1/60);
    // Zone defense: human player stays the same, no auto-switch
    expect(session.getHumanPlayer().data.id).toBe('h-1');
  });
});
