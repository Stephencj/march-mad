import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createFullCourt } from './game/full-court';
import { GamePlayer } from './game/player';
import { Ball } from './game/ball';
import { createDefaultPlayerStats } from './core/types';
import { AnimLoop, type AnimId } from './dev/anim-loop';
import {
  levelConfig,
  resetLevel,
  serializeLevel,
  applyLevelJSON,
  getDefaults,
} from './dev/level-config';
import { serializeBalance, applyBalanceJSON, resetBalance } from './dev/balance-config';
import { serializePlayer, applyPlayerJSON, resetPlayer } from './dev/player-config';
import { serializeAnim, applyAnimJSON, resetAnim } from './dev/anim-config';
import { persistDetails, detailsKey } from './dev/details-state';

const DEVPANEL_PREFIX = 'devpanel:level-editor';

const HOME_COLOR = 0xe94560;
const AWAY_COLOR = 0x3498db;

// --- Renderer / Scene / Camera ---
const canvas = document.getElementById('editor-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(0, 25, 30);
camera.lookAt(0, 0, 0);

function resize(): void {
  const wrap = document.getElementById('canvas-wrap')!;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.maxPolarAngle = Math.PI * 0.49; // prevent going under the floor

// --- Court (re-rendered on each edit) ---
let currentCourt: THREE.Group = createFullCourt(HOME_COLOR, AWAY_COLOR);
scene.add(currentCourt);

function disposeCourt(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) (m as THREE.Material).dispose();
    }
  });
}

function rebuildCourt(): void {
  scene.remove(currentCourt);
  disposeCourt(currentCourt);
  currentCourt = createFullCourt(HOME_COLOR, AWAY_COLOR);
  scene.add(currentCourt);
}

// --- Preview players -------------------------------------------------------
// A handful of looping dummies scattered on the court so the user can gauge
// court scale while resizing. Positions are fixed in world-space so they
// deliberately fall out of bounds when the court shrinks — the point is to
// reveal the scale change.
//
// Each player drives an AnimLoop with a scripted state cycle. A single shared
// Ball is hidden off-screen; AnimLoop needs a Ball for dribble/shoot props,
// but sharing one is fine because our script never triggers shoot/dunk/pass
// (only dribble + walk-family, which pickup/followHolder mutate positions but
// don't need a unique ball per player).
//
// Dispose pattern mirrors anim-viewer.ts's `disposePlayerGroup`.
function disposePlayerGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) (m as THREE.Material).dispose();
    }
  });
}

interface PreviewPlayer {
  gp: GamePlayer;
  loop: AnimLoop;
  basePos: THREE.Vector3;   // world-space position the player stands at
  cycle: AnimId[];          // rotation of anims
  cycleInterval: number;    // seconds between state swaps
  cycleTimer: number;       // counts up each tick, wraps at cycleInterval
  cycleIndex: number;       // current index into `cycle`
}

const previewPlayers: PreviewPlayer[] = [];
// Shared ball kept hidden — AnimLoop references it for dribble/shoot logic but
// our preview choreo (dribble / walk / sprint / shoot) either hides or reuses it.
const previewBall = new Ball(new THREE.Vector3(0, -10, 0));
previewBall.mesh.visible = false;
scene.add(previewBall.mesh);

function makePreviewPlayer(
  id: string,
  teamColor: number,
  basePos: THREE.Vector3,
  initialAnim: AnimId,
  cycle: AnimId[],
  cycleInterval: number,
): PreviewPlayer {
  const gp = new GamePlayer({
    id,
    name: `Preview ${id}`,
    stats: createDefaultPlayerStats(),
    personality: 'Team Player',
    isCustom: false,
  } as any, new THREE.Vector3(0, 0, 0), teamColor);
  scene.add(gp.group);
  // AnimLoop pins the player to origin each tick, so position it via a parent
  // wrapper: move the GamePlayer.group's world position by offsetting after
  // each tick. Simplest is to re-set it post-tick (see animate()).
  const loop = new AnimLoop(gp, { ball: previewBall });
  loop.setAnim(initialAnim);
  return {
    gp,
    loop,
    basePos: basePos.clone(),
    cycle,
    cycleInterval,
    cycleTimer: 0,
    cycleIndex: 0,
  };
}

function spawnPreviewPlayers(): void {
  // Player A: stationary dribble near home hoop.
  previewPlayers.push(makePreviewPlayer(
    'preview-a', HOME_COLOR, new THREE.Vector3(0, 0, -2),
    'dribble', ['dribble'], 9999,
  ));
  // Player B: dribbles forward, takes a shot, repeat.
  previewPlayers.push(makePreviewPlayer(
    'preview-b', AWAY_COLOR, new THREE.Vector3(2, 0, 2),
    'dribble-walk', ['dribble-walk', 'shoot'], 4,
  ));
  // Player C: walk / sprint / walk — simulates a defender closing out.
  previewPlayers.push(makePreviewPlayer(
    'preview-c', 0x2ecc71, new THREE.Vector3(-3, 0, 0),
    'walk', ['walk', 'sprint', 'walk'], 3,
  ));
}
spawnPreviewPlayers();

function tickPreviewPlayers(dt: number): void {
  for (const pp of previewPlayers) {
    // Advance cycle timer — swap anim when it rolls past the interval.
    if (pp.cycle.length > 1) {
      pp.cycleTimer += dt;
      if (pp.cycleTimer >= pp.cycleInterval) {
        pp.cycleTimer = 0;
        pp.cycleIndex = (pp.cycleIndex + 1) % pp.cycle.length;
        pp.loop.setAnim(pp.cycle[pp.cycleIndex]);
      }
    }
    pp.loop.tick(dt);
    // AnimLoop.tick pins group.position.{x,z} to 0 (it expects a centered
    // viewer). For the editor, we want each preview to stand at its assigned
    // world-space spot. Re-apply the base position after the tick — y is
    // preserved to keep jump / dunk arcs intact.
    pp.gp.group.position.x = pp.basePos.x;
    pp.gp.group.position.z = pp.basePos.z;
  }
  // Keep the shared ball visually hidden regardless of what AnimLoop did.
  previewBall.mesh.visible = false;
}

function disposePreviewPlayers(): void {
  for (const pp of previewPlayers) {
    scene.remove(pp.gp.group);
    disposePlayerGroup(pp.gp.group);
  }
  previewPlayers.length = 0;
  scene.remove(previewBall.mesh);
  previewBall.mesh.geometry.dispose();
  const ballMat = previewBall.mesh.material as THREE.Material | THREE.Material[];
  if (Array.isArray(ballMat)) for (const m of ballMat) m.dispose();
  else ballMat.dispose();
}

function shufflePreviewPlayers(): void {
  for (const pp of previewPlayers) {
    pp.basePos.x = (Math.random() * 10) - 5;
    pp.basePos.z = (Math.random() * 10) - 5;
  }
}

window.addEventListener('beforeunload', disposePreviewPlayers);

// --- Animate loop ---
let previewLastTime = performance.now();
function animate(): void {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - previewLastTime) / 1000, 0.1);
  previewLastTime = now;
  tickPreviewPlayers(dt);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// --- Side panel ---
const panel = document.getElementById('panel')!;
buildPanel();

interface NumericFieldSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  defaultValue: number;
  warning?: string;
}

interface ColorFieldSpec {
  label: string;
  get: () => number;
  set: (v: number) => void;
  defaultValue: number;
}

interface SectionSpec {
  title: string;
  warning?: string;
  numerics?: NumericFieldSpec[];
  colors?: ColorFieldSpec[];
}

const allInputBindings: Array<{ kind: 'numeric'; spec: NumericFieldSpec; slider: HTMLInputElement; numeric: HTMLInputElement } |
  { kind: 'color'; spec: ColorFieldSpec; picker: HTMLInputElement }> = [];

function syncFromConfig(): void {
  for (const b of allInputBindings) {
    if (b.kind === 'numeric') {
      const v = b.spec.get();
      b.slider.value = String(v);
      b.numeric.value = String(v);
    } else {
      b.picker.value = numToHex(b.spec.get());
    }
  }
  rebuildCourt();
}

function numToHex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function hexToNum(s: string): number {
  return parseInt(s.replace('#', ''), 16);
}

function buildPanel(): void {
  panel.innerHTML = '';

  // Header
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '12px',
    paddingBottom: '12px',
    borderBottom: '1px solid #333',
  });

  const title = document.createElement('div');
  title.textContent = 'LEVEL EDITOR';
  Object.assign(title.style, {
    fontSize: '16px',
    fontWeight: 'bold',
    letterSpacing: '2px',
    color: '#e94560',
  });
  header.appendChild(title);

  const hint = document.createElement('div');
  hint.textContent = 'Edits rebuild the court live. Pan/zoom/orbit with mouse.';
  Object.assign(hint.style, { fontSize: '11px', color: '#888' });
  header.appendChild(hint);

  // "ALL CONFIGS" row — resets/exports/imports balance + level + player + anim
  // together. Placed ABOVE the domain-scoped row so the level-only buttons
  // remain the quick default.
  const allLabel = document.createElement('div');
  allLabel.textContent = 'ALL CONFIGS';
  Object.assign(allLabel.style, {
    fontSize: '10px', letterSpacing: '1.5px', color: '#888', marginTop: '4px',
  });
  header.appendChild(allLabel);

  const allRow = document.createElement('div');
  Object.assign(allRow.style, { display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' });
  allRow.appendChild(makeButton('Reset All', () => {
    resetBalance();
    resetLevel();
    resetPlayer();
    resetAnim();
    syncFromConfig();
  }));
  allRow.appendChild(makeButton('Export All', exportAllJSON));
  allRow.appendChild(makeButton('Import All', importAllJSON));
  header.appendChild(allRow);

  const buttonRow = document.createElement('div');
  Object.assign(buttonRow.style, { display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' });
  buttonRow.appendChild(makeButton('Reset', () => { resetLevel(); syncFromConfig(); }));
  buttonRow.appendChild(makeButton('Export JSON', exportJSON));
  buttonRow.appendChild(makeButton('Import JSON', importJSON));
  buttonRow.appendChild(makeButton('Export GLB', exportGLB));
  header.appendChild(buttonRow);

  // Preview-player controls — scatter the 3 dummy players around the court to
  // get a fresh sense of scale. Does not affect the choreo.
  const previewRow = document.createElement('div');
  Object.assign(previewRow.style, { display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' });
  previewRow.appendChild(makeButton('Shuffle Players', shufflePreviewPlayers));
  header.appendChild(previewRow);

  panel.appendChild(header);

  for (const section of buildSections()) {
    panel.appendChild(buildSection(section));
  }
}

function buildSections(): SectionSpec[] {
  const d = getDefaults();
  return [
    {
      title: 'COURT',
      numerics: [
        { label: 'Width ⚠️', min: 8, max: 24, step: 0.5, get: () => levelConfig.court.width, set: (v) => { levelConfig.court.width = v; }, defaultValue: d.court.width, warning: 'gameplay-coupled' },
        { label: 'Length ⚠️', min: 16, max: 40, step: 0.5, get: () => levelConfig.court.length, set: (v) => { levelConfig.court.length = v; }, defaultValue: d.court.length, warning: 'gameplay-coupled' },
        { label: 'Paint Width', min: 2, max: 6, step: 0.1, get: () => levelConfig.court.paintWidth, set: (v) => { levelConfig.court.paintWidth = v; }, defaultValue: d.court.paintWidth },
        { label: 'Paint Length', min: 3, max: 9, step: 0.1, get: () => levelConfig.court.paintLength, set: (v) => { levelConfig.court.paintLength = v; }, defaultValue: d.court.paintLength },
        { label: 'Three-Point Radius', min: 4, max: 10, step: 0.05, get: () => levelConfig.court.threePointRadius, set: (v) => { levelConfig.court.threePointRadius = v; }, defaultValue: d.court.threePointRadius },
        { label: 'Center Circle Radius', min: 0.5, max: 4, step: 0.1, get: () => levelConfig.court.centerCircleRadius, set: (v) => { levelConfig.court.centerCircleRadius = v; }, defaultValue: d.court.centerCircleRadius },
        { label: 'Check-Ball Line', min: 0, max: 12, step: 0.5, get: () => levelConfig.court.checkBallLine, set: (v) => { levelConfig.court.checkBallLine = v; }, defaultValue: d.court.checkBallLine },
        { label: 'Line Height', min: 0.005, max: 0.1, step: 0.005, get: () => levelConfig.court.lineHeight, set: (v) => { levelConfig.court.lineHeight = v; }, defaultValue: d.court.lineHeight },
        { label: 'Plank Stripe Spacing', min: 0.1, max: 2, step: 0.05, get: () => levelConfig.court.plankStripeSpacing, set: (v) => { levelConfig.court.plankStripeSpacing = v; }, defaultValue: d.court.plankStripeSpacing },
      ],
    },
    {
      title: 'HOOP',
      warning: '⚠️ All values gameplay-coupled — changes may break shot detection, AI, scoring',
      numerics: [
        { label: 'Home Z', min: -18, max: -6, step: 0.5, get: () => levelConfig.hoop.homeZ, set: (v) => { levelConfig.hoop.homeZ = v; }, defaultValue: d.hoop.homeZ, warning: 'gameplay-coupled' },
        { label: 'Away Z', min: 6, max: 18, step: 0.5, get: () => levelConfig.hoop.awayZ, set: (v) => { levelConfig.hoop.awayZ = v; }, defaultValue: d.hoop.awayZ, warning: 'gameplay-coupled' },
        { label: 'Rim Height', min: 2, max: 4, step: 0.05, get: () => levelConfig.hoop.rimHeight, set: (v) => { levelConfig.hoop.rimHeight = v; }, defaultValue: d.hoop.rimHeight, warning: 'gameplay-coupled' },
        { label: 'Rim Radius', min: 0.2, max: 0.6, step: 0.01, get: () => levelConfig.hoop.rimRadius, set: (v) => { levelConfig.hoop.rimRadius = v; }, defaultValue: d.hoop.rimRadius, warning: 'gameplay-coupled' },
        { label: 'Backboard Width', min: 1.5, max: 4, step: 0.05, get: () => levelConfig.hoop.backboardWidth, set: (v) => { levelConfig.hoop.backboardWidth = v; }, defaultValue: d.hoop.backboardWidth },
        { label: 'Backboard Height', min: 0.8, max: 2.5, step: 0.05, get: () => levelConfig.hoop.backboardHeight, set: (v) => { levelConfig.hoop.backboardHeight = v; }, defaultValue: d.hoop.backboardHeight },
      ],
    },
    {
      title: 'COLORS',
      colors: [
        { label: 'Floor', get: () => levelConfig.colors.floor, set: (v) => { levelConfig.colors.floor = v; }, defaultValue: d.colors.floor },
        { label: 'Plank Stripe', get: () => levelConfig.colors.plankStripe, set: (v) => { levelConfig.colors.plankStripe = v; }, defaultValue: d.colors.plankStripe },
        { label: 'Line', get: () => levelConfig.colors.line, set: (v) => { levelConfig.colors.line = v; }, defaultValue: d.colors.line },
      ],
    },
    {
      title: 'LIGHTING',
      numerics: [
        { label: 'Ambient Intensity', min: 0, max: 1.5, step: 0.05, get: () => levelConfig.lighting.ambientIntensity, set: (v) => { levelConfig.lighting.ambientIntensity = v; }, defaultValue: d.lighting.ambientIntensity },
        { label: 'Directional Intensity', min: 0, max: 2, step: 0.05, get: () => levelConfig.lighting.directionalIntensity, set: (v) => { levelConfig.lighting.directionalIntensity = v; }, defaultValue: d.lighting.directionalIntensity },
        { label: 'Directional X', min: -20, max: 20, step: 0.5, get: () => levelConfig.lighting.directionalX, set: (v) => { levelConfig.lighting.directionalX = v; }, defaultValue: d.lighting.directionalX },
        { label: 'Directional Y', min: 1, max: 40, step: 0.5, get: () => levelConfig.lighting.directionalY, set: (v) => { levelConfig.lighting.directionalY = v; }, defaultValue: d.lighting.directionalY },
        { label: 'Directional Z', min: -20, max: 20, step: 0.5, get: () => levelConfig.lighting.directionalZ, set: (v) => { levelConfig.lighting.directionalZ = v; }, defaultValue: d.lighting.directionalZ },
      ],
    },
  ];
}

function buildSection(spec: SectionSpec): HTMLElement {
  const details = document.createElement('details');
  details.open = true;
  Object.assign(details.style, { marginBottom: '12px' });

  const summary = document.createElement('summary');
  summary.textContent = spec.title;
  Object.assign(summary.style, {
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: '13px',
    color: '#aaa',
    padding: '4px 0',
    letterSpacing: '1px',
  });
  details.appendChild(summary);

  if (spec.warning) {
    const warn = document.createElement('div');
    warn.textContent = spec.warning;
    Object.assign(warn.style, {
      fontSize: '10px',
      color: '#ff9800',
      marginBottom: '6px',
      padding: '4px',
      background: 'rgba(255, 152, 0, 0.1)',
      border: '1px solid rgba(255, 152, 0, 0.3)',
      borderRadius: '3px',
    });
    details.appendChild(warn);
  }

  for (const n of spec.numerics ?? []) details.appendChild(buildNumericRow(n));
  for (const c of spec.colors ?? []) details.appendChild(buildColorRow(c));

  persistDetails(details, detailsKey(DEVPANEL_PREFIX, spec.title));
  return details;
}

function buildNumericRow(spec: NumericFieldSpec): HTMLElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', flexDirection: 'column', gap: '4px',
    padding: '6px 0', borderBottom: '1px solid #222',
  });

  const labelRow = document.createElement('div');
  Object.assign(labelRow.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });

  const label = document.createElement('label');
  label.textContent = spec.label;
  Object.assign(label.style, { fontSize: '12px', color: '#ddd' });
  labelRow.appendChild(label);

  const numeric = document.createElement('input');
  numeric.type = 'number';
  numeric.min = String(spec.min);
  numeric.max = String(spec.max);
  numeric.step = String(spec.step);
  numeric.value = String(spec.get());
  Object.assign(numeric.style, {
    width: '70px', padding: '2px 4px', background: '#0d101e',
    color: '#fff', border: '1px solid #333', borderRadius: '3px',
    fontSize: '12px', fontFamily: 'monospace',
  });
  labelRow.appendChild(numeric);

  row.appendChild(labelRow);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(spec.min);
  slider.max = String(spec.max);
  slider.step = String(spec.step);
  slider.value = String(spec.get());
  Object.assign(slider.style, { width: '100%' });
  row.appendChild(slider);

  const defaultLabel = document.createElement('div');
  defaultLabel.textContent = `default: ${spec.defaultValue}`;
  Object.assign(defaultLabel.style, { fontSize: '10px', color: '#666' });
  row.appendChild(defaultLabel);

  const apply = (raw: string) => {
    if (raw.trim() === '') return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    spec.set(v);
    slider.value = String(v);
    numeric.value = String(v);
    rebuildCourt();
  };
  slider.addEventListener('input', () => apply(slider.value));
  numeric.addEventListener('input', () => apply(numeric.value));

  allInputBindings.push({ kind: 'numeric', spec, slider, numeric });
  return row;
}

function buildColorRow(spec: ColorFieldSpec): HTMLElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0', borderBottom: '1px solid #222',
  });

  const label = document.createElement('label');
  label.textContent = spec.label;
  Object.assign(label.style, { fontSize: '12px', color: '#ddd' });
  row.appendChild(label);

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = numToHex(spec.get());
  Object.assign(picker.style, {
    width: '60px', height: '24px', cursor: 'pointer',
    background: 'transparent', border: '1px solid #444', borderRadius: '3px',
  });
  picker.addEventListener('input', () => {
    spec.set(hexToNum(picker.value));
    rebuildCourt();
  });
  row.appendChild(picker);

  allInputBindings.push({ kind: 'color', spec, picker });
  return row;
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  Object.assign(btn.style, {
    flex: '1',
    minWidth: '70px',
    padding: '6px 8px',
    background: '#1f2540',
    color: '#ffffff',
    border: '1px solid #444',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: 'sans-serif',
  });
  btn.addEventListener('click', onClick);
  return btn;
}

function exportJSON(): void {
  const blob = new Blob([serializeLevel()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'march-mad-level.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        applyLevelJSON(text);
        syncFromConfig();
      } catch (err) {
        console.error('Failed to import level JSON:', err);
        alert('Failed to import: ' + (err instanceof Error ? err.message : String(err)));
      }
    });
  });
  input.click();
}

function exportAllJSON(): void {
  const combined = JSON.stringify({
    balance: JSON.parse(serializeBalance()),
    level: JSON.parse(serializeLevel()),
    player: JSON.parse(serializePlayer()),
    animConfig: JSON.parse(serializeAnim()),
  }, null, 2);
  const blob = new Blob([combined], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'march-mad-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importAllJSON(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        let parsed: any;
        try { parsed = JSON.parse(text); } catch { throw new Error('Invalid JSON'); }
        if (parsed && typeof parsed === 'object' && (parsed.balance || parsed.level || parsed.player || parsed.animConfig)) {
          if (parsed.balance) applyBalanceJSON(JSON.stringify(parsed.balance));
          if (parsed.level) applyLevelJSON(JSON.stringify(parsed.level));
          if (parsed.player) applyPlayerJSON(JSON.stringify(parsed.player));
          if (parsed.animConfig) applyAnimJSON(JSON.stringify(parsed.animConfig));
        } else {
          try { applyBalanceJSON(text); } catch {
            try { applyLevelJSON(text); } catch {
              try { applyPlayerJSON(text); } catch { applyAnimJSON(text); }
            }
          }
        }
        syncFromConfig();
      } catch (err) {
        console.error('Failed to import all-config JSON:', err);
        alert('Failed to import: ' + (err instanceof Error ? err.message : String(err)));
      }
    });
  });
  input.click();
}

function exportGLB(): void {
  const exporter = new GLTFExporter();
  exporter.parse(
    currentCourt,
    (result) => {
      const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'march-mad-court.glb';
      a.click();
      URL.revokeObjectURL(url);
    },
    (err) => {
      console.error('GLB export failed:', err);
      alert('GLB export failed: ' + (err instanceof Error ? err.message : String(err)));
    },
    { binary: true },
  );
}
