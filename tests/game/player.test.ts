import { describe, it, expect } from 'vitest';
import { GamePlayer } from '@/game/player';
import { createDefaultPlayerStats } from '@/core/types';
import * as THREE from 'three';

function makePlayer(id = 'p1', name = 'Test Player') {
  return new GamePlayer({
    id, name,
    stats: createDefaultPlayerStats(),
    personality: 'Clutch', isCustom: false,
  }, new THREE.Vector3(0, 0, 0), 0x3498db);
}

describe('GamePlayer', () => {
  it('creates a mesh group with bobblehead body parts', () => {
    const player = makePlayer();
    expect(player.group).toBeInstanceOf(THREE.Group);
    // Bobblehead baller has many parts: shoes(2), lower legs(2), knees(2),
    // upper legs(2), torso, arms(2), forearms(2), neck, head, eyes(2),
    // hair, possession-ring, player-indicator = 19 children
    expect(player.group.children.length).toBeGreaterThanOrEqual(19);
  });

  it('has all named body parts', () => {
    const player = makePlayer();
    const expectedParts = [
      'head', 'hair', 'neck', 'torso',
      'arm-left', 'arm-right', 'forearm-left', 'forearm-right',
      'leg-upper-left', 'leg-upper-right', 'leg-lower-left', 'leg-lower-right',
      'shoe-left', 'shoe-right',
      'possession-ring', 'player-indicator',
    ];
    for (const name of expectedParts) {
      expect(player.group.getObjectByName(name), `missing part: ${name}`).toBeDefined();
    }
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
    const player = makePlayer();
    expect(player.performanceScore).toBe(0);
    player.recordStat('points', 5);
    player.recordStat('assists', 2);
    player.recordStat('turnovers', 1);
    expect(player.performanceScore).toBe(6);
  });

  it('faces movement direction', () => {
    const player = makePlayer();
    player.moveToward(new THREE.Vector3(0, 0, -10), 1 / 60);
    const forward = new THREE.Vector3(0, 0, -1);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(player.group.quaternion);
    expect(facing.dot(forward)).toBeGreaterThan(0.5);
  });

  it('different player IDs get different hair styles', () => {
    const p1 = makePlayer('alpha');
    const p2 = makePlayer('beta');
    const p3 = makePlayer('gamma');
    const p4 = makePlayer('delta');
    const hair1 = p1.group.getObjectByName('hair')!;
    const hair2 = p2.group.getObjectByName('hair')!;
    const hair3 = p3.group.getObjectByName('hair')!;
    const hair4 = p4.group.getObjectByName('hair')!;
    // At least some should be geometrically different (different hair styles)
    const types = new Set([
      hair1.constructor.name + (hair1 as THREE.Mesh).geometry.type,
      hair2.constructor.name + (hair2 as THREE.Mesh).geometry.type,
      hair3.constructor.name + (hair3 as THREE.Mesh).geometry.type,
      hair4.constructor.name + (hair4 as THREE.Mesh).geometry.type,
    ]);
    // With 4 styles and varied IDs, we should get at least 2 distinct
    expect(types.size).toBeGreaterThanOrEqual(2);
  });
});

describe('GamePlayer - ball handling', () => {
  it('tracks hasBall state', () => {
    const player = makePlayer();
    expect(player.hasBall).toBe(false);
    player.giveBall();
    expect(player.hasBall).toBe(true);
    player.loseBall();
    expect(player.hasBall).toBe(false);
  });

  it('moveByInput moves player directly from joystick input', () => {
    const player = makePlayer();
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

describe('GamePlayer - animation & indicators', () => {
  it('possession ring is visible only when holding ball', () => {
    const player = makePlayer();
    player.animate(1 / 60);
    const ring = player.group.getObjectByName('possession-ring')!;
    expect(ring.visible).toBe(false);

    player.giveBall();
    player.animate(1 / 60);
    expect(ring.visible).toBe(true);

    player.loseBall();
    player.animate(1 / 60);
    expect(ring.visible).toBe(false);
  });

  it('player indicator is visible only for human-controlled player', () => {
    const player = makePlayer();
    player.animate(1 / 60);
    const indicator = player.group.getObjectByName('player-indicator')!;
    expect(indicator.visible).toBe(false);

    player.isHumanControlled = true;
    player.animate(1 / 60);
    expect(indicator.visible).toBe(true);
  });

  it('animate can be called repeatedly without errors', () => {
    const player = makePlayer();
    player.giveBall();
    player.isHumanControlled = true;
    // Simulate 60 frames
    for (let i = 0; i < 60; i++) {
      player.animate(1 / 60);
    }
    // Should not throw
    expect(player.group.getObjectByName('possession-ring')!.visible).toBe(true);
  });

  it('moveToward calls animate automatically', () => {
    const player = makePlayer();
    player.giveBall();
    player.moveToward(new THREE.Vector3(10, 0, 0), 1 / 60);
    // Possession ring should be updated by animate called inside moveToward
    const ring = player.group.getObjectByName('possession-ring')!;
    expect(ring.visible).toBe(true);
  });

  it('moveByInput calls animate automatically', () => {
    const player = makePlayer();
    player.giveBall();
    player.moveByInput(1, 0, 1 / 60);
    const ring = player.group.getObjectByName('possession-ring')!;
    expect(ring.visible).toBe(true);
  });
});
