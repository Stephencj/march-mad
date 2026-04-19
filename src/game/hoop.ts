import * as THREE from 'three';
import { levelConfig } from '@/dev/level-config';

export function createHoop(position: THREE.Vector3, teamColor: number): THREE.Group {
  const group = new THREE.Group();
  // Position the GROUP, all children are RELATIVE to group origin (0,0,0)
  group.position.copy(position);

  const poleMat = new THREE.MeshStandardMaterial({ color: teamColor });
  const bbW = levelConfig.hoop.backboardWidth;
  const bbH = levelConfig.hoop.backboardHeight;
  const rimR = levelConfig.hoop.rimRadius;

  // Chunky pole — extends from floor up to rim height
  const poleHeight = position.y + 0.5;
  const poleGeo = new THREE.CylinderGeometry(0.15, 0.18, poleHeight, 8);
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(0, -position.y + poleHeight / 2, -0.6); // relative to group
  pole.name = 'pole';
  group.add(pole);

  // Wide base disc
  const baseGeo = new THREE.CylinderGeometry(0.6, 0.65, 0.1, 12);
  const base = new THREE.Mesh(baseGeo, poleMat);
  base.position.set(0, -position.y + 0.05, -0.6);
  base.name = 'pole-base';
  group.add(base);

  // Backboard
  const bbGeo = new THREE.BoxGeometry(bbW, bbH, 0.06);
  const bbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
  const backboard = new THREE.Mesh(bbGeo, bbMat);
  backboard.position.set(0, 0.45, -0.2); // relative to rim height
  backboard.name = 'backboard';
  group.add(backboard);

  // Backboard frame (4 colored edges)
  const frameMat = new THREE.MeshStandardMaterial({ color: teamColor });
  const frameThick = 0.08;
  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(bbW + frameThick * 2, frameThick, frameThick), frameMat);
  frameTop.position.set(0, 0.45 + bbH / 2, -0.2);
  frameTop.name = 'frame-top';
  group.add(frameTop);
  const frameBot = frameTop.clone();
  frameBot.position.y = 0.45 - bbH / 2;
  frameBot.name = 'frame-bottom';
  group.add(frameBot);
  const frameSide = new THREE.Mesh(new THREE.BoxGeometry(frameThick, bbH, frameThick), frameMat);
  frameSide.position.set(-bbW / 2, 0.45, -0.2);
  frameSide.name = 'frame-left';
  group.add(frameSide);
  const frameRight = frameSide.clone();
  frameRight.position.x = bbW / 2;
  frameRight.name = 'frame-right';
  group.add(frameRight);

  // Rim — at group origin (0,0,0)
  const rimGeo = new THREE.TorusGeometry(rimR, 0.04, 8, 16);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xff4500 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(0, 0, 0); // at group origin
  rim.name = 'rim';
  group.add(rim);

  // Net (inverted cone below rim)
  const netGeo = new THREE.ConeGeometry(rimR, 0.45, 12, 1, true);
  const netMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.4,
    side: THREE.DoubleSide, wireframe: true,
  });
  const net = new THREE.Mesh(netGeo, netMat);
  net.position.set(0, -0.25, 0);
  net.rotation.x = Math.PI;
  net.name = 'net';
  group.add(net);

  return group;
}
