import * as THREE from 'three';
import { GameLoop } from './core/game-loop';
import { gameEvents } from './core/events';
import { GameStateMachine, type StateTransition } from './core/state-machine';

// --- Renderer Setup ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 10, 15);
camera.lookAt(0, 0, 0);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// --- State Machine ---
const transitions: StateTransition[] = [
  { from: 'MainMenu', to: 'PlayerCreation' },
  { from: 'MainMenu', to: 'TournamentSelect' },
  { from: 'PlayerCreation', to: 'MainMenu' },
  { from: 'TournamentSelect', to: 'DraftPhase' },
  { from: 'DraftPhase', to: 'BracketView' },
  { from: 'BracketView', to: 'YourGame' },
  { from: 'BracketView', to: 'Spectating' },
  { from: 'YourGame', to: 'PostGame' },
  { from: 'Spectating', to: 'BettingOverlay' },
  { from: 'Spectating', to: 'BracketView' },
  { from: 'Spectating', to: 'SubInCinematic' },
  { from: 'BettingOverlay', to: 'Spectating' },
  { from: 'SubInCinematic', to: 'YourGame' },
  { from: 'PostGame', to: 'BracketView' },
  { from: 'PostGame', to: 'TournamentEnd' },
  { from: 'TournamentEnd', to: 'MainMenu' },
];

export const stateMachine = new GameStateMachine(transitions);

// --- Game Loop ---
function update(dt: number): void {
  // Physics and game logic will be added here by later tasks
}

function render(): void {
  renderer.render(scene, camera);
}

const loop = new GameLoop({ fixedStep: 1 / 60, update, render });
loop.start();

export { scene, camera, renderer, gameEvents, loop };

console.log('March Madness 3v3 initialized — core systems wired');
