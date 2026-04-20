import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GamePlayer } from './game/player';
import { Ball } from './game/ball';
import { createHoop } from './game/hoop';
import { createDefaultPlayerStats, type Position } from './core/types';
import {
  playerConfig,
  resetPlayer,
  serializePlayer,
  applyPlayerJSON,
  getDefaults,
} from './dev/player-config';
import { serializeBalance, applyBalanceJSON, resetBalance } from './dev/balance-config';
import { serializeLevel, applyLevelJSON, resetLevel } from './dev/level-config';
import { serializeAnim, applyAnimJSON, resetAnim } from './dev/anim-config';
import { persistDetails, detailsKey } from './dev/details-state';
import { AnimLoop, ANIM_IDS, type AnimId } from './dev/anim-loop';
import { buildBodySections } from './dev/body-sliders';

const DEVPANEL_PREFIX = 'devpanel:player-editor';

// Ordered to match HAIR_STYLE_WEIGHTS in game/player.ts
const HAIR_STYLES = ['bald', 'receding', 'flat-top', 'afro', 'mohawk', 'headband'] as const;
const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

let teamColor = 0xe94560;
let hairOverride: number = 0; // 0..3
let positionOverride: Position | undefined = undefined;
// Stable id across body-slider rebuilds so skin tone + hair-color RNG rolls
// don't flicker while the user tunes dimensions. Only the explicit Re-roll
// button bumps this to generate a new appearance.
let rebuildSeq = 0;

// Animation playback state — the editor plays a looping anim so the user can
// tune body dimensions while watching the character in motion, not a static pose.
let currentAnim: AnimId = 'idle';
let speedMultiplier = 1.0;

// --- Renderer / Scene / Camera ---
const canvas = document.getElementById('editor-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
camera.position.set(0, 1.5, 4);
camera.lookAt(0, 0.9, 0);

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
controls.target.set(0, 0.9, 0);

// --- Lighting + platform ---
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
dirLight.position.set(3, 8, 5);
scene.add(dirLight);

const platform = new THREE.Mesh(
  new THREE.CylinderGeometry(1.2, 1.2, 0.05, 32),
  new THREE.MeshStandardMaterial({ color: 0x2a2f4a }),
);
platform.position.y = -0.025;
scene.add(platform);

// --- Hoop + ball props (for shoot/dunk/pass animations) ---
const hoopPos = new THREE.Vector3(0, 3.05, 2.5);
const hoop = createHoop(hoopPos, 0xe94560);
hoop.rotation.y = Math.PI; // backboard faces the player
hoop.visible = false; // only visible for shoot/dunk/pass
scene.add(hoop);

const ball = new Ball(new THREE.Vector3(0, 1, 0));
ball.mesh.visible = false;
scene.add(ball.mesh);

// --- Player ---
// Parent container so user-provided XYZ offset sliders can bump the player
// without fighting position logic. Mirrors anim-viewer's playerContainer.
const playerContainer = new THREE.Group();
scene.add(playerContainer);
let playerOffsetX = 0;
let playerOffsetY = 0;
let playerOffsetZ = 0;

let player: GamePlayer | null = null;
let animLoop: AnimLoop | null = null;

/** Walk a three.js group and dispose every geometry + material. Mirrors
 * level-editor's disposeCourt — without this, rebuildPlayer() leaks on every
 * slider tick. */
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

function rebuildPlayer(): void {
  // Capture current anim context so body rebuilds don't pop back to idle.
  // Re-trigger fresh rather than preserving animTime for timed anims — body
  // rebuilds are rare enough that a brief animation restart is fine.
  const savedAnim: AnimId = currentAnim;
  const savedAnimTime: number = player?.animTime ?? 0;

  if (player) {
    playerContainer.remove(player.group);
    disposePlayerGroup(player.group);
  }
  player = new GamePlayer(
    {
      id: `editor-${rebuildSeq}`,
      name: 'Editor Player',
      stats: createDefaultPlayerStats(),
      personality: 'Team Player',
      isCustom: false,
      position: positionOverride,
      hairOverride,
    } as any,
    new THREE.Vector3(0, 0, 0),
    teamColor,
  );
  playerContainer.add(player.group);
  player.animTime = savedAnimTime;

  if (animLoop) {
    animLoop.setPlayer(player);
  } else {
    animLoop = new AnimLoop(player, { ball, hoopPos });
  }
  animLoop.setAnim(savedAnim); // resets per-anim timers; next tick re-triggers fresh
  applyAnimPropsVisibility();
}

/** Hoop + ball show only for the animations that use them. */
function applyAnimPropsVisibility(): void {
  const needsHoop = currentAnim === 'shoot' || currentAnim === 'dunk';
  const needsBall =
    needsHoop ||
    currentAnim === 'pass' ||
    currentAnim === 'dribble' ||
    currentAnim === 'dribble-walk' ||
    currentAnim === 'dribble-sprint';
  hoop.visible = needsHoop;
  ball.mesh.visible = needsBall;
}

rebuildPlayer();

// --- Animate loop ---
let lastTime = performance.now();
function animate(): void {
  requestAnimationFrame(animate);
  const now = performance.now();
  const rawDt = (now - lastTime) / 1000;
  lastTime = now;

  controls.update();
  if (animLoop) {
    animLoop.tick(rawDt * speedMultiplier);
  }
  renderer.render(scene, camera);
}
animate();

// --- Side panel types + binding registries (must be declared BEFORE
//     buildPanel() runs, otherwise the slider builders that call
//     numericBindings.push(...) hit a temporal-dead-zone crash and the
//     whole page fails to render anything but the red panel border). ---
interface NumericFieldSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  defaultValue: number;
}

interface ColorFieldSpec {
  label: string;
  get: () => number;
  set: (v: number) => void;
  defaultValue: number;
}

interface SectionSpec {
  title: string;
  numerics?: NumericFieldSpec[];
  colors?: ColorFieldSpec[];
}

const numericBindings: Array<{ spec: NumericFieldSpec; slider: HTMLInputElement; numeric: HTMLInputElement }> = [];
const colorBindings: Array<{ spec: ColorFieldSpec; picker: HTMLInputElement }> = [];

// --- Side panel ---
const panel = document.getElementById('panel')!;
buildPanel();

function syncFromConfig(): void {
  for (const b of numericBindings) {
    const v = b.spec.get();
    b.slider.value = String(v);
    b.numeric.value = String(v);
  }
  for (const b of colorBindings) {
    b.picker.value = numToHex(b.spec.get());
  }
  rebuildPlayer();
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
    display: 'flex', flexDirection: 'column', gap: '8px',
    marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #333',
  });

  const title = document.createElement('div');
  title.textContent = 'PLAYER EDITOR';
  Object.assign(title.style, {
    fontSize: '16px', fontWeight: 'bold', letterSpacing: '2px', color: '#e94560',
  });
  header.appendChild(title);

  const hint = document.createElement('div');
  hint.textContent = 'Edits rebuild the player live. Pan/zoom/orbit with mouse.';
  Object.assign(hint.style, { fontSize: '11px', color: '#888' });
  header.appendChild(hint);

  // "ALL CONFIGS" row — resets/exports/imports balance + level + player + anim
  // together. Placed ABOVE the domain-scoped row so the player-only buttons
  // remain the quick default and the combined action is clearly labeled.
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
  buttonRow.appendChild(makeButton('Reset', () => { resetPlayer(); syncFromConfig(); }));
  buttonRow.appendChild(makeButton('Export JSON', exportJSON));
  buttonRow.appendChild(makeButton('Import JSON', importJSON));
  buttonRow.appendChild(makeButton('Export GLB', exportGLB));
  buttonRow.appendChild(makeButton('Re-roll', () => { rebuildSeq++; rebuildPlayer(); }));
  header.appendChild(buttonRow);

  panel.appendChild(header);

  // Preview controls (not part of the config — affect just the editor view)
  panel.appendChild(buildPreviewSection());

  // Player position offset (bump the model without changing its pose).
  panel.appendChild(buildPlayerOffsetSection());

  // Animation playback (speed + state picker). Sits above body/limb sections
  // so the user can pick an anim once and then scroll down to tune dimensions.
  panel.appendChild(buildAnimationSection());

  for (const section of buildSections()) {
    panel.appendChild(buildSection(section));
  }
}

function applyPlayerOffset(): void {
  playerContainer.position.set(playerOffsetX, playerOffsetY, playerOffsetZ);
}

function buildPlayerOffsetSection(): HTMLElement {
  const details = document.createElement('details');
  details.open = true;
  Object.assign(details.style, { marginBottom: '12px' });
  persistDetails(details, detailsKey(DEVPANEL_PREFIX, 'PLAYER OFFSET'));

  const summary = document.createElement('summary');
  summary.textContent = 'PLAYER OFFSET';
  Object.assign(summary.style, {
    cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
    color: '#aaa', padding: '4px 0', letterSpacing: '1px',
  });
  details.appendChild(summary);

  const hint = document.createElement('div');
  hint.textContent = 'Bumps the player relative to where the anim places it.';
  Object.assign(hint.style, { fontSize: '10px', color: '#666', padding: '2px 0 6px 0' });
  details.appendChild(hint);

  const makeAxisRow = (axis: 'x' | 'y' | 'z', min: number, max: number): HTMLElement => {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', flexDirection: 'column', gap: '2px',
      padding: '4px 0', borderBottom: '1px solid #222',
    });

    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
    const label = document.createElement('label');
    label.textContent = axis.toUpperCase();
    Object.assign(label.style, { fontSize: '12px', color: '#ddd', fontFamily: 'monospace' });
    head.appendChild(label);
    const valEl = document.createElement('span');
    valEl.textContent = '0.00';
    Object.assign(valEl.style, { fontSize: '12px', color: '#fff', fontFamily: 'monospace' });
    head.appendChild(valEl);
    row.appendChild(head);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = '0.05';
    slider.value = '0';
    Object.assign(slider.style, { width: '100%' });
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      if (axis === 'x') playerOffsetX = v;
      else if (axis === 'y') playerOffsetY = v;
      else playerOffsetZ = v;
      valEl.textContent = v.toFixed(2);
      applyPlayerOffset();
    });
    row.appendChild(slider);
    return row;
  };

  details.appendChild(makeAxisRow('x', -3, 3));
  details.appendChild(makeAxisRow('y', -2, 3));
  details.appendChild(makeAxisRow('z', -3, 3));

  const resetBtn = makeButton('Reset Offset', () => {
    playerOffsetX = 0;
    playerOffsetY = 0;
    playerOffsetZ = 0;
    applyPlayerOffset();
    // Sync the slider DOM — rebuild the section by refreshing buildPanel
    // would be heavy, so just zero each input in place.
    for (const input of details.querySelectorAll<HTMLInputElement>('input[type=range]')) {
      input.value = '0';
    }
    for (const span of details.querySelectorAll<HTMLElement>('span')) {
      span.textContent = '0.00';
    }
  });
  Object.assign(resetBtn.style, { marginTop: '6px' });
  details.appendChild(resetBtn);

  return details;
}

function buildAnimationSection(): HTMLElement {
  const details = document.createElement('details');
  details.open = true;
  Object.assign(details.style, { marginBottom: '12px' });
  persistDetails(details, detailsKey(DEVPANEL_PREFIX, 'ANIMATION'));

  const summary = document.createElement('summary');
  summary.textContent = 'ANIMATION';
  Object.assign(summary.style, {
    cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
    color: '#aaa', padding: '4px 0', letterSpacing: '1px',
  });
  details.appendChild(summary);

  // --- Speed slider ---
  const speedRow = document.createElement('div');
  Object.assign(speedRow.style, {
    display: 'flex', flexDirection: 'column', gap: '4px',
    padding: '6px 0', borderBottom: '1px solid #222',
  });

  const speedHead = document.createElement('div');
  Object.assign(speedHead.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
  const speedLabel = document.createElement('label');
  speedLabel.textContent = 'Speed';
  Object.assign(speedLabel.style, { fontSize: '12px', color: '#ddd' });
  speedHead.appendChild(speedLabel);
  const speedVal = document.createElement('span');
  speedVal.textContent = speedMultiplier.toFixed(1) + 'x';
  Object.assign(speedVal.style, { fontSize: '12px', color: '#fff', fontFamily: 'monospace' });
  speedHead.appendChild(speedVal);
  speedRow.appendChild(speedHead);

  const speedSlider = document.createElement('input');
  speedSlider.type = 'range';
  speedSlider.min = '0.1';
  speedSlider.max = '2.0';
  speedSlider.step = '0.1';
  speedSlider.value = String(speedMultiplier);
  Object.assign(speedSlider.style, { width: '100%' });
  speedSlider.addEventListener('input', () => {
    speedMultiplier = parseFloat(speedSlider.value);
    speedVal.textContent = speedMultiplier.toFixed(1) + 'x';
  });
  speedRow.appendChild(speedSlider);
  details.appendChild(speedRow);

  // --- Animation button grid ---
  const animGridLabel = document.createElement('div');
  animGridLabel.textContent = 'State';
  Object.assign(animGridLabel.style, {
    fontSize: '12px', color: '#ddd', padding: '6px 0 4px 0',
  });
  details.appendChild(animGridLabel);

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '4px', paddingBottom: '6px',
  });
  const buttons: HTMLButtonElement[] = [];

  const markActive = () => {
    for (const b of buttons) {
      const isActive = b.dataset.anim === currentAnim;
      b.style.background = isActive ? '#e94560' : '#1f2540';
      b.style.borderColor = isActive ? '#e94560' : '#444';
      b.style.color = '#fff';
    }
  };

  for (const id of ANIM_IDS) {
    const btn = document.createElement('button');
    btn.textContent = id;
    btn.dataset.anim = id;
    Object.assign(btn.style, {
      padding: '6px 4px', fontSize: '11px', fontFamily: 'sans-serif',
      background: '#1f2540', color: '#fff', border: '1px solid #444',
      borderRadius: '3px', cursor: 'pointer', letterSpacing: '0.5px',
    });
    btn.addEventListener('click', () => {
      currentAnim = id;
      if (animLoop) animLoop.setAnim(id);
      applyAnimPropsVisibility();
      markActive();
    });
    buttons.push(btn);
    grid.appendChild(btn);
  }
  details.appendChild(grid);
  markActive();
  return details;
}

function buildPreviewSection(): HTMLElement {
  const details = document.createElement('details');
  details.open = true;
  Object.assign(details.style, { marginBottom: '12px' });
  persistDetails(details, detailsKey(DEVPANEL_PREFIX, 'PREVIEW'));

  const summary = document.createElement('summary');
  summary.textContent = 'PREVIEW';
  Object.assign(summary.style, {
    cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
    color: '#aaa', padding: '4px 0', letterSpacing: '1px',
  });
  details.appendChild(summary);

  details.appendChild(buildDropdown('Position', ['(default)', ...POSITIONS], positionOverride ?? '(default)', (v) => {
    positionOverride = v === '(default)' ? undefined : v as Position;
    rebuildPlayer();
  }));

  details.appendChild(buildDropdown('Hair Style', HAIR_STYLES.map(String), HAIR_STYLES[hairOverride], (v) => {
    hairOverride = HAIR_STYLES.indexOf(v as typeof HAIR_STYLES[number]);
    rebuildPlayer();
  }));

  // Team color picker (drives jersey)
  const colorRow = document.createElement('div');
  Object.assign(colorRow.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0', borderBottom: '1px solid #222',
  });
  const colorLabel = document.createElement('label');
  colorLabel.textContent = 'Team Color';
  Object.assign(colorLabel.style, { fontSize: '12px', color: '#ddd' });
  colorRow.appendChild(colorLabel);

  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.value = numToHex(teamColor);
  Object.assign(colorPicker.style, {
    width: '60px', height: '24px', cursor: 'pointer',
    background: 'transparent', border: '1px solid #444', borderRadius: '3px',
  });
  colorPicker.addEventListener('input', () => {
    teamColor = hexToNum(colorPicker.value);
    rebuildPlayer();
  });
  colorRow.appendChild(colorPicker);
  details.appendChild(colorRow);

  return details;
}

function buildDropdown(label: string, options: string[], current: string, onChange: (v: string) => void): HTMLElement {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 0', borderBottom: '1px solid #222', gap: '8px',
  });
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  Object.assign(labelEl.style, { fontSize: '12px', color: '#ddd' });
  row.appendChild(labelEl);

  const select = document.createElement('select');
  Object.assign(select.style, {
    flex: '1', padding: '4px', background: '#0d101e',
    color: '#fff', border: '1px solid #333', borderRadius: '3px', fontSize: '12px',
  });
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opt === current) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => onChange(select.value));
  row.appendChild(select);
  return row;
}

// Delegates to the shared list in src/dev/body-sliders.ts so the anim-viewer
// and player-editor always expose the same 5 sections / ~50 fields in the
// same order with the same ranges. Types are structurally compatible.
function buildSections(): SectionSpec[] {
  return buildBodySections() as unknown as SectionSpec[];
}

function buildSection(spec: SectionSpec): HTMLElement {
  const details = document.createElement('details');
  details.open = true;
  Object.assign(details.style, { marginBottom: '12px' });

  const summary = document.createElement('summary');
  summary.textContent = spec.title;
  Object.assign(summary.style, {
    cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
    color: '#aaa', padding: '4px 0', letterSpacing: '1px',
  });
  details.appendChild(summary);

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
    rebuildPlayer();
  };
  slider.addEventListener('input', () => apply(slider.value));
  numeric.addEventListener('input', () => apply(numeric.value));

  numericBindings.push({ spec, slider, numeric });
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
    rebuildPlayer();
  });
  row.appendChild(picker);

  colorBindings.push({ spec, picker });
  return row;
}

function makeButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  Object.assign(btn.style, {
    flex: '1', minWidth: '70px', padding: '6px 8px',
    background: '#1f2540', color: '#ffffff',
    border: '1px solid #444', borderRadius: '4px',
    cursor: 'pointer', fontSize: '12px', fontFamily: 'sans-serif',
  });
  btn.addEventListener('click', onClick);
  return btn;
}

function exportJSON(): void {
  const blob = new Blob([serializePlayer()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'march-mad-player.json';
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
        applyPlayerJSON(text);
        syncFromConfig();
      } catch (err) {
        console.error('Failed to import player JSON:', err);
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
  if (!player) return;
  const exporter = new GLTFExporter();
  exporter.parse(
    player.group,
    (result) => {
      const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'march-mad-player.glb';
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
