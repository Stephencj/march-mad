import { describe, it, expect } from 'vitest';
import { Ball } from '@/game/ball';
import * as THREE from 'three';

describe('Ball', () => {
  it('creates mesh at given position', () => {
    const ball = new Ball(new THREE.Vector3(1, 2, 3));
    expect(ball.mesh).toBeInstanceOf(THREE.Mesh);
    expect(ball.mesh.position.x).toBeCloseTo(1);
    expect(ball.mesh.position.y).toBeCloseTo(2);
    expect(ball.mesh.position.z).toBeCloseTo(3);
  });

  it('has basketball-colored material', () => {
    const ball = new Ball();
    const mat = ball.mesh.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHex()).toBe(0xff6600);
  });

  it('calculates shooting arc trajectory', () => {
    const ball = new Ball();
    const arc = ball.calculateArc(
      new THREE.Vector3(0, 1, 5),
      new THREE.Vector3(0, 3.05, -6),
      0.7
    );
    expect(arc.length).toBeGreaterThan(0);
    const maxY = Math.max(...arc.map(p => p.y));
    expect(maxY).toBeGreaterThan(3.05);
  });

  it('tracks possession state', () => {
    const ball = new Ball();
    expect(ball.heldBy).toBeNull();
    ball.pickup('player-1');
    expect(ball.heldBy).toBe('player-1');
    ball.release();
    expect(ball.heldBy).toBeNull();
  });
});
