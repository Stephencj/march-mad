/**
 * Persist open/closed state for `<details>` elements across the dev overlay
 * and the three standalone editor pages (anim-viewer, player-editor,
 * level-editor).
 *
 * Keys are namespaced with a prefix ('devui:' for the F1 overlay, 'devpanel:'
 * for editor pages) plus a path that encodes the section hierarchy —
 * e.g. `devui:ANIMATION:Poses:dunk` or `devpanel:anim-viewer:Durations`.
 *
 * If `sessionStorage` is unavailable (SSR, private browsing with storage
 * disabled), the helpers degrade silently and leave the author default.
 */

function storage(): Storage | null {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {
    /* access denied */
  }
  return null;
}

/**
 * Wire a `<details>` element to `sessionStorage` under `key`.
 *
 * - On first call, if a stored value exists it overrides the author default
 *   (`"open"` → set open attr; `"closed"` → remove open attr).
 * - Installs a `toggle` listener that writes the new state back on every
 *   user interaction.
 */
export function persistDetails(details: HTMLDetailsElement, key: string): void {
  const s = storage();
  if (s) {
    try {
      const stored = s.getItem(key);
      if (stored === 'open') details.open = true;
      else if (stored === 'closed') details.open = false;
    } catch {
      /* storage read failed — keep author default */
    }
  }
  details.addEventListener('toggle', () => {
    const s2 = storage();
    if (!s2) return;
    try {
      s2.setItem(key, details.open ? 'open' : 'closed');
    } catch {
      /* storage write failed — ignore */
    }
  });
}

/** Build a colon-joined key from a prefix and path segments. */
export function detailsKey(prefix: string, ...path: string[]): string {
  return prefix + ':' + path.join(':');
}
