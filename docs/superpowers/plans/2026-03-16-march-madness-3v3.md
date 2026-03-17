# March Madness 3v3 Arcade Basketball — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PWA arcade-style 3v3 basketball game with betting, spectating, sub-in mechanics, tiered powerups, and March Madness bracket tournaments.

**Architecture:** Three-layer client-side architecture — Game Engine (Three.js + Rapier for 3D rendering and physics), Game Logic (match engine, AI, powerups, crowd), and Meta Game (tournaments, betting, drafting, progression). No backend; all state persisted in localStorage/IndexedDB. Event-driven communication between systems.

**Tech Stack:** TypeScript, Three.js, Rapier (@dimforge/rapier3d), Vite, vite-plugin-pwa, Vitest

**Spec:** `docs/superpowers/specs/2026-03-16-march-madness-3v3-design.md`

---

## File Structure

### Core Infrastructure (`src/core/`)
| File | Responsibility |
|------|---------------|
| `src/core/types.ts` | Shared type definitions: PlayerStats, TeamData, GameState, PowerupType, CrowdLevel, etc. |
| `src/core/events.ts` | Typed event bus for inter-system communication |
| `src/core/game-loop.ts` | requestAnimationFrame loop with fixed timestep for physics, variable for rendering |
| `src/core/state-machine.ts` | Game state machine: MainMenu, PlayerCreation, TournamentSelect, DraftPhase, BracketView, YourGame, Spectating, etc. |

### Game Engine (`src/game/`)
| File | Responsibility |
|------|---------------|
| `src/game/court.ts` | Three.js half-court mesh: floor, boundary lines, arc, hoop, backboard |
| `src/game/ball.ts` | Ball entity: Three.js mesh + Rapier rigid body, shooting arc physics, bounce |
| `src/game/player.ts` | Player entity: mesh, stats, position, animations, physics body |
| `src/game/match.ts` | Match engine: score tracking, clock (3 min), possession, fouls, win condition (first to 21 or buzzer) |
| `src/game/controls.ts` | Touch input: virtual joystick (left thumb) + gesture detection (swipe up/down/toward, tap, double-tap) |
| `src/game/keyboard-controls.ts` | Desktop input: WASD movement, Space shoot, E pass, Q steal/block, mouse targeting |
| `src/game/camera.ts` | Dynamic camera: Offense Cam, Defense Cam, Slam Cam, Spectator Cam, Sub-In Cam with transitions |

### AI (`src/ai/`)
| File | Responsibility |
|------|---------------|
| `src/ai/player-ai.ts` | Individual AI: decision tree for shoot/pass/drive/defend, personality trait modifiers (Clutch, Ball Hog, Lockdown, Spark Plug, Team Player) |
| `src/ai/team-ai.ts` | Team strategy: archetype-based plays (Run & Gun, Fortress, Sharpshooters, Inside Beasts, Balanced, Chaos), offense/defense coordination |
| `src/ai/difficulty.ts` | Difficulty scaling: reaction time, accuracy, decision quality based on seed ranking and tournament round |

### Systems (`src/systems/`)
| File | Responsibility |
|------|---------------|
| `src/systems/powerups.ts` | Tiered powerup spawning (deficit-based), orb placement, pickup detection, effect application, timer management |
| `src/systems/crowd.ts` | 5-level intensity meter, event-driven escalation, decay over time, visual/audio/gameplay effect triggers |
| `src/systems/sub-in.ts` | Sub-in escalation (4 stages), entrance cinematic sequencing, player replacement logic (lowest performer), powerup grant on entry |

### Meta Game (`src/meta/`)
| File | Responsibility |
|------|---------------|
| `src/meta/tournament.ts` | Bracket management: generate brackets (8/16/64), seeding, advance winners, track rounds |
| `src/meta/betting.ts` | Betting logic: odds calculation, coin/rep wagers, payout, cash-out formula, clutch bonus, limits (50% cap) |
| `src/meta/draft.ts` | Draft pool generation: random players with stats + personality traits, reroll mechanic (max 2), quality scaling by tier |
| `src/meta/progression.ts` | XP calculation, level-up thresholds, stat point unlocks, signature move unlocks |
| `src/meta/save.ts` | localStorage/IndexedDB persistence: custom player, currency, reputation, tournament state, settings |

### UI (`src/ui/`)
| File | Responsibility |
|------|---------------|
| `src/ui/hud.ts` | In-game HUD: scoreboard, shot clock, powerup indicator, crowd meter, sub-in prompt |
| `src/ui/menus.ts` | Main menu, tournament select, settings screens |
| `src/ui/bracket-view.ts` | Visual bracket display: tree layout, team cards, match results, current round highlight |
| `src/ui/betting-ui.ts` | Bet placement overlay: matchup card, odds display, wager slider, cash-out button |
| `src/ui/player-creator.ts` | Character builder: appearance options, stat allocation, signature move picker |
| `src/ui/draft-ui.ts` | Draft screen: player cards with stats/traits, pick slots, reroll button |

### Data (`src/data/`)
| File | Responsibility |
|------|---------------|
| `src/data/teams.ts` | Team generation: name fragment pools, mascot pool, color palettes, archetype stat templates, 10-15 marquee hand-crafted teams |
| `src/data/player-pool.ts` | Draftable player templates: stat ranges per tier, personality trait distribution, name generation |
| `src/data/signature-moves.ts` | Signature move definitions: ankle-breaker, fadeaway, chase-down block — cooldowns, effects, animations |

### Entry & Config
| File | Responsibility |
|------|---------------|
| `src/main.ts` | App entry point: init Three.js scene, load Rapier WASM, start game loop, mount UI |
| `index.html` | HTML shell with canvas + UI overlay containers |
| `vite.config.ts` | Vite config: PWA plugin, WASM support, asset handling |
| `tsconfig.json` | TypeScript strict mode config |
| `public/manifest.json` | PWA manifest: app name, icons, theme color, display: standalone |

### Tests (`tests/`)
Mirror the `src/` structure: `tests/core/`, `tests/game/`, `tests/ai/`, `tests/systems/`, `tests/meta/`, `tests/data/`

---

## Chunk 1: Project Setup & Core Infrastructure

### Task 1: Initialize Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `.gitignore`
- Create: `public/manifest.json`

- [ ] **Step 1: Initialize npm project and install dependencies**

Run:
```bash
cd C:/Users/steph/documents/march-mad
npm init -y
npm install three @dimforge/rapier3d
npm install -D typescript vite vite-plugin-pwa vitest @types/three
```

- [ ] **Step 2: Create TypeScript config**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create Vite config**

Create `vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // We provide our own in public/
      workbox: {
        globPatterns: ['**/*.{js,css,html,glb,png,jpg,webp,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\.(?:mp3|ogg|wav)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio-cache',
              expiration: { maxEntries: 50 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
  },
});
```

- [ ] **Step 4: Create HTML shell**

Create `index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#1a1a2e" />
  <link rel="manifest" href="/manifest.json" />
  <link rel="icon" type="image/png" href="/icons/icon-192.png" />
  <title>March Madness 3v3</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #1a1a2e; }
    #game-canvas { width: 100%; height: 100%; display: block; touch-action: none; }
    #ui-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
    #ui-overlay > * { pointer-events: auto; }
  </style>
</head>
<body>
  <canvas id="game-canvas"></canvas>
  <div id="ui-overlay"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 5: Create PWA manifest**

Create `public/manifest.json`:
```json
{
  "name": "March Madness 3v3",
  "short_name": "MarchMad",
  "description": "Arcade 3v3 basketball with betting and bracket tournaments",
  "start_url": "/",
  "display": "standalone",
  "orientation": "landscape",
  "background_color": "#1a1a2e",
  "theme_color": "#e94560",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 6: Create placeholder PWA icons**

Run:
```bash
mkdir -p public/icons
# Generate minimal placeholder PNGs (1x1 pixel, will be replaced with real icons later)
npx --yes canvas-cli create public/icons/icon-192.png 192 192 --background "#e94560" 2>/dev/null || echo "placeholder" > public/icons/icon-192.png
npx --yes canvas-cli create public/icons/icon-512.png 512 512 --background "#e94560" 2>/dev/null || echo "placeholder" > public/icons/icon-512.png
```

Note: These are placeholder icons. Real branded icons should be created before release.

- [ ] **Step 7: Create .gitignore**

Create `.gitignore`:
```
node_modules/
dist/
.superpowers/
*.local
```

- [ ] **Step 8: Create minimal main.ts entry point**

Create `src/main.ts`:
```typescript
import * as THREE from 'three';

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

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

console.log('March Madness 3v3 initialized');
```

- [ ] **Step 9: Verify project builds successfully**

Run: `npx vite build`
Expected: Build completes with exit code 0, output in `dist/` directory

Run: `npx vite --host 127.0.0.1 --port 3000 &` then `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000` then kill the server
Expected: HTTP 200

- [ ] **Step 10: Initialize git and commit**

Run:
```bash
git init
git add package.json tsconfig.json vite.config.ts index.html src/main.ts .gitignore public/manifest.json public/icons/
git commit -m "feat: initialize project with Three.js, Vite, and PWA config"
```

---

### Task 2: Core Type Definitions

**Files:**
- Create: `src/core/types.ts`
- Create: `vitest.config.ts`
- Test: `tests/core/types.test.ts`

- [ ] **Step 1: Write type validation tests**

Create `tests/core/types.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  type PlayerStats,
  type TeamData,
  type MatchState,
  type PowerupType,
  type CrowdLevel,
  type GamePhase,
  type BetData,
  type PersonalityTrait,
  type TeamArchetype,
  type TournamentTier,
  createDefaultPlayerStats,
  CROWD_LEVELS,
  POWERUP_TIERS,
} from '@/core/types';

describe('types', () => {
  it('creates default player stats with valid ranges', () => {
    const stats = createDefaultPlayerStats();
    expect(stats.speed).toBeGreaterThanOrEqual(1);
    expect(stats.speed).toBeLessThanOrEqual(10);
    expect(stats.shooting).toBeGreaterThanOrEqual(1);
    expect(stats.defense).toBeGreaterThanOrEqual(1);
    expect(stats.passing).toBeGreaterThanOrEqual(1);
    expect(stats.dunkPower).toBeGreaterThanOrEqual(1);
  });

  it('has 5 crowd levels in order', () => {
    expect(CROWD_LEVELS).toEqual(['CALM', 'ENGAGED', 'HYPED', 'ROWDY', 'CHAOS']);
  });

  it('maps powerup tiers to correct deficit ranges', () => {
    expect(POWERUP_TIERS[1].minDeficit).toBe(1);
    expect(POWERUP_TIERS[1].maxDeficit).toBe(4);
    expect(POWERUP_TIERS[2].minDeficit).toBe(5);
    expect(POWERUP_TIERS[2].maxDeficit).toBe(9);
    expect(POWERUP_TIERS[3].minDeficit).toBe(10);
    expect(POWERUP_TIERS[3].maxDeficit).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/types.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create vitest config**

Create `vitest.config.ts` (Vitest will use this instead of vite.config.ts):
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
  },
});
```

- [ ] **Step 4: Implement core types**

Create `src/core/types.ts`:
```typescript
// --- Player ---

export interface PlayerStats {
  speed: number;      // 1-10
  shooting: number;   // 1-10
  defense: number;    // 1-10
  passing: number;    // 1-10
  dunkPower: number;  // 1-10
}

export function createDefaultPlayerStats(): PlayerStats {
  return { speed: 5, shooting: 5, defense: 5, passing: 5, dunkPower: 5 };
}

export type PersonalityTrait = 'Clutch' | 'Ball Hog' | 'Lockdown' | 'Spark Plug' | 'Team Player';

export interface PlayerData {
  id: string;
  name: string;
  stats: PlayerStats;
  personality: PersonalityTrait;
  isCustom: boolean;
}

export interface CustomPlayerData extends PlayerData {
  isCustom: true;
  appearance: PlayerAppearance;
  signatureMove: string;
  xp: number;
  level: number;
}

export interface PlayerAppearance {
  bodyType: number;
  hairStyle: number;
  skinTone: number;
  jerseyNumber: number;
}

// --- Team ---

export type TeamArchetype = 'Run & Gun' | 'Fortress' | 'Sharpshooters' | 'Inside Beasts' | 'Balanced' | 'Chaos';

export interface TeamData {
  id: string;
  name: string;
  mascot: string;
  colors: { primary: string; secondary: string };
  archetype: TeamArchetype;
  seed: number; // 1-16
  players: PlayerData[];
}

// --- Match ---

export type GamePhase = 'pre-game' | 'playing' | 'check-ball' | 'foul' | 'post-game';
export type Possession = 'home' | 'away';

export interface MatchState {
  homeTeam: TeamData;
  awayTeam: TeamData;
  homeScore: number;
  awayScore: number;
  possession: Possession;
  phase: GamePhase;
  clockSeconds: number;  // counts down from 180
  powerupMeter: number;  // 0-100, charges toward next powerup spawn
}

// --- Powerups ---

export type PowerupType =
  // Tier 1
  | 'speed-burst' | 'hot-hand' | 'sticky-fingers'
  // Tier 2
  | 'on-fire' | 'phantom-step' | 'brick-wall'
  // Tier 3
  | 'giant-ball' | 'trampoline' | 'force-field';

export interface PowerupTier {
  tier: number;
  minDeficit: number;
  maxDeficit: number;
  types: PowerupType[];
}

export const POWERUP_TIERS: Record<number, PowerupTier> = {
  1: { tier: 1, minDeficit: 1, maxDeficit: 4, types: ['speed-burst', 'hot-hand', 'sticky-fingers'] },
  2: { tier: 2, minDeficit: 5, maxDeficit: 9, types: ['on-fire', 'phantom-step', 'brick-wall'] },
  3: { tier: 3, minDeficit: 10, maxDeficit: Infinity, types: ['giant-ball', 'trampoline', 'force-field'] },
};

// --- Crowd ---

export type CrowdLevel = 'CALM' | 'ENGAGED' | 'HYPED' | 'ROWDY' | 'CHAOS';
export const CROWD_LEVELS: CrowdLevel[] = ['CALM', 'ENGAGED', 'HYPED', 'ROWDY', 'CHAOS'];

// --- Betting ---

export interface BetData {
  teamId: string;
  coinAmount: number;
  repAmount: number;
  odds: number;
  subbedIn: boolean;
}

// --- Tournament ---

export type TournamentTier = 'casual' | 'sweet16' | 'season';

export interface TournamentConfig {
  tier: TournamentTier;
  teamCount: number;
  rounds: number;
}

export const TOURNAMENT_CONFIGS: Record<TournamentTier, TournamentConfig> = {
  casual: { tier: 'casual', teamCount: 8, rounds: 3 },
  sweet16: { tier: 'sweet16', teamCount: 16, rounds: 4 },
  season: { tier: 'season', teamCount: 64, rounds: 6 },
};

// --- Game State Machine ---

export type AppState =
  | 'MainMenu'
  | 'PlayerCreation'
  | 'TournamentSelect'
  | 'DraftPhase'
  | 'BracketView'
  | 'YourGame'
  | 'Spectating'
  | 'BettingOverlay'
  | 'SubInCinematic'
  | 'PostGame'
  | 'TournamentEnd';

// --- Scoring ---

export type ShotType = 'layup' | 'mid-range' | 'three-pointer' | 'dunk' | 'alley-oop' | 'powerup-dunk';

export const SHOT_POINTS: Record<ShotType, number> = {
  'layup': 1,
  'mid-range': 1,
  'three-pointer': 2,
  'dunk': 2,
  'alley-oop': 2,
  'powerup-dunk': 3,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/core/types.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts tests/core/types.test.ts vitest.config.ts
git commit -m "feat: add core type definitions for players, teams, match, powerups, and tournaments"
```

---

### Task 3: Event Bus

**Files:**
- Create: `src/core/events.ts`
- Test: `tests/core/events.test.ts`

- [ ] **Step 1: Write event bus tests**

Create `tests/core/events.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '@/core/events';

describe('EventBus', () => {
  it('calls listeners when event is emitted', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('score', handler);
    bus.emit('score', { team: 'home', points: 2 });
    expect(handler).toHaveBeenCalledWith({ team: 'home', points: 2 });
  });

  it('supports multiple listeners for same event', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('score', h1);
    bus.on('score', h2);
    bus.emit('score', { team: 'away', points: 1 });
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('removes listener with off()', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('score', handler);
    bus.off('score', handler);
    bus.emit('score', { team: 'home', points: 3 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('once() fires only one time', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('score', handler);
    bus.emit('score', { points: 1 });
    bus.emit('score', { points: 2 });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not throw when emitting event with no listeners', () => {
    const bus = new EventBus();
    expect(() => bus.emit('nonexistent', {})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/events.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement event bus**

Create `src/core/events.ts`:
```typescript
// Game event map — add new events here as systems are built
export interface GameEventMap {
  score: { team: 'home' | 'away'; points: number; shotType: string };
  foul: { team: 'home' | 'away' };
  powerup: { type: string; team: 'home' | 'away' };
  'crowd-change': { level: string };
  'possession-change': { team: 'home' | 'away' };
  'game-over': { winner: 'home' | 'away'; homeScore: number; awayScore: number };
  [key: string]: any; // extensible for future events
}

type EventHandler<T = any> = (data: T) => void;

export class EventBus<TMap extends Record<string, any> = GameEventMap> {
  private listeners = new Map<string, Set<EventHandler>>();

  on<K extends keyof TMap & string>(event: K, handler: EventHandler<TMap[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off<K extends keyof TMap & string>(event: K, handler: EventHandler<TMap[K]>): void {
    this.listeners.get(event)?.delete(handler);
  }

  once<K extends keyof TMap & string>(event: K, handler: EventHandler<TMap[K]>): void {
    const wrapper: EventHandler = (data) => {
      this.off(event, wrapper as EventHandler<TMap[K]>);
      handler(data);
    };
    this.on(event, wrapper as EventHandler<TMap[K]>);
  }

  emit<K extends keyof TMap & string>(event: K, data: TMap[K]): void {
    this.listeners.get(event)?.forEach((handler) => handler(data));
  }
}

export const gameEvents = new EventBus();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/events.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/events.ts tests/core/events.test.ts
git commit -m "feat: add typed event bus for inter-system communication"
```

---

### Task 4: Game Loop

**Files:**
- Create: `src/core/game-loop.ts`
- Test: `tests/core/game-loop.test.ts`

- [ ] **Step 1: Write game loop tests**

Create `tests/core/game-loop.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { GameLoop } from '@/core/game-loop';

describe('GameLoop', () => {
  it('calls update with fixed timestep', () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = new GameLoop({ fixedStep: 1 / 60, update, render });

    // Simulate one frame at 16.67ms
    loop.tick(16.67);
    expect(update).toHaveBeenCalledWith(1 / 60);
    expect(render).toHaveBeenCalledOnce();
  });

  it('accumulates time for multiple fixed steps in one frame', () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = new GameLoop({ fixedStep: 1 / 60, update, render });

    // Simulate a long frame (50ms = ~3 fixed steps)
    loop.tick(50);
    expect(update).toHaveBeenCalledTimes(3);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('caps accumulated time to prevent spiral of death', () => {
    const update = vi.fn();
    const render = vi.fn();
    const loop = new GameLoop({ fixedStep: 1 / 60, update, render, maxAccumulator: 0.1 });

    // Simulate a huge frame (500ms)
    loop.tick(500);
    // Should be capped at maxAccumulator (0.1s) = 6 fixed steps at 1/60
    expect(update.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('tracks running state', () => {
    const loop = new GameLoop({ fixedStep: 1 / 60, update: vi.fn(), render: vi.fn() });
    expect(loop.isRunning).toBe(false);
    loop.start();
    expect(loop.isRunning).toBe(true);
    loop.stop();
    expect(loop.isRunning).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/game-loop.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement game loop**

Create `src/core/game-loop.ts`:
```typescript
export interface GameLoopConfig {
  fixedStep: number;       // seconds per physics step (e.g., 1/60)
  update: (dt: number) => void;
  render: () => void;
  maxAccumulator?: number; // max accumulated time in seconds (default: 0.1)
}

export class GameLoop {
  private config: Required<GameLoopConfig>;
  private accumulator = 0;
  private rafId: number | null = null;
  private lastTime = 0;
  isRunning = false;

  constructor(config: GameLoopConfig) {
    this.config = { maxAccumulator: 0.1, ...config };
  }

  tick(deltaMs: number): void {
    const deltaSec = deltaMs / 1000;
    this.accumulator += deltaSec;

    if (this.accumulator > this.config.maxAccumulator) {
      this.accumulator = this.config.maxAccumulator;
    }

    while (this.accumulator >= this.config.fixedStep) {
      this.config.update(this.config.fixedStep);
      this.accumulator -= this.config.fixedStep;
    }

    this.config.render();
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();
    const frame = (time: number) => {
      if (!this.isRunning) return;
      const delta = time - this.lastTime;
      this.lastTime = time;
      this.tick(delta);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/game-loop.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/game-loop.ts tests/core/game-loop.test.ts
git commit -m "feat: add fixed-timestep game loop with spiral-of-death protection"
```

---

### Task 5: Game State Machine

**Files:**
- Create: `src/core/state-machine.ts`
- Test: `tests/core/state-machine.test.ts`

- [ ] **Step 1: Write state machine tests**

Create `tests/core/state-machine.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { GameStateMachine, type StateTransition } from '@/core/state-machine';
import type { AppState } from '@/core/types';

describe('GameStateMachine', () => {
  const validTransitions: StateTransition[] = [
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

  it('starts in MainMenu state', () => {
    const sm = new GameStateMachine(validTransitions);
    expect(sm.current).toBe('MainMenu');
  });

  it('transitions to valid state', () => {
    const sm = new GameStateMachine(validTransitions);
    const result = sm.transition('TournamentSelect');
    expect(result).toBe(true);
    expect(sm.current).toBe('TournamentSelect');
  });

  it('rejects invalid transition', () => {
    const sm = new GameStateMachine(validTransitions);
    const result = sm.transition('YourGame');
    expect(result).toBe(false);
    expect(sm.current).toBe('MainMenu');
  });

  it('fires onEnter and onExit callbacks', () => {
    const onExit = vi.fn();
    const onEnter = vi.fn();
    const sm = new GameStateMachine(validTransitions);
    sm.onExit('MainMenu', onExit);
    sm.onEnter('TournamentSelect', onEnter);
    sm.transition('TournamentSelect');
    expect(onExit).toHaveBeenCalledWith('MainMenu', 'TournamentSelect');
    expect(onEnter).toHaveBeenCalledWith('MainMenu', 'TournamentSelect');
  });

  it('supports full game flow path', () => {
    const sm = new GameStateMachine(validTransitions);
    expect(sm.transition('TournamentSelect')).toBe(true);
    expect(sm.transition('DraftPhase')).toBe(true);
    expect(sm.transition('BracketView')).toBe(true);
    expect(sm.transition('YourGame')).toBe(true);
    expect(sm.transition('PostGame')).toBe(true);
    expect(sm.transition('BracketView')).toBe(true);
    expect(sm.transition('Spectating')).toBe(true);
    expect(sm.transition('BettingOverlay')).toBe(true);
    expect(sm.transition('Spectating')).toBe(true);
    expect(sm.transition('SubInCinematic')).toBe(true);
    expect(sm.transition('YourGame')).toBe(true);
    expect(sm.transition('PostGame')).toBe(true);
    expect(sm.transition('TournamentEnd')).toBe(true);
    expect(sm.transition('MainMenu')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/state-machine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement state machine**

Create `src/core/state-machine.ts`:
```typescript
import type { AppState } from './types';

export interface StateTransition {
  from: AppState;
  to: AppState;
}

type StateCallback = (from: AppState, to: AppState) => void;

export class GameStateMachine {
  current: AppState = 'MainMenu';
  private transitions: Set<string>;
  private enterCallbacks = new Map<AppState, StateCallback[]>();
  private exitCallbacks = new Map<AppState, StateCallback[]>();

  constructor(validTransitions: StateTransition[]) {
    this.transitions = new Set(
      validTransitions.map((t) => `${t.from}->${t.to}`)
    );
  }

  transition(to: AppState): boolean {
    const key = `${this.current}->${to}`;
    if (!this.transitions.has(key)) return false;

    const from = this.current;
    this.exitCallbacks.get(from)?.forEach((cb) => cb(from, to));
    this.current = to;
    this.enterCallbacks.get(to)?.forEach((cb) => cb(from, to));
    return true;
  }

  onEnter(state: AppState, callback: StateCallback): void {
    if (!this.enterCallbacks.has(state)) {
      this.enterCallbacks.set(state, []);
    }
    this.enterCallbacks.get(state)!.push(callback);
  }

  onExit(state: AppState, callback: StateCallback): void {
    if (!this.exitCallbacks.has(state)) {
      this.exitCallbacks.set(state, []);
    }
    this.exitCallbacks.get(state)!.push(callback);
  }

  canTransitionTo(to: AppState): boolean {
    return this.transitions.has(`${this.current}->${to}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/core/state-machine.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/state-machine.ts tests/core/state-machine.test.ts
git commit -m "feat: add game state machine with validated transitions and lifecycle callbacks"
```

---

### Task 6: Wire Core Systems into main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update main.ts to use GameLoop, EventBus, and StateMachine**

Replace `src/main.ts` contents with:
```typescript
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
```

- [ ] **Step 2: Verify build still passes**

Run: `npx vite build`
Expected: Build completes with exit code 0

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (types, events, game-loop, state-machine)

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire GameLoop, EventBus, and StateMachine into main entry point"
```

---

## Chunk 2: Court, Ball & Player Rendering

### Task 7: Half-Court 3D Scene

**Files:**
- Create: `src/game/court.ts`
- Test: `tests/game/court.test.ts`

- [ ] **Step 1: Write court creation tests**

Create `tests/game/court.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createCourt, COURT_DIMENSIONS } from '@/game/court';
import * as THREE from 'three';

describe('Court', () => {
  it('exports correct half-court dimensions', () => {
    expect(COURT_DIMENSIONS.width).toBe(15);   // meters, proportional to real half-court
    expect(COURT_DIMENSIONS.length).toBe(14);
    expect(COURT_DIMENSIONS.threePointRadius).toBeGreaterThan(0);
    expect(COURT_DIMENSIONS.hoopPosition).toBeDefined();
  });

  it('creates a group with floor, lines, hoop, and backboard', () => {
    const court = createCourt();
    expect(court).toBeInstanceOf(THREE.Group);
    const names = court.children.map((c) => c.name);
    expect(names).toContain('floor');
    expect(names).toContain('three-point-arc');
    expect(names).toContain('hoop');
    expect(names).toContain('backboard');
  });

  it('positions hoop at correct height', () => {
    const court = createCourt();
    const hoop = court.getObjectByName('hoop')!;
    expect(hoop.position.y).toBeCloseTo(3.05, 1); // ~10ft
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/court.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement court**

Create `src/game/court.ts`:
```typescript
import * as THREE from 'three';

export const COURT_DIMENSIONS = {
  width: 15,
  length: 14,
  threePointRadius: 6.75,
  hoopPosition: new THREE.Vector3(0, 3.05, -6),  // centered, 10ft high, near back
  checkBallLine: 5, // z-coordinate of the check-ball line (behind the arc)
};

export function createCourt(): THREE.Group {
  const group = new THREE.Group();

  // Floor
  const floorGeo = new THREE.PlaneGeometry(COURT_DIMENSIONS.width, COURT_DIMENSIONS.length);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xcd853f, roughness: 0.8 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor';
  group.add(floor);

  // Three-point arc (semi-circle of line segments)
  const arcPoints: THREE.Vector3[] = [];
  const segments = 32;
  for (let i = 0; i <= segments; i++) {
    const angle = (Math.PI * i) / segments;
    arcPoints.push(new THREE.Vector3(
      Math.cos(angle) * COURT_DIMENSIONS.threePointRadius,
      0.01,
      COURT_DIMENSIONS.hoopPosition.z + Math.sin(angle) * COURT_DIMENSIONS.threePointRadius
    ));
  }
  const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
  const arcMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  const arc = new THREE.Line(arcGeo, arcMat);
  arc.name = 'three-point-arc';
  group.add(arc);

  // Backboard
  const backboardGeo = new THREE.BoxGeometry(1.8, 1.05, 0.05);
  const backboardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
  const backboard = new THREE.Mesh(backboardGeo, backboardMat);
  backboard.position.set(
    COURT_DIMENSIONS.hoopPosition.x,
    COURT_DIMENSIONS.hoopPosition.y + 0.3,
    COURT_DIMENSIONS.hoopPosition.z - 0.15
  );
  backboard.name = 'backboard';
  group.add(backboard);

  // Hoop (torus)
  const hoopGeo = new THREE.TorusGeometry(0.23, 0.02, 8, 16);
  const hoopMat = new THREE.MeshStandardMaterial({ color: 0xff4500 });
  const hoop = new THREE.Mesh(hoopGeo, hoopMat);
  hoop.rotation.x = -Math.PI / 2;
  hoop.position.copy(COURT_DIMENSIONS.hoopPosition);
  hoop.name = 'hoop';
  group.add(hoop);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  ambient.name = 'ambient-light';
  group.add(ambient);

  const spot = new THREE.DirectionalLight(0xffffff, 0.8);
  spot.position.set(5, 15, 5);
  spot.name = 'main-light';
  group.add(spot);

  return group;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/game/court.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/court.ts tests/game/court.test.ts
git commit -m "feat: add low-poly half-court with floor, three-point arc, hoop, and backboard"
```

---

### Task 8: Ball Entity

**Files:**
- Create: `src/game/ball.ts`
- Test: `tests/game/ball.test.ts`

- [ ] **Step 1: Write ball tests**

Create `tests/game/ball.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { Ball } from '@/game/ball';
import * as THREE from 'three';

describe('Ball', () => {
  it('creates mesh at given position', () => {
    const ball = new Ball(new THREE.Vector3(1, 2, 3));
    expect(ball.mesh).toBeInstanceOf(THREE.Mesh);
    expect(ball.mesh.position.x).toBeCloseTo(1);
    expect(ball.mesh.position.y).toBeCloseTo(2);
    expect(ball.mesh.position.z).toBeCloseTo(3);
  });

  it('has basketball-colored material', () => {
    const ball = new Ball();
    const mat = ball.mesh.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHex()).toBe(0xff6600);
  });

  it('calculates shooting arc trajectory', () => {
    const ball = new Ball();
    const arc = ball.calculateArc(
      new THREE.Vector3(0, 1, 5),   // start
      new THREE.Vector3(0, 3.05, -6), // target (hoop)
      0.7 // power (0-1)
    );
    expect(arc.length).toBeGreaterThan(0);
    // Arc should reach above start and end
    const maxY = Math.max(...arc.map(p => p.y));
    expect(maxY).toBeGreaterThan(3.05);
  });

  it('tracks possession state', () => {
    const ball = new Ball();
    expect(ball.heldBy).toBeNull();
    ball.pickup('player-1');
    expect(ball.heldBy).toBe('player-1');
    ball.release();
    expect(ball.heldBy).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/ball.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ball**

Create `src/game/ball.ts`:
```typescript
import * as THREE from 'three';

export class Ball {
  mesh: THREE.Mesh;
  heldBy: string | null = null;
  velocity = new THREE.Vector3();

  constructor(position = new THREE.Vector3(0, 1, 0)) {
    const geometry = new THREE.SphereGeometry(0.12, 12, 8);
    const material = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.6 });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    this.mesh.name = 'ball';
  }

  pickup(playerId: string): void {
    this.heldBy = playerId;
    this.velocity.set(0, 0, 0);
  }

  release(): void {
    this.heldBy = null;
  }

  calculateArc(start: THREE.Vector3, target: THREE.Vector3, power: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    const steps = 30;
    const distance = start.distanceTo(target);
    const peakHeight = start.y + distance * 0.3 * (0.5 + power * 0.5);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = THREE.MathUtils.lerp(start.x, target.x, t);
      const z = THREE.MathUtils.lerp(start.z, target.z, t);
      // Parabolic arc: peaks at midpoint
      const y = THREE.MathUtils.lerp(start.y, target.y, t) + Math.sin(t * Math.PI) * peakHeight;
      points.push(new THREE.Vector3(x, y, z));
    }
    return points;
  }

  update(dt: number): void {
    if (this.heldBy !== null) return;
    // Simple gravity when not held
    this.velocity.y -= 9.81 * dt;
    this.mesh.position.addScaledVector(this.velocity, dt);
    // Floor bounce
    if (this.mesh.position.y < 0.12) {
      this.mesh.position.y = 0.12;
      this.velocity.y = -this.velocity.y * 0.6; // bounce damping
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/game/ball.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/ball.ts tests/game/ball.test.ts
git commit -m "feat: add ball entity with shooting arc calculation, pickup/release, and bounce physics"
```

---

### Task 9: Player Entity

**Files:**
- Create: `src/game/player.ts`
- Test: `tests/game/player.test.ts`

- [ ] **Step 1: Write player entity tests**

Create `tests/game/player.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { GamePlayer } from '@/game/player';
import { createDefaultPlayerStats } from '@/core/types';
import * as THREE from 'three';

describe('GamePlayer', () => {
  it('creates a mesh group with body parts', () => {
    const player = new GamePlayer({
      id: 'p1',
      name: 'Test Player',
      stats: createDefaultPlayerStats(),
      personality: 'Balanced' as any,
      isCustom: false,
    }, new THREE.Vector3(0, 0, 0), 0x3498db);
    expect(player.group).toBeInstanceOf(THREE.Group);
    expect(player.group.children.length).toBeGreaterThan(0);
  });

  it('moves toward target position based on speed stat', () => {
    const stats = createDefaultPlayerStats();
    stats.speed = 8;
    const player = new GamePlayer({
      id: 'p1', name: 'Fast', stats, personality: 'Clutch', isCustom: false,
    }, new THREE.Vector3(0, 0, 0), 0x3498db);

    player.moveToward(new THREE.Vector3(10, 0, 0), 1 / 60);
    expect(player.group.position.x).toBeGreaterThan(0);
  });

  it('tracks performance score for sub-in replacement logic', () => {
    const player = new GamePlayer({
      id: 'p1', name: 'Test', stats: createDefaultPlayerStats(), personality: 'Clutch', isCustom: false,
    }, new THREE.Vector3(0, 0, 0), 0x3498db);

    expect(player.performanceScore).toBe(0);
    player.recordStat('points', 5);
    player.recordStat('assists', 2);
    player.recordStat('turnovers', 1);
    // performance = points + assists - turnovers = 5 + 2 - 1 = 6
    expect(player.performanceScore).toBe(6);
  });

  it('faces movement direction', () => {
    const player = new GamePlayer({
      id: 'p1', name: 'Test', stats: createDefaultPlayerStats(), personality: 'Team Player', isCustom: false,
    }, new THREE.Vector3(0, 0, 0), 0x3498db);

    player.moveToward(new THREE.Vector3(0, 0, -10), 1 / 60);
    // Should face negative Z
    const forward = new THREE.Vector3(0, 0, -1);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(player.group.quaternion);
    expect(facing.dot(forward)).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/player.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement player entity**

Create `src/game/player.ts`:
```typescript
import * as THREE from 'three';
import type { PlayerData } from '@/core/types';

export class GamePlayer {
  group: THREE.Group;
  data: PlayerData;
  private stats = { points: 0, assists: 0, turnovers: 0 };
  private moveSpeed: number;

  constructor(data: PlayerData, position: THREE.Vector3, teamColor: number) {
    this.data = data;
    this.moveSpeed = 3 + data.stats.speed * 0.5; // 3-8 m/s based on speed stat
    this.group = this.createMesh(teamColor);
    this.group.position.copy(position);
    this.group.name = `player-${data.id}`;
  }

  private createMesh(color: number): THREE.Group {
    const group = new THREE.Group();

    // Body (low-poly capsule shape using cylinder + spheres)
    const bodyGeo = new THREE.CylinderGeometry(0.25, 0.2, 1.0, 6);
    const bodyMat = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.8;
    body.name = 'body';
    group.add(body);

    // Head
    const headGeo = new THREE.SphereGeometry(0.15, 6, 4);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xf4c078 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.45;
    head.name = 'head';
    group.add(head);

    // Legs (two thin cylinders)
    const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.5, 4);
    const legMat = new THREE.MeshStandardMaterial({ color });
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.1, 0.25, 0);
    group.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.1, 0.25, 0);
    group.add(rightLeg);

    return group;
  }

  moveToward(target: THREE.Vector3, dt: number): void {
    const direction = new THREE.Vector3().subVectors(target, this.group.position);
    direction.y = 0;
    const distance = direction.length();
    if (distance < 0.1) return;

    direction.normalize();
    const step = this.moveSpeed * dt;
    const actualStep = Math.min(step, distance);
    this.group.position.addScaledVector(direction, actualStep);

    // Face movement direction
    const angle = Math.atan2(direction.x, direction.z);
    this.group.rotation.y = angle;
  }

  recordStat(stat: 'points' | 'assists' | 'turnovers', value: number): void {
    this.stats[stat] += value;
  }

  get performanceScore(): number {
    return this.stats.points + this.stats.assists - this.stats.turnovers;
  }

  resetStats(): void {
    this.stats = { points: 0, assists: 0, turnovers: 0 };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/game/player.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/player.ts tests/game/player.test.ts
git commit -m "feat: add low-poly player entity with movement, stats tracking, and team colors"
```

---

### Task 10: Integrate Court, Ball & Players into Scene

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Update main.ts to spawn court, ball, and test players**

Add to `src/main.ts` after the state machine setup:
```typescript
import { createCourt } from './game/court';
import { Ball } from './game/ball';
import { GamePlayer } from './game/player';
import { createDefaultPlayerStats } from './core/types';

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
```

Update the `update` function to include ball physics:
```typescript
function update(dt: number): void {
  ball.update(dt);
}
```

- [ ] **Step 2: Verify build passes**

Run: `npx vite build`
Expected: Build completes with exit code 0

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: integrate court, ball, and test player into 3D scene"
```

---

## Chunk 3: Controls, Camera & Match Engine

### Task 11: Touch Controls

**Files:**
- Create: `src/game/controls.ts`
- Test: `tests/game/controls.test.ts`

- [ ] **Step 1: Write touch controls tests**

Create `tests/game/controls.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { TouchControls, type GestureResult } from '@/game/controls';

describe('TouchControls', () => {
  it('detects joystick direction from touch position', () => {
    const controls = new TouchControls();
    // Simulate touch on left half of screen
    controls.handleTouchStart({ x: 50, y: 300, id: 0, isLeftHalf: true, timestamp: 0 });
    controls.handleTouchMove({ x: 80, y: 300, id: 0, isLeftHalf: true, timestamp: 16 });
    const input = controls.getInput();
    expect(input.joystick.x).toBeGreaterThan(0); // moving right
    expect(input.joystick.y).toBeCloseTo(0);
  });

  it('detects swipe up as swipe-up gesture (shoot on offense, block on defense)', () => {
    const controls = new TouchControls();
    let gesture: GestureResult | null = null;
    controls.onGesture((g) => { gesture = g; });

    controls.handleTouchStart({ x: 400, y: 500, id: 1, isLeftHalf: false, timestamp: 0 });
    controls.handleTouchEnd({ x: 400, y: 300, id: 1, isLeftHalf: false, timestamp: 150, startX: 400, startY: 500, startTimestamp: 0 });

    expect(gesture).not.toBeNull();
    expect(gesture!.type).toBe('swipe-up');
    expect(gesture!.power).toBeGreaterThan(0);
  });

  it('detects swipe toward direction as pass gesture', () => {
    const controls = new TouchControls();
    let gesture: GestureResult | null = null;
    controls.onGesture((g) => { gesture = g; });

    controls.handleTouchStart({ x: 400, y: 400, id: 1, isLeftHalf: false, timestamp: 0 });
    controls.handleTouchEnd({ x: 550, y: 400, id: 1, isLeftHalf: false, timestamp: 150, startX: 400, startY: 400, startTimestamp: 0 });

    expect(gesture).not.toBeNull();
    expect(gesture!.type).toBe('pass');
  });

  it('detects tap as tap gesture (steal on defense, context-dependent on offense)', () => {
    const controls = new TouchControls();
    let gesture: GestureResult | null = null;
    controls.onGesture((g) => { gesture = g; });

    controls.handleTouchStart({ x: 400, y: 400, id: 1, isLeftHalf: false, timestamp: 0 });
    controls.handleTouchEnd({ x: 402, y: 401, id: 1, isLeftHalf: false, timestamp: 80, startX: 400, startY: 400, startTimestamp: 0 });

    expect(gesture).not.toBeNull();
    expect(gesture!.type).toBe('tap');
  });

  it('detects double-tap as screen/switch gesture', () => {
    const controls = new TouchControls();
    let gesture: GestureResult | null = null;
    controls.onGesture((g) => { gesture = g; });

    // First tap
    controls.handleTouchStart({ x: 400, y: 400, id: 1, isLeftHalf: false, timestamp: 0 });
    controls.handleTouchEnd({ x: 400, y: 400, id: 1, isLeftHalf: false, timestamp: 50, startX: 400, startY: 400, startTimestamp: 0 });
    // Second tap within 300ms
    controls.handleTouchStart({ x: 400, y: 400, id: 1, isLeftHalf: false, timestamp: 200 });
    controls.handleTouchEnd({ x: 400, y: 400, id: 1, isLeftHalf: false, timestamp: 250, startX: 400, startY: 400, startTimestamp: 200 });

    expect(gesture).not.toBeNull();
    expect(gesture!.type).toBe('double-tap');
  });

  it('normalizes joystick output to max magnitude 1', () => {
    const controls = new TouchControls();
    controls.handleTouchStart({ x: 50, y: 300, id: 0, isLeftHalf: true, timestamp: 0 });
    controls.handleTouchMove({ x: 200, y: 100, id: 0, isLeftHalf: true, timestamp: 16  });
    const input = controls.getInput();
    const magnitude = Math.sqrt(input.joystick.x ** 2 + input.joystick.y ** 2);
    expect(magnitude).toBeLessThanOrEqual(1.01); // small float tolerance
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/controls.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement touch controls**

Create `src/game/controls.ts`:
```typescript
export interface TouchPoint {
  x: number;
  y: number;
  id: number;
  isLeftHalf: boolean;
  timestamp: number;
}

export interface TouchEndPoint extends TouchPoint {
  startX: number;
  startY: number;
  startTimestamp: number;
}

// 'shoot' and 'block' share the swipe-up gesture — the game logic layer
// interprets based on possession (offense = shoot, defense = block).
// Similarly 'steal' (tap) becomes contextual on offense vs defense.
export type GestureType = 'swipe-up' | 'pass' | 'tap' | 'swipe-down' | 'double-tap';

export interface GestureResult {
  type: GestureType;
  power: number;       // 0-1, for shoot strength
  direction: { x: number; y: number }; // normalized direction for pass
}

export interface ControlInput {
  joystick: { x: number; y: number };
  gesture: GestureResult | null;
}

const JOYSTICK_RADIUS = 60; // pixels
const SWIPE_THRESHOLD = 30; // min pixels for a swipe
const TAP_THRESHOLD = 15;   // max pixels for a tap
const TAP_DURATION = 200;   // max ms for a tap
const DOUBLE_TAP_WINDOW = 300; // ms between taps

export class TouchControls {
  private joystickOrigin: { x: number; y: number } | null = null;
  private joystickCurrent: { x: number; y: number } = { x: 0, y: 0 };
  private gestureCallbacks: Array<(g: GestureResult) => void> = [];
  private lastTapTime = 0;
  private lastGesture: GestureResult | null = null;

  onGesture(callback: (g: GestureResult) => void): void {
    this.gestureCallbacks.push(callback);
  }

  handleTouchStart(touch: TouchPoint): void {
    if (touch.isLeftHalf) {
      this.joystickOrigin = { x: touch.x, y: touch.y };
      this.joystickCurrent = { x: touch.x, y: touch.y };
    }
  }

  handleTouchMove(touch: TouchPoint): void {
    if (touch.isLeftHalf && this.joystickOrigin) {
      this.joystickCurrent = { x: touch.x, y: touch.y };
    }
  }

  handleTouchEnd(touch: TouchEndPoint): void {
    if (touch.isLeftHalf) {
      this.joystickOrigin = null;
      this.joystickCurrent = { x: 0, y: 0 };
      return;
    }

    // Right-half gesture detection
    const dx = touch.x - touch.startX;
    const dy = touch.y - touch.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const duration = touch.timestamp - touch.startTimestamp;

    let gesture: GestureResult;

    if (distance < TAP_THRESHOLD && duration < TAP_DURATION) {
      // Tap or double-tap
      const now = touch.timestamp;
      if (now - this.lastTapTime < DOUBLE_TAP_WINDOW) {
        gesture = { type: 'double-tap', power: 0, direction: { x: 0, y: 0 } };
        this.lastTapTime = 0; // reset
      } else {
        gesture = { type: 'tap', power: 0, direction: { x: 0, y: 0 } };
        this.lastTapTime = now;
      }
    } else if (dy < -SWIPE_THRESHOLD && Math.abs(dx) < Math.abs(dy)) {
      // Swipe up = shoot on offense, block on defense (game logic decides)
      const power = Math.min(Math.abs(dy) / 200, 1);
      gesture = { type: 'swipe-up', power, direction: { x: 0, y: -1 } };
    } else if (dy > SWIPE_THRESHOLD && Math.abs(dx) < Math.abs(dy)) {
      // Swipe down = dunk attempt
      gesture = { type: 'swipe-down', power: 1, direction: { x: 0, y: 1 } };
    } else {
      // Horizontal swipe = pass
      const len = Math.sqrt(dx * dx + dy * dy);
      gesture = { type: 'pass', power: 0, direction: { x: dx / len, y: dy / len } };
    }

    this.lastGesture = gesture;
    this.gestureCallbacks.forEach((cb) => cb(gesture));
  }

  getInput(): ControlInput {
    let jx = 0;
    let jy = 0;

    if (this.joystickOrigin) {
      jx = (this.joystickCurrent.x - this.joystickOrigin.x) / JOYSTICK_RADIUS;
      jy = (this.joystickCurrent.y - this.joystickOrigin.y) / JOYSTICK_RADIUS;
      const mag = Math.sqrt(jx * jx + jy * jy);
      if (mag > 1) {
        jx /= mag;
        jy /= mag;
      }
    }

    const gesture = this.lastGesture;
    this.lastGesture = null;
    return { joystick: { x: jx, y: jy }, gesture };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/game/controls.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/controls.ts tests/game/controls.test.ts
git commit -m "feat: add touch controls with joystick, swipe gestures, tap, and double-tap detection"
```

---

### Task 12: Keyboard Controls

**Files:**
- Create: `src/game/keyboard-controls.ts`
- Test: `tests/game/keyboard-controls.test.ts`

- [ ] **Step 1: Write keyboard controls tests**

Create `tests/game/keyboard-controls.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyboardControls } from '@/game/keyboard-controls';
import type { GestureResult } from '@/game/controls';

describe('KeyboardControls', () => {
  it('maps WASD to movement vector', () => {
    const kb = new KeyboardControls();
    kb.handleKeyDown('KeyW');
    const input = kb.getInput();
    expect(input.joystick.y).toBeLessThan(0); // W = forward = negative y in screen space
  });

  it('normalizes diagonal movement', () => {
    const kb = new KeyboardControls();
    kb.handleKeyDown('KeyW');
    kb.handleKeyDown('KeyD');
    const input = kb.getInput();
    const mag = Math.sqrt(input.joystick.x ** 2 + input.joystick.y ** 2);
    expect(mag).toBeCloseTo(1, 1);
  });

  it('maps Space to swipe-up gesture (shoot/block based on context)', () => {
    const kb = new KeyboardControls();
    let gesture: GestureResult | null = null;
    kb.onGesture((g) => { gesture = g; });
    kb.handleKeyDown('Space');
    kb.handleKeyUp('Space');
    expect(gesture?.type).toBe('swipe-up');
  });

  it('maps KeyE to pass gesture', () => {
    const kb = new KeyboardControls();
    let gesture: GestureResult | null = null;
    kb.onGesture((g) => { gesture = g; });
    kb.handleKeyDown('KeyE');
    expect(gesture?.type).toBe('pass');
  });

  it('maps KeyQ to tap gesture (steal/block based on game context)', () => {
    const kb = new KeyboardControls();
    let gesture: GestureResult | null = null;
    kb.onGesture((g) => { gesture = g; });
    kb.handleKeyDown('KeyQ');
    expect(gesture?.type).toBe('tap');
  });

  it('clears movement on key up', () => {
    const kb = new KeyboardControls();
    kb.handleKeyDown('KeyW');
    kb.handleKeyUp('KeyW');
    const input = kb.getInput();
    expect(input.joystick.y).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/keyboard-controls.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement keyboard controls**

Create `src/game/keyboard-controls.ts`:
```typescript
import type { GestureResult, ControlInput } from './controls';

export class KeyboardControls {
  private keys = new Set<string>();
  private gestureCallbacks: Array<(g: GestureResult) => void> = [];
  private spaceDownTime = 0;

  onGesture(callback: (g: GestureResult) => void): void {
    this.gestureCallbacks.push(callback);
  }

  handleKeyDown(code: string): void {
    this.keys.add(code);

    if (code === 'Space') {
      this.spaceDownTime = performance.now();
    } else if (code === 'KeyE') {
      this.emitGesture({ type: 'pass', power: 0, direction: { x: 0, y: -1 } });
    } else if (code === 'KeyQ') {
      // tap = steal on defense, context-dependent on offense (game logic decides)
      this.emitGesture({ type: 'tap', power: 0, direction: { x: 0, y: 0 } });
    }
  }

  handleKeyUp(code: string): void {
    this.keys.delete(code);

    if (code === 'Space') {
      const holdTime = performance.now() - this.spaceDownTime;
      const power = Math.min(holdTime / 500, 1); // 0-500ms hold = 0-1 power
      this.emitGesture({ type: 'swipe-up', power, direction: { x: 0, y: -1 } });
    }
  }

  private emitGesture(gesture: GestureResult): void {
    this.gestureCallbacks.forEach((cb) => cb(gesture));
  }

  getInput(): ControlInput {
    let x = 0;
    let y = 0;

    if (this.keys.has('KeyA')) x -= 1;
    if (this.keys.has('KeyD')) x += 1;
    if (this.keys.has('KeyW')) y -= 1;
    if (this.keys.has('KeyS')) y += 1;

    // Normalize diagonal
    const mag = Math.sqrt(x * x + y * y);
    if (mag > 1) {
      x /= mag;
      y /= mag;
    }

    return { joystick: { x, y }, gesture: null };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/game/keyboard-controls.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/keyboard-controls.ts tests/game/keyboard-controls.test.ts
git commit -m "feat: add keyboard controls with WASD movement and action key mappings"
```

---

### Task 13: Dynamic Camera System

**Files:**
- Create: `src/game/camera.ts`
- Test: `tests/game/camera.test.ts`

- [ ] **Step 1: Write camera system tests**

Create `tests/game/camera.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { CameraSystem, type CameraMode } from '@/game/camera';
import * as THREE from 'three';

describe('CameraSystem', () => {
  const cam = new THREE.PerspectiveCamera();

  it('starts in spectator mode', () => {
    const cs = new CameraSystem(cam);
    expect(cs.currentMode).toBe('spectator');
  });

  it('sets offense cam position behind the ball handler', () => {
    const cs = new CameraSystem(cam);
    cs.setMode('offense');
    cs.update(new THREE.Vector3(2, 0, 3), new THREE.Vector3(0, 3, -6), 1 / 60);
    // Camera should be behind the player (higher z) and elevated
    expect(cam.position.z).toBeGreaterThan(3);
    expect(cam.position.y).toBeGreaterThan(0);
  });

  it('sets defense cam wider and higher', () => {
    const cs = new CameraSystem(cam);
    cs.setMode('defense');
    cs.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, -6), 1 / 60);
    expect(cam.position.y).toBeGreaterThan(5);
  });

  it('transitions smoothly between modes', () => {
    const cs = new CameraSystem(cam);
    cs.setMode('offense');
    cs.update(new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 3, -6), 1 / 60);
    const posAfterOffense = cam.position.clone();

    cs.setMode('defense');
    cs.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, -6), 1 / 60);
    // Should not jump instantly — lerp means first frame is close to old position
    // (with fast enough lerp this is hard to test precisely, just verify mode changed)
    expect(cs.currentMode).toBe('defense');
  });

  it('slam cam activates and auto-reverts', () => {
    const cs = new CameraSystem(cam);
    cs.setMode('offense');
    cs.triggerSlamCam(new THREE.Vector3(0, 3, -6)); // dunk at hoop
    expect(cs.currentMode).toBe('slam');
    // Simulate 3 seconds passing
    for (let i = 0; i < 180; i++) {
      cs.update(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, -6), 1 / 60);
    }
    expect(cs.currentMode).not.toBe('slam'); // should revert
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/camera.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement camera system**

Create `src/game/camera.ts`:
```typescript
import * as THREE from 'three';

export type CameraMode = 'offense' | 'defense' | 'slam' | 'spectator' | 'sub-in';

interface CameraTarget {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
}

export class CameraSystem {
  currentMode: CameraMode = 'spectator';
  private camera: THREE.PerspectiveCamera;
  private targetPos = new THREE.Vector3();
  private targetLookAt = new THREE.Vector3();
  private lerpSpeed = 5;
  private slamTimer = 0;
  private slamDuration = 2.5; // seconds
  private previousMode: CameraMode = 'spectator';

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  setMode(mode: CameraMode): void {
    if (mode === this.currentMode) return;
    this.previousMode = this.currentMode;
    this.currentMode = mode;
  }

  triggerSlamCam(impactPoint: THREE.Vector3): void {
    this.previousMode = this.currentMode;
    this.currentMode = 'slam';
    this.slamTimer = this.slamDuration;
    // Position slam cam close to the action
    this.targetPos.set(
      impactPoint.x + 2,
      impactPoint.y + 1,
      impactPoint.z + 3
    );
    this.targetLookAt.copy(impactPoint);
  }

  update(playerPos: THREE.Vector3, hoopPos: THREE.Vector3, dt: number): void {
    // Calculate target based on mode
    const target = this.getTargetForMode(playerPos, hoopPos);

    // Handle slam cam timer
    if (this.currentMode === 'slam') {
      this.slamTimer -= dt;
      if (this.slamTimer <= 0) {
        this.currentMode = this.previousMode;
      }
    }

    // Smooth interpolation
    this.camera.position.lerp(target.position, this.lerpSpeed * dt);
    this.targetLookAt.lerp(target.lookAt, this.lerpSpeed * dt);
    this.camera.lookAt(this.targetLookAt);
  }

  private getTargetForMode(playerPos: THREE.Vector3, hoopPos: THREE.Vector3): CameraTarget {
    switch (this.currentMode) {
      case 'offense':
        return {
          position: new THREE.Vector3(
            playerPos.x * 0.5,
            3,
            playerPos.z + 5
          ),
          lookAt: new THREE.Vector3(
            (playerPos.x + hoopPos.x) / 2,
            1.5,
            (playerPos.z + hoopPos.z) / 2
          ),
        };

      case 'defense':
        return {
          position: new THREE.Vector3(0, 8, 8),
          lookAt: new THREE.Vector3(0, 0, -2),
        };

      case 'slam':
        return {
          position: this.targetPos.clone(),
          lookAt: this.targetLookAt.clone(),
        };

      case 'sub-in':
        return {
          position: new THREE.Vector3(8, 2, 5),
          lookAt: playerPos.clone(),
        };

      case 'spectator':
      default:
        return {
          position: new THREE.Vector3(12, 6, 0),
          lookAt: new THREE.Vector3(0, 1, -3),
        };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/game/camera.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/camera.ts tests/game/camera.test.ts
git commit -m "feat: add dynamic camera system with 5 modes and smooth transitions"
```

---

### Task 14: Match Engine

**Files:**
- Create: `src/game/match.ts`
- Test: `tests/game/match.test.ts`

- [ ] **Step 1: Write match engine tests**

Create `tests/game/match.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { MatchEngine } from '@/game/match';
import { EventBus } from '@/core/events';

describe('MatchEngine', () => {
  function createMatch() {
    const events = new EventBus();
    return { match: new MatchEngine(events), events };
  }

  it('starts with 0-0 score and 180 second clock', () => {
    const { match } = createMatch();
    expect(match.state.homeScore).toBe(0);
    expect(match.state.awayScore).toBe(0);
    expect(match.state.clockSeconds).toBe(180);
  });

  it('scores correct points for inside shot (1 pt)', () => {
    const { match, events } = createMatch();
    const handler = vi.fn();
    events.on('score', handler);
    match.score('home', 'layup');
    expect(match.state.homeScore).toBe(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ team: 'home', points: 1 }));
  });

  it('scores correct points for three-pointer (2 pts)', () => {
    const { match } = createMatch();
    match.score('away', 'three-pointer');
    expect(match.state.awayScore).toBe(2);
  });

  it('scores correct points for powerup dunk (3 pts)', () => {
    const { match } = createMatch();
    match.score('home', 'powerup-dunk');
    expect(match.state.homeScore).toBe(3);
  });

  it('applies On Fire multiplier to base shots only', () => {
    const { match } = createMatch();
    match.activateOnFire('home');
    match.score('home', 'three-pointer'); // base 2 × 2 = 4
    expect(match.state.homeScore).toBe(4);
    match.score('home', 'powerup-dunk'); // always 3, no multiplier
    expect(match.state.homeScore).toBe(7);
  });

  it('ends game when a team reaches 21', () => {
    const { match, events } = createMatch();
    const gameOver = vi.fn();
    events.on('game-over', gameOver);

    for (let i = 0; i < 11; i++) {
      match.score('home', 'three-pointer'); // 11 × 2 = 22 pts (exceeds 21)
    }
    expect(gameOver).toHaveBeenCalled();
    expect(match.state.phase).toBe('post-game');
  });

  it('ends game at buzzer with highest score winning', () => {
    const { match, events } = createMatch();
    const gameOver = vi.fn();
    events.on('game-over', gameOver);

    match.score('home', 'three-pointer'); // 2-0
    match.tickClock(180); // run out the clock
    expect(gameOver).toHaveBeenCalledWith(expect.objectContaining({ winner: 'home' }));
  });

  it('changes possession after a score', () => {
    const { match } = createMatch();
    match.state.possession = 'home';
    match.score('home', 'layup');
    expect(match.state.phase).toBe('check-ball');
  });

  it('charges powerup meter on foul (benefits losing team per spec)', () => {
    const { match } = createMatch();
    const initial = match.state.powerupMeter;
    match.callFoul('away');
    // Single meter — powerups always spawn for losing team regardless of who fouled
    expect(match.state.powerupMeter).toBeGreaterThan(initial);
  });

  it('changes possession on foul', () => {
    const { match } = createMatch();
    match.state.possession = 'home';
    match.callFoul('home'); // home fouls, away gets ball
    expect(match.state.possession).toBe('away');
  });

  it('handles tied game at buzzer (home wins tiebreak)', () => {
    const { match, events } = createMatch();
    const gameOver = vi.fn();
    events.on('game-over', gameOver);
    // No scoring — 0-0 tie
    match.tickClock(180);
    expect(gameOver).toHaveBeenCalledWith(expect.objectContaining({ winner: 'home' }));
    // Note: ties are rare in arcade play (first to 21). Home tiebreak is acceptable.
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/match.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement match engine**

Create `src/game/match.ts`:
```typescript
import type { MatchState, Possession, ShotType, TeamData } from '@/core/types';
import { SHOT_POINTS } from '@/core/types';
import type { EventBus } from '@/core/events';

export class MatchEngine {
  state: MatchState;
  private events: EventBus;
  private onFireTeam: Possession | null = null;
  private onFireTimer = 0;

  constructor(events: EventBus, homeTeam?: TeamData, awayTeam?: TeamData) {
    this.events = events;
    // Teams are optional for unit testing (scoring/clock tests don't need full team data).
    // In production, always pass real teams.
    this.state = {
      homeTeam: homeTeam!,
      awayTeam: awayTeam!,
      homeScore: 0,
      awayScore: 0,
      possession: 'home',
      phase: 'playing',
      clockSeconds: 180,
      powerupMeter: 0,
    };
  }

  score(team: Possession, shotType: ShotType): void {
    if (this.state.phase === 'post-game') return;

    let points = SHOT_POINTS[shotType];

    // On Fire doubles base shots (1 or 2) but not powerup dunks
    if (this.onFireTeam === team && shotType !== 'powerup-dunk') {
      points *= 2;
    }

    if (team === 'home') {
      this.state.homeScore += points;
    } else {
      this.state.awayScore += points;
    }

    this.events.emit('score', { team, points, shotType });

    // Check win condition: first to 21
    if (this.state.homeScore >= 21 || this.state.awayScore >= 21) {
      this.endGame();
      return;
    }

    // Change to check-ball after score
    this.state.phase = 'check-ball';
  }

  tickClock(dt: number): void {
    if (this.state.phase === 'post-game') return;

    this.state.clockSeconds -= dt;

    // On Fire timer
    if (this.onFireTeam !== null) {
      this.onFireTimer -= dt;
      if (this.onFireTimer <= 0) {
        this.onFireTeam = null;
      }
    }

    // Buzzer
    if (this.state.clockSeconds <= 0) {
      this.state.clockSeconds = 0;
      this.endGame();
    }
  }

  callFoul(foulingTeam: Possession): void {
    // Foul gives possession to other team
    this.state.possession = foulingTeam === 'home' ? 'away' : 'home';
    // Single shared meter — powerups only spawn for the losing team (see PowerupSystem),
    // so charging the meter always benefits the underdog regardless of who fouled.
    this.state.powerupMeter += 15;
    this.events.emit('foul', { team: foulingTeam });
  }

  activateOnFire(team: Possession): void {
    this.onFireTeam = team;
    this.onFireTimer = 15; // 15 seconds
  }

  checkBallComplete(team: Possession): void {
    this.state.possession = team;
    this.state.phase = 'playing';
  }

  getScoreDifferential(): { losingTeam: Possession; deficit: number } | null {
    const diff = this.state.homeScore - this.state.awayScore;
    if (diff === 0) return null;
    return diff > 0
      ? { losingTeam: 'away', deficit: diff }
      : { losingTeam: 'home', deficit: -diff };
  }

  private endGame(): void {
    this.state.phase = 'post-game';
    const winner: Possession = this.state.homeScore >= this.state.awayScore ? 'home' : 'away';
    this.events.emit('game-over', {
      winner,
      homeScore: this.state.homeScore,
      awayScore: this.state.awayScore,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/game/match.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/game/match.ts tests/game/match.test.ts
git commit -m "feat: add match engine with scoring, On Fire multiplier, fouls, clock, and win conditions"
```

---

## Chunk 4: AI System

### Task 15: Player AI

**Files:**
- Create: `src/ai/player-ai.ts`
- Test: `tests/ai/player-ai.test.ts`

- [ ] **Step 1: Write player AI tests**

Create `tests/ai/player-ai.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { PlayerAI, type AIDecision } from '@/ai/player-ai';
import { createDefaultPlayerStats } from '@/core/types';

describe('PlayerAI', () => {
  it('chooses shoot when open and near basket', () => {
    const ai = new PlayerAI({ shooting: 9, speed: 5, defense: 5, passing: 5, dunkPower: 5 }, 'Team Player');
    const decision = ai.decide({
      hasBall: true,
      distanceToHoop: 3,
      nearestDefenderDist: 4,
      teammateOpenness: [0.5, 0.3],
      scoreDiff: 0,
      clockSeconds: 90,
    });
    expect(decision.action).toBe('shoot');
  });

  it('Ball Hog personality shoots more often', () => {
    const ai = new PlayerAI(createDefaultPlayerStats(), 'Ball Hog');
    let shootCount = 0;
    for (let i = 0; i < 100; i++) {
      const d = ai.decide({
        hasBall: true, distanceToHoop: 5, nearestDefenderDist: 2,
        teammateOpenness: [0.8, 0.9], scoreDiff: 0, clockSeconds: 90,
      });
      if (d.action === 'shoot') shootCount++;
    }
    expect(shootCount).toBeGreaterThan(40); // shoots even when covered
  });

  it('Clutch personality performs better in close games', () => {
    const ai = new PlayerAI({ shooting: 5, speed: 5, defense: 5, passing: 5, dunkPower: 5 }, 'Clutch');
    const closeGame = ai.getStatModifiers(2, 30);  // diff=2, 30s left
    const blowout = ai.getStatModifiers(15, 90);
    expect(closeGame.shootingBonus).toBeGreaterThan(blowout.shootingBonus);
  });

  it('Lockdown personality prefers defensive positioning', () => {
    const ai = new PlayerAI(createDefaultPlayerStats(), 'Lockdown');
    const decision = ai.decide({
      hasBall: false, distanceToHoop: 5, nearestDefenderDist: 0,
      teammateOpenness: [0.5, 0.5], scoreDiff: 0, clockSeconds: 90,
    });
    expect(['guard', 'steal']).toContain(decision.action);
  });

  it('Team Player passes to open teammates', () => {
    const ai = new PlayerAI(createDefaultPlayerStats(), 'Team Player');
    let passCount = 0;
    for (let i = 0; i < 100; i++) {
      const d = ai.decide({
        hasBall: true, distanceToHoop: 7, nearestDefenderDist: 1.5,
        teammateOpenness: [0.9, 0.8], scoreDiff: 0, clockSeconds: 90,
      });
      if (d.action === 'pass') passCount++;
    }
    expect(passCount).toBeGreaterThan(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai/player-ai.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement player AI**

Create `src/ai/player-ai.ts`:
```typescript
import type { PlayerStats, PersonalityTrait } from '@/core/types';

export type AIAction = 'shoot' | 'pass' | 'drive' | 'dunk' | 'guard' | 'steal' | 'block' | 'screen' | 'idle';

export interface AIDecision {
  action: AIAction;
  targetIndex?: number; // teammate index for pass
  confidence: number;   // 0-1
}

export interface AIContext {
  hasBall: boolean;
  distanceToHoop: number;
  nearestDefenderDist: number;
  teammateOpenness: number[]; // 0-1 per teammate
  scoreDiff: number;          // positive = winning
  clockSeconds: number;
}

interface StatModifiers {
  shootingBonus: number;
  speedBonus: number;
  defenseBonus: number;
}

const PERSONALITY_WEIGHTS: Record<PersonalityTrait, Record<string, number>> = {
  'Clutch':      { shootBias: 0,    passBias: 0,    defenseBias: 0,   riskTolerance: 0.5 },
  'Ball Hog':    { shootBias: 0.35, passBias: -0.3, defenseBias: -0.1, riskTolerance: 0.7 },
  'Lockdown':    { shootBias: -0.1, passBias: 0.1,  defenseBias: 0.4, riskTolerance: 0.2 },
  'Spark Plug':  { shootBias: 0.1,  passBias: 0,    defenseBias: 0,   riskTolerance: 0.8 },
  'Team Player': { shootBias: -0.1, passBias: 0.3,  defenseBias: 0.1, riskTolerance: 0.3 },
};

export class PlayerAI {
  private stats: PlayerStats;
  private personality: PersonalityTrait;
  private weights: Record<string, number>;

  constructor(stats: PlayerStats, personality: PersonalityTrait) {
    this.stats = stats;
    this.personality = personality;
    this.weights = PERSONALITY_WEIGHTS[personality];
  }

  decide(ctx: AIContext): AIDecision {
    if (!ctx.hasBall) {
      return this.decideDefense(ctx);
    }
    return this.decideOffense(ctx);
  }

  getStatModifiers(scoreDiff: number, clockSeconds: number): StatModifiers {
    let shootingBonus = 0;
    let speedBonus = 0;
    let defenseBonus = 0;

    if (this.personality === 'Clutch') {
      const isClutch = Math.abs(scoreDiff) <= 5 && clockSeconds < 60;
      if (isClutch) {
        shootingBonus = 0.2;
        speedBonus = 0.1;
        defenseBonus = 0.15;
      }
    } else if (this.personality === 'Spark Plug') {
      // Random hot/cold streaks
      shootingBonus = Math.random() > 0.5 ? 0.2 : -0.1;
    }

    return { shootingBonus, speedBonus, defenseBonus };
  }

  private decideOffense(ctx: AIContext): AIDecision {
    const shootScore = this.calcShootScore(ctx);
    const passScore = this.calcPassScore(ctx);
    const driveScore = this.calcDriveScore(ctx);

    if (shootScore >= passScore && shootScore >= driveScore) {
      return { action: ctx.distanceToHoop < 2 ? 'dunk' : 'shoot', confidence: shootScore };
    }
    if (passScore >= driveScore) {
      const bestTeammate = ctx.teammateOpenness.indexOf(Math.max(...ctx.teammateOpenness));
      return { action: 'pass', targetIndex: bestTeammate, confidence: passScore };
    }
    return { action: 'drive', confidence: driveScore };
  }

  private decideDefense(ctx: AIContext): AIDecision {
    const stealChance = 0.3 + this.weights.defenseBias;
    if (ctx.nearestDefenderDist < 1.5 && Math.random() < stealChance) {
      return { action: 'steal', confidence: stealChance };
    }
    if (ctx.distanceToHoop < 3) {
      return { action: 'block', confidence: 0.5 + this.stats.defense * 0.05 };
    }
    return { action: 'guard', confidence: 0.7 };
  }

  private calcShootScore(ctx: AIContext): number {
    let score = (this.stats.shooting / 10) * 0.5;
    score += (1 - ctx.distanceToHoop / 15) * 0.3;
    score += Math.min(ctx.nearestDefenderDist / 5, 1) * 0.2;
    score += this.weights.shootBias;
    return Math.max(0, Math.min(1, score + (Math.random() * 0.15)));
  }

  private calcPassScore(ctx: AIContext): number {
    const bestOpen = Math.max(...ctx.teammateOpenness);
    let score = bestOpen * 0.4;
    score += (1 - ctx.nearestDefenderDist / 5) * 0.3;
    score += (this.stats.passing / 10) * 0.2;
    score += this.weights.passBias;
    return Math.max(0, Math.min(1, score + (Math.random() * 0.1)));
  }

  private calcDriveScore(ctx: AIContext): number {
    let score = (this.stats.speed / 10) * 0.3;
    score += (ctx.distanceToHoop / 15) * 0.3;
    score += (this.stats.dunkPower / 10) * 0.2;
    score += this.weights.riskTolerance * 0.15;
    return Math.max(0, Math.min(1, score + (Math.random() * 0.1)));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ai/player-ai.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/player-ai.ts tests/ai/player-ai.test.ts
git commit -m "feat: add player AI with personality-driven decision making"
```

---

### Task 16: Team AI

**Files:**
- Create: `src/ai/team-ai.ts`
- Test: `tests/ai/team-ai.test.ts`

- [ ] **Step 1: Write team AI tests**

Create `tests/ai/team-ai.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { TeamAI, type TeamPlay } from '@/ai/team-ai';

describe('TeamAI', () => {
  it('Run & Gun favors fast breaks', () => {
    const ai = new TeamAI('Run & Gun');
    const play = ai.choosePlay({ possession: true, scoreDiff: 0, clockSeconds: 90 });
    expect(play.tempo).toBe('fast');
  });

  it('Fortress favors defensive setup', () => {
    const ai = new TeamAI('Fortress');
    const play = ai.choosePlay({ possession: false, scoreDiff: 0, clockSeconds: 90 });
    expect(play.formation).toBe('tight');
  });

  it('Sharpshooters spread the floor', () => {
    const ai = new TeamAI('Sharpshooters');
    const play = ai.choosePlay({ possession: true, scoreDiff: 0, clockSeconds: 90 });
    expect(play.formation).toBe('spread');
  });

  it('Inside Beasts drive to the basket', () => {
    const ai = new TeamAI('Inside Beasts');
    const play = ai.choosePlay({ possession: true, scoreDiff: 0, clockSeconds: 90 });
    expect(play.preferredZone).toBe('paint');
  });

  it('Chaos team is unpredictable', () => {
    const ai = new TeamAI('Chaos');
    const plays = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = ai.choosePlay({ possession: true, scoreDiff: 0, clockSeconds: 90 });
      plays.add(p.tempo);
    }
    expect(plays.size).toBeGreaterThan(1);
  });

  it('assigns player positions for 3v3', () => {
    const positions = TeamAI.getFormationPositions('spread');
    expect(positions).toHaveLength(3);
    positions.forEach(p => {
      expect(p).toHaveProperty('x');
      expect(p).toHaveProperty('z');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai/team-ai.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement team AI**

Create `src/ai/team-ai.ts`:
```typescript
import type { TeamArchetype } from '@/core/types';

export type Tempo = 'fast' | 'moderate' | 'slow';
export type Formation = 'spread' | 'tight' | 'balanced';
export type Zone = 'paint' | 'mid-range' | 'three-point' | 'any';

export interface TeamPlay {
  tempo: Tempo;
  formation: Formation;
  preferredZone: Zone;
}

interface TeamContext {
  possession: boolean;
  scoreDiff: number;
  clockSeconds: number;
}

interface FormationPosition {
  x: number;
  z: number;
}

const ARCHETYPE_PLAYS: Record<TeamArchetype, { offense: TeamPlay; defense: TeamPlay }> = {
  'Run & Gun': {
    offense: { tempo: 'fast', formation: 'spread', preferredZone: 'three-point' },
    defense: { tempo: 'fast', formation: 'balanced', preferredZone: 'any' },
  },
  'Fortress': {
    offense: { tempo: 'slow', formation: 'tight', preferredZone: 'paint' },
    defense: { tempo: 'slow', formation: 'tight', preferredZone: 'paint' },
  },
  'Sharpshooters': {
    offense: { tempo: 'moderate', formation: 'spread', preferredZone: 'three-point' },
    defense: { tempo: 'moderate', formation: 'balanced', preferredZone: 'mid-range' },
  },
  'Inside Beasts': {
    offense: { tempo: 'moderate', formation: 'tight', preferredZone: 'paint' },
    defense: { tempo: 'slow', formation: 'tight', preferredZone: 'paint' },
  },
  'Balanced': {
    offense: { tempo: 'moderate', formation: 'balanced', preferredZone: 'any' },
    defense: { tempo: 'moderate', formation: 'balanced', preferredZone: 'any' },
  },
  'Chaos': {
    offense: { tempo: 'fast', formation: 'spread', preferredZone: 'any' },
    defense: { tempo: 'fast', formation: 'spread', preferredZone: 'any' },
  },
};

const FORMATIONS: Record<Formation, FormationPosition[]> = {
  spread: [
    { x: -4, z: 2 },
    { x: 4, z: 2 },
    { x: 0, z: 5 },
  ],
  tight: [
    { x: -1.5, z: -3 },
    { x: 1.5, z: -3 },
    { x: 0, z: -1 },
  ],
  balanced: [
    { x: -3, z: 0 },
    { x: 3, z: 0 },
    { x: 0, z: 3 },
  ],
};

export class TeamAI {
  private archetype: TeamArchetype;

  constructor(archetype: TeamArchetype) {
    this.archetype = archetype;
  }

  choosePlay(ctx: TeamContext): TeamPlay {
    if (this.archetype === 'Chaos') {
      return this.chaosPlay(ctx);
    }

    const base = ctx.possession
      ? ARCHETYPE_PLAYS[this.archetype].offense
      : ARCHETYPE_PLAYS[this.archetype].defense;

    // Late-game adjustments
    if (ctx.clockSeconds < 30 && ctx.scoreDiff < 0) {
      return { ...base, tempo: 'fast' };
    }
    if (ctx.clockSeconds < 30 && ctx.scoreDiff > 0) {
      return { ...base, tempo: 'slow' };
    }

    return base;
  }

  private chaosPlay(ctx: TeamContext): TeamPlay {
    const tempos: Tempo[] = ['fast', 'moderate', 'slow'];
    const formations: Formation[] = ['spread', 'tight', 'balanced'];
    const zones: Zone[] = ['paint', 'mid-range', 'three-point', 'any'];
    return {
      tempo: tempos[Math.floor(Math.random() * tempos.length)],
      formation: formations[Math.floor(Math.random() * formations.length)],
      preferredZone: zones[Math.floor(Math.random() * zones.length)],
    };
  }

  static getFormationPositions(formation: Formation): FormationPosition[] {
    return FORMATIONS[formation];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ai/team-ai.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/team-ai.ts tests/ai/team-ai.test.ts
git commit -m "feat: add team AI with archetype-based play calling and formations"
```

---

### Task 17: Difficulty Scaling

**Files:**
- Create: `src/ai/difficulty.ts`
- Test: `tests/ai/difficulty.test.ts`

- [ ] **Step 1: Write difficulty tests**

Create `tests/ai/difficulty.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { getDifficultyModifiers, type DifficultyModifiers } from '@/ai/difficulty';

describe('Difficulty', () => {
  it('1-seed is harder than 16-seed', () => {
    const hard = getDifficultyModifiers(1, 6);
    const easy = getDifficultyModifiers(16, 1);
    expect(hard.reactionTime).toBeLessThan(easy.reactionTime);
    expect(hard.accuracyMod).toBeGreaterThan(easy.accuracyMod);
  });

  it('later tournament rounds increase difficulty', () => {
    const early = getDifficultyModifiers(8, 1);
    const late = getDifficultyModifiers(8, 6);
    expect(late.accuracyMod).toBeGreaterThan(early.accuracyMod);
  });

  it('all modifiers stay within reasonable bounds', () => {
    for (let seed = 1; seed <= 16; seed++) {
      for (let round = 1; round <= 6; round++) {
        const m = getDifficultyModifiers(seed, round);
        expect(m.reactionTime).toBeGreaterThan(0);
        expect(m.reactionTime).toBeLessThan(2);
        expect(m.accuracyMod).toBeGreaterThanOrEqual(0.3);
        expect(m.accuracyMod).toBeLessThanOrEqual(1.2);
        expect(m.decisionQuality).toBeGreaterThanOrEqual(0.3);
        expect(m.decisionQuality).toBeLessThanOrEqual(1);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai/difficulty.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement difficulty scaling**

Create `src/ai/difficulty.ts`:
```typescript
export interface DifficultyModifiers {
  reactionTime: number;   // seconds delay before AI reacts (lower = harder)
  accuracyMod: number;    // multiplier on shot accuracy (higher = harder)
  decisionQuality: number; // 0-1, how often AI picks optimal action
}

export function getDifficultyModifiers(seed: number, tournamentRound: number): DifficultyModifiers {
  // Seed 1 = hardest, 16 = easiest. Normalize to 0-1 (0 = hard, 1 = easy).
  const seedFactor = (seed - 1) / 15;

  // Round 1-6: later rounds slightly increase difficulty
  const roundBonus = (tournamentRound - 1) * 0.03;

  return {
    reactionTime: Math.max(0.05, 0.1 + seedFactor * 0.8 - roundBonus * 2),
    accuracyMod: Math.min(1.2, Math.max(0.3, 1.0 - seedFactor * 0.5 + roundBonus)),
    decisionQuality: Math.min(1, Math.max(0.3, 0.9 - seedFactor * 0.5 + roundBonus)),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ai/difficulty.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ai/difficulty.ts tests/ai/difficulty.test.ts
git commit -m "feat: add difficulty scaling based on seed ranking and tournament round"
```

Note: Chunks 5-7 continue in a separate plan file due to size. See `docs/superpowers/plans/2026-03-16-march-madness-3v3-part2.md`.

---

## Chunk 5: Escalation Systems

### Task 18: Powerup System

**Files:**
- Create: `src/systems/powerups.ts`
- Test: `tests/systems/powerups.test.ts`

- [ ] **Step 1: Write powerup system tests**

Create `tests/systems/powerups.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { PowerupSystem } from '@/systems/powerups';
import { EventBus } from '@/core/events';

describe('PowerupSystem', () => {
  it('selects tier 1 powerup for deficit 1-4', () => {
    const ps = new PowerupSystem(new EventBus());
    const p = ps.selectPowerup(3);
    expect(['speed-burst', 'hot-hand', 'sticky-fingers']).toContain(p);
  });

  it('selects tier 2 powerup for deficit 5-9', () => {
    const ps = new PowerupSystem(new EventBus());
    const p = ps.selectPowerup(7);
    expect(['on-fire', 'phantom-step', 'brick-wall']).toContain(p);
  });

  it('selects tier 3 powerup for deficit 10+', () => {
    const ps = new PowerupSystem(new EventBus());
    const p = ps.selectPowerup(12);
    expect(['giant-ball', 'trampoline', 'force-field']).toContain(p);
  });

  it('returns null when no deficit', () => {
    const ps = new PowerupSystem(new EventBus());
    expect(ps.selectPowerup(0)).toBeNull();
  });

  it('spawns powerup orb when meter reaches 100', () => {
    const events = new EventBus();
    const handler = vi.fn();
    events.on('powerup', handler);
    const ps = new PowerupSystem(events);
    ps.chargeMeter(100);
    ps.update(5, 1 / 60); // deficit of 5
    expect(ps.activeOrb).not.toBeNull();
  });

  it('only allows one active powerup at a time', () => {
    const ps = new PowerupSystem(new EventBus());
    ps.chargeMeter(100);
    ps.update(5, 1 / 60);
    const first = ps.activeOrb;
    ps.chargeMeter(100);
    ps.update(5, 1 / 60);
    expect(ps.activeOrb).toBe(first); // didn't spawn a second
  });

  it('deactivates powerup after duration expires', () => {
    const ps = new PowerupSystem(new EventBus());
    ps.activateForTeam('home', 'speed-burst');
    expect(ps.getActiveForTeam('home')).toBe('speed-burst');
    // Simulate 6 seconds (speed-burst lasts 5)
    for (let i = 0; i < 360; i++) ps.tick(1 / 60);
    expect(ps.getActiveForTeam('home')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/systems/powerups.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement powerup system**

Create `src/systems/powerups.ts`:
```typescript
import type { PowerupType, Possession } from '@/core/types';
import { POWERUP_TIERS } from '@/core/types';
import type { EventBus } from '@/core/events';

interface PowerupOrb {
  type: PowerupType;
  position: { x: number; z: number };
}

interface ActivePowerup {
  type: PowerupType;
  remaining: number; // seconds
}

const DURATIONS: Partial<Record<PowerupType, number>> = {
  'speed-burst': 5,
  'hot-hand': 10,
  'sticky-fingers': 8,
  'on-fire': 15,
  'phantom-step': 1, // single use
  'brick-wall': 8,
  'giant-ball': 12,
  'trampoline': 10,
  'force-field': 10,
};

export class PowerupSystem {
  activeOrb: PowerupOrb | null = null;
  private meter = 0;
  private activePowerups: Record<Possession, ActivePowerup | null> = { home: null, away: null };
  private events: EventBus;

  constructor(events: EventBus) {
    this.events = events;
  }

  selectPowerup(deficit: number): PowerupType | null {
    if (deficit <= 0) return null;
    for (const tier of [3, 2, 1]) {
      const t = POWERUP_TIERS[tier];
      if (deficit >= t.minDeficit && deficit <= t.maxDeficit) {
        return t.types[Math.floor(Math.random() * t.types.length)];
      }
    }
    return null;
  }

  chargeMeter(amount: number): void {
    this.meter = Math.min(100, this.meter + amount);
  }

  update(deficit: number, _dt: number): void {
    if (this.meter >= 100 && !this.activeOrb && deficit > 0) {
      const type = this.selectPowerup(deficit);
      if (type) {
        this.activeOrb = {
          type,
          position: { x: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 8 },
        };
        this.meter = 0;
      }
    }
  }

  pickupOrb(team: Possession): PowerupType | null {
    if (!this.activeOrb) return null;
    const type = this.activeOrb.type;
    this.activateForTeam(team, type);
    this.activeOrb = null;
    this.events.emit('powerup', { type, team });
    return type;
  }

  activateForTeam(team: Possession, type: PowerupType): void {
    this.activePowerups[team] = { type, remaining: DURATIONS[type] ?? 10 };
  }

  getActiveForTeam(team: Possession): PowerupType | null {
    return this.activePowerups[team]?.type ?? null;
  }

  tick(dt: number): void {
    for (const team of ['home', 'away'] as Possession[]) {
      const p = this.activePowerups[team];
      if (p) {
        p.remaining -= dt;
        if (p.remaining <= 0) {
          this.activePowerups[team] = null;
        }
      }
    }
    // Passive meter charge
    this.meter += dt * 2;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/systems/powerups.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/systems/powerups.ts tests/systems/powerups.test.ts
git commit -m "feat: add tiered powerup system with meter charging, orb spawning, and timed effects"
```

---

### Task 19: Crowd Intensity System

**Files:**
- Create: `src/systems/crowd.ts`
- Test: `tests/systems/crowd.test.ts`

- [ ] **Step 1: Write crowd system tests**

Create `tests/systems/crowd.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { CrowdSystem } from '@/systems/crowd';
import { EventBus } from '@/core/events';

describe('CrowdSystem', () => {
  it('starts at CALM', () => {
    const cs = new CrowdSystem(new EventBus());
    expect(cs.level).toBe('CALM');
  });

  it('increases intensity on highlight events', () => {
    const cs = new CrowdSystem(new EventBus());
    cs.onEvent('dunk');
    cs.onEvent('dunk');
    cs.onEvent('block');
    expect(cs.intensityValue).toBeGreaterThan(0);
  });

  it('escalates through all 5 levels', () => {
    const cs = new CrowdSystem(new EventBus());
    // Pump events to max
    for (let i = 0; i < 30; i++) cs.onEvent('dunk');
    expect(cs.level).toBe('CHAOS');
  });

  it('decays over time with no events', () => {
    const cs = new CrowdSystem(new EventBus());
    for (let i = 0; i < 15; i++) cs.onEvent('dunk');
    const peakIntensity = cs.intensityValue;
    // Simulate 20 seconds of no events
    for (let i = 0; i < 1200; i++) cs.tick(1 / 60);
    expect(cs.intensityValue).toBeLessThan(peakIntensity);
  });

  it('big score differential raises intensity', () => {
    const cs = new CrowdSystem(new EventBus());
    cs.updateScoreDiff(12);
    cs.tick(1);
    expect(cs.intensityValue).toBeGreaterThan(0);
  });

  it('returns momentum modifier for underdog', () => {
    const cs = new CrowdSystem(new EventBus());
    for (let i = 0; i < 25; i++) cs.onEvent('dunk');
    const mod = cs.getMomentumModifier();
    expect(mod).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/systems/crowd.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement crowd system**

Create `src/systems/crowd.ts`:
```typescript
import type { CrowdLevel } from '@/core/types';
import { CROWD_LEVELS } from '@/core/types';
import type { EventBus } from '@/core/events';

type CrowdEvent = 'score' | 'dunk' | 'block' | 'steal' | 'powerup' | 'sub-in' | 'consecutive-score';

const EVENT_INTENSITY: Record<CrowdEvent, number> = {
  score: 5,
  dunk: 15,
  block: 12,
  steal: 8,
  powerup: 10,
  'sub-in': 20,
  'consecutive-score': 8,
};

const LEVEL_THRESHOLDS = [0, 20, 40, 65, 85]; // CALM, ENGAGED, HYPED, ROWDY, CHAOS
const DECAY_RATE = 1.33; // per second (~1 level per 15 seconds)

export class CrowdSystem {
  intensityValue = 0;
  private scoreDiff = 0;
  private events: EventBus;

  constructor(events: EventBus) {
    this.events = events;
  }

  get level(): CrowdLevel {
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (this.intensityValue >= LEVEL_THRESHOLDS[i]) {
        return CROWD_LEVELS[i];
      }
    }
    return 'CALM';
  }

  get levelIndex(): number {
    return CROWD_LEVELS.indexOf(this.level);
  }

  onEvent(event: CrowdEvent): void {
    this.intensityValue = Math.min(100, this.intensityValue + (EVENT_INTENSITY[event] ?? 5));
    this.events.emit('crowd-change', { level: this.level });
  }

  updateScoreDiff(diff: number): void {
    this.scoreDiff = Math.abs(diff);
    // Big differentials keep intensity elevated
    if (this.scoreDiff >= 10) {
      this.intensityValue = Math.max(this.intensityValue, 50);
    }
  }

  tick(dt: number): void {
    // Decay toward baseline
    const baseline = this.scoreDiff >= 10 ? 40 : this.scoreDiff >= 5 ? 20 : 0;
    if (this.intensityValue > baseline) {
      this.intensityValue = Math.max(baseline, this.intensityValue - DECAY_RATE * dt);
    }
  }

  getMomentumModifier(): number {
    // At high intensity, underdog gets a slight boost (0 to 0.1)
    return this.levelIndex * 0.025;
  }

  getScreenShakeIntensity(): number {
    return this.levelIndex * 0.2; // 0 to 0.8
  }

  getCrowdAnimSpeed(): number {
    return 1 + this.levelIndex * 0.3; // 1x to 2.2x
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/systems/crowd.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/systems/crowd.ts tests/systems/crowd.test.ts
git commit -m "feat: add crowd intensity system with 5 levels, event-driven escalation, and decay"
```

---

### Task 20: Sub-In System

**Files:**
- Create: `src/systems/sub-in.ts`
- Test: `tests/systems/sub-in.test.ts`

- [ ] **Step 1: Write sub-in system tests**

Create `tests/systems/sub-in.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { SubInSystem, type SubInStage } from '@/systems/sub-in';

describe('SubInSystem', () => {
  it('returns null stage when no bet is active', () => {
    const si = new SubInSystem();
    expect(si.getStage(5)).toBeNull();
  });

  it('returns null when bet team is winning', () => {
    const si = new SubInSystem();
    si.activateBet('team-a');
    expect(si.getStage(-3)).toBeNull(); // negative = bet team winning
  });

  it('returns subtle prompt for deficit 3-5', () => {
    const si = new SubInSystem();
    si.activateBet('team-a');
    expect(si.getStage(4)!.stage).toBe('subtle');
  });

  it('returns pulsing alert for deficit 6-9', () => {
    const si = new SubInSystem();
    si.activateBet('team-a');
    expect(si.getStage(7)!.stage).toBe('pulsing');
  });

  it('returns urgent call for deficit 10-14', () => {
    const si = new SubInSystem();
    si.activateBet('team-a');
    expect(si.getStage(12)!.stage).toBe('urgent');
  });

  it('returns last stand for deficit 15+', () => {
    const si = new SubInSystem();
    si.activateBet('team-a');
    expect(si.getStage(18)!.stage).toBe('last-stand');
  });

  it('grants starting powerup scaled to deficit', () => {
    const si = new SubInSystem();
    si.activateBet('team-a');
    const small = si.getEntryPowerupTier(4);
    const big = si.getEntryPowerupTier(15);
    expect(big).toBeGreaterThan(small);
  });

  it('finds lowest performer for replacement', () => {
    const performers = [
      { id: 'a', score: 5 },
      { id: 'b', score: -2 },
      { id: 'c', score: 3 },
    ];
    expect(SubInSystem.findReplacementTarget(performers)).toBe('b');
  });

  it('disables after sub-in is executed', () => {
    const si = new SubInSystem();
    si.activateBet('team-a');
    expect(si.getStage(10)).not.toBeNull();
    si.executeSubIn();
    expect(si.getStage(10)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/systems/sub-in.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement sub-in system**

Create `src/systems/sub-in.ts`:
```typescript
export type SubInStageName = 'subtle' | 'pulsing' | 'urgent' | 'last-stand';

export interface SubInStage {
  stage: SubInStageName;
  deficit: number;
}

const STAGE_THRESHOLDS: { min: number; max: number; stage: SubInStageName }[] = [
  { min: 3, max: 5, stage: 'subtle' },
  { min: 6, max: 9, stage: 'pulsing' },
  { min: 10, max: 14, stage: 'urgent' },
  { min: 15, max: Infinity, stage: 'last-stand' },
];

export class SubInSystem {
  private betTeamId: string | null = null;
  private subbedIn = false;

  activateBet(teamId: string): void {
    this.betTeamId = teamId;
    this.subbedIn = false;
  }

  deactivate(): void {
    this.betTeamId = null;
    this.subbedIn = false;
  }

  executeSubIn(): void {
    this.subbedIn = true;
  }

  getStage(deficit: number): SubInStage | null {
    if (!this.betTeamId || this.subbedIn || deficit < 3) return null;
    for (const t of STAGE_THRESHOLDS) {
      if (deficit >= t.min && deficit <= t.max) {
        return { stage: t.stage, deficit };
      }
    }
    return null;
  }

  getEntryPowerupTier(deficit: number): number {
    if (deficit >= 15) return 3;
    if (deficit >= 10) return 3;
    if (deficit >= 6) return 2;
    return 1;
  }

  getEntranceDuration(deficit: number): number {
    // Seconds for the entrance cinematic
    if (deficit >= 15) return 4;
    if (deficit >= 10) return 3;
    if (deficit >= 6) return 2;
    return 1;
  }

  static findReplacementTarget(performers: { id: string; score: number }[]): string {
    let lowest = performers[0];
    for (const p of performers) {
      if (p.score < lowest.score) lowest = p;
    }
    return lowest.id;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/systems/sub-in.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/systems/sub-in.ts tests/systems/sub-in.test.ts
git commit -m "feat: add sub-in escalation system with 4 stages, entry powerups, and replacement logic"
```

---
