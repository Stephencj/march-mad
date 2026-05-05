/* eslint-disable no-console */
// =============================================================================
// Snapshot scene: "player"
//   Page: /player-editor.html — full body rig with optional face applied.
//   Designed for body-tuning / face-vs-cranium / hand close-up workflows.
// =============================================================================
const PI = Math.PI;

// Helper: a single capture spec with sensible defaults.
const cap = (name, extra) => ({ name, ...extra });

const presets = {
  'idle-front': cap('idle-front', {
    animState: 'idle', freezeAnim: true, stepFrames: 0,
    camera: { yaw: 0, pitch: 0.05, dist: 4, target: 'torso' },
  }),
  'idle-3q': cap('idle-3q', {
    animState: 'idle', freezeAnim: true, stepFrames: 0,
    camera: { yaw: -PI / 4, pitch: 0.05, dist: 4, target: 'torso' },
  }),
  'holding-beer-3q': cap('holding-beer-3q', {
    animState: 'idle', beer: true,
    camera: { yaw: -PI / 4, pitch: 0.05, dist: 2.6, target: 'torso' },
  }),
  'holding-beer-hand-closeup': cap('holding-beer-hand-closeup', {
    animState: 'idle', beer: true,
    camera: { yaw: -PI / 4, pitch: 0, dist: 0.6, target: 'hand-left' },
  }),
  'walk-front': cap('walk-front', {
    animState: 'walk',
    camera: { yaw: 0, pitch: 0.05, dist: 4, target: 'torso' },
  }),
  'dribble-3q': cap('dribble-3q', {
    animState: 'dribble',
    camera: { yaw: -PI / 4, pitch: 0.05, dist: 3.5, target: 'torso' },
  }),
  'head-closeup': cap('head-closeup', {
    animState: 'idle', freezeAnim: true,
    camera: { yaw: 0, pitch: 0, dist: 1.0, target: 'head' },
  }),
  'head-medium': cap('head-medium', {
    animState: 'idle', freezeAnim: true,
    camera: { yaw: 0, pitch: 0, dist: 1.6, target: 'head' },
  }),
  'head-medium-3q': cap('head-medium-3q', {
    animState: 'idle', freezeAnim: true,
    camera: { yaw: -PI / 4, pitch: 0, dist: 1.6, target: 'head' },
  }),
  // UV-cranium pivot — matches the face-mirror.html OrbitControls
  // default camera (yaw≈0.15, pitch≈0.05, dist≈1.4) so visual
  // artifacts the user sees in the actual game surface in CI snapshots
  // too. Adding this preset means future iterations catch the dual-
  // oval / cranium-vs-plate seam class of bug that the prior yaw=0,
  // dist=4 framing was hiding.
  'face-mirror-pose': cap('face-mirror-pose', {
    animState: 'idle', freezeAnim: true,
    camera: { yaw: 0.15, pitch: 0.05, dist: 1.4, target: 'head' },
  }),
  // G4 — beer-can in hand, close-up for orientation inspection. The beer
  // is mounted as a child of `elbow-left`, so target the left hand and
  // dolly in close. yaw -π/4 puts the beer at 3/4 view; yaw 0 frames it
  // straight-on (so a "lying down" can shows as a horizontal cylinder).
  'beer-hand-3q': cap('beer-hand-3q', {
    animState: 'idle', freezeAnim: true, beer: true,
    camera: { yaw: -PI / 4, pitch: -0.1, dist: 0.9, target: 'hand-left' },
  }),
  'beer-hand-front': cap('beer-hand-front', {
    animState: 'idle', freezeAnim: true, beer: true,
    camera: { yaw: 0, pitch: -0.1, dist: 0.9, target: 'hand-left' },
  }),
  // Multi-shot: face vs. cranium. Two head-closeups — 3q + profile — to see
  // how the face plane fits the head sphere from different angles. Distance
  // tuned so the head fills ~70% of frame: head radius ≈ 0.15m + face plane
  // protrudes ~0.05m, so we need ≥1.0m to keep the whole head in frame at
  // FOV 50°.
  'face-vs-cranium': [
    cap('face-vs-cranium-3q', {
      animState: 'idle', freezeAnim: true,
      camera: { yaw: -PI / 4, pitch: 0, dist: 1.0, target: 'head' },
    }),
    cap('face-vs-cranium-profile', {
      animState: 'idle', freezeAnim: true,
      camera: { yaw: -PI / 2, pitch: 0, dist: 1.0, target: 'head' },
    }),
  ],
};

// `all` runs every single-shot preset in order.
presets.all = [
  presets['idle-front'],
  presets['idle-3q'],
  presets['holding-beer-3q'],
  presets['holding-beer-hand-closeup'],
  presets['walk-front'],
  presets['dribble-3q'],
  presets['head-closeup'],
  presets['face-mirror-pose'],
  ...presets['face-vs-cranium'],
];

module.exports = {
  name: 'player',
  page: '/player-editor.html',
  // Player scene optionally takes a face — the CLI passes one if --face is
  // supplied, but the scene works without when the user wants to inspect
  // the procedural defaults. We mark it false so the CLI doesn't error
  // when --face is omitted; the scene still calls setFace when faceObj is
  // present.
  needsFace: false,
  presets,
};
