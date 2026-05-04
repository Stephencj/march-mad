/**
 * Diagnostic-only "test" that loads the user's downloaded clips, runs the
 * full retarget + fit pipeline, and prints stats so we can see exactly
 * where motion is being garbled.
 *
 * NOT a unit test. Run with: `npx vitest run src/dev/mocap/_diagnose.test.ts`
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { describe, it } from 'vitest';

const OUT = 'C:\\Users\\Stephen\\documents\\march-mad\\src\\dev\\mocap\\_diagnose.out.txt';
writeFileSync(OUT, '');
function log(...args: unknown[]): void {
  appendFileSync(OUT, args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n');
}
import { retarget } from './retarget';
import { fit } from './fitter';
import { MP_POSE, type MocapClip, type PoseClip } from './types';

const CLIPS = [
  'C:\\Users\\Stephen\\Downloads\\walk-side-2026-05-02T19-35-22.json',
  'C:\\Users\\Stephen\\Downloads\\walk-front-2026-05-02T19-33-00.json',
  'C:\\Users\\Stephen\\Downloads\\walk-front-2026-05-02T19-38-47.json',
];

function summary(arr: number[]): string {
  if (arr.length === 0) return '(empty)';
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sorted = [...arr].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return `min=${min.toFixed(3)} median=${median.toFixed(3)} mean=${mean.toFixed(3)} max=${max.toFixed(3)}`;
}

function diagnoseClip(path: string): void {
  const raw = readFileSync(path, 'utf-8');
  const clip = JSON.parse(raw) as MocapClip;
  const N = clip.frames.length;
  const dur = clip.frames[N - 1].t - clip.frames[0].t;

  log('\n========================================');
  log(`Clip: ${clip.name}`);
  log(`  target=${clip.targetAnim}  orientation=${clip.orientation}  fps=${clip.fps}`);
  log(`  frames=${N}  duration=${dur.toFixed(2)}s  measured_fps=${(N / dur).toFixed(1)}`);

  // Visibility per primary landmark
  const visAt = (idx: number) => clip.frames.map((f) => f.world[idx].visibility);
  log(`  vis LEFT_SHOULDER:   ${summary(visAt(MP_POSE.LEFT_SHOULDER))}`);
  log(`  vis RIGHT_SHOULDER:  ${summary(visAt(MP_POSE.RIGHT_SHOULDER))}`);
  log(`  vis LEFT_HIP:        ${summary(visAt(MP_POSE.LEFT_HIP))}`);
  log(`  vis LEFT_KNEE:       ${summary(visAt(MP_POSE.LEFT_KNEE))}`);
  log(`  vis LEFT_ANKLE:      ${summary(visAt(MP_POSE.LEFT_ANKLE))}`);

  // Raw landmark Y range (in world coords) — sanity-check axis convention
  log(`  NOSE.y:              ${summary(clip.frames.map((f) => f.world[MP_POSE.NOSE].y))}`);
  log(`  LEFT_HIP.y:          ${summary(clip.frames.map((f) => f.world[MP_POSE.LEFT_HIP].y))}`);
  log(`  LEFT_ANKLE.y:        ${summary(clip.frames.map((f) => f.world[MP_POSE.LEFT_ANKLE].y))}`);
  log(`  LEFT_KNEE.y:         ${summary(clip.frames.map((f) => f.world[MP_POSE.LEFT_KNEE].y))}`);

  // Hip lateral motion (does the user actually have a swing?)
  log(`  LEFT_KNEE.z:         ${summary(clip.frames.map((f) => f.world[MP_POSE.LEFT_KNEE].z))}`);
  log(`  LEFT_ANKLE.z:        ${summary(clip.frames.map((f) => f.world[MP_POSE.LEFT_ANKLE].z))}`);
  log(`  RIGHT_KNEE.z:        ${summary(clip.frames.map((f) => f.world[MP_POSE.RIGHT_KNEE].z))}`);
  // Z-axis convention sanity: NOSE.z and shoulder.z tell us which way is "forward".
  log(`  NOSE.z:              ${summary(clip.frames.map((f) => f.world[MP_POSE.NOSE].z))}`);
  log(`  LEFT_SHOULDER.z:     ${summary(clip.frames.map((f) => f.world[MP_POSE.LEFT_SHOULDER].z))}`);
  log(`  LEFT_HIP.z:          ${summary(clip.frames.map((f) => f.world[MP_POSE.LEFT_HIP].z))}`);
  // Hip mid Y range — confirms the "always zero" theory (origin is hip-mid).
  log(`  LEFT_HIP.y range:    ${summary(clip.frames.map((f) => f.world[MP_POSE.LEFT_HIP].y))}`);
  log(`  RIGHT_HIP.y range:   ${summary(clip.frames.map((f) => f.world[MP_POSE.RIGHT_HIP].y))}`);

  // Retarget
  let pose: PoseClip;
  try {
    pose = retarget(clip);
  } catch (err) {
    log(`  RETARGET FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  log(`  torsoLength=${pose.torsoLength.toFixed(3)}m`);
  log(`  bodyY:               ${summary(pose.frames.map((p) => p.bodyY))}`);
  log(`  bodyPivot.x (lean):  ${summary(pose.frames.map((p) => p.bodyPivot.x))}`);
  log(`  hipL.x:              ${summary(pose.frames.map((p) => p.hipL.x))}`);
  log(`  hipR.x:              ${summary(pose.frames.map((p) => p.hipR.x))}`);
  log(`  kneeL:               ${summary(pose.frames.map((p) => p.kneeL))}`);
  log(`  kneeR:               ${summary(pose.frames.map((p) => p.kneeR))}`);
  log(`  shoulderL.x:         ${summary(pose.frames.map((p) => p.shoulderL.x))}`);
  log(`  shoulderR.x:         ${summary(pose.frames.map((p) => p.shoulderR.x))}`);
  log(`  elbowL:              ${summary(pose.frames.map((p) => p.elbowL))}`);
  log(`  elbowR:              ${summary(pose.frames.map((p) => p.elbowR))}`);
  log(`  hipMeshY:            ${summary(pose.frames.map((p) => p.hipMeshY))}`);
  log(`  torsoY:              ${summary(pose.frames.map((p) => p.torsoY))}`);

  // Hip-diff time series — what the fitter autocorrelates.
  const hipDiff = pose.frames.map((p) => p.hipL.x - p.hipR.x);
  const meanHd = hipDiff.reduce((a, b) => a + b, 0) / hipDiff.length;
  const dev = hipDiff.map((v) => v - meanHd);
  log(`  hipL.x - hipR.x mean=${meanHd.toFixed(3)}  range=[${Math.min(...hipDiff).toFixed(2)}, ${Math.max(...hipDiff).toFixed(2)}]`);
  const FPS = pose.fps;
  // Autocorrelation R(τ)/R(0) for lags up to half the clip.
  const r0 = dev.reduce((a, v) => a + v * v, 0);
  const Nd = dev.length;
  const peaks: { lag: number; r: number }[] = [];
  for (let lag = 1; lag < Math.floor(Nd / 2); lag++) {
    let s = 0;
    for (let t = 0; t + lag < Nd; t++) s += dev[t] * dev[t + lag];
    const r = r0 > 0 ? s / r0 : 0;
    if (lag >= 2 && lag < Math.floor(Nd / 2) - 1) {
      // Detect local max
      let prev = 0;
      let next = 0;
      for (let t = 0; t + lag - 1 < Nd; t++) prev += dev[t] * dev[t + lag - 1];
      for (let t = 0; t + lag + 1 < Nd; t++) next += dev[t] * dev[t + lag + 1];
      const rPrev = r0 > 0 ? prev / r0 : 0;
      const rNext = r0 > 0 ? next / r0 : 0;
      if (r > rPrev && r > rNext && r > 0.1) {
        peaks.push({ lag, r });
      }
    }
  }
  peaks.sort((a, b) => b.r - a.r);
  const top = peaks.slice(0, 5);
  // Print signal at ~20 evenly spaced points so we can eyeball periodicity.
  const samples = 20;
  const step = Math.max(1, Math.floor(N / samples));
  let ts = '';
  for (let i = 0; i < N; i += step) {
    ts += `${pose.frames[i].t.toFixed(1)}s:${hipDiff[i].toFixed(2)} `;
  }
  log(`  hipDiff(t):  ${ts}`);
  log(`  autocorr top peaks (lag in frames → seconds):`);
  for (const p of top) {
    log(`    lag=${p.lag} (${(p.lag / FPS).toFixed(2)}s)  R/R0=${p.r.toFixed(3)}`);
  }

  // Fit
  const result = fit(pose);
  log(`  fit.confidence=${result.diagnostics.confidence?.toFixed(2) ?? 'n/a'}  cycles=${result.diagnostics.detectedCyclesSec ?? 'n/a'}s`);
  if (result.warnings.length) log(`  warnings: ${result.warnings.join(' | ')}`);
  log(`  fit.config = ${JSON.stringify(result.config, null, 2).slice(0, 600)}`);
}

describe('mocap clip diagnosis', () => {
  it('runs all three clips through retarget + fit', () => {
    for (const path of CLIPS) {
      try {
        diagnoseClip(path);
      } catch (err) {
        log(`\nFAILED ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
});
