# Game Flow Rewrite — Design Spec

## Overview

Complete rewrite of the basketball game's AI, game flow, and possession logic. The current system is a patchwork of hold timers, V-cut phases, hoop swapping, and formation math that don't work together. This replaces it with a simple phase-driven system where each team ALWAYS attacks the same basket and AI behavior is driven by "am I on offense or defense?" every frame.

## Core Principle: Fixed Team Direction

Each team ALWAYS attacks the same basket for the entire game. No swapping.

- **Home team**: attacks hoopAway (z=+13), defends hoopHome (z=-13)
- **Away team**: attacks hoopHome (z=-13), defends hoopAway (z=+13)

These are set ONCE in the constructor and NEVER change.

## Game Phases

### 1. LIVE PLAY (main gameplay)

The default phase. Ball is in play. Shot clock ticking.

**Offense (team with ball):**
- Ball handler: advance toward attacking hoop, read defense, shoot/pass/drive
- Off-ball: go to offensive spots near the attacking hoop (spread formation)
- No hold timers — just compute target position and move there every frame

**Defense (team without ball):**
- Each defender matched to an opponent (man-to-man by index)
- Position between assignment and the basket they're defending
- Ball defender pressures the handler
- Off-ball defenders sag toward paint for help defense

**Loose ball:**
- Everyone chases the ball

### 2. DEAD BALL (after score, out of bounds)

Triggered by: made shot, ball out of bounds.

1. Brief pause (1.5 seconds) — players jog to reset positions
2. Scoring team retreats to their DEFENSIVE half
3. Non-scoring team's PG gets ball at their baseline
4. Transition to LIVE PLAY

### 3. POST-GAME

Game over — show results screen.

## Offensive Positions (Relative to Attacking Hoop)

Standard basketball offensive set. All positions are on the ATTACKING half of the court, relative to the team's attacking hoop.

```
        [Attacking Basket]
              |  C  |          <- Center: 2 units in front of hoop (paint)
         PF --+-----+-- SF    <- PF/SF: 4 units out, ±3 units wide (elbows)
        /                  \
      SG                    PG  <- Guards: 7 units out, ±5 units wide (wings/top of key)
```

Positions as offsets from attacking hoop (z offset = toward center court, x = lateral):

| Position | X Offset | Z Offset (toward center) |
|----------|----------|--------------------------|
| PG | +5 (or ball handler, top of key) | +8 |
| SG | -5 (left wing) | +6 |
| SF | +4 (right wing) | +5 |
| PF | -2 (left elbow) | +3 |
| C  | 0 (paint) | +2 |

For home team attacking z=+13: PG target = (5, 0, 13-8) = (5, 0, 5)
For away team attacking z=-13: PG target = (5, 0, -13+8) = (5, 0, -5)

Note: Z offset is SUBTRACTED from hoop Z for the team attacking positive Z, ADDED for the team attacking negative Z. Simpler: positions are always between the hoop and center court.

## Defensive Positions

Each defender positions between their man and the basket they're defending:

```
defenderTarget = 0.65 * assignmentPosition + 0.35 * defendingHoopPosition
```

This puts them 65% toward their man, 35% toward their hoop — standard help-side positioning.

Ball defender is closer to their man (0.8 / 0.2 split) and mirrors lateral movement.

## After Score Flow

1. `handleMadeShot()` called → score recorded
2. Phase set to `'dead-ball'`
3. All players get target positions:
   - Scoring team: defensive half positions (near THEIR basket they defend)
   - Receiving team: PG goes to their baseline to inbound, others go to offensive half
4. Players jog/sprint to these positions (1.5 second timer)
5. After timer: PG gets ball, phase returns to `'live-play'`
6. Shot clock resets to 24

## AI Decision Logic (replaces runAIDecisions)

No hold timers. No movement states. No V-cut system. Just:

```
for each AI player:
  if ball is loose:
    target = ball position

  else if my team has ball (offense):
    if I have ball:
      if far from hoop (>8): drive toward hoop
      else: AI decides (shoot/pass/drive based on stats)
    else:
      target = my offensive position (from formation table)
      if defender is between me and hoop: cut to get open

  else (defense):
    assignment = my man-to-man match
    if assignment has ball:
      target = between assignment and my defending hoop (close pressure)
    else:
      target = between assignment and my defending hoop (help side)

  move toward target at normal speed
```

Every frame, compute target. Move toward it. That's it.

## What Gets Removed

- `attackingHoop` / `defendingHoop` swapping in `resetAfterScore`
- `aiMovementState` ('holding' / 'moving' / 'reacting') state machine
- `aiHoldTimer` on players
- V-cut logic (40% cut to hoop, 30% cut to wing, 30% hold)
- `moveToFormation()` with the broken direction math
- `cachedPlays` and play refresh system
- `TeamAI.choosePlay()` integration in game-session

## What Stays

- Player rendering, skeleton, animations
- Ball physics, shot detection, shot accuracy
- Controls (WASD, Space, E, Q, F, G, Shift)
- Camera system (broadcast style)
- Match engine (scoring, clock, shot clock)
- Powerup system
- Post-game screen
- Human player switching on pass / defense

## New Properties on GameSession

```typescript
// Fixed per-team hoops (NEVER swap)
private homeAttackHoop: THREE.Vector3;  // = hoopAway (z=+13)
private homeDefendHoop: THREE.Vector3;  // = hoopHome (z=-13)
private awayAttackHoop: THREE.Vector3;  // = hoopHome (z=-13)
private awayDefendHoop: THREE.Vector3;  // = hoopAway (z=+13)

// Dead ball timer
private deadBallTimer = 0;
private deadBallReceivingTeam: 'home' | 'away' | null = null;
```

## Offensive Position Calculation

```typescript
getOffensivePosition(player: GamePlayer, teamAttackHoop: THREE.Vector3): THREE.Vector3 {
  const team = this.isHomePlayer(player) ? this.homePlayers : this.awayPlayers;
  const idx = team.indexOf(player);

  // Offset table: [x, zFromHoop] for each position index
  const offsets = [
    [5, 8],   // PG: top of key
    [-5, 6],  // SG: left wing
    [4, 5],   // SF: right wing
    [-2, 3],  // PF: left elbow
    [0, 2],   // C: paint
  ];

  const [xOff, zOff] = offsets[idx] ?? [0, 5];

  // Z direction: move TOWARD center court from the hoop
  const zDir = teamAttackHoop.z > 0 ? -1 : 1;

  return new THREE.Vector3(
    xOff,
    0,
    teamAttackHoop.z + zOff * zDir
  );
}
```

## Defensive Position Calculation

```typescript
getDefensivePosition(player: GamePlayer, assignment: GamePlayer, teamDefendHoop: THREE.Vector3): THREE.Vector3 {
  const isBallHandler = assignment.hasBall;
  const blend = isBallHandler ? 0.8 : 0.65;

  return new THREE.Vector3(
    assignment.position.x * blend + teamDefendHoop.x * (1 - blend),
    0,
    assignment.position.z * blend + teamDefendHoop.z * (1 - blend)
  );
}
```
