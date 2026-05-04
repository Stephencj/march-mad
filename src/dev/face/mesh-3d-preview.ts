/**
 * Tiny self-contained Three.js preview canvas for the just-built 3D face
 * mesh. Used in the face-editor right after a successful 3D scan, before
 * the user accepts/redoes. Owns its own renderer / scene / camera so it
 * doesn't perturb anything else on the page.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BuiltFaceMesh } from './mesh-builder';

export interface FaceMeshPreview {
  /** The rendering canvas. Caller appends this into the DOM. */
  canvas: HTMLCanvasElement;
  /** Replace the mesh shown. Disposes the previous (geometry+material+texture). */
  setMesh: (built: BuiltFaceMesh | null) => void;
  /** Resize to the host element's CSS box. Call from a ResizeObserver. */
  resize: () => void;
  /** Stop the rAF loop, dispose GPU resources. Call before the host element
   *  is removed from the DOM (the editor's Accept/Redo flow does this). */
  dispose: () => void;
}

export function createFaceMeshPreview(host: HTMLElement): FaceMeshPreview {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  host.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x121826);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10);
  // Park the camera ~0.7m back along +z (the mesh faces +z by convention,
  // so this looks at the front of the face). Slight Y bump to put the eyes
  // around frame-center.
  camera.position.set(0, 0, 0.7);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);
  // Constrain to keep the user from going through the head — they can spin
  // around to see profile and back, but not zoom inside.
  controls.minDistance = 0.3;
  controls.maxDistance = 2.5;

  // Subtle fill — the face mesh is MeshBasicMaterial (lighting baked into
  // the photo), but a faint ambient on the room background keeps the
  // canvas from looking like a flat color when no mesh is loaded yet.
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  let currentMesh: THREE.Mesh | null = null;
  let currentBuilt: BuiltFaceMesh | null = null;

  function disposeCurrent(): void {
    if (!currentBuilt) return;
    if (currentMesh) {
      scene.remove(currentMesh);
      currentMesh = null;
    }
    currentBuilt.geometry.dispose();
    const mat = currentBuilt.mesh.material as THREE.Material;
    mat.dispose();
    currentBuilt.texture.dispose();
    currentBuilt = null;
  }

  function setMesh(built: BuiltFaceMesh | null): void {
    disposeCurrent();
    if (!built) return;
    currentBuilt = built;
    currentMesh = built.mesh;
    scene.add(built.mesh);
  }

  function resize(): void {
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();

  let raf = 0;
  let disposed = false;
  function tick(): void {
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    disposeCurrent();
    controls.dispose();
    renderer.dispose();
    if (canvas.parentElement === host) host.removeChild(canvas);
  }

  return { canvas, setMesh, resize, dispose };
}
