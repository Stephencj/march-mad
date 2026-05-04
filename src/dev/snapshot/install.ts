// =============================================================================
// installSnapshotAPI — small helper that mounts `window.__snapshot` and logs
// a banner so the CLI driver (scripts/snapshot.cjs) can detect readiness via
// page.waitForFunction(() => !!window.__snapshot).
//
// Intentionally tiny + idempotent: re-installing on hot-reload is safe.
// =============================================================================
import type { SnapshotAPI } from './types';

const BANNER_PREFIX = '[snapshot-api]';

export function installSnapshotAPI(api: SnapshotAPI): void {
  // Idempotent: if a previous install is hanging around (HMR), replace it.
  (window as unknown as { __snapshot: SnapshotAPI }).__snapshot = api;
  // Single-line, identifiable banner — the CLI greps for the prefix only when
  // diagnosing a hang; readiness itself uses waitForFunction.
  // eslint-disable-next-line no-console
  console.log(
    `${BANNER_PREFIX} installed scene="${api.scene}" caps=${JSON.stringify(api.capabilities)}`,
  );
}
