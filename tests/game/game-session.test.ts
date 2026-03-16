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
});
