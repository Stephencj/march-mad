# March Madness 3v3 Arcade Basketball — Game Design Spec

## Overview

A March Madness inspired arcade-style 3v3 basketball game built as a Progressive Web App. Players create a custom character, draft teammates, and compete in bracket-style tournaments. Between their own games, they spectate AI vs AI matchups and place bets. If a bet goes south, they can sub in and try to turn the tide. The game features tiered powerups for the losing team, an escalating crowd intensity system, and dynamic camera work — all designed to create increasingly dramatic moments as games progress.

**Platform:** Web (PWA) — playable on iPhone, Android, desktop via browser. Installable to home screen.

**Visual Style:** Low-poly 3D — clean geometric aesthetic, stylized characters. Modern but lightweight. Think Crossy Road meets basketball.

**Target:** 60fps on mid-range mobile phones.

## Architecture

Three-layer architecture:

### Game Engine Layer
- **Three.js Renderer** — Low-poly 3D court, players, ball, crowd meshes
- **Rapier Physics** (@dimforge/rapier3d) — Ball physics, collisions, player body movement
- **Camera System** — Four dynamic modes that auto-switch based on game context
- **Animation System** — Player animations, powerup effects, crowd reactions

### Game Logic Layer
- **Match Engine** — Score, shot clock, possessions, fouls, game flow
- **AI Controller** — Team-level strategy and individual player behaviors with personality traits
- **Powerup System** — Tiered powerup spawning based on score deficit
- **Crowd System** — Intensity meter scaling visual/audio/gameplay effects

### Meta Game Layer
- **Tournament Manager** — Three bracket sizes (8/16/64) with seeding and progression
- **Betting System** — Dual currency (coins + reputation) wagering with dynamic odds
- **Draft System** — Player pool generation and selection before each tournament
- **Progression** — XP, leveling, unlocks, custom player upgrades

### Platform Layer
- **PWA Shell** — Installable, offline-capable via service worker
- **Touch Controls** — Virtual joystick + gesture hybrid
- **Local Storage** — Save state via localStorage/IndexedDB
- **Responsive UI** — Adapts to phone, tablet, desktop

## Core Gameplay

### Match Structure
- Half-court 3v3, single hoop
- Possession changes on scores and turnovers
- Ball must be "checked" (taken behind the arc) after each score
- No free throws — fouls give possession + powerup charge
- Win condition: first to 21 or highest score at 3-minute buzzer

### Scoring
| Shot Type | Points |
|-----------|--------|
| Inside the arc | 1 |
| Behind the arc | 2 |
| Dunk / Alley-oop | 2 + crowd boost |
| Powerup dunk (trampoline/mega slam) | 3 |

**Powerup scoring rules:** The "On Fire" multiplier applies to base shot values only (1 or 2), not to powerup bonus points. So an On Fire three-pointer = 4 points (2×2), an On Fire layup = 2 points (2×1). Powerup dunks always score exactly 3 regardless of On Fire status. The game can exceed 21 on the winning shot — if you're at 20 and score a 2-pointer, you win with 22. No cap.

### Controls (Hybrid Touch)

**On Offense:**
- Left thumb: Virtual joystick for movement
- Swipe up: Shoot (swipe length = power, release point = timing)
- Swipe toward teammate: Pass
- Double-tap: Call for screen/pick
- Swipe down (near basket): Dunk attempt

**On Defense:**
- Left thumb: Virtual joystick for movement
- Tap ball handler: Attempt steal
- Swipe up (near basket): Block attempt
- Hold position: Auto-guard (AI assists positioning)
- Double-tap teammate: Switch to control that player

### Dynamic Camera System

| Mode | Trigger | Feel |
|------|---------|------|
| **Offense Cam** | Player's team has possession | Behind-the-back, tight, immersive |
| **Defense Cam** | Opponent has possession | Wider angle, shows full half-court |
| **Slam Cam** | Dunk or big play | Cinematic close-up, 2-3 seconds |
| **Spectator Cam** | Watching/betting on AI game | Courtside broadcast view |
| **Sub-In Cam** | Player subbing into a game | Cinematic tracking shot following player from bench to court, intensity matches deficit level. Transitions to Offense or Defense Cam once player is on court. |

### Play vs Watch Flow
- **Your bracket games:** You play as your custom player. AI controls your 2 drafted teammates. Win to advance.
- **Other bracket games:** Watch AI vs AI from courtside. Place bets (coins + reputation). If your bet is going badly, the sub-in option appears with escalating urgency. Sub in as your custom player on the team you bet on.

## Escalation Systems

### Tiered Powerups
Powerups only spawn for the losing team. Deficit size determines the tier.

**Tier 1 — Down 1-4 points (Grounded Boosts):**
- Speed Burst — 5 second sprint boost
- Hot Hand — Increased shot accuracy for 10 seconds
- Sticky Fingers — Can't be stripped for 8 seconds

**Tier 2 — Down 5-9 points (Exaggerated Powers):**
- On Fire — All shots count double for 15 seconds
- Phantom Step — Phase through defenders once
- Brick Wall — Immovable screens, defenders bounce off

**Tier 3 — Down 10+ points (Full Chaos):**
- Giant Ball — Huge ball, impossible to miss dunks
- Trampoline — Launch pad under basket, mega dunks worth 3 points
- Force Field — Shield around the hoop, blocks opponent shots for 10 seconds

**Spawn Mechanic:** Powerups appear as glowing orbs on the court. Losing team's players run through to pick up. Only one active powerup at a time. Fouls charge a powerup meter that accelerates the next spawn.

### Crowd Intensity System
Five-level meter: CALM → ENGAGED → HYPED → ROWDY → CHAOS

**Intensity decay:** Crowd intensity gradually decays during uneventful possessions and check-ball pauses (roughly one level per 15 seconds of no action). This ensures the meter is dynamic rather than monotonically increasing — games can swing between calm and chaotic multiple times.

**Drives intensity up:**
- Score differential increasing (blowout)
- Consecutive scores by same team (run)
- Dunks, blocks, steals (highlight plays)
- Powerup activations
- Player subbing in
- Late-game close score

**Effects at high intensity:**
- Visual: Crowd animations speed up, signs wave, camera shake increases
- Audio: Chanting, stomping, air horns at high levels
- Gameplay: Slight momentum boost for the underdog
- Screen FX: Screen shake on dunks scales with intensity
- Announcer: Gets progressively more unhinged

### Sub-In Escalation
**Sub-in requires an active bet.** You can only sub in on games you've bet on — you have skin in the game. Games you spectate without betting are watch-only (still useful for scouting upcoming opponents).

When spectating a game you bet on, the sub-in prompt escalates with the deficit of the team you bet on:

| Deficit | Stage | Behavior |
|---------|-------|----------|
| Down 3-5 | Subtle Prompt | Small "Sub In?" button in corner, easy to ignore |
| Down 6-9 | Pulsing Alert | Button pulses and grows, crowd looks at you on the bench |
| Down 10-14 | Urgent Call | Screen borders glow, announcer calls out, camera cuts to your player |
| Down 15+ | Last Stand | Full dramatic mode, slow-mo, spotlight on bench, "Are you just gonna sit there?!" |

**Sub-In Entrance:** Matches the urgency level. Small deficit = casual jog onto court. Large deficit = slow-mo hero walk, dramatic music swell, crowd erupts. The worse the situation, the bigger the powerup you start with upon entering.

**Player replacement:** When subbing in, you replace the lowest-performing player on the team you bet on (determined by a simple performance score: points + assists - turnovers during the current game). A brief "tagging out" animation plays as they high-five on the sideline.

## Tournament & Bracket System

### Three Tournament Tiers

| Mode | Teams | Rounds | Session Length | Stakes |
|------|-------|--------|---------------|--------|
| Casual | 8 | 3 | ~15-20 min | Low coin bets, no reputation |
| Sweet 16 | 16 | 4 | ~30-40 min | Medium coins + reputation |
| Season | 64 | 6 | Multi-session | High everything, seeding matters |

### Pre-Tournament Flow
1. Pick tournament tier
2. Draft phase — pool of ~12 players, draft 2 to join your custom player
3. Team is seeded into bracket (reputation-based in Season, random in Casual)
4. View full bracket with all teams' mascots, playstyles, and seed rankings

### Between Games
- View updated bracket
- Watch/bet on other matchups in your bracket region
- Spend currency on cosmetics or one-time stat boosts for next game
- See upcoming opponent scouting report

**One-time stat boosts:** Purchasable with coins between games. Each boost adds +10% to one stat (Speed, Shooting, Defense, Passing, or Dunk Power) for your entire team for the next game only. Max one boost per game. Cost scales with tournament round (more expensive in later rounds). These are "edge" purchases — meaningful but not game-breaking.

### Season Mode Persistence
- Progress saves locally (localStorage/IndexedDB)
- Custom player earns XP and levels up between tournaments
- Reputation carries across runs — higher rep = better seeding = harder path but bigger rewards

## Team Identity & Draft System

### 64 Pre-Made Teams
Each team has a unique college name, mascot, color scheme, and playstyle archetype:

| Archetype | Description |
|-----------|-------------|
| Run & Gun | Fast breaks, quick shots, weak defense |
| Fortress | Elite defense, slow offense, physical |
| Sharpshooters | Three-point focused, spacing, low rebound |
| Inside Beasts | Dominant dunks/layups, tall players, slow outside |
| Balanced | No major weakness or strength |
| Chaos | Unpredictable AI, mix of risky plays, high variance |

Teams have seed rankings (1-16) reflecting overall power level. Higher seeds have better base stats but aren't unbeatable — powerups and player skill close the gap.

**Team generation:** Teams are procedurally assembled from component pools (name fragments + mascot pool + color palette pool + archetype assignment) with hand-tuned stat distributions per archetype. This avoids manually authoring 64 unique teams while still producing distinct-feeling opponents. A curated seed of ~10-15 "marquee" teams can be hand-crafted for bracket flavor (rivalry names, memorable mascots).

### Custom Player
- Created at first launch: appearance (body type, hair, skin tone, jersey number)
- Stat allocation: Speed, Shooting, Defense, Passing, Dunk Power
- Signature move on cooldown (e.g., ankle-breaker crossover, fadeaway jumper, chase-down block)
- Serves as avatar everywhere: playing, betting courtside, subbing in
- Earns XP from playing — levels up to unlock more stat points and additional signature moves

### Draft System
- Before each tournament, shown a pool of ~12 randomized players
- Each has visible stats, portrait, and personality trait:
  - **Clutch** — Performs better when score is close
  - **Ball Hog** — High scoring, rarely passes
  - **Lockdown** — Elite defender, modest offense
  - **Spark Plug** — Inconsistent but capable of explosive runs
  - **Team Player** — Good passer, sets screens, sacrifices stats for team play
- Pick 2 to complement your custom player's build
- Draft pool quality scales with tournament tier
- **Draft rerolls:** Spend coins to get a fresh pool of 12 players (max 2 rerolls per tournament). Useful when the initial pool doesn't complement your build.
- **Team persistence:** Your drafted team stays with you for the entire tournament. No redrafting between rounds — choose wisely.

## Betting System

### Dual Currency

| Currency | Earned From | Spent On | Risk |
|----------|------------|----------|------|
| Coins | Playing, winning bets, tournament placement | Cosmetics, stat boosts, draft rerolls | Lost on bad bets |
| Reputation | Winning own games, winning bets, clutch sub-ins | Nothing — it IS progression. Determines seeding, unlocks tiers | Lost on bad bets (Sweet 16 & Season only) |

### Betting Flow
1. Before AI vs AI game: see matchup card with team archetypes, seeds, and odds
2. Pick a team, set coin amount, optionally stake rep (Sweet 16/Season)
3. Dynamic odds — favorites pay less, underdogs pay more
4. Watch from courtside spectator cam
5. Option to cash out early (reduced payout) or ride it out

### Sub-In Bet Twist
- Bet stays active when you sub in
- Win after subbing in: **Clutch Bonus** — 2x multiplier on bet payout
- Lose after subbing in: only lose original bet amount (no extra penalty)
- Creates risk/reward decision: sub in to save the bet, or accept the loss?

### Betting Limits
- Max 50% of coins on a single game
- Rep stakes capped per tournament round (small early, bigger in later rounds)
- New players start with a coin bankroll

## Game State Machine

The game flows through these states with defined transitions:

```
MainMenu
  → PlayerCreation (first launch only)
  → TournamentSelect

TournamentSelect (pick Casual / Sweet 16 / Season)
  → DraftPhase

DraftPhase (view pool, pick 2 players)
  → BracketView

BracketView (see full bracket, upcoming matchups)
  → YourGame (when it's your turn to play)
  → Spectating (watch other bracket games)

YourGame (playing as your custom player)
  → PostGame → BracketView (if tournament continues)
  → PostGame → TournamentEnd (if eliminated or champion)

Spectating (watching AI vs AI)
  → BettingOverlay (place bet before/during game)
  → SubInCinematic (when sub-in triggered)
  → BracketView (game ends)

BettingOverlay (set wager, confirm)
  → Spectating (continue watching)

SubInCinematic (entrance animation)
  → YourGame (now playing on bet team)

PostGame (results, XP, currency summary)
  → BracketView

TournamentEnd (final results, rewards)
  → MainMenu
```

**Data carried between states:** The tournament state (bracket, scores, progression) persists across all states within a tournament run. Currency and reputation persist globally via save system. Custom player stats persist globally.

## Tech Stack

### Dependencies
- **Three.js** — 3D rendering
- **Rapier** (@dimforge/rapier3d) — Physics
- **TypeScript** — Type safety
- **Vite** — Dev server and bundling
- **vite-plugin-pwa** — PWA service worker and install support

### No Backend
Everything client-side. Persistence via localStorage/IndexedDB.

### Project Structure
```
march-mad/
├── src/
│   ├── main.ts                  # Entry point, scene setup
│   ├── game/
│   │   ├── court.ts             # Court mesh, hoop, boundary lines
│   │   ├── ball.ts              # Ball entity, physics, shooting arc
│   │   ├── player.ts            # Player entity, stats, animations
│   │   ├── match.ts             # Match engine — score, clock, possessions
│   │   ├── controls.ts          # Touch input — joystick + gestures
│   │   └── camera.ts            # Dynamic camera system
│   ├── ai/
│   │   ├── team-ai.ts           # Team-level strategy
│   │   ├── player-ai.ts         # Individual player behaviors + personality
│   │   └── difficulty.ts        # Difficulty scaling per seed/round
│   ├── systems/
│   │   ├── powerups.ts          # Tiered powerup spawning, effects, visuals
│   │   ├── crowd.ts             # Crowd intensity meter, reactions, FX
│   │   └── sub-in.ts            # Sub-in escalation, entrance cinematics
│   ├── meta/
│   │   ├── tournament.ts        # Bracket management (8/16/64)
│   │   ├── betting.ts           # Coin + rep betting, odds, payouts
│   │   ├── draft.ts             # Player pool generation, draft UI
│   │   ├── progression.ts       # XP, leveling, unlocks
│   │   └── save.ts              # localStorage/IndexedDB persistence
│   ├── ui/
│   │   ├── hud.ts               # In-game HUD (score, clock, powerups)
│   │   ├── menus.ts             # Main menu, settings, team select
│   │   ├── bracket-view.ts      # Tournament bracket visualization
│   │   ├── betting-ui.ts        # Bet placement, odds display, cashout
│   │   └── player-creator.ts    # Custom player builder UI
│   ├── assets/
│   │   ├── models/              # Low-poly .glb files
│   │   ├── textures/            # Team colors, court textures
│   │   └── audio/               # Crowd sounds, whistle, music, announcer
│   └── data/
│       ├── teams.ts             # 64 pre-made team definitions
│       └── player-pool.ts       # Draftable player stat templates
├── public/
│   ├── manifest.json            # PWA manifest
│   └── icons/                   # App icons
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### Key Technical Decisions
- **Game loop:** requestAnimationFrame with fixed timestep for physics, variable for rendering
- **Asset loading:** Preload low-poly .glb models at startup, lazy-load audio
- **State management:** Event-driven architecture — typed events between game systems, no framework overhead
- **UI approach:** HTML/CSS overlays for menus, bracket, betting. Canvas-only for in-game HUD during gameplay
- **Mobile optimization:** LOD for crowd (nearest rows 3D, far rows flat sprites). Target 60fps on mid-range phones
- **Desktop controls:** Keyboard (WASD movement, Space shoot, E pass, Q steal/block) + mouse (click to target passes/steals). Auto-detected based on input device — no manual toggle needed.
- **Offline:** Fully offline-capable since there's no backend. Service worker precaches the app shell, 3D models, and textures. Audio files are cached on first play.
- **Fouls:** Triggered by failed steal attempts (30% chance a steal attempt is called a foul) and excessive body contact during drives. No foul limit — repeat fouling just feeds the losing team's powerup meter faster regardless of who committed the foul, making it a self-punishing strategy for the winning team and a slight consolation for the losing team. If the losing team fouls, it still charges their own powerup meter (they're already losing, the crowd sympathizes).
- **Cash-out formula:** Early cash-out pays (current odds × time remaining / total game time × 0.5) — so cashing out at halftime with your team ahead pays ~25% of the full potential payout. The later you cash out while ahead, the more you keep.
