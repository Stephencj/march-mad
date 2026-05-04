#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// One-shot decal PNG builder (Phase H3).
//
// Draws six 256x256 transparent-background PNGs into public/face-decals/ via
// puppeteer Canvas2D. Run once after authoring tweaks here, then commit the
// PNGs. Re-run only when the design needs an update.
//
// Usage:  node scripts/build-face-decals.cjs
//
// Output: public/face-decals/{vein,anger-cross,sweat-drop,blush,
//                              pain-stars,crease-cheek}.png
//
// We intentionally use Canvas2D inside puppeteer (not node-canvas) because
// node-canvas requires a native build dep that's not in package.json, and
// the project already depends on puppeteer for the snapshot pipeline.
// =============================================================================
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const OUT_DIR = path.resolve(__dirname, '..', 'public', 'face-decals');
const SIZE = 256;

// Each decal is described by a name + a Canvas2D draw function (executed
// inside the puppeteer page). All functions receive (ctx, S) where S=SIZE.
const DECALS = [
  {
    file: 'vein.png',
    draw: function (ctx, S) {
      // Forehead vein: dark blue/grey Y-shape with branches. Soft alpha
      // edges via radial gradient stroke.
      ctx.clearRect(0, 0, S, S);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const cx = S * 0.5;
      // Main trunk
      ctx.strokeStyle = 'rgba(60, 70, 110, 0.62)';
      ctx.lineWidth = S * 0.045;
      ctx.beginPath();
      ctx.moveTo(cx, S * 0.18);
      ctx.bezierCurveTo(cx + S * 0.06, S * 0.35, cx - S * 0.04, S * 0.55, cx + S * 0.02, S * 0.78);
      ctx.stroke();
      // Left branch
      ctx.lineWidth = S * 0.030;
      ctx.beginPath();
      ctx.moveTo(cx + S * 0.005, S * 0.42);
      ctx.bezierCurveTo(cx - S * 0.10, S * 0.50, cx - S * 0.16, S * 0.62, cx - S * 0.20, S * 0.78);
      ctx.stroke();
      // Right branch
      ctx.beginPath();
      ctx.moveTo(cx + S * 0.02, S * 0.50);
      ctx.bezierCurveTo(cx + S * 0.13, S * 0.58, cx + S * 0.18, S * 0.66, cx + S * 0.22, S * 0.80);
      ctx.stroke();
      // Twig branches off the right branch
      ctx.lineWidth = S * 0.018;
      ctx.beginPath();
      ctx.moveTo(cx + S * 0.10, S * 0.56);
      ctx.bezierCurveTo(cx + S * 0.16, S * 0.55, cx + S * 0.21, S * 0.52, cx + S * 0.24, S * 0.46);
      ctx.stroke();
      // Soften with a radial alpha falloff: re-draw with a clipping
      // gradient mask (multiply pass).
      const grd = ctx.createRadialGradient(cx, S * 0.5, S * 0.05, cx, S * 0.5, S * 0.50);
      grd.addColorStop(0.0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.85, 'rgba(0,0,0,0)');
      grd.addColorStop(1.0, 'rgba(0,0,0,1)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, S, S);
      ctx.globalCompositeOperation = 'source-over';
    },
  },
  {
    file: 'anger-cross.png',
    draw: function (ctx, S) {
      // Anime-style 4-armed anger-X mark, bright red. Bright opaque
      // center, fades at the arm tips.
      ctx.clearRect(0, 0, S, S);
      const cx = S * 0.5;
      const cy = S * 0.5;
      const armLen = S * 0.34;
      const armW = S * 0.10;
      const drawArm = function (angleDeg) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((angleDeg * Math.PI) / 180);
        const grad = ctx.createLinearGradient(0, 0, armLen, 0);
        grad.addColorStop(0.0, 'rgba(220, 30, 35, 1.0)');
        grad.addColorStop(0.70, 'rgba(200, 25, 30, 0.95)');
        grad.addColorStop(1.0, 'rgba(180, 20, 25, 0.0)');
        ctx.fillStyle = grad;
        // Tapered arm: rectangle tapering to a point (trapezoid)
        ctx.beginPath();
        ctx.moveTo(0, -armW * 0.5);
        ctx.lineTo(armLen * 0.85, -armW * 0.18);
        ctx.lineTo(armLen, 0);
        ctx.lineTo(armLen * 0.85, armW * 0.18);
        ctx.lineTo(0, armW * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };
      // Four arms at 45/135/225/315 degrees (an X)
      drawArm(45);
      drawArm(135);
      drawArm(225);
      drawArm(315);
      // Bright opaque center disc
      const centerGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.10);
      centerGrd.addColorStop(0.0, 'rgba(240, 60, 60, 1.0)');
      centerGrd.addColorStop(1.0, 'rgba(200, 25, 30, 0.0)');
      ctx.fillStyle = centerGrd;
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.10, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    file: 'sweat-drop.png',
    draw: function (ctx, S) {
      // Classic anime sweat drop — teardrop shape, light blue/white,
      // dark outline. Drop apex at top, bulb at bottom.
      ctx.clearRect(0, 0, S, S);
      const cx = S * 0.5;
      // Teardrop path
      ctx.beginPath();
      ctx.moveTo(cx, S * 0.18);
      ctx.bezierCurveTo(cx + S * 0.20, S * 0.50, cx + S * 0.22, S * 0.78, cx, S * 0.82);
      ctx.bezierCurveTo(cx - S * 0.22, S * 0.78, cx - S * 0.20, S * 0.50, cx, S * 0.18);
      ctx.closePath();
      // Fill with light-blue radial gradient (highlight on upper-left)
      const grd = ctx.createRadialGradient(
        cx - S * 0.06,
        S * 0.55,
        S * 0.02,
        cx,
        S * 0.55,
        S * 0.30
      );
      grd.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)');
      grd.addColorStop(0.45, 'rgba(190, 220, 245, 0.85)');
      grd.addColorStop(1.0, 'rgba(120, 170, 220, 0.85)');
      ctx.fillStyle = grd;
      ctx.fill();
      // Dark outline
      ctx.strokeStyle = 'rgba(40, 60, 100, 0.9)';
      ctx.lineWidth = S * 0.018;
      ctx.stroke();
      // Tiny highlight spot
      ctx.beginPath();
      ctx.arc(cx - S * 0.08, S * 0.50, S * 0.025, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fill();
    },
  },
  {
    file: 'blush.png',
    draw: function (ctx, S) {
      // Soft pink circular gradient. Centered, fades to alpha at the
      // edges. We draw inside a clipped circle so the corners are
      // strictly transparent (PNG compresses constant-alpha regions
      // tightly, keeping the file under the 30 KB budget).
      ctx.clearRect(0, 0, S, S);
      const cx = S * 0.5;
      const cy = S * 0.5;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.46, 0, Math.PI * 2);
      ctx.clip();
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.46);
      grd.addColorStop(0.0, 'rgba(255, 130, 150, 0.78)');
      grd.addColorStop(0.55, 'rgba(255, 140, 160, 0.55)');
      grd.addColorStop(1.0, 'rgba(255, 150, 170, 0.0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, S, S);
      ctx.restore();
    },
  },
  {
    file: 'pain-stars.png',
    draw: function (ctx, S) {
      // 4 cartoon stars in a small cluster — yellow with white core,
      // dark outline. Sizes vary; positions form a loose cluster.
      ctx.clearRect(0, 0, S, S);
      const drawStar = function (cx, cy, outerR, innerR, color) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.beginPath();
        const points = 5;
        for (let i = 0; i < points * 2; i++) {
          const r = i % 2 === 0 ? outerR : innerR;
          const angle = (i * Math.PI) / points - Math.PI / 2;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(80, 50, 0, 0.85)';
        ctx.lineWidth = Math.max(2, outerR * 0.10);
        ctx.stroke();
        ctx.restore();
      };
      // Cluster: three larger stars at corners, one tiny in the middle.
      drawStar(S * 0.30, S * 0.28, S * 0.13, S * 0.055, 'rgba(255, 220, 70, 1)');
      drawStar(S * 0.72, S * 0.34, S * 0.10, S * 0.044, 'rgba(255, 235, 90, 1)');
      drawStar(S * 0.42, S * 0.72, S * 0.14, S * 0.060, 'rgba(255, 215, 60, 1)');
      drawStar(S * 0.72, S * 0.70, S * 0.07, S * 0.030, 'rgba(255, 245, 130, 1)');
    },
  },
  {
    file: 'crease-cheek.png',
    draw: function (ctx, S) {
      // Subtle dark grey curved wrinkle line. Low opacity, soft alpha
      // ends.
      ctx.clearRect(0, 0, S, S);
      ctx.lineCap = 'round';
      // Use a stroke with gradient alpha so the line fades at both ends.
      const grd = ctx.createLinearGradient(S * 0.10, 0, S * 0.90, 0);
      grd.addColorStop(0.0, 'rgba(50, 30, 25, 0.0)');
      grd.addColorStop(0.30, 'rgba(50, 30, 25, 0.50)');
      grd.addColorStop(0.70, 'rgba(50, 30, 25, 0.50)');
      grd.addColorStop(1.0, 'rgba(50, 30, 25, 0.0)');
      ctx.strokeStyle = grd;
      ctx.lineWidth = S * 0.016;
      ctx.beginPath();
      ctx.moveTo(S * 0.12, S * 0.40);
      ctx.bezierCurveTo(S * 0.35, S * 0.62, S * 0.65, S * 0.62, S * 0.88, S * 0.45);
      ctx.stroke();
      // Faint secondary line below for "crow's-feet" feel
      ctx.lineWidth = S * 0.012;
      ctx.beginPath();
      ctx.moveTo(S * 0.18, S * 0.55);
      ctx.bezierCurveTo(S * 0.40, S * 0.72, S * 0.62, S * 0.72, S * 0.82, S * 0.58);
      ctx.stroke();
    },
  },
];

(async function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
  console.log('Launching headless puppeteer for Canvas2D rendering...');
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    // Bare HTML with a single canvas element. We draw, toDataURL, and
    // return the buffer back to node.
    await page.setContent(
      '<html><body><canvas id="c" width="' +
        SIZE +
        '" height="' +
        SIZE +
        '"></canvas></body></html>'
    );
    for (const decal of DECALS) {
      // Stringify the draw function and evaluate it in the page context.
      const drawSrc = decal.draw.toString();
      const dataUrl = await page.evaluate(
        function (drawSrc, S) {
          const canvas = document.getElementById('c');
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, S, S);
          // eslint-disable-next-line no-new-func
          const fn = new Function('return (' + drawSrc + ')')();
          fn(ctx, S);
          return canvas.toDataURL('image/png');
        },
        drawSrc,
        SIZE
      );
      const base64 = dataUrl.split(',')[1];
      const rawBuf = Buffer.from(base64, 'base64');
      // Recompress through sharp w/ palette quantization. PNG-8 with an
      // adaptive palette + posterized alpha keeps soft gradients
      // recognizable while crushing the smooth-radial-gradient blush
      // from ~75 KB down to under the 30 KB budget. All decals are
      // simple flat shapes; 256-color is more than enough.
      const buf = await sharp(rawBuf)
        .png({
          palette: true,
          quality: 80,
          compressionLevel: 9,
          effort: 10,
        })
        .toBuffer();
      const outPath = path.join(OUT_DIR, decal.file);
      fs.writeFileSync(outPath, buf);
      console.log(
        'Wrote ' +
          outPath +
          ' (' +
          buf.length +
          ' bytes, was ' +
          rawBuf.length +
          ')'
      );
      if (buf.length > 30 * 1024) {
        console.warn(
          '  WARNING: ' + decal.file + ' is over 30 KB (target ≤30KB)'
        );
      }
    }
  } finally {
    await browser.close();
  }
  console.log('Done.');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
