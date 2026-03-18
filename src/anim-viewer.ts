import * as THREE from 'three';
import { GamePlayer } from './game/player';
import { Ball } from './game/ball';
import { createHoop } from './game/hoop';
import { createDefaultPlayerStats } from './core/types';
import type { Position } from './core/types';

// --- Renderer ---
const canvas = document.getElementById('viewer-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
camera.position.set(0, 1.5, 4);
camera.lookAt(0, 0.8, 0);

function resize() {
  const wrap = document.getElementById('canvas-wrap')!;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- Lighting ---
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(3, 8, 5);
scene.add(dirLight);

// --- Ground platform ---
const platformGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.05, 24);
const platformMat = new THREE.MeshStandardMaterial({ color: 0x333355 });
const platform = new THREE.Mesh(platformGeo, platformMat);
platform.position.y = -0.025;
scene.add(platform);

// --- Hoop ---
const hoopPos = new THREE.Vector3(0, 3.05, 2.5); // closer for dunking
const hoop = createHoop(hoopPos, 0xe94560);
hoop.rotation.y = Math.PI; // rotate 180° so backboard faces the player
scene.add(hoop);

// Grid lines on platform for reference
const gridGeo = new THREE.RingGeometry(0.5, 0.52, 24);
const gridMat = new THREE.MeshBasicMaterial({ color: 0x555577, side: THREE.DoubleSide });
const grid1 = new THREE.Mesh(gridGeo, gridMat);
grid1.rotation.x = -Math.PI / 2;
grid1.position.y = 0.01;
scene.add(grid1);
const grid2 = grid1.clone();
grid2.scale.set(2, 2, 2);
scene.add(grid2);

// --- Player ---
let currentAnim = 'idle';
let animSpeed = 1;
let autoRotate = true;
let camAngle = 0;
let camHeight = 1.5;
let camDist = 4;
let shootReleased = false;
let dunkReleased = false;
let shootResetDelay = 0;
let shootBallFalling = false;
let shootInIdle = false;
let shootIdleTimer = 0;

let player: GamePlayer;

function createPlayer(teamColor: number, hairId: number, position?: Position) {
  if (player) {
    scene.remove(player.group);
  }
  const stats = createDefaultPlayerStats();
  player = new GamePlayer({
    id: `viewer-${hairId}`,
    name: 'Viewer Player',
    stats,
    personality: 'Team Player',
    isCustom: false,
    position,
    hairOverride: hairId,
  } as any, new THREE.Vector3(0, 0, 0), teamColor);

  player.isHumanControlled = true; // show the indicator
  scene.add(player.group);
}

createPlayer(0xe94560, 0);

// --- Ball for dribble/shoot/dunk preview ---
const ball = new Ball(new THREE.Vector3(0, 1, 0));
scene.add(ball.mesh);

// --- Animation Loop ---
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const rawDt = (now - lastTime) / 1000;
  lastTime = now;
  const dt = rawDt * animSpeed;

  // Drive the animation state
  switch (currentAnim) {
    case 'idle':
      player.hasBall = false;
      player.velocity.set(0, 0, 0);
      break;
    case 'walk':
      player.hasBall = false;
      // Simulate movement velocity without actually moving
      player.velocity.set(0, 0, 2);
      break;
    case 'dribble':
      player.hasBall = true;
      player.velocity.set(0, 0, 0); // stationary dribble
      break;
    case 'dribble-walk':
      player.hasBall = true;
      player.velocity.set(0, 0, 2); // moving dribble
      break;
    case 'guard':
      player.hasBall = false;
      player.velocity.set(0, 0, 0);
      break;
    case 'steal':
      player.hasBall = false;
      player.velocity.set(0, 0, 0);
      if ((player as unknown as { stealTimer: number }).stealTimer <= 0) {
        player.triggerSteal();
      }
      break;
    case 'shoot':
      player.velocity.set(0, 0, 0);
      if (shootInIdle) {
        // Idle pause between shots
        player.hasBall = false;
      } else if (shootReleased) {
        // Ball has been released — NEVER set hasBall true again
        player.hasBall = false;
      } else {
        player.hasBall = true; // start with ball (only before release)
        if ((player as unknown as { shootTimer: number }).shootTimer <= 0 && shootResetDelay <= 0) {
          player.triggerShoot();
        }
      }
      break;
    case 'jump':
      player.hasBall = false;
      player.velocity.set(0, 0, 0);
      if (!player.isJumping) {
        player.jump();
      }
      break;
    case 'sprint':
      player.hasBall = false;
      player.isSprinting = true;
      player.velocity.set(0, 0, 3);
      break;
    case 'dribble-sprint':
      player.hasBall = true;
      player.isSprinting = true;
      player.velocity.set(0, 0, 3);
      break;
    case 'jump-block':
      player.hasBall = false;
      player.velocity.set(0, 0, 0);
      if (!player.isJumping) player.jump();
      break;
    case 'fall':
      player.hasBall = false;
      player.velocity.set(0, 0, 0);
      break;
    case 'dunk':
      player.hasBall = true;
      player.velocity.set(0, 0, 0);
      if ((player as unknown as { dunkTimer: number }).dunkTimer <= 0) {
        // Reset
        ball.pickup('viewer');
        ball.isInFlight = false;
        player.triggerDunk();
        dunkReleased = false;
      }
      break;
    case 'pass':
      player.hasBall = true;
      player.velocity.set(0, 0, 0);
      if ((player as unknown as { passTimer: number }).passTimer <= 0) {
        player.triggerPass();
      }
      break;
  }

  // Set forced state for guard/fall/dunk (forceAnimState is checked inside animate)
  if (currentAnim === 'guard') {
    player.forceAnimState('guard');
  }
  if (currentAnim === 'fall') {
    player.forceAnimState('fall');
    if ((player as unknown as { fallTimer: number }).fallTimer <= 0) {
      player.triggerFall();
    }
  }
  if (currentAnim === 'dunk') {
    player.forceAnimState('dunk');
  }

  player.animate(dt);

  // CRITICAL: Force hasBall=false after animate() when ball has been released
  // This prevents player.animate() from auto-detecting 'dribble' state
  if (currentAnim === 'shoot' && shootReleased) {
    player.hasBall = false;
  }

  // Handle shoot ball release
  if (currentAnim === 'shoot') {
    const shootTimer = (player as unknown as { shootTimer: number }).shootTimer;

    // Release ball at the right moment
    if (!shootReleased && shootTimer > 0 && shootTimer < 0.2) {
      shootReleased = true;
      player.hasBall = false;
      ball.release();
      ball.shootAt(new THREE.Vector3(0, 3.05, 2.5), 0.8);
      shootBallFalling = false;
    }

    // Keep ball updating if in flight
    if (ball.isInFlight) {
      ball.update(dt);
    }

    // When arc finishes, release the ball so it falls with gravity
    if (shootReleased && !ball.isInFlight && ball.heldBy !== null) {
      ball.release();
    }

    // When arc just finished, give it downward velocity to fall through net
    if (shootReleased && !ball.isInFlight && !shootBallFalling && ball.heldBy === null) {
      ball.velocity.set(0, -3, 0); // gentle drop through net
      shootBallFalling = true;
    }

    // Ball falling after arc — update physics
    if (shootReleased && !ball.isInFlight && ball.heldBy === null) {
      ball.update(dt);
    }

    // Keep player NOT dribbling after shot
    if (shootReleased) {
      player.hasBall = false;
    }

    // After ball lands and shoot is done, wait then reset
    if (shootReleased && !ball.isInFlight && shootTimer <= 0) {
      shootResetDelay += dt;
      if (shootResetDelay > 1.5) {
        // Full reset — go to idle first, not straight to next shot
        ball.pickup('viewer');
        ball.isInFlight = false;
        shootBallFalling = false;
        shootReleased = false;
        shootResetDelay = 0;
        // Idle pause before next shot
        shootInIdle = true;
        shootIdleTimer = 1.0;
        player.hasBall = false;
      }
    }

    // Idle pause between shots
    if (shootInIdle) {
      shootIdleTimer -= dt;
      player.hasBall = false;
      if (shootIdleTimer <= 0) {
        shootInIdle = false;
        player.hasBall = true;
        ball.pickup('viewer');
        player.triggerShoot();
      }
    }

    ball.mesh.visible = true;

    // While ball is in hand, track it
    if (ball.heldBy) {
      ball.followHolder(player.group, false, 0);
    }
  }

  // Handle dunk ball release + body swing
  if (currentAnim === 'dunk') {
    const dunkTimer = (player as unknown as { dunkTimer: number }).dunkTimer;
    const dunkDuration2 = 1.2;
    const dunkProg = 1 - (dunkTimer / dunkDuration2);

    // Release ball at SLAM point — animate it going UP and INTO the hoop
    if (!dunkReleased && dunkProg > 0.38) {
      dunkReleased = true;
      player.hasBall = false;
      ball.release();
      // Start ball at player's hand height, above the rim
      ball.mesh.position.set(0, 3.2, 2.5); // just above rim
      ball.velocity.set(0, -4, 0); // drop through
    }

    if (!ball.heldBy && dunkReleased) {
      ball.update(dt);
    } else if (ball.heldBy) {
      ball.followHolder(player.group, false);
    }
    ball.mesh.visible = true;

    // Body swing during rim hang handled in the positioning block below
    if (dunkProg < 0.45 || dunkProg >= 0.65) {
      player.group.rotation.x = 0;
    }
  } else {
    player.group.rotation.x = 0;
  }

  // Ball visibility and position for dribble animations
  if (currentAnim === 'dribble' || currentAnim === 'dribble-walk' || currentAnim === 'dribble-sprint') {
    ball.mesh.visible = true;
    ball.pickup('viewer');
    ball.followHolder(player.group, true, player.dribblePhase);
  } else if (currentAnim === 'pass') {
    ball.mesh.visible = true;
    ball.pickup('viewer');
    ball.followHolder(player.group, false, 0);
  } else if (currentAnim !== 'shoot' && currentAnim !== 'dunk') {
    // Non-ball animations
    ball.mesh.visible = false;
  }
  // shoot and dunk handled separately above

  // Keep player on platform (don't let bouncing move them off)
  // BUT during dunk, let them move toward the hoop
  if (currentAnim !== 'dunk') {
    player.group.position.x = 0;
    player.group.position.z = 0;
  } else {
    // During dunk, TRUE PARABOLIC ARC from start to hoop
    const dunkTimer2 = (player as unknown as { dunkTimer: number }).dunkTimer;
    const dunkDuration3 = 1.2;
    const dunkProgress = 1 - (dunkTimer2 / dunkDuration3);
    const hoopZ = 2.5; // match the hoop position

    // Pendulum parameters for rim hang
    const rimY = 3.05; // rim height (world Y)
    const pendulumLen = 1.8; // hand-on-rim to feet distance

    if (dunkProgress < 0.35) {
      // Arc phase: jump TO the hoop in a parabola
      const arcT = dunkProgress / 0.35; // 0 to 1
      player.group.position.z = arcT * hoopZ; // linear z toward hoop
      // Feet at 1.25 means hand reaches ~3.05 (rim height)
      const endY = rimY - pendulumLen; // ~1.25
      const overshoot = 1.0; // peak above endY at midpoint
      player.group.position.y = endY * arcT + overshoot * Math.sin(arcT * Math.PI);
    } else if (dunkProgress < 0.45) {
      // Slam phase — at hoop, straight hang
      player.group.position.z = hoopZ;
      player.group.position.y = rimY - pendulumLen;
      player.group.rotation.x = 0;
    } else if (dunkProgress < 0.65) {
      // RIM HANG — pendulum swing from hand on rim
      // Hand grips rim at (0, rimY, hoopZ). Body hangs as pendulum below.
      const hangT = (dunkProgress - 0.45) / 0.2; // 0 to 1

      // Pendulum angle: slow tilt in, slightly faster tilt out before dismount
      let angle: number;
      if (hangT < 0.5) {
        // Slow inward tilt
        angle = hangT * 2 * 0.25; // 0 to 0.25 radians over first half
      } else {
        // Slightly faster outward tilt before dismount
        const outT = (hangT - 0.5) / 0.5;
        angle = 0.25 - outT * 0.35; // 0.25 to -0.1 (swings past center)
      }

      // Player position computed from pendulum pivot at rim
      player.group.position.y = rimY - Math.cos(angle) * pendulumLen;
      player.group.position.z = hoopZ - Math.sin(angle) * pendulumLen;
      player.group.rotation.x = angle; // body tilts with the swing
    } else if (dunkProgress < 0.85) {
      // Drop from rim
      const dropT = (dunkProgress - 0.65) / 0.2;
      // Start from where pendulum ended (angle = -0.1)
      const startY = rimY - Math.cos(-0.1) * pendulumLen;
      const startZ = hoopZ - Math.sin(-0.1) * pendulumLen;
      player.group.position.z = startZ + (hoopZ - startZ) * dropT;
      player.group.position.y = startY * (1 - dropT);
      player.group.rotation.x = -0.1 * (1 - dropT); // straighten during drop
    } else {
      // On ground — landing
      player.group.position.z = hoopZ;
      player.group.position.y = 0;
    }
    player.group.position.x = 0;
  }

  // Camera orbit
  if (autoRotate) {
    camAngle += rawDt * 0.5;
  }
  // Pull camera back for airborne animations
  let viewCamDist = camDist;
  let viewCamHeight = camHeight;
  if (currentAnim === 'dunk' || currentAnim === 'jump' || currentAnim === 'jump-block' || currentAnim === 'fall') {
    viewCamDist = Math.max(camDist, 6); // at least 6 units back
    viewCamHeight = Math.max(camHeight, 3); // higher to see the arc
  }
  camera.position.set(
    Math.sin(camAngle) * viewCamDist,
    viewCamHeight,
    Math.cos(camAngle) * viewCamDist
  );
  if (currentAnim === 'shoot' || currentAnim === 'dunk') {
    camera.lookAt(0, 1.5, 1.25); // between player and hoop (hoop at z=2.5)
  } else {
    camera.lookAt(0, 0.8, 0);
  }

  renderer.render(scene, camera);
}
animate();

// --- UI Wiring ---
// Animation buttons
document.querySelectorAll('[data-anim]').forEach(btn => {
  btn.addEventListener('click', () => {
    currentAnim = (btn as HTMLElement).dataset.anim!;
    document.querySelectorAll('[data-anim]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('state-label')!.textContent = currentAnim;
    // Reset timers and forced state so the new animation can start fresh
    (player as unknown as { stealTimer: number }).stealTimer = 0;
    (player as unknown as { shootTimer: number }).shootTimer = 0;
    (player as unknown as { fallTimer: number }).fallTimer = 0;
    (player as unknown as { dunkTimer: number }).dunkTimer = 0;
    (player as unknown as { passTimer: number }).passTimer = 0;
    player.isJumping = false;
    player.isSprinting = false;
    shootReleased = false;
    dunkReleased = false;
    shootResetDelay = 0;
    shootBallFalling = false;
    shootInIdle = false;
    shootIdleTimer = 0;
    // Reset player position (dunk moves them forward)
    player.group.position.set(0, 0, 0);
    // Clear forced state — only re-force if selecting guard/fall/dunk
    if (currentAnim === 'guard') {
      player.forceAnimState('guard');
    } else if (currentAnim === 'fall') {
      player.forceAnimState('fall');
    } else if (currentAnim === 'dunk') {
      player.forceAnimState('dunk');
    } else {
      player.forceAnimState(null);
    }
  });
});

// Speed slider
const speedSlider = document.getElementById('speed') as HTMLInputElement;
speedSlider.addEventListener('input', () => {
  animSpeed = parseFloat(speedSlider.value);
  document.getElementById('speed-val')!.textContent = animSpeed.toFixed(1) + 'x';
});

// Position selector
const posSelect = document.getElementById('position') as HTMLSelectElement;
posSelect.addEventListener('change', () => {
  const pos = posSelect.value as Position | '';
  const colorInput = document.getElementById('team-color') as HTMLInputElement;
  const hairSelect = document.getElementById('hair-style') as HTMLSelectElement;
  const color = parseInt(colorInput.value.replace('#', ''), 16);
  createPlayer(color, parseInt(hairSelect.value), pos || undefined);
});

// Camera controls
const autoRotateCheck = document.getElementById('auto-rotate') as HTMLInputElement;
autoRotateCheck.addEventListener('change', () => { autoRotate = autoRotateCheck.checked; });

const camHeightSlider = document.getElementById('cam-height') as HTMLInputElement;
camHeightSlider.addEventListener('input', () => {
  camHeight = parseFloat(camHeightSlider.value);
  document.getElementById('cam-height-val')!.textContent = camHeight.toFixed(1);
});

const camDistSlider = document.getElementById('cam-dist') as HTMLInputElement;
camDistSlider.addEventListener('input', () => {
  camDist = parseFloat(camDistSlider.value);
  document.getElementById('cam-dist-val')!.textContent = camDist.toFixed(1);
});

// Appearance
const hairSelect = document.getElementById('hair-style') as HTMLSelectElement;
hairSelect.addEventListener('change', () => {
  const colorInput = document.getElementById('team-color') as HTMLInputElement;
  const color = parseInt(colorInput.value.replace('#', ''), 16);
  const pos = (document.getElementById('position') as HTMLSelectElement).value as Position | '';
  createPlayer(color, parseInt(hairSelect.value), pos || undefined);
});

const colorInput = document.getElementById('team-color') as HTMLInputElement;
colorInput.addEventListener('input', () => {
  const color = parseInt(colorInput.value.replace('#', ''), 16);
  const pos = (document.getElementById('position') as HTMLSelectElement).value as Position | '';
  createPlayer(color, parseInt(hairSelect.value), pos || undefined);
});
