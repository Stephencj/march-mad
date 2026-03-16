import { describe, it, expect } from 'vitest';
import { GamePlayer } from '@/game/player';
import { createDefaultPlayerStats } from '@/core/types';
import * as THREE from 'three';

describe('GamePlayer', () => {
  it('creates a mesh group with body parts', () => {
    const player = new GamePlayer({
      id: 'p1', name: 'Test Player',
      stats: createDefaultPlayerStats(),
      personality: 'Clutch', isCustom: false,
    }, new THREE.Vector3(0, 0, 0), 0x3498db);
    expect(player.group).toBeInstanceOf(THREE.Group);
    expect(player.group.children.length).toBeGreaterThan(0);
  });

  it('moves toward target position based on speed stat', () => {
    const stats = createDefaultPlayerStats();
    stats.speed = 8;
    const player = new GamePlayer({
      id: 'p1', name: 'Fast', stats, personality: 'Clutch', isCustom: false,
    }, new THREE.Vector3(0, 0, 0), 0x3498db);
    player.moveToward(new THREE.Vector3(10, 0, 0), 1 / 60);
    expect(player.group.position.x).toBeGreaterThan(0);
  });

  it('tracks performance score for sub-in replacement logic', () => {
    const player = new GamePlayer({
      id: 'p1', name: 'Test', stats: createDefaultPlayerStats(), personality: 'Clutch', isCustom: false,
    }, new THREE.Vector3(0, 0, 0), 0x3498db);
    expect(player.performanceScore).toBe(0);
    player.recordStat('points', 5);
    player.recordStat('assists', 2);
    player.recordStat('turnovers', 1);
    expect(player.performanceScore).toBe(6);
  });

  it('faces movement direction', () => {
    const player = new GamePlayer({
      id: 'p1', name: 'Test', stats: createDefaultPlayerStats(), personality: 'Team Player', isCustom: false,
    }, new THREE.Vector3(0, 0, 0), 0x3498db);
    player.moveToward(new THREE.Vector3(0, 0, -10), 1 / 60);
    const forward = new THREE.Vector3(0, 0, -1);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(player.group.quaternion);
    expect(facing.dot(forward)).toBeGreaterThan(0.5);
  });
});

describe('GamePlayer - ball handling', () => {
  it('tracks hasBall state', () => {
    const player = new GamePlayer({
      id: 'p1', name: 'Test', stats: createDefaultPlayerStats(), personality: 'Clutch', isCustom: false,
    }, new THREE.Vector3(0, 0, 0), 0x3498db);
    expect(player.hasBall).toBe(false);
    player.giveBall();
    expect(player.hasBall).toBe(true);
    player.loseBall();
    expect(player.hasBall).toBe(false);
  });

  it('moveByInput moves player directly from joystick input', () => {
    const player = new GamePlayer({
      id: 'p1', name: 'Test', stats: createDefaultPlayerStats(), personality: 'Clutch', isCustom: false,
    }, new THREE.Vector3(0, 0, 0), 0x3498db);
    player.moveByInput(0.5, -0.5, 1 / 60);
    expect(player.group.position.x).toBeGreaterThan(0);
    expect(player.group.position.z).toBeLessThan(0);
  });

  it('computes distance to point', () => {
    const player = new GamePlayer({
      id: 'p1', name: 'Test', stats: createDefaultPlayerStats(), personality: 'Clutch', isCustom: false,
    }, new THREE.Vector3(3, 0, 4), 0x3498db);
    const dist = player.distanceTo(new THREE.Vector3(0, 0, 0));
    expect(dist).toBeCloseTo(5, 0);
  });
});
