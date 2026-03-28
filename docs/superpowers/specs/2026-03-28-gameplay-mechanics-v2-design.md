# Gameplay Mechanics V2: Passing, Shooting, Dunking, Menu Navigation

**Date:** 2026-03-28
**Scope:** Direction-based passing, shot range limiting, dunk zone rework, controller-friendly menus

---

## 1. Direction-Based Passing

### Problem
- Pass target selected by raw distance only — ignores which direction the player is facing
- Ball stops dead on arrival (`velocity = (0,0,0)` in `ball.ts:198-203`)
- Random 15% per-frame jump-catch interception feels unfair and unpredictable

### Target Selection
Replace `findNearestTeammate()` in `game-session.ts:1215-1227` with `findBestPassTarget(passer)`:
- Compute passer's facing angle from `passer.group.rotation.y`
- For each teammate, compute:
  - `directionToTeammate` = normalized vector from passer to teammate
  - `facingDir` = `(sin(rotation.y), cos(rotation.y))` (the direction the player model faces)
  - `alignment` = dot product of `facingDir` and `directionToTeammate`, clamped to [0, 1]
  - `distanceFactor` = `1 / distance` (closer is better, but secondary to direction)
  - `score = alignment * 0.7 + distanceFactor * 0.3`
- Return teammate with highest score
- Teammates with negative dot product (behind passer) get `alignment = 0`, so they can still be selected if they're the only option, but heavily deprioritized

### Ball Arrival
- Remove the dead-stop in `ball.ts` pass arrival logic (lines 198-203 where velocity is zeroed)
- Instead, let `checkBallPickup()` in `game-session.ts:1134-1172` grab the ball during flight when receiver is within pickup radius (1.0 unit)
- If the ball reaches the target position without being picked up, it continues past with decaying velocity (multiply velocity by 0.95 per frame) until someone picks it up or it goes out of bounds
- This creates natural-feeling passes — the receiver catches the ball in stride

### Pass Reliability
- Passes travel reliably at speed 20 u/s across full court — they never fail on their own
- Remove the 15% per-frame jump-catch random interception (`game-session.ts:375-392`)
- Interception only happens when:
  1. A defender presses the Steal button while within 1.5 units of the ball in flight (existing 40% deflection logic in `attemptSteal`, `game-session.ts:1174-1188`)
  2. A defender is directly in the pass lane: within 1.0 unit of the ball's straight-line path AND within 1.5 units of the ball's current position — auto-deflection with 30% chance per frame the defender is in the lane
- Pass lane check: project defender position onto the pass line segment (passer→target), check perpendicular distance < 1.0

---

## 2. Shot Range Limiting

### Problem
- `ball.shootAt()` always arcs to the hoop regardless of distance — shots from half-court fly the full length
- Accuracy drops via `shot-accuracy.ts` but the ball still physically reaches the hoop

### Maximum Effective Range
- Max effective shot range: **12 units** from the hoop
- Within 12 units: normal behavior — arc to hoop, accuracy determines make/miss
- Beyond 12 units: the arc endpoint is clamped to a point 12 units from the shooter along the shooter→hoop line
  - The ball arcs to that clamped point, then the arc ends
  - Ball enters loose-ball physics (gravity, bounce) from the arc endpoint
  - Creates a natural "air ball" / short shot — ball drops and becomes live
- Implementation in `game-session.ts` swipe-up handler: before calling `ball.shootAt()`, check distance. If > 12, compute clamped target and call `ball.shootAt(clampedTarget, power)`. After arc completes, ball enters normal gravity physics (already handled by ball.ts State 4).

### AI Behavior
- AI already limits shooting to ~12 units — no changes needed for AI

---

## 3. Dunk Zone Rework

### Problem
- Dunk requires `dist < 5 && stamina >= 0.8` — stamina gate too harsh after sprinting
- The 5-unit trigger zone is large but measured from hoop center, not the approach area
- Dunks almost never trigger in practice

### Dunk Zone Definition
- The dunk zone is the **innermost third of the paint closest to the basket**:
  - `|x| < paintWidth/2` (1.8 units)
  - Distance from baseline: within `paintLength/3` (~1.93 units) of the hoop
  - Full court: `|x| < 1.8 AND (z > 11.07 OR z < -11.07)` for hoops at z=±13
  - Half court: `|x| < 1.8 AND z < -4.57` for hoop at z=-6.5 (approximate)
- Add a helper function `isInDunkZone(playerPos, attackHoop)` that checks these bounds

### Stamina Threshold
- Lower from **0.8 to 0.3** — players should dunk after sprinting, not only when fresh
- Keep existing success rate scaling:
  - Very close (< 1.5 units from hoop): 90%
  - Paint range (1.5-3 units): 70%
  - dunkPower stat modifier: `(dunkPower - 5) * 0.03`
- Keep contested dunk logic (defender between shooter and hoop, jumping, 60% turnover chance)

### Auto-Dunk in Zone
- In the swipe-up handler: if player is in dunk zone, always attempt dunk instead of shot
- No charge-level consideration for dunks — you're right at the basket, just dunk it
- This replaces the old `dist < 5 && stamina >= 0.8` check

---

## 4. Controller-Friendly Menus

### Problem
- All menus use `addEventListener('click')` only — no keyboard or gamepad navigation
- No focus system, no visual indicators, no way to navigate without a mouse

### MenuNavigator System
New class `src/ui/menu-navigator.ts`:

**State:**
- `focusedIndex: number` — currently highlighted item
- `items: HTMLElement[]` — registered interactive elements
- `columns: number` — grid column count (1 for vertical lists, N for grids)
- `active: boolean` — whether navigator is polling input

**Input Handling:**
- D-pad up/down: gamepad buttons 12/13 (standard mapping for D-pad) — move focus
- D-pad left/right: gamepad buttons 14/15 — move focus in grids
- Left stick Y-axis: with deadzone 0.5, repeat delay 200ms — move focus
- A button (gamepad button 0) / Enter key: select focused item (trigger click)
- B button (gamepad button 1) / Escape key: go back (trigger back callback)
- Arrow keys (keyboard): same as D-pad
- All one-shot (debounced) — no rapid-fire scrolling

**Visual Focus:**
- Focused item gets a CSS class `menu-focused` with:
  - `outline: 2px solid #e94560` (matches the game's accent color)
  - `outline-offset: 4px`
  - Subtle glow: `box-shadow: 0 0 10px rgba(233, 69, 96, 0.5)`
- Previous focused item has class removed
- Auto-scroll into view if needed

**Lifecycle:**
- `register(items: HTMLElement[], columns?: number)` — called when menu renders
- `clear()` — called when menu hides
- `setBackHandler(fn: () => void)` — sets B/Escape callback
- `update(pad: Gamepad | null)` — called per frame, polls gamepad + keyboard state

### Integration Points
Each menu class calls `menuNavigator.register()` after rendering buttons:

| Menu Screen | Items | Columns | Back Action |
|---|---|---|---|
| Main Menu | 4 buttons (Quick Play, Tournament, Create Player, Settings) | 1 | None (root) |
| Tournament Select | Team buttons | 1 | Main Menu |
| Settings/Controls | Volume sliders + back button | 1 | Main Menu |
| Draft UI | Player cards + reroll button | 3-4 (grid) | N/A |
| Bracket View | Match cards + continue button | 1 | N/A |
| Pause Menu | Resume, Controls, Quit buttons | 1 | Resume (unpause) |
| Pause Controls View | Back button | 1 | Pause view |
| Pause Quit Confirm | Yes, No buttons | 1 | Pause view |
| Post Game | Play Again, Main Menu buttons | 1 | Main Menu |

### Wiring
- `MenuNavigator` instantiated once in `main.ts`
- Passed to each menu UI class constructor or set via setter
- In the game loop: when any menu is visible AND game is not in `YourGame` playing state (or is paused), call `menuNavigator.update(pad)` per frame
- Keyboard arrow/enter listeners added globally, gated by `menuNavigator.active`

---

## Files Changed

| File | Change |
|------|--------|
| `src/game/game-session.ts` | Direction-based pass target, dunk zone check, shot range clamp, remove jump-catch interception, pass lane interception |
| `src/game/ball.ts` | Remove dead-stop on pass arrival, add velocity decay for uncaught passes |
| `src/game/shot-accuracy.ts` | No changes (accuracy system stays as-is) |
| `src/ui/menu-navigator.ts` | **New** — MenuNavigator focus/input system |
| `src/ui/menus.ts` | Register buttons with MenuNavigator |
| `src/ui/pause-menu.ts` | Register buttons with MenuNavigator |
| `src/ui/post-game.ts` | Register buttons with MenuNavigator |
| `src/ui/draft-ui.ts` | Register cards with MenuNavigator (grid mode) |
| `src/ui/bracket-view.ts` | Register items with MenuNavigator |
| `src/ui/betting-ui.ts` | Register buttons with MenuNavigator |
| `src/main.ts` | Instantiate MenuNavigator, wire update loop, add keyboard arrow/enter listeners |

## Testing

- Unit test: `findBestPassTarget()` direction scoring with mock player positions and rotations
- Unit test: `isInDunkZone()` boundary checks
- Unit test: shot range clamping at 12-unit boundary
- Unit test: `MenuNavigator` focus cycling, selection, grid navigation
- Unit test: pass lane interception geometry (perpendicular distance calculation)
- Manual: play-test passing feel, shot range, dunk triggering, menu navigation with controller
