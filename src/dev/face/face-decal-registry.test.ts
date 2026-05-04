/**
 * Phase H3 — face decal registry unit tests.
 *
 * The registry is a small lazy-loading cache around a TextureLoader.
 * Tests verify:
 *  - 'none' resolves to null without touching the loader.
 *  - Loading a key twice returns the same in-flight promise (deduped).
 *  - Loaded textures are tracked + freed by `dispose()`.
 *  - Failed loads are NOT cached (next attempt retries).
 *
 * We pass a mock loader to avoid hitting the public/face-decals/ files
 * in the test environment.
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { FaceDecalRegistry, type DecalTextureLoader } from './face-decal-registry';

/** Mock loader that returns a stub THREE.Texture immediately on `load()`. */
function makeOkLoader(): {
  loader: DecalTextureLoader;
  loadCount: number;
} {
  const state = { loadCount: 0 };
  const loader: DecalTextureLoader = {
    load(url, onLoad) {
      state.loadCount++;
      // Resolve in a microtask so the promise pattern matches real
      // TextureLoader behavior (which is also async).
      Promise.resolve().then(() => {
        const tex = new THREE.Texture();
        tex.name = url;
        onLoad(tex);
      });
    },
  };
  return {
    loader,
    get loadCount() { return state.loadCount; },
  };
}

/** Mock loader that always errors. */
function makeFailLoader(): DecalTextureLoader {
  return {
    load(_url, _onLoad, _onProgress, onError) {
      Promise.resolve().then(() => onError(new Error('mock load failure')));
    },
  };
}

describe('FaceDecalRegistry', () => {
  it("returns null for the 'none' key without touching the loader", async () => {
    const okLoader = makeOkLoader();
    const reg = new FaceDecalRegistry({ loader: okLoader.loader });
    const result = await reg.load('none');
    expect(result).toBeNull();
    expect(okLoader.loadCount).toBe(0);
    reg.dispose();
  });

  it('loading a key twice returns the cached promise (only one fetch)', async () => {
    const okLoader = makeOkLoader();
    const reg = new FaceDecalRegistry({ loader: okLoader.loader });
    const p1 = reg.load('vein-forehead');
    const p2 = reg.load('vein-forehead');
    // Promise identity — second call returns the SAME promise object.
    expect(p1).toBe(p2);
    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe(t2);
    expect(okLoader.loadCount).toBe(1);
    reg.dispose();
  });

  it('loading two different keys triggers two fetches', async () => {
    const okLoader = makeOkLoader();
    const reg = new FaceDecalRegistry({ loader: okLoader.loader });
    const t1 = await reg.load('vein-forehead');
    const t2 = await reg.load('anger-cross');
    expect(t1).not.toBe(t2);
    expect(okLoader.loadCount).toBe(2);
    reg.dispose();
  });

  it('dispose() clears the cache and disposes resolved textures', async () => {
    const okLoader = makeOkLoader();
    const reg = new FaceDecalRegistry({ loader: okLoader.loader });
    const tex = await reg.load('blush');
    expect(tex).not.toBeNull();
    const disposeSpy = vi.spyOn(tex!, 'dispose');
    expect(reg.has('blush')).toBe(true);
    reg.dispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(reg.has('blush')).toBe(false);
    expect(reg.getCached('blush')).toBeNull();
    // After dispose, future loads no-op (return null) instead of
    // reviving the registry.
    const after = await reg.load('blush');
    expect(after).toBeNull();
  });

  it('failed loads are NOT cached (next attempt retries)', async () => {
    let attempts = 0;
    const flaky: DecalTextureLoader = {
      load(_url, onLoad, _onProgress, onError) {
        attempts++;
        Promise.resolve().then(() => {
          if (attempts === 1) onError(new Error('first attempt fails'));
          else onLoad(new THREE.Texture());
        });
      },
    };
    const reg = new FaceDecalRegistry({ loader: flaky });
    await expect(reg.load('vein-forehead')).rejects.toThrow('first attempt fails');
    // Second attempt should retry (not return the cached failure).
    const tex = await reg.load('vein-forehead');
    expect(tex).not.toBeNull();
    expect(attempts).toBe(2);
    reg.dispose();
  });

  it('a fully-failing loader rejects every attempt without caching', async () => {
    const reg = new FaceDecalRegistry({ loader: makeFailLoader() });
    await expect(reg.load('pain-stars')).rejects.toThrow();
    await expect(reg.load('pain-stars')).rejects.toThrow();
    expect(reg.has('pain-stars')).toBe(false);
    reg.dispose();
  });
});
