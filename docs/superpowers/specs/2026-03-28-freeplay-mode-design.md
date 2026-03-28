# Freeplay/Debug Mode

**Date:** 2026-03-28
**Scope:** New game mode for testing and tuning gameplay mechanics

---

## 1. Freeplay Game State

- Add `'Freeplay'` to `AppState` type in `src/core/types.ts`
- Transitions: `MainMenu → Freeplay`, `Freeplay → MainMenu`
- Uses same `GameSession` as 5v5 but with infinite clock and no shot clock
- Full court, all 10 players loaded

## 2. GameSession AI Control

- New field: `aiDisabledPlayers: Set<string>` — tracks which players have AI turned off
- New methods:
  - `disableAI(playerId: string)` — adds to set
  - `enableAI(playerId: string)` — removes from set
  - `isAIEnabled(playerId: string): boolean` — checks set
  - `setFreeplayMode()` — disables game clock and shot clock
- In `runAI()`: skip any player whose ID is in `aiDisabledPlayers`
- When AI is disabled: player stands idle, doesn't move, doesn't chase ball, doesn't shoot/defend
- Player is still a physical body — can receive passes, be bumped into, etc.

## 3. Freeplay Debug Panel (`src/ui/freeplay-panel.ts`)

Overlay panel with toggle switches:

- **Bulk toggles:**
  - "All Teammates AI" — on/off toggle for all 4 AI teammates
  - "All Opponents AI" — on/off toggle for all 5 opponents
- **Per-player toggles:**
  - 10 rows total (home team header + 5 players, away team header + 5 players)
  - Each row: player name/position + on/off toggle button
  - Green = AI on, red = AI off
- **Show/hide:** Tilde (~) key or gamepad Select button (button 8) toggles panel visibility
- **Position:** Right side of screen, semi-transparent dark background, doesn't block center court view
- Controller-friendly: registered with MenuNavigator when visible

## 4. Menu Integration

- Add "Freeplay" secondary button to main menu (below existing buttons)
- `handleMenuAction` routes `'freeplay'` to `startFreeplay()`
- `startFreeplay()`: creates full court, generates 5v5 teams, creates GameSession, calls `session.setFreeplayMode()`, shows debug panel

## Files Changed

| File | Change |
|------|--------|
| `src/core/types.ts` | Add `'Freeplay'` to AppState |
| `src/game/game-session.ts` | Add aiDisabledPlayers set, disableAI/enableAI methods, setFreeplayMode |
| `src/ui/freeplay-panel.ts` | **New** — debug overlay with per-player AI toggles |
| `src/ui/menus.ts` | Add Freeplay button to main menu |
| `src/main.ts` | Add Freeplay transition, startFreeplay function, wire panel, tilde key handler |
