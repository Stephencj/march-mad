# March Madness 3v3 — Implementation Plan (Part 2: Chunks 5-7)

> Continuation of `2026-03-16-march-madness-3v3.md`. Tasks 18-30.

**Spec:** `docs/superpowers/specs/2026-03-16-march-madness-3v3-design.md`

---

## Chunk 5: Escalation Systems (Tasks 18-20)

See spec sections: Tiered Powerups, Crowd Intensity System, Sub-In Escalation.

### Task 18: Powerup System

**Files:**
- Create: `src/systems/powerups.ts`
- Test: `tests/systems/powerups.test.ts`

- [ ] **Step 1: Write powerup system tests** — Test tier selection by deficit (1-4 = tier 1, 5-9 = tier 2, 10+ = tier 3), meter charging, orb spawning, one-active-at-a-time rule, duration expiry
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/systems/powerups.test.ts`
- [ ] **Step 3: Implement powerup system** — PowerupSystem class with: selectPowerup(deficit), chargeMeter(amount), update(deficit, dt), pickupOrb(team), activateForTeam(), getActiveForTeam(), tick(dt). Uses POWERUP_TIERS from types. Durations: speed-burst=5s, hot-hand=10s, sticky-fingers=8s, on-fire=15s, phantom-step=1use, brick-wall=8s, giant-ball=12s, trampoline=10s, force-field=10s. Passive meter charge of 2/sec, foul charge of +15.
- [ ] **Step 4: Run tests** — `npx vitest run tests/systems/powerups.test.ts` — All 7 tests PASS
- [ ] **Step 5: Commit** — `git add src/systems/powerups.ts tests/systems/powerups.test.ts && git commit -m "feat: add tiered powerup system"`

---

### Task 19: Crowd Intensity System

**Files:**
- Create: `src/systems/crowd.ts`
- Test: `tests/systems/crowd.test.ts`

- [ ] **Step 1: Write crowd system tests** — Test starts at CALM, escalates through 5 levels on events (dunk=+15, block=+12, steal=+8, score=+5, powerup=+10, sub-in=+20), decays at ~1.33/sec, score differential keeps baseline elevated, momentum modifier returns 0-0.1
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/systems/crowd.test.ts`
- [ ] **Step 3: Implement crowd system** — CrowdSystem class. Thresholds: [0,20,40,65,85]. Decay toward baseline (diff>=10: baseline 40, diff>=5: baseline 20, else 0). Exports: level, levelIndex, onEvent(), updateScoreDiff(), tick(dt), getMomentumModifier(), getScreenShakeIntensity(), getCrowdAnimSpeed()
- [ ] **Step 4: Run tests** — `npx vitest run tests/systems/crowd.test.ts` — All 6 tests PASS
- [ ] **Step 5: Commit** — `git add src/systems/crowd.ts tests/systems/crowd.test.ts && git commit -m "feat: add crowd intensity system"`

---

### Task 20: Sub-In System

**Files:**
- Create: `src/systems/sub-in.ts`
- Test: `tests/systems/sub-in.test.ts`

- [ ] **Step 1: Write sub-in system tests** — Test: null when no bet, null when bet team winning, 4 stages (3-5=subtle, 6-9=pulsing, 10-14=urgent, 15+=last-stand), entry powerup tier scales with deficit, findReplacementTarget picks lowest performer (points+assists-turnovers), disables after executeSubIn()
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/systems/sub-in.test.ts`
- [ ] **Step 3: Implement sub-in system** — SubInSystem class. activateBet(teamId), deactivate(), executeSubIn(), getStage(deficit), getEntryPowerupTier(deficit), getEntranceDuration(deficit), static findReplacementTarget(performers)
- [ ] **Step 4: Run tests** — `npx vitest run tests/systems/sub-in.test.ts` — All 9 tests PASS
- [ ] **Step 5: Commit** — `git add src/systems/sub-in.ts tests/systems/sub-in.test.ts && git commit -m "feat: add sub-in escalation system"`

---

## Chunk 6: Meta Game (Tasks 21-25)

### Task 21: Team Data Generation

**Files:**
- Create: `src/data/teams.ts`
- Test: `tests/data/teams.test.ts`

- [ ] **Step 1: Write team generation tests** — Test: generates 64 teams, each has required fields, all names unique, includes marquee teams, seeds 1-16 distributed 4x each (one per region)
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/data/teams.test.ts`
- [ ] **Step 3: Implement team generation** — generateTeams() using name prefix/suffix pools, mascot pool, color palettes, archetype assignment. ARCHETYPE_STATS maps each archetype to base PlayerStats. ~10 MARQUEE_TEAMS hand-crafted. Seed bonus: top seeds get +0-2 stat points. Each team gets 3 generated players.
- [ ] **Step 4: Run tests** — All 5 tests PASS
- [ ] **Step 5: Commit** — `git add src/data/teams.ts tests/data/teams.test.ts && git commit -m "feat: add procedural team generation"`

---

### Task 22: Draft Pool & Draft System

**Files:**
- Create: `src/data/player-pool.ts`
- Create: `src/meta/draft.ts`
- Test: `tests/meta/draft.test.ts`

- [ ] **Step 1: Write draft tests** — Test: generates pool of 12, players have stats+personality, pick exactly 2, reroll generates fresh pool (max 2 rerolls), season tier produces higher stats
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/meta/draft.test.ts`
- [ ] **Step 3: Implement player pool** — generateDraftPool(tier, count=12). Stat ranges: casual 3-7, sweet16 4-8, season 5-9. Random name from first/last name pools. Random personality trait.
- [ ] **Step 4: Implement draft system** — DraftSystem class. Constructor takes tier, generates initial pool. pick(playerId) returns bool (max 2), reroll() returns bool (max 2 rerolls), isComplete getter, rerollsLeft getter.
- [ ] **Step 5: Run tests** — All 5 tests PASS
- [ ] **Step 6: Commit** — `git add src/data/player-pool.ts src/meta/draft.ts tests/meta/draft.test.ts && git commit -m "feat: add draft system"`

---

### Task 23: Tournament Bracket

**Files:**
- Create: `src/meta/tournament.ts`
- Test: `tests/meta/tournament.test.ts`

- [ ] **Step 1: Write tournament tests** — Test: 8-team bracket (4 matches, 3 rounds), 16-team (8 matches, 4 rounds), 64-team (32 matches, 6 rounds), advance winner, complete tournament has champion, seed matchups (1v16, 2v15)
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/meta/tournament.test.ts`
- [ ] **Step 3: Implement tournament** — Tournament class. Constructor takes tier + teams. buildBracket() sorts by seed, pairs 1v16. reportResult(matchId, winnerId) advances to next round. getNextMatch(), getMatchesForRound(), isComplete, champion getter.
- [ ] **Step 4: Run tests** — All 6 tests PASS
- [ ] **Step 5: Commit** — `git add src/meta/tournament.ts tests/meta/tournament.test.ts && git commit -m "feat: add tournament bracket"`

---

### Task 24: Betting System

**Files:**
- Create: `src/meta/betting.ts`
- Test: `tests/meta/betting.test.ts`

- [ ] **Step 1: Write betting tests** — Test: odds based on seed diff, 50% max bet enforced, coins deducted on placement, payout on win, loss on loss (coins+rep), 2x clutch bonus when subbed in, cash-out formula
- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/meta/betting.test.ts`
- [ ] **Step 3: Implement betting** — BettingSystem class. calculateOdds(seedA, seedB), placeBet(teamId, coins, rep), resolveBet(winnerId, odds, subbedIn), getCashOutAmount(odds, timeRemaining, totalTime), cashOut(). Cash-out formula: coins * odds * (timeRemaining/totalTime) * 0.5
- [ ] **Step 4: Run tests** — All 7 tests PASS
- [ ] **Step 5: Commit** — `git add src/meta/betting.ts tests/meta/betting.test.ts && git commit -m "feat: add betting system"`

---

### Task 25: Progression & Save

**Files:**
- Create: `src/meta/progression.ts`
- Create: `src/meta/save.ts`
- Test: `tests/meta/progression.test.ts`
- Test: `tests/meta/save.test.ts`

- [ ] **Step 1: Write progression tests** — Test: XP calculation (win=50, points*5, assists*3, sub-in bonus=30), level thresholds [0,100,300,600,1000...], stat points per level (+2)
- [ ] **Step 2: Write save tests** — Test: save/load player data via localStorage mock, null when no save, save/load tournament state
- [ ] **Step 3: Run tests to verify they fail** — `npx vitest run tests/meta/progression.test.ts tests/meta/save.test.ts`
- [ ] **Step 4: Implement progression** — ProgressionSystem class. Static calculateXP(result). addXP(amount) with level-up. XP_THRESHOLDS array, STAT_POINTS_PER_LEVEL = 2.
- [ ] **Step 5: Implement save** — SaveSystem class using localStorage. Keys: march-mad-player, march-mad-tournament, march-mad-settings. Methods: savePlayerData, loadPlayerData, saveTournamentState, loadTournamentState, clearTournament, clearAll.
- [ ] **Step 6: Run tests** — All 7 tests PASS
- [ ] **Step 7: Commit** — `git add src/meta/progression.ts src/meta/save.ts tests/meta/progression.test.ts tests/meta/save.test.ts && git commit -m "feat: add progression and save systems"`

---

## Chunk 7: UI Layer & Final Integration (Tasks 26-30)

### Task 26: Signature Moves Data

**Files:**
- Create: `src/data/signature-moves.ts`
- Test: `tests/data/signature-moves.test.ts`

- [ ] **Step 1: Write signature move tests** — at least 5 moves, each has name/cooldown/effect, retrieval by name works
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement** — SIGNATURE_MOVES array with: Ankle Breaker (cd:20), Fadeaway (cd:15), Chase Down (cd:25), No-Look Pass (cd:12, unlock:3), Posterizer (cd:30, unlock:5), Lock Up (cd:20, unlock:4), Heat Check (cd:25, unlock:6), Floor General (cd:18, unlock:7). getSignatureMove(name) lookup function.
- [ ] **Step 4: Run tests** — All 3 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: add signature move definitions"`

---

### Task 27: HUD Component

**Files:**
- Create: `src/ui/hud.ts`
- Test: `tests/ui/hud.test.ts`

- [ ] **Step 1: Write HUD tests** — renders score (e.g. "12" and "8"), renders clock in M:SS format, shows active powerup with timer, shows crowd level, shows sub-in prompt at stages
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement HUD** — HUD class taking a container element. Methods: updateScore(home, away), updateClock(seconds), showPowerup(type, remaining), hidePowerup(), updateCrowdLevel(level), showSubInPrompt(stage), hideSubInPrompt(), destroy(). Use DOM element creation methods (createElement, textContent, appendChild) for safe HTML construction — avoid raw string HTML to prevent XSS patterns.
- [ ] **Step 4: Run tests** — All 5 PASS
- [ ] **Step 5: Commit** — `git commit -m "feat: add in-game HUD"`

---

### Task 28: Menu Screens

**Files:**
- Create: `src/ui/menus.ts`

- [ ] **Step 1: Implement menus** — MenuUI class. show(screen) renders main menu, tournament select, or settings. Uses DOM construction (createElement). Main menu has PLAY + Settings buttons. Tournament select shows 3 tier cards (Casual/Sweet 16/Season) with team counts and session estimates. Settings has SFX/Music volume sliders. onAction callback for button clicks.
- [ ] **Step 2: Verify build** — `npx vite build` — exit 0
- [ ] **Step 3: Commit** — `git commit -m "feat: add menu UI screens"`

---

### Task 29: Bracket View, Betting UI, Player Creator & Draft UI

**Files:**
- Create: `src/ui/bracket-view.ts`
- Create: `src/ui/betting-ui.ts`
- Create: `src/ui/player-creator.ts`
- Create: `src/ui/draft-ui.ts`

- [ ] **Step 1: Implement bracket view** — BracketViewUI. render(matches, currentRound) displays bracket tree by round with team seeds/names. Active matches highlighted. onMatchClick callback.
- [ ] **Step 2: Implement betting UI** — BettingUI. showMatchup(teamA, teamB, odds, maxCoins, maxRep) displays matchup card with bet sliders and team buttons. showCashOut(amount) for mid-game cash-out. onBet and onCashOut callbacks.
- [ ] **Step 3: Implement player creator** — PlayerCreatorUI. show(availablePoints) renders name input, jersey number, 5 stat sliders, signature move picker. onComplete callback returns CreatorResult.
- [ ] **Step 4: Implement draft UI** — DraftUI. render(pool, picks, rerollsLeft) displays player cards with stats/personality, pick tracking, reroll button. onPick and onReroll callbacks.
- [ ] **Step 5: Verify build** — `npx vite build` — exit 0
- [ ] **Step 6: Commit** — `git commit -m "feat: add UI screens for bracket, betting, player creator, and draft"`

All UI components use safe DOM construction methods (createElement, textContent, appendChild, classList) rather than string-based HTML to prevent XSS patterns.

---

### Task 30: Final Integration & PWA Verification

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Wire all systems into main.ts** — Import and initialize: court, ball, players, camera system, match engine, AI controllers, powerup system, crowd system, sub-in system, tournament, betting, draft, progression, save, and all UI components. State machine onEnter callbacks show/hide appropriate UI. DOM event listeners for touch and keyboard controls. Game loop update() drives match engine, AI, powerups, crowd, camera. Render() drives Three.js.
- [ ] **Step 2: Run full test suite** — `npx vitest run` — All tests pass
- [ ] **Step 3: Verify build** — `npx vite build` — exit 0
- [ ] **Step 4: Verify PWA manifest** — Check dist/ output includes manifest.json with correct fields
- [ ] **Step 5: Commit** — `git commit -m "feat: wire all game systems into main entry point"`

---
