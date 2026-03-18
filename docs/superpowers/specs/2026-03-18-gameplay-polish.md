# Gameplay Polish — Design Spec

## Overview

Eight fixes to make the game play correctly: immediate attack after possession, proper inbound from baseline, zone defense, more aggressive AI shooting, visible HUD, points display fix, backwards walk animation, and dunk range with contest mechanics.

## 1. Immediate Attack After Getting Ball

When a team gains possession (steal, rebound, inbound), the ball handler should IMMEDIATELY sprint toward their attacking hoop. No waiting.

- Remove the `aiShootTimer < 0.5` delay for MOVEMENT (keep it for shooting decisions only)
- Remove the `distToHoop > 6` threshold — ball handler ALWAYS drives toward attacking hoop
- The 0.5s timer only prevents shooting, not movement
- Ball handler sprints (`isSprinting = true`) until they're in shooting range

## 2. Proper Inbound After Score

After a score:
1. Receiving team's CENTER (last player, index 4) stands JUST OUTSIDE the baseline (1.5 units past the court)
2. They hold the ball for 0.5 seconds (brief inbound pause)
3. They auto-pass to the PG (index 0) who is on court near the baseline
4. PG receives and immediately drives up court
5. Other players move to their positions during live play — no teleporting
6. The game phase stays 'playing' during this — just the inbounder is out of bounds briefly

Implementation: In `enterDeadBall`, position the inbounder outside baseline, give them the ball, set a 0.5s `inboundTimer`. In `update()`, when `inboundTimer > 0`, tick it down. When it hits 0, auto-pass to PG and the inbounder runs onto the court.

## 3. Zone Defense (Replace Man-to-Man)

Remove `getDefensiveAssignment()` index-based matching. Replace with zone-based positioning:

Each defender holds a ZONE near their defending hoop:

| Index | Zone | Base Position (offset from defending hoop) |
|-------|------|-------------------------------------------|
| 0 (PG) | Top of key | (0, zDir*7) |
| 1 (SG) | Left wing | (-4, zDir*5) |
| 2 (SF) | Right wing | (4, zDir*5) |
| 3 (PF) | Left block | (-2, zDir*3) |
| 4 (C) | Paint | (0, zDir*2) |

Each defender drifts 30% toward the current ball position for help defense. This creates natural ball-side rotation without glitchy man-to-man tracking.

## 4. AI Shoots More Aggressively

In `handleBallHandlerAI`, change shot probabilities:

| Situation | Current | New |
|-----------|---------|-----|
| Close range (<3), open | 100% | 100% (dunk/layup) |
| Mid-range (<7), open | 30% | 70% |
| Three-point (<10), open | 0% (doesn't exist) | 50% |
| Contested (<2 defender) | 0% (always pass) | 20% |
| Wait timer before deciding | 0.5s | 0.3s |

Also: when no teammate is open for a pass, the AI should take a contested shot rather than dribbling back out.

## 5. HUD Visibility

Add complete inline styles to the score, clock, and shot clock elements in `hud.ts`:

- Score: centered top, 32px bold white, text shadow
- Clock: centered below score, 20px white
- Shot clock: top-right, 24px bold, turns red under 5 seconds
- All elements: `position: absolute`, `zIndex: 10`, `fontFamily: sans-serif`

## 6. Points Display Fix

In `getGameOverData()`:
- `humanStats.points` should use the MATCH SCORE for the human's team, not `performanceScore`
- `performanceScore` can be negative (points + assists - turnovers). The match score is always >= 0.
- Change: `humanStats.points` = `homeScore` or `awayScore` depending on which team the human is on
- Clamp `xpEarned` to minimum 0

## 7. Backwards Walking Animation

In `player.ts` `animate()`, detect when the player is moving AWAY from where they're facing:

```
const facingDir = new Vector3(0, 0, 1).applyQuaternion(group.quaternion);
const moveDir = velocity.clone().normalize();
const dot = facingDir.dot(moveDir);
if (dot < -0.3) → backwards walk animation
```

The backwards walk:
- Slower stride (reduce frequency by 40%)
- Shorter steps (reduce amplitude by 50%)
- No forward lean (bodyPivot.rotation.x = 0)
- Arms in defensive ready position (slightly raised and out)

This naturally happens when a defender faces the ball handler but moves laterally/backwards.

## 8. Dunk Range Expansion + Contest

**Range:** Dunk can be attempted from up to 8 units from the hoop (was 4.5). Success rate varies by distance:

- 0-3 units: 90% success
- 3-5 units: 70% success
- 5-8 units: 40% success
- Modified by player's dunkPower stat (±15%)

**Contest mechanic:** When attempting a dunk, check if any defender is:
1. Between the dunker and the hoop (within the path)
2. Currently in jump-block animation (`isJumping && !hasBall`)

If both conditions are true:
- 60% chance the dunk is BLOCKED
- Blocked: ball becomes loose, dunker plays fall animation (`triggerFall()`), crowd reacts
- Not blocked: dunk goes through (poster dunk, extra crowd hype)

Implementation: In `handleGesture` for 'swipe-down', check dunk success + contest before executing the shot.
