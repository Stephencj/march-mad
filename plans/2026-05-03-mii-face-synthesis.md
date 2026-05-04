# Phase H: Mii-style face — approved plan

User decisions:
1. **Style**: semi-photographic — "that's me!" but NOT a Mii ripoff. Stylized output derived from real photo + landmarks, not preconfigured sticker matching.
2. **Decals**: all 6 — vein, crease, anger-X, sweat-drop, blush, pain-stars
3. **Image source**: HYBRID — better way of drawing features from the photo. Not preconfigured best-match. Stylized rendering driven by photo data + landmarks + sampled colors.
4. **Game-state expressions**: approved as drafted (guard→angry, dunk→concentrating→angry→joy, fall→pain→confused→rest, etc.)
5. **Beard/mustache/hat**: include in Mii v1 (was a regression last approach)
6. **Profile views**: 3D nose-bump on cranium + bake side-pose crops

## The "stylized derived feature" approach

Reject both pure-photo-crop AND preconfigured-sticker-match. Instead, at scan-accept time, RENDER each feature to a canvas using a hybrid pipeline:
- **Shape** from landmarks (clean contours, not pixel edges)
- **Color** from sampled feature colors (iris, lip, brow, beard)
- **Texture** from photo regions (clipped inside the landmark-shaped mask)
- **Effects** from per-feature stylization (posterization, edge enhancement, hair-stroke patterns)

Result: a clean, slightly stylized version of the user's actual feature — recognizable but not photo-realistic, distinct from Mii's preconfigured selection model.

Per-feature stylization recipes:
- **Eyes**: landmark-bounded sclera (white) + photo-textured iris with sampled `iris-color` enhancement + dark pupil + stylized eyelash strokes from sampled `eyelashes`. Shape comes from `eyeShape` curves.
- **Brows**: stencil from `browShape` landmarks (5 points per side), filled with sampled brow color, hair-stroke texture pattern overlay using `brows.intensity`
- **Nose**: subtle photo-derived contours from front photo within nose-region mask, highlights/shadows preserved, posterized to 8 colors
- **Mouth**: lip contour from outer-lip landmarks, photo-textured fill within contour, color-enhanced toward sampled `lipColor`, subtle smile-line stroke
- **Beard** (NEW in v1): mask from `beard.regions[]` density per zone (chin, mustache, cheekL/R, etc.), hair-stroke pattern colored by sampled beard color, density variation per region
- **Mustache** (NEW in v1): if `beard.regions.mustache.density > 0.3`, separate plane with stylized mustache strokes
- **Hat** (NEW in v1): if `hat` sampled, render hat shape based on `hat.type` + sampled `hat.color` — wraps around top of head as a separate plane

## Revised phase list (~12-15 days)

**H0 — Reprocess gate** (1-2 hr) ← START HERE
- Run reprocess on new scan `face-2026-05-04T02-25-35.json`. Verify beard/skin/hair/hat/lip/eyelash/brow data populates.
- If samplers fail, fix the regression FIRST. Mii pivot is dead in the water without populated source data.

**H1 — Schema + stylized feature baker** (2-3d) ← THE big creative work
- New `src/dev/face/feature-baker.ts` with per-feature renderer functions that take landmarks + sampled data + photo and produce stylized PNGs
- Schema: `mesh3d.featureImages: { leftEye, rightEye, leftBrow, rightBrow, nose, mouth, beard, mustache, hat }` with `{dataUrl, srcBbox, center3D, size3D}`
- Per-feature rendering pipeline: stencil → photo-clip → colorize → stylize → posterize → output

**H2 — Renderer module** (1-2d)
- `src/dev/face/mii-face-renderer.ts`: 9 textured planes (6 base features + beard/mustache/hat) at landmark-derived 3D positions
- 3 decal slots (forehead, cheekL, cheekR)
- MeshBasicMaterial, alphaTest=0.5, depthWrite=false, render order layered

**H3 — Decal asset library** (0.5d)
- Hand-author 6 PNGs in `public/face-decals/`: vein.png, crease.png, anger-x.png, sweat-drop.png, blush.png, pain-stars.png
- `FaceDecalRegistry` lazy-loaded shared across players

**H4 — Player integration** (1d)
- `setFaceMii(featureImages, headShape, eyeColors)` on `GamePlayer`
- Hook `applyCachedFaceToPlayer` to prefer Mii path when `featureImages` present
- Clean disposal on null

**H5 — Keyframe mixer** (2-3d)
- 7 feature tracks (eye-L/R, brow-L/R, mouth, cheek, decal-overlay)
- Driver priority: idle-blink < game-state < scripted < live-puppet
- BlendshapeSource adapter (keeps procedural-face teeth/tongue working during migration)
- Idle-blink at 3-6s jittered intervals

**H6 — Live puppet → keyframe mapping** (1-2d)
- 24 ARKit blendshapes mapped to track interpolations
- Winner-take-all per track with 0.1 hysteresis

**H7 — Game-state triggers** (1d)
- `face-anim-config.ts` — FACE_ANIM_BY_STATE table per approved decisions
- Hook `GamePlayer.setAnimState` to fire sequences

**H8 — Recorded clip integration + v2 format** (1-2d)
- Old clips replay unchanged through new mixer
- Optional v2 keyframe-only format

**H9 — Profile-view enhancements** (1d)
- 3D nose-bump on cranium (small ellipsoid mounted at nose-tip landmark, sampled skin color)
- Bake side-pose feature crops from `mesh3d.angles[profile-left/right]`
- At runtime, when head yaw > 30°, fade front features out, fade side features in

**H10 — Migration + A/B** (0.5d)
- `window.__faceMode = 'mii' | 'procedural' | 'photo'` toggle
- Dev panel side-by-side

## Critical reused signals

The stylized baker NEEDS these populated on the scan (H0 verifies):
- `mesh3d.skinTone` — base face plate color, decal tinting
- `mesh3d.skinPatches` — per-region skin variation (cheek vs forehead)
- `mesh3d.lipColor` — mouth fill color
- `mesh3d.brows` — color + intensity per side
- `mesh3d.eyeColors` — iris L/R
- `mesh3d.eyeShape` — eye contour curves + opennessRatio
- `mesh3d.eyelashes` — eyelash thickness
- `mesh3d.beard.regions[]` — 9 zones with density
- `mesh3d.hair` — color + style hint
- `mesh3d.hat` — color + type
- `mesh3d.noseShape` — nose contour params
- `mesh3d.browShape` — 5 brow landmarks per side

## Open product calls deferred

- Should beard plane include hair-stroke texture, or solid color with mask? (lean toward solid+subtle-hair)
- Mustache as separate plane vs part of beard mask? (separate — different animation behavior on mouth-open)
- Hat: what variants do we model? (cap, beanie, headband — match what `hair-hat.ts` classifies)
- Side-pose feature crops: bake at scan time, or runtime composite from existing samples?
