import { describe, it, expect } from 'vitest';
import { CameraSystem, type CameraMode } from '@/game/camera';
import * as THREE from 'three';

describe('CameraSystem', () => {
  const cam = new THREE.PerspectiveCamera();

  it('starts in spectator mode', () => {
    const cs = new CameraSystem(cam);
    expect(cs.currentMode).toBe('spectator');
  });

  it('sets offense cam position behind the ball handler', () => {
    const cs = new CameraSystem(cam);
    cs.setMode('offense');
    cs.update(new THREE.Vector3(2, 0, 3), new THREE.Vector3(0, 3, -6), 1 / 60);
    expect(cam.position.z).toBeGreaterThan(3);
    expect(cam.position.y).toBeGreaterThan(0);
  });

  it('sets defense cam wider and higher', () => {
    const cs = new CameraSystem(cam);
    cs.setMode('defense');
    cs.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, -6), 1 / 60);
    expect(cam.position.y).toBeGreaterThan(5);
  });

  it('transitions between modes', () => {
    const cs = new CameraSystem(cam);
    cs.setMode('offense');
    cs.update(new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 3, -6), 1 / 60);
    cs.setMode('defense');
    cs.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, -6), 1 / 60);
    expect(cs.currentMode).toBe('defense');
  });

  it('slam cam activates and auto-reverts', () => {
    const cs = new CameraSystem(cam);
    cs.setMode('offense');
    cs.triggerSlamCam(new THREE.Vector3(0, 3, -6));
    expect(cs.currentMode).toBe('slam');
    for (let i = 0; i < 180; i++) {
      cs.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, -6), 1 / 60);
    }
    expect(cs.currentMode).not.toBe('slam');
  });
});
