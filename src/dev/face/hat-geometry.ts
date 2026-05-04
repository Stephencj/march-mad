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
      // Hemisphere hugging the top half of the head (not a tall cylinder
      // hovering above). This matches a real baseball cap: low-profile dome
      // that sits ON the head from the top of the forehead up to the crown.
      // Slightly larger than the head sphere (1.04×) so it reads as a knit
      // layer over the skin, with no z-fighting at grazing angles.
      // thetaLength=PI*0.35 → bottom rim sits at y = cos(63°) × 1.04r ≈
      // +0.47r above head center, which is the forehead/brow line. The
      // face area below this line stays exposed.
      const crownThetaLength = Math.PI * 0.35;
      const crownRadius = headRadius * 1.04;
      const crownGeo = new THREE.SphereGeometry(
        crownRadius,
        24,                // widthSegments
        12,                // heightSegments
        0,                 // phiStart
        Math.PI * 2,       // phiLength (full ring)
        0,                 // thetaStart (top pole)
        crownThetaLength,
      );
      const crown = new THREE.Mesh(crownGeo, mat);
      crown.name = 'cap-crown';
      crown.position.set(0, cfg.positionY, 0);
      group.add(crown);
      // Rim Y in world space — where the dome ends and the visor mounts.
      const rimY = cfg.positionY + crownRadius * Math.cos(crownThetaLength);

      // ---- Visor (bill) ----
      // Small forward-projecting tab. A baseball-cap visor only spans
      // ~110° of arc on the front of the head (about ear-to-ear at the
      // forehead, NOT 180° around). Outer radius 1.35× head, inner radius
      // 1.04× head (just outside the crown). thetaLength = 110° gives a
      // narrow forward bill, not a wide-brim hat.
      const isForward = type === 'cap-forward';
      // Visor lateral half-width at the dome's rim. The dome's rim sits at
      // a sphere-cross-section radius of `crownRadius * sin(crownThetaLength)`,
      // so the inner radius of the visor matches that to attach cleanly.
      const visorInner = crownRadius * Math.sin(crownThetaLength);
      const visorOuter = visorInner + headRadius * 0.55; // ~5.5cm bill
      const visorArc = Math.PI * (95 / 180); // 95° — narrower than full half
      // RingGeometry's theta is measured CCW from +X (geometry's local).
      // After we rotate the mesh -PI/2 around X, geometry's +Y → world +Z
      // (forward), and geometry's +X → world +X (right). So we want the
      // visor's arc centered on +Y (forward) for cap-forward, or centered
      // on -Y (backward) for cap-backward.
      // Center on +Y (geometry-local) → thetaStart = PI/2 - visorArc/2.
      // Center on -Y → thetaStart = -PI/2 - visorArc/2 = 3*PI/2 - visorArc/2.
      const visorThetaStart = isForward
        ? Math.PI / 2 - visorArc / 2
        : -Math.PI / 2 - visorArc / 2;
      const visorGeo = new THREE.RingGeometry(
        visorInner,
        visorOuter,
        20,                // theta segments
        1,                 // phi segments
        visorThetaStart,
        visorArc,
      );
      const visor = new THREE.Mesh(visorGeo, mat);
      visor.name = 'cap-brim';
      // Lay flat in the XZ plane. -PI/2 around X maps geometry +Y to world +Z.
      visor.rotation.x = -Math.PI / 2;
      // Slight downward tilt — real cap visors angle ~10° down from horizontal.
      visor.rotation.x += -0.18;
      // Position at brow height: the bottom of the crown hemisphere meets
      // the head at Y = cfg.positionY (head center). The visor mounts there
      // on the front of the head, at the brow line.
      visor.position.set(0, rimY, 0);
      // DoubleSide so the underside of the bill stays visible from below.
      mat.side = THREE.DoubleSide;
      group.add(visor);
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
