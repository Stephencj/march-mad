/**
 * Triangle index buffer for the canonical 478-vertex MediaPipe FaceMesh,
 * derived from the static `FaceLandmarker.FACE_LANDMARKS_TESSELATION` edge
 * list. The edge list is a flat list of `{ start, end }` pairs that
 * collectively trace the tessellated face surface — but they're EDGES, not
 * triangles. To render a filled mesh we need triangles, so this module
 * runs once at first call, walks the edge graph to find every 3-cycle
 * (i.e. a, b, c where a-b, b-c, c-a all exist), de-dupes, and caches the
 * result.
 *
 * Expected output: ~850–900 unique triangles (the canonical tesselation
 * has ~2700 edges, and each triangle contributes 3 edges shared with its
 * neighbors, so triangles ≈ edges / 3 + boundary correction).
 */
import { FaceLandmarker } from '@mediapipe/tasks-vision';

let cached: Uint32Array | null = null;

/**
 * Return a flat Uint32Array of triangle vertex indices ready for
 * `BufferGeometry.setIndex`. Layout: `[v0, v1, v2, v0, v1, v2, ...]`.
 *
 * Cached after the first call — the 3-cycle search is O(E * average-
 * neighbors) and walks ~2700 edges, ~7-9 neighbors each, so it's a few
 * hundred-thousand ops — fast (<10ms in practice) but we still don't
 * want to repeat it on every face swap.
 */
export function getFaceMeshTriangles(): Uint32Array {
  if (cached) return cached;
  cached = buildTriangleIndices();
  return cached;
}

/** For tests / debugging: how many triangles did we end up with. */
export function getFaceMeshTriangleCount(): number {
  return getFaceMeshTriangles().length / 3;
}

/**
 * MediaPipe canonical FaceMesh inner-lip ring vertex indices (closed loop,
 * upper + lower inner lips). Triangles whose three vertices are ALL members
 * of this set fill the mouth interior — those are removed by
 * `getInnerMouthTrianglesFiltered()` so the lips can part and reveal a dark
 * interior plane instead of stretching skin across the gap.
 *
 * Index 13 is the inner-upper-lip center; index 14 is the inner-lower-lip
 * center. The set covers both halves of the inner ring.
 */
export const INNER_LIP_RING_INDICES: ReadonlyArray<number> = [
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
  308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
];

let cachedFiltered: Uint32Array | null = null;

/**
 * Return the canonical triangle list with mouth-interior triangles removed.
 *
 * A triangle is considered "mouth interior" iff all three of its vertices
 * are in the inner-lip ring (`INNER_LIP_RING_INDICES`). The canonical mesh
 * has no vertices strictly inside the lip ring — the mouth is a thin shell
 * — so the all-three-on-ring filter cleanly identifies the fill triangles
 * spanning between the inner upper and lower lips. Removing them opens a
 * hole through which a dark "mouth interior" plane (mounted as a sibling)
 * shows when `jawOpen` deforms the lower lip downward.
 *
 * Cached after the first call.
 */
export function getInnerMouthTrianglesFiltered(): Uint32Array {
  if (cachedFiltered) return cachedFiltered;
  const tris = getFaceMeshTriangles();
  const ring = new Set<number>(INNER_LIP_RING_INDICES);
  const kept: number[] = [];
  let removed = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i];
    const b = tris[i + 1];
    const c = tris[i + 2];
    if (ring.has(a) && ring.has(b) && ring.has(c)) {
      removed++;
      continue;
    }
    kept.push(a, b, c);
  }
  // Expected: ~6-12 inner-mouth fill triangles between the two inner-lip
  // halves. Outside that band probably means the topology source changed
  // (different MediaPipe build) — log a warning but proceed.
  if (removed < 4 || removed > 20) {
    console.warn(
      `[face/topology] Filtered ${removed} inner-mouth triangles ` +
        `(expected 6–12). The inner-lip ring set or the canonical ` +
        `tessellation may have changed.`,
    );
  }
  cachedFiltered = new Uint32Array(kept);
  return cachedFiltered;
}

function buildTriangleIndices(): Uint32Array {
  const edges = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
  if (!edges || edges.length === 0) {
    // Defensive — if the static list is somehow unavailable (older bundle
    // version, mocked test env), return an empty index buffer. The mesh
    // builder logs a warning and falls back to point-cloud-style geometry.
    console.warn(
      'FaceLandmarker.FACE_LANDMARKS_TESSELATION is empty — face mesh ' +
        'topology cannot be built. 3D face will render as a point cloud.',
    );
    return new Uint32Array(0);
  }

  // Build an adjacency set keyed on vertex index. Use a Set per vertex
  // so neighbor lookup is O(1) — critical for the inner loop of the
  // 3-cycle search below.
  const adj = new Map<number, Set<number>>();
  const ensure = (v: number): Set<number> => {
    let s = adj.get(v);
    if (!s) {
      s = new Set<number>();
      adj.set(v, s);
    }
    return s;
  };
  for (const e of edges) {
    if (e.start === e.end) continue;
    ensure(e.start).add(e.end);
    ensure(e.end).add(e.start);
  }

  // Triangle search. For each edge (a, b), iterate the smaller of a's and
  // b's neighbor sets. If c is a neighbor of both a and b, then (a, b, c)
  // forms a 3-cycle. To avoid emitting the same triangle three times
  // (once per edge), only accept c when a < b < c after sorting (i.e.,
  // the canonical sort order of the triangle's vertices). This single
  // ordering also serves as the dedupe key.
  const seen = new Set<number>();
  const tris: number[] = [];
  // 478-vertex limit; encode (a, b, c) as a*N*N + b*N + c with N=512 to
  // dodge collisions cheaply (478 < 512). Could use a Set<string> but the
  // numeric key is ~5x faster in V8 for this size.
  const N = 512;

  for (const e of edges) {
    const a0 = e.start;
    const b0 = e.end;
    if (a0 === b0) continue;
    const aNeighbors = adj.get(a0)!;
    const bNeighbors = adj.get(b0)!;
    const smaller = aNeighbors.size <= bNeighbors.size ? aNeighbors : bNeighbors;
    const larger = smaller === aNeighbors ? bNeighbors : aNeighbors;
    for (const c of smaller) {
      if (c === a0 || c === b0) continue;
      if (!larger.has(c)) continue;
      // Sort the three vertices ascending to produce a canonical key.
      let v0 = a0;
      let v1 = b0;
      let v2 = c;
      if (v0 > v1) [v0, v1] = [v1, v0];
      if (v1 > v2) [v1, v2] = [v2, v1];
      if (v0 > v1) [v0, v1] = [v1, v0];
      const key = v0 * N * N + v1 * N + v2;
      if (seen.has(key)) continue;
      seen.add(key);
      // Emit the triangle. Winding order isn't enforced here — Three.js
      // is configured DoubleSide on the face material so back-faces still
      // render. (Phase 7.7 may revisit if shading goes lit.)
      tris.push(v0, v1, v2);
    }
  }

  return new Uint32Array(tris);
}
