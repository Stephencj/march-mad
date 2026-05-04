/**
 * Phase H4 — Mii face keyframe mixer (K1 phase per the design plan).
 *
 * The mixer is a small state machine sitting between the various face
 * "drivers" (idle blink scheduler, MediaPipe live puppet, game-state
 * triggers, scripted/recorded clips) and the renderable per-track
 * keyframe state. It implements `BlendshapeSource` so existing
 * `ProceduralFace` teeth/tongue gating keeps reading the SAME contract
 * it already does — the puppet path migrates to the mixer transparently.
 *
 * --- Driver priority stack ---
 *
 * Each track stores a stack of "claims" keyed by driver priority:
 *
 *     idle-blink (0) < game-state (1) < scripted (2) < live-puppet (3)
 *
 * When several drivers want the same track, the highest-priority claim
 * wins. Releasing a higher driver pops back to the next lower active
 * claim. With no claims active, the track decays to `'rest'` over the
 * track's default duration.
 *
 * Mid-transition reseed: when a `setTrack` happens while the track is
 * already cross-fading from `from -> to (t)`, we reseed the new
 * transition's `from` to a synthetic name `<from>@<t>` AND record the
 * blend pair so the BlendshapeSource adapter can compute the current
 * visually-rendered output. This avoids a hard snap.
 *
 * --- Idle-blink scheduler ---
 *
 * On construction, sample a random next-blink time in [3000ms, 6000ms].
 * Each `tick(dtMs)` accumulates wall-time; when due, fire `blink-full`
 * at priority `idle-blink` on both eyes for 80ms in, hold 60ms, then
 * release back to whatever lower (i.e. 'rest') driver was active. The
 * scheduler is lazy — no setTimeout, just dt-driven counters — so the
 * mixer is unit-testable with `vi.useFakeTimers()` simply by stepping
 * `tick(dtMs)` manually.
 *
 * --- BlendshapeSource adapter ---
 *
 * H4 only needs the mapping for ProceduralFace's currently-existing
 * gating (`jawOpen` for teeth/tongue) plus a few tracks that future
 * phases will read. The mapping is intentionally narrow:
 *
 *   mouth.to='open-wide'   -> jawOpen = t
 *   mouth.to='open-small'  -> jawOpen = t * 0.5
 *   eye-L.to='blink-full'  -> eyeBlinkLeft = t
 *   eye-R.to='blink-full'  -> eyeBlinkRight = t
 *   brow-L.to='up'         -> browInnerUp = t   (max with brow-R)
 *   brow-R.to='up'         -> browInnerUp = t   (max with brow-L)
 *   anything else          -> 0
 *
 * (When mid-transition we use the t toward the target keyframe; if the
 * target is *not* the listed keyframe, the contribution is 0 — the
 * adapter outputs 0 as the track resolves away from a relevant pose.)
 *
 * --- Special-case durations ---
 *
 * `decal-overlay` going TO `'none'` uses 400ms (fade-out); all other
 * decal transitions use 200ms (fade-in). This asymmetry is the only
 * track-specific override applied automatically when the caller doesn't
 * supply an explicit `durationMs`.
 */
import type { BlendshapeSource } from './procedural-face';

export type FeatureTrack =
  | 'eye-L' | 'eye-R'
  | 'brow-L' | 'brow-R'
  | 'mouth' | 'cheek'
  | 'decal-overlay';

export type KeyframeName = string;

export type DriverPriority =
  | 'idle-blink'
  | 'game-state'
  | 'scripted'
  | 'live-puppet';

export interface TrackState {
  from: KeyframeName;
  to: KeyframeName;
  /** 0..1 — interpolation progress from `from` to `to`. */
  t: number;
  startedAt: number;
  durationMs: number;
  easing: 'linear' | 'easeOut' | 'easeInOut';
}

export interface FaceKeyframeMixer extends BlendshapeSource {
  setTrack(track: FeatureTrack, kf: KeyframeName, opts: {
    priority: DriverPriority;
    durationMs?: number;
    easing?: TrackState['easing'];
  }): void;
  setComposite(name: KeyframeName, opts: {
    priority: DriverPriority;
    durationMs?: number;
  }): void;
  releaseDriver(priority: DriverPriority, track?: FeatureTrack): void;
  tick(dtMs: number): ReadonlyMap<FeatureTrack, TrackState>;
  /** Stop the idle-blink driver (e.g. during a recorded-clip replay). */
  pauseIdleBlink(): void;
  resumeIdleBlink(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Composite recipes — pre-canned multi-track keyframe sets per the design
// plan (Section 1).
// ---------------------------------------------------------------------------

export const COMPOSITES: Record<KeyframeName, Partial<Record<FeatureTrack, KeyframeName>>> = {
  rest: {
    'eye-L': 'rest', 'eye-R': 'rest',
    'brow-L': 'rest', 'brow-R': 'rest',
    mouth: 'rest', cheek: 'rest',
    'decal-overlay': 'none',
  },
  angry: {
    'eye-L': 'squint', 'eye-R': 'squint',
    'brow-L': 'furrowed', 'brow-R': 'furrowed',
    mouth: 'gritted-teeth',
    'decal-overlay': 'vein-forehead',
  },
  surprised: {
    'eye-L': 'wide', 'eye-R': 'wide',
    'brow-L': 'up', 'brow-R': 'up',
    mouth: 'open-small',
    'decal-overlay': 'none',
  },
  joy: {
    'eye-L': 'blink-half', 'eye-R': 'blink-half',
    'brow-L': 'raised-outer', 'brow-R': 'raised-outer',
    mouth: 'smile-big',
    cheek: 'squinted-L',
    'decal-overlay': 'sweat-drop',
  },
  pain: {
    'eye-L': 'blink-full', 'eye-R': 'blink-full',
    'brow-L': 'furrowed', 'brow-R': 'furrowed',
    mouth: 'gritted-teeth',
    'decal-overlay': 'pain-stars',
  },
  confused: {
    'brow-L': 'up', 'brow-R': 'down',
    mouth: 'smile-small',
  },
  concentrating: {
    'eye-L': 'squint', 'eye-R': 'squint',
    'brow-L': 'down', 'brow-R': 'down',
    mouth: 'rest',
  },
  'wink-left': {
    'eye-L': 'blink-full', 'eye-R': 'rest',
    mouth: 'smile-small',
  },
  'wink-right': {
    'eye-L': 'rest', 'eye-R': 'blink-full',
    mouth: 'smile-small',
  },
  squished: {
    'eye-L': 'squint', 'eye-R': 'squint',
    mouth: 'pucker',
  },
};

// ---------------------------------------------------------------------------
// Default per-track durations (Section 3 of the design plan).
// ---------------------------------------------------------------------------

export const DEFAULT_DURATIONS: Record<FeatureTrack, number> = {
  'eye-L': 80,
  'eye-R': 80,
  'brow-L': 180,
  'brow-R': 180,
  mouth: 220,
  cheek: 220,
  'decal-overlay': 200,
};

/** Decal-overlay fade-OUT (going TO 'none') uses a longer duration to
 *  let veins / stars / sweat linger as they leave. Per the design plan
 *  Section 3 — the only asymmetric default we apply automatically. */
const DECAL_FADE_OUT_MS = 400;

const DRIVER_LEVEL: Record<DriverPriority, number> = {
  'idle-blink': 0,
  'game-state': 1,
  scripted: 2,
  'live-puppet': 3,
};

export const ALL_TRACKS: readonly FeatureTrack[] = [
  'eye-L', 'eye-R',
  'brow-L', 'brow-R',
  'mouth', 'cheek',
  'decal-overlay',
] as const;

const PRIORITIES_LOW_TO_HIGH: DriverPriority[] = [
  'idle-blink',
  'game-state',
  'scripted',
  'live-puppet',
];

// ---------------------------------------------------------------------------
// Idle-blink scheduler timing
// ---------------------------------------------------------------------------

const IDLE_BLINK_MIN_MS = 3000;
const IDLE_BLINK_MAX_MS = 6000;
/** Time the eyelids stay closed (after the close transition completes)
 *  before reopening. The full close+hold+open cycle is ~80+60+80 = 220ms. */
const IDLE_BLINK_HOLD_MS = 60;
const IDLE_BLINK_DURATION_MS = 80;

interface Claim {
  kf: KeyframeName;
  /** durationMs at the moment the claim was set; used when this claim
   *  is *restored* after a higher-priority release. The restore re-tweens
   *  with the original duration so a popped-back-to claim doesn't snap. */
  durationMs: number;
  easing: TrackState['easing'];
}

interface BlinkPhase {
  /** 'closing' = eyes going from rest -> blink-full. 'holding' = closed,
   *  about to reopen. 'opening' = lifted the claim, eyes returning to
   *  whatever lower driver was active. 'idle' = no blink in progress. */
  phase: 'idle' | 'closing' | 'holding';
  /** Time until next phase transition (closing -> holding -> idle/release). */
  remainingMs: number;
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function applyEasing(t: number, easing: TrackState['easing']): number {
  if (easing === 'linear') return t;
  if (easing === 'easeOut') return easeOutCubic(t);
  return easeInOutCubic(t);
}

/** What keyframe is "idle / unclaimed" for a given track. Almost always
 *  `'rest'`; decal-overlay uses `'none'`. */
function restKeyframe(track: FeatureTrack): KeyframeName {
  return track === 'decal-overlay' ? 'none' : 'rest';
}

export function createFaceKeyframeMixer(): FaceKeyframeMixer {
  // Per-track claim stacks. Each track maps each priority to (optional)
  // current claim. `null`/missing = that driver isn't claiming this track.
  const claims = new Map<FeatureTrack, Map<DriverPriority, Claim>>();
  for (const t of ALL_TRACKS) claims.set(t, new Map());

  // Per-track resolved transition state. Updated when claims change OR a
  // tick advances time. Initial state: at rest, t=1 (already arrived).
  const states = new Map<FeatureTrack, TrackState>();
  for (const t of ALL_TRACKS) {
    const rest = restKeyframe(t);
    states.set(t, {
      from: rest,
      to: rest,
      t: 1,
      startedAt: 0,
      durationMs: DEFAULT_DURATIONS[t],
      easing: 'easeOut',
    });
  }

  // Wall-clock counter (ms since mixer construction). Advanced via
  // `tick(dtMs)`. We deliberately do NOT use `performance.now()` so
  // tests can deterministically step the mixer by passing fixed dts.
  let now = 0;

  // Idle-blink scheduler.
  let idleBlinkPaused = false;
  let nextBlinkAt = sampleNextBlinkTime(0);
  const blinkPhase: BlinkPhase = { phase: 'idle', remainingMs: 0 };

  let disposed = false;

  function sampleNextBlinkTime(from: number): number {
    const range = IDLE_BLINK_MAX_MS - IDLE_BLINK_MIN_MS;
    return from + IDLE_BLINK_MIN_MS + Math.random() * range;
  }

  /** Resolve which claim (if any) currently controls the track. Returns
   *  null when no driver is active — caller falls back to `restKeyframe`. */
  function topClaim(track: FeatureTrack): { priority: DriverPriority; claim: Claim } | null {
    const stack = claims.get(track)!;
    for (let i = PRIORITIES_LOW_TO_HIGH.length - 1; i >= 0; i--) {
      const p = PRIORITIES_LOW_TO_HIGH[i];
      const c = stack.get(p);
      if (c) return { priority: p, claim: c };
    }
    return null;
  }

  /** Advance the per-track transition's `t` for an elapsed dt without
   *  changing `to`/`from`. Called every tick. */
  function advanceTrackTime(track: FeatureTrack): void {
    const s = states.get(track)!;
    if (s.t >= 1) return; // already arrived — nothing to advance.
    if (s.durationMs <= 0) {
      s.t = 1;
      return;
    }
    const elapsed = now - s.startedAt;
    s.t = Math.min(1, Math.max(0, elapsed / s.durationMs));
  }

  /** Set or update a track's target keyframe, reseeding `from` to the
   *  current visually-rendered blend (so we don't snap mid-transition).
   *  When `to === current to` and t < 1, this is a no-op (don't restart
   *  an in-progress tween toward the same destination). */
  function startTransition(
    track: FeatureTrack,
    toKf: KeyframeName,
    durationMs: number,
    easing: TrackState['easing'],
  ): void {
    advanceTrackTime(track);
    const s = states.get(track)!;
    // If we're already heading to the same keyframe, leave the in-flight
    // tween alone. Avoids restarting an animation when two equal claims
    // arrive in rapid succession.
    if (s.to === toKf && s.t < 1) {
      return;
    }
    if (s.to === toKf && s.t >= 1) {
      // Already there. Nothing to do.
      return;
    }
    // Reseed `from` so the new tween starts at the visually-rendered
    // pose. We synthesize a name `<oldFrom>@<oldTo>:<t>` so a later
    // BlendshapeSource read can detect a mid-transition and weight
    // both endpoints. The encoded form is parsed by `decodeFrom`.
    const reseededFrom = s.t >= 1
      ? s.to
      : encodeMidFrom(s.from, s.to, s.t, s.easing);
    s.from = reseededFrom;
    s.to = toKf;
    s.t = 0;
    s.startedAt = now;
    s.durationMs = durationMs;
    s.easing = easing;
  }

  // The encoded "from" string carries enough information for the
  // BlendshapeSource adapter to compute what the current rendered
  // contribution is when reseeded mid-transition. Format:
  //   '__mid__|<from>|<to>|<eased_t>'
  // `eased_t` is the eased blend (0..1) that the *previous* transition
  // had reached at reseed time. This is what the renderer was actually
  // showing the moment the new claim arrived.
  function encodeMidFrom(
    fromKf: KeyframeName,
    toKf: KeyframeName,
    t: number,
    easing: TrackState['easing'],
  ): string {
    const easedT = applyEasing(t, easing);
    return `__mid__|${fromKf}|${toKf}|${easedT.toFixed(4)}`;
  }

  function decodeMidFrom(s: string): { from: KeyframeName; to: KeyframeName; t: number } | null {
    if (!s.startsWith('__mid__|')) return null;
    const parts = s.split('|');
    if (parts.length !== 4) return null;
    return {
      from: parts[1],
      to: parts[2],
      t: parseFloat(parts[3]),
    };
  }

  /** Re-resolve a track's transition target after the claim stack changed
   *  (a new setTrack arrived OR a higher-priority claim was released). */
  function resolveTrack(track: FeatureTrack): void {
    const top = topClaim(track);
    const targetKf = top ? top.claim.kf : restKeyframe(track);
    const s = states.get(track)!;
    // If the target hasn't actually changed, nothing to do — the
    // existing transition (or settled state) is still correct.
    if (s.to === targetKf && (s.t < 1 || s.from === targetKf)) {
      return;
    }
    // Pick a duration: prefer the claim's stored durationMs (authoritative
    // for both the original setTrack AND a release-restore). Apply the
    // decal-overlay fade-out asymmetry only when the *resolved* target
    // is 'none' AND the claim didn't request an explicit duration.
    let duration: number;
    let easing: TrackState['easing'];
    if (top) {
      duration = top.claim.durationMs;
      easing = top.claim.easing;
    } else {
      // Falling back to rest. Default duration; decal-overlay fade-out
      // gets the asymmetric long duration.
      duration = track === 'decal-overlay' ? DECAL_FADE_OUT_MS : DEFAULT_DURATIONS[track];
      easing = 'easeOut';
    }
    startTransition(track, targetKf, duration, easing);
  }

  function setTrackInternal(
    track: FeatureTrack,
    kf: KeyframeName,
    priority: DriverPriority,
    durationMs: number | undefined,
    easing: TrackState['easing'] | undefined,
  ): void {
    if (disposed) return;
    // Resolve the duration. For decal-overlay, when the caller didn't
    // pass an explicit durationMs and the target is 'none', use the
    // longer fade-out; otherwise use the per-track default.
    let resolvedDuration: number;
    if (durationMs !== undefined) {
      resolvedDuration = durationMs;
    } else if (track === 'decal-overlay' && kf === 'none') {
      resolvedDuration = DECAL_FADE_OUT_MS;
    } else {
      resolvedDuration = DEFAULT_DURATIONS[track];
    }
    const resolvedEasing: TrackState['easing'] = easing ?? 'easeOut';

    const stack = claims.get(track)!;
    const existing = stack.get(priority);
    // No-op fast path: setting the same priority+kf with the same params
    // shouldn't restart the tween.
    if (existing && existing.kf === kf
      && existing.durationMs === resolvedDuration
      && existing.easing === resolvedEasing) {
      // Still have to call resolveTrack in case a higher-priority release
      // happened earlier and left this driver visible — but the resolve
      // will be a no-op because target hasn't changed.
      resolveTrack(track);
      return;
    }
    stack.set(priority, { kf, durationMs: resolvedDuration, easing: resolvedEasing });
    // Only re-resolve if THIS driver is now the top claim. If a higher
    // driver is active, the visible state doesn't change, but the claim
    // is still recorded so a future release pops back to this kf.
    const top = topClaim(track);
    if (top && top.priority === priority) {
      resolveTrack(track);
    }
  }

  // -------------------------------------------------------------------------
  // Idle-blink scheduler
  // -------------------------------------------------------------------------
  function tickIdleBlink(): void {
    if (idleBlinkPaused) return;
    if (blinkPhase.phase === 'idle') {
      if (now >= nextBlinkAt) {
        // Fire blink-full on both eyes synchronously.
        blinkPhase.phase = 'closing';
        blinkPhase.remainingMs = IDLE_BLINK_DURATION_MS;
        setTrackInternal('eye-L', 'blink-full', 'idle-blink', IDLE_BLINK_DURATION_MS, 'easeOut');
        setTrackInternal('eye-R', 'blink-full', 'idle-blink', IDLE_BLINK_DURATION_MS, 'easeOut');
      }
      return;
    }
    if (blinkPhase.phase === 'closing') {
      // Wait for the close transition to finish, then hold for HOLD_MS,
      // then release the claim (re-opens via resolveTrack -> rest).
      const sL = states.get('eye-L')!;
      if (sL.t >= 1) {
        blinkPhase.phase = 'holding';
        blinkPhase.remainingMs = IDLE_BLINK_HOLD_MS;
      }
      return;
    }
    if (blinkPhase.phase === 'holding') {
      blinkPhase.remainingMs -= lastDtMs;
      if (blinkPhase.remainingMs <= 0) {
        // Release the idle-blink claim — eyes drift back to rest (or
        // whatever lower driver was active, which there isn't one
        // lower than idle-blink, so falls to 'rest').
        releaseDriverInternal('idle-blink', 'eye-L');
        releaseDriverInternal('idle-blink', 'eye-R');
        blinkPhase.phase = 'idle';
        nextBlinkAt = sampleNextBlinkTime(now);
      }
    }
  }

  let lastDtMs = 0;

  function releaseDriverInternal(priority: DriverPriority, track?: FeatureTrack): void {
    if (disposed) return;
    const tracks = track ? [track] : ALL_TRACKS;
    for (const t of tracks) {
      const stack = claims.get(t);
      if (!stack) continue;
      const wasTop = topClaim(t)?.priority === priority;
      if (stack.delete(priority) && wasTop) {
        resolveTrack(t);
      }
    }
  }

  return {
    setTrack(track, kf, opts) {
      setTrackInternal(track, kf, opts.priority, opts.durationMs, opts.easing);
    },

    setComposite(name, opts) {
      const recipe = COMPOSITES[name];
      if (!recipe) {
        // Unknown composite — silently ignore (matches "set rest" behavior
        // when an authoring layer mistakes a name). We don't throw because
        // composites are user-authored config and a typo shouldn't crash
        // the game loop.
        return;
      }
      for (const k of Object.keys(recipe) as FeatureTrack[]) {
        const kf = recipe[k];
        if (kf === undefined) continue;
        setTrackInternal(k, kf, opts.priority, opts.durationMs, undefined);
      }
    },

    releaseDriver(priority, track) {
      releaseDriverInternal(priority, track);
    },

    tick(dtMs) {
      if (disposed) return states;
      lastDtMs = dtMs;
      now += dtMs;
      // Advance idle-blink scheduler first — it may flip claims, which
      // resolveTrack will then advance correctly.
      tickIdleBlink();
      // Advance every track's `t` based on elapsed wall-time.
      for (const t of ALL_TRACKS) advanceTrackTime(t);
      return states;
    },

    pauseIdleBlink() {
      idleBlinkPaused = true;
      // If a blink is in progress, release it so eyes don't lock closed.
      if (blinkPhase.phase !== 'idle') {
        releaseDriverInternal('idle-blink', 'eye-L');
        releaseDriverInternal('idle-blink', 'eye-R');
        blinkPhase.phase = 'idle';
      }
    },

    resumeIdleBlink() {
      if (!idleBlinkPaused) return;
      idleBlinkPaused = false;
      nextBlinkAt = sampleNextBlinkTime(now);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      claims.clear();
      states.clear();
      blinkPhase.phase = 'idle';
    },

    /**
     * Translate the resolved per-track keyframe state into ARKit-name
     * scalars the procedural face can consume. Mapping is intentionally
     * minimal — H4 only needs to keep teeth/tongue gating working — but
     * is the right hook for H5 / H6 to extend.
     */
    getSmoothedValue(name: string): number {
      if (disposed) return 0;
      // Per-track contribution: when the track's transition is heading
      // INTO the relevant keyframe, contribution = eased(t). When heading
      // AWAY (from = relevant kf, to = something else), contribution =
      // 1 - eased(t). Mid-transition reseed encodes both endpoints in
      // `from`, so we add their weighted contributions too.
      const resolveContribution = (
        track: FeatureTrack,
        relevantKf: KeyframeName,
      ): number => {
        const s = states.get(track);
        if (!s) return 0;
        const easedT = applyEasing(s.t, s.easing);
        let contribution = 0;
        // Contribution from the current `to`: eased t when `to ===
        // relevantKf`.
        if (s.to === relevantKf) {
          contribution += easedT;
        }
        // Contribution from `from`. Plain `from === relevantKf` means
        // we're heading away from it — contribution = (1 - easedT).
        if (s.from === relevantKf) {
          contribution += 1 - easedT;
        }
        // Mid-transition reseed: `from` encodes a previous transition's
        // (oldFrom, oldTo, oldEasedT). The renderer is showing
        //   blend(oldFrom, oldTo, oldEasedT)
        // weighted by (1 - easedT). Add that previous blend's
        // contribution from each endpoint.
        const decoded = decodeMidFrom(s.from);
        if (decoded) {
          // The contribution from `from` has already been counted above
          // as 0 (because s.from is the encoded string, NOT relevantKf).
          // Re-add the decoded blend's true contributions.
          const fromW = (1 - easedT) * (1 - decoded.t);
          const toW = (1 - easedT) * decoded.t;
          if (decoded.from === relevantKf) contribution += fromW;
          if (decoded.to === relevantKf) contribution += toW;
        }
        return Math.max(0, Math.min(1, contribution));
      };

      switch (name) {
        case 'jawOpen': {
          // mouth track: open-wide -> 1.0× t, open-small -> 0.5× t.
          const wide = resolveContribution('mouth', 'open-wide');
          const small = resolveContribution('mouth', 'open-small') * 0.5;
          // Mouth can only be in one keyframe at a time, but during a
          // crossfade between e.g. open-small and open-wide, both
          // contribute and we want the larger one to dominate (a
          // smooth ramp from 0.5*t to 1.0). Sum is bounded above by 1.5
          // which is a safer upper bound than max() during a crossfade
          // because it preserves the integral of the area under both.
          // Clamp to [0,1] to keep ProceduralFace's gating well-defined.
          return Math.min(1, wide + small);
        }
        case 'eyeBlinkLeft':
          return resolveContribution('eye-L', 'blink-full');
        case 'eyeBlinkRight':
          return resolveContribution('eye-R', 'blink-full');
        case 'browInnerUp': {
          // Either brow up contributes; take the max so a single-brow
          // raise (confused composite) doesn't read as half-strength.
          const l = resolveContribution('brow-L', 'up');
          const r = resolveContribution('brow-R', 'up');
          return Math.max(l, r);
        }
        default:
          return 0;
      }
    },
  };
}
