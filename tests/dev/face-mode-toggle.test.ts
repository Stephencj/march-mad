// @vitest-environment jsdom
// Phase H10 — Face Mode dev toggle: verify the radio buttons + localStorage
// persistence + applyFaceMode() re-route on the player. The actual
// visibility math lives in player.ts's `applyFaceMode` helper, which has
// its own coverage; here we focus on the UI ↔ state plumbing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildFaceModeSection,
  readFaceModeFromStorage,
  applyFaceModeChoice,
  getCurrentFaceMode,
  FACE_MODE_LS_KEY,
} from '@/dev/face-mode-toggle';

// A minimal stub satisfying the shape the toggle uses (just .applyFaceMode()).
// We keep it loose because the GamePlayer constructor pulls in three.js +
// ~thousands of lines of rig wiring; what we care about is the call edge.
interface PlayerStub {
  applyFaceMode(): void;
  applyCallCount: number;
}
function makePlayerStub(): PlayerStub {
  const stub = {
    applyCallCount: 0,
    applyFaceMode(): void {
      stub.applyCallCount++;
    },
  };
  return stub;
}

describe('face-mode-toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset the global so previous tests' writes don't leak.
    (window as unknown as { __faceMode?: string }).__faceMode = undefined;
  });

  afterEach(() => {
    localStorage.clear();
    (window as unknown as { __faceMode?: string }).__faceMode = undefined;
  });

  describe('readFaceModeFromStorage', () => {
    it('returns null when nothing is stored', () => {
      expect(readFaceModeFromStorage()).toBeNull();
    });

    it('returns the stored value when valid', () => {
      localStorage.setItem(FACE_MODE_LS_KEY, 'procedural');
      expect(readFaceModeFromStorage()).toBe('procedural');
    });

    it('returns null for an unknown stored value', () => {
      localStorage.setItem(FACE_MODE_LS_KEY, 'garbage');
      expect(readFaceModeFromStorage()).toBeNull();
    });
  });

  describe('applyFaceModeChoice', () => {
    it('writes the new mode to localStorage AND the global', () => {
      const stub = makePlayerStub();
      applyFaceModeChoice('procedural', () => stub as unknown as never);
      expect(localStorage.getItem(FACE_MODE_LS_KEY)).toBe('procedural');
      expect((window as unknown as { __faceMode: string }).__faceMode).toBe('procedural');
    });

    it('calls applyFaceMode on the resolved player', () => {
      const stub = makePlayerStub();
      applyFaceModeChoice('photo', () => stub as unknown as never);
      expect(stub.applyCallCount).toBe(1);
    });

    it('still flips state when no player is available', () => {
      // No-op-safe: the next mount will pick up the new mode.
      applyFaceModeChoice('mii', () => null);
      expect(localStorage.getItem(FACE_MODE_LS_KEY)).toBe('mii');
      expect((window as unknown as { __faceMode: string }).__faceMode).toBe('mii');
    });
  });

  describe('getCurrentFaceMode', () => {
    it('defaults to mii when nothing is stored or set', () => {
      expect(getCurrentFaceMode()).toBe('mii');
    });

    it('prefers the live window.__faceMode over localStorage', () => {
      localStorage.setItem(FACE_MODE_LS_KEY, 'procedural');
      (window as unknown as { __faceMode: string }).__faceMode = 'photo';
      expect(getCurrentFaceMode()).toBe('photo');
    });

    it('falls back to localStorage when window.__faceMode is unset', () => {
      localStorage.setItem(FACE_MODE_LS_KEY, 'procedural');
      expect(getCurrentFaceMode()).toBe('procedural');
    });
  });

  describe('buildFaceModeSection', () => {
    it('renders three radio inputs (mii / procedural / photo)', () => {
      const section = buildFaceModeSection(() => null);
      const radios = section.querySelectorAll<HTMLInputElement>('input[type="radio"]');
      expect(radios.length).toBe(3);
      const values = Array.from(radios).map((r) => r.value).sort();
      expect(values).toEqual(['mii', 'photo', 'procedural']);
    });

    it('checks the radio matching the stored mode on build', () => {
      localStorage.setItem(FACE_MODE_LS_KEY, 'procedural');
      const section = buildFaceModeSection(() => null);
      const radio = section.querySelector<HTMLInputElement>(
        'input[data-role="face-mode-radio-procedural"]',
      );
      expect(radio?.checked).toBe(true);
    });

    it('writes localStorage and re-applies on radio change', () => {
      const stub = makePlayerStub();
      const section = buildFaceModeSection(() => stub as unknown as never);
      const procRadio = section.querySelector<HTMLInputElement>(
        'input[data-role="face-mode-radio-procedural"]',
      )!;
      procRadio.checked = true;
      procRadio.dispatchEvent(new Event('change'));
      expect(localStorage.getItem(FACE_MODE_LS_KEY)).toBe('procedural');
      expect((window as unknown as { __faceMode: string }).__faceMode).toBe('procedural');
      expect(stub.applyCallCount).toBe(1);
    });

    it('updates the badge text to reflect the new mode', () => {
      const section = buildFaceModeSection(() => null);
      const badge = section.querySelector<HTMLElement>('[data-role="face-mode-badge"]')!;
      expect(badge.textContent).toBe('[Mii]');
      const procRadio = section.querySelector<HTMLInputElement>(
        'input[data-role="face-mode-radio-procedural"]',
      )!;
      procRadio.checked = true;
      procRadio.dispatchEvent(new Event('change'));
      expect(badge.textContent).toBe('[Procedural]');
    });

    it('persists across rebuilds — stored procedural is reflected in a fresh section', () => {
      // First section: change to photo
      const stub = makePlayerStub();
      const first = buildFaceModeSection(() => stub as unknown as never);
      const photoRadio = first.querySelector<HTMLInputElement>(
        'input[data-role="face-mode-radio-photo"]',
      )!;
      photoRadio.checked = true;
      photoRadio.dispatchEvent(new Event('change'));
      // Second section (simulates a page reload, but localStorage survives)
      const second = buildFaceModeSection(() => null);
      const photoRadio2 = second.querySelector<HTMLInputElement>(
        'input[data-role="face-mode-radio-photo"]',
      );
      expect(photoRadio2?.checked).toBe(true);
    });
  });
});
