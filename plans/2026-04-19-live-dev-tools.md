# Editor pages as real dev tools (not live F1)

## Corrected goal
The F1 in-game overlay is NOT the primary tuning surface. The three editor pages ARE. F1 stays as "settings for next match" (not tried to be live). What needs real-time preview is the dedicated editor pages — with **looping, moving** previews, not static ones.

User workflow: open an editor, tune for minutes, see changes on a continuously-moving model, then go play the game only when tuning is satisfying.

## Current state per editor

| Editor | Rebuild on slider? | Preview | Gap |
|---|---|---|---|
| `player-editor.html` | Yes — `rebuildPlayer()` every input event | Static idle pose | No motion — can't tune body against animations |
| `anim-viewer.html` | Yes — animConfig read every frame | Looping animation on default body | No body-dimension tuning while watching anim |
| `level-editor.html` | Yes — `disposeCourt` + rebuild | Empty court | No humans on the court — can't gauge scale |

F1 overlay: works as-is for "settings I want applied next match." Leave it alone for this round.

## 3-phase editor overhaul

### Phase 1 — `player-editor` gets looping animations
Add the same animation machinery anim-viewer uses to player-editor. Work to do:
1. Import `animConfig` + the animation dropdown list into player-editor
2. Add an animation selector (same dropdown style as anim-viewer: Idle / Walk / Dribble / Guard / Steal / Shoot / Jump / Sprint / ... / Dunk / Pass)
3. Drive `player.animate(dt)` from the existing RAF loop so the player visibly loops through the selected animation
4. When a body slider is dragged → `rebuildPlayer()` as today, BUT restore the current animState so the loop doesn't reset to idle
5. Speed slider (borrow from anim-viewer) so the user can slow the animation to study the silhouette

Result: you tune `torsoWidth` while watching the player dribble-sprint, and immediately see if the body proportions look wrong while moving.

### Phase 2 — `anim-viewer` gets body-dimension controls
Already has full anim tuning. Add a second tuning panel (collapsible) for player body:
1. Lift the PLAYER BODY subsections (HEAD / BODY / LIMBS / SHOES / HAIR) from `player-editor.ts`
2. On body slider change → rebuild the looping player's mesh, preserving animState so the animation keeps going on the new body
3. Color pickers for shoes + headband

Result: you tune a dunk animation and can ask "does this look right on a huge center vs a small point guard?" in one page.

### Phase 3 — `level-editor` gets preview players
Currently a static court. Add 2-3 preview players performing a simple loop on the court:
1. Spawn 3 players at realistic positions (e.g. one under the hoop, one at the 3-point line, one at center)
2. Put them through a simple activity loop: one shoots → one dribbles → one runs to paint. Or simpler: all three do `dribble-walk` in a slow 4-second choreo.
3. When court dimensions change → the players stay where they are (world coordinates), so if the court shrinks, you see players going off-bounds — useful feedback
4. A button to "reshuffle player positions" so you can test the court at different spreads

Result: you tune `paint width` while watching a player dribble in/out of the paint, and can tell if the shape feels right.

## Polish (across all three)
- Consistent "Back to Game" link styling
- Shared animation speed slider (already in anim-viewer; add to player-editor)
- Consistent default animation = idle
- When any slider is dragged, existing RAF loop keeps rendering so the change is visible without the user having to re-click

## Out of scope
- F1 overlay live-apply to running game (dropped — editor pages are the tuning surface)
- Cross-domain editing from within editors (e.g., tuning animation parameters from player-editor) — user can open the other editor in a new tab if needed
- Animation sequencing/choreography tools (the level-editor preview is a simple fixed loop, not a full choreo editor)
- Saving named preset configs — import/export JSON already covers this

## Agent team layout
| Phase | Agent | Parallel? | Scope |
|---|---|---|---|
| 1 | 1 sub-agent | yes with Phase 2 | player-editor animation loop |
| 2 | 1 sub-agent | yes with Phase 1 | anim-viewer body panel |
| 3 | 1 sub-agent | — | level-editor preview players |
| Verify | 2 sub-agents | yes | vitest + vite build |

Phases 1 & 2 touch different files (player-editor.ts vs anim-viewer.ts), so they run in parallel. Phase 3 is its own file.

## Risk notes
- Three.js: the player rebuild in player-editor already has a memory leak (no geometry.dispose) — fix it when adding the animation loop so bodies can be rebuilt many times in a session without bloating RAM
- Level-editor preview players: the players need to be spawned via `new GamePlayer(...)` which requires PlayerData — mock minimal data with random stats. Don't pull the whole tournament/team apparatus.
- Don't let the level-editor's player preview disposal logic collide with the existing `disposeCourt` walker — players should be a separate group from the court group
