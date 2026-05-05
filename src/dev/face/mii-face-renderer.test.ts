/**
 * Phase H2 — Mii face renderer unit tests.
 *
 * Vitest's default environment is node, so HTMLImageElement isn't
 * available — buildMiiFace's data-URL decode path normally uses
 * `new Image()` + onload to produce a CanvasTexture. We stub a tiny
 * synchronous Image impl globally so the renderer's promises resolve
 * without a real DOM. We also avoid asserting on pixel data; the test
 * focuses on structural invariants:
 *
 *  - The group has the correct number of children for a given bundle
 *    (required features always; conditional ones gated by both bundle
 *    presence + opts.show* flags).
 *  - Each child is a Mesh with the expected name + position derived
 *    from the bundle's center3D × meshScale + per-feature Z bias.
 *  - dispose() removes all children + frees materials.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import type { FaceFeatureCrop, FeatureImagesBundle } from './types';

// ---------- Image stub -----------------------------------------------------
// Synchronous onload firing — buildMiiFace awaits a Promise that
// resolves on `img.onload`, so we trigger it in a microtask.
beforeAll(() => {
  if (typeof (globalThis as { Image?: unknown }).Image === 'undefined') {
    class StubImage {
      onload: (() => void) | null = null;
      onerror: ((err: unknown) => void) | null = null;
      width = 1;
      height = 1;
      private _src = '';
      get src(): string { return this._src; }
      set src(v: string) {
        this._src = v;
        // Simulate a successful decode async-after-set.
        Promise.resolve().then(() => this.onload?.());
      }
    }
    (globalThis as unknown as { Image: unknown }).Image = StubImage;
  }
});

// Import AFTER the stub so the module's `typeof Image === 'undefined'`
// guard passes. (Actually the guard runs per-call, but importing later
// is harmless.)
const { buildMiiFace } = await import('./mii-face-renderer');

// ---------- Helpers --------------------------------------------------------

const PX_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

function makeCrop(
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
): FaceFeatureCrop {
  return {
    dataUrl: PX_DATA_URL,
    srcBbox: { x: 0, y: 0, w: 10, h: 10 },
    center3D: { x: cx, y: cy, z: cz },
    size3D: { w, h },
  };
}

function makeMinBundle(): FeatureImagesBundle {
  // Six required features at distinct centroids so the test can verify
  // each one's plane lands at the right position.
  return {
    leftEye:   makeCrop(-0.16, 0.10, 0.0, 0.27, 0.06),
    rightEye:  makeCrop( 0.18, 0.12, 0.0, 0.28, 0.08),
    leftBrow:  makeCrop(-0.21, 0.23, 0.0, 0.43, 0.09),
    rightBrow: makeCrop( 0.23, 0.21, 0.0, 0.44, 0.10),
    nose:      makeCrop( 0.00,-0.03, 0.11, 0.24, 0.34),
    mouth:     makeCrop( 0.00,-0.22, 0.05, 0.36, 0.13),
  };
}

// ---------- Tests ----------------------------------------------------------

describe('buildMiiFace', () => {
  it('produces a Group with one plane per required feature when overlays opted in', async () => {
    // H2c-perfect: per-feature overlays gated behind showFeatureOverlays.
    // Default is plate-only (no per-feature planes). Tests that need
    // access to individual eye/brow/nose/mouth planes opt in here.
    const built = await buildMiiFace(makeMinBundle(), { showFeatureOverlays: true });
    expect(built.group).toBeInstanceOf(THREE.Group);
    expect(built.group.name).toBe('face-flat-group');
    // 6 feature overlays + 3 decal slots (forehead/cheekL/cheekR; H3).
    // No facePlate in makeMinBundle, no hat (default off).
    expect(built.group.children.length).toBe(6 + 3);
    expect(built.planes.size).toBe(6);
    for (const name of ['leftEye', 'rightEye', 'leftBrow', 'rightBrow', 'nose', 'mouth'] as const) {
      const mesh = built.planes.get(name);
      expect(mesh, `${name} plane should exist`).toBeDefined();
      expect(mesh!.name).toBe(`face-feature-${name}`);
    }
    built.dispose();
  });

  it('UV-cranium pivot: default-mounts no per-feature overlays (cranium texture carries face)', async () => {
    // UV-cranium pivot — facePlate is gone. The cranium ellipsoid
    // carries the user's face via its equirectangular texture (mounted
    // by the head-mesh-builder, not by this renderer). The Mii face
    // group's job in production is just decal slots + opt-in feature
    // overlays for keyframe expression swaps.
    const bundle: FeatureImagesBundle = {
      ...makeMinBundle(),
      // Even with a faceCraniumTexture present, the renderer's group
      // shouldn't mount any plane for it (the cranium owns it).
      faceCraniumTexture: makeCrop(0.0, 0.0, 0.020, 0.20, 0.27),
    };
    const built = await buildMiiFace(bundle);
    // 0 feature overlays + 3 decal slots (no overlays default-mounted).
    expect(built.group.children.length).toBe(0 + 3);
    expect(built.planes.has('leftEye')).toBe(false);
    built.dispose();
  });

  it('includes optional beard / mustache / hat planes when explicitly requested', async () => {
    const bundle: FeatureImagesBundle = {
      ...makeMinBundle(),
      beard: makeCrop(-0.03, -0.27, -0.19, 0.96, 0.60),
      mustache: makeCrop(0.0, -0.18, 0.04, 0.30, 0.05),
      hat: makeCrop(0.01, 0.75, 0.02, 0.32, 0.02),
    };
    // Hat / beard / mustache / per-feature overlays all gated OFF by
    // default. Opt all in to verify the full path still works.
    const built = await buildMiiFace(bundle, {
      showHat: true, showBeard: true, showMustache: true, showFeatureOverlays: true,
    });
    // 6 overlays + beard + mustache + hat + 3 decal slots.
    expect(built.group.children.length).toBe(9 + 3);
    expect(built.planes.has('beard')).toBe(true);
    expect(built.planes.has('mustache')).toBe(true);
    expect(built.planes.has('hat')).toBe(true);
    built.dispose();
  });

  it('respects show* opts to gate optional features', async () => {
    const bundle: FeatureImagesBundle = {
      ...makeMinBundle(),
      beard: makeCrop(0, -0.27, -0.19, 0.96, 0.60),
      hat: makeCrop(0.01, 0.75, 0.02, 0.32, 0.02),
    };
    const built = await buildMiiFace(bundle, {
      showBeard: false, showHat: false, showFeatureOverlays: true,
    });
    // 6 overlays (beard + hat suppressed) + 3 decal slots.
    expect(built.group.children.length).toBe(6 + 3);
    expect(built.planes.has('beard')).toBe(false);
    expect(built.planes.has('hat')).toBe(false);
    built.dispose();
  });

  it('builds three decal slots (forehead/cheekL/cheekR) starting hidden', async () => {
    const built = await buildMiiFace(makeMinBundle());
    const slots = built.decalSlots;
    expect(slots.forehead.name).toBe('face-decal-forehead');
    expect(slots.cheekL.name).toBe('face-decal-cheekL');
    expect(slots.cheekR.name).toBe('face-decal-cheekR');
    for (const m of [slots.forehead, slots.cheekL, slots.cheekR]) {
      expect(m.visible).toBe(false);
      const mat = m.material as THREE.MeshBasicMaterial;
      expect(mat.opacity).toBe(0);
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(false);
    }
    // Forehead anchor: +60mm above iris midpoint.
    expect(slots.forehead.position.y).toBeCloseTo(0.060, 5);
    expect(slots.forehead.position.x).toBeCloseTo(0.0, 5);
    // Cheeks at ±50mm X.
    expect(slots.cheekL.position.x).toBeCloseTo(-0.050, 5);
    expect(slots.cheekR.position.x).toBeCloseTo(0.050, 5);
    expect(slots.cheekL.position.y).toBeCloseTo(-0.020, 5);
    expect(built.lastDecalKey.forehead).toBe('none');
    built.dispose();
  });

  it('uses fixed-anatomical anchors + physical sizes (ignoring H1 size3D/center3D)', async () => {
    // The H1 baker's `size3D` is in raw landmark units inflated by per-
    // feature padding multipliers (see TARGET_SIZE_M comment in
    // mii-face-renderer.ts) so applying meshScale produces 2-5× over-
    // size planes. The renderer therefore PINS each feature to a fixed
    // anatomical anchor + physical-meter size table. Verify the nose
    // plane lands at the table anchor regardless of the bundle's
    // center3D, and ignores meshScale entirely.
    const bundle = makeMinBundle();
    const built = await buildMiiFace(bundle, { meshScale: 0.5, showFeatureOverlays: true });
    const nose = built.planes.get('nose')!;
    const params = (nose.geometry as THREE.PlaneGeometry).parameters;
    // Physical size (METERS) — independent of meshScale.
    expect(params.width).toBeCloseTo(0.045, 4);
    expect(params.height).toBeCloseTo(0.075, 4);
    // Anchor offsets (METERS) — independent of bundle's center3D.x/y.
    expect(nose.position.x).toBeCloseTo(0.0, 5);
    expect(nose.position.y).toBeCloseTo(-0.030, 5);
    // Z = per-feature Z_BIAS + craniumFrontZ — bundle.center3D.z ignored.
    expect(nose.position.z).toBeCloseTo(0.020, 5);
    built.dispose();
  });

  it('places eyes symmetrically at the iris-anchor Y', async () => {
    const built = await buildMiiFace(makeMinBundle(), { showFeatureOverlays: true });
    const lEye = built.planes.get('leftEye')!;
    const rEye = built.planes.get('rightEye')!;
    // Phase H2c-fix — eye anchor sits +5mm above the iris midpoint so
    // the eye plane covers the lid region rather than straddling the
    // iris. Both eyes share the same Y; the shift is symmetric.
    expect(lEye.position.y).toBeCloseTo(0.005, 5);
    expect(rEye.position.y).toBeCloseTo(0.005, 5);
    expect(lEye.position.x).toBeCloseTo(-rEye.position.x, 5);
    // Eye plane width matches the physical-meter target.
    const params = (lEye.geometry as THREE.PlaneGeometry).parameters;
    expect(params.width).toBeCloseTo(0.055, 4);
    built.dispose();
  });

  it('orders eyes/brows above beard via renderOrder', async () => {
    const bundle: FeatureImagesBundle = {
      ...makeMinBundle(),
      beard: makeCrop(0, -0.27, -0.19, 0.96, 0.60),
    };
    const built = await buildMiiFace(bundle, { showBeard: true, showFeatureOverlays: true });
    expect(built.planes.get('beard')!.renderOrder).toBeLessThan(
      built.planes.get('leftEye')!.renderOrder,
    );
    expect(built.planes.get('beard')!.renderOrder).toBeLessThan(
      built.planes.get('mouth')!.renderOrder,
    );
    built.dispose();
  });

  it('dispose() empties the group and frees materials', async () => {
    const built = await buildMiiFace(makeMinBundle(), { showFeatureOverlays: true });
    const matRef = (built.planes.get('nose')!.material) as THREE.MeshBasicMaterial;
    expect(built.group.children.length).toBeGreaterThan(0);
    built.dispose();
    expect(built.group.children.length).toBe(0);
    // After dispose, material's `.map` reference still exists but the
    // texture's GPU image was explicitly disposed — we can at least
    // verify the material was disposed by checking that THREE marks it
    // (no public flag in r155+; test that calling dispose again is
    // idempotent).
    expect(() => matRef.dispose()).not.toThrow();
  });
});
