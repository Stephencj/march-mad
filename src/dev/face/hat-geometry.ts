/**
 * Phase D — procedural hat geometry builders.
 *
 * Three hat types, all built from cheap THREE primitives so the GPU cost
 * is identical to a generic hair sub-mesh:
 *
 *   - cap-forward / cap-backward: tapered cylinder crown (cone-like shape
 *     that sits over the upper head) plus a flat half-disc brim on the
 *     front (forward) or back (backward) of the head.
 *   - beanie: a 55%-polar-cap dome covering only the top half of the head.
 *
 * All hats mount on the player's `neckGroup` at the same anchor position
 * the existing hair sub-mesh uses, so swapping in a hat hides the hair
 * cleanly without re-anchoring. The caller (player.ts `setFaceHat`) is
 * responsible for parent-add + dispose lifecycle.
 *
 * Materials are MeshStandardMaterial(roughness 0.7) — same lighting model
 * as the body / hair so the hat picks up the same directional light as
 * the rest of the rig (the procedural face's MeshBasic features are an
 * intentional outlier; the hat is a body-tier accessory).
 *
 * The brim mesh inside cap variants is named `cap-brim` so callers can
 * locate it post-build (e.g. to flip orientation if a future tuning pass
 * differentiates forward vs backward bill angles).
 */
import * as THREE from 'three';
import { playerConfig } from '@/dev/player-config';

export type HatType = 'cap-forward' | 'cap-backward' | 'beanie';

/** Build a procedural hat group ready to mount under `neckGroup`. The
 *  returned group's local origin sits at the neck-group origin; the crown
 *  and brim positions are resolved from `playerConfig.head` so the hat
 *  hugs the rig's actual head sphere regardless of any per-face headShape
 *  scaling (which lives on the head mesh, not the neckGroup). */
export function buildHat(type: HatType, color: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hat';

  const cfg = playerConfig.head;
  const headRadius = cfg.radius;
  // Anchor the hat just above the head's center, sitting on the upper
  // hemisphere. positionY is the head sphere's center on neckGroup.
  const headTopY = cfg.positionY + headRadius * 0.85;

  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });

  switch (type) {
    case 'cap-forward':
    case 'cap-backward': {
      // ---- Crown ----
      // Tapered cylinder: wider at the bottom (rim) than the top (button).
      // Height ~0.18m so the crown sits visibly over the head; bottom radius
      // matches the head silhouette, top radius is 75% of bottom for a
      // baseball-cap taper.
      const crownHeight = 0.18;
      const crownGeo = new THREE.CylinderGeometry(
        headRadius * 0.75, // top radius
        headRadius,        // bottom radius (= head)
        crownHeight,
        16,                // radial segments
        1,                 // height segments
        false,             // openEnded — keep top closed
      );
      const crown = new THREE.Mesh(crownGeo, mat);
      crown.name = 'cap-crown';
      // Center the crown's mid-height at headTopY + crownHeight/2 so the
      // bottom rim sits at headTopY (just above the eye/forehead line).
      crown.position.set(0, headTopY + crownHeight * 0.4, 0);
      group.add(crown);

      // ---- Brim ----
      // A flat half-disc shape using a RingGeometry restricted to the front
      // semicircle. Approximates a baseball-cap bill: head-radius × 1.6
      // outer radius, head-radius × 0.95 inner radius (just outside the
      // crown's bottom rim so it looks attached). thetaLength = PI gives
      // 180° (a half-disc); thetaStart positions it forward or backward.
      const brimInner = headRadius * 0.95;
      const brimOuter = headRadius * 1.6;
      const isForward = type === 'cap-forward';
      // RingGeometry's theta is measured CCW from the +X axis. We want the
      // brim's flat edge to sit on the X axis (so it spans left↔right along
      // the wearer's forehead/back-of-head line), with the curve poking
      // forward (+Z) for cap-forward, backward (-Z) for cap-backward.
      // thetaStart = 0 + thetaLength = PI gives the +Y half (poking up in
      // the geometry's local space); we'll rotate the mesh to flatten it.
      const brimGeo = new THREE.RingGeometry(
        brimInner,
        brimOuter,
        16,                          // theta segments
        1,                           // phi segments
        isForward ? 0 : Math.PI,     // thetaStart
        Math.PI,                     // thetaLength (180°)
      );
      const brim = new THREE.Mesh(brimGeo, mat);
      brim.name = 'cap-brim';
      // Lay the half-disc flat in the XZ plane (RingGeometry is in XY by
      // default). rotate -PI/2 around X so +Y becomes +Z (forward).
      brim.rotation.x = -Math.PI / 2;
      // Slight downward tilt for both variants (per brief: identical for v1;
      // future tuning can flip backward bills upward).
      brim.rotation.x += -0.15;
      // Sit the brim at the crown's bottom rim height. (After rotation the
      // mesh's local origin remains at the geometry's center, which lands
      // at the brim height.)
      brim.position.set(0, headTopY, 0);
      // DoubleSide: bills are very thin and we don't want the under-side
      // to disappear when the player tilts their head.
      mat.side = THREE.DoubleSide;
      group.add(brim);
      break;
    }
    case 'beanie': {
      // ---- Dome cap, 55% polar cap covering the upper half of the head ----
      // SphereGeometry with phiLength = PI*2 (full ring) and thetaLength =
      // PI*0.55 carves out a tall dome that wraps the top + sides of the
      // head down to ~ear height. radius 5% larger than the head so the
      // beanie reads as a knit layer over the skin.
      const beanieGeo = new THREE.SphereGeometry(
        headRadius * 1.05,
        16,                // widthSegments
        12,                // heightSegments
        0,                 // phiStart
        Math.PI * 2,       // phiLength (full ring)
        0,                 // thetaStart (top pole)
        Math.PI * 0.55,    // thetaLength (55% of polar arc)
      );
      const beanie = new THREE.Mesh(beanieGeo, mat);
      beanie.name = 'beanie-dome';
      // Anchor at head center so the polar cap sits naturally on top.
      beanie.position.set(0, cfg.positionY, 0);
      // DoubleSide: the bottom rim is open; without DoubleSide the inside
      // of the dome reads as invisible from grazing angles.
      mat.side = THREE.DoubleSide;
      group.add(beanie);
      break;
    }
  }

  return group;
}

/** Dispose every geometry + material under a hat group. Used by the
 *  player's `setFaceHat(null)` and clearFaceMesh3DInternal() paths to
 *  release GPU resources on every hat swap (same pattern as faceMesh3D /
 *  faceMouthInterior). */
export function disposeHat(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) (m as THREE.Material).dispose();
    }
  });
}
