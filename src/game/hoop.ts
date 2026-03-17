import * as THREE from 'three';

export function createHoop(position: THREE.Vector3, teamColor: number): THREE.Group {
  const group = new THREE.Group();

  // Chunky pole
  const poleGeo = new THREE.CylinderGeometry(0.15, 0.18, position.y + 0.5, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: teamColor });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(position.x, (position.y + 0.5) / 2, position.z - 0.6);
  pole.name = 'pole';
  group.add(pole);

  // Wide base disc
  const baseGeo = new THREE.CylinderGeometry(0.6, 0.65, 0.1, 12);
  const base = new THREE.Mesh(baseGeo, poleMat);
  base.position.set(position.x, 0.05, position.z - 0.6);
  base.name = 'pole-base';
  group.add(base);

  // Oversized backboard (1.5x: 2.7 × 1.58)
  const bbGeo = new THREE.BoxGeometry(2.7, 1.58, 0.06);
  const bbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
  const backboard = new THREE.Mesh(bbGeo, bbMat);
  backboard.position.set(position.x, position.y + 0.45, position.z - 0.2);
  backboard.name = 'backboard';
  group.add(backboard);

  // Backboard frame (4 colored edges)
  const frameMat = new THREE.MeshStandardMaterial({ color: teamColor });
  const frameThick = 0.08;
  // Top
  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(2.7 + frameThick * 2, frameThick, frameThick), frameMat);
  frameTop.position.set(position.x, position.y + 0.45 + 1.58 / 2, position.z - 0.2);
  frameTop.name = 'frame-top';
  group.add(frameTop);
  // Bottom
  const frameBot = frameTop.clone();
  frameBot.position.y = position.y + 0.45 - 1.58 / 2;
  frameBot.name = 'frame-bottom';
  group.add(frameBot);
  // Left
  const frameSide = new THREE.Mesh(new THREE.BoxGeometry(frameThick, 1.58, frameThick), frameMat);
  frameSide.position.set(position.x - 2.7 / 2, position.y + 0.45, position.z - 0.2);
  frameSide.name = 'frame-left';
  group.add(frameSide);
  // Right
  const frameRight = frameSide.clone();
  frameRight.position.x = position.x + 2.7 / 2;
  frameRight.name = 'frame-right';
  group.add(frameRight);

  // Oversized rim (radius 0.35)
  const rimGeo = new THREE.TorusGeometry(0.35, 0.04, 8, 16);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xff4500 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.copy(position);
  rim.name = 'rim';
  group.add(rim);

  // Net (inverted cone)
  const netGeo = new THREE.ConeGeometry(0.35, 0.45, 12, 1, true);
  const netMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.4,
    side: THREE.DoubleSide, wireframe: true,
  });
  const net = new THREE.Mesh(netGeo, netMat);
  net.position.set(position.x, position.y - 0.25, position.z);
  net.rotation.x = Math.PI; // flip cone upside down
  net.name = 'net';
  group.add(net);

  return group;
}
