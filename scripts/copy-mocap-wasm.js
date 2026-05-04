// Vendors the MediaPipe Tasks-Vision wasm bundle from node_modules into
// public/mocap-wasm/ so the runtime can load it same-origin (dev, preview,
// build, Electron file://). Run from `predev` and `prebuild` so the vendored
// files automatically track whatever version `npm install` resolved.
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(
  __dirname,
  '..',
  'node_modules',
  '@mediapipe',
  'tasks-vision',
  'wasm',
);
const DEST = path.resolve(__dirname, '..', 'public', 'mocap-wasm');

const FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

if (!fs.existsSync(SRC)) {
  console.error(`[copy-mocap-wasm] ${SRC} missing — run \`npm install\` first.`);
  process.exit(1);
}
fs.mkdirSync(DEST, { recursive: true });
for (const f of FILES) {
  fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
}
console.log(`[copy-mocap-wasm] copied ${FILES.length} files → ${path.relative(process.cwd(), DEST)}`);
