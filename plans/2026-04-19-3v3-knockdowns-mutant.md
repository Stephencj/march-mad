# 3v3 + knockdown-fouls + invincibility + mutant mode

## Context
Four linked changes:
1. Matches are 3v3 instead of 5v5 (less clutter, lower runtime load).
2. Fouls get replaced by a "miss or knockdown" outcome: 33% knockdown, loose ball flies opposite the knocker's direction, up for grabs.
3. Per-team knockdown counter unlocks powers at 3 and 5.
4. At 3 knockdowns the hit team can activate a 30s invincibility where shots/dunks always score; using it resets the counter. At 5 knockdowns the team becomes a **MUTANT** — the bigger/weirder model, invincible + contact-knockback, double points, flashy activation.

## Research findings (two parallel agents)

**3v3 footprint.** Nearly trivial. The codebase is already mode-aware — `GameSession` has per-mode spawn positions, formations, and court bounds for both 3v3 and 5v5; `team-ai.ts` has 3v3 FORMATIONS ready; team generator defaults to 3. Only `main.ts` hardcodes `'5v5'` at two call sites. Option A: flip the two literals. Option B: remove 5v5 entirely (cleaner repo). Recommend A — keeps the 5v5 path alive for experimentation, is one commit.

**Foul system.** Cosmetic-only today — `match.callFoul()` just emits splash + charges the powerup meter. Only one real trigger: `attemptSteal()` has a 30% "foul" roll. Replace with: 33% → `def.triggerFall()` + shove ball opposite the attacker, else → miss (ball becomes loose). Low surgery.

**Existing primitives we reuse.**
- `GamePlayer.triggerFall()` (fallTimer=0.8s, full fall animation) — knockdown is already implemented visually.
- `ball.velocity` + loose-ball pickup — shoving the ball is one `.set(...)` call.
- `PowerupSystem` — already has per-team timed buffs (`hot-hand`, `on-fire`). Invincibility slots in cleanly.
- `POSITION_SCALES` pattern + `this.group.scale.set(...)` — mutant size mutation is a `scale.set` every tick.
- `hud.showSplash(text, color)` — already renders 48px glowing splash. Perfect for "INVINCIBLE!" and "MUTANT!".

## Phases

### Phase 1 — Flip to 3v3 (tiny)
- `main.ts`: change both `new GameSession(..., '5v5')` to `'3v3'`.
- Quick verification: spawn 3 per team, half-court bounds, 3v3 formations.
- Keep 5v5 path intact. One-commit reversible.

### Phase 2 — Replace fouls with miss-or-knockdown
- Retire `match.callFoul()`'s splash + event (leave the balance hook intact but unused for now).
- In `attemptSteal()`, swap the foul branch for:
  - Roll 1: 33% — defender calls `stealer.triggerFall()`... wait — who's the "victim"? **Victim is the ball-handler.** The defender (stealer) shoves the ball-handler.
  - `ballHandler.triggerFall()`
  - `ball.release()` with velocity pointing AWAY from the stealer (`direction = (ballHandler.position - stealer.position).normalize() * impulse`)
  - Record the knockdown against the victim's team (`matchEngine.recordKnockdown(victimTeam)`)
- Roll 2 (67%): just miss. Ball stays where it is, no turnover.
- `'FOUL!'` splash → `'KNOCKDOWN!'` splash when a knockdown happens.
- Update the existing `foul` event listener to keep the powerup-meter charge (or leave the balance hook untouched — it's fine either way).

### Phase 3 — Per-team knockdown counter
- `MatchEngine`: new field `knockdownCount: { home: number; away: number }` and `recordKnockdown(team)` method.
- On hit: `knockdownCount[team]++`. If `===3` emit `team-buff-available: { type: 'invincibility', team }`. If `===5` emit `team-buff-available: { type: 'mutant', team }`.
- HUD badge: show a small counter near the scoreboard for each team (3/5 milestones). Flash when a milestone is reached.

### Phase 4 — Invincibility (at count=3)
- New `PowerupType`: `'invincibility'` (30s duration).
- `PowerupSystem` already supports per-team timed buffs — slot in.
- Activation: when counter hits 3, the team gets a **HUD prompt** (press a key, e.g. `V`, or auto-activate for the human team — TBD, start with auto).
- While active:
  - `calculateShotSuccess` returns 1.0 for that team (always score).
  - Dunk success: force 100%.
  - `attemptSteal` against an invincible ball-handler is a no-op (no knockdown, no ball loss).
- Using it resets `knockdownCount[team] = 0`.
- Splash on activation: `INVINCIBLE!` color `#ffd700`.
- Expiration: 30s timer or when a scoring attempt succeeds — pick one. Plan says 30s.

### Phase 5 — MUTANT (at count=5)
- Only unlocks if team chose to "hold" at 3 instead of burning it. (Simplest rule: counter keeps counting to 5; invincibility is auto-usable any time ≥3; mutant overrides at ≥5.)
- Activation: at 5, the team's designated player (pick the human if human's team, else best scorer) transforms.
- State on the player: `isMutant: boolean`, `mutantTimer: number`.
- `player.animate()` reads `isMutant`:
  - `this.group.scale` animates from 1.0 → 1.6 over 0.5s (with odd proportions: 1.4× width, 1.7× height, 1.4× depth)
  - Color shift: jersey tint toward purple/green
  - Slight emission / glow material
- While mutant:
  - Invincible (inherits Phase 4 rules)
  - Contact with opposing players in a ~1.5u radius → `def.triggerFall()` (knockback aura — but does NOT count as a knockdown against opponent, to avoid infinite escalation)
  - Double points: `match.score()` multiplies by 2 when scorer `isMutant`
- Activation splash: `MUTANT MODE!` color `#ff00ff`, 3× size, slow fade.
- Duration: 30s (same as invincibility).

### Phase 6 — Transformation animation
- When mutant activates:
  - 0.5s freeze pose (player stops, lifts arms)
  - Scale lerps from 1.0 → target over 0.5s
  - Particle burst (reuse splash system or a quick three.js point cloud)
  - Camera zoom-in briefly on the mutating player (optional — nice-to-have, not critical)
- Implement as a new animation state `'mutating'` in the player's anim state machine, 1s duration, then falls into `isMutant=true`-modified baseline animations.

### Phase 7 — Verify
- Tests: update anything asserting team sizes of 5. Probably 3 test files. Add new tests for knockdown counter, invincibility buff, mutant flag.
- Manual smoke: start a 3v3 match, bump into a player → knockdown counter ticks, at 3 see INVINCIBLE prompt/auto, at 5 see MUTANT transformation.
- Puppeteer screenshots of each state for before/after proof.

## Agent team layout

| Phase | Agent | Parallel? | Scope |
|---|---|---|---|
| 1 | inline | — | `main.ts` 2-line swap, verify spawn + formations |
| 2 | 1 sub-agent | — | Foul → miss/knockdown replacement in `attemptSteal` |
| 3 | 1 sub-agent | — | `knockdownCount` field + event plumbing in `match.ts` + HUD counter |
| 4 | 1 sub-agent | — | Invincibility buff in `PowerupSystem` + shot/steal gates |
| 5 | 1 sub-agent | — | Mutant state + rendering + 2x points + knockback aura |
| 6 | 1 sub-agent | — | Transformation animation (new `'mutating'` state) |
| 7 | 2 sub-agents yes | — | vitest + vite build + puppeteer smokescreens |

Phases are mostly sequential because they share `game-session.ts`. Parallelism at verify-only.

## Design questions (flagging, not blocking)
1. **Invincibility activation**: auto when counter hits 3, or player has to press a key to cash in? Plan assumes auto for simplicity. If you want a manual spend, say so.
2. **Does shooting during invincibility ALSO reset the counter, or only the timer expiring**? Plan says: expending invincibility by scoring a successful shot resets. Other interpretations possible.
3. **Mutant + invincibility stack**: if team hits 5 without using invincibility, does mutant replace the current buff? Plan: mutant overrides; counter resets to 0 when mutant expires.
4. **Who transforms into mutant**: the human player on their team, or the "best" player? Plan: human if on that team, else the team's top scorer. Tell me if you want a different pick.

## Out of scope
- Free-throw line / free-throw mechanics (foul → FT). We're removing fouls, not replacing with a different stoppage.
- AI team strategy around invincibility/mutant (when to activate, panic play). They just auto-activate at the thresholds.
- Per-player mutant (only one player per team becomes the mutant; the rest stay normal).
- Mutant model redesign — for now, bigger + odd proportions + color shift, all via existing mesh. Custom monster model is a separate epic.
