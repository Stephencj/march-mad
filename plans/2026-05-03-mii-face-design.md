# Mii-Style Flat-Image Face System — Design

## Section 1 — Feature inventory + image-source strategy

### Feature inventory (in scope for v1)

Eight rest-state feature planes per face:
1. `leftEye` — eye landmarks 33/133/159/145 + iris area
2. `rightEye` — mirror (362/263/386/374)
3. `leftBrow` — landmarks 70,63,105,66,107
4. `rightBrow` — 336,296,334,293,300
5. `nose` — 168 (root) → 1/4/5 (tip) → alae 49/279
6. `mouth` — outer lip ring 61–291 + lower-lip 17
7. `foreheadDecal` — toggleable slot above brow midpoint (vein, anger tic)
8. `cheekDecals` — left+right slot at landmarks 50/280 (crease, blush)

Out of scope for v1: beard / mustache / glasses. Beard already lives in procedural pipeline (`mesh3d.beard` regions); re-targeting duplicates a working system. Glasses deserve their own slot system.

**Note from review:** the new scan is MISSING beard data (sampler never ran). Reprocessing the new scan before v1 ships is critical.

### Image source — bake at scan time, single rest variant per feature

Recommended over multi-variant baking. Reasons:
- Codebase already captures `mesh3d.angles[]` with 5-7 poses for canonical-mesh.
- Puppeting layer animates the rest crop via UV scaling/bending/blendshape-driven decals — real photographic puppeting per pose isn't needed.
- N-variants multiplies storage by ~6 (rest, smile, jaw-open, angry, surprised, blink) per feature. Hard to keep under budget.
- Lighting baked into rest crop is acceptable: front-pose photo is canonical lit reference, Mii style is stylized enough.
- Forehead-vein / cheek-crease come from a SHARED hand-authored asset library at `public/face-decals/`.

At scan time: crop 6 photographic features from front-pose photo using FaceLandmarker landmarks + `sampleRect`. Decal slots stay empty at scan; keyframer fills them at runtime.

## Section 2 — Rendering geometry

**Recommendation: N small textured planes, one per feature.**

Atlas adds complexity (UV remapping, packing) for marginal draw-call win — at 6 features × 6 active players that's 36 quads, trivially batched. Single-composite mask breaks per-feature animation (the whole point of redesign).

### Rig hierarchy

```
neckGroup
  head (ellipsoid, existing cranium)
  face-mesh-3d (existing slot, repurposed)
    └── face-flat-group     [NEW]
          ├── face-feature-leftEye    PlaneGeometry + MeshBasicMaterial
          ├── face-feature-rightEye
          ├── face-feature-leftBrow
          ├── face-feature-rightBrow
          ├── face-feature-nose
          ├── face-feature-mouth
          ├── face-decal-forehead     (visible=false until keyframer)
          ├── face-decal-cheekL
          └── face-decal-cheekR
```

`face-flat-group` mounts in the existing `face-mesh-3d` slot — mutual exclusion logic with flat photo / 3D mesh continues working.

### 3D placement

Per-feature rest position computed once at mount time from `mesh3d.vertices[]`:
```
featureCenter3D = landmarkCentroid3D(rest, FEATURE_INDICES[name])
featureSize     = landmarkExtent3D(rest, FEATURE_INDICES[name])  // (w, h)
```
Centroid offset forward to cranium-front: `z = max(centroid.z, craniumFrontZ) + epsilon`.

### Billboarding & depth offsets

Statically face-forward, no billboard. Depth biases:
- nose: +0.012m
- mouth: +0.006m
- eyes: +0.004m
- brows: +0.005m
- forehead-decal: +0.003m
- cheek-decals: +0.003m

All under 1.5cm — visible parallax on head turn but no sticker-floating-off-head feel.

## Section 3 — Materials / shading

- **`MeshBasicMaterial`** (unshaded). Crops already encode lighting; double-lighting via MeshStandard would muddy. Mii aesthetic is explicitly flat.
- **Transparency**: `transparent=true`, `alphaTest=0.5`, `depthWrite=false`. AlphaTest cutout removes transparent-quad sort artifacts entirely.
- **Render order**: `face-flat-group renderOrder=10`; decals `renderOrder=11`.
- **Skin tinting**: NOT on feature crops (their source IS skin). Cranium ellipsoid behind gets `mesh3d.skinTone` via existing `bodySkinMat`. Decals tinted via `material.color` from sampled skin tone.

## Section 4 — Decal system

Three extra `face-decal-*` planes mounted in `face-flat-group`:
- `face-decal-forehead` at landmark 9 centroid, ~0.5× cranium width
- `face-decal-cheekL` at landmark 50, ~0.4× cheek bbox
- `face-decal-cheekR` at landmark 280

API:
```ts
setFaceDecal(slot: 'forehead'|'cheekL'|'cheekR', assetKey: string|null, opacity: number): void
```

Asset library at `public/face-decals/`, version-controlled, shared across players:
- `vein.png` — forehead vein (gray, multiply-style)
- `anger-cross.png` — anime anger-tic mark (red)
- `crease-cheek.png` — cheek crease (dark gray, soft)
- `blush.png` — pink soft circle
- `sweat-drop.png` — surprise
- `mouth-corner-grimace.png` — for jaw-clench

Small `FaceDecalRegistry` (`src/dev/face/face-decal-registry.ts`) lazy-loads + caches Texture by key. Shared across players.

## Section 5 — Asset format & data schema

NEW `mesh3d.featureImages` field:

```ts
mesh3d?: {
  // ...existing fields...
  featureImages?: {
    leftEye:   FaceFeatureCrop;
    rightEye:  FaceFeatureCrop;
    leftBrow:  FaceFeatureCrop;
    rightBrow: FaceFeatureCrop;
    nose:      FaceFeatureCrop;
    mouth:     FaceFeatureCrop;
  };
};

export interface FaceFeatureCrop {
  dataUrl: string;
  srcBbox: { x: number; y: number; w: number; h: number };
  center3D: { x: number; y: number; z: number };
  size3D: { w: number; h: number };
}
```

### Resolution + budget

| feature | crop px | est PNG bytes |
|---|---|---|
| leftEye, rightEye | 96×64 | ~7 KB each |
| leftBrow, rightBrow | 128×48 | ~7 KB each |
| nose | 96×128 | ~12 KB |
| mouth | 160×96 | ~15 KB |

Total: ~55 KB per face for feature images. ~4.06 MB total scan size — within budget.

128 px is sharp/blurry inflection at typical gameplay distances (head ~80 px on screen). 256 doubles bytes for invisible gain.

### Decal resolution

Hand-authored shared assets, 256×256 PNGs, ~10–20 KB each. Loaded once per session.

## Section 6 — Migration & fallback

Three FaceImage states:
1. **Has `mesh3d.featureImages`** — Mii flat face. New + reprocessed scans.
2. **Has `mesh3d` but no `featureImages`** — old 3D scan. Run bake on first apply (~200ms; cache to IDB). Falls through to (1) on success, (3) on failure.
3. **No `mesh3d`** — flat photo only (AI uploads). Existing flat-photo plane, no Mii. User must rescan.

Reprocess pipeline gains `bakeFeatureImages(mesh3d)` step after Phase 8.5 samplers. UI button "Re-bake feature crops" operates on saved IDB entries.

Procedural-face renderer is NOT removed. Stays as fallback for state (3) and as `window.__faceMode='procedural'` toggle for visual A/B during dev.

## Section 7 — Implementation phases

**P1 — Schema + bake utility** (no rendering)
- Add `FaceFeatureCrop` + `featureImages` to `types.ts`.
- New `src/dev/face/feature-baker.ts`: `bakeFeatureImages(frontImageDataUrl, landmarks) → Record<FeatureName, FaceFeatureCrop>`. Per-feature landmark sets are constants in this module (cribbed from `procedural-face.ts`).
- Unit-test against known landmark blob.

**P2 — Renderer module** (no integration)
- `src/dev/face/mii-face-renderer.ts`: `createMiiFace(featureImages, headShape) → THREE.Group`.
- Standalone preview verification.

**P3 — Decal registry**
- `src/dev/face/face-decal-registry.ts` lazy texture loader.
- Hand-author 4-6 starter PNGs in `public/face-decals/`.
- `setFaceDecal` API on renderer Group.

**P4 — Player integration**
- `setFaceMii(featureImages, headShape, eyeColors, decals?)` on `GamePlayer` mirroring `setFaceMesh3D` lifecycle.
- Hook `applyCachedFaceToPlayer` to prefer Mii path when `featureImages` present.

**P5 — Bake pipeline integration**
- Scan-accept path: call `bakeFeatureImages` before IDB save.
- Reprocess pipeline: add bake step + UI button.

**P6 — Migration validation + budget audit**
- Reprocess all dev-stored faces, measure storage delta.
- Dev-tools panel: rendered Mii face beside procedural face for A/B.
- Ship `window.__faceMode = 'mii' | 'procedural' | 'photo'`.

## Section 8 — Open questions for the user

1. **Decal art style** — anime-tic (red Xs, sweat drops, anger crosses) vs realistic (subtle veins, creases)?
2. **Decal asset count for v1** — minimum: vein + crease + anger-X (3 assets). Others on must-have list?
3. **Scan UX** — silent bake, or expose to user?
4. **Mouth open/closed at scan** — explicit "lips together, neutral" prompt in `scan-voice.ts`?
5. **AI-uploaded faces** — confirm fallback to existing flat-photo render (no Mii).
