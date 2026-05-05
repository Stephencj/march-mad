# Mii face architecture pivot — UV-cranium recommendation

User feedback "I don't like this too much" + "Not Great.png" = the curved-plate-on-ellipsoid architecture has hit a diminishing-returns wall. Three planning agents (forensic diagnosis + architectural options + tradeoff synthesis) converged unanimously: **the contract is wrong, not the tuning**.

## Forensic root cause (why "Not Great.png" looks wrong)

1. **Plate is half the cranium's width**: `TARGET_SIZE_M.facePlate.w = 0.220m` vs `headWidth ≤ 0.441m`. Plate cannot cover. Period.
2. **Curved plate rim recession is asymmetric in 3/4 view**: at slight yaw, one side of the plate rotates BACK (out of silhouette), the other rotates FORWARD (into silhouette). User's render is at face-mirror's OrbitControls camera (yaw≈0.15, dist≈1.4) — exactly where this artifact maxes out.
3. **Skin tones diverge by source, not by lighting**: cranium uses sampled `mesh3d.skinTone` numeric (clean lit cheek-band). Plate uses raw photo pixels (with shadow + beard + cool WB). Both are MeshBasicMaterial, so this isn't a lighting issue — they're two different inputs.
4. **My snapshot tool has been lying**: snapshot tool shoots at yaw=0, dist=4. User's actual game runs face-mirror's OrbitControls at yaw≈0.15, dist≈1.4. Where I see balanced+symmetric, user sees asymmetric+offset.

## Contract gap

- **Current contract** the code delivers: "We render a generic skin-toned head, then paste a 2D photo plate on the front."
- **User's expected contract**: "My head IS the character's head. Body is generic; head is me."

Every Phase H iteration since H2 has tried to make A look like B via tuning. Each tune fixed one symptom and revealed another. **No amount of tuning collapses two surfaces into one.**

## The decision

**UV-cranium (Agent B's Option 2a)** — apply the face photo as a TEXTURE on the cranium SphereGeometry's built-in UVs, with skin-tone composited around the front-face region in the same canvas. There is NO separate plate. The cranium IS the head; the face is painted onto it.

### Why this is the right call

- **Plate-vs-cranium seam disappears** — there's only ONE surface
- **Skin-tone mismatch disappears** — the photo's skin pixels feather into the same canvas as the cranium's solid skin tone
- **Off-center asymmetry disappears** — one mesh, one center, no float
- **3/4 view fidelity** — the photo curves naturally with the head's geometry
- **Profile gets non-zero feature content** — face-edge pixels visible at the rim
- **Existing H3-H7 work survives**: decals become UV-space overlays on the same texture; keyframe expressions drive sub-region swaps

### Implementation outline (~3-5 hours clean)

1. **New `bakeFaceCraniumTexture(faceCanvas, skinTone, sphereSegments)`** in `feature-baker.ts`:
   - 1024×512 RGBA canvas
   - Fill entirely with `skinTone`
   - Composite the existing baked face plate canvas at the front-UV region (roughly U∈[0.35, 0.65], V∈[0.15, 0.85])
   - Soft alpha-feather edges so photo blends into surrounding skin pixels

2. **Modify `head-mesh-builder.ts` `buildCraniumEllipsoid`**:
   - Replace `MeshBasicMaterial({color: skinTone})` with `MeshBasicMaterial({map: faceCraniumTexture})`
   - Bump segments: `SphereGeometry(0.5, 32, 24)` for smoother UV interpolation

3. **Delete the curved plate code** in `mii-face-renderer.ts`:
   - Remove `facePlate` from `ORDERED_FEATURES`
   - Remove the curved-plane vertex math
   - Renderer's job shrinks to per-feature overlays + decal slots

4. **Add face-mirror camera preset** to `scripts/snapshot-scenes/player.cjs` so future iterations CAN catch the off-center artifact:
   ```js
   'face-mirror-pose': { camera: { yaw: 0.15, pitch: 0.05, dist: 1.4, target: 'head' } }
   ```

### What this loses

- **The "photo as photo" feel** softens — the face deforms with the sphere geometry, becoming more "Mii-like illustration" and less "stuck-on photograph". Per Agent C: this is actually desirable for the cartoon-body aesthetic.
- **Far-back-of-head pixels are skin-toned**, not hair (no hair sampling in scope). Hat covers most of this anyway.

### What this preserves

- Hat (procedural 3D)
- Eyes/brows/mouth keyframe overlays (H4-H7 path stays)
- Decals (forehead, cheekL/R)
- Animation system
- All existing tests (will need updates for plate removal)

## Alternative paths if UV-cranium scope is too big right now

Per Agent C's framework:

- **"Ship it, accept the ceiling"** → freeze fillhead-iter-2 as v1, mark contract gap as known v2. ~0 hours, but Mii face stays imperfect.
- **"Front-only fidelity"** → keep curved plate, hard-match plate skin to cranium via WB sampling. ~1 day, but 3/4 + profile stay broken.
- **"All angles right"** → UV-cranium. ~3-5 days. THIS IS THE ANSWER.
- **"Many character variations later"** → UV-cranium + body-skin sampling. ~+1 day. Better long-term.

## Critical files

- `src/dev/face/head-mesh-builder.ts` — cranium material wiring (this is where the new map texture mounts)
- `src/dev/face/feature-baker.ts` — `bakeFacePlate` becomes input to a new `bakeFaceCraniumTexture`
- `src/dev/face/mii-face-renderer.ts` — `facePlate` plane code gets DELETED
- `src/dev/face/types.ts` — schema may gain `faceCraniumTexture` field (or `facePlate.dataUrl` gets repurposed as the per-face composite texture canvas)
- `scripts/snapshot-scenes/player.cjs` — add face-mirror-pose preset so this class of bug surfaces in CI

## Recommended next step

If user approves: dispatch ONE focused implementation agent for UV-cranium. Expected time: 3-5 hours of agent work, with snapshot verification at each milestone.
