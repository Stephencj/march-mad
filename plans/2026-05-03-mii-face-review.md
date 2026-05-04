# Mii-style face pivot — review document

## Section 1 — New scan / anim summary

**Scan** `face-2026-05-04T02-25-35.json` (4.4 MB)
- Front photo: 512×512 PNG. Visible: bearded male, dark backwards baseball cap, full dark beard + mustache, dark eyes, thick dark brows, red shirt at neck.
- 7 angles captured (front + L/R/up/down + profile-L/R), each 512×512 + 478 landmarks.
- `mesh3d.headShape` aspectWH=0.93, aspectDH=0.65 (plausible).
- `mesh3d.eyeColors` left=0x1E1E2A, right=0x171728 (both very dark, plausible).
- `mesh3d.browShape`, `eyeShape`, `noseShape` all present.
- **Missing (THE killer):** `skinTone`, `skinPatches`, `lipColor`, `brows` (color/intensity dict), `beard`, `eyelashes`, `hair`, `hat`. Schema allows these to be empty, but `bundleFaceFeatures` then falls to defaults: skin 0xc9a08a, no beard, no hat, default hair. **That's why the rig renders a clean-shaven cartoon head when the user is a bearded man in a cap.**
- Top-level `bbox` and `faceLandmarks` are also empty — the scanner skipped a FaceLandmarker pass on the cropped front.

**Animation** `face-anim-2026-05-04T02-27-22-764Z.json` (13.3 MB)
- 22.75 fps, 710 frames ≈ 31s. Sparse-keyed.
- 43 distinct ARKit blendshapes touched: brow (innerUp, downL/R, outerUpL/R), eye (blinkL/R, look*, squint, wide), jaw (open, L, R), mouth (smile/frown/dimple/press/pucker/funnel/roll/shrug/upperUp/lowerDown/stretch/L/R/close).
- Synchronized source video included.
- Healthy, well-rounded clip — sufficient ground truth for Mii design validation.

## Section 2 — Current rendering issues, ranked

(All snapshots in `scripts/_snapshot-output/review-newface/`.)

1. **No beard, no mustache, no hat, no hair.** The biggest "doesn't look like me" failure. Root cause: `mesh3d.beard/hair/hat/mustache` empty in the scan; samplers never ran.
2. **Wrong skin tone.** Default 0xc9a08a is too light for the user's actual olive-warm complexion.
3. **Lips are a flat dusky-red blob in the wrong shape.** Lip ribbon sits low; with no mustache to occlude it, floats alone.
4. **Brows too thin / wrong color.** Default brow intensity is thin; user has very thick brows.
5. **Eyes oversized/cartoonish.** opennessRatio≈0.04 is extreme; result doesn't read as user's narrower eye opening.
6. **Profile views are featureless.** No mouth/brow/eye visible from side. Procedural features are front-facing flat strips with no side-view fallback. (Mii flat-image approach side-steps this same problem differently.)
7. **Blendshapes work but on the wrong face.** Smile/jawOpen/blink visibly deflect — puppet pipeline is healthy. Blink doesn't fully close eyes.
8. **No teeth at jawOpen.** Phase E teeth gating issue.
9. **Head silhouette OK** (G1 cranium changes look correct).

## Section 3 — Reusable assets

- **Scan capture pipeline** (`scan.ts`, `capture.ts`) — 7-angle 512×512 + landmarks remains correct input.
- **All sampler modules** (`skin-tone.ts`, `lip-color.ts`, `brow.ts`, `iris-color.ts`, `eye-shape.ts`, `nose-shape.ts`, `beard.ts`, `eyelash.ts`, `hair-hat.ts`, `head-shape.ts`) — Mii path STILL needs these signals (skin tint for cranium, brow color for sticker tinting, beard mask for decal). KEEP all.
- **`reprocess.ts`** — runs samplers over existing scan's stored angles. The new scan needs reprocessing BEFORE the Mii pivot can validate against real beard/skin/hair data.
- **Blendshape puppet + face-anim store + clip schema** — completely untouched by pivot. 13MB anim replays as-is.
- **`mesh-builder.ts` canonical-mesh-as-anchor concept** — still useful for positioning flat planes in 3D.
- **`FaceImage` schema** — covers Mii needs without break (skinTone, brows{}, lipColor, beard{}, hair{}, hat{}). Add optional `featureImages` field.
- **Snapshot harness** — works for new approach.
- **The 7-angle photos** — reusable as raw pixel sources for cropping Mii stickers.

## Section 4 — Discard list

- `procedural-face.ts` 3D mesh builder for eyelids/brows/nose/lips/lashes (the bulk of the file).
- Module-local landmark-anchor constants (`LID_Z_OFFSET_FRAC`, `BROW_THICKNESS`, etc).
- Per-frame canonical-mesh deformation update loop.
- ProceduralFace `update()` / `setBlendshapeSource()` interface — replaced by Mii equivalent.

KEEP for fallback during migration:
- The procedural-face module behind a `__faceMode='procedural'` flag for AB testing during dev.
- `bundleFaceFeatures` shape (the "only forward present fields" pattern) — restructured for Mii.

## Section 5 — Migration risks

- **Side-view face features lost.** Mii flat plates have no profile silhouette. Currently profile views are already empty (rank #6 above) so we may not be losing much, but design must call this explicitly. Options: accept flat profile (Mii does), keep a minimal 3D nose-bump on cranium, or bake side-pose feature stickers.
- **Per-frame blendshape deformation of feature shape** is a real loss — current rig actually pulls lip vertices outward via canonical-mesh deformation. Mii alternatives: image-swap by threshold (Wii-style), UV-warp single image, or pre-baked variant images cross-faded by coefficient. All three are fidelity losses vs current.
- **Eye gaze direction.** Current rig tracks gaze via `eyeLookIn/Out/Up/Down`. A flat eye sticker can't track gaze without runtime offsetting.
- **Beard density per region** (9 regions). A flat beard image is one mask × one density — chinstrap vs full beard look identical.
- **Library of existing scans** — old saves rendered via procedural; pivot needs fallback OR re-bake all scans.
- **Existing 13MB anim's blendshape coverage** — 43 distinct shapes. Mii system that drops shapes silently looks more wooden. Keyframe layer must enumerate ARKit→keyframe coverage.

## Section 6 — Open design questions (passed to design agents)

1. **Composition model**: bake one composite image per scan, or composite layers at runtime?
2. **Render target**: in-scene 3D plane, or DOM/CSS overlay?
3. **Blendshape expression model**: pre-baked variants cross-faded, UV warping, or threshold image-swap?
4. **Image source**: photo crops (uncanny-valley risk) vs hand-drawn sticker pack (loses uniqueness) vs hybrid (sampled colors + categorical sticker selection)?
5. **`mesh3d.angles[]` use**: front-only, or use side photos for side stickers visible at >30° head turn?
6. **Migration**: rip-and-replace or `__faceMode` flag?
7. **Schema**: new `mesh3d.featureImages` sub-object, or runtime compute every load?
8. **Performance budget**: ~5-8 textured quads per face (replaces ~770 verts, 5 draw calls).
9. **Beard/mustache layer order vs lips**.
10. **Backwards cap**: stays as procedural mesh on cranium, or folds into Mii sticker stack?
