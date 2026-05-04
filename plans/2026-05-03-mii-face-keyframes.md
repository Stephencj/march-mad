# Mii-style face keyframe animation layer — Design

## Section 1 — Keyframe inventory (per feature track)

```
Track: eye-L
  rest, blink-half, blink-full, squint, wide, look-up, look-down, look-in, look-out
Track: eye-R   (mirror)
Track: brow-L
  rest, up, down, furrowed, raised-outer
Track: brow-R   (mirror)
Track: mouth
  rest, smile-small, smile-big, frown, open-small, open-wide, pucker,
  gritted-teeth, tongue-out, sneer-left, sneer-right, asymmetric-smirk
Track: cheek
  rest, puffed, squinted-L, squinted-R
Track: decal-overlay
  none, vein-forehead, sweat-drop, blush, anger-mark, pain-stars, lip-bite
```

Composite recipes (`face-anim-config.ts`):
- `angry` = squint + furrowed brow + gritted-teeth + vein-forehead
- `surprised` = wide eyes + brow-up + open-small mouth
- `joy` = blink-half eyes + raised-outer brow + smile-big + cheek-squinted
- `pain` = blink-full + furrowed brow + gritted-teeth + pain-stars
- `confused` = brow-L:up + brow-R:down + asymmetric smile
- `concentrating` = squint + brow-down + rest mouth
- `wink-left` = eye-L:blink-full + eye-R:rest + smile-small
- `squished` = squint + pucker

## Section 2 — Track / layering system

Two layers: **track state** + **driver stack**.

```ts
// src/dev/face/face-keyframe-anim.ts
export type FeatureTrack =
  | 'eye-L' | 'eye-R'
  | 'brow-L' | 'brow-R'
  | 'mouth' | 'cheek'
  | 'decal-overlay';

export type DriverPriority =
  | 'idle-blink'    // 0 — random blinks under resting face
  | 'game-state'    // 1 — face-anim-config from anim state
  | 'scripted'      // 2 — explicit playFaceAnim() from gameplay code
  | 'live-puppet';  // 3 — MediaPipe input

export interface FaceKeyframeMixer extends BlendshapeSource {
  setTrack(track: FeatureTrack, kf: KeyframeName, opts: {
    priority: DriverPriority;
    durationMs?: number;
    easing?: 'linear' | 'easeOut' | 'easeInOut';
  }): void;
  setComposite(name: KeyframeName, opts: {priority: DriverPriority; durationMs?: number}): void;
  releaseDriver(priority: DriverPriority, track?: FeatureTrack): void;
  tick(dtMs: number): ReadonlyMap<FeatureTrack, TrackState>;
}
```

**BlendshapeSource adapter:** `getSmoothedValue(name)` is implemented by mapping internal track-blend state back into ARKit-name scalars (e.g. mouth track at `to:'open-wide', t:0.6` → `jawOpen=0.6`). Keeps `ProceduralFace`'s teeth/tongue gating working with zero changes during migration.

## Section 3 — Tweening rules

- **Default easing: `easeOut`** (cubic). Faces pop INTO expressions and SETTLE.
- **Per-track default durations:**
  - eye-L/R: 80ms (blinks must snap)
  - brow-L/R: 180ms
  - mouth: 220ms small motions, 350ms big (smile-big, gritted-teeth)
  - cheek: 220ms
  - decal-overlay: fade-in 200ms, fade-out 400ms (asymmetric)
- **Crossfade-only** within a track. New `setTrack` reseeds `from` to current rendered blend.
- **Live-puppet skips easing** — `FacePuppet` already EMAs at α=0.45. Live driver uses `durationMs:0`; the live coefficient itself drives `t` continuously.

## Section 4 — Live puppet → keyframe mapping

| Track | Source blendshape(s) | Maps to | t = |
|---|---|---|---|
| eye-L | `eyeBlinkLeft` | `rest → blink-full` | value |
| eye-L | `eyeSquintLeft` | `rest → squint` | value (loses to blink) |
| eye-L | `eyeWideLeft` | `rest → wide` | value |
| eye-L | `eyeLookUpLeft − eyeLookDownLeft` | `look-down ↔ rest ↔ look-up` | signed |
| eye-L | `eyeLookInLeft − eyeLookOutLeft` | `look-out ↔ rest ↔ look-in` | signed |
| eye-R | (mirror) | | |
| brow-L | `browInnerUp` | `rest → up` | value |
| brow-L | `browDownLeft` | `rest → down` | value |
| brow-L | `browDownLeft + browDownRight` ≥ 0.4 | promote to `furrowed` | sum/2 |
| brow-L | `browOuterUpLeft` | `rest → raised-outer` | value |
| brow-R | (mirror) | | |
| mouth | `mouthSmileLeft + mouthSmileRight` | `rest → smile-big` (small if sum<0.5) | (sumL+sumR)/2 |
| mouth | `mouthFrownLeft + mouthFrownRight` | `rest → frown` | (sumL+sumR)/2 |
| mouth | `jawOpen` | `rest → open-wide` (small if <0.4) | value |
| mouth | `mouthPucker` | `rest → pucker` | value |
| mouth | `mouthPressLeft + mouthPressRight` ≥ 0.5 | `rest → gritted-teeth` | (sumL+sumR)/2 |
| mouth | abs(`mouthSmileLeft − mouthSmileRight`) ≥ 0.3 | `rest → asymmetric-smirk` | abs diff |
| cheek | `cheekPuff` | `rest → puffed` | value |
| cheek | `cheekSquintLeft` | `rest → squinted-L` | value |
| cheek | `cheekSquintRight` | `rest → squinted-R` | value |

**Winner-take-all per track** with hysteresis (must beat by 0.1 to flip).

## Section 5 — Game-state triggers

```ts
// src/dev/face/face-anim-config.ts
export const FACE_ANIM_BY_STATE: Record<string, FaceAnimSequence> = {
  idle:        { steps: [{ t: 0, composite: 'rest' }] },
  walk:        { steps: [{ t: 0, composite: 'rest' }] },
  walkBackward:{ steps: [{ t: 0, composite: 'concentrating' }] },
  dribble:        { steps: [{ t: 0, composite: 'concentrating' }] },
  dribbleStationary: { steps: [{ t: 0, composite: 'concentrating' }] },
  sprint:      { steps: [{ t: 0, composite: 'concentrating' }] },
  dribbleSprint:{ steps: [{ t: 0, composite: 'concentrating' }] },
  guard:       { steps: [{ t: 0, composite: 'angry' }] },
  steal:       { steps: [{ t: 0, composite: 'concentrating' }, { t: 0.4, composite: 'joy' }] },
  shoot:       { steps: [{ t: 0, composite: 'concentrating' }, { t: 0.35, composite: 'rest' }] },
  jump:        { steps: [{ t: 0, composite: 'surprised' }] },
  jumpBlock:   { steps: [{ t: 0, composite: 'angry' }] },
  fall:        { steps: [{ t: 0, composite: 'pain' }, { t: 0.6, composite: 'confused' }], hold: 'rest' },
  dunk:        { steps: [
                   { t: 0, composite: 'concentrating' },
                   { t: 0.45, composite: 'angry' },
                   { t: 0.85, composite: 'joy' },
                 ], hold: 'rest' },
  pass:        { steps: [{ t: 0, composite: 'concentrating' }, { t: 0.2, composite: 'rest' }] },
};
```

`GamePlayer.animate()` on state-change calls `mixer.releaseDriver('game-state')` then schedules the sequence runner. Live puppet attachment fires `mixer.setComposite(...)` at priority `'live-puppet'`, automatically winning.

**Idle-blink driver** runs always at lowest priority: every 3-6s (jittered), fire blink-full then 60ms later set to rest. Both eyes synchronized.

## Section 6 — Decal triggers

Derived from composite name:
```
angry → vein-forehead
pain → pain-stars
joy → sweat-drop
surprised → sweat-drop
all others → none
```

Asymmetric fade: 200ms in, 400ms out. Vein/stars appear quick, linger as they leave.

## Section 7 — Recorded clip integration

Existing `FaceAnimClip` (frames of sparse blendshapes) unchanged. Replay path:
1. Existing replay feeds frames to `FacePuppet.apply()`.
2. `FacePuppet.getSmoothedValue` becomes input to mixer's live-puppet driver.
3. **Existing clips replay unchanged**, now drive Mii keyframes instead of canonical mesh.

New compact v2 format (opt-in):
```ts
export interface FaceKeyframeClip {
  __version: 2;
  name: string;
  capturedAt: string;
  tracks: Partial<Record<FeatureTrack, ReadonlyArray<{
    t: number; kf: KeyframeName; durationMs?: number; easing?: TrackState['easing'];
  }>>>;
  totalDurationSec: number;
}
```

60s clip ≈ 1.7 KB vs 270 KB v1 — two orders of magnitude smaller. Migration via "convert v1→v2" button in Face Mirror.

## Section 8 — Performance

- 4 players × 7 tracks × ~10 keyframes × 256² RGBA = 4.5 MB/face → 18 MB total. Fine.
- Per-face: 7 tracks × 14 textured-quad draws @ 4 faces × 60fps = 3360 draws/s. Below WebGL norms.
- Live-puppet: ~24 `getSmoothedValue` reads + comparisons per frame. Negligible.

Caching: when face selected for player, `loadFaceTextures(face)` prefetches all keyframes. LRU eviction at 6 faces.

## Section 9 — Implementation phases

**K1 — Mixer skeleton + idle blinks** (1-2d). Mixer + idle-blink driver + BlendshapeSource adapter (mouth track → jawOpen). Visible: faces blink with no other input.

**K2 — Live puppet driver** (2d). Section 4 mapping. Replace `setFaceProceduralBlendshapeSource(puppet)` with `setFaceProceduralBlendshapeSource(mixer.attachLivePuppet(puppet))`. Visible: live MediaPipe drives mixer.

**K3 — Game-state driver + face-anim-config** (1-2d). Author table, hook player state-change. Visible: dunks trigger logged sequence.

**K4 — Sibling renderer integration** (depends on Mii renderer phase). Subscribe to `mixer.tick()`. Texture caching from Section 8. Visible: Mii faces play game-state and live-puppet expressions.

**K5 — Decals + recorded keyframe clips** (1-2d). Decal-overlay track + DECAL_BY_COMPOSITE map + asymmetric fade. v2 clip format + IDB store + convert button. Visible: angry shows veins; users save compact recordings.

## Section 10 — Open questions

1. Should `guard` carry angry, or stay neutral?
2. Successful shoot trigger `joy`, or stay concentrating→rest?
3. Should winks be available as discrete game-event triggers (trash-talk button)?
4. Aesthetic: include `confused` (asymmetric brows) or visually noisy?
5. Decal palette off-brand for older-fat-guy aesthetic?
