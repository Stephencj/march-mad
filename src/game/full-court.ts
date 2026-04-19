import * as THREE from 'three';
import { createHoop } from './hoop';
import { levelConfig } from '@/dev/level-config';

/**
 * Live getter facade backed by `levelConfig`. Reads return fresh values each
 * access, so edits in the dev overlay / level editor take effect on the next
 * court build without any cache invalidation.
 *
 * `hoopHome` / `hoopAway` return a **new** Vector3 per call — callers that
 * mutate the vector (or expect identity equality) should `.clone()` explicitly
 * if needed; existing callers (`game-session.ts`) already do.
 */
export const FULL_COURT_DIMENSIONS = {
  get width() { return levelConfig.court.width; },
  get length() { return levelConfig.court.length; },
  get threePointRadius() { return levelConfig.court.threePointRadius; },
  get hoopHome() { return new THREE.Vector3(0, levelConfig.hoop.rimHeight, levelConfig.hoop.homeZ); },
  get hoopAway() { return new THREE.Vector3(0, levelConfig.hoop.rimHeight, levelConfig.hoop.awayZ); },
  get paintWidth() { return levelConfig.court.paintWidth; },
  get paintLength() { return levelConfig.court.paintLength; },
  get centerCircleRadius() { return levelConfig.court.centerCircleRadius; },
  get checkBallLine() { return levelConfig.court.checkBallLine; },
} as const;

export function createFullCourt(homeColor: number, awayColor: number): THREE.Group {
  const group = new THREE.Group();
  const D = FULL_COURT_DIMENSIONS;
  const lineHeight = levelConfig.court.lineHeight;
  const lineMat = new THREE.MeshStandardMaterial({ color: levelConfig.colors.line });

  // ---- FLOOR ----
  const floorGeo = new THREE.PlaneGeometry(D.width, D.length);
  const floorMat = new THREE.MeshStandardMaterial({ color: levelConfig.colors.floor, roughness: 0.8 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor';
  group.add(floor);

  // Plank lines (subtle darker stripes)
  const stripeSpacing = levelConfig.court.plankStripeSpacing;
  for (let x = -D.width / 2; x <= D.width / 2; x += stripeSpacing) {
    const plankGeo = new THREE.BoxGeometry(0.01, 0.001, D.length);
    const plankMat = new THREE.MeshStandardMaterial({ color: levelConfig.colors.plankStripe });
    const plank = new THREE.Mesh(plankGeo, plankMat);
    plank.position.set(x, 0.001, 0);
    group.add(plank);
  }

  // ---- CENTER LINE ----
  const clGeo = new THREE.BoxGeometry(D.width, lineHeight, 0.08);
  const centerLine = new THREE.Mesh(clGeo, lineMat);
  centerLine.position.set(0, lineHeight / 2, 0);
  centerLine.name = 'center-line';
  group.add(centerLine);

  // ---- CENTER CIRCLE ----
  const ccPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const angle = (Math.PI * 2 * i) / 64;
    ccPoints.push(new THREE.Vector3(
      Math.cos(angle) * D.centerCircleRadius,
      lineHeight,
      Math.sin(angle) * D.centerCircleRadius
    ));
  }
  const ccGeo = new THREE.BufferGeometry().setFromPoints(ccPoints);
  const ccLine = new THREE.Line(ccGeo, new THREE.LineBasicMaterial({ color: levelConfig.colors.line }));
  ccLine.name = 'center-circle';
  group.add(ccLine);

  // ---- CENTER LOGO (colored circle) ----
  const logoGeo = new THREE.CircleGeometry(1.2, 24);
  const logoMat = new THREE.MeshStandardMaterial({ color: homeColor, transparent: true, opacity: 0.4 });
  const logo = new THREE.Mesh(logoGeo, logoMat);
  logo.rotation.x = -Math.PI / 2;
  logo.position.set(0, 0.003, 0);
  logo.name = 'center-logo';
  group.add(logo);

  // ---- SIDELINES & BASELINES ----
  const addLine = (name: string, x1: number, z1: number, x2: number, z2: number) => {
    const dx = x2 - x1; const dz = z2 - z1;
    const geo = new THREE.BoxGeometry(Math.abs(dx) || 0.08, lineHeight, Math.abs(dz) || 0.08);
    const line = new THREE.Mesh(geo, lineMat);
    line.position.set((x1 + x2) / 2, lineHeight / 2, (z1 + z2) / 2);
    line.name = name;
    group.add(line);
  };

  addLine('sideline-left', -D.width / 2, -D.length / 2, -D.width / 2, D.length / 2);
  addLine('sideline-right', D.width / 2, -D.length / 2, D.width / 2, D.length / 2);
  addLine('baseline-home', -D.width / 2, -D.length / 2, D.width / 2, -D.length / 2);
  addLine('baseline-away', -D.width / 2, D.length / 2, D.width / 2, D.length / 2);

  // ---- THREE-POINT ARCS + PAINT for each end ----
  const ends: { suffix: string; hoopZ: number; dir: number; color: number }[] = [
    { suffix: 'home', hoopZ: levelConfig.hoop.homeZ, dir: 1, color: homeColor },
    { suffix: 'away', hoopZ: levelConfig.hoop.awayZ, dir: -1, color: awayColor },
  ];

  for (const end of ends) {
    // Three-point arc
    const arcPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 32; i++) {
      const angle = (Math.PI * i) / 32;
      arcPoints.push(new THREE.Vector3(
        Math.cos(angle) * D.threePointRadius,
        lineHeight,
        end.hoopZ + Math.sin(angle) * D.threePointRadius * end.dir
      ));
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const arc = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({ color: levelConfig.colors.line }));
    arc.name = `three-point-arc-${end.suffix}`;
    group.add(arc);

    // Paint area
    const paintGeo = new THREE.PlaneGeometry(D.paintWidth, D.paintLength);
    const paintMat = new THREE.MeshStandardMaterial({
      color: end.color, transparent: true, opacity: 0.3,
    });
    const paint = new THREE.Mesh(paintGeo, paintMat);
    paint.rotation.x = -Math.PI / 2;
    paint.position.set(0, 0.005, end.hoopZ + (D.paintLength / 2) * end.dir);
    paint.name = `paint-${end.suffix}`;
    group.add(paint);

    // Free throw line
    const ftGeo = new THREE.BoxGeometry(D.paintWidth, lineHeight, 0.08);
    const ft = new THREE.Mesh(ftGeo, lineMat);
    ft.position.set(0, lineHeight / 2, end.hoopZ + D.paintLength * end.dir);
    ft.name = `free-throw-${end.suffix}`;
    group.add(ft);

    // Free throw circle
    const ftCirclePoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const angle = (Math.PI * 2 * i) / 64;
      ftCirclePoints.push(new THREE.Vector3(
        Math.cos(angle) * D.centerCircleRadius,
        lineHeight,
        end.hoopZ + D.paintLength * end.dir + Math.sin(angle) * D.centerCircleRadius
      ));
    }
    const ftCircleGeo = new THREE.BufferGeometry().setFromPoints(ftCirclePoints);
    const ftCircle = new THREE.Line(ftCircleGeo, new THREE.LineBasicMaterial({ color: levelConfig.colors.line }));
    ftCircle.name = `free-throw-circle-${end.suffix}`;
    group.add(ftCircle);

    // Hoop
    const hoop = createHoop(
      new THREE.Vector3(0, levelConfig.hoop.rimHeight, end.hoopZ),
      end.color
    );
    hoop.name = `hoop-${end.suffix}`;
    // Away hoop faces the other direction so backboard is behind the rim
    if (end.suffix === 'away') {
      hoop.rotation.y = Math.PI;
    }
    group.add(hoop);
  }

  // ---- LIGHTING ----
  const ambient = new THREE.AmbientLight(0xffffff, levelConfig.lighting.ambientIntensity);
  ambient.name = 'ambient-light';
  group.add(ambient);
  const mainLight = new THREE.DirectionalLight(0xffffff, levelConfig.lighting.directionalIntensity);
  mainLight.position.set(
    levelConfig.lighting.directionalX,
    levelConfig.lighting.directionalY,
    levelConfig.lighting.directionalZ,
  );
  mainLight.name = 'main-light';
  group.add(mainLight);

  return group;
}
