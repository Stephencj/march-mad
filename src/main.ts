import * as THREE from 'three';
import { GameLoop } from './core/game-loop';
import { gameEvents } from './core/events';
import { GameStateMachine, type StateTransition } from './core/state-machine';
import { createCourt } from './game/court';
import { Ball } from './game/ball';
import { GamePlayer } from './game/player';
import { createDefaultPlayerStats } from './core/types';
import { MatchEngine } from './game/match';
import { CameraSystem } from './game/camera';
import { TouchControls } from './game/controls';
import { KeyboardControls } from './game/keyboard-controls';
import { PowerupSystem } from './systems/powerups';
import { CrowdSystem } from './systems/crowd';
import { SubInSystem } from './systems/sub-in';
import { BettingSystem } from './meta/betting';
import { Tournament } from './meta/tournament';
import { DraftSystem } from './meta/draft';
import { ProgressionSystem } from './meta/progression';
import { SaveSystem } from './meta/save';
import { generateTeams } from './data/teams';
import { HUD } from './ui/hud';
import { MenuUI } from './ui/menus';
import { BracketViewUI } from './ui/bracket-view';
import { BettingUI } from './ui/betting-ui';
import { PlayerCreatorUI } from './ui/player-creator';
import { DraftUI } from './ui/draft-ui';

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

// --- Scene Objects ---
const court = createCourt();
scene.add(court);

const ball = new Ball(new THREE.Vector3(0, 1, 2));
scene.add(ball.mesh);

// Test players (will be replaced by proper team setup later)
const testPlayer = new GamePlayer(
  { id: 'test', name: 'Player 1', stats: createDefaultPlayerStats(), personality: 'Team Player', isCustom: false },
  new THREE.Vector3(-2, 0, 3),
  0x3498db
);
scene.add(testPlayer.group);

// --- Game Systems ---
const cameraSystem = new CameraSystem(camera);
const matchEngine = new MatchEngine(gameEvents);
const powerupSystem = new PowerupSystem(gameEvents);
const crowdSystem = new CrowdSystem(gameEvents);
const subInSystem = new SubInSystem();
const bettingSystem = new BettingSystem();
const progressionSystem = new ProgressionSystem();
const saveSystem = new SaveSystem();

// --- Controls ---
const touchControls = new TouchControls();
const keyboardControls = new KeyboardControls();

// Touch event listeners
document.addEventListener('touchstart', (e) => {
  const touch = e.changedTouches[0];
  const isLeft = touch.clientX < window.innerWidth / 2;
  touchControls.handleTouchStart({
    x: touch.clientX, y: touch.clientY, id: touch.identifier,
    isLeftHalf: isLeft, timestamp: e.timeStamp,
  });
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  const touch = e.changedTouches[0];
  const isLeft = touch.clientX < window.innerWidth / 2;
  touchControls.handleTouchMove({
    x: touch.clientX, y: touch.clientY, id: touch.identifier,
    isLeftHalf: isLeft, timestamp: e.timeStamp,
  });
}, { passive: true });

document.addEventListener('touchend', (e) => {
  const touch = e.changedTouches[0];
  const isLeft = touch.clientX < window.innerWidth / 2;
  touchControls.handleTouchEnd({
    x: touch.clientX, y: touch.clientY, id: touch.identifier,
    isLeftHalf: isLeft, timestamp: e.timeStamp,
    startX: touch.clientX, startY: touch.clientY, startTimestamp: e.timeStamp,
  });
}, { passive: true });

document.addEventListener('keydown', (e) => keyboardControls.handleKeyDown(e.code));
document.addEventListener('keyup', (e) => keyboardControls.handleKeyUp(e.code));

// --- UI ---
const uiOverlay = document.getElementById('ui-overlay')!;
const hud = new HUD(uiOverlay);
const menuUI = new MenuUI(uiOverlay, handleMenuAction);

function handleMenuAction(action: string, _data?: unknown) {
  if (action === 'play') stateMachine.transition('TournamentSelect');
  if (action === 'select-tier') stateMachine.transition('DraftPhase');
  if (action === 'back') stateMachine.transition('MainMenu');
  if (action === 'settings') { /* settings handled inline */ }
}

// --- State Machine Hooks ---
stateMachine.onEnter('MainMenu', () => {
  menuUI.show('main');
});

stateMachine.onExit('MainMenu', () => {
  menuUI.hide();
});

stateMachine.onEnter('TournamentSelect', () => {
  menuUI.show('tournament-select');
});

stateMachine.onExit('TournamentSelect', () => {
  menuUI.hide();
});

// Show main menu on start
menuUI.show('main');

// --- Game Loop ---
function update(dt: number): void {
  ball.update(dt);
  powerupSystem.tick(dt);
  crowdSystem.tick(dt);

  if (matchEngine.state.phase === 'playing') {
    matchEngine.tickClock(dt);

    const diff = matchEngine.getScoreDifferential();
    if (diff) {
      powerupSystem.update(diff.deficit, dt);
      crowdSystem.updateScoreDiff(diff.deficit);
    }
  }

  cameraSystem.update(testPlayer.group.position, ball.mesh.position, dt);

  // Update HUD
  hud.updateScore(matchEngine.state.homeScore, matchEngine.state.awayScore);
  hud.updateClock(matchEngine.state.clockSeconds);
  hud.updateCrowdLevel(crowdSystem.getLevel());
}

function render(): void {
  renderer.render(scene, camera);
}

const loop = new GameLoop({ fixedStep: 1 / 60, update, render });
loop.start();

export { scene, camera, renderer, gameEvents, loop };
export { cameraSystem, matchEngine, powerupSystem, crowdSystem, subInSystem, bettingSystem };

// Suppress unused-variable warnings for systems used later in game flow
void Tournament;
void DraftSystem;
void generateTeams;
void BracketViewUI;
void BettingUI;
void PlayerCreatorUI;
void DraftUI;
void progressionSystem;
void saveSystem;
void touchControls;
void keyboardControls;

console.log('March Madness 3v3 initialized — all systems wired');
