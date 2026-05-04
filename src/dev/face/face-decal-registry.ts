/**
 * Phase H3 — shared decal texture loader.
 *
 * Decals are extreme-expression overlays (forehead vein, anger-X,
 * sweat-drop, blush, pain-stars, cheek-crease) that the keyframe mixer
 * fades in/out on top of the Mii face when composite expressions like
 * `angry` / `pain` / `joy` / `surprised` activate.
 *
 * The registry is a thin lazy-loading cache wrapping `THREE.TextureLoader`.
 * One module-level singleton (`faceDecalRegistry`) is shared across every
 * mounted Mii face — six players hitting the same `vein-forehead` decal
 * still only decode the PNG once. The cache lives forever within an app
 * session; `dispose()` is exposed for tests + the rare full-cleanup path
 * (e.g. service-worker swap).
 *
 * The cache stores **promises** rather than resolved textures so two
 * concurrent loads of the same key share a single fetch — the second
 * caller just awaits the same in-flight promise. When the promise
 * rejects, we evict so the next attempt can retry; we do NOT cache
 * failures. If the network is genuinely down we want a retry next frame,
 * not a permanently-blank decal slot.
 *
 * Asset paths live in PUBLIC_PATHS keyed by `DecalKey`. Adding a new
 * decal means: drop a PNG in `public/face-decals/`, add the key to the
 * union below, and add the path to PUBLIC_PATHS — no other wiring.
 */
import * as THREE from 'three';

/** All known decal asset keys. `'none'` is the special "no decal active"
 *  sentinel and never has an associated texture. */
export type DecalKey =
  | 'none'
  | 'vein-forehead'
  | 'anger-cross'
  | 'sweat-drop'
  | 'blush'
  | 'pain-stars'
  | 'crease-cheek';

/** Public-path mapping. Built off the static `public/face-decals/`
 *  directory; keys correspond to the PNGs created by
 *  `scripts/build-face-decals.cjs`. */
const DECAL_PATHS: Record<DecalKey, string | null> = {
  'none': null,
  'vein-forehead': '/face-decals/vein.png',
  'anger-cross': '/face-decals/anger-cross.png',
  'sweat-drop': '/face-decals/sweat-drop.png',
  'blush': '/face-decals/blush.png',
  'pain-stars': '/face-decals/pain-stars.png',
  'crease-cheek': '/face-decals/crease-cheek.png',
};

/** Texture loader used by every registry instance. Mock in tests by
 *  passing your own loader to `createFaceDecalRegistry({ loader })`. */
export interface DecalTextureLoader {
  load(
    url: string,
    onLoad: (texture: THREE.Texture) => void,
    onProgress: undefined,
    onError: (err: unknown) => void,
  ): void;
}

export interface FaceDecalRegistryOpts {
  /** Inject a custom loader (tests). Defaults to `new THREE.TextureLoader()`. */
  loader?: DecalTextureLoader;
}

export class FaceDecalRegistry {
  private cache = new Map<DecalKey, Promise<THREE.Texture | null>>();
  /** Resolved textures, tracked separately for `dispose()`. The promise
   *  cache holds futures; once they resolve we mirror the texture here
   *  so dispose can iterate without awaiting. */
  private resolvedTextures = new Map<DecalKey, THREE.Texture>();
  private loader: DecalTextureLoader;
  private disposed = false;

  constructor(opts: FaceDecalRegistryOpts = {}) {
    this.loader = opts.loader ?? new THREE.TextureLoader();
  }

  /**
   * Lazy-load a decal texture by key. Calls share an in-flight promise
   * — concurrent `load(k)` calls trigger only one network fetch.
   *
   * - `key === 'none'` resolves to `null` (no texture to apply).
   * - On success: tuned for the alpha-tested Mii decal pipeline
   *   (linear filtering, no mipmaps — avoids bleed at the cutout).
   * - On failure: the cache slot is evicted so a retry next frame
   *   doesn't permanently lock us out of the decal.
   */
  load(key: DecalKey): Promise<THREE.Texture | null> {
    if (this.disposed) return Promise.resolve(null);
    if (key === 'none') return Promise.resolve(null);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const path = DECAL_PATHS[key];
    if (!path) return Promise.resolve(null);

    const promise = new Promise<THREE.Texture | null>((resolve, reject) => {
      this.loader.load(
        path,
        (texture) => {
          // Tune for alpha-tested Mii decals: linear filter, no mipmaps,
          // sRGB encoding so PNG colors render correctly under
          // MeshBasicMaterial.
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.generateMipmaps = false;
          // colorSpace is the modern Three field (r152+); preserve the
          // legacy `encoding` path for older builds via a permissive
          // any-cast.
          (texture as unknown as { colorSpace?: string }).colorSpace = THREE.SRGBColorSpace;
          this.resolvedTextures.set(key, texture);
          resolve(texture);
        },
        undefined,
        (err) => {
          // Don't cache the failure — evict so the next load retries.
          this.cache.delete(key);
          reject(err);
        },
      );
    });
    this.cache.set(key, promise);
    return promise;
  }

  /** Synchronously check whether a key has been resolved (texture is
   *  in `resolvedTextures`). Useful for tests + the renderer's
   *  short-circuit when toggling a decal that's already mounted. */
  has(key: DecalKey): boolean {
    return this.resolvedTextures.has(key);
  }

  /** Return the cached texture (or null when not loaded / 'none'). */
  getCached(key: DecalKey): THREE.Texture | null {
    if (key === 'none') return null;
    return this.resolvedTextures.get(key) ?? null;
  }

  /** Free all resolved textures + clear the promise cache. After
   *  dispose, future `load()` calls return `Promise.resolve(null)`
   *  rather than reviving the registry. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const tex of this.resolvedTextures.values()) {
      tex.dispose();
    }
    this.resolvedTextures.clear();
    this.cache.clear();
  }
}

/** Module-level shared singleton — one decal cache per app session. */
export const faceDecalRegistry = new FaceDecalRegistry();
