# Possession Authority + Camera Zoom + Auto-Switch — Design Spec

## Overview

Three independent fixes: (1) centralize possession logic to eliminate desync bugs where teams drive toward the wrong basket, (2) fix camera dynamic zoom so it actually zooms in/out based on player clustering, (3) auto-switch human control to the teammate who grabs a rebound.

## 1. Possession Authority System

### Problem

`matchEngine.state.possession` is written in 7+ scattered locations. Several paths change possession without updating the ball holder, or change the ball holder without updating possession. This causes the AI to think one team has the ball when the other actually does, sending players toward the wrong basket.

### Known Desync Bugs

| Bug | Location | What Happens |
|-----|----------|-------------|
| `callFoul()` | match.ts:111 | Flips possession but never updates ball holder |
| Shot clock violation | match.ts:95 | Flips possession in match.ts, then event fires to game-session — two separate writes to possession (match.ts flips it, then `enterDeadBall` calls `checkBallComplete` which sets it again). Architecturally fragile: if either write changes, desync occurs. |
| Loose ball desync | game-session.ts:339-348 | Desync sanity check only runs inside `runAI()`, which is skipped during loose ball chase phase |
| Pass interception | game-session.ts:1022-1042 | Any player within 1.0 unit picks up ball regardless of `pendingPassTarget` — no priority for intended receiver |

### Fix

**Single authoritative function:** `changePossession(newTeam, reason)` in `game-session.ts`. Every possession change goes through this. It:
- Sets `matchEngine.state.possession`
- Resets shot clock
- Resets `aiShootTimer`
- Logs the change with reason for debugging: `console.log([POSSESSION] ${oldTeam} → ${newTeam} (${reason})`

**All direct writes to `matchEngine.state.possession` are removed.** Replace with calls to `changePossession()`. This includes:
- `start()`
- `checkBallPickup()`
- `attemptSteal()`
- `enterDeadBall()` (via `matchEngine.checkBallComplete`)
- `callFoul()` handler
- Shot clock violation handler
- Ball out of bounds handler

**Desync check moves to top of `update()`** so it runs every frame — not just during `runAI()`. If `ball.heldBy` exists and its team doesn't match possession, force-correct it immediately.

**`callFoul()` fix:** After `matchEngine.callFoul()` flips possession, game-session must call `enterDeadBall(receivingTeam)` to properly handle the foul — inbound sequence, player positioning, the works. Just handing the ball over without entering dead ball would leave players in awkward positions.

**Shot clock violation fix:** The handler in game-session.ts (the event listener) should call `enterDeadBall()` which already handles everything. But `match.ts:tickClock()` also flips possession directly (line 95) BEFORE the event fires. Fix: remove the possession flip from `match.ts:tickClock()`. Only emit the event with `violatingTeam`. Let `game-session.ts` handle the possession change via `enterDeadBall()`.

**Pass ownership window:** During a pass (`pendingPassTarget` is set), for the first 0.3s of flight, only same-team players can pick up the ball. After 0.3s, anyone can. Add a `passProtectionTimer` field. In `checkBallPickup()`, if `passProtectionTimer > 0`, skip opponents. This prevents random interceptions while still allowing contested passes after a brief window.

**`checkBallPickup()` iteration fix:** Currently iterates `getAllPlayers()` which returns `[...homePlayers, ...awayPlayers]`, giving home players priority. Fix: find the CLOSEST player to the ball instead of the first one within range. Also use `switchHumanControl()` in the pass gesture handler (lines 592-597) instead of duplicating the same logic manually.

**Dead code cleanup:** `updateDefensiveAutoSwitch()` (line 963) is defined but never called. Remove it — the new auto-switch in `checkBallPickup()` replaces its intent.

## 2. Camera Dynamic Zoom

### Problem

The broadcast camera's zoom calculation divides player spread by large maximums (28 for Z-spread, 15 for X-spread). The X-spread is hardcoded to `(-7, 7)` = 14 in main.ts, so `playerSpreadX / 15 = 0.93` — always near max. Since `Math.max` is used, this pins the spreadFactor to ~0.93 regardless of actual player clustering, keeping the camera stuck at near-maximum distance (~17-18). The zoom never changes because the X axis dominates and is always nearly 1.0.

### Fix

In `main.ts` where `setPlayerBounds` is called (line 292):
- Track actual min/max X from player positions instead of hardcoding `-7, 7`

In `camera.ts` broadcast mode (line 82):
- Change divisors from `28, 15` to `20, 12` (realistic max spreads for full court 5v5)
- Change zoom range from `10-18` to `8-16` (allows closer zoom)
- Drop minimum spreadFactor clamp from `0.2` to `0.05` (allows tight zoom when clustered)
- Keep LERP_SPEED at 4.0 (smooth transitions already work)

**Result:** When all players are near one basket (fast break, inbound), camera zooms in close (~8-9 distance). When spread across full court, camera pulls back (~16). The change is gradual and smooth thanks to existing lerp.

## 3. Auto-Switch on Rebound/Pickup

### Problem

When a teammate grabs a rebound or loose ball, the human player stays controlling their previous character — who no longer has the ball. The user has to steal from their own teammate, which flips possession (since the steal logic treats it as a turnover).

### Fix

In `checkBallPickup()`, after a player on the human's team picks up a loose ball:
- If that player is NOT the current human-controlled player
- And the pickup is NOT from a pending pass (passes already handle switching in the gesture handler)
- Then auto-switch human control to the player who picked up the ball

This uses the existing `switchHumanControl()` method. Only triggers for loose ball pickups (rebounds, fumbles), not passes.

## Files to Modify

- `src/game/game-session.ts` — All three fixes (possession authority, auto-switch, pass protection timer)
- `src/game/match.ts` — Remove direct possession flip from `tickClock()` shot clock violation
- `src/game/camera.ts` — Zoom range and spread factor calculation
- `src/main.ts` — Track actual X-bounds for player spread
- `tests/game/possession-sync.test.ts` — Expand with new test cases
