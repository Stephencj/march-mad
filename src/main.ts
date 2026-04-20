import * as THREE from 'three';
import { GameLoop } from './core/game-loop';
import { gameEvents } from './core/events';
import { GameStateMachine, type StateTransition } from './core/state-machine';
import { createFullCourt, FULL_COURT_DIMENSIONS } from './game/full-court';
import { createVenue, randomVenue, type VenueId } from './game/venue';
import { setActiveProfileId, getActiveProfile, deleteProfile, SessionWallet } from './meta/profile';
import { BetModal } from './ui/bet-modal';
import { SaveProfilePrompt } from './ui/save-profile-prompt';
import { GameSession } from './game/game-session';
import { GamePlayer } from './game/player';
import { CameraSystem } from './game/camera';
import { InputManager } from './game/input-manager';
import { HapticManager } from './systems/haptics';
import { CrowdSystem } from './systems/crowd';
import { SubInSystem } from './systems/sub-in';
import { BettingSystem } from './meta/betting';
import { Tournament } from './meta/tournament';
import { TournamentController } from './meta/tournament-controller';
import { DraftSystem } from './meta/draft';
import { ProgressionSystem } from './meta/progression';
import { SaveSystem } from './meta/save';
import { generateTeams } from './data/teams';
import type { TeamData, TournamentTier } from './core/types';
import { HUD } from './ui/hud';
import { MenuUI } from './ui/menus';
import { BracketViewUI } from './ui/bracket-view';
import { BettingUI } from './ui/betting-ui';
import { PlayerCreatorUI } from './ui/player-creator';
import { DraftUI } from './ui/draft-ui';
import { PostGameUI, type PostGameContext } from './ui/post-game';
import { PauseMenu } from '@/ui/pause-menu';
import { MenuNavigator } from './ui/menu-navigator';
import { FreeplayPanel } from './ui/freeplay-panel';
import { DevOverlay } from './dev/dev-overlay';

const focusStyle = document.createElement('style');
focusStyle.textContent = `.menu-focused { outline: 2px solid #e94560 !important; outline-offset: 4px; box-shadow: 0 0 10px rgba(233, 69, 96, 0.5); }`;
document.head.appendChild(focusStyle);

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
  { from: 'TournamentSelect', to: 'BracketView' },
  { from: 'DraftPhase', to: 'BracketView' },
  { from: 'MainMenu', to: 'BracketView' },
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
  { from: 'MainMenu', to: 'Freeplay' },
  { from: 'Freeplay', to: 'MainMenu' },
];

export const stateMachine = new GameStateMachine(transitions);

// --- Scene Objects ---
const court = createFullCourt(0xe94560, 0x3498db);
scene.add(court);
let currentCourt: THREE.Group = court;

// Venue scenery — walls/crowd/props around the court. Starts as 'gym'
// (bracket default); quick-match flow can swap to 'rec' / 'park'.
let currentVenueId: VenueId = 'gym';
let currentVenue: THREE.Group = createVenue(currentVenueId);
scene.add(currentVenue);

let session: GameSession | null = null;

// --- Game Systems ---
const cameraSystem = new CameraSystem(camera);
const crowdSystem = new CrowdSystem(gameEvents);
const subInSystem = new SubInSystem();
const bettingSystem = new BettingSystem();
const progressionSystem = new ProgressionSystem();
const saveSystem = new SaveSystem();

// --- Controls ---
const inputManager = new InputManager();
const hapticManager = new HapticManager();
const menuNavigator = new MenuNavigator();

// Touch event listeners
document.addEventListener('touchstart', (e) => {
  const touch = e.changedTouches[0];
  const isLeft = touch.clientX < window.innerWidth / 2;
  inputManager.touchControls.handleTouchStart({
    x: touch.clientX, y: touch.clientY, id: touch.identifier,
    isLeftHalf: isLeft, timestamp: e.timeStamp,
  });
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  const touch = e.changedTouches[0];
  const isLeft = touch.clientX < window.innerWidth / 2;
  inputManager.touchControls.handleTouchMove({
    x: touch.clientX, y: touch.clientY, id: touch.identifier,
    isLeftHalf: isLeft, timestamp: e.timeStamp,
  });
}, { passive: true });

document.addEventListener('touchend', (e) => {
  const touch = e.changedTouches[0];
  const isLeft = touch.clientX < window.innerWidth / 2;
  inputManager.touchControls.handleTouchEnd({
    x: touch.clientX, y: touch.clientY, id: touch.identifier,
    isLeftHalf: isLeft, timestamp: e.timeStamp,
    startX: touch.clientX, startY: touch.clientY, startTimestamp: e.timeStamp,
  });
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' || e.code === 'Escape') e.preventDefault();
  if (e.code === 'F1') {
    e.preventDefault();
    devOverlay.toggle();
    return;
  }
  if (e.code === 'Backquote' && stateMachine.current === 'Freeplay') {
    freeplayPanel?.toggle();
    return;
  }
  if (e.code === 'Escape' && stateMachine.current === 'YourGame') {
    isPaused = !isPaused;
    if (isPaused) {
      pauseMenu.show();
    } else {
      pauseMenu.hide();
    }
    return;
  }
  // V = spend the 3-knockdown INVINCIBILITY buff on the human's team.
  // No-op if count < 3 or already active or session is paused.
  if (e.code === 'KeyV' && !isPaused && session && stateMachine.current === 'YourGame') {
    const humanTeam = session.getPlayerTeam(session.getHumanPlayer()?.data.id ?? '');
    if (humanTeam) session.matchEngine.activateInvincibility(humanTeam);
    return;
  }
  if (!isPaused) {
    inputManager.keyboardControls.handleKeyDown(e.code);
  }
});
document.addEventListener('keyup', (e) => inputManager.keyboardControls.handleKeyUp(e.code));
window.addEventListener('gamepadconnected', (e) => {
  inputManager.handleGamepadConnected(e);
  const pad = navigator.getGamepads()[e.gamepad.index];
  if (pad?.vibrationActuator) {
    hapticManager.setVibrationActuator(pad.vibrationActuator);
  }
});
window.addEventListener('gamepaddisconnected', (e) => inputManager.handleGamepadDisconnected(e));

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

const pauseContainer = document.createElement('div');
pauseContainer.id = 'pause-container';
pauseContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
uiOverlay.appendChild(pauseContainer);

const postGameContainer = document.createElement('div');
postGameContainer.id = 'postgame-container';
postGameContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
uiOverlay.appendChild(postGameContainer);

const bracketContainer = document.createElement('div');
bracketContainer.id = 'bracket-container';
bracketContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
uiOverlay.appendChild(bracketContainer);

const devContainer = document.createElement('div');
devContainer.id = 'dev-container';
devContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
uiOverlay.appendChild(devContainer);
const devOverlay = new DevOverlay(devContainer);

// Create UIs with their OWN containers
const hud = new HUD(hudContainer);
const menuUI = new MenuUI(menuContainer, handleMenuAction);
const betModal = new BetModal(uiOverlay);
const saveProfilePrompt = new SaveProfilePrompt(uiOverlay);
menuUI.setNavigator(menuNavigator);
const postGameUI = new PostGameUI(postGameContainer, handlePostGameAction);
postGameUI.setNavigator(menuNavigator);
const bracketViewUI = new BracketViewUI(bracketContainer, (match) => enterTournamentMatch(match.id));
bracketViewUI.setNavigator(menuNavigator);

let tournamentController: TournamentController | null = null;

let isPaused = false;

// Betting / wallet state.
// The wallet lives across the session so life-savings accumulates across
// multiple matches. Recreated on profile switch via `refreshWallet()`.
let wallet: SessionWallet = SessionWallet.fromActive();
let pendingBet = 0;
/** Number of matches played this session (for the first-game profile-save prompt). */
let guestMatchesThisSession = 0;

function refreshWallet(): void {
  wallet = SessionWallet.fromActive();
}
const pauseMenu = new PauseMenu(pauseContainer, (action) => {
  if (action === 'resume') {
    isPaused = false;
    pauseMenu.hide();
  } else if (action === 'quit') {
    isPaused = false;
    pauseMenu.hide();
    if (session) {
      session.removeFromScene(scene);
      session = null;
    }
    if (freeplayPanel) {
      freeplayPanel.destroy();
      freeplayPanel = null;
    }
    stateMachine.transition('MainMenu');
    menuUI.show('main');
    hud.hide();
  }
});
pauseMenu.setNavigator(menuNavigator);

let freeplayPanel: FreeplayPanel | null = null;

function handlePostGameAction(action: string) {
  if (action === 'play-again') {
    postGameUI.hide();
    startQuickMatch(300);
  }
  if (action === 'tournament-continue') {
    postGameUI.hide();
    if (tournamentController?.champion) {
      // Keep session alive so TournamentEnd can pull final stats.
      stateMachine.transition('TournamentEnd');
    } else {
      if (session) {
        session.removeFromScene(scene);
        session = null;
      }
      stateMachine.transition('BracketView');
    }
  }
  if (action === 'menu') {
    postGameUI.hide();
    if (session) session.removeFromScene(scene);
    session = null;
    stateMachine.transition('MainMenu');
  }
}

interface StartMatchOptions {
  homeTeam: TeamData;
  awayTeam: TeamData;
  clockSeconds: number;
}

function startMainGame(opts: StartMatchOptions & { venueId?: VenueId }): void {
  if (session) {
    session.removeFromScene(scene);
  }
  // Swap to full court + venue scenery
  scene.remove(currentCourt);
  const fullCourt = createFullCourt(0xe94560, 0x3498db);
  scene.add(fullCourt);
  currentCourt = fullCourt;
  scene.remove(currentVenue);
  currentVenueId = opts.venueId ?? 'gym';
  currentVenue = createVenue(currentVenueId);
  scene.add(currentVenue);
  GamePlayer.courtBoundsZ = [-13.5, 13.5];
  cameraSystem.fullCourt = true;

  session = new GameSession(gameEvents, opts.homeTeam, opts.awayTeam, opts.homeTeam.players[0].id, '3v3');
  session.addToScene(scene);
  session.setCameraRef(camera);
  session.setHapticManager(hapticManager);
  session.start();
  stateMachine.transition('YourGame');
  hud.updateScore(0, 0);
  hud.updateClock(opts.clockSeconds);
  session.matchEngine.state.clockSeconds = opts.clockSeconds;
}

/** Wrap startMainGame for non-tournament callers that want auto-generated teams. */
function startQuickMatch(clockSeconds: number, venueId?: VenueId): void {
  const teams = generateTeams(5);
  startMainGame({ homeTeam: teams[0], awayTeam: teams[1], clockSeconds, venueId });
}

/**
 * Venue chosen — pop the bet modal before starting the match. "Play For Free"
 * is offered too (sets bet = 0 so settlement is a no-op).
 */
function promptBetThenQuickMatch(clockSeconds: number, venueId: VenueId): void {
  const venueLabel = venueId === 'gym' ? 'High School Gym' : venueId === 'rec' ? 'Rec Center' : 'Suburban Park';
  betModal.show({
    wallet,
    matchLabel: `Pickup Game — ${venueLabel}`,
    allowSkip: true,
    onCancel: () => menuUI.show('venue-select'),
    onConfirm: (amount) => {
      pendingBet = amount;
      startQuickMatch(clockSeconds, venueId);
    },
  });
}

function enterTournamentMatch(matchId: string): void {
  if (!tournamentController) return;
  const ctx = tournamentController.enterMatch(matchId);
  // Bracket matches always use the high-school gym. Pop the bet modal
  // first — "Play For Free" is allowed here too since a bracket run can
  // be a lot of matches and the user might want to coast one out.
  const homeName = ctx.homeTeam.name;
  const awayName = ctx.awayTeam.name;
  betModal.show({
    wallet,
    matchLabel: `${homeName} vs ${awayName}`,
    allowSkip: true,
    onCancel: () => stateMachine.transition('BracketView'),
    onConfirm: (amount) => {
      pendingBet = amount;
      startMainGame({ homeTeam: ctx.homeTeam, awayTeam: ctx.awayTeam, clockSeconds: 180, venueId: 'gym' });
    },
  });
}

function startTournament(tier: TournamentTier): void {
  tournamentController?.dispose();
  tournamentController = new TournamentController(tier);
  stateMachine.transition('BracketView');
}

function startFreeplay(): void {
  if (session) {
    session.removeFromScene(scene);
  }
  scene.remove(currentCourt);
  const fullCourt = createFullCourt(0xe94560, 0x3498db);
  scene.add(fullCourt);
  currentCourt = fullCourt;
  GamePlayer.courtBoundsZ = [-13.5, 13.5];
  cameraSystem.fullCourt = true;

  const teams = generateTeams(5);
  session = new GameSession(gameEvents, teams[0], teams[1], teams[0].players[0].id, '3v3');
  session.addToScene(scene);
  session.setCameraRef(camera);
  session.setHapticManager(hapticManager);
  session.setFreeplayMode();
  session.start();

  const allPlayers = session.getAllPlayers();
  const playerInfos = allPlayers.map(p => ({
    id: p.data.id,
    name: p.data.name,
    position: p.data.position ?? '',
    team: (session!.isHomePlayer(p) ? 'home' : 'away') as 'home' | 'away',
  }));

  // Use a dedicated container for the freeplay panel so pointer-events work
  let fpContainer = document.getElementById('freeplay-container');
  if (!fpContainer) {
    fpContainer = document.createElement('div');
    fpContainer.id = 'freeplay-container';
    fpContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    uiOverlay.appendChild(fpContainer);
  }
  freeplayPanel = new FreeplayPanel(
    fpContainer,
    (playerId, enabled) => {
      if (enabled) session!.enableAI(playerId);
      else session!.disableAI(playerId);
    },
    (playerId, isVisible) => {
      const player = session!.getAllPlayers().find(p => p.data.id === playerId);
      if (player) player.group.visible = isVisible;
    },
  );
  freeplayPanel.setup(playerInfos, teams[0].players[0].id);
  freeplayPanel.show();

  stateMachine.transition('Freeplay');
  hud.updateScore(0, 0);
  hud.updateClock(99999);
}

function handleMenuAction(action: string, _data?: unknown) {
  if (action === 'play' || action === 'quick-play' || action === 'quick-game') {
    menuUI.show('venue-select');
  }
  if (action === 'venue-gym') promptBetThenQuickMatch(180, 'gym');
  if (action === 'venue-rec') promptBetThenQuickMatch(180, 'rec');
  if (action === 'venue-park') promptBetThenQuickMatch(180, 'park');
  if (action === 'profile') menuUI.show('profile');
  if (action === 'profile-create') menuUI.show('profile-create');
  if (action === 'profile-play-as-guest') {
    // Clear the active pointer; the menu will redraw with guest state.
    setActiveProfileId(null);
    menuUI.show('profile');
  }
  if (action === 'profile-delete-active') {
    const active = getActiveProfile();
    if (active) deleteProfile(active.id);
    refreshWallet();
    menuUI.show('profile');
  }
  if (action === 'profile' || action === 'profile-play-as-guest') {
    // Refresh wallet whenever we re-enter the profile menu so switches land.
    refreshWallet();
  }
  if (action === 'tournament') {
    menuUI.show('tournament-select');
  }
  if (action === 'full-game') {
    menuUI.show('full-game-select');
  }
  if (action === 'fullgame-8') startQuickMatch(8 * 60 * 4); // 4 quarters of 8 min
  if (action === 'fullgame-10') startQuickMatch(10 * 60 * 4);
  if (action === 'fullgame-12') startQuickMatch(12 * 60 * 4);
  if (action === 'back-to-main') menuUI.show('main');
  if (action === 'back') menuUI.show('main');
  if (action === 'settings') { /* settings */ }
  if (action === 'freeplay') {
    startFreeplay();
  }
  if (action === 'tournament-8') startTournament('casual');
  if (action === 'tournament-16') startTournament('sweet16');
  if (action === 'tournament-64') startTournament('season');
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
  hud.show();
});

stateMachine.onExit('Freeplay', () => {
  if (freeplayPanel) {
    freeplayPanel.destroy();
    freeplayPanel = null;
  }
});

stateMachine.onEnter('PostGame', () => {
  // Game stops but HUD stays visible
});

stateMachine.onEnter('BracketView', () => {
  if (!tournamentController) return;
  bracketContainer.style.pointerEvents = 'auto';
  hud.hide();
  bracketViewUI.render(tournamentController.allMatches, tournamentController.currentRound);
  const next = tournamentController.getNextHumanMatch();
  if (next) bracketViewUI.focusMatch(next.id);
});

stateMachine.onExit('BracketView', () => {
  bracketViewUI.hide();
  bracketContainer.style.pointerEvents = 'none';
});

stateMachine.onEnter('TournamentEnd', () => {
  const champ = tournamentController?.champion;
  if (!champ || !session) {
    stateMachine.transition('MainMenu');
    return;
  }
  postGameUI.show(session.getGameOverData(), {
    mode: 'tournament-end',
    championName: champ.name,
  });
});

// Cleanup tournament state when returning to MainMenu.
stateMachine.onEnter('MainMenu', () => {
  if (tournamentController) {
    tournamentController.dispose();
    tournamentController = null;
  }
});

gameEvents.on('splash', (data: { text: string; color: string }) => {
  hud.showSplash(data.text, data.color);
});

// Haptic feedback for game events
gameEvents.on('score', () => hapticManager.onScore());
gameEvents.on('foul', () => hapticManager.onFoul());
gameEvents.on('powerup', () => hapticManager.onPowerupPickup());

gameEvents.on('game-over', () => {
  if (!session) return;
  const data = session.getGameOverData();

  // Settle the bet if one was placed. `pendingBet` is 0 for Play-For-Free.
  let matchDelta = 0;
  if (pendingBet > 0) {
    const entry = wallet.settleMatch(pendingBet, data.humanWon ? 'win' : 'loss', { venueId: currentVenueId });
    matchDelta = entry.delta;
  }
  const wasGuest = wallet.isGuest();
  if (wasGuest) guestMatchesThisSession++;
  pendingBet = 0;

  // If this was a guest's FIRST match this session, pop the save-profile
  // prompt before the post-game UI. Only fires once per session.
  if (wasGuest && guestMatchesThisSession === 1) {
    saveProfilePrompt.show({
      wallet,
      matchDelta,
      onSaved: (name) => {
        wallet.saveGuestAs(name);
        refreshWallet();
      },
      onSkipped: () => { /* keep playing as guest */ },
    });
  }

  if (tournamentController?.isActive) {
    tournamentController.recordHumanResult(data.winner);
    stateMachine.transition('PostGame');
    postGameUI.show(data, {
      mode: 'tournament',
      isChampion: !!tournamentController.champion,
    } satisfies PostGameContext);
    return;
  }

  stateMachine.transition('PostGame');
  postGameUI.show(data);
});

// Show main menu on start
menuUI.show('main');

// --- Game Loop ---
function update(dt: number): void {
  // Menu navigation polling
  if (menuNavigator.active) {
    const gpIdx = inputManager.gamepadIndex;
    const pad = gpIdx !== null ? (navigator.getGamepads?.()[gpIdx] ?? null) : null;
    menuNavigator.update(pad);
  }

  const isPlaying = stateMachine.current === 'YourGame' || stateMachine.current === 'Freeplay';

  // Check gamepad pause (must run outside isPaused guard so gamepad can unpause)
  if (session && isPlaying && inputManager.checkPause()) {
    isPaused = !isPaused;
    if (isPaused) {
      pauseMenu.show();
    } else {
      pauseMenu.hide();
    }
  }

  if (session && isPlaying && !isPaused) {
    const input = inputManager.getInput();
    hud.updateControllerIcon(inputManager.getControllerType());

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

    // Knockdown counters + buff hint/banner
    hud.updateKnockdowns(session.matchEngine.knockdownCount.home, session.matchEngine.knockdownCount.away);
    hud.updateLifeSavings(wallet.getDisplayName(), wallet.getCash(), pendingBet);
    const humanTeamNow = session.getPlayerTeam(session.getHumanPlayer()?.data.id ?? '');
    if (humanTeamNow) {
      const inv = session.matchEngine.invincibility[humanTeamNow];
      if (inv.active) {
        if (inv.mutantPlayerId) {
          hud.showBuffBanner('MUTANT — ' + Math.ceil(inv.timer) + 's', '#ff00ff');
        } else {
          hud.showBuffBanner('INVINCIBLE — ' + Math.ceil(inv.timer) + 's', '#ffd700');
        }
        hud.hideBuffHint();
      } else {
        hud.hideBuffBanner();
        const count = session.matchEngine.knockdownCount[humanTeamNow];
        if (count >= 5) {
          hud.showBuffHint('MUTANT READY — firing…'); // auto-activates next tick
        } else if (count >= 3) {
          hud.showBuffHint('Press V to go INVINCIBLE (' + count + '/5)');
        } else {
          hud.hideBuffHint();
        }
      }
    } else {
      hud.hideBuffBanner();
      hud.hideBuffHint();
    }

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

console.log('March Madness 3v3 initialized — all systems wired');
