import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GamePlayer } from './game/player';
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

const DEVPANEL_PREFIX = 'devpanel:player-editor';

const HAIR_STYLES = ['flat-top', 'afro', 'mohawk', 'headband'] as const;
const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

let teamColor = 0xe94560;
let hairOverride: number = 0; // 0..3
let positionOverride: Position | undefined = undefined;
let rebuildSeq = 0; // bump to vary player id (changes skin/hair color rolls)

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

// --- Player ---
let player: GamePlayer | null = null;

function rebuildPlayer(): void {
  if (player) {
    scene.remove(player.group);
  }
  rebuildSeq++;
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
  scene.add(player.group);
}
rebuildPlayer();

// --- Animate loop ---
function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  // Idle animation tick so the player breathes a bit
  if (player) {
    player.velocity.set(0, 0, 0);
    player.animate(1 / 60);
  }
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
  buttonRow.appendChild(makeButton('Re-roll', () => { rebuildPlayer(); }));
  header.appendChild(buttonRow);

  panel.appendChild(header);

  // Preview controls (not part of the config — affect just the editor view)
  panel.appendChild(buildPreviewSection());

  for (const section of buildSections()) {
    panel.appendChild(buildSection(section));
  }
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

function buildSections(): SectionSpec[] {
  const d = getDefaults();
  return [
    {
      title: 'HEAD',
      numerics: [
        { label: 'Head Radius', min: 0.18, max: 0.45, step: 0.01,
          get: () => playerConfig.head.radius, set: (v) => { playerConfig.head.radius = v; }, defaultValue: d.head.radius },
        { label: 'Eye Radius', min: 0.01, max: 0.1, step: 0.005,
          get: () => playerConfig.head.eyeRadius, set: (v) => { playerConfig.head.eyeRadius = v; }, defaultValue: d.head.eyeRadius },
      ],
    },
    {
      title: 'BODY',
      numerics: [
        { label: 'Torso Width', min: 0.18, max: 0.45, step: 0.01, get: () => playerConfig.body.torsoWidth, set: (v) => { playerConfig.body.torsoWidth = v; }, defaultValue: d.body.torsoWidth },
        { label: 'Torso Height', min: 0.25, max: 0.6, step: 0.01, get: () => playerConfig.body.torsoHeight, set: (v) => { playerConfig.body.torsoHeight = v; }, defaultValue: d.body.torsoHeight },
        { label: 'Torso Depth', min: 0.08, max: 0.3, step: 0.01, get: () => playerConfig.body.torsoDepth, set: (v) => { playerConfig.body.torsoDepth = v; }, defaultValue: d.body.torsoDepth },
        { label: 'Shoulder Bar Width', min: 0.3, max: 0.6, step: 0.01, get: () => playerConfig.body.shoulderBarWidth, set: (v) => { playerConfig.body.shoulderBarWidth = v; }, defaultValue: d.body.shoulderBarWidth },
        { label: 'Shoulder Bar Height', min: 0.02, max: 0.15, step: 0.01, get: () => playerConfig.body.shoulderBarHeight, set: (v) => { playerConfig.body.shoulderBarHeight = v; }, defaultValue: d.body.shoulderBarHeight },
        { label: 'Shoulder Bar Depth', min: 0.05, max: 0.25, step: 0.01, get: () => playerConfig.body.shoulderBarDepth, set: (v) => { playerConfig.body.shoulderBarDepth = v; }, defaultValue: d.body.shoulderBarDepth },
        { label: 'Shoulder Cap Radius', min: 0.04, max: 0.16, step: 0.01, get: () => playerConfig.body.shoulderCapRadius, set: (v) => { playerConfig.body.shoulderCapRadius = v; }, defaultValue: d.body.shoulderCapRadius },
        { label: 'Hip Width', min: 0.18, max: 0.4, step: 0.01, get: () => playerConfig.body.hipWidth, set: (v) => { playerConfig.body.hipWidth = v; }, defaultValue: d.body.hipWidth },
        { label: 'Hip Height', min: 0.05, max: 0.2, step: 0.01, get: () => playerConfig.body.hipHeight, set: (v) => { playerConfig.body.hipHeight = v; }, defaultValue: d.body.hipHeight },
        { label: 'Hip Depth', min: 0.08, max: 0.25, step: 0.01, get: () => playerConfig.body.hipDepth, set: (v) => { playerConfig.body.hipDepth = v; }, defaultValue: d.body.hipDepth },
      ],
    },
    {
      title: 'LIMBS',
      numerics: [
        { label: 'Upper Arm: Top R', min: 0.02, max: 0.06, step: 0.005, get: () => playerConfig.limbs.upperArmRadiusTop, set: (v) => { playerConfig.limbs.upperArmRadiusTop = v; }, defaultValue: d.limbs.upperArmRadiusTop },
        { label: 'Upper Arm: Bot R', min: 0.02, max: 0.06, step: 0.005, get: () => playerConfig.limbs.upperArmRadiusBottom, set: (v) => { playerConfig.limbs.upperArmRadiusBottom = v; }, defaultValue: d.limbs.upperArmRadiusBottom },
        { label: 'Upper Arm: Length', min: 0.18, max: 0.42, step: 0.01, get: () => playerConfig.limbs.upperArmLength, set: (v) => { playerConfig.limbs.upperArmLength = v; }, defaultValue: d.limbs.upperArmLength },
        { label: 'Forearm: Top R', min: 0.015, max: 0.05, step: 0.005, get: () => playerConfig.limbs.forearmRadiusTop, set: (v) => { playerConfig.limbs.forearmRadiusTop = v; }, defaultValue: d.limbs.forearmRadiusTop },
        { label: 'Forearm: Bot R', min: 0.015, max: 0.05, step: 0.005, get: () => playerConfig.limbs.forearmRadiusBottom, set: (v) => { playerConfig.limbs.forearmRadiusBottom = v; }, defaultValue: d.limbs.forearmRadiusBottom },
        { label: 'Forearm: Length', min: 0.14, max: 0.36, step: 0.01, get: () => playerConfig.limbs.forearmLength, set: (v) => { playerConfig.limbs.forearmLength = v; }, defaultValue: d.limbs.forearmLength },
        { label: 'Upper Leg: Top R', min: 0.04, max: 0.1, step: 0.005, get: () => playerConfig.limbs.upperLegRadiusTop, set: (v) => { playerConfig.limbs.upperLegRadiusTop = v; }, defaultValue: d.limbs.upperLegRadiusTop },
        { label: 'Upper Leg: Bot R', min: 0.03, max: 0.09, step: 0.005, get: () => playerConfig.limbs.upperLegRadiusBottom, set: (v) => { playerConfig.limbs.upperLegRadiusBottom = v; }, defaultValue: d.limbs.upperLegRadiusBottom },
        { label: 'Upper Leg: Length', min: 0.22, max: 0.5, step: 0.01, get: () => playerConfig.limbs.upperLegLength, set: (v) => { playerConfig.limbs.upperLegLength = v; }, defaultValue: d.limbs.upperLegLength },
        { label: 'Lower Leg: Top R', min: 0.03, max: 0.09, step: 0.005, get: () => playerConfig.limbs.lowerLegRadiusTop, set: (v) => { playerConfig.limbs.lowerLegRadiusTop = v; }, defaultValue: d.limbs.lowerLegRadiusTop },
        { label: 'Lower Leg: Bot R', min: 0.04, max: 0.1, step: 0.005, get: () => playerConfig.limbs.lowerLegRadiusBottom, set: (v) => { playerConfig.limbs.lowerLegRadiusBottom = v; }, defaultValue: d.limbs.lowerLegRadiusBottom },
        { label: 'Lower Leg: Length', min: 0.22, max: 0.5, step: 0.01, get: () => playerConfig.limbs.lowerLegLength, set: (v) => { playerConfig.limbs.lowerLegLength = v; }, defaultValue: d.limbs.lowerLegLength },
      ],
    },
    {
      title: 'SHOES',
      numerics: [
        { label: 'Width', min: 0.08, max: 0.22, step: 0.01, get: () => playerConfig.shoes.width, set: (v) => { playerConfig.shoes.width = v; }, defaultValue: d.shoes.width },
        { label: 'Height', min: 0.04, max: 0.16, step: 0.01, get: () => playerConfig.shoes.height, set: (v) => { playerConfig.shoes.height = v; }, defaultValue: d.shoes.height },
        { label: 'Depth', min: 0.12, max: 0.3, step: 0.01, get: () => playerConfig.shoes.depth, set: (v) => { playerConfig.shoes.depth = v; }, defaultValue: d.shoes.depth },
      ],
      colors: [
        { label: 'Color', get: () => playerConfig.shoes.color, set: (v) => { playerConfig.shoes.color = v; }, defaultValue: d.shoes.color },
      ],
    },
    {
      title: 'HAIR',
      numerics: [
        { label: 'Flat-Top: Width', min: 0.2, max: 0.5, step: 0.01, get: () => playerConfig.hair.flatTopWidth, set: (v) => { playerConfig.hair.flatTopWidth = v; }, defaultValue: d.hair.flatTopWidth },
        { label: 'Flat-Top: Height', min: 0.04, max: 0.25, step: 0.01, get: () => playerConfig.hair.flatTopHeight, set: (v) => { playerConfig.hair.flatTopHeight = v; }, defaultValue: d.hair.flatTopHeight },
        { label: 'Flat-Top: Depth', min: 0.18, max: 0.4, step: 0.01, get: () => playerConfig.hair.flatTopDepth, set: (v) => { playerConfig.hair.flatTopDepth = v; }, defaultValue: d.hair.flatTopDepth },
        { label: 'Afro Radius', min: 0.2, max: 0.5, step: 0.01, get: () => playerConfig.hair.afroRadius, set: (v) => { playerConfig.hair.afroRadius = v; }, defaultValue: d.hair.afroRadius },
        { label: 'Mohawk: Width', min: 0.02, max: 0.16, step: 0.01, get: () => playerConfig.hair.mohawkWidth, set: (v) => { playerConfig.hair.mohawkWidth = v; }, defaultValue: d.hair.mohawkWidth },
        { label: 'Mohawk: Height', min: 0.08, max: 0.4, step: 0.01, get: () => playerConfig.hair.mohawkHeight, set: (v) => { playerConfig.hair.mohawkHeight = v; }, defaultValue: d.hair.mohawkHeight },
        { label: 'Mohawk: Depth', min: 0.14, max: 0.36, step: 0.01, get: () => playerConfig.hair.mohawkDepth, set: (v) => { playerConfig.hair.mohawkDepth = v; }, defaultValue: d.hair.mohawkDepth },
        { label: 'Headband Radius', min: 0.2, max: 0.4, step: 0.005, get: () => playerConfig.hair.headbandRadius, set: (v) => { playerConfig.hair.headbandRadius = v; }, defaultValue: d.hair.headbandRadius },
        { label: 'Headband Thickness', min: 0.02, max: 0.15, step: 0.005, get: () => playerConfig.hair.headbandThickness, set: (v) => { playerConfig.hair.headbandThickness = v; }, defaultValue: d.hair.headbandThickness },
      ],
      colors: [
        { label: 'Headband Color', get: () => playerConfig.hair.headbandColor, set: (v) => { playerConfig.hair.headbandColor = v; }, defaultValue: d.hair.headbandColor },
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
