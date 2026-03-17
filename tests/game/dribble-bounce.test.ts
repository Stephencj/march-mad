import { describe, it, expect } from 'vitest';
import { Ball } from '@/game/ball';
import { GamePlayer } from '@/game/player';
import { createDefaultPlayerStats } from '@/core/types';
import * as THREE from 'three';

function makePlayer(id = 'test') {
  return new GamePlayer({
    id, name: 'Test',
    stats: createDefaultPlayerStats(),
    personality: 'Team Player' as const,
    isCustom: false,
  }, new THREE.Vector3(0, 0, 0), 0xff0000);
}

describe('Dribble bounce verification', () => {
  it('ball Y position varies between hand and floor over 120 frames', () => {
    const player = makePlayer();
    const ball = new Ball();
    ball.pickup('test');

    // Simulate 120 frames of dribble animation
    const yPositions: number[] = [];
    for (let i = 0; i < 120; i++) {
      // Set player to dribble state
      player.hasBall = true;
      player.velocity.set(0, 0, 0); // stationary dribble
      player.animate(1/60);

      // Call followHolder with isDribbling=true and player's dribblePhase
      ball.followHolder(player.group, true, player.dribblePhase);

      yPositions.push(ball.mesh.position.y);
    }

    // Print positions for debugging
    const minY = Math.min(...yPositions);
    const maxY = Math.max(...yPositions);
    console.log(`Ball Y range: min=${minY.toFixed(3)}, max=${maxY.toFixed(3)}, range=${(maxY-minY).toFixed(3)}`);
    console.log(`First 30 Y positions: ${yPositions.slice(0, 30).map(y => y.toFixed(3)).join(', ')}`);

    // Ball MUST reach near the floor (below 0.5) at some point
    expect(minY).toBeLessThan(0.5);
    // Ball MUST reach hand height (above 0.5) at some point
    expect(maxY).toBeGreaterThan(0.5);
    // The range between min and max must be significant (at least 0.3)
    expect(maxY - minY).toBeGreaterThan(0.3);
  });

  it('pickup by same player does not disrupt bounce continuity', () => {
    // Two balls: one with pickup called every frame (viewer pattern),
    // one with pickup called only once. Both should produce the same bounce.
    const player = makePlayer();
    player.hasBall = true;
    player.velocity.set(0, 0, 0);

    const ballA = new Ball();
    ballA.pickup('test');

    const ballB = new Ball();
    ballB.pickup('test');

    const yA: number[] = [];
    const yB: number[] = [];

    for (let i = 0; i < 120; i++) {
      player.animate(1/60);

      // Ball A: pickup called every frame (like the viewer)
      ballA.pickup('test');
      ballA.followHolder(player.group, true, player.dribblePhase);
      yA.push(ballA.mesh.position.y);

      // Ball B: pickup called once (like the game)
      ballB.followHolder(player.group, true, player.dribblePhase);
      yB.push(ballB.mesh.position.y);
    }

    // Both should have the same Y values since pickup('test') is idempotent
    for (let i = 0; i < 120; i++) {
      expect(yA[i]).toBeCloseTo(yB[i], 4);
    }

    // And both should show a bounce (reuse main test criteria)
    const minA = Math.min(...yA);
    const maxA = Math.max(...yA);
    console.log(`Same-player pickup: min=${minA.toFixed(3)}, max=${maxA.toFixed(3)}, range=${(maxA-minA).toFixed(3)}`);
    expect(maxA - minA).toBeGreaterThan(0.3);
  });

  it('viewer pattern: calling pickup every frame still bounces (idempotent pickup)', () => {
    const player = makePlayer();
    const ball = new Ball();

    // Simulate exactly what anim-viewer.ts does: pickup('viewer') every frame
    const yPositions: number[] = [];
    for (let i = 0; i < 120; i++) {
      player.hasBall = true;
      player.velocity.set(0, 0, 0);
      player.animate(1/60);

      ball.pickup('test'); // called every frame, like the viewer does
      ball.followHolder(player.group, true, player.dribblePhase);

      yPositions.push(ball.mesh.position.y);
    }

    const minY = Math.min(...yPositions);
    const maxY = Math.max(...yPositions);
    console.log(`Viewer pattern Y range: min=${minY.toFixed(3)}, max=${maxY.toFixed(3)}, range=${(maxY-minY).toFixed(3)}`);
    console.log(`First 30 Y: ${yPositions.slice(0, 30).map(y => y.toFixed(3)).join(', ')}`);

    // Same criteria as the main test
    expect(minY).toBeLessThan(0.5);
    expect(maxY).toBeGreaterThan(0.5);
    expect(maxY - minY).toBeGreaterThan(0.3);
  });
});
