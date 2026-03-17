# Court Redesign, 5v5 Full Court, Animation Polish — Design Spec

## Overview

Three interconnected upgrades: (1) Stylized cartoon/toy court with full markings and oversized hoops, (2) 5v5 full court as the main game mode with positional basketball, (3) Animation polish using squash-stretch, anticipation, and follow-through.

Quick Play (3v3 half court) stays as-is for instant arcade action. Main Game becomes 5v5 full court with tournament support.

## 1. Court Redesign — Cartoon/Toy Style

### Full Court Dimensions
- Length: 28 meters (current half-court is 14m, so double it)
- Width: 15 meters (unchanged)
- Two hoops: one at each end (z = -13 and z = 13 — centered on each half)
- Center line at z = 0
- Court surface at y = 0

### Court Surface
- Bright hardwood color (0xE8B960)
- Subtle plank lines: thin darker stripes (0xD4A84B) every 0.5m across the width
- All court markings are slightly extruded BoxGeometry (height 0.02m) so they pop off the floor

### Court Markings (white 0xFFFFFF, extruded)
- **Center circle**: radius 1.8m at z=0
- **Half-court line**: full width at z=0
- **Three-point arcs**: at both ends, radius 6.75m from each hoop
- **Paint/lane**: rectangular area 3.6m wide × 5.8m long extending from each baseline toward center
- **Free throw line**: at the far end of each paint area
- **Free throw circle**: radius 1.8m at each free throw line
- **Baseline**: at z = -14 and z = 14
- **Sidelines**: at x = -7.5 and x = 7.5

### Paint Color
- Each team's paint area uses their team's primary color at 30% opacity
- Implemented as a semi-transparent plane on top of the floor

### Center Logo
- Circle at center court with team abbreviation text (or just a colored circle for now)

### Hoops — Oversized Cartoon Style
Each end has:
- **Pole**: Chunky cylinder (radius 0.15, height 3.5), team-colored, with a wide disc base (radius 0.6)
- **Backboard**: 1.5× normal size (2.7m × 1.6m), white semi-transparent, with thick colored border frame (4 BoxGeometry edges, team color, 0.08m thick)
- **Rim**: Oversized torus (radius 0.35 instead of 0.23), thick (tube radius 0.04), bright orange (0xFF4500)
- **Net**: Inverted cone mesh below rim (ConeGeometry, radius 0.35, height 0.45, open ended), white, semi-transparent (opacity 0.4)

### Quick Play Court
- Uses only one half (z = 0 to z = -14), single hoop at z = -13
- Half-court line becomes the boundary
- Camera stays on that half

### Full Court
- Both halves active with hoops at each end
- After score: play transitions to the other end

## 2. Five-on-Five with Positions

### Position Definitions

| Position | Abbrev | Height Scale | Body Scale | Base Stats (SPD/SHT/DEF/PAS/DNK) | Court Zone |
|----------|--------|-------------|------------|-----------------------------------|------------|
| Point Guard | PG | 0.85 | 0.85 | 9/7/5/8/4 | Top of key, brings ball up |
| Shooting Guard | SG | 0.95 | 0.90 | 7/9/5/6/5 | Wings, three-point spots |
| Small Forward | SF | 1.0 | 1.0 | 7/7/7/6/7 | Mid-range, versatile |
| Power Forward | PF | 1.1 | 1.15 | 5/5/8/5/8 | High post, baseline |
| Center | C | 1.2 | 1.3 | 3/3/9/4/9 | Low post, paint area |

### Visual Scaling
Applied to the existing skeleton mesh via scale factors:
- `group.scale.set(bodyScale, heightScale, bodyScale)` on the root group
- Head gets EXTRA scale: `head.scale.set(1.1, 1.1, 1.1)` for bigger players (more bobblehead)
- Shoes scale proportionally (Centers have big shoes)
- This keeps the same skeleton/animation system — no separate meshes needed

### Position Type
Add to `src/core/types.ts`:
```typescript
export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
```

Add `position` field to `PlayerData` interface.

### AI Behavior by Position
- **PG**: Higher pass tendency, surveys longer before acting, prefers top of key
- **SG**: Higher shoot tendency, V-cuts to three-point spots, stays on perimeter
- **SF**: Balanced, cuts to mid-range and paint alternately
- **PF**: Sets screens, posts up on baseline, crashes boards after shots
- **C**: Camps near paint, rarely shoots from outside, blocks shots, calls for ball in post

### Formation Positions (5v5)
New formation sets for 5 players:

```
spread: [
  { x: 0, z: 8 },      // PG: top of key
  { x: -5, z: 5 },     // SG: left wing
  { x: 5, z: 5 },      // SF: right wing
  { x: -3, z: 1 },     // PF: left block
  { x: 3, z: 1 },      // C: right block
]
```

Multiple formation sets for variety (spread, tight, balanced, triangle).

## 3. Game Flow Changes

### Main Menu
- "Quick Play" → 3v3 half court, one game, no tournament
- "Play" → 5v5 full court tournament flow (Casual/Sweet 16/Season)

### 5v5 Game Rules
- Same scoring: 1pt inside arc, 2pt behind arc, 3pt powerup dunk
- 5-minute clock (instead of 3 minutes)
- First to 21 or buzzer
- After score: other team inbounds from their baseline
- Ball must cross half-court within ~8 seconds (simple timer, no backcourt violation — arcade rules)

### Camera for Full Court
- Camera follows ball handler, same offense/defense modes
- On transition (after score): camera smoothly pans to the other end as players run up court
- Wider default angle to show more of the court with 10 players

### Human Control (5v5)
- Human controls ball handler on offense (auto-switches on pass)
- On defense: human controls player nearest to ball handler (or double-tap to switch)
- Green chevron indicator always shows which player human controls

## 4. Animation Polish

### Rotation Direction Reference (VERIFIED)
In the nested skeleton, for joints where children hang below (negative Y):
- **Positive rotation.x** = child swings toward **-Z local** (BACKWARD relative to character who faces +Z)
- **Negative rotation.x** = child swings toward **+Z local** (FORWARD)

Walk cycle: hipL.rotation.x = -stride (negative = forward), shoulderL.rotation.x = +stride (positive = backward = correct opposite-limb swing).

### Squash and Stretch
Apply scale oscillation to the body-pivot group during movement:
- **Ground contact** (bounce phase bottom): `bodyPivot.scale.set(1.08, 0.92, 1.08)` — squash
- **Peak of bounce** (bounce phase top): `bodyPivot.scale.set(0.95, 1.08, 0.95)` — stretch
- Interpolate smoothly between using the existing bouncePhase value

### Anticipation and Follow-through
Add transition blending between animation states:
- When switching from idle → walk: 0.1s anticipation (slight crouch before first step)
- When switching from walk → idle: 0.15s settle (momentum carry, slight forward lean that eases back)
- When shooting: 0.1s deeper crouch before the upward motion
- When jumping: the existing crouch phase serves as anticipation

Implementation: track `prevAnimState` and `stateTransitionTimer`. During transition, blend between the old pose and new pose using `smoothstep(t)`.

### Secondary Motion
- **Head lag**: Head rotation slightly follows body rotation with a 0.05s delay (small lerp toward body-pivot rotation)
- **Hair bounce**: Hair mesh position.y oscillates slightly out of phase with body bounce (delayed by 0.1s)
- **Arm follow-through on stop**: When transitioning to idle, arms continue their swing direction for 0.1s before settling

### Smooth Step Function
```typescript
function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}
```

## 5. Implementation Order

1. Court redesign (new `createFullCourt()` function, keep `createCourt()` for 3v3)
2. Position types and body scaling
3. 5v5 game session variant (extend GameSession or create FullCourtSession)
4. Animation polish (squash-stretch, transitions, secondary motion)
5. Menu updates (Quick Play vs Play)
6. Camera adjustments for full court
