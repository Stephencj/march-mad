# Phase A: Game Loop Completeness — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the game feel complete for a single play session — post-game results, play again flow, visual powerups on court, slam cam on big plays, and game-over handling.

**Architecture:** Add a post-game results overlay UI, wire the game-over event to show results with XP/coins, add "Play Again" and "Main Menu" buttons. Add powerup orbs as 3D meshes on the court that players pick up. Trigger slam cam on dunks and blocks. Wire the YourGame→PostGame→MainMenu state transitions.

**Tech Stack:** Three.js, existing game systems, DOM overlays

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/ui/post-game.ts` | Post-game results overlay: final score, MVP, XP earned, coins earned, "Play Again" and "Main Menu" buttons |
| `src/game/powerup-visuals.ts` | 3D powerup orb meshes on the court, glow effect, pickup collision detection |

### Modified Files
| File | Changes |
|------|---------|
| `src/main.ts` | Listen for game-over event, show post-game UI, handle play-again/menu transitions, trigger slam cam |
| `src/game/game-session.ts` | Emit game stats on game-over, integrate powerup orb pickup detection, trigger slam cam on dunks |
| `src/game/camera.ts` | Expose triggerSlamCam publicly (already exists but unused) |
| `src/ui/hud.ts` | Add game-over state (dim/hide during post-game), show powerup pickup notification |
| `src/core/types.ts` | Add `GameOverData` interface |

---

## Chunk 1: Post-Game Screen + Game Over Flow

### Task 1: GameOverData Type

**Files:**
- Modify: `src/core/types.ts`

- [ ] **Step 1: Add GameOverData interface**

Add to `src/core/types.ts`:
```typescript
export interface GameOverData {
  winner: 'home' | 'away';
  homeScore: number;
  awayScore: number;
  humanTeam: 'home' | 'away';
  humanWon: boolean;
  humanStats: { points: number; assists: number; steals: number };
  xpEarned: number;
  coinsEarned: number;
  gameDuration: number; // seconds played
}
```

- [ ] **Step 2: Commit** — `git commit -m "feat: add GameOverData interface"`

---

### Task 2: Post-Game UI

**Files:**
- Create: `src/ui/post-game.ts`
- Test: `tests/ui/post-game.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/ui/post-game.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { PostGameUI } from '@/ui/post-game';
import type { GameOverData } from '@/core/types';

describe('PostGameUI', () => {
  it('renders win screen with score', () => {
    const container = document.createElement('div');
    const onAction = vi.fn();
    const ui = new PostGameUI(container, onAction);
    ui.show({
      winner: 'home', homeScore: 21, awayScore: 15,
      humanTeam: 'home', humanWon: true,
      humanStats: { points: 12, assists: 3, steals: 2 },
      xpEarned: 95, coinsEarned: 50, gameDuration: 145,
    });
    expect(container.textContent).toContain('YOU WIN');
    expect(container.textContent).toContain('21');
    expect(container.textContent).toContain('15');
  });

  it('renders loss screen', () => {
    const container = document.createElement('div');
    const onAction = vi.fn();
    const ui = new PostGameUI(container, onAction);
    ui.show({
      winner: 'away', homeScore: 15, awayScore: 21,
      humanTeam: 'home', humanWon: false,
      humanStats: { points: 8, assists: 1, steals: 0 },
      xpEarned: 45, coinsEarned: 10, gameDuration: 180,
    });
    expect(container.textContent).toContain('YOU LOSE');
  });

  it('shows XP and coins earned', () => {
    const container = document.createElement('div');
    const ui = new PostGameUI(container, vi.fn());
    ui.show({
      winner: 'home', homeScore: 21, awayScore: 10,
      humanTeam: 'home', humanWon: true,
      humanStats: { points: 15, assists: 5, steals: 1 },
      xpEarned: 130, coinsEarned: 75, gameDuration: 120,
    });
    expect(container.textContent).toContain('130');
    expect(container.textContent).toContain('75');
  });

  it('hides on hide()', () => {
    const container = document.createElement('div');
    const ui = new PostGameUI(container, vi.fn());
    ui.show({
      winner: 'home', homeScore: 21, awayScore: 10,
      humanTeam: 'home', humanWon: true,
      humanStats: { points: 10, assists: 2, steals: 1 },
      xpEarned: 80, coinsEarned: 40, gameDuration: 150,
    });
    ui.hide();
    expect(container.children.length).toBe(0);
  });
});
```

- [ ] **Step 2: Implement PostGameUI**

Create `src/ui/post-game.ts` using safe DOM methods (createElement, textContent, appendChild):

The UI shows:
- Big "YOU WIN!" or "YOU LOSE" text with appropriate color (green/red)
- Final score: "21 - 15"
- Player stats: Points, Assists, Steals
- XP earned with a bar showing progress
- Coins earned
- Two buttons: "PLAY AGAIN" (action='play-again') and "MAIN MENU" (action='menu')
- Semi-transparent dark overlay behind everything

- [ ] **Step 3: Run tests** — All 4 PASS
- [ ] **Step 4: Commit** — `git commit -m "feat: add post-game results screen with stats, XP, coins, play again"`

---

### Task 3: Game Session Emits Stats on Game Over

**Files:**
- Modify: `src/game/game-session.ts`
- Test: `tests/game/game-session.test.ts`

- [ ] **Step 1: Add getGameOverData method to GameSession**

```typescript
getGameOverData(): GameOverData {
  const humanPlayer = this.getHumanPlayer();
  const humanTeam = this.getPlayerTeam(this.humanPlayerId);
  const winner = this.matchEngine.state.homeScore >= this.matchEngine.state.awayScore ? 'home' : 'away';
  const humanWon = winner === humanTeam;

  const xp = ProgressionSystem.calculateXP({
    won: humanWon,
    points: humanPlayer.performanceScore,
    assists: 0, // could track this separately
    subbedIn: false,
  });

  return {
    winner,
    homeScore: this.matchEngine.state.homeScore,
    awayScore: this.matchEngine.state.awayScore,
    humanTeam,
    humanWon,
    humanStats: {
      points: humanPlayer.performanceScore,
      assists: 0,
      steals: 0,
    },
    xpEarned: xp,
    coinsEarned: humanWon ? 50 : 10,
    gameDuration: 180 - this.matchEngine.state.clockSeconds,
  };
}
```

Import `ProgressionSystem` from `@/meta/progression` and `GameOverData` from `@/core/types`.

- [ ] **Step 2: Add test**

```typescript
it('provides game over data', () => {
  const events = new EventBus();
  const session = new GameSession(events, makeTeam('h', 'Home'), makeTeam('a', 'Away'), 'h-1');
  session.start();
  session.handleMadeShot('home', 'three-pointer');
  const data = session.getGameOverData();
  expect(data.homeScore).toBe(2);
  expect(data.humanTeam).toBe('home');
  expect(data.xpEarned).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Run tests** — PASS
- [ ] **Step 4: Commit** — `git commit -m "feat: GameSession provides game-over stats with XP and coins"`

---

### Task 4: Wire Game Over Flow in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Import and instantiate PostGameUI**

```typescript
import { PostGameUI } from './ui/post-game';

const postGameUI = new PostGameUI(uiOverlay, handlePostGameAction);

function handlePostGameAction(action: string) {
  if (action === 'play-again') {
    postGameUI.hide();
    // Restart same game mode
    if (cameraSystem.fullCourt) {
      startMainGame();
    } else {
      startQuickGame();
    }
  }
  if (action === 'menu') {
    postGameUI.hide();
    if (session) session.removeFromScene(scene);
    session = null;
    stateMachine.transition('MainMenu');
  }
}
```

- [ ] **Step 2: Listen for game-over event**

```typescript
gameEvents.on('game-over', () => {
  if (!session) return;
  const data = session.getGameOverData();
  postGameUI.show(data);
  // Stop processing input
  stateMachine.transition('PostGame');
});
```

- [ ] **Step 3: Add PostGame and MainMenu state transitions**

Add `{ from: 'YourGame', to: 'PostGame' }` — already exists.
Add `{ from: 'PostGame', to: 'MainMenu' }` — already exists.

Add state hooks:
```typescript
stateMachine.onEnter('PostGame', () => {
  // HUD stays visible but game stops updating
});
```

- [ ] **Step 4: Update the game loop** — don't process input or update session when in PostGame:

Change the `if (session && stateMachine.current === 'YourGame')` check to also stop on PostGame.

- [ ] **Step 5: Verify build** — `npx vite build` — exit 0
- [ ] **Step 6: Commit** — `git commit -m "feat: wire game-over to post-game screen with play again and main menu"`

---

## Chunk 2: Powerup Visuals + Slam Cam

### Task 5: Powerup Orb Visuals on Court

**Files:**
- Create: `src/game/powerup-visuals.ts`
- Test: `tests/game/powerup-visuals.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest';
import { PowerupVisuals } from '@/game/powerup-visuals';
import * as THREE from 'three';

describe('PowerupVisuals', () => {
  it('creates an orb mesh at a position', () => {
    const pv = new PowerupVisuals();
    const orb = pv.spawnOrb('speed-burst', { x: 3, z: -2 });
    expect(orb).toBeInstanceOf(THREE.Group);
  });

  it('removes orb on pickup', () => {
    const pv = new PowerupVisuals();
    pv.spawnOrb('speed-burst', { x: 3, z: -2 });
    expect(pv.hasActiveOrb()).toBe(true);
    pv.removeOrb();
    expect(pv.hasActiveOrb()).toBe(false);
  });

  it('detects player within pickup range', () => {
    const pv = new PowerupVisuals();
    pv.spawnOrb('hot-hand', { x: 0, z: 0 });
    expect(pv.checkPickup(new THREE.Vector3(0.3, 0, 0.3))).toBe(true);
    expect(pv.checkPickup(new THREE.Vector3(5, 0, 5))).toBe(false);
  });

  it('animates orb (bob and rotate)', () => {
    const pv = new PowerupVisuals();
    pv.spawnOrb('on-fire', { x: 0, z: 0 });
    const startY = pv.getOrbMesh()!.position.y;
    pv.update(0.5); // half second
    // Orb should have bobbed
    expect(pv.getOrbMesh()!.position.y).not.toBeCloseTo(startY, 2);
  });
});
```

- [ ] **Step 2: Implement PowerupVisuals**

Create `src/game/powerup-visuals.ts`:
- `spawnOrb(type, position)` — creates a glowing sphere (color based on tier: green/orange/red) with a rotating ring around it, floating at y=0.5
- `removeOrb()` — removes from scene
- `checkPickup(playerPosition)` — returns true if player within 1.0 units
- `update(dt)` — bob up/down (sine wave), rotate the ring, pulse the glow
- `getOrbMesh()` — returns the orb group for scene add/remove
- `hasActiveOrb()` — boolean
- Tier colors: tier 1 = green (0x2ecc71), tier 2 = orange (0xf39c12), tier 3 = red (0xe74c3c)

- [ ] **Step 3: Run tests** — All 4 PASS
- [ ] **Step 4: Commit** — `git commit -m "feat: add 3D powerup orb visuals with glow, bob, and pickup detection"`

---

### Task 6: Wire Powerups into Game Session

**Files:**
- Modify: `src/game/game-session.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Add powerup visual integration to GameSession**

In GameSession:
- Import PowerupVisuals and PowerupSystem
- Create a PowerupVisuals instance
- In `addToScene`, add the orb mesh group
- In `update()`, after the powerup system update:
  - If powerupSystem has an activeOrb and no visual orb exists, spawn one
  - Update orb animation (bob/rotate)
  - Check if any player on the losing team is close enough to pick up
  - On pickup: activate the powerup effect, remove orb, show HUD notification

```typescript
// In update(), after existing powerup system code:
if (this.powerupSystem.activeOrb && !this.powerupVisuals.hasActiveOrb()) {
  const orb = this.powerupSystem.activeOrb;
  this.powerupVisuals.spawnOrb(orb.type, orb.position);
  if (this.scene) this.scene.add(this.powerupVisuals.getOrbMesh()!);
}

this.powerupVisuals.update(dt);

// Check pickup by losing team players
if (this.powerupVisuals.hasActiveOrb()) {
  const diff = this.matchEngine.getScoreDifferential();
  if (diff) {
    const losingPlayers = diff.losingTeam === 'home' ? this.homePlayers : this.awayPlayers;
    for (const p of losingPlayers) {
      if (this.powerupVisuals.checkPickup(p.position)) {
        const type = this.powerupSystem.pickupOrb(diff.losingTeam);
        if (type) {
          this.powerupVisuals.removeOrb();
          if (this.scene) this.scene.remove(this.powerupVisuals.getOrbMesh()!);
        }
        break;
      }
    }
  }
}
```

- [ ] **Step 2: Move powerup system INTO GameSession** — currently powerupSystem is in main.ts. Move it into GameSession so it's self-contained. Create it in the constructor, tick it in update().

- [ ] **Step 3: Verify build** — `npx vite build` — exit 0
- [ ] **Step 4: Run all tests** — `npx vitest run` — all pass
- [ ] **Step 5: Commit** — `git commit -m "feat: powerup orbs appear on court, players pick them up"`

---

### Task 7: Slam Cam on Dunks and Blocks

**Files:**
- Modify: `src/game/game-session.ts`
- Modify: `src/game/camera.ts`

- [ ] **Step 1: Expose slam cam trigger**

In `camera.ts`, the `triggerSlamCam` method already exists. Verify it takes an impact position and activates the slam camera mode with a timer.

- [ ] **Step 2: Trigger slam cam in GameSession**

In GameSession, when a dunk or block happens, trigger the slam cam:

For dunks — in `handleMadeShot`, if shotType is 'dunk' or 'powerup-dunk':
```typescript
handleMadeShot(team: Possession, shotType: ShotType): void {
  // Trigger slam cam for dunks
  if (shotType === 'dunk' || shotType === 'alley-oop' || shotType === 'powerup-dunk') {
    this.slamCamRequested = true;
    this.slamCamPosition = this.attackingHoop.clone();
  }
  // ... existing scoring code ...
}
```

Add `slamCamRequested` flag and `slamCamPosition` to GameSession. Expose them via `getCameraInfo()`:
```typescript
getCameraInfo(): CameraInfo {
  if (this.slamCamRequested) {
    this.slamCamRequested = false;
    return {
      mode: 'slam',
      trackPosition: this.slamCamPosition!,
      lookAt: this.slamCamPosition!,
    };
  }
  // ... existing camera logic ...
}
```

In main.ts, `cameraSystem.setMode(camInfo.mode)` will pick up 'slam' mode and the slam cam timer in camera.ts will auto-revert after SLAM_DURATION seconds.

- [ ] **Step 3: Also trigger on successful steals** — add crowd event for steals:
```typescript
// In attemptSteal, on successful steal:
crowdSystem.onEvent('steal');
```

Wait — crowd system isn't in GameSession yet. For now, just do slam cam on dunks. Crowd integration can come in Phase D.

- [ ] **Step 4: Verify build and tests** — all pass
- [ ] **Step 5: Commit** — `git commit -m "feat: slam cam triggers on dunks and big plays"`

---

### Task 8: HUD Powerup Notification + Game Over Dimming

**Files:**
- Modify: `src/ui/hud.ts`

- [ ] **Step 1: Add powerup pickup notification**

Add a method to show a brief notification when a powerup is picked up:
```typescript
showPowerupPickup(type: string, duration: number): void {
  // Show a floating text like "SPEED BURST! (5s)" that fades after 2 seconds
}
```

Use createElement with a timeout to auto-remove.

- [ ] **Step 2: Add game-over dim state**

```typescript
setGameOver(isOver: boolean): void {
  // When game over, dim the HUD (reduce opacity) but keep score visible
  // Or add a "GAME OVER" banner across the top
}
```

- [ ] **Step 3: Commit** — `git commit -m "feat: HUD shows powerup pickup notification and game-over state"`

---
