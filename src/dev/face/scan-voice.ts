/**
 * Voice + audio cue helpers for the 3D face scan flow.
 *
 * Speech synthesis is used for *instructions* (verbose, low-frequency) so the
 * user can keep their head in profile pose without losing feedback. WebAudio
 * beeps cover *state changes* (capture success, hold-halfway tick) — they
 * fire during user-visible transitions and need lower latency than TTS.
 *
 * Both share a single voice-enabled toggle; users who don't want sound can
 * mute the whole channel via `setVoiceEnabled(false)`.
 *
 * Browser caveats handled:
 *   - SpeechSynthesis: missing on some mobile / privacy builds → silent no-op.
 *   - AudioContext: can't be created until a user gesture in Chrome → we
 *     defer creation to the first `beep()` call (typically the scan-start
 *     click handler, which is a user gesture). Failure is swallowed.
 */

let lastSpokenPose: string | null = null;
let voiceEnabled = true;

export function setVoiceEnabled(on: boolean): void {
  voiceEnabled = on;
  if (!on && 'speechSynthesis' in window) {
    // User toggled off mid-scan — silence any utterance already speaking.
    window.speechSynthesis.cancel();
  }
}

export function isVoiceEnabled(): boolean {
  return voiceEnabled;
}

/**
 * Speak the per-pose instruction. Guarded by `lastSpokenPose` so callers can
 * safely invoke this every frame without the synth queue exploding — only
 * the *first* call for a given pose name actually speaks.
 */
export function speakPoseInstruction(poseName: string, instruction: string): void {
  if (!voiceEnabled) return;
  if (!('speechSynthesis' in window)) return;
  if (lastSpokenPose === poseName) return; // don't repeat per-frame
  lastSpokenPose = poseName;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(instruction);
  u.rate = 1.0;
  u.pitch = 1.0;
  window.speechSynthesis.speak(u);
}

/** One-off announcement (start, complete, "captured"). Bypasses the dedupe. */
export function speakNow(text: string): void {
  if (!voiceEnabled) return;
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.1;
  window.speechSynthesis.speak(u);
}

/** Reset the per-pose dedupe + cancel any in-flight speech. */
export function resetSpokenState(): void {
  lastSpokenPose = null;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

// ---------------------------------------------------------------------------
// WebAudio beep helper.
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) {
    // Cast: TypeScript's lib.dom doesn't always include the webkit-prefixed
    // fallback, but the unprefixed AudioContext is universal in modern
    // browsers, so we don't bother with it.
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

/**
 * Fire a short sine-wave tone. Tied to the same `voiceEnabled` toggle as
 * speech for a single user-visible mute switch.
 *
 * @param freq    Frequency in Hz (e.g. 880 = A5).
 * @param durMs   Duration in milliseconds.
 * @param gain    Output gain 0..1 (default 0.15 — quiet enough to not startle).
 */
export function beep(freq: number, durMs: number, gain = 0.15): void {
  if (!voiceEnabled) return;
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    g.gain.value = gain;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durMs / 1000);
  } catch {
    // AudioContext blocked (no user gesture yet) or otherwise unhappy.
    // Beeps are a nice-to-have, never critical — swallow.
  }
}
