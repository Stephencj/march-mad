# Freeplay Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Freeplay/debug mode with per-player AI toggling for testing and tuning gameplay mechanics.

**Architecture:** New `Freeplay` app state, AI disable set in GameSession, debug panel overlay, menu button.

**Tech Stack:** TypeScript, Three.js, Vitest

**Spec:** `docs/superpowers/specs/2026-03-28-freeplay-mode-design.md`

---

### Task 1: Add Freeplay State and AI Control to GameSession

**Files:**
- Modify: `src/core/types.ts:139-142`
- Modify: `src/game/game-session.ts`
- Test: `tests/game/freeplay-ai.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/game/freeplay-ai.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { EventBus } from '@/core/events';
import { GameSession } from '@/game/game-session';
import { generateTeams } from '@/data/teams';

describe('Freeplay AI control', () => {
  function createSession() {
    const events = new EventBus();
    const teams = generateTeams(5);
    return new GameSession(events, teams[0], teams[1], teams[0].players[0].id, '5v5');
  }

  it('should have all AI enabled by default', () => {
    const session = createSession();
    const players = session.getAllPlayers();
    for (const p of players) {
      expect(session.isAIEnabled(p.data.id)).toBe(true);
    }
  });

  it('should disable AI for a specific player', () => {
    const session = createSession();
    const players = session.getAllPlayers();
    const targetId = players[1].data.id;
    session.disableAI(targetId);
    expect(session.isAIEnabled(targetId)).toBe(false);
  });

  it('should re-enable AI for a player', () => {
    const session = createSession();
    const players = session.getAllPlayers();
    const targetId = players[1].data.id;
    session.disableAI(targetId);
    session.enableAI(targetId);
    expect(session.isAIEnabled(targetId)).toBe(true);
  });

  it('should disable AI for multiple players', () => {
    const session = createSession();
    const players = session.getAllPlayers();
    session.disableAI(players[1].data.id);
    session.disableAI(players[2].data.id);
    expect(session.isAIEnabled(players[1].data.id)).toBe(false);
    expect(session.isAIEnabled(players[2].data.id)).toBe(false);
    expect(session.isAIEnabled(players[3].data.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/freeplay-ai.test.ts`
Expected: FAIL — `disableAI` not a function

- [ ] **Step 3: Add Freeplay to AppState**

In `src/core/types.ts`, change the AppState type (line 139-142):

```typescript
export type AppState =
  | 'MainMenu' | 'PlayerCreation' | 'TournamentSelect' | 'DraftPhase'
  | 'BracketView' | 'YourGame' | 'Spectating' | 'BettingOverlay'
  | 'SubInCinematic' | 'PostGame' | 'TournamentEnd' | 'Freeplay';
```

- [ ] **Step 4: Add AI control methods to GameSession**

In `src/game/game-session.ts`, add a new field after `private hapticManager`:

```typescript
private aiDisabledPlayers = new Set<string>();
```

Add these public methods after `setHapticManager()`:

```typescript
disableAI(playerId: string): void {
  this.aiDisabledPlayers.add(playerId);
}

enableAI(playerId: string): void {
  this.aiDisabledPlayers.delete(playerId);
}

isAIEnabled(playerId: string): boolean {
  return !this.aiDisabledPlayers.has(playerId);
}

setFreeplayMode(): void {
  this.matchEngine.state.clockSeconds = 99999;
  this.matchEngine.state.shotClockSeconds = 99999;
}
```

- [ ] **Step 5: Skip disabled players in runAI**

In `src/game/game-session.ts`, in the `runAI()` method (~line 893), right after the human player skip:

```typescript
if (player.data.id === this.humanPlayerId) continue;
```

Add:

```typescript
if (this.aiDisabledPlayers.has(player.data.id)) continue;
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/game/freeplay-ai.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/game/game-session.ts tests/game/freeplay-ai.test.ts
git commit -m "feat: freeplay AI control — per-player AI enable/disable + Freeplay app state"
```

---

### Task 2: Freeplay Debug Panel

**Files:**
- Create: `src/ui/freeplay-panel.ts`
- Test: `tests/ui/freeplay-panel.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/ui/freeplay-panel.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FreeplayPanel } from '@/ui/freeplay-panel';

interface MockPlayer {
  id: string;
  name: string;
  position: string;
  team: 'home' | 'away';
}

describe('FreeplayPanel', () => {
  let container: HTMLElement;
  let panel: FreeplayPanel;
  let onToggle: ReturnType<typeof vi.fn>;
  const players: MockPlayer[] = [
    { id: 'h1', name: 'Player 1', position: 'PG', team: 'home' },
    { id: 'h2', name: 'Player 2', position: 'SG', team: 'home' },
    { id: 'a1', name: 'Opp 1', position: 'PG', team: 'away' },
    { id: 'a2', name: 'Opp 2', position: 'SG', team: 'away' },
  ];

  beforeEach(() => {
    container = document.createElement('div');
    onToggle = vi.fn();
    panel = new FreeplayPanel(container, onToggle);
    panel.setup(players, 'h1');
  });

  it('should render toggle rows for non-human players', () => {
    const rows = container.querySelectorAll('[data-player-id]');
    expect(rows.length).toBe(3); // h2, a1, a2 (h1 is human, excluded)
  });

  it('should call onToggle when clicking a player toggle', () => {
    const toggle = container.querySelector('[data-player-id="h2"] button') as HTMLButtonElement;
    toggle?.click();
    expect(onToggle).toHaveBeenCalledWith('h2', false); // was on, now off
  });

  it('should render bulk toggles', () => {
    const bulkBtns = container.querySelectorAll('[data-bulk]');
    expect(bulkBtns.length).toBe(2); // teammates, opponents
  });

  it('should toggle visibility', () => {
    panel.show();
    expect(panel.visible).toBe(true);
    panel.hide();
    expect(panel.visible).toBe(false);
  });

  it('should toggle all teammates', () => {
    const btn = container.querySelector('[data-bulk="teammates"]') as HTMLButtonElement;
    btn?.click();
    // Should have called onToggle for h2 (the only non-human teammate)
    expect(onToggle).toHaveBeenCalledWith('h2', false);
  });

  it('should toggle all opponents', () => {
    const btn = container.querySelector('[data-bulk="opponents"]') as HTMLButtonElement;
    btn?.click();
    expect(onToggle).toHaveBeenCalledWith('a1', false);
    expect(onToggle).toHaveBeenCalledWith('a2', false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/freeplay-panel.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement FreeplayPanel**

Create `src/ui/freeplay-panel.ts`:

```typescript
interface PlayerInfo {
  id: string;
  name: string;
  position: string;
  team: 'home' | 'away';
}

export class FreeplayPanel {
  visible = false;
  private container: HTMLElement;
  private panel: HTMLDivElement | null = null;
  private onToggle: (playerId: string, enabled: boolean) => void;
  private playerStates = new Map<string, boolean>(); // true = AI on
  private humanId = '';
  private players: PlayerInfo[] = [];

  constructor(container: HTMLElement, onToggle: (playerId: string, enabled: boolean) => void) {
    this.container = container;
    this.onToggle = onToggle;
  }

  setup(players: PlayerInfo[], humanPlayerId: string): void {
    this.humanId = humanPlayerId;
    this.players = players;

    // All AI starts enabled
    for (const p of players) {
      if (p.id !== humanPlayerId) {
        this.playerStates.set(p.id, true);
      }
    }

    this.render();
  }

  private render(): void {
    if (this.panel) {
      this.container.removeChild(this.panel);
    }

    this.panel = document.createElement('div');
    Object.assign(this.panel.style, {
      position: 'absolute',
      top: '60px',
      right: '10px',
      width: '240px',
      background: 'rgba(10, 10, 30, 0.85)',
      borderRadius: '8px',
      padding: '12px',
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#ffffff',
      pointerEvents: 'auto',
      zIndex: '1000',
      maxHeight: '80vh',
      overflowY: 'auto',
    });

    // Title
    const title = document.createElement('div');
    title.textContent = 'FREEPLAY DEBUG';
    Object.assign(title.style, {
      fontSize: '14px',
      fontWeight: 'bold',
      marginBottom: '8px',
      color: '#e94560',
      textAlign: 'center',
    });
    this.panel.appendChild(title);

    // Bulk toggles
    const teammates = this.players.filter(p => p.id !== this.humanId && p.team === this.players.find(h => h.id === this.humanId)?.team);
    const opponents = this.players.filter(p => p.team !== this.players.find(h => h.id === this.humanId)?.team);

    this.panel.appendChild(this.createBulkToggle('All Teammates AI', 'teammates', teammates));
    this.panel.appendChild(this.createBulkToggle('All Opponents AI', 'opponents', opponents));

    // Separator
    const sep = document.createElement('hr');
    Object.assign(sep.style, { border: 'none', borderTop: '1px solid #333', margin: '8px 0' });
    this.panel.appendChild(sep);

    // Per-player toggles
    const homeTeam = this.players.find(h => h.id === this.humanId)?.team;
    const homePlayers = this.players.filter(p => p.team === homeTeam && p.id !== this.humanId);
    const awayPlayers = this.players.filter(p => p.team !== homeTeam);

    if (homePlayers.length > 0) {
      this.panel.appendChild(this.createHeader('YOUR TEAM'));
      for (const p of homePlayers) {
        this.panel.appendChild(this.createPlayerRow(p));
      }
    }

    if (awayPlayers.length > 0) {
      this.panel.appendChild(this.createHeader('OPPONENTS'));
      for (const p of awayPlayers) {
        this.panel.appendChild(this.createPlayerRow(p));
      }
    }

    this.container.appendChild(this.panel);
    this.panel.style.display = this.visible ? 'block' : 'none';
  }

  private createHeader(text: string): HTMLElement {
    const h = document.createElement('div');
    h.textContent = text;
    Object.assign(h.style, {
      fontSize: '11px',
      color: '#888',
      marginTop: '8px',
      marginBottom: '4px',
      fontWeight: 'bold',
    });
    return h;
  }

  private createBulkToggle(label: string, type: string, players: PlayerInfo[]): HTMLElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '4px 0',
    });

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.color = '#ccc';

    const btn = document.createElement('button');
    btn.dataset.bulk = type;
    btn.textContent = 'ON';
    Object.assign(btn.style, {
      background: '#2ecc71',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      padding: '2px 8px',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: 'bold',
      minWidth: '36px',
    });

    let allOn = true;
    btn.addEventListener('click', () => {
      allOn = !allOn;
      for (const p of players) {
        this.playerStates.set(p.id, allOn);
        this.onToggle(p.id, allOn);
      }
      btn.textContent = allOn ? 'ON' : 'OFF';
      btn.style.background = allOn ? '#2ecc71' : '#e74c3c';
      // Update individual buttons
      this.updatePlayerButtons();
    });

    row.appendChild(lbl);
    row.appendChild(btn);
    return row;
  }

  private createPlayerRow(player: PlayerInfo): HTMLElement {
    const row = document.createElement('div');
    row.dataset.playerId = player.id;
    Object.assign(row.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '2px 0',
    });

    const lbl = document.createElement('span');
    lbl.textContent = `${player.position} ${player.name}`;
    lbl.style.color = '#aaa';
    lbl.style.fontSize = '11px';
    lbl.style.overflow = 'hidden';
    lbl.style.textOverflow = 'ellipsis';
    lbl.style.whiteSpace = 'nowrap';
    lbl.style.maxWidth = '160px';

    const btn = document.createElement('button');
    btn.dataset.aiToggle = player.id;
    const isOn = this.playerStates.get(player.id) ?? true;
    btn.textContent = isOn ? 'ON' : 'OFF';
    Object.assign(btn.style, {
      background: isOn ? '#2ecc71' : '#e74c3c',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      padding: '2px 8px',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: 'bold',
      minWidth: '36px',
    });

    btn.addEventListener('click', () => {
      const current = this.playerStates.get(player.id) ?? true;
      const newState = !current;
      this.playerStates.set(player.id, newState);
      this.onToggle(player.id, newState);
      btn.textContent = newState ? 'ON' : 'OFF';
      btn.style.background = newState ? '#2ecc71' : '#e74c3c';
    });

    row.appendChild(lbl);
    row.appendChild(btn);
    return row;
  }

  private updatePlayerButtons(): void {
    if (!this.panel) return;
    const toggles = this.panel.querySelectorAll('[data-ai-toggle]') as NodeListOf<HTMLButtonElement>;
    for (const btn of toggles) {
      const id = btn.dataset.aiToggle!;
      const isOn = this.playerStates.get(id) ?? true;
      btn.textContent = isOn ? 'ON' : 'OFF';
      btn.style.background = isOn ? '#2ecc71' : '#e74c3c';
    }
  }

  show(): void {
    this.visible = true;
    if (this.panel) this.panel.style.display = 'block';
  }

  hide(): void {
    this.visible = false;
    if (this.panel) this.panel.style.display = 'none';
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  destroy(): void {
    if (this.panel) {
      this.container.removeChild(this.panel);
      this.panel = null;
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ui/freeplay-panel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/freeplay-panel.ts tests/ui/freeplay-panel.test.ts
git commit -m "feat: FreeplayPanel — per-player AI toggle debug overlay"
```

---

### Task 3: Wire Freeplay Into Main Menu and Game Loop

**Files:**
- Modify: `src/main.ts`
- Modify: `src/ui/menus.ts`

- [ ] **Step 1: Add Freeplay button to main menu**

In `src/ui/menus.ts`, in `renderMainMenu()`, after the Controls button (~line 156):

```typescript
wrapper.appendChild(this.createSecondaryButton('Controls', 'settings'));
```

Add:

```typescript
wrapper.appendChild(this.createSecondaryButton('Freeplay', 'freeplay'));
```

- [ ] **Step 2: Add Freeplay transitions to state machine**

In `src/main.ts`, in the transitions array (~line 54-75), add:

```typescript
{ from: 'MainMenu', to: 'Freeplay' },
{ from: 'Freeplay', to: 'MainMenu' },
```

- [ ] **Step 3: Add FreeplayPanel import and instantiation**

In `src/main.ts`, add import:

```typescript
import { FreeplayPanel } from './ui/freeplay-panel';
```

After the pause menu setup (~line 200), create the freeplay panel:

```typescript
let freeplayPanel: FreeplayPanel | null = null;
```

- [ ] **Step 4: Add startFreeplay function**

In `src/main.ts`, add after `startMainGame()`:

```typescript
function startFreeplay(): void {
  if (session) {
    session.removeFromScene(scene);
  }
  // Full court
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
  session.setHapticManager(hapticManager);
  session.setFreeplayMode();
  session.start();

  // Setup debug panel
  const allPlayers = session.getAllPlayers();
  const playerInfos = allPlayers.map(p => ({
    id: p.data.id,
    name: p.data.name,
    position: p.data.position,
    team: session!.isHomePlayer(p) ? 'home' as const : 'away' as const,
  }));

  freeplayPanel = new FreeplayPanel(hudContainer, (playerId, enabled) => {
    if (enabled) session!.enableAI(playerId);
    else session!.disableAI(playerId);
  });
  freeplayPanel.setup(playerInfos, teams[0].players[0].id);
  freeplayPanel.show();

  stateMachine.transition('Freeplay');
  hud.updateScore(0, 0);
  hud.updateClock(99999);
}
```

Note: `isHomePlayer` is currently private. Make it public in `game-session.ts`:

```typescript
// Change from: private isHomePlayer(player: GamePlayer): boolean
// To:
isHomePlayer(player: GamePlayer): boolean
```

- [ ] **Step 5: Add freeplay action handler**

In `handleMenuAction()`, add:

```typescript
if (action === 'freeplay') {
  startFreeplay();
}
```

- [ ] **Step 6: Add tilde key toggle for debug panel**

In the keydown handler (~line 120-137), add before the Escape check:

```typescript
if (e.code === 'Backquote' && stateMachine.current === 'Freeplay') {
  freeplayPanel?.toggle();
  return;
}
```

- [ ] **Step 7: Handle Freeplay in game loop**

The game loop currently checks `stateMachine.current === 'YourGame'`. Update it to also handle Freeplay. Find:

```typescript
if (session && stateMachine.current === 'YourGame' && inputManager.checkPause()) {
```

Change to:

```typescript
const isPlaying = stateMachine.current === 'YourGame' || stateMachine.current === 'Freeplay';
if (session && isPlaying && inputManager.checkPause()) {
```

And find:

```typescript
if (session && stateMachine.current === 'YourGame' && !isPaused) {
```

Change to:

```typescript
if (session && isPlaying && !isPaused) {
```

Note: Define `isPlaying` once before both checks so it's reused.

- [ ] **Step 8: Handle quit from Freeplay**

In the pause menu quit handler, update to handle Freeplay state too. The existing quit code transitions to MainMenu — it should also clean up the freeplay panel:

After `session = null;` in the quit handler, add:

```typescript
if (freeplayPanel) {
  freeplayPanel.destroy();
  freeplayPanel = null;
}
```

- [ ] **Step 9: Add state machine hooks for Freeplay**

After the existing `stateMachine.onEnter` calls:

```typescript
stateMachine.onExit('Freeplay', () => {
  if (freeplayPanel) {
    freeplayPanel.destroy();
    freeplayPanel = null;
  }
});
```

- [ ] **Step 10: Verify it works**

Run: `npm run dev`
Test: click Freeplay from main menu, verify game loads, press ~ to show/hide panel, toggle AI on/off for individual players and bulk groups.

- [ ] **Step 11: Commit**

```bash
git add src/main.ts src/ui/menus.ts src/game/game-session.ts
git commit -m "feat: freeplay mode — menu button, debug panel, AI toggles, tilde to show/hide"
```

---

### Task 4: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Fix any failures**

- [ ] **Step 3: Commit if needed**

```bash
git add -A
git commit -m "fix: test suite cleanup after freeplay mode"
```
