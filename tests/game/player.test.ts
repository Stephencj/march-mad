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
  it('creates a mesh group with body parts accessible by name', () => {
    const player = makePlayer();
    expect(player.group).toBeInstanceOf(THREE.Group);
    // Nested hierarchy: direct children are body-pivot, possession-ring, player-indicator
    // All body parts should be findable via getObjectByName
    const expectedParts = [
      'body-pivot', 'torso', 'neck', 'head',
      'eye-left', 'eye-right', 'hair',
      'shoulder-left', 'shoulder-right',
      'upper-arm-left', 'upper-arm-right',
      'elbow-left', 'elbow-right',
      'forearm-left', 'forearm-right',
      'hip-left', 'hip-right',
      'upper-leg-left', 'upper-leg-right',
      'knee-left', 'knee-right',
      'lower-leg-left', 'lower-leg-right',
      'ankle-left', 'ankle-right',
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
    const expectedFacing = new THREE.Vector3(0, 0, -1);
    // In Three.js, default forward is +Z; apply quaternion to get actual facing
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(player.group.quaternion);
    expect(facing.dot(expectedFacing)).toBeGreaterThan(0.5);
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

describe('GamePlayer - position scaling', () => {
  it('applies position scaling for Center', () => {
    const player = new GamePlayer({
      id: 'c1', name: 'Big Man', stats: createDefaultPlayerStats(),
      personality: 'Lockdown', isCustom: false, position: 'C',
    }, new THREE.Vector3(0, 0, 0), 0xff0000);
    expect(player.group.scale.y).toBeCloseTo(1.2, 1);
  });
});

describe('GamePlayer - new animation triggers', () => {
  it('jump sets isJumping to true', () => {
    const player = makePlayer();
    expect(player.isJumping).toBe(false);
    player.jump();
    expect(player.isJumping).toBe(true);
  });

  it('jump does not double-trigger while already jumping', () => {
    const player = makePlayer();
    player.jump();
    expect(player.isJumping).toBe(true);
    // Simulate some frames
    player.animate(0.1);
    player.jump(); // should be ignored
    expect(player.isJumping).toBe(true);
  });

  it('triggerSteal sets steal timer', () => {
    const player = makePlayer();
    player.triggerSteal();
    // Animate should pick up steal state
    player.animate(1 / 60);
    // After one frame the steal timer should still be active (0.3 - 1/60 > 0)
    expect(player.group.getObjectByName('body-pivot')!.rotation.x).toBeGreaterThan(0);
  });

  it('triggerShoot sets shoot timer', () => {
    const player = makePlayer();
    player.triggerShoot();
    player.animate(1 / 60);
    // Shoot animation should be active
    const shoulderL = player.group.getObjectByName('shoulder-left')!;
    // During shoot, shoulders rotate negatively (arms push up)
    expect(shoulderL.rotation.x).toBeLessThan(0);
  });

  it('jump animation completes and resets isJumping', () => {
    const player = makePlayer();
    player.jump();
    // Simulate enough time for the jump to complete (0.6s)
    for (let i = 0; i < 40; i++) {
      player.animate(1 / 60); // 40 * 1/60 = 0.667s > 0.6s
    }
    expect(player.isJumping).toBe(false);
    // After jump completes, idle bob may shift y slightly from 0
    expect(Math.abs(player.group.position.y)).toBeLessThan(0.1);
  });
});
