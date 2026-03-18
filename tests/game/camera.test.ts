import { describe, it, expect } from 'vitest';
import { CameraSystem, type CameraMode } from '@/game/camera';
import * as THREE from 'three';

describe('CameraSystem', () => {
  const makeCam = () => new THREE.PerspectiveCamera();

  it('starts in broadcast mode', () => {
    const cs = new CameraSystem(makeCam());
    expect(cs.currentMode).toBe('broadcast');
  });

  it('camera X uses dynamic zoom based on player spread (half court)', () => {
    const cam = makeCam();
    const cs = new CameraSystem(cam);
    cs.fullCourt = false;
    // Default spread (28/15) gives spreadFactor ≥ 1 → dynamicDist=16
    cs.update(new THREE.Vector3(2, 0, 3), new THREE.Vector3(0, 3, -6), 1 / 60);
    expect(cam.position.x).toBe(16);

    // Tight spread → closer zoom target; lerp moves camera toward it
    cs.setPlayerBounds(0, 5, -2, 2);
    // Run many frames so lerp converges
    for (let i = 0; i < 300; i++) {
      cs.update(new THREE.Vector3(2, 0, 3), new THREE.Vector3(0, 3, -6), 1 / 60);
    }
    // spreadFactor = max(5/20, 4/12) ≈ 0.333 → dynamicDist ≈ 10.67
    expect(cam.position.x).toBeGreaterThan(9);
    expect(cam.position.x).toBeLessThan(12);
  });

  it('camera X uses dynamic zoom based on player spread (full court)', () => {
    const cam = makeCam();
    const cs = new CameraSystem(cam);
    cs.fullCourt = true;
    // Default spread → dynamicDist=16
    cs.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, -6), 1 / 60);
    expect(cam.position.x).toBe(16);
  });

  it('camera Z follows trackPosition.z', () => {
    const cam = makeCam();
    const cs = new CameraSystem(cam);
    // First update snaps to position
    cs.update(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 3, -6), 1 / 60);
    expect(cam.position.z).toBe(5);

    // Move track position — after several frames, camera Z approaches new target
    for (let i = 0; i < 120; i++) {
      cs.update(new THREE.Vector3(0, 0, -3), new THREE.Vector3(0, 3, -6), 1 / 60);
    }
    expect(cam.position.z).toBeCloseTo(-3, 0);
  });

  it('camera Z is clamped to court bounds', () => {
    const cam = makeCam();
    const cs = new CameraSystem(cam);
    cs.fullCourt = false;
    // Track position way beyond half court Z bound (7)
    cs.update(new THREE.Vector3(0, 0, 50), new THREE.Vector3(0, 3, -6), 1 / 60);
    expect(cam.position.z).toBe(7);
  });

  it('camera height is proportional to dynamic distance', () => {
    const cam = makeCam();
    const cs = new CameraSystem(cam);
    cs.fullCourt = false;
    // Default spread → dynamicDist=16 → height=16*0.6=9.6
    cs.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, -6), 1 / 60);
    expect(cam.position.y).toBeCloseTo(9.6, 1);
  });

  it('slam cam activates and auto-reverts to broadcast', () => {
    const cam = makeCam();
    const cs = new CameraSystem(cam);
    cs.setMode('broadcast');
    cs.triggerSlamCam(new THREE.Vector3(0, 3, -6));
    expect(cs.currentMode).toBe('slam');

    // Run 180 frames at 60fps = 3 seconds > SLAM_DURATION (2.5s)
    for (let i = 0; i < 180; i++) {
      cs.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, -6), 1 / 60);
    }
    expect(cs.currentMode).toBe('broadcast');
  });

  it('transitions between modes', () => {
    const cs = new CameraSystem(makeCam());
    cs.setMode('broadcast');
    expect(cs.currentMode).toBe('broadcast');
    cs.setMode('spectator');
    expect(cs.currentMode).toBe('spectator');
  });
});
