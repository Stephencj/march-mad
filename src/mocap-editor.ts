/**
 * Mocap editor entry point.
 *
 * Wires DOM controls in `mocap-editor.html` to the capture engine
 * (`./dev/mocap/capture.ts`), the IndexedDB store
 * (`./dev/mocap/clip-store.ts`), and the 2D skeleton overlay
 * (`./dev/mocap/preview-overlay.ts`).
 *
 * This is Phase 1 only — produce + persist `MocapClip` JSON. Retargeting
 * onto the dad-bod rig and procedural fitting belong to later phases.
 */
import { MocapCapture } from './dev/mocap/capture';
import {
  saveClip,
  loadClip,
  listClips,
  deleteClip,
  exportClipJSON,
  importClipJSON,
  type ClipMeta,
} from './dev/mocap/clip-store';
import {
  drawLandmarks,
  clearOverlay,
  resizeOverlay,
} from './dev/mocap/preview-overlay';
import { retarget } from './dev/mocap/retarget';
import { fit, type FitResult } from './dev/mocap/fitter';
import type {
  MocapOrientation,
  MocapTargetAnim,
  MocapClip,
  MpLandmark,
} from './dev/mocap/types';

// --- DOM ---
const videoEl = document.getElementById('webcam') as HTMLVideoElement;
const overlayEl = document.getElementById('overlay') as HTMLCanvasElement;
const countdownEl = document.getElementById('countdown') as HTMLDivElement;
const targetAnimEl = document.getElementById('target-anim') as HTMLSelectElement;
const orientationEl = document.getElementById('orientation') as HTMLSelectElement;
const clipNameEl = document.getElementById('clip-name') as HTMLInputElement;
const durationEl = document.getElementById('duration') as HTMLInputElement;
const fpsEl = document.getElementById('fps') as HTMLSelectElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLDivElement;
const btnCamera = document.getElementById('btn-camera') as HTMLDivElement;
const btnRecord = document.getElementById('btn-record') as HTMLDivElement;
const btnStop = document.getElementById('btn-stop') as HTMLDivElement;
const clipListEl = document.getElementById('clip-list') as HTMLDivElement;
const btnImport = document.getElementById('btn-import') as HTMLDivElement;
const importFileEl = document.getElementById('import-file') as HTMLInputElement;
const fitResultsEl = document.getElementById('fit-results') as HTMLDivElement;

// --- State ---
const capture = new MocapCapture(videoEl);
let playbackHandle: number | null = null;

// --- Helpers ---
function setStatus(text: string): void {
  statusEl.textContent = text;
}
function setError(msg: string): void {
  errorEl.textContent = msg;
}
function clearError(): void {
  errorEl.textContent = '';
}
function setBtnEnabled(btn: HTMLDivElement, enabled: boolean): void {
  if (enabled) btn.classList.remove('disabled');
  else btn.classList.add('disabled');
}

function defaultClipName(): string {
  const anim = targetAnimEl.value;
  const orient = orientationEl.value;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${anim}-${orient}-${stamp}`;
}

function isValidTargetAnim(v: string): v is MocapTargetAnim {
  return [
    'idle',
    'walk',
    'walk-backward',
    'sprint',
    'dribble',
    'dribble-walk',
    'dribble-sprint',
    'guard',
    'custom',
  ].includes(v);
}
function isValidOrientation(v: string): v is MocapOrientation {
  return ['side', 'front', 'three-quarter'].includes(v);
}

// Resize the overlay canvas to its CSS box on layout changes.
window.addEventListener('resize', () => resizeOverlay(overlayEl));
resizeOverlay(overlayEl);

// --- Camera button ---
btnCamera.addEventListener('click', async () => {
  if (capture.isCameraStarted()) return;
  if (btnCamera.classList.contains('disabled')) return;
  setBtnEnabled(btnCamera, false);
  setStatus('Loading model + camera...');
  clearError();
  try {
    await capture.startCamera((result, video) => {
      if (playbackHandle !== null) return; // playback owns the overlay
      resizeOverlay(overlayEl);
      const lm: ReadonlyArray<MpLandmark> | undefined = result.landmarks?.[0] as
        | ReadonlyArray<MpLandmark>
        | undefined;
      drawLandmarks(overlayEl, lm, {
        videoW: video.videoWidth,
        videoH: video.videoHeight,
      });
    });
    btnCamera.textContent = 'Camera ready';
    btnCamera.classList.add('active');
    setBtnEnabled(btnRecord, true);
    setStatus('Camera ready. Frame yourself + click Record.');
  } catch (err) {
    setBtnEnabled(btnCamera, true);
    const msg = err instanceof Error ? err.message : String(err);
    setStatus('Camera failed.');
    setError(msg);
  }
});

// --- Record button ---
btnRecord.addEventListener('click', async () => {
  if (btnRecord.classList.contains('disabled')) return;
  if (!capture.isCameraStarted() || capture.isRecording()) return;

  const targetAnimRaw = targetAnimEl.value;
  const orientationRaw = orientationEl.value;
  if (!isValidTargetAnim(targetAnimRaw) || !isValidOrientation(orientationRaw)) {
    setError('Invalid target anim or orientation.');
    return;
  }
  const duration = Math.max(1, Math.min(60, Number(durationEl.value) || 6));
  const fps = Math.max(1, Math.min(120, Number(fpsEl.value) || 30));
  const name = clipNameEl.value.trim() || defaultClipName();

  // Disallow overwriting an existing clip silently.
  const existing = await loadClip(name);
  if (existing) {
    if (!confirm(`Clip "${name}" exists. Overwrite?`)) return;
  }

  clearError();
  setBtnEnabled(btnRecord, false);
  setBtnEnabled(btnCamera, false);

  // 3-2-1 countdown.
  for (const n of [3, 2, 1]) {
    btnRecord.textContent = `${n}...`;
    countdownEl.textContent = String(n);
    countdownEl.classList.add('show');
    setStatus(`Recording in ${n}...`);
    await sleep(1000);
  }
  countdownEl.textContent = 'REC';
  btnRecord.textContent = 'REC';
  setBtnEnabled(btnStop, true);

  try {
    const { clip, droppedFrames, measuredFps } = await capture.record({
      duration,
      fps,
      targetAnim: targetAnimRaw,
      orientation: orientationRaw,
      name,
      onProgress: (elapsed, frameCount) => {
        setStatus(
          `REC ${elapsed.toFixed(1)}s / ${duration}s\n` +
            `frames: ${frameCount}\n` +
            `~${(frameCount / Math.max(elapsed, 0.001)).toFixed(1)} fps`
        );
      },
    });
    countdownEl.classList.remove('show');
    setBtnEnabled(btnStop, false);
    btnRecord.textContent = 'Record';
    setBtnEnabled(btnRecord, true);
    setBtnEnabled(btnCamera, false); // camera stays on, button stays disabled
    btnCamera.classList.add('active');

    await saveClip(clip);
    let msg = `Saved "${clip.name}" (${clip.frames.length} frames, ~${measuredFps.toFixed(1)} fps).`;
    if (droppedFrames > 0) {
      const totalConsidered = droppedFrames + clip.frames.length;
      const dropPct = (droppedFrames / Math.max(totalConsidered, 1)) * 100;
      msg += `\nDropped ${droppedFrames} low-visibility frames (${dropPct.toFixed(0)}%).`;
      if (dropPct > 30) {
        msg +=
          '\n[!] >30% dropped — try better lighting, full-body framing, or face the camera.';
      }
    }
    setStatus(msg);
    await refreshClipList();
  } catch (err) {
    countdownEl.classList.remove('show');
    setBtnEnabled(btnStop, false);
    btnRecord.textContent = 'Record';
    setBtnEnabled(btnRecord, true);
    const m = err instanceof Error ? err.message : String(err);
    setStatus('Recording failed.');
    setError(m);
  }
});

// --- Stop button ---
btnStop.addEventListener('click', () => {
  if (btnStop.classList.contains('disabled')) return;
  capture.stop();
});

// --- Import button ---
btnImport.addEventListener('click', () => importFileEl.click());
importFileEl.addEventListener('change', async () => {
  const file = importFileEl.files?.[0];
  if (!file) return;
  try {
    const clip = await importClipJSON(file);
    const existing = await loadClip(clip.name);
    if (existing && !confirm(`Clip "${clip.name}" exists. Overwrite?`)) {
      importFileEl.value = '';
      return;
    }
    await saveClip(clip);
    await refreshClipList();
    setStatus(`Imported "${clip.name}" (${clip.frames.length} frames).`);
    clearError();
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    setError(`Import failed: ${m}`);
  } finally {
    importFileEl.value = '';
  }
});

// --- Clip list ---
async function refreshClipList(): Promise<void> {
  const meta = await listClips();
  clipListEl.innerHTML = '';
  if (meta.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11px;color:#666;padding:4px;';
    empty.textContent = 'No clips yet. Record one to get started.';
    clipListEl.appendChild(empty);
    return;
  }
  for (const m of meta) {
    clipListEl.appendChild(renderClipRow(m));
  }
}

function renderClipRow(m: ClipMeta): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'clip-row';

  const name = document.createElement('div');
  name.className = 'clip-name';
  name.textContent = m.name;
  row.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'clip-meta';
  const ts = m.capturedAt.replace('T', ' ').replace(/\..*$/, '');
  meta.textContent = `${m.targetAnim} - ${m.frameCount}f - ${ts}`;
  row.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'clip-actions';

  const playBtn = document.createElement('div');
  playBtn.className = 'btn';
  playBtn.textContent = 'Play';
  playBtn.addEventListener('click', () => playClip(m.name));
  actions.appendChild(playBtn);

  const fitBtn = document.createElement('div');
  fitBtn.className = 'btn';
  fitBtn.textContent = 'Fit';
  fitBtn.addEventListener('click', () => {
    if (fitBtn.classList.contains('disabled')) return;
    void runFit(m.name, fitBtn);
  });
  actions.appendChild(fitBtn);

  const exportBtn = document.createElement('div');
  exportBtn.className = 'btn';
  exportBtn.textContent = 'Export';
  exportBtn.addEventListener('click', async () => {
    const clip = await loadClip(m.name);
    if (!clip) {
      setError(`Clip "${m.name}" not found in DB.`);
      return;
    }
    exportClipJSON(clip);
  });
  actions.appendChild(exportBtn);

  const delBtn = document.createElement('div');
  delBtn.className = 'btn danger';
  delBtn.textContent = 'Del';
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Delete "${m.name}"?`)) return;
    await deleteClip(m.name);
    await refreshClipList();
    if (statusEl.textContent?.includes(m.name)) {
      setStatus(`Deleted "${m.name}".`);
    }
  });
  actions.appendChild(delBtn);

  row.appendChild(actions);
  return row;
}

// --- Playback (re-play a saved clip's image-space landmarks on the overlay) ---
async function playClip(name: string): Promise<void> {
  const clip = await loadClip(name);
  if (!clip) {
    setError(`Clip "${name}" not found.`);
    return;
  }
  if (clip.frames.length === 0) {
    setError(`Clip "${name}" has 0 frames.`);
    return;
  }
  // Stop any previous playback.
  if (playbackHandle !== null) {
    cancelAnimationFrame(playbackHandle);
    playbackHandle = null;
  }
  setStatus(`Playing "${name}" (${clip.frames.length} frames)...`);
  clearError();

  // Hide the live webcam during playback so the overlay reads cleanly.
  const prevDisplay = videoEl.style.display;
  videoEl.style.display = 'none';
  resizeOverlay(overlayEl);

  const startWall = performance.now();
  const frames = clip.frames;
  const lastT = frames[frames.length - 1].t;

  const tick = () => {
    const elapsed = (performance.now() - startWall) / 1000;
    // Loop on the last frame's t.
    const tWrap = lastT > 0 ? elapsed % lastT : 0;
    let i = 0;
    for (let j = 0; j < frames.length; j++) {
      if (frames[j].t <= tWrap) i = j;
      else break;
    }
    const f = frames[i];
    drawForPlayback(clip, f.image ?? worldFallbackToImage(f.world));
    playbackHandle = requestAnimationFrame(tick);
  };
  playbackHandle = requestAnimationFrame(tick);

  // Stop button doubles as "stop playback" while playing.
  setBtnEnabled(btnStop, true);
  const stopHandler = () => {
    if (playbackHandle !== null) {
      cancelAnimationFrame(playbackHandle);
      playbackHandle = null;
    }
    videoEl.style.display = prevDisplay;
    clearOverlay(overlayEl);
    setBtnEnabled(btnStop, false);
    btnStop.removeEventListener('click', stopHandler);
    setStatus(`Stopped playback of "${name}".`);
  };
  btnStop.addEventListener('click', stopHandler);
}

function drawForPlayback(clip: MocapClip, lm: ReadonlyArray<MpLandmark>): void {
  void clip;
  drawLandmarks(overlayEl, lm, { videoW: 0, videoH: 0, minVisibility: 0.2 });
}

/** When `image` is missing on a saved clip, derive a rough preview from
 *  world coordinates: drop z, normalize to a centered [0,1] box. This keeps
 *  the Play button useful for clips captured before image-space was saved. */
function worldFallbackToImage(world: ReadonlyArray<MpLandmark>): MpLandmark[] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const lm of world) {
    if (lm.x < minX) minX = lm.x;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.y > maxY) maxY = lm.y;
  }
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  // Pad 10% so the figure doesn't kiss the canvas edges.
  const pad = 0.1;
  return world.map((lm) => ({
    x: pad + ((lm.x - minX) / w) * (1 - 2 * pad),
    // World y is +down already, matching image y.
    y: pad + ((lm.y - minY) / h) * (1 - 2 * pad),
    z: lm.z,
    visibility: lm.visibility,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Fit pipeline (clip → retarget → fit → results pane) ---

async function runFit(name: string, fitBtn: HTMLDivElement): Promise<void> {
  fitBtn.classList.add('disabled');
  fitBtn.textContent = 'Fitting...';
  try {
    const clip = await loadClip(name);
    if (!clip) {
      renderFitError(name, `Clip "${name}" not found in DB.`);
      return;
    }
    let result: FitResult;
    try {
      const pose = retarget(clip);
      result = fit(pose);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      renderFitError(name, `Retarget/fit failed: ${msg}`);
      return;
    }
    renderFitResult(clip, result);
  } finally {
    fitBtn.classList.remove('disabled');
    fitBtn.textContent = 'Fit';
  }
}

function clearFitResults(): void {
  fitResultsEl.innerHTML = '';
}

function showFitResults(): void {
  fitResultsEl.style.display = 'flex';
  fitResultsEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function appendFitHeader(clipName: string, targetAnim: string): void {
  const header = document.createElement('div');
  header.className = 'fit-header';
  header.textContent = `Fit: ${clipName} → ${targetAnim}`;
  fitResultsEl.appendChild(header);

  const hint = document.createElement('div');
  hint.className = 'fit-hint';
  // Persistent guidance — included on every fit per spec.
  hint.innerHTML =
    '<strong>Next step</strong>: download the JSON, open the ' +
    '<strong>Animation Viewer</strong>, then click <strong>Import JSON</strong> ' +
    'under <strong>Animation Tuning</strong> to apply this fit to the live ' +
    'rig. If something looks wrong, tweak the captured clip (or capture a ' +
    'cleaner one) and re-fit.';
  fitResultsEl.appendChild(hint);
}

function renderFitError(clipName: string, message: string): void {
  clearFitResults();
  appendFitHeader(clipName, 'error');
  const err = document.createElement('div');
  err.className = 'fit-error';
  err.textContent = message;
  fitResultsEl.appendChild(err);
  showFitResults();
}

function renderFitResult(clip: MocapClip, result: FitResult): void {
  clearFitResults();
  appendFitHeader(clip.name, clip.targetAnim);

  // Diagnostics block.
  const diagTitle = document.createElement('div');
  diagTitle.className = 'fit-section-title';
  diagTitle.textContent = 'Diagnostics';
  fitResultsEl.appendChild(diagTitle);

  const diag = document.createElement('div');
  diag.className = 'fit-diag';
  const d = result.diagnostics;
  const confClass =
    d.confidence >= 0.7 ? 'conf-good' : d.confidence >= 0.4 ? 'conf-mid' : 'conf-bad';
  const rows: Array<[string, string, string?]> = [
    ['frames', String(d.frameCount)],
    ['duration', `${d.durationSec.toFixed(2)} s`],
    ['period', d.detectedCyclesSec !== undefined ? `${d.detectedCyclesSec.toFixed(3)} s` : 'n/a'],
    ['confidence', d.confidence.toFixed(2), confClass],
  ];
  for (const [label, value, cls] of rows) {
    const lbl = document.createElement('div');
    lbl.className = 'label';
    lbl.textContent = label;
    diag.appendChild(lbl);
    const val = document.createElement('div');
    if (cls) val.className = cls;
    val.textContent = value;
    diag.appendChild(val);
  }
  fitResultsEl.appendChild(diag);

  // Warnings block.
  if (result.warnings.length > 0) {
    const warnTitle = document.createElement('div');
    warnTitle.className = 'fit-section-title';
    warnTitle.textContent = 'Warnings';
    fitResultsEl.appendChild(warnTitle);

    const ul = document.createElement('ul');
    ul.className = 'fit-warnings';
    for (const w of result.warnings) {
      const li = document.createElement('li');
      li.textContent = w;
      ul.appendChild(li);
    }
    fitResultsEl.appendChild(ul);
  }

  const isEmpty = Object.keys(result.config).length === 0;
  if (isEmpty) {
    const note = document.createElement('div');
    note.className = 'fit-empty-note';
    note.textContent = 'No fittable fields for this clip — nothing to download.';
    fitResultsEl.appendChild(note);
    showFitResults();
    return;
  }

  // Fitted config — top-level Partial<AnimConfig> shape; this is the exact
  // payload the download/copy actions emit, and it's what applyAnimJSON
  // expects. No __version wrapper — applyAnimJSON merges any keys present.
  const configJson = JSON.stringify(result.config, null, 2);

  const cfgTitle = document.createElement('div');
  cfgTitle.className = 'fit-section-title';
  cfgTitle.textContent = 'Fitted AnimConfig fragment';
  fitResultsEl.appendChild(cfgTitle);

  const pre = document.createElement('pre');
  pre.className = 'fit-json';
  pre.textContent = configJson;
  fitResultsEl.appendChild(pre);

  // Action buttons.
  const actions = document.createElement('div');
  actions.className = 'btn-row';

  const downloadBtn = document.createElement('div');
  downloadBtn.className = 'btn';
  downloadBtn.textContent = 'Download AnimConfig JSON';
  downloadBtn.addEventListener('click', () => {
    downloadFittedJSON(clip.name, configJson);
  });
  actions.appendChild(downloadBtn);

  const copyBtn = document.createElement('div');
  copyBtn.className = 'btn';
  copyBtn.textContent = 'Copy to clipboard';
  copyBtn.addEventListener('click', () => {
    void copyToClipboard(configJson, copyBtn);
  });
  actions.appendChild(copyBtn);

  fitResultsEl.appendChild(actions);

  showFitResults();
}

function downloadFittedJSON(clipName: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = clipName.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'fitted';
  a.download = `fitted-${safe}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyToClipboard(text: string, btn: HTMLDivElement): Promise<void> {
  const original = btn.textContent ?? 'Copy to clipboard';
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied!';
  } catch {
    // Fallback path — older browsers / insecure contexts.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      btn.textContent = 'Copied!';
    } catch {
      btn.textContent = 'Copy failed';
    }
    document.body.removeChild(ta);
  }
  setTimeout(() => {
    btn.textContent = original;
  }, 1500);
}

// --- Init ---
clipNameEl.placeholder = defaultClipName();
targetAnimEl.addEventListener('change', () => {
  clipNameEl.placeholder = defaultClipName();
});
orientationEl.addEventListener('change', () => {
  clipNameEl.placeholder = defaultClipName();
});

window.addEventListener('beforeunload', () => {
  void capture.dispose();
});

void refreshClipList();
setStatus('idle - click "Start camera" to begin.');
