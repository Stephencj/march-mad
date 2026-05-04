/* eslint-disable no-console */
// =============================================================================
// Snapshot scene: "face"
//   Page: /anim-viewer.html with a FaceImage applied to the rig.
//   Equivalent to verify-face-render.cjs (5 camera angles + 6 blendshape sets).
// =============================================================================
const PI = Math.PI;
const CAM_DIST = 2.4;
const CAM_PITCH = 0.05;

const camAngle = (yaw) => ({ camera: { yaw, pitch: CAM_PITCH, dist: CAM_DIST, target: 'head' } });

// 5 camera-angle captures, no blendshape pokes.
const CAMERA_PRESETS = {
  front:         camAngle(0),
  '3q-left':     camAngle(-PI / 4),
  '3q-right':    camAngle(PI / 4),
  'profile-left':  camAngle(-PI / 2),
  'profile-right': camAngle(PI / 2),
};

// 6 blendshape captures, all from the front view.
const BLENDSHAPE_PRESETS = {
  rest:        { ...camAngle(0), blendshapes: {} },
  'jaw-open':  { ...camAngle(0), blendshapes: { jawOpen: 1.0 } },
  smile:       { ...camAngle(0), blendshapes: { mouthSmileLeft: 1.0, mouthSmileRight: 1.0 } },
  blink:       { ...camAngle(0), blendshapes: { eyeBlinkLeft: 1.0, eyeBlinkRight: 1.0 } },
  'brow-up':   { ...camAngle(0), blendshapes: { browInnerUp: 1.0 } },
  pucker:      { ...camAngle(0), blendshapes: { mouthPucker: 1.0 } },
};

// Tag each preset with its `name` so the captures get sensible filenames.
function namedPresets(prefix, src) {
  const out = {};
  for (const k of Object.keys(src)) {
    out[k] = { name: `${prefix}${k}`, ...src[k] };
  }
  return out;
}

const cams = namedPresets('cam-', CAMERA_PRESETS);
const bss = namedPresets('bs-', BLENDSHAPE_PRESETS);

module.exports = {
  name: 'face',
  page: '/anim-viewer.html',
  needsFace: true,
  presets: {
    ...cams,
    ...bss,
    // Convenience aliases (no `cam-` / `bs-` prefix).
    front: cams.front,
    '3q-left': cams['3q-left'],
    '3q-right': cams['3q-right'],
    'profile-left': cams['profile-left'],
    'profile-right': cams['profile-right'],
    'jaw-open': bss['jaw-open'],
    smile: bss.smile,
    blink: bss.blink,
    // The original 11-shot matrix, in the same order as verify-face-render.cjs.
    all: [
      cams.front,
      cams['3q-left'],
      cams['3q-right'],
      cams['profile-left'],
      cams['profile-right'],
      bss.rest,
      bss['jaw-open'],
      bss.smile,
      bss.blink,
      bss['brow-up'],
      bss.pucker,
    ],
  },
};
