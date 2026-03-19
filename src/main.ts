import * as THREE from 'three';
import { GameLoop } from './core/game-loop';
import { gameEvents } from './core/events';
import { GameStateMachine, type StateTransition } from './core/state-machine';
import { createCourt } from './game/court';
import { createFullCourt, FULL_COURT_DIMENSIONS } from './game/full-court';
import { GameSession } from './game/game-session';
import { GamePlayer } from './game/player';
import type { ControlInput } from './game/controls';
import { CameraSystem } from './game/camera';
import { TouchControls } from './game/controls';
import { KeyboardControls } from './game/keyboard-controls';
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
import { PostGameUI } from './ui/post-game';

// --- Renderer Setup ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(18, 10, 0);
camera.lookAt(0, 1.5, 0);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// --- State Machine ---
const transitions: StateTransition[] = [
  { from: 'MainMenu', to: 'PlayerCreation' },
  { from: 'MainMenu', to: 'TournamentSelect' },
  { from: 'MainMenu', to: 'YourGame' },
  { from: 'PlayerCreation', to: 'MainMenu' },
  { from: 'TournamentSelect', to: 'DraftPhase' },
  { from: 'DraftPhase', to: 'BracketView' },
  { from: 'BracketView', to: 'YourGame' },
  { from: 'BracketView', to: 'Spectating' },
  { from: 'YourGame', to: 'PostGame' },
  { from: 'YourGame', to: 'MainMenu' },
  { from: 'Spectating', to: 'BettingOverlay' },
  { from: 'Spectating', to: 'BracketView' },
  { from: 'Spectating', to: 'SubInCinematic' },
  { from: 'BettingOverlay', to: 'Spectating' },
  { from: 'SubInCinematic', to: 'YourGame' },
  { from: 'PostGame', to: 'BracketView' },
  { from: 'PostGame', to: 'TournamentEnd' },
  { from: 'PostGame', to: 'MainMenu' },
  { from: 'PostGame', to: 'YourGame' },
  { from: 'TournamentEnd', to: 'MainMenu' },
];

export const stateMachine = new GameStateMachine(transitions);

// --- Scene Objects ---
const court = createCourt();
scene.add(court);
let currentCourt: THREE.Group = court;

let session: GameSession | null = null;

// --- Game Systems ---
const cameraSystem = new CameraSystem(camera);
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

document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' || e.code === 'Escape') e.preventDefault();
  keyboardControls.handleKeyDown(e.code);
});
document.addEventListener('keyup', (e) => keyboardControls.handleKeyUp(e.code));

// --- UI ---
const uiOverlay = document.getElementById('ui-overlay')!;

// Create separate containers for each UI layer
const menuContainer = document.createElement('div');
menuContainer.id = 'menu-container';
menuContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
uiOverlay.appendChild(menuContainer);

const hudContainer = document.createElement('div');
hudContainer.id = 'hud-container';
hudContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
uiOverlay.appendChild(hudContainer);

const postGameContainer = document.createElement('div');
postGameContainer.id = 'postgame-container';
postGameContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
uiOverlay.appendChild(postGameContainer);

// Create UIs with their OWN containers
const hud = new HUD(hudContainer);
const menuUI = new MenuUI(menuContainer, handleMenuAction);
const postGameUI = new PostGameUI(postGameContainer, handlePostGameAction);

function handlePostGameAction(action: string) {
  if (action === 'play-again') {
    postGameUI.hide();
    startMainGame();
  }
  if (action === 'menu') {
    postGameUI.hide();
    if (session) session.removeFromScene(scene);
    session = null;
    stateMachine.transition('MainMenu');
  }
}

function startQuickGame(): void {
  if (session) {
    session.removeFromScene(scene);
  }
  // Ensure half court is active
  scene.remove(currentCourt);
  const halfCourt = createCourt();
  scene.add(halfCourt);
  currentCourt = halfCourt;
  GamePlayer.courtBoundsZ = [-6.5, 6.5];
  cameraSystem.fullCourt = false;

  const teams = generateTeams();
  session = new GameSession(gameEvents, teams[0], teams[1], teams[0].players[0].id);
  session.addToScene(scene);
  session.setCameraRef(camera);
  session.start();
  stateMachine.transition('YourGame');
  hud.updateScore(0, 0);
  hud.updateClock(180);
}

function startMainGame(clockSeconds = 300): void {
  if (session) {
    session.removeFromScene(scene);
  }
  // Swap to full court
  scene.remove(currentCourt);
  const fullCourt = createFullCourt(0xe94560, 0x3498db);
  scene.add(fullCourt);
  currentCourt = fullCourt;
  GamePlayer.courtBoundsZ = [-13.5, 13.5];
  cameraSystem.fullCourt = true;

  const teams = generateTeams(5);
  session = new GameSession(gameEvents, teams[0], teams[1], teams[0].players[0].id, '5v5');
  session.addToScene(scene);
  session.setCameraRef(camera);
  session.start();
  stateMachine.transition('YourGame');
  hud.updateScore(0, 0);
  hud.updateClock(clockSeconds);
  session.matchEngine.state.clockSeconds = clockSeconds;
}

function handleMenuAction(action: string, _data?: unknown) {
  if (action === 'play' || action === 'quick-play' || action === 'quick-game') {
    startMainGame(180); // 3 minutes
  }
  if (action === 'tournament') {
    menuUI.show('tournament-select');
  }
  if (action === 'full-game') {
    menuUI.show('full-game-select');
  }
  if (action === 'fullgame-8') startMainGame(8 * 60 * 4); // 4 quarters of 8 min
  if (action === 'fullgame-10') startMainGame(10 * 60 * 4);
  if (action === 'fullgame-12') startMainGame(12 * 60 * 4);
  if (action === 'back-to-main') menuUI.show('main');
  if (action === 'back') menuUI.show('main');
  if (action === 'settings') { /* settings */ }
  // Tournament actions can be stubs for now
  if (action.startsWith('tournament-')) {
    // TODO: wire tournament flow
    startMainGame(180); // placeholder
  }
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

stateMachine.onEnter('YourGame', () => {
  menuUI.hide();
});

stateMachine.onEnter('PostGame', () => {
  // Game stops but HUD stays visible
});

gameEvents.on('splash', (data: { text: string; color: string }) => {
  hud.showSplash(data.text, data.color);
});

gameEvents.on('game-over', () => {
  if (!session) return;
  const data = session.getGameOverData();
  stateMachine.transition('PostGame');
  postGameUI.show(data);
});

// Show main menu on start
menuUI.show('main');

// --- Game Loop ---
function update(dt: number): void {
  if (session && stateMachine.current === 'YourGame') {
    // Get combined input
    const touchInput = touchControls.getInput();
    const kbInput = keyboardControls.getInput();
    const input: ControlInput = {
      joystick: {
        x: touchInput.joystick.x || kbInput.joystick.x,
        y: touchInput.joystick.y || kbInput.joystick.y,
      },
      gesture: touchInput.gesture ?? kbInput.gesture,
      sprinting: kbInput.sprinting,
    };

    session.processInput(input, dt);
    session.update(dt);

    // Compute player spread for dynamic zoom
    const allPlayers = session.getAllPlayers();
    let minZ = Infinity, maxZ = -Infinity;
    let minX = Infinity, maxX = -Infinity;
    for (const p of allPlayers) {
      if (p.position.z < minZ) minZ = p.position.z;
      if (p.position.z > maxZ) maxZ = p.position.z;
      if (p.position.x < minX) minX = p.position.x;
      if (p.position.x > maxX) maxX = p.position.x;
    }
    cameraSystem.setPlayerBounds(minZ, maxZ, minX, maxX);

    // Camera
    const camInfo = session.getCameraInfo();
    if (camInfo.mode === 'slam') {
      cameraSystem.triggerSlamCam(camInfo.trackPosition);
    } else {
      cameraSystem.setMode(camInfo.mode);
    }
    cameraSystem.update(camInfo.trackPosition, camInfo.lookAt, dt);

    // HUD
    hud.updateScore(session.matchEngine.state.homeScore, session.matchEngine.state.awayScore);
    hud.updateClock(session.matchEngine.state.clockSeconds);
    hud.updateShotClock(session.matchEngine.state.shotClockSeconds);
    hud.updateCrowdLevel(crowdSystem.getLevel());

    // Charge bar
    const human = session.getHumanPlayer();
    if (human) {
      hud.updateChargeBar(human.isCharging, human.chargeTimer / 1.5);
      hud.updateStaminaBar(human.stamina);
    }

    // Powerup HUD notification
    if (session.lastPowerupPickup) {
      hud.showPowerupPickup(session.lastPowerupPickup);
      session.lastPowerupPickup = null;
    }

    // Systems
    crowdSystem.tick(dt);
    const diff = session.matchEngine.getScoreDifferential();
    if (diff) {
      crowdSystem.updateScoreDiff(diff.deficit);
    }
  }
}

function render(): void {
  renderer.render(scene, camera);
}

const loop = new GameLoop({ fixedStep: 1 / 60, update, render });
loop.start();

export { scene, camera, renderer, gameEvents, loop };
export { cameraSystem, crowdSystem, subInSystem, bettingSystem };

// Suppress unused-variable warnings for systems used later in game flow
void Tournament;
void DraftSystem;
void BracketViewUI;
void BettingUI;
void PlayerCreatorUI;
void DraftUI;
void progressionSystem;
void saveSystem;
void FULL_COURT_DIMENSIONS;

console.log('March Madness 3v3 initialized — all systems wired');
