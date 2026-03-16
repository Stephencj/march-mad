import * as THREE from 'three';
import type { PlayerData } from '@/core/types';

export class GamePlayer {
  group: THREE.Group;
  data: PlayerData;
  private stats = { points: 0, assists: 0, turnovers: 0 };
  private moveSpeed: number;

  constructor(data: PlayerData, position: THREE.Vector3, teamColor: number) {
    this.data = data;
    this.moveSpeed = 3 + data.stats.speed * 0.5;
    this.group = this.createMesh(teamColor);
    this.group.position.copy(position);
    this.group.name = `player-${data.id}`;
  }

  private createMesh(color: number): THREE.Group {
    const group = new THREE.Group();

    const bodyGeo = new THREE.CylinderGeometry(0.25, 0.2, 1.0, 6);
    const bodyMat = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.8;
    body.name = 'body';
    group.add(body);

    const headGeo = new THREE.SphereGeometry(0.15, 6, 4);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf4c078 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.45;
    head.name = 'head';
    group.add(head);

    const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.5, 4);
    const legMat = new THREE.MeshStandardMaterial({ color });
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.1, 0.25, 0);
    group.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.1, 0.25, 0);
    group.add(rightLeg);

    return group;
  }

  moveToward(target: THREE.Vector3, dt: number): void {
    const direction = new THREE.Vector3().subVectors(target, this.group.position);
    direction.y = 0;
    const distance = direction.length();
    if (distance < 0.1) return;

    direction.normalize();
    const step = this.moveSpeed * dt;
    const actualStep = Math.min(step, distance);
    this.group.position.addScaledVector(direction, actualStep);

    const angle = Math.atan2(-direction.x, -direction.z);
    this.group.rotation.y = angle;
  }

  recordStat(stat: 'points' | 'assists' | 'turnovers', value: number): void {
    this.stats[stat] += value;
  }

  get performanceScore(): number {
    return this.stats.points + this.stats.assists - this.stats.turnovers;
  }

  resetStats(): void {
    this.stats = { points: 0, assists: 0, turnovers: 0 };
  }
}
