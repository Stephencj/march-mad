# Editor-page / F1 overlay alignment

## Problem
F1 dev overlay and the three dedicated editor pages (anim-viewer, player-editor, level-editor) drifted apart. Each editor is domain-locked and hides the polish/breadth from F1 (and vice versa). User wants parity.

## Findings from parallel-agent audit

| Gap | F1 | Editor page | Delta |
|---|---|---|---|
| Player body fields | 7 (head radius, torso W/H, arm/leg lengths) | 33 (all body + shoes + hair + colors) | F1 hides 26 fields |
| Level fields | 11 (court 5 + hoop 6, no colors/lighting) | 23 (9 court, 6 hoop, 3 colors, 5 lighting) | F1 hides 12 fields + 2 sections |
| Anim slider ranges | `apex*: [0, 5]`, `bounce: [0, 2]`, `scale: [0.5, 2.0]`, `approachSpeed: [0, 20]` | `apex*: [-3, 3]`, `bounce: [-3, 3]`, `scale: [0.3, 2.5]`, `approachSpeed: [1, 20]` | Range semantics diverge |
| Context-awareness | Shows all anims at once | Context-filtered to selected anim | Different mental models |
| Range-picker logic | Regex patterns | Looser `.includes()` | Duplicated + slightly different |
| Reset/Export scope | All 4 configs | Editor's domain only | Editors can't reset sibling domains |
| GLB export | None | player-editor + level-editor have it | Asymmetric |
| Warnings for gameplay-coupled fields | Inline ⚠️ badges | Full styled warning blocks | Visual style drift |

## Three plausible interpretations of your ask

**A) Make F1 a true mirror of the editors** — expand F1's PLAYER + COURT/HOOP sections to match the editors' coverage (add color pickers, missing fields, LIGHTING, COLORS). F1 becomes the canonical "everything in one panel."

**B) Let editors cross-pollinate** — inside anim-viewer, also expose player body + level sliders (so you can tune a dunk animation against a specific-proportioned character on a specific-sized court, all in one view). Each editor becomes a "superset" panel with its own specialty as the primary focus.

**C) Unify range semantics + polish only** — keep each editor domain-locked (the current architecture), but extract a shared range-picker and shared section/warning styling into `src/dev/shared-ranges.ts` so nothing drifts. Fix the specific bugs without adding features.

## Recommended path: **A + C**

Expand F1 to match editors' coverage (A) so that F1 really is a one-stop shop, AND extract the shared range-picker (C) so ranges never drift again. Skip B — cross-pollination adds scope creep and nobody really wants to tune the court from anim-viewer.

### Phase 1 — extract shared range picker
- New file: `src/dev/shared-ranges.ts` with one function `pickSliderRange(path: string[], key: string, value: number): { min, max, step }` that handles every heuristic the current dev-overlay + anim-viewer use.
- Delete the copy in anim-viewer.ts; import from shared instead.
- Delete the copy in dev-overlay.ts; import from shared instead.
- Choose the superset ranges (prefer the wider bounds — e.g. `apex: [-3, 5]` to accommodate both).
- **Verification**: every existing slider's bounds are preserved or widened, never tightened below previous values.

### Phase 2 — expand F1 PLAYER section
Replace the 7-field flat PLAYER BODY block with the same structure player-editor has: 5 collapsible `<details>` subsections (HEAD / BODY / LIMBS / SHOES / HAIR) auto-enumerated from `playerConfig` keys. Add color pickers for `shoes.color`, `hair.headbandColor`. Result: F1 and player-editor show the same 33 fields in the same groups.

### Phase 3 — expand F1 LEVEL sections
Add Center Circle Radius, Check-Ball Line, Line Height, Plank Stripe Spacing to COURT. Add full COLORS (3 fields, color pickers) and LIGHTING (5 fields) sections. Match level-editor's section-level warning boxes for gameplay-coupled fields instead of inline ⚠️.

### Phase 4 — tiny polish
- `<details>` state persisted to sessionStorage so re-opening F1 remembers what you had open
- Shared Reset/Export/Import in each editor: give editor pages the same three-button row F1 has, scoped to all configs (so you can reset everything from within the level-editor without leaving)
- Consistent numeric-input width (70px everywhere — currently 64px in anim-viewer)

### Phase 5 — verification
- `npx vitest run` (expect 400/400)
- `npx vite build` (all 4 entries emit)
- Manual smoke:
  - F1 → PLAYER → HAIR → change afroRadius → start match → character has new afro (confirms parity with player-editor)
  - F1 → LEVEL → LIGHTING → reduce ambient → court darkens in-game
  - F1 → ANIMATION → dunk.apexHeight to 2.5 → dunk visibly higher
  - Same change applied from anim-viewer → matches exactly (shared ranges, shared config)

## Agent team layout

| Phase | Agents | Parallel? | Scope |
|---|---|---|---|
| 1 | 1 sub-agent | — | Extract `shared-ranges.ts`, swap in both consumers, verify tests |
| 2 | 1 sub-agent | — | Rewrite F1 PLAYER section — runs after Phase 1 |
| 3 | 1 sub-agent | — | Rewrite F1 LEVEL sections — runs after Phase 1 (parallel with Phase 2 since different chunks of dev-overlay.ts — but sequential is safer since same file) |
| 4 | 1 sub-agent | — | Polish pass — persistence, shared buttons, width alignment |
| 5 | 2 sub-agents | yes | vitest + vite build |

Total: ~5 sub-agents, mostly surgical. Commits per phase so regressions are bisectable.

## Out of scope
- Option B (cross-pollination into editors) — deferred unless you explicitly want it
- New field types or config tiers
- New editor pages
- Jump-catch (still parked)
