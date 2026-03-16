import * as THREE from 'three';

export const COURT_DIMENSIONS = {
  width: 15,
  length: 14,
  threePointRadius: 6.75,
  hoopPosition: new THREE.Vector3(0, 3.05, -6),
  checkBallLine: 5,
};

export function createCourt(): THREE.Group {
  const group = new THREE.Group();

  // Floor
  const floorGeo = new THREE.PlaneGeometry(COURT_DIMENSIONS.width, COURT_DIMENSIONS.length);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xcd853f, roughness: 0.8 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor';
  group.add(floor);

  // Three-point arc
  const arcPoints: THREE.Vector3[] = [];
  const segments = 32;
  for (let i = 0; i <= segments; i++) {
    const angle = (Math.PI * i) / segments;
    arcPoints.push(new THREE.Vector3(
      Math.cos(angle) * COURT_DIMENSIONS.threePointRadius,
      0.01,
      COURT_DIMENSIONS.hoopPosition.z + Math.sin(angle) * COURT_DIMENSIONS.threePointRadius
    ));
  }
  const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
  const arcMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const arc = new THREE.Line(arcGeo, arcMat);
  arc.name = 'three-point-arc';
  group.add(arc);

  // Backboard
  const backboardGeo = new THREE.BoxGeometry(1.8, 1.05, 0.05);
  const backboardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
  const backboard = new THREE.Mesh(backboardGeo, backboardMat);
  backboard.position.set(COURT_DIMENSIONS.hoopPosition.x, COURT_DIMENSIONS.hoopPosition.y + 0.3, COURT_DIMENSIONS.hoopPosition.z - 0.15);
  backboard.name = 'backboard';
  group.add(backboard);

  // Hoop
  const hoopGeo = new THREE.TorusGeometry(0.23, 0.02, 8, 16);
  const hoopMat = new THREE.MeshStandardMaterial({ color: 0xff4500 });
  const hoop = new THREE.Mesh(hoopGeo, hoopMat);
  hoop.rotation.x = -Math.PI / 2;
  hoop.position.copy(COURT_DIMENSIONS.hoopPosition);
  hoop.name = 'hoop';
  group.add(hoop);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  ambient.name = 'ambient-light';
  group.add(ambient);
  const spot = new THREE.DirectionalLight(0xffffff, 0.8);
  spot.position.set(5, 15, 5);
  spot.name = 'main-light';
  group.add(spot);

  return group;
}
