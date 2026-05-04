// =============================================================================
// Phase H10 — Face Mode dev toggle
// -----------------------------------------------------------------------------
// Builds a small UI block (radio buttons + a current-mode badge) that lets
// devs flip `window.__faceMode` between 'mii' / 'procedural' / 'photo'
// without rebuilding. The selection persists to localStorage under the key
// `devpanel:face-mode` so it survives reloads. The default-fallback logic
// in anim-viewer / player-editor / face-mirror reads the SAME key first
// and uses the override when present, otherwise defaults to 'mii' when a
// featureImages bundle is mounted.
//
// The toggle calls `getPlayer().applyFaceMode()` on every change so the
// canonical mesh / procedural overlay / Mii planes / photo plane are
// re-routed without re-mounting any geometry.
// =============================================================================

import type { GamePlayer } from '../game/player';

/** localStorage key shared across all face-mode UIs (dev-overlay, player-
 *  editor, anim-viewer, face-mirror). When unset, callers default to 'mii'
 *  whenever a featureImages bundle is present (preserves prior H9 behavior). */
export const FACE_MODE_LS_KEY = 'devpanel:face-mode';

/** The set of values written into `window.__faceMode`. The 'mesh' and
 *  'both' values from earlier phases stay valid in the global, but the
 *  H10 toggle only exposes the three modes the design calls for. */
export type FaceMode = 'mii' | 'procedural' | 'photo';

const MODES: ReadonlyArray<{ value: FaceMode; label: string; hint: string }> = [
  { value: 'mii',        label: 'Mii',        hint: 'flat-image plates (default with featureImages)' },
  { value: 'procedural', label: 'Procedural', hint: 'old 3D mesh features (eyelids/brows/nose/lips)' },
  { value: 'photo',      label: 'Photo',      hint: 'flat-photo plane on head' },
];

/** Read the user's persisted choice from localStorage. Returns `null`
 *  when nothing has been written yet, so callers can fall back to the
 *  per-page default (`'mii'` when featureImages present). */
export function readFaceModeFromStorage(): FaceMode | null {
  try {
    const v = localStorage.getItem(FACE_MODE_LS_KEY);
    if (v === 'mii' || v === 'procedural' || v === 'photo') return v;
    return null;
  } catch {
    return null;
  }
}

/** Best-effort write — silently ignores quota / disabled-storage errors. */
function writeFaceModeToStorage(mode: FaceMode): void {
  try { localStorage.setItem(FACE_MODE_LS_KEY, mode); } catch { /* ignore */ }
}

/** Read the currently-active mode. Prefers `window.__faceMode` so the
 *  badge matches what the renderer actually shows; falls back to
 *  localStorage; finally defaults to 'mii' (the H9-era default). The
 *  global also accepts the older 'mesh' / 'both' debug values; we map
 *  them to 'procedural' for badge purposes since the H10 toggle has no
 *  control for them (devs who set 'mesh' in DevTools see the badge
 *  read 'Procedural', which is fine — they're not using the toggle). */
export function getCurrentFaceMode(): FaceMode {
  const live = typeof window !== 'undefined' ? window.__faceMode : undefined;
  if (live === 'mii' || live === 'procedural' || live === 'photo') return live;
  const stored = readFaceModeFromStorage();
  return stored ?? 'mii';
}

/** Apply a face-mode choice — writes localStorage, sets the global, and
 *  re-applies the visibility plumbing on the player (if one was found).
 *  Exported separately from the UI builder so tests can drive the same
 *  state machine without standing up DOM. */
export function applyFaceModeChoice(
  mode: FaceMode,
  getPlayer: () => GamePlayer | null,
): void {
  writeFaceModeToStorage(mode);
  if (typeof window !== 'undefined') {
    window.__faceMode = mode;
  }
  const player = getPlayer();
  player?.applyFaceMode();
}

/** Build the UI block. Returns a `<details>` element ready to append into
 *  any panel. The current-mode badge in the summary updates on every
 *  toggle. The radios use `name="dev-face-mode"` (page-unique because
 *  there's only ever ONE face-mode toggle per page). */
export function buildFaceModeSection(
  getPlayer: () => GamePlayer | null,
): HTMLElement {
  const details = document.createElement('details');
  details.open = true;
  details.dataset.role = 'face-mode-section';
  Object.assign(details.style, { marginBottom: '12px' });

  const summary = document.createElement('summary');
  Object.assign(summary.style, {
    cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
    color: '#aaa', padding: '4px 0', letterSpacing: '1px',
  });
  const summaryLabel = document.createElement('span');
  summaryLabel.textContent = 'FACE MODE ';
  summary.appendChild(summaryLabel);

  // Current-mode badge — capitalized inline so the section header reads
  // "FACE MODE [Mii]" / "FACE MODE [Procedural]" at a glance.
  const badge = document.createElement('span');
  badge.dataset.role = 'face-mode-badge';
  Object.assign(badge.style, {
    display: 'inline-block',
    padding: '1px 6px',
    background: '#1f2540',
    color: '#ffd700',
    border: '1px solid #444',
    borderRadius: '3px',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.5px',
  });
  const refreshBadge = (): void => {
    const cur = getCurrentFaceMode();
    const cap = cur.charAt(0).toUpperCase() + cur.slice(1);
    badge.textContent = `[${cap}]`;
  };
  refreshBadge();
  summary.appendChild(badge);
  details.appendChild(summary);

  // Hint paragraph — explains the override semantics so devs don't get
  // surprised by stale localStorage state on a fresh page load.
  const hint = document.createElement('div');
  hint.textContent = 'Override the per-face default. Persists across reloads.';
  Object.assign(hint.style, { fontSize: '10px', color: '#888', padding: '2px 0 6px 0' });
  details.appendChild(hint);

  // Radio group — each row is a label wrapping the input so the entire
  // line is clickable.
  const initial = getCurrentFaceMode();
  for (const { value, label, hint: rowHint } of MODES) {
    const row = document.createElement('label');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'flex-start', gap: '6px',
      padding: '4px 0', cursor: 'pointer',
      borderBottom: '1px solid #222',
    });

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'dev-face-mode';
    radio.value = value;
    radio.checked = (value === initial);
    radio.dataset.role = `face-mode-radio-${value}`;
    Object.assign(radio.style, { marginTop: '2px', cursor: 'pointer' });
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      applyFaceModeChoice(value, getPlayer);
      refreshBadge();
    });
    row.appendChild(radio);

    const labelStack = document.createElement('div');
    Object.assign(labelStack.style, { display: 'flex', flexDirection: 'column' });
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    Object.assign(labelEl.style, { fontSize: '12px', color: '#ddd' });
    labelStack.appendChild(labelEl);
    const hintEl = document.createElement('span');
    hintEl.textContent = rowHint;
    Object.assign(hintEl.style, { fontSize: '10px', color: '#666' });
    labelStack.appendChild(hintEl);
    row.appendChild(labelStack);

    details.appendChild(row);
  }

  return details;
}
